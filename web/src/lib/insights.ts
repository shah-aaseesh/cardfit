// Deterministic card insights — powers the Enhanced Card Profile (F2),
// Contextual Guidance (F3), and Tradeoff indicators (F5). No API calls: every
// value is computed from the ranking model's derived fields (rates, fee,
// reward system, credit band). Rates arrive cash-equivalent (points valued
// via lib/pointValues.ts in ranking.ts), so mixed
// cash-back / points math stays on one scale.

import { CreditCard } from '../types';
import { deriveRankingCard, RankingCard, parseAnnualFee } from './ranking';

// A representative "typical" monthly spend, used for reward examples and
// first-year value when the user hasn't given their own numbers.
export const TYPICAL_SPEND = { groceries: 500, dining: 400, gas: 200, travel: 300, general: 1200 };

type Cat = 'groceries' | 'dining' | 'gas' | 'travel' | 'general';
const CAT_LABEL: Record<Cat, string> = {
  groceries: 'groceries', dining: 'dining', gas: 'gas', travel: 'travel', general: 'everyday spending',
};
function rateFor(rc: RankingCard, cat: Cat): number {
  return cat === 'groceries' ? rc.groceryRate
    : cat === 'dining' ? rc.diningRate
    : cat === 'gas' ? rc.gasRate
    : cat === 'travel' ? rc.travelRate
    : rc.baseRate;
}
const unit = (rc: RankingCard) => (rc.rewardSystem === 'cash_back' ? '%' : 'x');
/** Dollar value of $1 spent at a cash-equivalent rate. */
const dollarPerRate = (rate: number) => rate / 100; // 3% → $0.03

/** The card's single strongest earning category (above its base rate). */
function topCategory(rc: RankingCard): { cat: Cat; rate: number } {
  const cats: Cat[] = ['groceries', 'dining', 'gas', 'travel'];
  let best: { cat: Cat; rate: number } = { cat: 'general', rate: rc.baseRate };
  for (const c of cats) {
    const r = rateFor(rc, c);
    if (r > best.rate) best = { cat: c, rate: r };
  }
  return best;
}

export type MonthlySpend = Partial<Record<Cat, number>>;

/** A card's estimated value, broken down so the UI can show where every
 *  dollar comes from (people trust a number they can see the parts of). */
export interface ValueEstimate {
  /** Rewards earned in a year on this spend, cash-equivalent. */
  rewards: number;
  /** Welcome bonus value (first year only). */
  bonus: number;
  annualFee: number;
  /** rewards + bonus − fee */
  firstYear: number;
  /** rewards − fee: what it's worth once the bonus is gone. */
  everyYear: number;
  /** True when computed from the user's own spending answers. */
  personalized: boolean;
}

/** Estimated yearly value of a card on the user's spend (or a typical one).
 *  Points/miles use the conservative values in lib/pointValues.ts. */
export function estimateValue(card: CreditCard, spend?: MonthlySpend): ValueEstimate {
  const rc = deriveRankingCard(card);
  const s = { ...TYPICAL_SPEND, ...(spend || {}) };
  const rewards = Math.round(
    (['groceries', 'dining', 'gas', 'travel', 'general'] as Cat[])
      .reduce((sum, c) => sum + (s[c] || 0) * 12 * dollarPerRate(rateFor(rc, c) || rc.baseRate), 0),
  );
  const bonus = Math.round(rc.welcomeBonusValue);
  const annualFee = rc.annualFee;
  return {
    rewards,
    bonus,
    annualFee,
    firstYear: rewards + bonus - annualFee,
    everyYear: rewards - annualFee,
    personalized: Boolean(spend && Object.keys(spend).length),
  };
}

export interface ApprovalDifficulty {
  label: string;   // "Easier approval" … "Excellent credit needed"
  band: RankingCard['creditBand'];
}

export interface CardInsights {
  bestFor: string[];
  notIdealFor: string[];
  approval: ApprovalDifficulty;
  rewardExamples: string[];
  redemption: string[];
  contextual: string[]; // break-even, first-year value, no-fee tradeoff
  tradeoffs: string[];
  firstYearValue: number;
}

const APPROVAL: Record<RankingCard['creditBand'], string> = {
  no_credit: 'Built for no / limited credit',
  poor: 'Easier approval (fair credit ok)',
  fair: 'Approachable — fair credit and up',
  good: 'Good credit recommended',
  excellent: 'Excellent credit recommended',
};

function estFirstYearValue(rc: RankingCard, spend = TYPICAL_SPEND): number {
  const annual =
    spend.groceries * 12 * dollarPerRate(rc.groceryRate) +
    spend.dining * 12 * dollarPerRate(rc.diningRate) +
    spend.gas * 12 * dollarPerRate(rc.gasRate) +
    spend.travel * 12 * dollarPerRate(rc.travelRate) +
    spend.general * 12 * dollarPerRate(rc.baseRate);
  return Math.round(annual + rc.welcomeBonusValue - rc.annualFee);
}

export function cardInsights(card: CreditCard): CardInsights {
  const rc = deriveRankingCard(card);
  const top = topCategory(rc);
  const fee = rc.annualFee;

  // --- Best For ---
  const bestFor: string[] = [];
  if (rc.audience === 'student') bestFor.push('Students building credit');
  if (rc.audience === 'business') bestFor.push('Business spending');
  if (top.cat !== 'general' && top.rate >= 3) bestFor.push(`Heavy ${CAT_LABEL[top.cat]} spenders`);
  if (rc.rewardSystem === 'cash_back' && rc.baseRate >= 1.5) bestFor.push('Simple flat-rate cash back');
  if (['points', 'miles', 'hotel', 'airline'].includes(rc.rewardSystem)) bestFor.push('Travelers who redeem points');
  if (rc.annualFeeTier === 'premium' || rc.perksValue > 200) bestFor.push('Perk-seekers who travel often');
  if (fee === 0) bestFor.push('Keeping costs at $0');
  if (bestFor.length === 0) bestFor.push('Everyday, no-fuss spending');

  // --- Not Ideal For ---
  const notIdealFor: string[] = [];
  if (fee >= 250) notIdealFor.push('Light or occasional spenders');
  if (['points', 'miles', 'hotel', 'airline'].includes(rc.rewardSystem)) notIdealFor.push('People who want plain cash back');
  if (rc.rewardSystem === 'cash_back' && rc.travelRate <= 1) notIdealFor.push('Frequent international travelers');
  if (rc.creditBand === 'excellent') notIdealFor.push('Thin or new credit files');
  if (notIdealFor.length === 0) notIdealFor.push('Maximizers chasing category bonuses');

  // --- Approval ---
  const approval: ApprovalDifficulty = { label: APPROVAL[rc.creditBand], band: rc.creditBand };

  // --- Reward examples: the best earning category (if any bonus) + everyday,
  // never a 0-rate category. ---
  const bonusCats = (['groceries', 'dining', 'gas', 'travel'] as Cat[])
    .map((c) => ({ c, r: rateFor(rc, c) }))
    .filter((x) => x.r > rc.baseRate)
    .sort((a, b) => b.r - a.r);
  const exampleCats: Cat[] = [];
  if (bonusCats[0]) exampleCats.push(bonusCats[0].c);
  if (rc.baseRate > 0) exampleCats.push('general');
  const rewardExamples = [...new Set(exampleCats)].slice(0, 2).map((c) => {
    const r = rateFor(rc, c);
    const monthly = TYPICAL_SPEND[c];
    const yearly = Math.round(monthly * 12 * dollarPerRate(r));
    return `$${monthly}/mo on ${CAT_LABEL[c]} earns about $${yearly}/year (${r}${unit(rc)}).`;
  });

  // --- Redemption options (by reward system) ---
  const redemption = rc.rewardSystem === 'cash_back'
    ? ['Statement credit', 'Direct deposit', 'Gift cards']
    : rc.rewardSystem === 'airline' || rc.rewardSystem === 'hotel'
    ? ['Airline/hotel bookings', 'Loyalty program transfers', 'Gift cards']
    : ['Travel portal', 'Airline & hotel transfers', 'Statement credit', 'Gift cards'];

  // --- Contextual insights (F3) ---
  const contextual: string[] = [];
  const firstYearValue = estFirstYearValue(rc);
  contextual.push(`Earns roughly $${Math.max(0, firstYearValue)} in value your first year (typical spend${rc.welcomeBonusValue > 0 ? ', incl. welcome bonus' : ''}).`);
  if (fee > 0 && top.rate > rc.baseRate) {
    // Monthly spend in the top category needed for the extra reward over a
    // $0 flat 1% card to cover the fee.
    const extraPerDollar = dollarPerRate(top.rate) - 0.01;
    if (extraPerDollar > 0) {
      const breakeven = Math.round(fee / (12 * extraPerDollar) / 10) * 10;
      contextual.push(`The $${fee} fee pays for itself at about $${breakeven}/mo on ${CAT_LABEL[top.cat]}.`);
    }
  }
  if (fee > 0) {
    const extraOverBase = dollarPerRate(top.rate) - 0.01;
    if (extraOverBase > 0) {
      const yearlySpend = Math.round(fee / extraOverBase / 100) * 100;
      contextual.push(`You come out ahead of a no-fee 1% card after about $${yearlySpend}/year of ${CAT_LABEL[top.cat]} spending.`);
    }
  }

  // --- Tradeoffs (F5) ---
  const tradeoffs: string[] = [];
  if (fee >= 95) tradeoffs.push('Higher annual fee ↔ richer rewards & perks');
  if (rc.rewardSystem !== 'cash_back') tradeoffs.push('Better travel value ↔ less straightforward than cash back');
  if (rc.creditBand === 'excellent') tradeoffs.push('Top-tier earning ↔ harder to qualify for');
  if (rc.welcomeBonusValue > 400) tradeoffs.push('Large welcome bonus ↔ higher spend requirement');
  if (fee === 0 && rc.baseRate < 2) tradeoffs.push('No annual fee ↔ lower category bonuses');
  if (tradeoffs.length === 0) tradeoffs.push('Simple and low-cost ↔ not a rewards maximizer');

  return { bestFor, notIdealFor, approval, rewardExamples, redemption, contextual, tradeoffs, firstYearValue };
}

/** Similar alternatives: same reward segment, different card, best value first. */
export function similarCards(card: CreditCard, all: CreditCard[], limit = 3): CreditCard[] {
  const rc = deriveRankingCard(card);
  const travelish = (s: string) => ['points', 'miles', 'hotel', 'airline'].includes(s);
  const similar = (c: CreditCard) => {
    const o = deriveRankingCard(c);
    if (o.audience !== rc.audience) return false; // personal↔personal, business↔business
    return o.rewardSystem === rc.rewardSystem || (travelish(o.rewardSystem) && travelish(rc.rewardSystem));
  };
  return all
    .filter((c) => c.id !== card.id && similar(c))
    .map((c) => ({ c, v: estFirstYearValue(deriveRankingCard(c)) }))
    .sort((a, b) => b.v - a.v)
    .slice(0, limit)
    .map((x) => x.c);
}
