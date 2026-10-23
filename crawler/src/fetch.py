"""
fetch.py — shared page-fetching and text-cleaning helper.

Both classify.py and extract.py need the same "get me the readable text
of this page" logic, so it lives here once rather than being duplicated
(and drifting) in two places.
"""
import logging
import re
import time
from urllib.parse import urljoin, urlsplit, urlunsplit

import requests
from bs4 import BeautifulSoup

from src.config import settings

logger = logging.getLogger("fetch")
HEADERS = {"User-Agent": settings.user_agent}


def fetch_page(url: str, render: bool = False) -> tuple[str | None, str | None]:
    """Returns (raw_html, cleaned_text) or (None, None) on failure.

    When `render` is True (providers flagged render_js), the page is loaded
    in a headless browser and scrolled so JS-injected / lazy-loaded content
    (e.g. Discover's card art) is present. Falls back to a static request if
    rendering is unavailable or fails."""
    if render:
        from src.render import render_html
        html = render_html(url)
        time.sleep(settings.request_delay_s)  # politeness delay
        if html:
            return html, clean_html_to_text(html)
        logger.warning(f"render returned nothing for {url}; falling back to static fetch")

    try:
        resp = requests.get(url, headers=HEADERS, timeout=settings.request_timeout_s)
        resp.raise_for_status()
    except requests.RequestException as e:
        logger.warning(f"fetch failed for {url}: {e}")
        return None, None
    finally:
        time.sleep(settings.request_delay_s)  # politeness delay regardless of outcome

    html = resp.text
    cleaned = clean_html_to_text(html)
    return html, cleaned


def clean_html_to_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "nav", "footer", "svg", "noscript", "iframe"]):
        tag.decompose()
    # collapse whitespace, keep it readable for the LLM
    text = soup.get_text(separator="\n")
    lines = [line.strip() for line in text.splitlines()]
    lines = [line for line in lines if line]
    return "\n".join(lines)


# Asset filename/path fragments that are never a single flat card face:
# nav banners, multi-card arrays, logos, angled 3D photos, digital-wallet
# marketing (phone/device renders), etc. Rotating an angled photo or a
# banner 90deg in the frontend is exactly what produced the "sideways"
# and garbled images, so we drop these outright.
_IMAGE_BLOCKLIST = (
    "banner", "array", "logo", "hero", "device", "sphere", "half-sphere",
    "apple", "google-pay", "googlepay", "paypal", "wallet", "icon",
    "angle", "angled", "photo-", "-photo", "lifestyle", "background",
    "loader", "pixel", "tracking", "spacer", "transparent", "article",
    "midnav", "masthead", "choose", "offer", "-family",
)


# Ad/analytics beacons render as <img> too. Their URLs have no image
# extension and no blocklisted word (bat.bing.com/action/0?..., dstillery
# /orbserv/nspix), so six cards shipped a 1x1 Bing pixel as their "card art".
_TRACKER_HOSTS = (
    "bat.bing.com", "dstillery.com", "doubleclick.net", "google-analytics.com",
    "googletagmanager.com", "facebook.com", "facebook.net", "analytics.",
    "demdex.net", "omtrdc.net", "adsrvr.org", "criteo.", "taboola.",
    "pinterest.com", "linkedin.com", "tiktok.com", "snapchat.com", "pixel.",
)
_RASTER_EXT = (".png", ".jpg", ".jpeg", ".webp", ".avif")


def _looks_like_image_url(parts) -> bool:
    """Real card art either has a raster extension or goes through an image
    endpoint that names one (Chase's /bcs/image?url=...card.png)."""
    path = parts.path
    if path.endswith(_RASTER_EXT):
        return True
    return "image" in path and any(ext in parts.query for ext in _RASTER_EXT)


def _is_bad_asset(src: str) -> bool:
    s = src.strip().lower()
    parts = urlsplit(s)
    if any(t in parts.netloc for t in _TRACKER_HOSTS):
        return True
    # Only absolute URLs can be judged by shape; relative srcs pass through.
    if parts.netloc and not _looks_like_image_url(parts):
        return True
    return parts.path.endswith((".svg", ".gif")) or any(term in s for term in _IMAGE_BLOCKLIST)


def _clean_img_url(src: str) -> str:
    parts = urlsplit(src.strip())
    return urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ""))


def _candidate_img_urls(img) -> list[str]:
    # Issuers (Discover especially) lazy-load real card art into data-*
    # attributes while `src` holds a loader.gif/placeholder. Gather every
    # candidate so the loader can't win by default.
    urls = []
    for attr in ("src", "data-src", "data-original", "data-lazy-src"):
        value = img.get(attr)
        if value:
            urls.append(value)
    for attr in ("srcset", "data-srcset"):
        value = img.get(attr)
        if not value:
            continue
        for candidate in value.split(","):
            url = candidate.strip().split(" ")[0]
            if url:
                urls.append(url)
    seen = set()
    deduped = []
    for url in urls:
        cleaned = _clean_img_url(url)
        if cleaned and cleaned not in seen:
            seen.add(cleaned)
            deduped.append(cleaned)
    return deduped


def _filename_dims(src: str) -> list[tuple[str, str]]:
    """WxH sizes from the image FILE NAME only ("..._480x304.png"). Folder
    names can look like sizes too — Wells Fargo's /v10-21-26/ asset folder
    read as a 10x21 thumbnail and got its real card art rejected."""
    name = urlsplit(src.lower()).path.rsplit("/", 1)[-1]
    return re.findall(r"(?<!\d)(\d{2,4})[x-](\d{2,4})(?!\d)", name)


def _dimension_score(src: str) -> int:
    """Prefer normal landscape card-art dimensions and avoid tiny nav icons."""
    score = 0
    for width, height in _filename_dims(src):
        w, h = int(width), int(height)
        if w < 140 or h < 80:
            score -= 3
            continue
        ratio = max(w, h) / min(w, h)
        if 1.45 <= ratio <= 1.75:
            score += 3
        elif ratio > 2.2:
            score -= 2
    return score


def _is_card_sized(src: str) -> bool:
    """False when the URL's own dimensions mark it as a thumbnail (tiny) or a
    clearly non-card shape. URLs without dimensions pass (can't tell)."""
    dims = _filename_dims(src)
    if not dims:
        return True
    for width, height in dims:
        w, h = int(width), int(height)
        longest, shortest = max(w, h), min(w, h)
        # Real flat card art is ~1.586:1; 1200x630 og:image banners (1.90)
        # and wider promos are not, so cap the ratio below them.
        if longest >= 300 and 1.3 <= longest / shortest <= 1.8:
            return True
    return False


def _jsonld_card_image(soup, page_url: str) -> str | None:
    """schema.org structured data (<script type=application/ld+json>) names the
    canonical product image, which issuers keep accurate for search
    rich-results — the most reliable card-art signal when present. Discover
    hides its real card art here while the visible <img> is a lifestyle decoy."""
    import json
    for tag in soup.find_all("script", attrs={"type": "application/ld+json"}):
        try:
            data = json.loads(tag.string or tag.get_text() or "")
        except (ValueError, TypeError):
            continue
        stack = [data]
        while stack:
            node = stack.pop()
            if isinstance(node, dict):
                for key, val in node.items():
                    if key in ("image", "contentUrl", "thumbnailUrl") and isinstance(val, str):
                        if not _is_bad_asset(val) and re.search(r"card[-_]?art", val, re.I):
                            return urljoin(page_url, val)
                    elif isinstance(val, (dict, list)):
                        stack.append(val)
            elif isinstance(node, list):
                stack.extend(node)
    return None


def extract_card_image(html: str, page_url: str) -> str | None:
    """Best-effort *flat card-art* URL from a product page — no LLM involved.

    Signal strength, strongest first:
      1. An <img> served from a dedicated card-art asset path (Chase et al.
         use /card-art/ directories — the most reliable signal there is).
      2. og:image / twitter:image social-preview meta, which issuer product
         pages usually point at the card art.
      3. Any raster <img> with "card" in its alt text or src.
    Blocklisted assets (banners, card arrays, logos, angled photos, device
    marketing, SVG icons) are skipped throughout. Returns an absolute URL,
    or None — the frontend renders its stylized gradient face whenever this
    is missing, so None is always the safe fallback.
    """
    soup = BeautifulSoup(html, "html.parser")

    # 1. schema.org structured data — the canonical, machine-readable image.
    jsonld = _jsonld_card_image(soup, page_url)
    if jsonld:
        return jsonld

    # 2. Score <img> candidates (incl. lazy-load/srcset), dropping thumbnails
    #    and non-card shapes so a nav thumbnail never wins by default.
    scored: list[tuple[int, str]] = []
    for img in soup.find_all("img"):
        alt = (img.get("alt") or "").lower()
        for src in _candidate_img_urls(img):
            if _is_bad_asset(src) or not _is_card_sized(src):
                continue
            src_l = src.lower()
            score = 0
            if "card-art" in src_l or "card_art" in src_l or "cardart" in src_l:
                score += 4
            if "card" in alt:
                score += 2
            if "card" in src_l:
                score += 1
            # "..._Front_RGB.png": issuers' name for a flat card-face asset.
            if re.search(r"[_-]front[_.-]", src_l):
                score += 2
            score += _dimension_score(src)
            if score:
                scored.append((score, src))

    if scored and max(s for s, _ in scored) >= 4:
        return urljoin(page_url, max(scored, key=lambda t: t[0])[1])

    # 3. Social-preview meta as a weak fallback (also size-gated).
    for prop in ("og:image", "twitter:image"):
        tag = soup.find("meta", attrs={"property": prop}) or soup.find("meta", attrs={"name": prop})
        content = tag.get("content") if tag else None
        if content and not _is_bad_asset(content) and _is_card_sized(content):
            return urljoin(page_url, content)

    if scored:
        return urljoin(page_url, max(scored, key=lambda t: t[0])[1])

    # Nothing card-shaped found — the frontend renders its gradient face.
    return None


def catalog_card_images(html: str, hub_url: str) -> dict[str, str]:
    """{canonical product URL: flat card art} from an issuer's card listing.

    Fallback for issuers whose product pages only show an angled card photo
    (Barclays: 19 of 26 cards) while their listing tiles show the flat
    front. Each <img> is paired with the one product link in its nearest
    enclosing tile; a container linking several cards is a section, not a
    tile, and is skipped. Listing art is small (Barclays: 230x157), so the
    page's own art always wins — this only fills gaps."""
    from src.discovery import canonical_url

    soup = BeautifulSoup(html, "html.parser")
    best: dict[str, tuple[int, str]] = {}
    for img in soup.find_all("img"):
        for src in _candidate_img_urls(img):
            src_l = src.lower()
            if _is_bad_asset(src) or "lifestyle" in src_l or "hero" in src_l:
                continue
            dims = _filename_dims(src)
            if dims and not any(1.3 <= max(int(w), int(h)) / min(int(w), int(h)) <= 1.8 for w, h in dims):
                continue  # banner/lifestyle shape; size is not checked here
            score = 0
            if re.search(r"card[-_]?(front|art)|[_-]flat[_.-]", src_l):
                score += 3
            if "card" in urlsplit(src_l).path.rsplit("/", 1)[-1]:
                score += 1
            if not score:
                continue
            node, links = img, set()
            for _ in range(4):
                node = node.parent
                if node is None:
                    break
                links = {
                    canonical_url(urljoin(hub_url, a["href"]))
                    for a in node.find_all("a", href=True)
                    if not a["href"].startswith(("#", "javascript:", "mailto:", "tel:"))
                }
                if links:
                    break
            if len(links) != 1:
                continue
            link = links.pop()
            if score > best.get(link, (0, ""))[0]:
                best[link] = (score, urljoin(hub_url, src))
    return {link: src for link, (_, src) in best.items()}


def count_h1_and_ctas(html: str) -> tuple[int, int]:
    soup = BeautifulSoup(html, "html.parser")
    h1_count = len(soup.find_all("h1"))
    cta_count = len(
        soup.find_all(string=lambda s: s and "apply now" in s.lower())
    )
    return h1_count, cta_count
