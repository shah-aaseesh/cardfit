// Single source of truth for the filter/category vocabulary. The home
// bubble filters, the deck scoring, and the "Find Me a Card" questionnaire
// all import this so the taxonomy stays consistent.
//
// Three groups, by how they behave:
//   account  — who the card is for. Mutually exclusive: exactly one, or
//              none. Personal / Business / Student are one field, not
//              three independent toggles.
//   reward   — the strict reward currencies. Rewards (points/miles) vs
//              Cash Back: a card earns one or the other, never surfaced
//              across the line.
//   spend    — secondary spend refinements (dining / groceries / gas /
//              balance transfer) within the main results. Multi-select.
//   quality  — a property of the card itself. Premium means the card
//              charges any annual fee at all — the exact complement of
//              No Annual Fee, which is why the two conflict.
//
// `matchTags` maps a user-facing filter onto the raw tags the crawler
// produces (src/tagging.py). For the reward currencies the parsed rewards
// prose (lib/perks.ts) is authoritative; these tags are the fallback for
// cards whose prose doesn't parse. "Rewards" carries the travel-family
// tags because points/miles cards are the travel-tagged ones.

export type FilterGroup = 'account' | 'reward' | 'spend' | 'quality';

export interface FilterDef {
  id: string;
  label: string;
  group: FilterGroup;
  matchTags: string[];
}

export const FILTERS: FilterDef[] = [
  // Account — single-select field.
  { id: 'personal', label: 'Personal', group: 'account', matchTags: ['personal'] },
  { id: 'business', label: 'Business', group: 'account', matchTags: ['business'] },
  { id: 'students', label: 'Student', group: 'account', matchTags: ['students'] },

  // Reward currency — what the card pays out in.
  { id: 'rewards', label: 'Rewards', group: 'reward', matchTags: ['travel', 'flights', 'hotels', 'lounge'] },
  { id: 'cashback', label: 'Cash Back', group: 'reward', matchTags: ['cashback'] },

  // Spend — secondary refinements. Multi-select.
  { id: 'dining', label: 'Dining', group: 'spend', matchTags: ['dining'] },
  { id: 'groceries', label: 'Groceries', group: 'spend', matchTags: ['groceries'] },
  { id: 'gas', label: 'Gas', group: 'spend', matchTags: ['gas'] },
  // Travel weights travel spending, like Dining/Gas. It isn't the same as
  // Rewards: a cash-back card that earns well on travel counts too.
  { id: 'travel', label: 'Travel', group: 'spend', matchTags: ['travel', 'flights', 'hotels'] },
  { id: 'balance', label: 'Balance Transfer', group: 'spend', matchTags: ['balance'] },

  // Quality — property of the card. Premium/No Annual Fee are checked
  // against the card's real fee in ranking.ts, not these tags.
  { id: 'no-fee', label: 'No Annual Fee', group: 'quality', matchTags: ['no-fee'] },
  { id: 'premium', label: 'Premium', group: 'quality', matchTags: ['premium', 'lounge'] },
  // Checked against the card's stated foreign transaction fee in ranking.ts.
  { id: 'no-ftf', label: 'No Foreign Fee', group: 'quality', matchTags: [] },
];

export const FILTER_BY_ID: Record<string, FilterDef> = Object.fromEntries(
  FILTERS.map(f => [f.id, f])
);

const ACCOUNT_IDS = FILTERS.filter(f => f.group === 'account').map(f => f.id);
// Reward currency is single-select too: a card earns points/miles ("Rewards")
// or cash back, never both, so picking one clears the other.
const REWARD_IDS = FILTERS.filter(f => f.group === 'reward').map(f => f.id);

// Quality conflicts: Premium (annual-fee, lounge-tier) and No Annual Fee
// are contradictory.
const QUALITY_CONFLICTS: Record<string, string[]> = {
  premium: ['no-fee'],
  'no-fee': ['premium'],
};

/**
 * Toggles a filter, enforcing the group rules: selecting an account filter
 * clears any other account filter, selecting a reward currency clears the
 * other one (both single-select fields); quality conflicts are removed.
 * Goals stack freely.
 */
export function toggleFilter(active: string[], id: string): string[] {
  if (active.includes(id)) return active.filter(f => f !== id);

  const def = FILTER_BY_ID[id];
  let next = active;

  if (def?.group === 'account') {
    next = next.filter(f => !ACCOUNT_IDS.includes(f)); // one account at a time
  }
  if (def?.group === 'reward') {
    next = next.filter(f => !REWARD_IDS.includes(f)); // rewards vs cash back, never both
  }
  const conflicts = QUALITY_CONFLICTS[id] || [];
  next = next.filter(f => !conflicts.includes(f));

  return [...next, id];
}

/** Resolves a raw list of ids into a legal selection (used when filters
 *  arrive from outside the bubble UI, e.g. the questionnaire hand-off). */
export function normalizeFilters(ids: string[]): string[] {
  let result: string[] = [];
  for (const id of ids) {
    if (!FILTER_BY_ID[id]) continue;
    result = toggleFilter(result.includes(id) ? result.filter(f => f !== id) : result, id);
  }
  return result;
}

/** A card matches a filter when it carries any of that filter's tags. */
export function cardMatchesFilter(cardTags: string[] | undefined, filterId: string): boolean {
  const def = FILTER_BY_ID[filterId];
  if (!def || !cardTags) return false;
  return def.matchTags.some(t => cardTags.includes(t));
}

/** Human-readable name for a quality filter as a trailing clause ("with ___"). */
const QUALITY_PHRASE: Record<string, string> = {
  'no-fee': 'no annual fee',
  premium: 'premium perks',
  'no-ftf': 'no foreign fee',
};

/**
 * Renders the active filters as a noun phrase for the rank subtext — e.g.
 * "Personal Cash Back for Dining with no annual fee". Returns null when no
 * filters are active, so callers can fall back to a generic label.
 */
export function describeFilters(activeFilters: string[]): string | null {
  const defs = activeFilters.map(id => FILTER_BY_ID[id]).filter((d): d is FilterDef => !!d);
  if (!defs.length) return null;

  const account = defs.find(d => d.group === 'account');
  const reward = defs.find(d => d.group === 'reward');
  const spend = defs.filter(d => d.group === 'spend');
  const quality = defs.filter(d => d.group === 'quality');

  // Rewards + Travel reads as one thing: "Travel Rewards", not "Rewards for Travel".
  const travelRewards = reward?.id === 'rewards' && spend.some(d => d.id === 'travel');
  const rewardLabel = travelRewards ? 'Travel Rewards' : reward?.label;
  const spendShown = travelRewards ? spend.filter(d => d.id !== 'travel') : spend;
  let phrase = [account?.label, rewardLabel].filter(Boolean).join(' ');
  if (spendShown.length) phrase += `${phrase ? ' for ' : 'For '}${spendShown.map(d => d.label).join(' & ')}`;
  if (quality.length) {
    const qualityPhrase = quality.map(d => QUALITY_PHRASE[d.id] ?? d.label.toLowerCase()).join(' & ');
    phrase += `${phrase ? ' with ' : 'With '}${qualityPhrase}`;
  }
  return phrase || null;
}
