"""
discovery.py — Stage 2 of the pipeline.

Finds candidate URLs for each provider. Prefers sitemaps (reliable,
structured) and falls back to a single-hop crawl of a "browse cards" hub
page when no sitemap is available.

Output of this stage is a list of *candidate* URLs — still unfiltered by
content, only by URL shape. classify.py does the real filtering.
"""
import logging
import re
import time
import xml.etree.ElementTree as ET
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlsplit, urlunsplit

import requests
from bs4 import BeautifulSoup

from src.config import settings

logger = logging.getLogger("discovery")

SITEMAP_NS = {"ns": "http://www.sitemaps.org/schemas/sitemap/0.9"}
HEADERS = {"User-Agent": settings.user_agent}

# Campaign/attribution params that never change which product a page shows.
# Wells Fargo alone published Active Cash twice because the same params came
# in a different order; canonicalizing collapses those to one URL (= one row,
# since `cards.url` is the upsert key).
_TRACKING_PARAMS = re.compile(
    r"^(utm_.*|gclid|fbclid|msclkid|dclid|cid|cx_nm|sub_channel|vendor_code|"
    r"channel|source|src|ref|referrer|intcmp|iq_id|sourcecode|campaign)$",
    re.I,
)


def canonical_url(url: str) -> str:
    """Lowercases scheme/host, drops the fragment and tracking params, and
    sorts the remaining query params so equivalent URLs compare equal. The
    path is left untouched: `url` keys existing rows (and so card ids users
    have saved), so only genuinely duplicate forms should change."""
    parts = urlsplit(url.strip())
    query = sorted(
        (k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
        if not _TRACKING_PARAMS.match(k)
    )
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path, urlencode(query), ""))


def _get(url: str) -> requests.Response | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=settings.request_timeout_s)
        resp.raise_for_status()
        return resp
    except requests.RequestException as e:
        logger.warning(f"GET failed for {url}: {e}")
        return None


def _check_robots_allowed(base_url: str, path: str) -> bool:
    """Best-effort robots.txt check. Fails open (allows) if robots.txt is
    unreachable, but fails closed (disallows) on an explicit Disallow match
    for our user agent or '*'."""
    try:
        robots_url = urljoin(base_url, "/robots.txt")
        resp = requests.get(robots_url, headers=HEADERS, timeout=settings.request_timeout_s)
        if resp.status_code != 200:
            return True
        disallowed = []
        active_ua = False
        for line in resp.text.splitlines():
            line = line.strip()
            if line.lower().startswith("user-agent:"):
                ua = line.split(":", 1)[1].strip()
                active_ua = ua == "*" or ua.lower() in settings.user_agent.lower()
            elif active_ua and line.lower().startswith("disallow:"):
                rule = line.split(":", 1)[1].strip()
                if rule:
                    disallowed.append(rule)
        return not any(path.startswith(rule) for rule in disallowed)
    except requests.RequestException:
        return True  # can't verify — don't block the whole run over a network blip


def parse_sitemap(sitemap_url: str, is_index: bool = False, _depth: int = 0) -> list[str]:
    """Recursively parse a sitemap (or sitemap index) into a flat URL list."""
    if _depth > 2:
        return []  # guard against pathological recursion
    resp = _get(sitemap_url)
    if resp is None:
        return []
    try:
        root = ET.fromstring(resp.content)
    except ET.ParseError as e:
        logger.warning(f"Malformed sitemap XML at {sitemap_url}: {e}")
        return []

    locs = [loc.text for loc in root.findall(".//ns:loc", SITEMAP_NS) if loc.text]

    if is_index:
        urls = []
        for sub_sitemap in locs:
            urls.extend(parse_sitemap(sub_sitemap, is_index=False, _depth=_depth + 1))
            time.sleep(settings.request_delay_s)
        return urls
    return locs


def coarse_filter(urls: list[str], provider: dict) -> list[str]:
    """Cheap URL-pattern pass before any page is even fetched."""
    include_patterns = provider.get("url_include") or []
    exclude_patterns = provider.get("url_exclude") or []

    def keep(url: str) -> bool:
        if include_patterns and not any(re.search(p, url, re.I) for p in include_patterns):
            return False
        if any(re.search(p, url, re.I) for p in exclude_patterns):
            return False
        return True

    filtered = [canonical_url(u) for u in urls if keep(u)]
    # de-dupe, cap volume so one provider can't dominate a run
    seen = set()
    deduped = []
    for u in filtered:
        if u not in seen:
            seen.add(u)
            deduped.append(u)
    return deduped[: settings.max_urls_per_provider]


def crawl_hub_fallback(hub_url: str, provider: dict) -> list[str]:
    """One-hop crawl for providers without a sitemap: fetch the hub page,
    pull all same-domain links, then apply the same coarse filter.

    For SPA hubs (render_js: true — e.g. Bank of America) the product links
    only exist after JS runs, so the hub is rendered in a headless browser.
    Query strings are stripped so campaign-tagged duplicates collapse."""
    text = None
    if provider.get("render_js"):
        from src.render import render_html
        text = render_html(hub_url)
    if text is None:
        resp = _get(hub_url)
        text = resp.text if resp is not None else None
    if not text:
        return []

    soup = BeautifulSoup(text, "html.parser")
    base_domain = urlparse(provider["base_url"]).netloc
    links = set()
    for a in soup.find_all("a", href=True):
        full = urljoin(provider["base_url"], a["href"])
        if urlparse(full).netloc == base_domain:
            links.add(full.split("#")[0].split("?")[0])
    # Sites that render their card list client-side (e.g. Amex) still ship
    # the product paths in the page's inline JSON/JS — pull same-site paths
    # straight from the raw HTML so we don't miss them. Unescape JSON slashes
    # (\/) first; coarse_filter's url_include narrows this to product pages.
    raw = text.replace("\\/", "/")
    for path in re.findall(r"(/[A-Za-z0-9][A-Za-z0-9/_-]*?/credit-cards/[A-Za-z0-9/_-]+/)", raw):
        links.add(urljoin(provider["base_url"], path))
    return coarse_filter(list(links), provider)


def discover_urls(provider: dict) -> list[str]:
    """Main entry point for this stage: returns filtered candidate URLs
    for one provider."""
    name = provider["name"]
    base_url = provider["base_url"]

    if not _check_robots_allowed(base_url, "/"):
        logger.warning(f"[{name}] robots.txt disallows crawling — skipping provider")
        return []

    if provider.get("sitemap"):
        logger.info(f"[{name}] discovering via sitemap")
        raw_urls = parse_sitemap(provider["sitemap"], is_index=provider.get("sitemap_index", False))
    elif provider.get("fallback_hub"):
        logger.info(f"[{name}] no sitemap — falling back to hub crawl")
        raw_urls = crawl_hub_fallback(provider["fallback_hub"], provider)
        return raw_urls  # already filtered inside crawl_hub_fallback
    else:
        logger.error(f"[{name}] no sitemap or fallback_hub configured — skipping")
        return []

    filtered = coarse_filter(raw_urls, provider)
    logger.info(f"[{name}] {len(raw_urls)} raw URLs -> {len(filtered)} after coarse filter")
    return filtered
