"""
export_snapshot.py — publish a crawl to the website without Supabase.

The site reads Supabase when it's configured, otherwise the committed
web/src/cards.snapshot.json. Until now nothing turned crawler output
(data/{provider}/latest.json) into that snapshot, so a fresh crawl never
reached the site. This script does, safely:

  - Providers that were crawled replace their rows; providers that weren't
    keep their existing rows (a partial or failed run never wipes data).
  - A card the crawl no longer finds is marked retired (with retired_on),
    not deleted: people who hold it can still add it as one of their cards,
    and the site keeps it out of browsing and recommendations. If it comes
    back, it's matched like any other card and un-retired.
  - Card ids stay stable: a crawled card reuses the existing id matched by
    URL, then by normalized name within the provider — so users' saved
    wallets/watchlists keep pointing at the same cards. New cards get a
    fresh uuid.
  - Rows are enriched (tags / best_for / top_perk) exactly like the
    Supabase publish path, and SNAPSHOT_AS_OF in web/src/lib/snapshot.ts is
    set to this month.

  - Suspicious issuers are held back: a sharp drop in card count (a
    half-broken crawl looks exactly like "the issuer retired its cards") or
    a day-over-day swing flagged by validate.py. They keep their current
    rows; --report writes why, and --include-flagged publishes them anyway
    (the daily workflow does that on a branch and opens a PR for review).

Then run scripts/cache_card_art.py to self-host any new card art.

Usage (from crawler/):
    python scripts/export_snapshot.py            # all providers with data
    python scripts/export_snapshot.py --dry-run  # report only
    python scripts/export_snapshot.py --provider wells_fargo  # just one issuer
    python scripts/export_snapshot.py --report review.md      # also write held-back reasons
    python scripts/export_snapshot.py --include-flagged       # publish held-back issuers too
"""
import json
import re
import sys
import uuid
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.config import DATA_DIR  # noqa: E402
from src.storage import card_key, loose_key  # noqa: E402
from src.tagging import enrich  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = ROOT / "web" / "src" / "cards.snapshot.json"
SNAPSHOT_TS = ROOT / "web" / "src" / "lib" / "snapshot.ts"

# Columns the frontend reads (web/src/lib/cardMapper.ts CardRow).
FIELDS = (
    "url", "provider", "card_name", "issuer", "annual_fee", "apr_range", "apr_intro",
    "apr_regular", "rewards_summary", "signup_bonus", "recommended_credit_score",
    "foreign_transaction_fee", "tags", "best_for", "top_perk", "image_url", "reward_rates",
    "credits",
)


# Hold an issuer back when its crawl returns under this share of the cards
# it has now (and at least MIN_DROP fewer, so 3 -> 2 doesn't trip it).
COUNT_DROP_LIMIT = 0.7
MIN_DROP = 2

# validate.py flags that mean "a published value moved a lot overnight".
# Other flags (low confidence, unquoted fields) are routine and don't block.
SWING_FLAGS = ("annual_fee changed", "apr high-end changed", "card_name changed")


def review(existing: list[dict], crawled: dict[str, list[dict]]) -> dict[str, list[str]]:
    """{provider: [reasons]} for crawled issuers that need a human look."""
    held: dict[str, list[str]] = {}
    for provider, records in crawled.items():
        reasons = []
        old = sum(1 for r in existing if r["provider"] == provider and not r.get("retired"))
        new = len(records)
        if old - new >= MIN_DROP and new < old * COUNT_DROP_LIMIT:
            reasons.append(f"card count fell {old} -> {new}")
        for record in records:
            for flag in record.get("validation_flags") or []:
                if flag.startswith(SWING_FLAGS):
                    reasons.append(f"{record.get('card_name') or record['url']}: {flag}")
        if reasons:
            held[provider] = reasons
    return held


def review_markdown(held: dict[str, list[str]]) -> str:
    lines = [
        "The daily crawl held these issuers back from the live site. Everything "
        "else was published. Merge this PR if the changes are real (an issuer "
        "really retired cards or changed a fee); close it if the crawl was wrong.",
        "",
    ]
    for provider, reasons in held.items():
        lines.append(f"### {provider}")
        lines += [f"- {r}" for r in reasons]
        lines.append("")
    return "\n".join(lines)


def build_snapshot(existing: list[dict], crawled: dict[str, list[dict]]) -> tuple[list[dict], dict]:
    """Pure merge: existing snapshot rows + {provider: accepted records}."""
    by_url = {r["url"]: r for r in existing}
    by_name = {(r["provider"], card_key(r)): r for r in existing}
    by_loose = {}
    for r in existing:
        by_loose.setdefault((r["provider"], loose_key(r)), r)
    stats = {"kept": 0, "updated": 0, "added": 0, "retired": 0}

    out = [r for r in existing if r["provider"] not in crawled]
    stats["kept"] = len(out)

    used: set[str] = set()  # an existing card id is handed out at most once
    for provider, records in crawled.items():
        for record in records:
            row = {k: record.get(k) for k in FIELDS}
            enrich(row)
            row["reward_rates"] = row.get("reward_rates") or []
            row["credits"] = row.get("credits") or []
            candidates = [
                by_url.get(row["url"]),
                by_name.get((provider, card_key(row))),
                by_loose.get((provider, loose_key(row))),
            ]
            match = next((c for c in candidates if c and c["id"] not in used), None)
            if match:
                used.add(match["id"])
            row["id"] = match["id"] if match else str(uuid.uuid4())
            # Keep self-hosted art (and its source) when the crawl found none new.
            if match and (match.get("image_url") or "").startswith("/card-art/"):
                if not row.get("image_url") or row["image_url"] == match.get("source_image_url"):
                    row["image_url"] = match["image_url"]
                    row["source_image_url"] = match.get("source_image_url")
            stats["updated" if match else "added"] += 1
            out.append(row)

    today = date.today().isoformat()
    for r in existing:
        if r["provider"] in crawled and r["id"] not in used:
            if not r.get("retired"):
                stats["retired"] += 1
            out.append({**r, "retired": True, "retired_on": r.get("retired_on") or today})

    out.sort(key=lambda r: (r["provider"], (r.get("card_name") or "").lower()))
    return out, stats


def load_crawled() -> dict[str, list[dict]]:
    crawled = {}
    for latest in sorted(DATA_DIR.glob("*/latest.json")):
        records = json.loads(latest.read_text(encoding="utf-8"))
        if records:  # an empty run is treated as "not crawled", never as "no cards"
            crawled[latest.parent.name] = records
    return crawled


def main() -> int:
    crawled = load_crawled()
    if "--provider" in sys.argv:
        only = sys.argv[sys.argv.index("--provider") + 1]
        crawled = {k: v for k, v in crawled.items() if k == only}
    if not crawled:
        print(f"No crawl output under {DATA_DIR} — run `python -m src.pipeline` first.")
        return 1
    existing = json.loads(SNAPSHOT.read_text(encoding="utf-8"))

    held = review(existing, crawled)
    for provider, reasons in held.items():
        print(f"needs review: {provider} — " + "; ".join(reasons))
    if "--report" in sys.argv:
        report = Path(sys.argv[sys.argv.index("--report") + 1])
        if held:
            report.write_text(review_markdown(held), encoding="utf-8")
        else:
            report.unlink(missing_ok=True)
    if held and "--include-flagged" not in sys.argv:
        crawled = {k: v for k, v in crawled.items() if k not in held}
        print(f"held back (keeping current cards): {', '.join(held)}")
        if not crawled:
            print("Nothing safe to publish.")
            return 0

    rows, stats = build_snapshot(existing, crawled)
    print(f"providers crawled: {', '.join(crawled)}")
    print(f"{len(existing)} -> {len(rows)} cards  {stats}")
    if "--dry-run" in sys.argv:
        return 0

    SNAPSHOT.write_text(json.dumps(rows, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    month = date.today().strftime("%B %Y")
    ts = SNAPSHOT_TS.read_text(encoding="utf-8")
    SNAPSHOT_TS.write_text(re.sub(r"SNAPSHOT_AS_OF = '[^']*'", f"SNAPSHOT_AS_OF = '{month}'", ts), encoding="utf-8")
    print(f"wrote {SNAPSHOT.relative_to(ROOT)}; SNAPSHOT_AS_OF = {month}")
    print("next: python scripts/cache_card_art.py  (self-host new card art)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
