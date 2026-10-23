import { useEffect, useMemo, useState } from 'react';
import { fetchCards, isSupabaseConfigured } from '../lib/cards';
import { SNAPSHOT_CARDS } from '../lib/snapshot';
import { CreditCard } from '../types';

interface UseCardsResult {
  /** Cards on offer today: what gets browsed, searched and recommended. */
  cards: CreditCard[];
  /** Also retired ones — for resolving cards a person says they own. */
  allCards: CreditCard[];
  loading: boolean;
  usingMockData: boolean;
}

// Reads from Supabase (populated by credit-card-crawler) when configured;
// falls back to SNAPSHOT_CARDS otherwise or if the DB is empty/unreachable, so
// the app is always usable — with real data once VITE_SUPABASE_URL /
// VITE_SUPABASE_ANON_KEY are set and the crawler has run at least once.
export function useCards(): UseCardsResult {
  const [cards, setCards] = useState<CreditCard[]>(SNAPSHOT_CARDS);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [usingMockData, setUsingMockData] = useState(!isSupabaseConfigured);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    let cancelled = false;
    setLoading(true);

    fetchCards()
      .then((fetched) => {
        if (cancelled) return;
        if (fetched.length > 0) {
          setCards(fetched);
          setUsingMockData(false);
        } else {
          console.warn('[cardscope] Supabase returned 0 cards — showing mock data until the crawler publishes some.');
          setCards(SNAPSHOT_CARDS);
          setUsingMockData(true);
        }
      })
      .catch((err) => {
        console.error('[cardscope] failed to load cards from Supabase, falling back to mock data:', err);
        if (!cancelled) {
          setCards(SNAPSHOT_CARDS);
          setUsingMockData(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const active = useMemo(() => cards.filter((c) => !c.retired), [cards]);
  return { cards: active, allCards: cards, loading, usingMockData };
}
