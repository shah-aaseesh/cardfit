import rawRows from '../cards.snapshot.json';
import { mapRowToCard, CardRow } from './cardMapper';
import { CreditCard } from '../types';

// A committed snapshot of the live Supabase `cards` table (the crawler's
// output), so the repo ships with real data and the app works even when
// Supabase isn't configured or reachable. This is the fallback deck; when
// Supabase is set up, useCards prefers the live data.
//
// Regenerate after a crawl by re-exporting the active cards from Supabase
// into src/cards.snapshot.json (same columns as CardRow).
export const SNAPSHOT_CARDS: CreditCard[] = (rawRows as unknown as CardRow[]).map(mapRowToCard);

/** When the snapshot's facts were last crawled from issuer pages (shown in
 *  the footer so users can judge freshness). Update after regenerating. */
export const SNAPSHOT_AS_OF = 'October 2026';
