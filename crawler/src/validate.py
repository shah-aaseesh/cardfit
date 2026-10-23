"""
validate.py — Stage 5 of the pipeline: sanity-check extracted data before
it's allowed to overwrite the published dataset.

Philosophy: never auto-publish blind. Range violations are hard rejects.
Large day-over-day swings are soft flags — they don't block the update,
but they get logged and surfaced in the run summary so a human notices
"Chase Sapphire's APR halved overnight" before a user sees it.
"""
import logging
from dataclasses import dataclass

from src.config import settings
from src.extract import CardData
from src.storage import loose_key

logger = logging.getLogger("validate")


@dataclass
class ValidationResult:
    accepted: bool
    reason: str
    flags: list[str]


def _parse_apr_high(apr_range: str | None) -> float | None:
    """Pulls the highest number out of a string like '19.99%-28.99% Variable'."""
    import re
    if not apr_range:
        return None
    numbers = re.findall(r"(\d+\.?\d*)%", apr_range)
    return max(float(n) for n in numbers) if numbers else None


def _looks_like_catalog(name: str) -> bool:
    n = name.strip()
    if len(n) > 90:
        return True
    if n.count(",") >= 2:
        return True
    # names that enumerate several distinct cards
    if " and " in n.lower() and n.lower().count("card") >= 2:
        return True
    return False


def validate_card(new: CardData, previous: dict | None) -> ValidationResult:
    flags = []

    # --- hard rejects: data that's outright implausible ---
    if new.annual_fee is not None:
        if not (0 <= new.annual_fee <= settings.max_annual_fee):
            return ValidationResult(False, f"annual_fee {new.annual_fee} out of plausible range", flags)

    # Plausibility is about the ongoing APR; an intro "0%" shouldn't skew it.
    apr_high = _parse_apr_high(new.apr_regular or new.apr_range)
    if apr_high is not None:
        if not (settings.min_apr <= apr_high <= settings.max_apr):
            return ValidationResult(False, f"apr {apr_high}% out of plausible range", flags)

    if new.card_name is None or new.card_name.strip() == "":
        return ValidationResult(False, "missing card_name — extraction likely failed", flags)

    # Catalog/compare pages that slipped past classification tend to extract
    # a card_name that's actually a *list* of cards ("X, Y, Z, and W Credit
    # Cards"). A real product name almost never has 2+ commas or names three
    # separate cards, so treat that shape as a catalog and reject it.
    if _looks_like_catalog(new.card_name):
        return ValidationResult(False, f"card_name looks like a catalog list: {new.card_name!r}", flags)

    # low-confidence extractions still get stored, but flagged, not silently trusted
    if new.extraction_confidence < 0.5:
        flags.append(f"low extraction confidence ({new.extraction_confidence:.2f})")

    # The model stated these but its supporting quote isn't on the page.
    for field_name in new.unverified_fields:
        flags.append(f"{field_name} not backed by a quote found on the page")

    if not new.reward_rates and new.rewards_summary:
        flags.append("no page-backed reward_rates extracted (ranker falls back to parsing prose)")

    # --- soft flags: compare against previous known-good value ---
    if previous:
        prev_fee = previous.get("annual_fee")
        if prev_fee is not None and new.annual_fee is not None:
            if prev_fee > 0 and abs(new.annual_fee - prev_fee) / prev_fee > 0.5:
                flags.append(f"annual_fee changed {prev_fee} -> {new.annual_fee} (>50% swing)")

        prev_apr_high = _parse_apr_high(previous.get("apr_regular") or previous.get("apr_range"))
        if prev_apr_high and apr_high and abs(apr_high - prev_apr_high) > 8:
            flags.append(f"apr high-end changed {prev_apr_high}% -> {apr_high}% (>8pt swing)")

        # Compared without ®, "Credit Card", issuer and network words: "Slate"
        # vs "Chase Slate" or "Costco Anywhere Visa Card by Citi" are cosmetic,
        # and this flag holds the whole issuer back for review.
        if (
            previous.get("card_name") and new.card_name
            and loose_key(previous) != loose_key({"card_name": new.card_name, "url": new.url})
        ):
            flags.append(f"card_name changed '{previous['card_name']}' -> '{new.card_name}' — possible URL reuse")

    if flags:
        logger.warning(f"[{new.url}] accepted with flags: {flags}")

    return ValidationResult(True, "ok", flags)


def validate_batch(new_cards: list[CardData], previous_by_url: dict[str, dict]) -> tuple[list[dict], list[dict]]:
    """Returns (accepted_records, rejected_records). Each record is a dict
    combining the card data with its validation outcome, ready for storage/logging."""
    accepted, rejected = [], []
    for card in new_cards:
        record = card.to_dict()
        try:
            prev = previous_by_url.get(card.url)
            result = validate_card(card, prev)
        except Exception as e:
            # One malformed record (e.g. an LLM returning the wrong type
            # for a field) must not take down the whole batch — every
            # other successfully extracted card in this run would be lost
            # with it. Reject just this one and keep going.
            logger.exception(f"[{card.url}] validation crashed — rejecting this record only")
            record["validation_flags"] = []
            record["rejection_reason"] = f"validation error: {e}"
            rejected.append(record)
            continue

        record["validation_flags"] = result.flags
        if result.accepted:
            accepted.append(record)
        else:
            record["rejection_reason"] = result.reason
            rejected.append(record)
            logger.error(f"[REJECTED] {card.url}: {result.reason}")

    reject_rate = len(rejected) / len(new_cards) if new_cards else 0
    if reject_rate > settings.reject_rate_alert_threshold:
        logger.error(
            f"reject rate {reject_rate:.0%} exceeds alert threshold "
            f"({settings.reject_rate_alert_threshold:.0%}) — likely a site-wide extraction break"
        )

    return accepted, rejected
