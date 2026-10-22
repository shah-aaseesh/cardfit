// One-off cleanup of src/cards.snapshot.json applying the crawler's newer
// data-quality rules to the committed snapshot, which is what production
// actually serves while Supabase is unconfigured. A fresh crawl applies the
// same rules at the source (crawler/src/{pipeline,storage,fetch}.py); this
// just avoids waiting for one. Safe to re-run: it's idempotent.
//
//   npx tsx scripts/clean-snapshot.ts
//
// Rules (mirroring the crawler):
//   1. issuer = the provider's display_name from crawler/config/providers.yaml
//   2. tracking-pixel "card art" (Bing/Dstillery beacons) -> null
//   3. same card under several URLs -> keep one (normalized name, per provider)
//
// top_perk is left alone: the UI already shows the bonus clause when top_perk
// merely restates it (lib/rewards.ts topPerkDisplay), and a re-crawl replaces
// it with a real extracted perk.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const snapshotPath = fileURLToPath(new URL('../src/cards.snapshot.json', import.meta.url));
const providersPath = fileURLToPath(new URL('../../crawler/config/providers.yaml', import.meta.url));

type Row = Record<string, unknown> & { url: string; provider: string; card_name: string | null };
const rows: Row[] = JSON.parse(readFileSync(snapshotPath, 'utf8'));

// providers.yaml is flat enough to read `- name:` / `display_name:` pairs
// without a YAML dependency.
const displayNames: Record<string, string> = {};
let current: string | undefined;
for (const line of readFileSync(providersPath, 'utf8').split(/\r?\n/)) {
  const name = line.match(/^\s*-\s*name:\s*(\S+)/);
  if (name) current = name[1];
  const display = line.match(/^\s*display_name:\s*(.+?)\s*$/);
  if (display && current) displayNames[current] = display[1].replace(/^["']|["']$/g, '');
}

const TRACKER = /bat\.bing\.com|dstillery\.com|doubleclick\.net|google-analytics\.com|facebook\.(com|net)/i;
const cardKey = (r: Row) =>
  `${r.provider}:${(r.card_name || r.url)
    .replace(/[®™℠©]|\b(credit card|charge card|card)\b/gi, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9+]+/g, ' ')
    .trim()}`;

const stats = { issuer: 0, image: 0, dupes: 0 };

for (const r of rows) {
  const display = displayNames[r.provider];
  if (display && r.issuer !== display) {
    r.issuer = display;
    stats.issuer++;
  }
  if (typeof r.image_url === 'string' && TRACKER.test(r.image_url)) {
    r.image_url = null;
    stats.image++;
  }
}

// Keep the longer (more specific, canonical) URL for each card — same
// tie-break as crawler/src/storage.py dedupe_records.
const byKey = new Map<string, Row>();
for (const r of rows) {
  const k = cardKey(r);
  const prev = byKey.get(k);
  if (!prev) byKey.set(k, r);
  else {
    stats.dupes++;
    console.log(`dupe: keeping ${r.url.length > prev.url.length ? r.url : prev.url}`);
    if (r.url.length > prev.url.length) byKey.set(k, r);
  }
}
const cleaned = rows.filter((r) => byKey.get(cardKey(r)) === r);

writeFileSync(snapshotPath, JSON.stringify(cleaned, null, 2) + '\n');
console.log(`${rows.length} -> ${cleaned.length} cards`, stats);
