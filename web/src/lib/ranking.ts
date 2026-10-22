// PRD-backed ranking engine.
//
// Source of truth:
// Product Requirements Document: Credit Card Ranking & Personalized
// Recommendation Engine, especially sections 5, 10-21, and 25.
//
// The crawler currently does not provide every structured PRD field. This
// module derives what it can from real CardScope data and explicitly stubs
// values that cannot be known from the current schema:
// - Derived: audience, rewardSystem, annualFee/tier, creditBand, product
//   level/family, category earn rates, APR intro months, bonus value
//   heuristic, simplicity/flexibility, student/business/secured flags.
// - Earn rates and bonuses are in cash-equivalent terms: points/miles are
//   converted with lib/pointValues.ts, so "14x Hilton" (≈0.5c/pt) scores as
//   ≈7%, not 14%. Structured crawler rates (facts.rewardRates) are preferred
//   over parsing prose when present.
// - Stubbed as 0/undefined because source data is absent: annualCreditsValue,
//   perksValue, userExperienceScore, employee-card features, expense tools,
//   balance transfer fee %, exact spend requirement.

import { FILTER_BY_ID } from './filters';
import { getPerks, PerkCategory } from './perks';
import { pointValue } from './pointValues';
import { CreditCard } from '../types';

export type Audience = 'personal' | 'student' | 'business';
export type RewardSystem =
  | 'cash_back'
  | 'points'
  | 'miles'
  | 'hotel'
  | 'airline'
  | 'balance_transfer'
  | 'credit_building';
export type AnnualFeeTier = 'none' | 'low' | 'mid' | 'premium';
export type CreditBand = 'no_credit' | 'poor' | 'fair' | 'good' | 'excellent';
export type ProductLevel = 'starter' | 'core' | 'premium';
export type PublicSegment = 'cash_back' | 'travel_points' | 'student' | 'balance_transfer' | 'business';
export type SoftCategory = 'gas' | 'dining' | 'groceries' | 'travel' | 'streaming' | 'drugstores' | 'balance' | 'intro_apr' | 'simplicity' | 'premium';

export interface RankingCard {
  source: CreditCard;
  id: string;
  name: string;
  issuer: string;
  active: boolean;
  audience: Audience;
  rewardSystem: RewardSystem;
  annualFee: number;
  /** False when the source fee is unparseable ("See issuer site"): we can't
   *  confirm it meets a hard cap, so it's excluded from capped results. */
  annualFeeKnown: boolean;
  annualFeeTier: AnnualFeeTier;
  creditBand: CreditBand;
  secured: boolean;
  cardFamily?: string;
  productLevel: ProductLevel;
  /** Cents one reward unit is worth: 1 for cash back, an estimate for
   *  points/miles. Every *Rate below is already multiplied by it. */
  pointValueCents: number;
  baseRate: number;
  gasRate: number;
  diningRate: number;
  groceryRate: number;
  travelRate: number;
  drugstoreRate: number;
  streamingRate: number;
  introAprMonths?: number;
  balanceTransferIntroAprMonths?: number;
  purchaseIntroAprMonths?: number;
  balanceTransferFeePct?: number;
  regularAprMin?: number;
  regularAprMax?: number;
  welcomeBonusValue: number;
  welcomeBonusSpendRequirement?: number;
  annualCreditsValue: number;
  perksValue: number;
  redemptionFlexibilityScore: number;
  simplicityScore: number;
  userExperienceScore?: number;
  availableToStudents: boolean;
  availableToNoCredit: boolean;
  requiresBusiness: boolean;
  reportsToConsumerBureaus?: boolean;
}

export interface RankingDebugOutput {
  cardId: string;
  finalScore: number;
  hardScore?: number;
  softScore?: number;
  approvalLikelihood?: number;
  annualFeeEligible: boolean;
  annualFee: number;
  userMaxAnnualFee?: number;
  duplicatePenalty?: number;
  complementarityScore?: number;
  incrementalValueScore?: number;
  exclusionReasons?: string[];
}

export interface RankedCardResult {
  card: CreditCard;
  finalScore: number;
  hardScore?: number;
  softScore?: number;
  explanation: string[];
  debug: RankingDebugOutput;
}

export interface PublicRankingContext {
  segment?: PublicSegment;
  audience?: Audience;
  annualFeeRule?: 'no_annual_fee' | 'annual_fee_allowed' | 'premium';
  creditBand?: CreditBand;
  softCategories?: SoftCategory[];
  filters?: string[];
}

export interface ExistingCardInput {
  id: string;
}

export interface UserProfile {
  hasCreditCards: boolean;
  existingCards: ExistingCardInput[];
  creditScore?: number;
  creditBand?: CreditBand;
  isStudent: boolean;
  isBusinessOwner: boolean;
  preferredRewardSystem?: 'cash_back' | 'points' | 'miles' | 'no_preference';
  maxAnnualFee: number;
  monthlySpend: {
    gas?: number;
    dining?: number;
    groceries?: number;
    travel?: number;
    general?: number;
    streaming?: number;
    drugstores?: number;
  };
  goals: {
    earnRewards?: boolean;
    buildCredit?: boolean;
    transferBalance?: boolean;
    travel?: boolean;
    simplifyFinances?: boolean;
    premiumPerks?: boolean;
  };
  carriesBalance?: boolean;
  estimatedBalanceToTransfer?: number;
}

export interface PersonalizedRecommendationResult {
  recommendations: RankedCardResult[];
  aboveAnnualFeeLimit: RankedCardResult[];
  excluded: RankingDebugOutput[];
}

export interface DeckResult {
  deck: CreditCard[];
  ranked: boolean;
  complement: boolean;
  results: RankedCardResult[];
  aboveAnnualFeeLimit?: RankedCardResult[];
}

const DECK_MAX = 15;
const PUBLIC_MIN_HARD_SCORE = 20;
const PUBLIC_CANDIDATE_POOL = 40;
const BAND_RANK: Record<CreditBand, number> = {
  no_credit: 0,
  poor: 1,
  fair: 2,
  good: 3,
  excellent: 4,
};
const PRODUCT_LEVEL_RANK: Record<ProductLevel, number> = {
  starter: 0,
  core: 1,
  premium: 2,
};
const DEFAULT_MONTHLY_SPEND = {
  gas: 200,
  dining: 350,
  groceries: 500,
  travel: 250,
  general: 1000,
  streaming: 75,
  drugstores: 75,
};
/** Typical monthly spend (~$2,600) used when the user hasn't given theirs.
 *  The value shown on each card (ValueBlock) uses the same numbers, so the
 *  ranking and the figure on screen always agree. */
export const TYPICAL_SPEND = { groceries: 500, dining: 400, gas: 200, travel: 300, general: 1200 };
export type SpendCategory = keyof typeof TYPICAL_SPEND;
export type MonthlySpend = Partial<Record<SpendCategory, number>>;
const SPEND_CATEGORIES = Object.keys(TYPICAL_SPEND) as SpendCategory[];

/** Cash-equivalent earn rate (%) for a spend category, falling back to the
 *  card's everyday rate when it has no bonus there. */
export function categoryRate(card: RankingCard, cat: SpendCategory): number {
  const r = cat === 'groceries' ? card.groceryRate
    : cat === 'dining' ? card.diningRate
    : cat === 'gas' ? card.gasRate
    : cat === 'travel' ? card.travelRate
    : 0;
  return r || card.baseRate;
}

/** Dollars of rewards a year on the given monthly spend. */
export function annualRewards(card: RankingCard, spend: MonthlySpend = {}): number {
  const s = { ...TYPICAL_SPEND, ...spend };
  return SPEND_CATEGORIES.reduce((sum, c) => sum + (s[c] || 0) * 12 * categoryRate(card, c) / 100, 0);
}

/** Extra rewards a year over the best card the user already holds in each
 *  category — what adding this card actually changes. */
export function incrementalRewards(card: RankingCard, owned: RankingCard[], spend: MonthlySpend = {}): number {
  if (!owned.length) return annualRewards(card, spend);
  const s = { ...TYPICAL_SPEND, ...spend };
  return SPEND_CATEGORIES.reduce((sum, c) => {
    const best = Math.max(0, ...owned.map((o) => categoryRate(o, c)));
    return sum + Math.max(0, categoryRate(card, c) - best) * (s[c] || 0) * 12 / 100;
  }, 0);
}

/**
 * The single number cards are ranked by and the headline shown for them:
 * average value per year over the first two years —
 *   rewards − annual fee + welcome bonus ÷ 2.
 * Spreading the one-time bonus over two years keeps a big bonus from
 * outranking a card that pays more every year after.
 */
export function rankValue(card: RankingCard, rewards: number): number {
  return rewards - card.annualFee + card.welcomeBonusValue / 2;
}

const usd = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString()}`;

const SPEND_FILTERS: Record<string, SoftCategory> = {
  dining: 'dining',
  groceries: 'groceries',
  gas: 'gas',
  balance: 'balance',
};

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

function normalize(n: number, max: number): number {
  if (!Number.isFinite(n) || max <= 0) return 0;
  return clamp((n / max) * 100);
}

export function parseAnnualFee(card: CreditCard): number {
  const text = card.facts.annualFee || '';
  if (/\$0\b|no annual fee/i.test(text)) return 0;
  const n = parseInt(text.replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

/** Whether the fee is actually stated (a "$0"/number), vs a placeholder like
 *  "See issuer site". Unknown fees can't be confirmed against a hard cap. */
export function annualFeeKnown(card: CreditCard): boolean {
  const text = card.facts.annualFee || '';
  if (/\$0\b|no annual fee/i.test(text)) return true;
  return /\d/.test(text.replace(/[^0-9]/g, ''));
}

function annualFeeTier(fee: number): AnnualFeeTier {
  if (fee <= 0) return 'none';
  if (fee <= 95) return 'low';
  if (fee <= 250) return 'mid';
  return 'premium';
}

function cardTags(card: CreditCard): string[] {
  return card.tags || [];
}

function audienceFor(card: CreditCard): Audience {
  const tags = cardTags(card);
  if (tags.includes('business')) return 'business';
  if (tags.includes('students')) return 'student';
  return 'personal';
}

function creditBandFromText(text: string | undefined, card: CreditCard, fee: number): CreditBand {
  const hay = `${text || ''} ${card.name} ${cardTags(card).join(' ')}`.toLowerCase();
  if (/no credit|limited credit|student|secured/.test(hay)) return 'no_credit';
  if (/poor|bad|rebuild/.test(hay)) return 'poor';
  if (/fair|average/.test(hay)) return 'fair';
  if (/good/.test(hay)) return 'good';
  if (/excellent/.test(hay)) return 'excellent';
  if (fee >= 250 || /reserve|platinum|infinite|elite|premium/i.test(card.name)) return 'excellent';
  if (audienceFor(card) === 'student') return 'no_credit';
  return 'good';
}

function rewardSystemFor(card: CreditCard): RewardSystem {
  const tags = cardTags(card);
  const name = card.name.toLowerCase();
  const rewards = card.facts.rewards.toLowerCase();
  if (tags.includes('balance')) return 'balance_transfer';
  if (tags.includes('students') || /secured|build credit|student/.test(`${name} ${rewards}`)) return 'credit_building';
  if (tags.includes('hotels') || /hotel|hilton|marriott|hyatt|wyndham|ihg/.test(name)) return 'hotel';
  if (tags.includes('flights') || /airline|united|delta|american airlines|southwest|miles/.test(`${name} ${rewards}`)) return 'airline';
  const currency = getPerks(card).currency;
  if (currency === 'cashback') return 'cash_back';
  if (currency === 'points') return tags.includes('travel') ? 'miles' : 'points';
  if (tags.includes('cashback')) return 'cash_back';
  if (tags.some((t) => ['travel', 'lounge'].includes(t))) return 'points';
  return 'cash_back';
}

function productLevelFor(card: CreditCard, fee: number): ProductLevel {
  const name = card.name.toLowerCase();
  if (fee >= 250 || /reserve|platinum|infinite|elite|premium|venture x/.test(name)) return 'premium';
  if (fee > 0 || /preferred|premier|gold|signature|world/.test(name)) return 'core';
  return 'starter';
}

function familyFor(card: CreditCard): string {
  const cleaned = card.name
    .toLowerCase()
    .replace(/®|™/g, '')
    .replace(/\b(credit|charge|secured|student|business|visa|mastercard|american express|card|rewards|cash back|preferred|premium|reserve|platinum|gold|silver|world elite|world|signature|infinite)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join(' ');
  return `${card.provider || card.issuer}:${cleaned || card.name.toLowerCase()}`;
}

function parseAprNumbers(text: string | undefined): number[] {
  return (text?.match(/\d+\.?\d*\s*%/g) || []).map((x) => parseFloat(x));
}

function parseIntroMonths(text: string | undefined): number | undefined {
  if (!text || !/0%|intro|introductory|promotional/i.test(text)) return undefined;
  const months = (text.match(/\d+\s*(?:months|billing cycles)/gi) || []).map((x) => parseInt(x, 10));
  return months.length ? Math.max(...months) : undefined;
}

/** True when a bonus's spend requirement ("after you spend $50,000 ... within
 *  the first 6 months") is out of reach on typical spending. Such a bonus is
 *  worth $0 to most people, so it mustn't inflate the value. */
function bonusUnreachable(text: string): boolean {
  const spend = text.match(/spend(?:ing)?\s+\$([\d,]+)/i);
  if (!spend) return false;
  const months = Number(text.match(/(\d+)\s+months?/i)?.[1] ?? 3);
  const typicalMonthly = Object.values(TYPICAL_SPEND).reduce((a, b) => a + b, 0);
  return Number(spend[1].replace(/,/g, '')) > typicalMonthly * months;
}

function bonusValue(card: CreditCard, centsPerPoint: number): number {
  const text = card.facts.bonus || '';
  if (/^(none|no\b|n\/a|not specified)/i.test(text)) return 0;
  if (bonusUnreachable(text)) return 0;
  // "60,000 bonus points after you spend $4,000": the points are the bonus
  // and the dollars are the spend requirement, so points take precedence.
  // Allow the program name in between: "175,000 Hilton Honors Bonus Points".
  const points = text.match(/(\d[\d,]{2,})\s+(?:[A-Za-z®™℠-]+\s+){0,4}?(?:points|miles|avios)\b/i);
  if (points) return Math.min(parseInt(points[1].replace(/,/g, ''), 10) * centsPerPoint / 100, 1500);
  // A dollar amount next to "spend"/"purchases" is the requirement, not the
  // bonus ("3 Free Night Awards after spending $3,000" is not a $3,000
  // bonus). Non-cash bonuses like free nights stay unvalued (conservative).
  for (const m of text.matchAll(/\$([\d,]+)/g)) {
    const before = text.slice(Math.max(0, (m.index ?? 0) - 30), m.index);
    const after = text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 20);
    if (/spend|spending|spent|purchases? of|make\s*$/i.test(before) || /^\s*(?:or more\s+)?(?:in|on|of)\s+(?:eligible\s+|net\s+)?purchases/i.test(after)) continue;
    return Math.min(parseInt(m[1].replace(/,/g, ''), 10), 1500);
  }
  return 0;
}

/** A structured crawler rate for a category the prose parser doesn't cover. */
function structuredRate(card: CreditCard, category: 'streaming' | 'drugstores'): number | undefined {
  return card.facts.rewardRates?.find((r) => r.category === category)?.rate;
}

function rate(perks: ReturnType<typeof getPerks>, cat: PerkCategory): number {
  return perks.rates[cat] ?? 0;
}

export function deriveRankingCard(card: CreditCard): RankingCard {
  const fee = parseAnnualFee(card);
  const perks = getPerks(card);
  const cpp = perks.currency === 'points' ? pointValue(`${card.name} ${card.issuer}`, card.facts.rewards).cents : 1;
  const valued = (n: number) => n * cpp;
  const aprText = `${card.facts.aprIntro || ''} ${card.facts.aprRegular || card.facts.apr || ''}`;
  const aprs = parseAprNumbers(aprText);
  const tags = cardTags(card);
  const rewardSystem = rewardSystemFor(card);
  const audience = audienceFor(card);
  const creditBand = creditBandFromText(card.facts.creditNeeded, card, fee);
  const secured = /secured/i.test(card.name) || tags.includes('secured');
  const isTravel = ['points', 'miles', 'hotel', 'airline'].includes(rewardSystem);
  const isCash = rewardSystem === 'cash_back';

  return {
    source: card,
    id: card.id,
    name: card.name,
    issuer: card.issuer,
    active: true,
    audience,
    rewardSystem,
    annualFee: fee,
    annualFeeKnown: annualFeeKnown(card),
    annualFeeTier: annualFeeTier(fee),
    creditBand,
    secured,
    cardFamily: familyFor(card),
    productLevel: productLevelFor(card, fee),
    pointValueCents: cpp,
    baseRate: valued(perks.rates.other ?? 1),
    gasRate: valued(rate(perks, 'gas')),
    diningRate: valued(rate(perks, 'dining')),
    groceryRate: valued(rate(perks, 'groceries')),
    travelRate: valued(rate(perks, 'travel')),
    drugstoreRate: valued(structuredRate(card, 'drugstores') ?? (/drugstore|pharmacy/i.test(card.facts.rewards) ? Math.max(perks.rates.other ?? 1, 3) : 0)),
    streamingRate: valued(structuredRate(card, 'streaming') ?? (/streaming/i.test(card.facts.rewards) ? Math.max(perks.rates.other ?? 1, 3) : 0)),
    introAprMonths: parseIntroMonths(aprText),
    balanceTransferIntroAprMonths: /balance transfer/i.test(aprText) ? parseIntroMonths(aprText) : undefined,
    purchaseIntroAprMonths: /purchase/i.test(aprText) ? parseIntroMonths(aprText) : undefined,
    regularAprMin: aprs.length ? Math.min(...aprs) : undefined,
    regularAprMax: aprs.length ? Math.max(...aprs) : undefined,
    welcomeBonusValue: bonusValue(card, cpp),
    annualCreditsValue: 0,
    perksValue: 0,
    redemptionFlexibilityScore: isTravel ? 75 : isCash ? 90 : 50,
    simplicityScore: clamp((fee === 0 ? 20 : 0) + (isCash ? 45 : 25) + (card.facts.rewards.length < 180 ? 25 : 15) + (audience === 'student' ? 10 : 0)),
    availableToStudents: audience === 'student',
    availableToNoCredit: audience === 'student' || secured || creditBand === 'no_credit',
    requiresBusiness: audience === 'business',
    reportsToConsumerBureaus: audience !== 'business' || /reports? to/i.test(card.facts.rewards),
  };
}

function annualRewardValue(card: RankingCard, monthlySpend = DEFAULT_MONTHLY_SPEND): number {
  const categoryValue =
    (monthlySpend.gas || 0) * 12 * (card.gasRate || card.baseRate) / 100 +
    (monthlySpend.dining || 0) * 12 * (card.diningRate || card.baseRate) / 100 +
    (monthlySpend.groceries || 0) * 12 * (card.groceryRate || card.baseRate) / 100 +
    (monthlySpend.travel || 0) * 12 * (card.travelRate || card.baseRate) / 100 +
    (monthlySpend.streaming || 0) * 12 * (card.streamingRate || card.baseRate) / 100 +
    (monthlySpend.drugstores || 0) * 12 * (card.drugstoreRate || card.baseRate) / 100 +
    (monthlySpend.general || 0) * 12 * card.baseRate / 100;
  return categoryValue;
}

function annualizedWelcomeBonus(card: RankingCard): number {
  return card.welcomeBonusValue / 3;
}

function expectedNetValue(card: RankingCard, monthlySpend = DEFAULT_MONTHLY_SPEND): number {
  return annualRewardValue(card, monthlySpend) + annualizedWelcomeBonus(card) + card.annualCreditsValue + card.perksValue - card.annualFee;
}

function computeSegmentScore(card: RankingCard, segment: PublicSegment): number {
  if (segment === 'cash_back') {
    return clamp(
      0.70 * normalize(expectedNetValue(card), 1000) +
      0.20 * card.simplicityScore +
      0.10 * card.redemptionFlexibilityScore,
    );
  }
  if (segment === 'travel_points') {
    const earning = normalize(annualRewardValue(card) + annualizedWelcomeBonus(card), 1200);
    const perks = normalize(card.perksValue + card.annualCreditsValue + (card.annualFee >= 250 ? 150 : 0), 700);
    const feeJustification = normalize(Math.max(0, expectedNetValue(card) + card.annualFee), Math.max(300, card.annualFee * 2));
    return clamp(0.35 * earning + 0.25 * card.redemptionFlexibilityScore + 0.20 * perks + 0.10 * feeJustification + 0.10 * (card.userExperienceScore ?? card.simplicityScore));
  }
  if (segment === 'student') {
    const availability = card.availableToStudents ? 100 : card.availableToNoCredit ? 70 : 20;
    const creditBuilding = computeCreditBuildingQuality(card);
    return clamp(0.40 * availability + 0.30 * card.simplicityScore + 0.20 * creditBuilding + 0.10 * normalize(annualRewardValue(card), 300));
  }
  if (segment === 'balance_transfer') {
    const months = card.balanceTransferIntroAprMonths ?? card.introAprMonths ?? 0;
    const interestSavings = normalize(months * 40 - card.annualFee, 900);
    const feeEfficiency = card.balanceTransferFeePct === undefined ? 50 : clamp(100 - card.balanceTransferFeePct * 18);
    return clamp(0.70 * interestSavings + 0.20 * normalize(months, 21) + 0.10 * feeEfficiency);
  }
  const businessValue = normalize(expectedNetValue(card, { ...DEFAULT_MONTHLY_SPEND, dining: 500, travel: 500, general: 1800 }), 1400);
  const businessCategoryFit = card.audience === 'business' ? Math.max(card.gasRate, card.diningRate, card.travelRate, card.baseRate) * 15 : 0;
  return clamp(0.55 * businessValue + 0.20 * clamp(businessCategoryFit) + 0.10 * 0 + 0.10 * 0 + 0.05 * card.simplicityScore);
}

function computeSoftScore(card: RankingCard, softCategories: SoftCategory[] = []): number {
  if (!softCategories.length) return 0;
  let score = 0;
  for (const category of softCategories) {
    if (category === 'gas') score += card.gasRate * 15;
    if (category === 'dining') score += card.diningRate * 15;
    if (category === 'groceries') score += card.groceryRate * 15;
    if (category === 'travel') score += card.travelRate * 15 + (['points', 'miles', 'hotel', 'airline'].includes(card.rewardSystem) ? 20 : 0);
    if (category === 'streaming') score += card.streamingRate * 15;
    if (category === 'drugstores') score += card.drugstoreRate * 15;
    if (category === 'balance') score += normalize(card.balanceTransferIntroAprMonths ?? card.introAprMonths ?? 0, 21);
    if (category === 'intro_apr') score += normalize(card.introAprMonths ?? 0, 21);
    if (category === 'simplicity') score += card.simplicityScore;
    if (category === 'premium') score += card.annualFeeTier === 'premium' ? 70 : 0;
  }
  return clamp(score / softCategories.length);
}

function filtersToContext(filters: string[]): PublicRankingContext {
  const softCategories = filters.map((f) => SPEND_FILTERS[f]).filter((f): f is SoftCategory => Boolean(f));
  const account = filters.find((f) => FILTER_BY_ID[f]?.group === 'account');
  // Rewards and Cash Back are mutually exclusive (enforced in lib/filters.ts'
  // toggleFilter), so check explicitly rather than trust array order.
  const reward = filters.includes('cashback') ? 'cashback' : filters.includes('rewards') ? 'rewards' : undefined;

  // Segment stays undefined unless the user expresses a reward/account/balance
  // intent. Undefined means "all reward types" — quality-only filters like
  // Premium / No Annual Fee then apply across cash-back AND travel/points cards
  // (each scored by its own reward formula) instead of being forced to
  // cash-back, which used to hide most premium travel cards.
  let segment: PublicSegment | undefined;
  if (account === 'business') segment = 'business';
  else if (account === 'students') segment = 'student';
  else if (filters.includes('balance')) segment = 'balance_transfer';
  else if (reward === 'rewards') segment = 'travel_points';
  else if (reward === 'cashback') segment = 'cash_back';

  return {
    segment,
    audience: account === 'business' ? 'business' : account === 'students' ? 'student' : 'personal',
    annualFeeRule: filters.includes('no-fee') ? 'no_annual_fee' : filters.includes('premium') ? 'premium' : undefined,
    softCategories,
    filters,
  };
}

/** The reward segment a card belongs to, used to score it when the user
 *  hasn't picked a reward type (quality-only filters like Premium). */
function cardOwnSegment(card: RankingCard): PublicSegment {
  switch (card.rewardSystem) {
    case 'points':
    case 'miles':
    case 'hotel':
    case 'airline': return 'travel_points';
    case 'balance_transfer': return 'balance_transfer';
    default: return 'cash_back';
  }
}

function publicEligible(card: RankingCard, context: PublicRankingContext): { ok: boolean; reasons: string[] } {
  // No fallback to cash_back: an undefined segment means "any reward type",
  // so the reward-system checks below simply don't apply.
  const segment = context.segment;
  const reasons: string[] = [];
  const audience = context.audience;
  if (audience === 'business' && card.audience !== 'business') reasons.push('not a business card');
  if (audience === 'student' && card.audience === 'business') reasons.push('business card excluded from student page');
  if ((!audience || audience === 'personal') && card.audience !== 'personal') reasons.push('not a general personal card');

  if (segment === 'cash_back' && card.rewardSystem !== 'cash_back') reasons.push('not a cash-back card');
  if (segment === 'travel_points' && !['points', 'miles', 'hotel', 'airline'].includes(card.rewardSystem)) reasons.push('not a points/miles travel card');
  if (segment === 'student' && !(card.audience === 'student' || card.availableToNoCredit)) reasons.push('not a student or beginner card');
  if (segment === 'balance_transfer' && card.rewardSystem !== 'balance_transfer' && !(card.balanceTransferIntroAprMonths || card.introAprMonths)) reasons.push('not a balance-transfer/intro-APR card');
  if (segment === 'business' && card.audience !== 'business') reasons.push('not a business card');

  if (context.annualFeeRule === 'no_annual_fee' && (!card.annualFeeKnown || card.annualFee !== 0)) reasons.push('annual fee above $0');
  // Premium = any card that charges an annual fee (not just the high-fee
  // tier). A $0 card — or one whose fee we can't confirm — is not premium.
  if (context.annualFeeRule === 'premium' && !(card.annualFeeKnown && card.annualFee > 0)) reasons.push('no annual fee (not premium)');
  if (context.creditBand && computeApprovalLikelihood({ hasCreditCards: true, existingCards: [], isStudent: false, isBusinessOwner: false, maxAnnualFee: 999, monthlySpend: {}, goals: {}, creditBand: context.creditBand }, card) < 25) reasons.push('below credit-band eligibility');

  return { ok: reasons.length === 0, reasons };
}

function publicExplanation(card: RankingCard, segment: PublicSegment, softCategories: SoftCategory[]): string[] {
  const lines: string[] = [];
  if (segment === 'cash_back') lines.push(`Strong estimated net cash value with a ${card.annualFee === 0 ? '$0' : `$${card.annualFee}`} annual fee.`);
  if (segment === 'travel_points') lines.push('Ranks on travel earning potential, flexibility, and fee justification.');
  if (segment === 'student') lines.push('Prioritizes accessibility, simplicity, and credit-building value.');
  if (segment === 'balance_transfer') lines.push('Prioritizes intro APR length and debt-payoff fit over rewards.');
  if (segment === 'business') lines.push('Ranks on expected business value and business-category fit.');
  if (softCategories.length) lines.push(`Matches soft preference${softCategories.length > 1 ? 's' : ''}: ${softCategories.join(', ')}.`);
  lines.push(`Requires ${card.creditBand.replace('_', ' ')} credit profile or better.`);
  return lines;
}

/** A spending-category chip (Dining, Groceries, Gas) doubles that category
 *  in the estimate, so "I spend a lot on dining" moves cards in dollars. */
function spendForChips(softCategories: SoftCategory[], business: boolean): MonthlySpend {
  const spend: MonthlySpend = business ? { ...TYPICAL_SPEND, dining: 500, travel: 500, general: 1800 } : { ...TYPICAL_SPEND };
  for (const c of softCategories) {
    if (c === 'dining' || c === 'groceries' || c === 'gas' || c === 'travel') spend[c] = (spend[c] || 0) * 2;
  }
  return spend;
}

function rankByValue(cards: CreditCard[], context: PublicRankingContext, softCategories: SoftCategory[]): RankedCardResult[] {
  const spend = spendForChips(softCategories, context.segment === 'business');
  return cards
    .map(deriveRankingCard)
    // A card whose fee the crawler couldn't read can't get an honest dollar
    // value (a missing fee would count as $0 and inflate it), so it's left out
    // of value rankings — same rule as the quiz (PRD §13.3).
    .filter((card) => card.annualFeeKnown && publicEligible(card, context).ok)
    .map((card) => {
      const rewards = annualRewards(card, spend);
      const value = rankValue(card, rewards);
      const explanation = [
        `Worth about ${usd(value)} a year on ${softCategories.length ? 'spending weighted to your picks' : 'typical spending'} — rewards minus the ${card.annualFee ? usd(card.annualFee) : '$0'} fee, with the welcome bonus spread over two years.`,
        `Requires ${card.creditBand.replace('_', ' ')} credit profile or better.`,
      ];
      return {
        card: card.source,
        finalScore: value,
        hardScore: value,
        softScore: 0,
        explanation,
        debug: {
          cardId: card.id,
          finalScore: value,
          hardScore: value,
          annualFeeEligible: context.annualFeeRule === 'no_annual_fee' ? card.annualFee === 0 : true,
          annualFee: card.annualFee,
          exclusionReasons: [],
        },
      } satisfies RankedCardResult;
    })
    .sort((a, b) => b.finalScore - a.finalScore || a.card.name.localeCompare(b.card.name))
    .slice(0, DECK_MAX);
}

export function getTop15Cards(cards: CreditCard[], context: PublicRankingContext): RankedCardResult[] {
  const resolved = { ...filtersToContext(context.filters || []), ...context };
  const explicitSegment = resolved.segment;
  const softCategories = resolved.softCategories || [];

  // Balance-transfer and student searches are about paying down debt or
  // building credit, not rewards — they keep their purpose-built scores.
  // Every other search ranks by dollars, the same figure shown on the card.
  if (explicitSegment !== 'balance_transfer' && explicitSegment !== 'student') {
    return rankByValue(cards, resolved, softCategories);
  }

  const ranked = cards
    .map(deriveRankingCard)
    .map((card) => {
      // With no chosen reward type, score each card by its own segment so
      // cash-back and travel cards compete fairly under a quality-only filter.
      const seg = explicitSegment ?? cardOwnSegment(card);
      const eligibility = publicEligible(card, resolved);
      const hardScore = eligibility.ok ? computeSegmentScore(card, seg) : 0;
      return { card, eligibility, hardScore, seg };
    })
    .filter((item) => item.eligibility.ok && item.hardScore >= PUBLIC_MIN_HARD_SCORE)
    .sort((a, b) => b.hardScore - a.hardScore)
    .slice(0, PUBLIC_CANDIDATE_POOL)
    .map((item) => {
      const softScore = computeSoftScore(item.card, softCategories);
      const hardTier = Math.floor(item.hardScore / 5);
      const finalScore = hardTier * 1000 + softScore + item.hardScore / 100;
      return {
        card: item.card.source,
        finalScore,
        hardScore: item.hardScore,
        softScore,
        explanation: publicExplanation(item.card, item.seg, softCategories),
        debug: {
          cardId: item.card.id,
          finalScore,
          hardScore: item.hardScore,
          softScore,
          annualFeeEligible: resolved.annualFeeRule === 'no_annual_fee' ? item.card.annualFee === 0 : true,
          annualFee: item.card.annualFee,
          exclusionReasons: [],
        },
      } satisfies RankedCardResult & { hardTier?: number };
    })
    .sort((a, b) =>
      Math.floor((b.hardScore || 0) / 5) - Math.floor((a.hardScore || 0) / 5) ||
      (b.softScore || 0) - (a.softScore || 0) ||
      (b.hardScore || 0) - (a.hardScore || 0) ||
      a.card.name.localeCompare(b.card.name),
    )
    .slice(0, DECK_MAX);

  return ranked;
}

function userCreditBand(user: UserProfile): CreditBand {
  if (user.creditBand) return user.creditBand;
  const score = user.creditScore;
  if (score === undefined) return 'good';
  if (score < 580) return 'poor';
  if (score < 670) return 'fair';
  if (score < 720) return 'good';
  return 'excellent';
}

export function computeApprovalLikelihood(user: UserProfile, card: RankingCard): number {
  const userBand = BAND_RANK[userCreditBand(user)];
  const cardBand = BAND_RANK[card.creditBand];
  if (userBand >= cardBand) return 100;
  if (userBand === cardBand - 1) return 45;
  return 10;
}

function approvalLanguage(score: number): string {
  if (score > 50) return 'Good fit for your stated credit profile.';
  if (score >= 25) return 'May be harder to qualify for.';
  return 'Consider improving your credit before applying.';
}

function computeAnnualFeeFit(card: RankingCard, user: UserProfile): number {
  if (card.annualFee > user.maxAnnualFee) return 0;
  if (user.maxAnnualFee <= 0) return card.annualFee === 0 ? 100 : 0;
  return clamp(100 - (card.annualFee / Math.max(user.maxAnnualFee, 1)) * 35);
}

function computeCreditBuildingQuality(card: RankingCard, user?: UserProfile): number {
  let score = 35;
  if (card.availableToNoCredit) score += 25;
  if (card.availableToStudents && user?.isStudent) score += 20;
  if (card.secured && BAND_RANK[userCreditBand(user || defaultUser())] <= BAND_RANK.fair) score += 20;
  if (card.annualFee === 0) score += 15;
  if (card.reportsToConsumerBureaus !== false) score += 10;
  return clamp(score);
}

function defaultUser(): UserProfile {
  return { hasCreditCards: false, existingCards: [], isStudent: false, isBusinessOwner: false, maxAnnualFee: 0, monthlySpend: {}, goals: {} };
}

function computeSoftSpendFit(card: RankingCard, monthlySpend: UserProfile['monthlySpend']): number {
  return normalize(annualRewardValue(card, { ...DEFAULT_MONTHLY_SPEND, ...monthlySpend }), 900);
}

function bestRate(cards: RankingCard[], category: keyof UserProfile['monthlySpend']): number {
  return Math.max(0, ...cards.map((card) => {
    if (category === 'gas') return card.gasRate || card.baseRate;
    if (category === 'dining') return card.diningRate || card.baseRate;
    if (category === 'groceries') return card.groceryRate || card.baseRate;
    if (category === 'travel') return card.travelRate || card.baseRate;
    if (category === 'streaming') return card.streamingRate || card.baseRate;
    if (category === 'drugstores') return card.drugstoreRate || card.baseRate;
    return card.baseRate;
  }));
}

function supportsExistingEcosystem(candidate: RankingCard, userCards: RankingCard[]): boolean {
  return userCards.some((card) =>
    card.issuer === candidate.issuer &&
    ['points', 'miles', 'hotel', 'airline'].includes(card.rewardSystem) &&
    ['points', 'miles', 'hotel', 'airline'].includes(candidate.rewardSystem),
  );
}

function computeComplementarity(candidate: RankingCard, userCards: RankingCard[], monthlySpend: UserProfile['monthlySpend']): number {
  let incrementalValue = 0;
  const spend = { ...DEFAULT_MONTHLY_SPEND, ...monthlySpend };
  (['gas', 'dining', 'groceries', 'travel', 'general', 'streaming', 'drugstores'] as const).forEach((category) => {
    const current = bestRate(userCards, category);
    const candidateRate =
      category === 'gas' ? candidate.gasRate || candidate.baseRate :
      category === 'dining' ? candidate.diningRate || candidate.baseRate :
      category === 'groceries' ? candidate.groceryRate || candidate.baseRate :
      category === 'travel' ? candidate.travelRate || candidate.baseRate :
      category === 'streaming' ? candidate.streamingRate || candidate.baseRate :
      category === 'drugstores' ? candidate.drugstoreRate || candidate.baseRate :
      candidate.baseRate;
    incrementalValue += Math.max(0, candidateRate - current) * (spend[category] || 0) * 12 / 100;
  });
  const ecosystemBonus = supportsExistingEcosystem(candidate, userCards) ? 10 : 0;
  const duplicatePenalty = overlappingCardPenalty(candidate, userCards);
  return clamp(normalize(incrementalValue, 500) + ecosystemBonus - duplicatePenalty);
}

function overlappingCardPenalty(candidate: RankingCard, userCards: RankingCard[]): number {
  if (!userCards.length) return 0;
  const candidateBest = Math.max(candidate.baseRate, candidate.gasRate, candidate.diningRate, candidate.groceryRate, candidate.travelRate);
  const overlap = userCards.some((owned) => {
    const ownedBest = Math.max(owned.baseRate, owned.gasRate, owned.diningRate, owned.groceryRate, owned.travelRate);
    return owned.rewardSystem === candidate.rewardSystem && candidateBest <= ownedBest + 0.25;
  });
  return overlap ? 20 : 0;
}

function computeIncrementalRewardsValue(candidate: RankingCard, userCards: RankingCard[], user: UserProfile): number {
  if (!userCards.length) return computeSoftSpendFit(candidate, user.monthlySpend);
  return computeComplementarity(candidate, userCards, user.monthlySpend);
}

function sameFamilyWeaker(candidate: RankingCard, owned: RankingCard): boolean {
  return Boolean(
    candidate.cardFamily &&
    owned.cardFamily &&
    candidate.cardFamily === owned.cardFamily &&
    PRODUCT_LEVEL_RANK[candidate.productLevel] < PRODUCT_LEVEL_RANK[owned.productLevel],
  );
}

function strictlyWorseVersion(candidate: RankingCard, owned: RankingCard): boolean {
  const ownedLooksFlat = owned.baseRate >= 2 && Math.max(owned.gasRate, owned.diningRate, owned.groceryRate, owned.travelRate) <= owned.baseRate + 0.25;
  // Weaker than a flat-rate card only if no category beats the flat rate too —
  // 6% groceries still adds value next to a 2% everything card.
  const candidateBestCategory = Math.max(candidate.gasRate, candidate.diningRate, candidate.groceryRate, candidate.travelRate);
  if (ownedLooksFlat && candidate.baseRate <= 1.5 && candidate.rewardSystem === 'cash_back' && candidateBestCategory <= owned.baseRate) return true;
  if (owned.groceryRate >= 4 && candidate.groceryRate > 0 && candidate.groceryRate <= owned.groceryRate) return true;
  return false;
}

function duplicateExclusionReason(candidate: RankingCard, userCards: RankingCard[]): string | undefined {
  for (const owned of userCards) {
    if (candidate.id === owned.id) return 'You already have this card.';
    if (sameFamilyWeaker(candidate, owned)) return 'You already have a stronger card in this card family.';
    if (strictlyWorseVersion(candidate, owned)) return 'It is weaker or too similar to a card you already own.';
  }
  return undefined;
}

function personalizedEligible(card: RankingCard, user: UserProfile, ownedCards: RankingCard[]): { ok: boolean; reasons: string[]; approval: number } {
  const reasons: string[] = [];
  if (card.annualFee > user.maxAnnualFee) reasons.push('It exceeds your selected annual fee limit.');
  if (card.audience === 'business' && !user.isBusinessOwner) reasons.push('Business card excluded unless you identify as a business owner.');
  if (card.audience === 'student' && !user.isStudent && !user.goals.buildCredit && user.hasCreditCards) reasons.push('Student-only card excluded for this profile.');
  if (!user.goals.premiumPerks && !user.goals.travel && card.productLevel === 'premium' && !user.hasCreditCards) reasons.push('Premium card suppressed for first-card profile.');
  if (user.preferredRewardSystem === 'cash_back' && card.rewardSystem !== 'cash_back' && !user.goals.transferBalance) reasons.push('Not a cash-back card.');
  if (user.preferredRewardSystem === 'points' && !['points', 'hotel', 'airline'].includes(card.rewardSystem)) reasons.push('Not a points rewards card.');
  if (user.preferredRewardSystem === 'miles' && !['miles', 'hotel', 'airline'].includes(card.rewardSystem)) reasons.push('Not a miles/travel rewards card.');
  if (user.goals.transferBalance && card.rewardSystem !== 'balance_transfer' && !(card.balanceTransferIntroAprMonths || card.introAprMonths)) reasons.push('Not a balance-transfer or intro-APR card.');
  const duplicate = user.hasCreditCards ? duplicateExclusionReason(card, ownedCards) : undefined;
  if (duplicate) reasons.push(duplicate);
  const approval = computeApprovalLikelihood(user, card);
  if (approval < 25) reasons.push('Credit profile fit is too low for the main results.');
  return { ok: reasons.length === 0, reasons, approval };
}

function personalizedExplanation(card: RankingCard, user: UserProfile, approval: number, value: number, rewards: number): string[] {
  const lines = [`Fits your $${user.maxAnnualFee} annual fee limit.`];
  if (user.hasCreditCards) {
    lines.push(rewards >= 1
      ? `Adds about ${usd(rewards)} a year in rewards on top of your current cards.`
      : 'Earns little beyond what your current cards already cover.');
  } else {
    lines.push(`Worth about ${usd(value)} a year on your spending, after the fee.`);
    if (card.annualFee === 0) lines.push('Keeps costs low for a first card.');
    if (card.availableToNoCredit || card.availableToStudents || card.secured) lines.push('Supports credit-building or beginner eligibility.');
  }
  const bestCategory = [
    ['gas', card.gasRate],
    ['dining', card.diningRate],
    ['groceries', card.groceryRate],
    ['travel', card.travelRate],
    ['all purchases', card.baseRate],
  ].sort((a, b) => Number(b[1]) - Number(a[1]))[0];
  // Rates are cash-equivalent; show the issuer's own number ("14x") and,
  // for points, the estimated value it works out to.
  const bestRate = Number(bestCategory[1]);
  const issuerRate = Math.round((bestRate / card.pointValueCents) * 10) / 10;
  if (bestRate > 1) {
    lines.push(card.pointValueCents === 1
      ? `Strong ${issuerRate}${card.rewardSystem === 'cash_back' ? '%' : 'x'} rewards on ${bestCategory[0]}.`
      : `Strong ${issuerRate}x rewards on ${bestCategory[0]} (≈${Math.round(bestRate * 10) / 10}% est. value).`);
  }
  lines.push(approvalLanguage(approval));
  return lines;
}

/** The user's monthly spend in the shared categories (unanswered ones fall
 *  back to TYPICAL_SPEND inside annualRewards). */
function userSpend(user: UserProfile): MonthlySpend {
  const { groceries, dining, gas, travel, general } = user.monthlySpend;
  return Object.fromEntries(
    Object.entries({ groceries, dining, gas, travel, general }).filter(([, v]) => typeof v === 'number'),
  ) as MonthlySpend;
}

export function recommendCards(cards: CreditCard[], user: UserProfile, limit = 5): PersonalizedRecommendationResult {
  const rankingCards = cards.map(deriveRankingCard);
  const ownedIds = new Set(user.existingCards.map((c) => c.id));
  const ownedCards = rankingCards.filter((card) => ownedIds.has(card.id));
  const excluded: RankingDebugOutput[] = [];
  const aboveAnnualFeeLimit: RankedCardResult[] = [];
  const scored: RankedCardResult[] = [];

  for (const card of rankingCards) {
    const eligibility = personalizedEligible(card, user, ownedCards);
    const annualFeeEligible = card.annualFeeKnown && card.annualFee <= user.maxAnnualFee;
    const annualFeeFit = computeAnnualFeeFit(card, user);
    const softSpendFit = computeSoftSpendFit(card, user.monthlySpend);
    const complementarity = computeComplementarity(card, ownedCards, user.monthlySpend);
    const incremental = computeIncrementalRewardsValue(card, ownedCards, user);
    const duplicatePenalty = user.hasCreditCards ? overlappingCardPenalty(card, ownedCards) : 0;
    // Score in dollars, matching the value shown on the card: what this card
    // adds over the user's wallet (or earns alone, for a first card) on their
    // own spending, minus the fee, plus half the bonus. Harder approval costs
    // $3 per point of approval likelihood below 100 (≈$165 at "may be harder",
    // ≈$270 at "unlikely"), and a first card that builds credit gets a nudge.
    const spend = userSpend(user);
    const rewards = incrementalRewards(card, ownedCards, spend);
    const value = rankValue(card, rewards);
    const approvalPenalty = (100 - eligibility.approval) * 3;
    const creditBuildingBonus = !user.hasCreditCards && user.goals.buildCredit && card.availableToNoCredit ? 75 : 0;
    const score = value - approvalPenalty + creditBuildingBonus;

    const debug: RankingDebugOutput = {
      cardId: card.id,
      finalScore: score,
      approvalLikelihood: eligibility.approval,
      annualFeeEligible,
      annualFee: card.annualFee,
      userMaxAnnualFee: user.maxAnnualFee,
      duplicatePenalty,
      complementarityScore: complementarity,
      incrementalValueScore: incremental,
      exclusionReasons: eligibility.reasons,
    };
    const result: RankedCardResult = {
      card: card.source,
      finalScore: score,
      explanation: personalizedExplanation(card, user, eligibility.approval, value, rewards),
      debug,
    };

    if (!card.annualFeeKnown) {
      // Unknown fee: can't confirm it meets the cap, and it isn't necessarily
      // "above" it either — leave it out of results entirely (PRD §13.3, §25.2).
      debug.exclusionReasons = [...eligibility.reasons, 'annual fee not confirmed'];
      excluded.push(debug);
      continue;
    }
    if (!annualFeeEligible) {
      aboveAnnualFeeLimit.push(result);
      excluded.push(debug);
      continue;
    }
    if (!eligibility.ok) {
      excluded.push(debug);
      continue;
    }
    scored.push(result);
  }

  return {
    recommendations: scored.sort((a, b) => b.finalScore - a.finalScore || a.card.name.localeCompare(b.card.name)).slice(0, limit),
    aboveAnnualFeeLimit: aboveAnnualFeeLimit.sort((a, b) => b.finalScore - a.finalScore).slice(0, 5),
    excluded,
  };
}

function shuffle(cards: CreditCard[]): CreditCard[] {
  const next = [...cards];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

export function cardQualifies(card: CreditCard, filters: string[]): boolean {
  return publicEligible(deriveRankingCard(card), filtersToContext(filters)).ok;
}

export function scoreCard(card: CreditCard, filters: string[]): number {
  const context = filtersToContext(filters);
  const rankingCard = deriveRankingCard(card);
  if (!publicEligible(rankingCard, context).ok) return 0;
  return computeSegmentScore(rankingCard, context.segment || 'cash_back') + computeSoftScore(rankingCard, context.softCategories);
}

function matchResultToUser(filters: string[], ownedIds: string[], answers?: Record<string, unknown>): UserProfile {
  const credit = typeof answers?.credit === 'string' ? answers.credit : undefined;
  const spendRaw = typeof answers?.spend === 'object' && answers.spend !== null ? answers.spend as Record<string, number> : {};
  // FindMyCard now emits real monthly dollars per category. Older/absent
  // answers fall back to a neutral default so the recommender still has signal.
  const dollars = (key: string, fallback: number) =>
    typeof spendRaw[key] === 'number' ? spendRaw[key] : fallback;
  return {
    hasCreditCards: ownedIds.length > 0,
    existingCards: ownedIds.map((id) => ({ id })),
    creditBand: credit === 'building' ? 'fair' : credit as CreditBand | undefined,
    isStudent: filters.includes('students'),
    isBusinessOwner: filters.includes('business'),
    preferredRewardSystem: filters.includes('cashback') ? 'cash_back' : filters.includes('rewards') ? 'points' : 'no_preference',
    maxAnnualFee: typeof answers?.maxFee === 'number' ? answers.maxFee : filters.includes('no-fee') ? 0 : filters.includes('premium') ? 695 : 95,
    monthlySpend: {
      gas: dollars('gas', 150),
      dining: dollars('dining', 300),
      groceries: dollars('groceries', 400),
      travel: dollars('travel', 150),
      general: dollars('general', 800),
    },
    goals: {
      earnRewards: !filters.includes('balance'),
      transferBalance: filters.includes('balance'),
      travel: filters.includes('rewards'),
      buildCredit: filters.includes('students'),
      premiumPerks: filters.includes('premium'),
    },
  };
}

export function buildDeck(
  all: CreditCard[],
  filters: string[],
  ownedIds: string[],
  matchMode: boolean,
  answers?: Record<string, unknown>,
): DeckResult {
  const owned = new Set(ownedIds);
  const pool = all.filter((card) => !owned.has(card.id));
  const wantRanked = matchMode || filters.length > 0;
  if (!wantRanked) {
    return { deck: shuffle(pool).slice(0, DECK_MAX), ranked: false, complement: false, results: [] };
  }

  if (matchMode) {
    const result = recommendCards(all, matchResultToUser(filters, ownedIds, answers), DECK_MAX);
    return {
      deck: result.recommendations.map((r) => r.card),
      ranked: true,
      complement: ownedIds.length > 0,
      results: result.recommendations,
      aboveAnnualFeeLimit: result.aboveAnnualFeeLimit,
    };
  }

  const results = getTop15Cards(pool, { filters });
  return {
    deck: results.map((r) => r.card),
    ranked: true,
    complement: ownedIds.length > 0,
    results,
  };
}
