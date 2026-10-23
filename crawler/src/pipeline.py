"""
pipeline.py — orchestrates the full crawl: discovery -> classify -> extract
-> validate -> store, per provider, then produces a run summary and fires
alerts if anything looks broken.

This is the entry point invoked by the daily cron job (see
.github/workflows/daily_scrape.yml).

Usage:
    python -m src.pipeline                  # run all enabled providers
    python -m src.pipeline --provider chase # run just one (debugging)
"""
import argparse
import logging
import sys
import time
from datetime import datetime

from src.cache import load_cache, save_cache, content_hash
from src.config import settings, LOG_DIR
from src.discovery import discover_urls
from src.classify import classify_batch
from src.extract import extract_card_data, CardData, EXTRACT_VERSION
from src.fetch import catalog_card_images, extract_card_image, fetch_page
from src.validate import validate_batch
from src.storage import load_latest, save_run, save_rejections
from src.notify import send_alert
from src import llm_client

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(LOG_DIR / f"run_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"),
    ],
)
logger = logging.getLogger("pipeline")

# A run where this share of LLM calls failed is a provider outage (bad key,
# no credits, model retired), not a few flaky pages. Its output is a
# fraction of the issuer's cards, so it must not be stored as the new state.
LLM_FAILURE_LIMIT = 0.2


def llm_outage(calls: int, failures: int) -> bool:
    return failures >= 2 and failures / calls >= LLM_FAILURE_LIMIT


def run_provider(provider: dict) -> dict:
    name = provider["name"]
    summary = {"provider": name, "discovered": 0, "classified": 0, "accepted": 0, "rejected": 0, "error": None}

    # Crawl cache: classification verdicts + content hashes from prior runs.
    # This is what makes re-runs nearly free (see src/cache.py). Saved in
    # the finally block so partial progress survives a mid-run crash.
    cache = load_cache(name)
    llm_client.reset_stats()

    try:
        # Stage 2: discovery
        urls = discover_urls(provider)
        summary["discovered"] = len(urls)
        if not urls:
            summary["error"] = "zero URLs discovered"
            return summary

        # Stage 3: classification (filters down to confirmed single-card pages)
        classified = classify_batch(urls, cache=cache, render=provider.get("render_js", False))
        summary["classified"] = len(classified)
        if not classified:
            summary["error"] = "zero pages classified as single_card — site may have changed structure"
            return summary

        # Stage 4: extraction — skipped per page when the cleaned content
        # hash matches the cached one, since identical input would produce
        # identical output at LLM-call cost.
        extracted = []
        raw_html_by_url = {}
        reused = 0
        for result in classified:
            entry = cache["urls"].setdefault(result.url, {})
            page_hash = content_hash(result.cleaned_text or "")

            if (
                entry.get("content_hash") == page_hash
                and entry.get("record")
                and entry.get("extract_version") == EXTRACT_VERSION
            ):
                card_data = CardData(**entry["record"])
                reused += 1
            else:
                card_data = extract_card_data(result.url, result.raw_html, result.cleaned_text, name)
                if card_data.extraction_method != "llm_failed" and card_data.card_name:
                    entry["content_hash"] = page_hash
                    entry["record"] = card_data.to_dict()
                    entry["extract_version"] = EXTRACT_VERSION
                time.sleep(settings.request_delay_s)

            # Card art comes from the page's own <img>/og:image tags —
            # free (no LLM), so refresh it every run even for cached
            # records in case the issuer rotated the asset.
            if result.raw_html:
                card_data.image_url = extract_card_image(result.raw_html, result.url) or card_data.image_url

            # The LLM copies whatever legal entity the page names ("Barclays
            # US", "Barclays Bank Delaware", "JPMorgan Chase Bank, N.A."), so
            # one issuer showed up under up to three names. The provider's
            # curated display_name is the canonical issuer.
            card_data.issuer = provider.get("display_name") or card_data.issuer

            extracted.append(card_data)
            raw_html_by_url[result.url] = result.raw_html
        if reused:
            logger.info(f"[{name}] reused {reused} cached extractions (page content unchanged)")

        # Issuers whose product pages only show an angled card photo still
        # show the flat front on their listing page (see providers.yaml).
        missing_art = [c for c in extracted if not c.image_url]
        if provider.get("catalog_art") and missing_art:
            hub = provider["fallback_hub"]
            hub = hub[0] if isinstance(hub, list) else hub
            hub_html, _ = fetch_page(hub, render=provider.get("render_js", False))
            art = catalog_card_images(hub_html or "", hub)
            for card in missing_art:
                card.image_url = art.get(card.url)
            logger.info(f"[{name}] listing-page art filled {sum(1 for c in missing_art if c.image_url)} of {len(missing_art)} cards without art")

        # Stage 5: validation against yesterday's published state
        previous = load_latest(name)
        accepted, rejected = validate_batch(extracted, previous)
        summary["accepted"] = len(accepted)
        summary["rejected"] = len(rejected)

        stats = llm_client.stats
        if stats["calls"] and llm_outage(stats["calls"], stats["failures"]):
            summary["error"] = (
                f"LLM provider failing: {stats['failures']} of {stats['calls']} calls failed "
                f"(last: {stats['last_error']}) — run not stored"
            )
            return summary

        # Stage 6: storage
        save_run(name, accepted, raw_html_by_url)
        save_rejections(name, rejected)

    except Exception as e:
        logger.exception(f"[{name}] pipeline error")
        summary["error"] = str(e)
    finally:
        save_cache(name, cache)

    return summary


def run_all(provider_filter: str | None = None) -> list[dict]:
    providers = settings.load_providers()
    if provider_filter:
        providers = [p for p in providers if p["name"] == provider_filter]
        if not providers:
            logger.error(f"no enabled provider named '{provider_filter}'")
            return []

    summaries = []
    for provider in providers:
        logger.info(f"=== starting {provider['name']} ===")
        summaries.append(run_provider(provider))
        time.sleep(settings.request_delay_s)

    return summaries


def report(summaries: list[dict]) -> None:
    logger.info("=" * 60)
    logger.info("RUN SUMMARY")
    total_accepted = 0
    for s in summaries:
        status = "ERROR" if s["error"] else "ok"
        logger.info(
            f"  {s['provider']:20s} discovered={s['discovered']:4d} "
            f"classified={s['classified']:4d} accepted={s['accepted']:4d} "
            f"rejected={s['rejected']:4d}  [{status}]"
        )
        total_accepted += s["accepted"]
        if s["error"]:
            send_alert(f"[{s['provider']}] pipeline issue: {s['error']}")

    failed_providers = [s["provider"] for s in summaries if s["error"]]
    if failed_providers:
        send_alert(
            f"Daily crawl finished with {len(failed_providers)} failing provider(s): "
            f"{', '.join(failed_providers)}. {total_accepted} cards published overall."
        )
    else:
        logger.info(f"All providers OK. {total_accepted} cards published.")


def main():
    parser = argparse.ArgumentParser(description="Run the credit card crawler pipeline")
    parser.add_argument("--provider", help="run a single provider by name (for debugging)")
    args = parser.parse_args()

    summaries = run_all(provider_filter=args.provider)
    report(summaries)
    # Non-zero exit turns the Actions job red, which is what makes GitHub
    # email you; a summary line in a log nobody reads is not an alert.
    if not summaries or any(s["error"] for s in summaries):
        sys.exit(1)


if __name__ == "__main__":
    main()
