"""
test_offline.py — fast sanity checks that need NO network access and NO
API key. Run this first, every time, before spending any quota on a real
crawl. If anything here fails, the bug is in your logic, not a flaky
website or a rate limit.

Usage:
    python -m pytest tests/test_offline.py -v
or, without pytest installed:
    python tests/test_offline.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.config import settings
from src.discovery import coarse_filter, canonical_url
from src.validate import validate_card, _parse_apr_high
from src.extract import CardData, _parse_dollar, _clean_reward_rates, _norm
from src.fetch import _is_bad_asset
from src.storage import _slug, dedupe_records
from src.tagging import infer_top_perk


def test_providers_yaml_loads():
    providers = settings.load_providers()
    assert len(providers) > 0, "providers.yaml loaded zero enabled providers"
    for p in providers:
        assert "name" in p and "base_url" in p
        assert p.get("sitemap") or p.get("fallback_hub"), f"{p['name']} has neither sitemap nor fallback_hub"
    print(f"OK: {len(providers)} providers loaded")


def test_coarse_filter_keeps_product_pages():
    provider = {"url_include": ["/cards/"], "url_exclude": ["/compare", "/blog"]}
    urls = [
        "https://example.com/cards/sapphire-preferred",
        "https://example.com/cards/compare",
        "https://example.com/blog/how-to-choose",
        "https://example.com/cards/freedom-unlimited",
    ]
    result = coarse_filter(urls, provider)
    assert len(result) == 2, f"expected 2 URLs, got {result}"
    print("OK: coarse_filter correctly excludes catalog/blog URLs")


def test_coarse_filter_dedupes_and_caps():
    provider = {"url_include": [], "url_exclude": []}
    urls = ["https://example.com/a"] * 5
    result = coarse_filter(urls, provider)
    assert len(result) == 1, "duplicate URLs should be deduped"
    print("OK: coarse_filter dedupes")


def test_validate_rejects_implausible_fee():
    bad = CardData(url="x", provider="test", card_name="Test", annual_fee=99999, extraction_confidence=0.9)
    result = validate_card(bad, None)
    assert result.accepted is False
    print("OK: validate_card rejects implausible annual_fee")


def test_validate_rejects_implausible_apr():
    bad = CardData(url="x", provider="test", card_name="Test", apr_range="150%-200% Variable", extraction_confidence=0.9)
    result = validate_card(bad, None)
    assert result.accepted is False
    print("OK: validate_card rejects implausible APR")


def test_validate_rejects_missing_name():
    bad = CardData(url="x", provider="test", card_name=None, extraction_confidence=0.9)
    result = validate_card(bad, None)
    assert result.accepted is False
    print("OK: validate_card rejects missing card_name")


def test_validate_accepts_reasonable_card():
    good = CardData(url="x", provider="test", card_name="Test Rewards Card",
                     annual_fee=95, apr_range="19.99%-27.99% Variable", extraction_confidence=0.9)
    result = validate_card(good, None)
    assert result.accepted is True
    print("OK: validate_card accepts plausible data")


def test_validate_flags_large_swing():
    previous = {"annual_fee": 95, "apr_range": "19.99%-27.99%", "card_name": "Test Card"}
    new = CardData(url="x", provider="test", card_name="Test Card",
                    annual_fee=300, apr_range="19.99%-27.99%", extraction_confidence=0.9)
    result = validate_card(new, previous)
    assert result.accepted is True, "large swings should be flagged, not rejected"
    assert len(result.flags) > 0, "expected a flag for the 3x fee jump"
    print("OK: validate_card flags (but doesn't reject) large day-over-day swings")


def test_apr_parsing():
    assert _parse_apr_high("19.99%-27.99% Variable") == 27.99
    assert _parse_apr_high(None) is None
    assert _parse_apr_high("No stated APR") is None
    print("OK: APR parsing handles normal, null, and unparseable cases")


def test_dollar_parsing():
    assert _parse_dollar("$95") == 95.0
    assert _parse_dollar("No annual fee") == 0.0
    assert _parse_dollar("") is None
    print("OK: dollar parsing handles normal, 'no fee', and empty cases")


def test_slug_generation():
    assert _slug("Chase Sapphire Preferred® Card") == "chase-sapphire-preferred-card"
    print("OK: slug generation")


def test_canonical_url_collapses_tracking_param_order():
    # The two Wells Fargo Active Cash URLs that shipped as duplicate cards.
    a = ("https://www.wellsfargo.com/credit-cards/active-cash/terms/?FPID=0126D7I6F40000&product_code=CC"
         "&subproduct_code=AC&cx_nm=CXNAME_CSMHP_MC&sub_channel=WEB&vendor_code=WF")
    b = ("https://www.wellsfargo.com/credit-cards/active-cash/terms/?FPID=0126D7I6F40000&product_code=CC"
         "&subproduct_code=AC&sub_channel=WEB&vendor_code=WF&cx_nm=CXNAME_CSMHP_MC")
    assert canonical_url(a) == canonical_url(b)
    assert canonical_url("https://x.com/card/?utm_source=t#top") == "https://x.com/card/"
    print("OK: canonical_url collapses tracking-param variants")


def test_tracking_pixels_are_not_card_art():
    assert _is_bad_asset("https://bat.bing.com/action/0?ti=5103746&tm=gtm002&Ver=2")
    assert _is_bad_asset("https://action.dstillery.com/orbserv/nspix?adv=cl1026240")
    assert not _is_bad_asset("https://icm.aexp-static.com/acquisition/card-art/NUS000000237_480x304_straight_withname.png")
    assert not _is_bad_asset(
        "https://creditcards.chase.com/bcs/image?url=%2Fbcs%2Fimages.ctfassets.net%2Fx%2Fworld_of_hyatt_card.png&w=640"
    )
    print("OK: tracking pixels rejected, real card art kept")


def test_reward_rates_require_page_quote():
    page = _norm("Earn 3% cash back on dining. Earn 1% cash back on all other purchases.")
    rates, dropped = _clean_reward_rates([
        {"category": "dining", "rate": 3, "unit": "percent", "quote": "3% cash back on dining"},
        {"category": "other", "rate": "1%", "unit": "percent", "quote": "1% cash back on all other purchases"},
        {"category": "groceries", "rate": 6, "unit": "percent", "quote": "6% cash back at grocery stores"},  # not on page
        {"category": "gas", "rate": 50, "unit": "percent", "quote": "3% cash back on dining"},  # implausible
        {"category": "pets", "rate": 2, "unit": "percent", "quote": "3% cash back on dining"},  # unknown category
    ], page)
    assert {r["category"]: r["rate"] for r in rates} == {"dining": 3.0, "other": 1.0}
    assert dropped == 3
    print("OK: reward_rates keep only plausible, page-backed entries")


def test_validate_flags_unverified_fields():
    card = CardData(url="x", provider="test", card_name="Test Card", annual_fee=95,
                    extraction_confidence=0.9, unverified_fields=["annual_fee"])
    result = validate_card(card, None)
    assert result.accepted is True
    assert any("annual_fee not backed" in f for f in result.flags)
    print("OK: unverified fields are flagged for review")


def test_top_perk_never_falls_back_to_bonus():
    record = {"signup_bonus": "Earn 60,000 bonus points after $4,000 spend", "rewards_summary": "3x on dining."}
    assert infer_top_perk(record) is None
    assert infer_top_perk({**record, "top_perk": "Airport lounge access"}) == "Airport lounge access"
    print("OK: top_perk no longer duplicates the signup bonus")


def test_dedupe_by_normalized_name_keeps_distinct_products():
    records = [
        {"url": "https://c.com/sapphire", "card_name": "Chase Sapphire Preferred® Credit Card", "extraction_confidence": 0.9},
        {"url": "https://c.com/sapphire/preferred", "card_name": "Chase Sapphire Preferred", "extraction_confidence": 0.9},
        {"url": "https://w.com/onekey", "card_name": "One Key™ Mastercard®", "extraction_confidence": 0.9},
        {"url": "https://w.com/onekeyplus", "card_name": "One Key+™ Mastercard®", "extraction_confidence": 0.9},
    ]
    kept = {r["url"] for r in dedupe_records("test", records)}
    assert kept == {"https://c.com/sapphire/preferred", "https://w.com/onekey", "https://w.com/onekeyplus"}, kept
    print("OK: dedupe merges marketing-mark variants but keeps One Key vs One Key+")


def run_all():
    tests = [v for k, v in globals().items() if k.startswith("test_") and callable(v)]
    failed = []
    for t in tests:
        try:
            t()
        except AssertionError as e:
            print(f"FAIL: {t.__name__}: {e}")
            failed.append(t.__name__)
        except Exception as e:
            print(f"ERROR: {t.__name__}: {type(e).__name__}: {e}")
            failed.append(t.__name__)

    print(f"\n{len(tests) - len(failed)}/{len(tests)} passed")
    if failed:
        print(f"Failed: {failed}")
        sys.exit(1)


if __name__ == "__main__":
    run_all()
