// Turns a card's rewards prose into structured, comparable numbers — the
// foundation of value-based ranking. Every issuer states earn rates in the
// same handful of shapes ("6% cash back on U.S. supermarkets", "3X points
// on travel", "unlimited 2 points for every $1 spent on dining"), so we can
// extract a per-category rate table and let cards compete like-for-like:
// everything-rate against everything-rate, gas against gas.
//
// The reward *currency* also falls out of the parse: "%" / "cash back" mark
// a cash-back card, multipliers and points/miles words mark a rewards
// (points) card. Cash Back and Rewards are strict, distinct filter
// categories, and the parsed currency is what enforces that split (crawler
// tags are only a fallback for the few cards whose prose doesn't parse).

import { rewardBullets } from './rewards';
import { CreditCard } from '../types';

export type PerkCategory = 'other' | 'dining' | 'groceries' | 'gas' | 'travel';

export interface CardPerks {
  /** The card's reward currency; null when the prose didn't parse. */
  currency: 'cashback' | 'points' | null;
  /** Best earn rate seen per category (percent or points-multiple —
   *  1x point is scored on par with 1% cash back). */
  rates: Partial<Record<PerkCategory, number>>;
}

// Rate tokens, tried in order. A tier's first match wins, so headline rates
// beat trailing caps ("3% ... on up to $6,000 (then 1%)" reads as 3).
const PCT = /(\d+(?:\.\d+)?)\s*%/;
const MULT = /(\d+(?:\.\d+)?)\s*x\b/i;
const UNIT = /(\d+(?:\.\d+)?)\s+(points?|miles?|avios|thankyou|cash)\b/i;

// Signup-bonus clauses carry big point numbers that aren't earn rates.
const BONUS_TIER = /after (?:you )?spen|bonus (?:points|miles|offer)|welcome offer|statement credit after/i;

// Rotating / pick-your-own category rates ("5% in different categories each
// quarter", "3% in the category of your choice") aren't always-on earn
// rates, so they never credit a category — only a card's fixed rates
// compete. Its "all other purchases" base still parses from its own tier.
const ROTATING_TIER = /each quarter|rotat|different places|categor(?:y|ies) (?:of your choice|you choose)|choice categor/i;

// Earn rates live in single digits (14x hotel co-brands are the ceiling);
// anything larger leaked in from a bonus amount or a spend cap.
const MAX_PLAUSIBLE_RATE = 20;

// "all purchases *through Chase Travel*" is a portal rate, not an
// everything-rate — the lookahead keeps qualified phrasings out of `other`.
const CATEGORY_WORDS: Record<PerkCategory, RegExp> = {
  other: /all other|other (?:eligible )?purchases|every (?:eligible )?purchase\b(?!s? (?:through|booked|made|at|with))|all (?:eligible |qualifying )?purchases(?! (?:through|booked|made|at|with))|everything\b(?! (?:through|booked))/i,
  dining: /dining|restaurant|takeout|take-out|food delivery/i,
  groceries: /grocer|supermarket|wholesale club/i,
  gas: /\bgas\b|fuel|ev charging/i,
  travel: /travel|flight|airline|airfare|hotel|resort|transit|rental car|car rental/i,
};

const CATEGORIES = Object.keys(CATEGORY_WORDS) as PerkCategory[];

/** Structured, page-backed rates from the crawler (reward_rates) — exact
 *  numbers, so no prose parsing is needed. */
function perksFromRates(card: CreditCard): CardPerks | null {
  const structured = card.facts.rewardRates;
  if (!structured?.length) return null;
  const rates: CardPerks['rates'] = {};
  let cashSignals = 0;
  let pointSignals = 0;
  for (const r of structured) {
    if (r.unit === 'percent') cashSignals++;
    else pointSignals++;
    if ((CATEGORIES as string[]).includes(r.category)) {
      const cat = r.category as PerkCategory;
      rates[cat] = Math.max(rates[cat] ?? 0, r.rate);
    }
  }
  return { currency: cashSignals >= pointSignals ? 'cashback' : 'points', rates };
}

function parsePerks(card: CreditCard): CardPerks {
  const fromRates = perksFromRates(card);
  if (fromRates) return fromRates;

  const tiers = card.facts.rewardsBullets?.length
    ? card.facts.rewardsBullets
    : rewardBullets(card.facts.rewards);

  const rates: CardPerks['rates'] = {};
  let cashSignals = 0;
  let pointSignals = 0;

  for (const tier of tiers) {
    if (BONUS_TIER.test(tier)) continue;

    let value: number | undefined;
    const pct = tier.match(PCT);
    if (pct) {
      value = parseFloat(pct[1]);
      cashSignals++;
    } else {
      const mult = tier.match(MULT) || tier.match(UNIT);
      if (!mult) continue;
      value = parseFloat(mult[1]);
      if (/cash/i.test(mult[2] || '')) cashSignals++;
      else pointSignals++;
    }
    if (!value || value > MAX_PLAUSIBLE_RATE) continue;

    if (ROTATING_TIER.test(tier)) continue;

    // A tier can span several categories ("5X points on dining, groceries,
    // and gas" credits all three). Rates on unrecognized categories
    // (co-brand specifics like "Alaska Airlines purchases") are skipped so
    // they never inflate a generic category.
    for (const cat of CATEGORIES) {
      if (CATEGORY_WORDS[cat].test(tier)) {
        rates[cat] = Math.max(rates[cat] ?? 0, value);
      }
    }
  }

  let currency: CardPerks['currency'] = null;
  if (cashSignals || pointSignals) {
    currency = cashSignals >= pointSignals ? 'cashback' : 'points';
  } else {
    // Prose didn't parse — fall back to the crawler's tags.
    const tags = card.tags || [];
    if (tags.includes('cashback')) currency = 'cashback';
    else if (['travel', 'flights', 'hotels'].some((t) => tags.includes(t))) currency = 'points';
  }

  return { currency, rates };
}

const cache = new Map<string, CardPerks>();

/** Parsed perks for a card, memoized per card id. */
export function getPerks(card: CreditCard): CardPerks {
  let perks = cache.get(card.id);
  if (!perks) {
    perks = parsePerks(card);
    cache.set(card.id, perks);
  }
  return perks;
}
