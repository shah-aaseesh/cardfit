"""
cache_card_art.py — download every card's art once and serve it from the
site itself instead of hotlinking issuer CDNs.

Why: hotlinked art came from 10 different bank servers, averaging ~1.8s per
image (Synchrony/Wells Fargo 10-13s), and 18 URLs had gone 404 after Chase
rotated assets — so card faces appeared late or not at all. Self-hosted,
resized WebP files are small, same-origin and cacheable.

What it does, for web/src/cards.snapshot.json:
  - fetches each image_url (skipping ones already cached),
  - rejects non-card shapes (same ratio rule as CardVisual.tsx),
  - resizes to 640px wide WebP -> web/public/card-art/<card id>.webp,
  - rewrites image_url to /card-art/<card id>.webp, or null when the source
    is dead/unusable (the UI then renders its gradient card face).
The original remote URL is kept in source_image_url for re-runs.

Usage (from crawler/):
    python scripts/cache_card_art.py
"""
import io
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = ROOT / "web" / "src" / "cards.snapshot.json"
OUT_DIR = ROOT / "web" / "public" / "card-art"
WIDTH = 640
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; CardFitArtCache/1.0)"}


def process(row: dict) -> tuple[str, str | None, str]:
    """Returns (card id, local url or None, status message)."""
    card_id = row["id"]
    src = (row.get("source_image_url") or row.get("image_url") or "").strip()
    out = OUT_DIR / f"{card_id}.webp"
    if out.exists():
        return card_id, f"/card-art/{out.name}", "cached"
    if not src.startswith("http"):
        return card_id, None, "no source"
    img = None
    for attempt in range(3):
        try:
            resp = requests.get(src, headers=HEADERS, timeout=20)
            if resp.status_code == 404:
                return card_id, None, "404 (issuer removed the asset)"
            resp.raise_for_status()
            img = Image.open(io.BytesIO(resp.content))
            img.load()
            break
        except Exception as e:  # throttled/reset connection, not an image, decode error
            error = e
            time.sleep(2 * (attempt + 1))  # issuers (Chase) reset bursts of requests
    if img is None:
        return card_id, None, f"fetch/decode failed: {error.__class__.__name__}"

    w, h = img.size
    if w <= h or not (1.3 <= w / h <= 1.8) or w < 200:
        return card_id, None, f"not card-shaped ({w}x{h})"

    img = img.convert("RGBA")
    if w > WIDTH:
        img = img.resize((WIDTH, round(h * WIDTH / w)), Image.LANCZOS)
    img.save(out, "WEBP", quality=82, method=6)
    return card_id, f"/card-art/{out.name}", f"saved {out.stat().st_size // 1024}KB"


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    rows = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    for row in rows:
        url = row.get("image_url")
        if url and url.startswith("http") and not row.get("source_image_url"):
            row["source_image_url"] = url

    todo = [r for r in rows if r.get("source_image_url")]
    with ThreadPoolExecutor(max_workers=3) as pool:
        results = {cid: (local, msg) for cid, local, msg in pool.map(process, todo)}

    kept = dead = 0
    for row in rows:
        if row["id"] not in results:
            continue
        local, msg = results[row["id"]]
        row["image_url"] = local
        if local:
            kept += 1
        else:
            dead += 1
            print(f"  -> gradient face: {row.get('card_name')}: {msg}")

    SNAPSHOT.write_text(json.dumps(rows, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    total_kb = sum(p.stat().st_size for p in OUT_DIR.glob("*.webp")) // 1024
    print(f"{kept} cards self-hosted ({total_kb}KB total), {dead} fell back to the gradient face")
    return 0


if __name__ == "__main__":
    sys.exit(main())
