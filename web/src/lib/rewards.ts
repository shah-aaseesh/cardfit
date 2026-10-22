// Turns a rewards summary sentence into site-styled bullet points, one per
// earn tier (and per trailing sentence like a bonus clause). This is the
// client-side fallback: if the crawler later stores an LLM-generated
// `rewards_bullets` array in Supabase, the UI prefers that (see
// cardMapper + the Rewards renderers). Until then, this keeps the display
// consistent without a re-crawl.
//
// Example:
//   "Earn 5% cash back on various categories throughout the year, such as
//    gas stations, grocery stores, restaurants, and more, and 1% cash back
//    on all other purchases."
// becomes:
//   ["5% cash back on various categories throughout the year, such as gas
//     stations, grocery stores, restaurants, and more",
//    "1% cash back on all other purchases"]

// A reward *rate* token — the thing that marks the start of a new earn tier.
// Handles decimals across all forms ("1.5%", "1.5 points", "2.5x").
const RATE = String.raw`\d+(?:\.\d+)?%|\d+(?:\.\d+)?x\b|\d+(?:\.\d+)?\s+(?:points?|miles?|avios|thankyou|cash\b)`;

// Qualifier words issuers slip between the connector and the rate, e.g.
// "and unlimited 1.5 points", "plus a 5% bonus".
const QUALIFIER = String.raw`(?:unlimited\s+|an?\s+)?`;

// A tier boundary: a connector (comma / "and" / "plus" / "with") immediately
// before a (optionally qualified) rate token. Splitting here keeps mid-tier
// lists (", dining, and grocery purchases") intact while breaking between
// distinct rates ("…, and 1% cash back …", "…plus earn 2%…").
const BOUNDARY = new RegExp(
  String.raw`(?:,\s+and\s+|,\s+|\s+and\s+|\s+plus\s+(?:earn\s+)?|\s+with\s+)(?=${QUALIFIER}(?:${RATE}))`,
  'i',
);

const NO_DATA = /see issuer|not specified|^none$|^n\/a$/i;

function tidy(part: string): string {
  const t = part.trim().replace(/[.;,]+$/, '').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Restates a fact so it leads with its number — "Earn 3X Membership
 * Rewards points on travel" reads "3X Membership Rewards points on
 * travel", "Earn a $200 statement credit after…" reads "$200 statement
 * credit after…". Text without a number passes through unchanged.
 */
export function leadWithNumber(text: string): string {
  const m = text.match(/\$?\d/);
  if (!m || m.index === undefined || m.index === 0) return text;
  return text.slice(m.index).trim();
}

function concisePerk(text: string): string {
  let s = tidy(leadWithNumber(text));
  let shortened = false;
  s = s
    .replace(/^the\s+/i, '')
    .replace(/^cardmembers?\s+(?:can\s+)?(?:earn|receive|get)\s+/i, '')
    .replace(/^you\s+(?:can\s+)?(?:earn|receive|get)\s+/i, '')
    .replace(/^this card\s+(?:offers|provides|features|earns)\s+/i, '')
    .replace(/^the card\s+(?:offers|provides|features|earns)\s+/i, '')
    .replace(/^earn\s+(?:a\s+)?/i, '')
    .replace(/^receive\s+(?:a\s+)?/i, '')
    .replace(/^get\s+(?:a\s+)?/i, '')
    .replace(/^offers?\s+(?:a\s+)?/i, '')
    .replace(/^provides?\s+(?:a\s+)?/i, '')
    .replace(/\s+from account opening\b/i, '')
    .replace(/\s+after account opening\b/i, '')
    .replace(/\s+outside of REI\b/i, '')
    .replace(/\s+when you are approved(?: for the card)?\b/i, ' after approval')
    .replace(/\s+on approval\b/i, ' after approval')
    .replace(/\s+of your credit card application\b/i, '')
    .replace(/\s+of your application\b/i, '')
    .replace(/\s+instantly loaded into your Amazon account'?s Gift Card Balance\b/i, '')
    .replace(/\s+on your new Card\b/i, '')
    .replace(/\s+of Card Membership\b/i, '')
    .replace(/\s+of Card\b/i, '')
    .replace(/\s+in purchases\b/i, '')
    .replace(/after you spend\s+(\$[\d,]+)/i, 'after $1 spend')
    .replace(/after spending\s+(\$[\d,]+)/i, 'after $1 spend')
    .replace(/\s+/g, ' ')
    .replace(/[.;,]+$/, '')
    .trim();

  // Same abbreviation guard as rewardBullets: "U.S. supermarkets" isn't a sentence end.
  const sentenceEnd = s.search(/(?<!\b[A-Z])(?<!\b(?:Inc|Ltd|Corp|Co|No|etc))[.!?]\s/);
  if (sentenceEnd > 0) {
    s = s.slice(0, sentenceEnd).trim();
    shortened = true;
  }

  const clause = s.split(/\s+(?:,?\s+and\s+|,?\s+plus\s+|;|—|-)\s+/)[0]?.trim();
  if (clause && clause !== s && /\$?\d|%|x\b|points?|miles?|gift card|credit|lounge|fee|cash back/i.test(clause)) {
    s = clause;
    shortened = true;
  }

  const words = s.split(/\s+/).filter(Boolean);
  if (words.length > 15) {
    s = words.slice(0, 15).join(' ');
    s = s.replace(/\b(?:and|or|with|for|on|in|of|to|the|a|an|within|after)$/i, '').trim();
    shortened = true;
  }
  s = s.replace(/[.;,]+$/, '').trim();
  return shortened ? `${s}...` : s;
}

/**
 * A card's rewards as display bullets — the hard rule is that the rewards
 * section is always a bulleted list and every bullet leads with its rate
 * ("3X miles…", "6% cash back…"). Prefers the crawler's LLM bullets when
 * present, otherwise splits the prose; [] only when there's no real data
 * (callers then fall back to the raw text).
 */
// Issuer filler that adds length but no facts. Each only trims words; rates,
// categories and caps are never touched.
const FILLER: [RegExp, string][] = [
  [/\s+(?:is|are) just the beginning\b.*$/i, ''],
  [/,?\s+(?:and\s+)?enjoy\b.*$/i, ''],
  [/,?\s+(?:with\s+)?no limits?\b(?: to [^,]*| or category restrictions)?/i, ''],
  [/,?\s+with no expiration on points as long as[^,]*/i, ''],
  [/,\s+every time\b/i, ''],
  [/,?\s+automatically$/i, ''],
  [/\s+for every \$1 (?:you )?spen[dt]\b/i, ' per $1'],
];

function stripFiller(bullet: string): string {
  return FILLER.reduce((s, [re, sub]) => s.replace(re, sub), bullet).trim();
}

export function cardRewardBullets(facts: {
  rewards: string;
  rewardsBullets?: string[];
}): string[] {
  const bullets = (facts.rewardsBullets?.length
    ? facts.rewardsBullets
    : rewardBullets(facts.rewards)
  ).map((b) => tidy(stripFiller(leadWithNumber(b))));
  // Rate bullets only — descriptive trailers ("Points don't expire…") are
  // dropped when real rates exist. A card with no numeric rewards at all
  // (e.g. a pure low-APR card) keeps its descriptive text as the list.
  const numeric = bullets.filter((b) => /^\$?\d/.test(b));
  return numeric.length ? numeric : bullets;
}

/**
 * The Top Perk cell: show the actual benefit in a reduced, number-first form.
 * Older crawls filled top_perk with the sign-up bonus, which already has its
 * own cell right next to it — so when the perk merely restates the bonus (or
 * is a placeholder), show the card's strongest earn rate instead.
 */
export function topPerkDisplay(facts: { topPerk: string; bonus: string; rewards: string; rewardsBullets?: string[] }): string {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const perk = norm(facts.topPerk);
  const bonus = norm(facts.bonus);
  const restatesBonus = perk && bonus && (perk === bonus || perk.includes(bonus) || bonus.includes(perk));
  if (restatesBonus || !perk || /see issuer/i.test(facts.topPerk)) {
    // Booking-portal-only rates ("through Chase Travel") rank last: they're
    // the biggest numbers but the least representative.
    const portal = (b: string) => /through (?:the )?[a-z ]*travel\b/i.test(b) && !/directly with/i.test(b);
    const strongest = cardRewardBullets(facts)
      .filter((b) => /^\$?\d/.test(b))
      .sort((a, b) =>
        Number(portal(a)) - Number(portal(b)) ||
        parseFloat(b.replace(/^\$/, '')) - parseFloat(a.replace(/^\$/, '')))[0];
    if (strongest) return concisePerk(strongest);
    return restatesBonus ? concisePerk(facts.bonus) : 'See issuer site';
  }
  return concisePerk(facts.topPerk);
}

/**
 * Splits a rewards summary into bullet points. Returns [] when there's
 * nothing meaningful to show (missing / placeholder text). Returns a single
 * item when the text doesn't break into tiers — callers can then choose to
 * render it as prose instead of a one-item list.
 */
export function rewardBullets(summary?: string | null): string[] {
  if (!summary) return [];
  const s = summary.trim();
  if (!s || NO_DATA.test(s)) return [];

  const bullets: string[] = [];
  // Sentences first (a bonus/"Receive …" clause becomes its own bullet),
  // then earn tiers within each sentence. The lookbehinds keep abbreviation
  // periods intact — "U.S. supermarkets" and "Gap Inc. family of brands"
  // are not sentence boundaries.
  for (const sentence of s.split(/(?<!\b[A-Z])(?<!\b(?:Inc|Ltd|Corp|Co|No|etc))\.\s+/)) {
    const cleaned = sentence.replace(/^earn\s+(?:a\s+)?/i, '').trim();
    if (!cleaned) continue;
    for (const tier of cleaned.split(BOUNDARY)) {
      const b = tidy(tier);
      if (b) bullets.push(b);
    }
  }
  return bullets;
}
