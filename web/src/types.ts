export interface RewardRate {
  category: 'other' | 'dining' | 'groceries' | 'gas' | 'travel' | 'streaming' | 'drugstores';
  rate: number;
  unit: 'percent' | 'points' | 'miles';
  cap?: string | null;
  /** Verbatim issuer-page text the rate was extracted from. */
  quote?: string;
}

export interface CardFacts {
  annualFee: string;
  rewards: string;
  /** LLM-generated rewards bullet points, when the crawler has produced
   *  them. Absent for mock data and un-reprocessed rows; the UI falls back
   *  to splitting `rewards` client-side (see lib/rewards.ts). */
  rewardsBullets?: string[];
  bonus: string;
  /** Structured, page-backed earn rates from the crawler (reward_rates).
   *  When present, ranking uses these instead of parsing `rewards` prose. */
  rewardRates?: RewardRate[];
  /** Full APR statement (legacy / fallback). Prefer the split fields. */
  apr: string;
  /** Introductory/promotional APR, when the card has one. */
  aprIntro?: string;
  /** Ongoing/standard APR. Falls back to `apr` for un-recrawled rows. */
  aprRegular?: string;
  bestFor: string;
  creditNeeded: string;
  foreignFee: string;
  topPerk: string;
}

export type CreditKind =
  | 'travel_broad' | 'brand_travel' | 'merchant' | 'trusted_traveler'
  | 'free_night' | 'anniversary_points' | 'lounge' | 'checked_bag' | 'other';

/** An ongoing credit or perk, as the crawler extracted it (page-backed). */
export interface CardCredit {
  name: string;
  /** Dollars per period (points for anniversary_points); null if unstated. */
  amount: number | null;
  per: 'month' | 'quarter' | 'half_year' | 'year' | '4_years';
  kind: CreditKind;
  quote?: string;
}

export interface CreditCard {
  id: string;
  name: string;
  issuer: string;
  /** Clean crawler provider slug (e.g. "chase", "capital_one") — used for
   *  the provider filter; more consistent than the free-text issuer. */
  provider?: string;
  last4: string;
  gradient: string;
  /** Real card art scraped from the issuer page; the stylized gradient
   *  face renders whenever this is absent. */
  imageUrl?: string;
  /** Issuer product page, used by the apply arrow. Absent on mock data. */
  applyUrl?: string;
  /** The issuer stopped offering it (its page vanished from the crawl). Kept
   *  so people who still hold it can add it as one of their cards; never
   *  recommended or browsed. */
  retired?: boolean;
  /** Ongoing credits and perks; valued in lib/perkValues.ts. */
  credits?: CardCredit[];
  facts: CardFacts;
  tags: string[];
}
