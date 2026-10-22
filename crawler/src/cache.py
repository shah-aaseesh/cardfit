"""
cache.py — persistent per-provider crawl cache, the thing that keeps daily
re-runs inside a free LLM tier.

Two facts make LLM calls skippable on re-runs:
  1. A URL's classification verdict ("is this a single-card page?") almost
     never changes — cache it by URL and only classify newly discovered URLs.
  2. Extraction output only changes when the page content changes — cache a
     sha256 of the cleaned page text alongside the extracted record, and
     reuse the record whenever the hash matches.

The first crawl of a provider pays full price (~100 LLM calls); every run
after that costs a handful of calls for genuinely new/changed pages. The
cache lives at data/{provider}/crawl_cache.json and is safe to commit (the
GitHub Actions workflow does), which is what carries the savings across CI
runs. Deleting the file is the manual "re-crawl everything" switch.

Staleness tradeoff, on purpose: a page that changes category (e.g. a
catalog page later becoming a product page) keeps its cached verdict until
the cache file is deleted. That's rare enough that free re-runs win.
"""
import hashlib
import json
import logging
import re

from src.config import DATA_DIR

logger = logging.getLogger("cache")

CACHE_VERSION = 1

# Issuer pages embed the current date in visible text ("rates accurate as
# of 07/01/2026", "Offer ends July 31, 2026" footers regenerated daily),
# which would change the content hash every single day — defeating the
# whole point of hash-based extraction reuse. Strip date-shaped tokens
# before hashing; fee/APR/bonus changes aren't date-shaped, so real
# changes still invalidate the cache.
_DATE_PATTERNS = re.compile(
    r"\b\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}\b"
    r"|\b(?:january|february|march|april|may|june|july|august|september|october|november|december)"
    r"\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{0,4}\b"
    r"|\b\d{4}-\d{2}-\d{2}\b",
    re.IGNORECASE,
)


def _cache_path(provider_name: str):
    d = DATA_DIR / provider_name
    d.mkdir(parents=True, exist_ok=True)
    return d / "crawl_cache.json"


def load_cache(provider_name: str) -> dict:
    """Returns {"version": ..., "urls": {url: entry}}. Each entry holds a
    classification verdict (page_type/card_name/confidence) and, for
    single-card pages, the last content_hash + extracted record."""
    path = _cache_path(provider_name)
    empty = {"version": CACHE_VERSION, "urls": {}}
    if not path.exists():
        return empty
    try:
        with open(path, encoding="utf-8") as f:
            cache = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        logger.warning(f"[{provider_name}] unreadable crawl cache ({e}) — starting fresh")
        return empty
    if cache.get("version") != CACHE_VERSION or not isinstance(cache.get("urls"), dict):
        logger.info(f"[{provider_name}] crawl cache version mismatch — starting fresh")
        return empty
    return cache


def save_cache(provider_name: str, cache: dict) -> None:
    with open(_cache_path(provider_name), "w", encoding="utf-8") as f:
        json.dump(cache, f, indent=2)


def content_hash(text: str) -> str:
    normalized = _DATE_PATTERNS.sub("", text.lower())
    normalized = re.sub(r"\s+", " ", normalized)
    return hashlib.sha256(normalized.encode("utf-8", errors="replace")).hexdigest()
