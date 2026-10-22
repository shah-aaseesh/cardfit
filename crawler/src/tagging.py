"""
tagging.py — post-extraction enrichment: derives the presentation-facing
fields the frontend needs (tags, best_for, top_perk) that issuer pages
don't state explicitly as structured data.

This is deliberately a plain keyword classifier, not an LLM call: it runs
on every accepted record on every run, needs to be fast/free, and the
inputs (rewards_summary, card_name, annual_fee, ...) are short enough
that keyword matching is reliable. Tag vocabulary must stay in sync with
BUBBLE_FILTERS in cardscope/src/components/BubbleFilters.tsx.
"""
import re

TAG_KEYWORDS: dict[str, list[str]] = {
    "travel": ["travel", "trip cancellation", "trip delay", "chase travel", "amex travel"],
    "dining": ["dining", "restaurant", "takeout", "food delivery"],
    "business": ["business", "employee card", "corporate"],
    "gas": ["gas station", "fuel", " gas ", "gas,"],
    "flights": ["flight", "airline", "airfare", "mileage"],
    "cashback": ["cash back", "cashback", "statement credit"],
    "groceries": ["grocery", "groceries", "supermarket"],
    "hotels": ["hotel", "resort", "lodging"],
    "lounge": ["lounge", "priority pass"],
    "students": ["student", "good grades", "building credit", "first credit card"],
    "balance": ["balance transfer"],
}

BEST_FOR_LABELS: dict[str, str] = {
    "premium": "Luxury Travel & Perks",
    "lounge": "Frequent Flyers",
    "flights": "Frequent Flyers",
    "hotels": "Hotel Loyalists",
    "travel": "Casual Travelers",
    "dining": "Foodies",
    "groceries": "Family Expenses",
    "gas": "Commuters",
    "cashback": "Maximizing Cash Back",
    "business": "Business Owners",
    "students": "Building Credit",
    "balance": "Paying Off Debt",
    "low-apr": "Paying Off Debt",
    "no-fee": "Everyday Spend",
}


def _matches_any(text: str, keywords: list[str]) -> bool:
    return any(kw in text for kw in keywords)


def _parse_apr_high(apr_range: str | None) -> float | None:
    if not apr_range:
        return None
    numbers = re.findall(r"(\d+\.?\d*)%", apr_range)
    return max(float(n) for n in numbers) if numbers else None


def infer_tags(record: dict) -> list[str]:
    """record is a dict shaped like CardData.to_dict() (see extract.py)."""
    haystack = " ".join(
        str(record.get(f) or "").lower()
        for f in ("card_name", "rewards_summary", "signup_bonus", "issuer")
    )
    haystack = f" {haystack} "

    tags: list[str] = []
    for tag, keywords in TAG_KEYWORDS.items():
        if _matches_any(haystack, keywords):
            tags.append(tag)

    annual_fee = record.get("annual_fee")
    if annual_fee is not None and annual_fee == 0:
        tags.append("no-fee")

    # Premium is the exact complement of no-fee: any confirmed annual fee.
    # (The frontend checks the real fee too — ranking.ts isPremium — so
    # this tag is presentation metadata, not the filter's source of truth.)
    if annual_fee is not None and annual_fee > 0:
        tags.append("premium")

    apr_range = record.get("apr_range") or ""
    apr_high = _parse_apr_high(apr_range)
    if "0%" in apr_range or (apr_high is not None and apr_high <= 20):
        tags.append("low-apr")

    if "business" not in tags:
        tags.append("personal")
    elif "personal" in tags:
        tags.remove("personal")  # business/personal are mutually exclusive in the UI

    # de-dupe, preserve first-seen order
    seen = set()
    deduped = []
    for t in tags:
        if t not in seen:
            seen.add(t)
            deduped.append(t)
    return deduped


def infer_best_for(tags: list[str], record: dict) -> str:
    for tag in tags:
        if tag in BEST_FOR_LABELS:
            return BEST_FOR_LABELS[tag]
    return "Everyday Spend"


def infer_top_perk(record: dict) -> str | None:
    """The extractor's own top_perk (an ongoing benefit, never the bonus).
    This used to fall back to signup_bonus, which made 122 of 162 cards show
    their welcome offer twice; the bonus already has its own field, so no
    stated perk now means None and the UI says so."""
    perk = (record.get("top_perk") or "").strip()
    return perk or None


def enrich(record: dict) -> dict:
    """Adds tags/best_for/top_perk in place and returns the record."""
    tags = infer_tags(record)
    record["tags"] = tags
    record["best_for"] = infer_best_for(tags, record)
    record["top_perk"] = infer_top_perk(record)
    return record
