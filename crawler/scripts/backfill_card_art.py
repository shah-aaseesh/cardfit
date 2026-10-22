"""
backfill_card_art.py — find card art for snapshot cards that have none, by
re-reading each card's live issuer page. No LLM needed: it reuses the
crawler's image picker (src/fetch.py extract_card_image), rendering
JavaScript-heavy issuers in a headless browser like the pipeline does.

Writes the found image URL into source_image_url / image_url in
web/src/cards.snapshot.json; then run scripts/cache_card_art.py, which
downloads, shape-checks, resizes and self-hosts it (rejecting anything that
isn't card-shaped).

Usage (from crawler/):
    python scripts/backfill_card_art.py && python scripts/cache_card_art.py
"""
import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.config import settings  # noqa: E402
from src.fetch import extract_card_image, fetch_page  # noqa: E402

logging.disable(logging.WARNING)
ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = ROOT / "web" / "src" / "cards.snapshot.json"


def main() -> int:
    rows = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    render = {p["name"]: bool(p.get("render_js")) for p in settings.load_providers()}
    missing = [r for r in rows if not r.get("image_url")]
    print(f"{len(missing)} cards without art; checking their live pages...")

    found = 0
    for i, row in enumerate(missing, 1):
        html, _ = fetch_page(row["url"], render=render.get(row["provider"], False))
        img = extract_card_image(html, row["url"]) if html else None
        # Skip an image the art cache already rejected for this card.
        if img and img != row.get("source_image_url"):
            row["source_image_url"] = img
            row["image_url"] = img
            found += 1
        status = "found" if row.get("image_url") else ("page failed" if not html else "none on page")
        print(f"[{i}/{len(missing)}] {row['provider']:12s} {status:12s} {row.get('card_name')}", flush=True)

    SNAPSHOT.write_text(json.dumps(rows, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"new art candidates: {found}. Next: python scripts/cache_card_art.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
