"""
storage.py — Stage 6 of the pipeline: persist accepted records.

Layout on disk (always written, regardless of Supabase config — cheap and
useful for local debugging/diffing in git):

  data/{provider}/latest.json          <- current published state, all cards
  data/{provider}/history/{date}.json  <- full snapshot for that day's run
  data/{provider}/raw/{card_slug}.html <- last raw HTML fetched (debugging aid)

Keeping raw HTML alongside extracted data is what makes it possible to
debug "why did extraction get this wrong" without re-scraping.

When SUPABASE_URL + SUPABASE_SERVICE_KEY are set (see .env.example), the
same accepted records are also upserted into the `cards` table in Supabase
(supabase/schema.sql) — that's what the cardscope frontend reads from. The
public interface (load_latest, save_run, save_rejections) is unchanged
either way, so nothing upstream in the pipeline needs to know or care.
"""
import json
import logging
import re
from datetime import date, datetime, timezone
from pathlib import Path

from src.config import DATA_DIR, settings
from src.tagging import enrich

logger = logging.getLogger("storage")

_supabase_client = None

# What the website currently shows (written by scripts/export_snapshot.py).
SNAPSHOT_PATH = DATA_DIR.parent.parent / "web" / "src" / "cards.snapshot.json"


def _get_supabase_client():
    """Lazily creates (and caches) the Supabase client. Returns None if
    Supabase isn't configured, so callers can no-op cleanly."""
    global _supabase_client
    if not settings.supabase_enabled:
        return None
    if _supabase_client is None:
        from supabase import create_client
        _supabase_client = create_client(settings.supabase_url, settings.supabase_service_key)
    return _supabase_client


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:80]


# Marketing marks and generic suffixes that vary between an issuer's own
# pages for the same product ("Chase Sapphire Preferred" vs "Chase Sapphire
# Preferred® Credit Card"). Stripped only for the dedupe key, never for display.
_NAME_NOISE = re.compile(r"[®™℠©]|\b(credit card|charge card|card)\b", re.I)


def card_key(record: dict) -> str:
    name = record.get("card_name") or record["url"]
    return re.sub(r"[^a-z0-9+]+", " ", _NAME_NOISE.sub(" ", name).lower()).strip()


def dedupe_records(provider_name: str, records: list[dict]) -> list[dict]:
    """Issuers often publish the same card at multiple URLs (a brand landing
    page plus the canonical product page — e.g. Chase's /sapphire and
    /sapphire/preferred both describe Sapphire Preferred). Each URL
    legitimately classifies as a single-card page, so collapse by normalized
    card name: keep the highest-confidence extraction, tie-breaking to the
    longer (more specific, likely canonical) URL. "+" is kept in the key so
    distinct products like One Key and One Key+ stay separate."""
    by_name: dict[str, dict] = {}
    for record in records:
        key = card_key(record)
        current = by_name.get(key)
        if current is None:
            by_name[key] = record
            continue
        better = (
            record.get("extraction_confidence") or 0,
            len(record["url"]),
        ) > (
            current.get("extraction_confidence") or 0,
            len(current["url"]),
        )
        if better:
            by_name[key] = record
    if len(by_name) < len(records):
        logger.info(
            f"[{provider_name}] deduped {len(records) - len(by_name)} same-card "
            f"records published under multiple URLs"
        )
    return list(by_name.values())


def provider_dir(provider_name: str) -> Path:
    d = DATA_DIR / provider_name
    (d / "history").mkdir(parents=True, exist_ok=True)
    (d / "raw").mkdir(parents=True, exist_ok=True)
    return d


def load_latest(provider_name: str) -> dict[str, dict]:
    """Returns {url: record} for the last published state, or {} if none exists.

    Prefers Supabase (the source of truth once configured), then the local
    latest.json, then the published site snapshot. The last one matters in
    CI: every Actions runner starts without yesterday's latest.json, so
    without it the day-over-day swing checks in validate.py never ran.
    """
    client = _get_supabase_client()
    if client is not None:
        resp = (
            client.table("cards")
            .select("*")
            .eq("provider", provider_name)
            .eq("is_active", True)
            .execute()
        )
        if resp.data:
            return {r["url"]: r for r in resp.data}

    path = provider_dir(provider_name) / "latest.json"
    if path.exists():
        with open(path, encoding="utf-8") as f:
            records = json.load(f)
    elif SNAPSHOT_PATH.exists():
        records = [
            r for r in json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))
            if r.get("provider") == provider_name
        ]
    else:
        return {}
    return {r["url"]: r for r in records}


def _publish_to_supabase(provider_name: str, accepted_records: list[dict]) -> None:
    client = _get_supabase_client()
    if client is None:
        return

    today = date.today().isoformat()
    now = datetime.now(timezone.utc).isoformat()
    # Already deduped by save_run; a losing URL's old row, if any, is
    # soft-deleted by the is_active sweep below.
    enriched = [enrich(dict(r)) for r in accepted_records]
    seen_urls = [r["url"] for r in enriched]

    # Upsert current state (insert new cards, update existing ones by URL).
    for record in enriched:
        row = {
            "url": record["url"],
            "provider": record["provider"],
            "card_name": record.get("card_name"),
            "issuer": record.get("issuer"),
            "annual_fee": record.get("annual_fee"),
            "apr_range": record.get("apr_range"),
            "apr_intro": record.get("apr_intro"),
            "apr_regular": record.get("apr_regular"),
            "rewards_summary": record.get("rewards_summary"),
            "signup_bonus": record.get("signup_bonus"),
            "recommended_credit_score": record.get("recommended_credit_score"),
            "foreign_transaction_fee": record.get("foreign_transaction_fee"),
            "extraction_method": record.get("extraction_method"),
            "extraction_confidence": record.get("extraction_confidence"),
            "validation_flags": record.get("validation_flags", []),
            "tags": record.get("tags", []),
            "best_for": record.get("best_for"),
            "top_perk": record.get("top_perk"),
            "image_url": record.get("image_url"),
            "reward_rates": record.get("reward_rates") or [],
            "is_active": True,
            # A real timestamp: PostgREST sends values as literals, so the
            # old "now()" string was never evaluated as a function call.
            "last_seen_at": now,
            "last_verified_at": record.get("last_verified_at") or now,
        }
        client.table("cards").upsert(row, on_conflict="url").execute()

    # Cards that were previously published for this provider but didn't
    # show up in today's run get soft-deleted (is_active=false) rather than
    # hard-deleted, so history/rollback stays intact.
    if seen_urls:
        (
            client.table("cards")
            .update({"is_active": False})
            .eq("provider", provider_name)
            .eq("is_active", True)
            .not_.in_("url", seen_urls)
            .execute()
        )

    # Append-only daily snapshot for auditing.
    history_rows = [
        {"run_date": today, "url": r["url"], "provider": provider_name, "snapshot": r}
        for r in enriched
    ]
    if history_rows:
        client.table("card_history").insert(history_rows).execute()

    logger.info(f"[{provider_name}] upserted {len(enriched)} records to Supabase")


def save_run(provider_name: str, accepted_records: list[dict], raw_html_by_url: dict[str, str]) -> None:
    """Publishes accepted_records as the new latest.json, archives a dated
    snapshot, writes raw HTML for debugging, and (if configured) upserts
    into Supabase."""
    pdir = provider_dir(provider_name)
    today = date.today().isoformat()
    accepted_records = dedupe_records(provider_name, accepted_records)

    with open(pdir / "latest.json", "w", encoding="utf-8") as f:
        json.dump(accepted_records, f, indent=2)

    with open(pdir / "history" / f"{today}.json", "w", encoding="utf-8") as f:
        json.dump(accepted_records, f, indent=2)

    for record in accepted_records:
        html = raw_html_by_url.get(record["url"])
        if html:
            slug = _slug(record.get("card_name") or record["url"])
            with open(pdir / "raw" / f"{slug}.html", "w", encoding="utf-8") as f:
                f.write(html)

    logger.info(f"[{provider_name}] published {len(accepted_records)} records for {today}")

    try:
        _publish_to_supabase(provider_name, accepted_records)
    except Exception:
        logger.exception(f"[{provider_name}] Supabase publish failed — local JSON was still written")


def save_rejections(provider_name: str, rejected_records: list[dict]) -> None:
    """Rejections don't get published, but they're logged so you can see
    patterns (e.g. one provider consistently failing extraction)."""
    if not rejected_records:
        return
    pdir = provider_dir(provider_name)
    today = date.today().isoformat()
    with open(pdir / "history" / f"{today}_rejected.json", "w", encoding="utf-8") as f:
        json.dump(rejected_records, f, indent=2)

    client = _get_supabase_client()
    if client is not None:
        rows = [
            {
                "run_date": today,
                "url": r["url"],
                "provider": provider_name,
                "rejection_reason": r.get("rejection_reason"),
                "snapshot": r,
            }
            for r in rejected_records
        ]
        try:
            client.table("card_rejections").insert(rows).execute()
        except Exception:
            logger.exception(f"[{provider_name}] Supabase rejection log failed")
