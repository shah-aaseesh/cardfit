"""
extract.py — Stage 4 of the pipeline: pull structured fields out of a
confirmed single-card page.

Design: LLM extraction is the default path for every provider (handles
site redesigns gracefully). Hand-written CSS selectors are an optional,
faster/cheaper override for your highest-traffic issuers — wire them up
in SELECTOR_EXTRACTORS below as you validate them. If a selector-based
extractor is registered for a provider, it's tried first; LLM extraction
is always run as well when confidence is low or fields are missing.
"""
import logging
import re
from dataclasses import dataclass, asdict, field
from typing import Optional

from bs4 import BeautifulSoup

from src.config import settings
from src.llm_client import complete_json

logger = logging.getLogger("extract")

# Bump when the extraction prompt/output shape changes: cached records from
# an older version are re-extracted once even if the page is unchanged.
# v2 added top_perk, reward_rates and evidence quotes.
# v3 added credits (ongoing statement credits and perks) and reads 16k chars
# of page text instead of 6k: premium cards list their credits further down.
# v4 added balance_transfer_fee, and keeps one-time offers out of credits.
# v5 drops sign-up-offer and time-limited credits (see _is_one_time).
EXTRACT_VERSION = 5
EXTRACT_TEXT_CHARS = 16000

REQUIRED_FIELDS = [
    "card_name",
    "issuer",
    "annual_fee",
    "apr_range",
    "apr_intro",
    "apr_regular",
    "rewards_summary",
    "signup_bonus",
    "recommended_credit_score",
    "foreign_transaction_fee",
    "balance_transfer_fee",
]


@dataclass
class CardData:
    url: str
    provider: str
    card_name: Optional[str] = None
    issuer: Optional[str] = None
    annual_fee: Optional[float] = None
    # apr_range: the whole APR statement as one string (legacy / overall).
    # apr_intro / apr_regular split it into the two subsections the UI shows.
    apr_range: Optional[str] = None
    apr_intro: Optional[str] = None
    apr_regular: Optional[str] = None
    rewards_summary: Optional[str] = None
    signup_bonus: Optional[str] = None
    recommended_credit_score: Optional[str] = None
    foreign_transaction_fee: Optional[str] = None
    # Balance transfer fee terms as stated, e.g. "3% intro fee for 4 months,
    # then 5% (min $5)". The site ranks balance-transfer searches by dollars
    # saved, which this fee directly reduces.
    balance_transfer_fee: Optional[str] = None
    # Card art scraped from the page's <img>/og:image tags (see
    # fetch.extract_card_image) — set by the pipeline, not the LLM.
    image_url: Optional[str] = None
    # The single best ongoing benefit that is NOT the welcome bonus (lounge
    # access, travel credit, ...). Previously top_perk was derived later by
    # copying signup_bonus, so 122 of 162 cards showed the bonus twice.
    top_perk: Optional[str] = None
    # Structured earn rates — facts, not prose. Each entry:
    #   {"category": one of REWARD_CATEGORIES, "rate": 3.0,
    #    "unit": "percent"|"points"|"miles", "cap": "up to $6,000/yr" | None,
    #    "quote": verbatim page text the rate came from}
    # Only entries whose quote is actually on the page survive (see
    # _clean_reward_rates), so the ranker never scores a hallucinated rate.
    reward_rates: list[dict] = field(default_factory=list)
    # Ongoing credits and perks, for the site's "credits & perks" value. Each:
    #   {"name": "Annual travel credit", "amount": 300.0 | None,
    #    "per": one of CREDIT_PERIODS, "kind": one of CREDIT_KINDS,
    #    "quote": verbatim page text}
    # Page-backed only (see _clean_credits), like reward_rates. The site, not
    # the crawler, decides what each kind is worth (web/src/lib/perkValues.ts).
    credits: list[dict] = field(default_factory=list)
    # Fields the model stated but couldn't back with a quote found on the
    # page — kept, but flagged by validate.py for review.
    unverified_fields: list[str] = field(default_factory=list)
    extraction_method: str = "llm"
    extraction_confidence: float = 0.0

    def to_dict(self) -> dict:
        return asdict(self)


EXTRACT_PROMPT = """Extract credit card details from this webpage as JSON.

URL: {url}

Fields required (use null if not clearly stated on the page — do NOT guess or invent numbers):
- card_name: exact product name
- issuer: the bank/company issuing this card
- annual_fee: number in USD, or 0 if explicitly no annual fee, or null if unclear
- apr_range: the full APR statement as one string, e.g. "0% intro APR for 15 months, then 19.99%-28.99% Variable"
- apr_intro: ONLY the introductory/promotional APR offer, e.g. "0% for the first 15 months on purchases and balance transfers". If the page clearly states there is NO intro APR offer, return "None". Return null only if the page doesn't mention intro APR at all.
- apr_regular: ONLY the ongoing/standard APR that applies after any intro period, e.g. "19.99%-28.99% Variable". This is the normal APR; null only if not stated.
- rewards_summary: 1-2 sentence summary of the rewards structure
- signup_bonus: description of any welcome/signup bonus offer. "None" if the page clearly says there is no bonus; null if it isn't mentioned.
- recommended_credit_score: e.g. "Good/Excellent", "Excellent", or null
- foreign_transaction_fee: e.g. "None", "3%". "None" only if the page says there is no foreign transaction fee; null if it isn't mentioned.
- balance_transfer_fee: the balance transfer fee terms exactly as stated, e.g. "3% of each transfer ($5 minimum) for the first 4 months, then 5%". "None" only if the page says there is no balance transfer fee; null if it isn't mentioned.
- top_perk: the single most valuable ONGOING benefit that is NOT the welcome/signup bonus and NOT a plain earn rate (e.g. "Airport lounge access", "$300 annual travel credit", "Free checked bag"), or null if none is stated.
- reward_rates: list of every always-on earn rate, one entry per category, each {{"category": one of {categories}, "rate": number, "unit": "percent" | "points" | "miles", "cap": short spend-cap text or null, "quote": the exact sentence fragment from the page}}. Use "other" for "all other purchases". Skip rotating/quarterly or choose-your-own categories and the welcome bonus. [] if none are stated.
- credits: list of every ONGOING credit or perk the cardholder gets each period. NOT the welcome bonus or one-time offers, NOT earn rates, NOT insurance or protection coverage limits (cell phone protection, purchase protection, extended warranty, rental car or trip insurance), NOT customer reviews. Each {{"name": short name, "amount": dollar value per period as a number or null if the page gives none, "per": one of {periods}, "kind": one of {kinds}, "quote": the exact sentence fragment from the page}}. kind meanings: travel_broad = credit usable on almost any travel purchase; brand_travel = credit only at one hotel/airline brand or through a travel portal (resort, hotel collection, airline fee, portal booking credits); merchant = credit or free subscription at specific non-travel merchants or services (Uber, DoorDash/DashPass, streaming, Apple, Walmart+, Saks, Peloton); trusted_traveler = Global Entry/TSA PreCheck/CLEAR/NEXUS application fee credit; free_night = free hotel night certificate; anniversary_points = bonus points/miles awarded every year (amount = number of points); lounge = airport lounge access; checked_bag = free checked bags; other = anything else. [] if none.
- evidence: {{"annual_fee": exact page text stating the fee, "signup_bonus": exact page text of the bonus, "balance_transfer_fee": exact page text stating the balance transfer fee}} — copy verbatim from the page; null for any you can't quote.

Page content:
---
{text}
---

Respond with ONLY a JSON object matching exactly these keys, no other text:
{{"card_name": ..., "issuer": ..., "annual_fee": ..., "apr_range": ..., "apr_intro": ..., "apr_regular": ..., "rewards_summary": ..., "signup_bonus": ..., "recommended_credit_score": ..., "foreign_transaction_fee": ..., "balance_transfer_fee": ..., "top_perk": ..., "reward_rates": [...], "credits": [...], "evidence": {{...}}, "confidence": <0.0-1.0, your own confidence in this extraction>}}
"""


APR_PROMPT = """From this credit card webpage, extract ONLY the APR details as JSON.

URL: {url}

- apr_intro: the introductory/promotional APR offer exactly as stated, e.g. "0% for the first 15 months on purchases and balance transfers". If the page clearly states there is NO intro APR offer, return "None". Return null only if the page doesn't mention intro APR at all.
- apr_regular: the ongoing/standard APR that applies after any intro period, e.g. "19.24%-29.99% Variable". null if not stated.
- apr_range: the full APR statement as one string (intro + regular combined as written).

Page content:
---
{text}
---

Respond with ONLY this JSON object, no other text:
{{"apr_intro": ..., "apr_regular": ..., "apr_range": ...}}
"""


def extract_apr_only(url: str, text: str) -> dict:
    """Focused, cheap extraction of just the APR fields — used by the APR
    refresh script so we don't re-run full card extraction. Returns a dict
    with apr_intro / apr_regular / apr_range (any may be None)."""
    parsed = complete_json(
        APR_PROMPT.format(url=url, text=text[:6000]),
        model=settings.extract_model,
        max_tokens=200,
    )
    out = {k: parsed.get(k) for k in ("apr_intro", "apr_regular", "apr_range")}
    if not out.get("apr_regular"):
        out["apr_regular"] = out.get("apr_range")
    return out


REWARD_CATEGORIES = ("other", "dining", "groceries", "gas", "travel", "streaming", "drugstores")
CREDIT_KINDS = ("travel_broad", "brand_travel", "merchant", "trusted_traveler", "free_night", "anniversary_points", "lounge", "checked_bag", "other")
CREDIT_PERIODS = ("month", "quarter", "half_year", "year", "4_years")
# Largest plausible single credit per period in dollars (Platinum-tier hotel
# and travel credits top out around $600/yr); anniversary points are counts.
MAX_CREDIT_DOLLARS = 1000
MAX_ANNIVERSARY_POINTS = 100_000
_UNITS = ("percent", "points", "miles")
MAX_PLAUSIBLE_RATE = 20  # 14x hotel co-brands are the real-world ceiling
# Rates that are not always on, judged from the cap text and quote: rotating
# or activate-each-quarter categories, a category you pick, intro periods and
# dated promotions. The prompt asks the model to skip these, but it doesn't
# always (Discover's rotating 5% came through as 5% on everything). Mirrors
# NOT_ALWAYS_ON in web/src/lib/perks.ts. A bare "each quarter" is NOT here:
# "4% on the first $2,000 each quarter" is a fixed category with a cap.
NOT_ALWAYS_ON = re.compile(
    r"rotat|quarterly maximum|activate|different (?:places|categories)|of your choice|you choose|"
    r"choice categor|first \d+ days|(?:for|in) the first \d+ (?:days|months)|"
    r"through (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d|spend(?:ing)? requirement",
    re.I,
)


def _norm(text: str) -> str:
    # Keep "." for decimals ("1.5%"), but not as sentence punctuation, so a
    # quote ending "dining." still matches a page reading "dining, and".
    text = re.sub(r"\.(?!\d)", " ", (text or "").lower())
    return re.sub(r"[^a-z0-9%$.]+", " ", text).strip()


def _quote_in_page(quote, page_norm: str) -> bool:
    """True when the model's quote really appears on the page (modulo
    whitespace/punctuation/case). Short quotes prove nothing, so need 12+ chars."""
    q = _norm(quote) if isinstance(quote, str) else ""
    return len(q) >= 12 and q in page_norm


def _clean_reward_rates(raw, page_norm: str) -> tuple[list[dict], int]:
    """Keeps well-formed, plausible, page-backed rates; returns (rates, dropped)."""
    if not isinstance(raw, list):
        return [], 0
    best: dict[str, dict] = {}
    dropped = 0
    for item in raw:
        if not isinstance(item, dict):
            dropped += 1
            continue
        cat = str(item.get("category") or "").lower()
        unit = str(item.get("unit") or "").lower()
        try:
            rate = float(str(item.get("rate")).rstrip("%xX "))
        except (TypeError, ValueError):
            rate = 0.0
        if cat not in REWARD_CATEGORIES or unit not in _UNITS or not (0 < rate <= MAX_PLAUSIBLE_RATE):
            dropped += 1
            continue
        if not _quote_in_page(item.get("quote"), page_norm):
            dropped += 1
            continue
        if NOT_ALWAYS_ON.search(f"{item.get('cap') or ''} {item.get('quote') or ''}"):
            dropped += 1
            continue
        entry = {"category": cat, "rate": rate, "unit": unit, "cap": item.get("cap") or None, "quote": str(item["quote"])[:240]}
        if cat not in best or rate > best[cat]["rate"]:
            best[cat] = entry
    return list(best.values()), dropped


_TRUSTED_TRAVELER = re.compile(r"global entry|tsa|precheck|pre-check|nexus", re.I)
_AIRLINE = re.compile(r"airline|flight|airfare|incidental", re.I)


def _fix_credit_kind(name: str, kind: str) -> str:
    """Name-based corrections for kinds the model mixes up (seen with
    gpt-4o-mini): an airline fee credit filed as trusted_traveler, a flight
    credit as merchant, and CLEAR (a yearly subscription, not a 4-yearly
    application fee) as trusted_traveler."""
    if _TRUSTED_TRAVELER.search(name):
        return "trusted_traveler"
    if kind == "trusted_traveler":
        return "brand_travel" if _AIRLINE.search(name) else "merchant"
    if kind == "merchant" and (_AIRLINE.search(name) or _TRAVEL_WORD.search(name)):
        return "brand_travel"
    return kind


# Perks earned only by spending a threshold ("Every calendar year you make
# purchases of $30,000 ... companion ticket"): not something a typical
# cardholder gets, so they don't count as ongoing value.
_SPEND_GATED = re.compile(
    r"(?:make|making|after|when you)\s+(?:\w+\s+){0,3}(?:purchases|spend(?:ing)?)\s+(?:of\s+)?\$[\d,]+"
    r"|spend(?:ing)?\s+\$[\d,]+\s+or more|\$[\d,]+\s+in (?:net |eligible )?purchases (?:each|every|in a) (?:calendar |anniversary )?year",
    re.I,
)


# A portal or brand travel credit the model filed as merchant ("Annual Travel
# Credit" through Capital One Travel). travel_broad is never inferred from a
# name: only the model, reading the terms, can say a credit works anywhere.
_TRAVEL_WORD = re.compile(r"travel|hotel|stays?\b|vacation", re.I)
# One-time offers stated beside the real perks ("$300 to use on hotel
# bookings ... in your first cardholder year"): part of the welcome offer,
# not something earned every year.
_ONE_TIME = re.compile(
    r"first (?:cardholder |card ?member |account )?year|one-time|limited[- ]time|welcome (?:offer|bonus)|new (?:card ?member|cardholder)"
    # Time-limited freebies: "a year of complimentary Apple TV", "DashPass
    # ... for 12 months", "through 12/31/2027".
    r"|a year of complimentary|for (?:the first )?(?:12|twelve) months|through \d{1,2}/\d{1,2}/\d{2,4}",
    re.I,
)
# A credit quoted beside the sign-up miles ("Enjoy a $300 stays credit, plus
# earn 75K bonus miles") belongs to the welcome offer, unlike an anniversary
# bonus ("10,000 bonus miles after your anniversary each year").
_WITH_SIGNUP_BONUS = re.compile(r"bonus (?:miles|points)", re.I)
_RECURRING = re.compile(r"anniversar|each (?:account )?year|every year|annually", re.I)


def _is_one_time(text: str) -> bool:
    return bool(_ONE_TIME.search(text) or (_WITH_SIGNUP_BONUS.search(text) and not _RECURRING.search(text)))


def _clean_credits(raw, page_norm: str) -> tuple[list[dict], int]:
    """Keeps well-formed, page-backed credits; returns (credits, dropped).
    One entry per name, so a credit restated in two places counts once."""
    if not isinstance(raw, list):
        return [], 0
    kept: dict[str, dict] = {}
    dropped = 0
    for item in raw:
        if not isinstance(item, dict):
            dropped += 1
            continue
        name = str(item.get("name") or "").strip()
        kind = _fix_credit_kind(name, str(item.get("kind") or "").lower())
        per = str(item.get("per") or "").lower().replace(" ", "_").replace("-", "_")
        per = {"4_year": "4_years", "four_years": "4_years", "annual": "year", "yearly": "year", "monthly": "month"}.get(per, per)
        amount = item.get("amount")
        if amount is not None:
            try:
                amount = float(str(amount).replace("$", "").replace(",", ""))
            except ValueError:
                amount = None
        # Global Entry / TSA PreCheck renew every 4-5 years; the model often
        # files the credit as yearly, which would count it 4x.
        if kind == "trusted_traveler" and per == "year":
            per = "4_years"
        quote = str(item.get("quote") or "")
        if _is_one_time(f"{name} {quote}") or _SPEND_GATED.search(quote):
            dropped += 1
            continue
        # "$100 for Economy ... or $600 for Business": the model tends to take
        # the larger figure; the smaller one is what most people get.
        if amount is not None and kind != "anniversary_points" and re.search(r"\bor\b", quote):
            stated = [float(x.replace(",", "")) for x in re.findall(r"\$([\d,]+(?:\.\d+)?)", quote)]
            if len(set(stated)) > 1 and amount == max(stated):
                amount = min(stated)
        limit = MAX_ANNIVERSARY_POINTS if kind == "anniversary_points" else MAX_CREDIT_DOLLARS
        if not name or kind not in CREDIT_KINDS or per not in CREDIT_PERIODS:
            dropped += 1
            continue
        if amount is not None and not (0 < amount <= limit):
            dropped += 1
            continue
        if not _quote_in_page(item.get("quote"), page_norm):
            dropped += 1
            continue
        key = _norm(name)
        if key not in kept:
            kept[key] = {"name": name[:80], "amount": amount, "per": per, "kind": kind, "quote": str(item["quote"])[:240]}
    return list(kept.values()), dropped


def llm_extract(url: str, text: str, provider_name: str) -> CardData:
    try:
        parsed = complete_json(
            EXTRACT_PROMPT.format(
                url=url, text=text[:EXTRACT_TEXT_CHARS], categories=", ".join(REWARD_CATEGORIES),
                periods=", ".join(CREDIT_PERIODS), kinds=", ".join(CREDIT_KINDS),
            ),
            model=settings.extract_model,
            max_tokens=1600,
        )
        confidence = float(parsed.pop("confidence", 0.5))
        fields = {k: parsed.get(k) for k in REQUIRED_FIELDS}
        page_norm = _norm(text)

        reward_rates, dropped = _clean_reward_rates(parsed.get("reward_rates"), page_norm)
        if dropped:
            logger.info(f"[{url}] dropped {dropped} reward_rates entries (malformed or not found on page)")
        credits, dropped = _clean_credits(parsed.get("credits"), page_norm)
        if dropped:
            logger.info(f"[{url}] dropped {dropped} credits entries (malformed or not found on page)")

        # The facts the UI and ranker lean on hardest must be quotable. A
        # stated value with no matching quote is kept but marked for review.
        evidence = parsed.get("evidence") if isinstance(parsed.get("evidence"), dict) else {}
        unverified = [
            k for k in ("annual_fee", "signup_bonus", "balance_transfer_fee")
            if fields.get(k) not in (None, "None") and not _quote_in_page(evidence.get(k), page_norm)
        ]
        # Not every LLM backend honors "respond with a JSON number" as
        # strictly as Gemini's structured-output mode does — Groq models in
        # particular sometimes return "$0" or "0" as a string. Coerce here
        # so a type slip from one provider can't crash validate.py later.
        fields["annual_fee"] = _parse_dollar(fields["annual_fee"]) if isinstance(fields["annual_fee"], str) else fields["annual_fee"]
        # The ongoing APR is the subsection users always expect to see; if the
        # model split out only the intro (or nothing), fall back to the full
        # statement so apr_regular is never emptier than apr_range.
        if not fields.get("apr_regular"):
            fields["apr_regular"] = fields.get("apr_range")
        top_perk = parsed.get("top_perk")
        if not isinstance(top_perk, str) or not top_perk.strip():
            top_perk = None
        elif _norm(top_perk) == _norm(fields.get("signup_bonus") or ""):
            top_perk = None  # the bonus restated is not a perk
        return CardData(
            url=url,
            provider=provider_name,
            extraction_method="llm",
            extraction_confidence=confidence,
            top_perk=top_perk,
            reward_rates=reward_rates,
            credits=credits,
            unverified_fields=unverified,
            **fields,
        )
    except Exception as e:
        logger.warning(f"extraction failure for {url}: {e}")
        return CardData(url=url, provider=provider_name, extraction_method="llm_failed", extraction_confidence=0.0)


# --- Optional hand-written selector extractors for high-traffic issuers ---
# Fill these in and validate against live pages before trusting them in
# production. Each function takes raw HTML and returns a partial dict of
# REQUIRED_FIELDS (missing keys are fine — LLM extraction fills gaps).
#
# Example shape (Chase selectors are illustrative — verify against the
# live DOM before shipping, since these break on redesigns):
#
# def extract_chase(html: str) -> dict:
#     soup = BeautifulSoup(html, "html.parser")
#     name_el = soup.select_one("h1.card-name")
#     fee_el = soup.select_one("[data-testid='annual-fee']")
#     return {
#         "card_name": name_el.get_text(strip=True) if name_el else None,
#         "annual_fee": _parse_dollar(fee_el.get_text()) if fee_el else None,
#     }

SELECTOR_EXTRACTORS = {
    # "chase": extract_chase,
}


def _parse_dollar(text: str) -> Optional[float]:
    import re
    if not text:
        return None
    if re.search(r"\bno annual fee\b", text, re.I):
        return 0.0
    match = re.search(r"\$?([\d,]+(?:\.\d{2})?)", text)
    return float(match.group(1).replace(",", "")) if match else None


def extract_card_data(url: str, html: str, text: str, provider_name: str) -> CardData:
    """Main entry point. Tries the selector-based extractor for this
    provider (if one is registered), then always runs LLM extraction and
    fills in whichever fields the selector pass missed or left null."""
    selector_fn = SELECTOR_EXTRACTORS.get(provider_name)
    selector_data = {}
    if selector_fn:
        try:
            selector_data = selector_fn(html) or {}
        except Exception as e:
            logger.warning(f"selector extractor failed for {provider_name} ({url}): {e}")

    llm_result = llm_extract(url, text, provider_name)

    if selector_data:
        merged = llm_result.to_dict()
        for k, v in selector_data.items():
            if v is not None:
                merged[k] = v
        merged["extraction_method"] = "selector+llm"
        return CardData(**{k: merged[k] for k in [
            "url", "provider", "card_name", "issuer", "annual_fee", "apr_range",
            "apr_intro", "apr_regular",
            "rewards_summary", "signup_bonus", "recommended_credit_score",
            "foreign_transaction_fee", "top_perk", "reward_rates", "unverified_fields",
            "extraction_method", "extraction_confidence"
        ]})

    return llm_result
