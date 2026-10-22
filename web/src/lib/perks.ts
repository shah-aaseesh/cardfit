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

// Booking-portal rates ("5% on travel purchased through Chase Travel") only
// apply when booking via the issuer's own site, so they don't credit the
// general travel category — otherwise every portal card read as a travel card.
// "select travel" is issuer shorthand for portal bookings (Citi Double Cash).
const PORTAL_TIER = /(?:chase|citi|capital one|amex|american express|u\.s\. bank)\s*travel|amextravel\.com|cititravel\.com|travel portal|travel center|rewards center|\bselect travel\b/i;
// Rates that ALSO apply when booking directly still count as general travel.
const DIRECT_BOOKING = /directly (?:with|through)/i;

// Earn rates live in single digits (14x hotel co-brands are the ceiling);
// anything larger leaked in from a bonus amount or a spend cap.
const MAX_PLAUSIBLE_RATE = 20;

// "all purchases *through Chase Travel*" is a portal rate, not an
// everything-rate — the lookahead keeps qualified phrasings out of `other`.
const CATEGORY_WORDS: Record<PerkCategory, RegExp> = {
  other: /all other|other (?:eligible )?purchases|every (?:eligible )?purchase\b(?!s? (?:through|booked|made|at|with))|all (?:eligible |qualifying )?purchases(?! (?:through|booked|made|at|with))|everything\b(?! (?:through|booked))|everywhere else\b/i,
  dining: /dining|restaurant|takeout|take-out|food delivery/i,
  groceries: /grocer|supermarket|wholesale club/i,
  gas: /\bgas\b|fuel|ev charging/i,
  travel: /travel|flight|airline|airfare|hotel|resort|transit|rental car|car rental/i,
};

const CATEGORIES = Object.keys(CATEGORY_WORDS) as PerkCategory[];

/** Structured, page-backed rates from the crawler (reward_rates) — exact
 *  numbers, so no prose parsing is needed. */
function perksFromRates(card: CreditCard): (CardPerks & { mentioned: Set<PerkCategory> }) | null {
  const structured = card.facts.rewardRates;
  if (!structured?.length) return null;
  const rates: CardPerks['rates'] = {};
  // Every category the extractor named, kept or rejected — prose may only
  // fill categories outside this set, never re-add a rejected rate.
  const mentioned = new Set<PerkCategory>();
  let cashSignals = 0;
  let pointSignals = 0;
  for (const r of structured) {
    if (r.unit === 'percent') cashSignals++;
    else pointSignals++;
    if ((CATEGORIES as string[]).includes(r.category)) mentioned.add(r.category as PerkCategory);
    if ((CATEGORIES as string[]).includes(r.category) && structuredRateCounts(card, r.category as PerkCategory, r.quote || '')) {
      const cat = r.category as PerkCategory;
      rates[cat] = Math.max(rates[cat] ?? 0, r.rate);
    }
  }
  return { currency: cashSignals >= pointSignals ? 'cashback' : 'points', rates, mentioned };
}

const HOTEL_BRANDS = /hilton|marriott|bonvoy|hyatt|\bihg\b|wyndham|choice privileges/i;
// "Everything" phrasing for the base rate. "on Kohl's purchases every day"
// must NOT pass; "1.5% on all other purchases" / "2% on purchases" must.
const EVERYDAY = /all other|other (?:eligible )?purchases|everywhere|everything|every (?:eligible )?purchase\b|unlimited|\bflat\b|(?:^|\s)(?:on|for)\s+(?:all\s+|every\s+|eligible\s+|net\s+)?purchases\b/i;

/**
 * Whether a structured (AI-extracted) rate may credit its category. The
 * extractor files brand- and portal-only earn under generic categories
 * ("7.5% on Kohl's purchases" -> other, "5% on travel through Chase Travel"
 * -> travel), so its own quote is held to the same rules as parsed prose.
 * Rates without a quote are trusted as before.
 */
function structuredRateCounts(card: CreditCard, cat: PerkCategory, quote: string): boolean {
  if (!quote) return true;
  if (PORTAL_TIER.test(quote) && !DIRECT_BOOKING.test(quote)) return false;
  const scope = generalScope(card, quote);
  if (!scope.trim()) return false;
  if (cat === 'other') return EVERYDAY.test(scope);
  // The quote must actually name the category (minus any own-brand clause):
  // "5% at Pottery Barn, Williams Sonoma" was filed as travel.
  if (!CATEGORY_WORDS[cat].test(scope)) return false;
  // A hotel co-brand's "Hotels & Resorts" rate means its own hotels.
  if (cat === 'travel' && HOTEL_BRANDS.test(card.name) && /hotel|resort/i.test(scope) && !/flight|airfare|airline|rental car|car rental|transit|\btravel\b/i.test(scope)) return false;
  return true;
}

// Co-brand partners. A tier that names the card's *own* brand ("18.5X total
// points at hotels participating in Marriott Bonvoy", "2 miles on United
// purchases") only earns at that brand, so it must not credit the generic
// travel/dining category — otherwise every hotel card looked like a 14-18%
// travel card. We don't know a user's brand loyalty, so these are left out
// of the dollar estimate rather than guessed.
const CO_BRANDS = /marriott|bonvoy|hilton|hyatt|\bihg\b|wyndham|choice privileges|united|delta|southwest|american airlines|aadvantage|alaska|hawaiian|jetblue|aer lingus|british airways|iberia|air france|\bklm\b|aeroplan|frontier|spirit|disney|amazon|costco|\brei\b|l\.l\.bean|cabela|bass pro|instacart|doordash|apple|target|walmart|lowe'?s|home depot|gm\b|pottery barn|williams sonoma|west elm|gap|old navy|banana republic|athleta/gi;

/** The part of a tier that earns *outside* the card's own brand. Clauses
 *  naming the brand are dropped and the rest kept, so "2X on Delta purchases
 *  and at restaurants" still credits dining. */
function generalScope(card: CreditCard, tier: string): string {
  const own = new Set((card.name.match(CO_BRANDS) || []).map((b) => b.toLowerCase()));
  if (!own.size) return tier;
  const namesOwn = (part: string) => (part.match(CO_BRANDS) || []).some((b) => own.has(b.toLowerCase()));
  if (!namesOwn(tier)) return tier;
  // Split only where a new place begins ("…, and at restaurants", "plus on
  // gas"), never inside a noun phrase like "hotels and resorts within Hilton".
  return tier
    .split(/,|\band (?=(?:at|on|in|for|with|most|select|participating)\b)|\bplus\b/i)
    .filter((part) => !namesOwn(part))
    .join(',');
}

/** Structured rates win where present; the parsed rewards summary fills any
 *  category they're missing. The extractor drops rates whose quote it can't
 *  match on the page (styled "3X" text often fails), so e.g. Wells Fargo
 *  Autograph kept only its 1X base while its summary lists 3X categories. */
function parsePerks(card: CreditCard): CardPerks {
  const fromRates = perksFromRates(card);
  const fromProse = parseProse(card);
  if (!fromRates) return fromProse;
  const filled = Object.fromEntries(
    Object.entries(fromProse.rates).filter(([cat]) => !fromRates.mentioned.has(cat as PerkCategory)),
  ) as CardPerks['rates'];
  return { currency: fromRates.currency, rates: { ...filled, ...fromRates.rates } };
}

function parseProse(card: CreditCard): CardPerks {
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
    // Portal-only (no "directly with airlines/hotels" alternative) earns nothing general.
    if (PORTAL_TIER.test(tier) && !DIRECT_BOOKING.test(tier)) continue;
    const scope = generalScope(card, tier);
    if (!scope.trim()) continue;

    // A tier can span several categories ("5X points on dining, groceries,
    // and gas" credits all three). Rates on unrecognized categories
    // (co-brand specifics like "Alaska Airlines purchases") are skipped so
    // they never inflate a generic category.
    let matched = false;
    for (const cat of CATEGORIES) {
      if (CATEGORY_WORDS[cat].test(scope)) {
        rates[cat] = Math.max(rates[cat] ?? 0, value);
        matched = true;
      }
    }
    // "Unlimited 1.5% cash back is just the beginning" names no category:
    // an unqualified unlimited/flat rate is the everyday rate. Brand-specific
    // ("at Amazon") and thresholded ("on purchases of $5,000 or more") ones aren't.
    if (!matched && /\bunlimited\b|\bflat\b/i.test(tier) && !/\b(?:at|on|with)\s+[A-Z]/.test(tier) && !/\$[\d,]+ or more/i.test(tier)) {
      rates.other = Math.max(rates.other ?? 0, value);
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
