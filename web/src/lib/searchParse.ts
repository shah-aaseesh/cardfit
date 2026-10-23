import { FILTERS, normalizeFilters as resolveConflicts } from './filters';

/*
  Free-text query -> filter ids, local-first:

  1. The synonym table below resolves the common phrasings instantly,
     offline, at zero API cost.
  2. Only when it finds nothing AND a parser endpoint is configured
     (VITE_SEARCH_PARSER_URL, a Supabase Edge Function proxying Groq —
     see supabase/functions/parse-search) does the query go to an LLM.
     That split is what keeps ~1k visits/day inside free tiers: most
     queries never leave the browser.

  Results are memoized per session so retyping the same query costs
  nothing either way.
*/

// A travel search means points/miles cards ranked with travel spending
// weighted: on its own, the Travel weighting still let grocery cards into a
// "travel" top 10, and Rewards alone ignored how much a card earns on travel.
const TRAVEL_WORDS = [
  'travel', 'trip', 'vacation', 'abroad', 'international',
  'flight', 'flights', 'airline', 'airlines', 'fly', 'flying', 'airfare',
  'hotel', 'hotels', 'resort', 'stays',
  'lounge', 'priority pass', 'airport lounge',
];
// Brand names (Marriott, Hyatt, Delta...) are deliberately NOT filter words:
// "marriott card" should find Marriott's cards by name (see searchTerms).


const SYNONYMS: Record<string, string[]> = {
  rewards: ['rewards', 'points', 'miles', ...TRAVEL_WORDS],
  travel: TRAVEL_WORDS,
  dining: ['dining', 'restaurant', 'food', 'takeout', 'eating out', 'eat out', 'dine', 'foodie'],
  business: ['business', 'llc', 'company', 'startup', 'freelance'],
  premium: ['premium', 'luxury', 'metal card', 'high end', 'exclusive'],
  'low-apr': ['low apr', 'low interest', '0%', 'zero percent', 'intro apr', 'no interest'],
  gas: ['gas', 'fuel', 'commute', 'commuting', 'driving'],
  cashback: ['cashback', 'cash back', 'statement credit', 'money back'],
  groceries: ['grocery', 'groceries', 'supermarket', 'food shopping'],
  'no-fee': ['no annual fee', 'no fee', 'free card', 'without a fee', 'without an annual fee', 'without fees', 'fee free', '$0 fee', 'zero fee'],
  students: ['student', 'college', 'first card', 'build credit', 'building credit', 'beginner', 'starter'],
  balance: ['balance transfer', 'debt', 'pay off', 'consolidate', 'carry a balance'],
  personal: ['personal', 'everyday', 'daily'],
  'no-ftf': ['no foreign', 'foreign transaction', 'foreign fee', 'without foreign', 'abroad fee'],
};

// Words that say nothing about which card: never searched as names.
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'for', 'with', 'and', 'or', 'of', 'to', 'in', 'on', 'my', 'me', 'i', 'want', 'need',
  'card', 'cards', 'credit', 'best', 'good', 'great', 'top', 'that', 'is', 'are', 'any', 'some', 'who',
  'visa', 'mastercard', 'signature', 'rewards', 'reward',
]);
const FILTER_WORDS = new Set(Object.values(SYNONYMS).flat().flatMap((p) => p.toLowerCase().match(/[a-z0-9$%]+/g) || []));

/** The words in a search that are neither filter words nor filler: what the
 *  person typed to name a card ("sapphire reserve", "costco", "delta").
 *  Searched against card names; reported back when nothing matches. */
export function searchTerms(query: string): string[] {
  const tokens = query.toLowerCase().match(/[a-z0-9]+/g) || [];
  return tokens.filter((t) => !STOP_WORDS.has(t) && !FILTER_WORDS.has(t));
}

const validIds = new Set(FILTERS.map(f => f.id));
const cache = new Map<string, string[]>();

export function parseLocal(query: string): string[] {
  const q = ` ${query.toLowerCase().trim()} `;
  if (q.trim().length < 3) return [];
  const hits: string[] = [];
  for (const [id, phrases] of Object.entries(SYNONYMS)) {
    if (phrases.some(p => q.includes(p))) hits.push(id);
  }
  return resolveConflicts(hits);
}

async function parseRemote(query: string, endpoint: string): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`parser endpoint ${resp.status}`);
    const data = await resp.json();
    const ids = Array.isArray(data.filters) ? data.filters.filter((f: string) => validIds.has(f)) : [];
    return resolveConflicts(ids);
  } finally {
    clearTimeout(timeout);
  }
}

export async function parseQueryToFilters(query: string): Promise<string[]> {
  const key = query.toLowerCase().trim();
  const cached = cache.get(key);
  if (cached) return cached;

  const local = parseLocal(query);
  const endpoint = import.meta.env.VITE_SEARCH_PARSER_URL as string | undefined;

  let result = local;
  // Local hit or no endpoint configured: never spend an API call.
  if (local.length === 0 && endpoint && key.length >= 6) {
    try {
      result = await parseRemote(query, endpoint);
    } catch {
      result = local; // endpoint down/slow: degrade silently to local
    }
  }

  cache.set(key, result);
  return result;
}
