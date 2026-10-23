import rawRows from '../src/cards.snapshot.json';
import { mapRowToCard, CardRow } from '../src/lib/cardMapper';
import {
  annualRewards,
  computeApprovalLikelihood,
  deriveRankingCard,
  getTopCards,
  recommendCards,
  RankingDebugOutput,
  rankValue,
  TYPICAL_SPEND,
  UserProfile,
} from '../src/lib/ranking';
import { estimateValue } from '../src/lib/insights';

const cards = (rawRows as CardRow[]).map(mapRowToCard);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function hasDebugShape(debug: RankingDebugOutput): boolean {
  return (
    typeof debug.cardId === 'string' &&
    typeof debug.finalScore === 'number' &&
    typeof debug.annualFeeEligible === 'boolean' &&
    typeof debug.annualFee === 'number' &&
    Array.isArray(debug.exclusionReasons)
  );
}

console.log(`Loaded ${cards.length} cards from snapshot.`);
// A sanity floor, not an exact count: a fresh crawl (crawler/scripts/
// export_snapshot.py) legitimately changes how many cards there are.
assert(cards.length >= 100, `Expected at least 100 snapshot cards, got ${cards.length}.`);

const groceryCash = getTopCards(cards, {
  filters: ['personal', 'cashback', 'no-fee', 'gas'],
});

assert(groceryCash.length > 0, 'Expected no-fee gas cash-back public ranking to return cards.');
for (const result of groceryCash) {
  const rankingCard = deriveRankingCard(result.card);
  assert(rankingCard.audience === 'personal', `${result.card.name} violates personal hard pool.`);
  assert(rankingCard.rewardSystem === 'cash_back', `${result.card.name} violates cash-back hard pool.`);
  assert(rankingCard.annualFee === 0, `${result.card.name} violates no-fee hard pool.`);
  assert(result.explanation.length > 0, `${result.card.name} missing public explanation.`);
  assert(hasDebugShape(result.debug), `${result.card.name} missing RankingDebugOutput shape.`);
}
// Rewards searches rank by dollars: the list is sorted by value, and each
// score equals the value formula on chip-weighted spend (gas doubled here).
for (let i = 1; i < groceryCash.length; i++) {
  assert(groceryCash[i - 1].finalScore >= groceryCash[i].finalScore, 'Public ranking must be sorted by dollar value.');
}
const gasSpend = { ...TYPICAL_SPEND, gas: TYPICAL_SPEND.gas * 2 };
for (const r of groceryCash) {
  const rc = deriveRankingCard(r.card);
  const expected = rankValue(rc, annualRewards(rc, gasSpend));
  assert(Math.abs(r.finalScore - expected) < 0.01, `${r.card.name}: score ${r.finalScore} != value ${expected}.`);
}
// With no chips, the #1 card's score is exactly the headline value shown on it.
const plain = getTopCards(cards, { filters: ['rewards'] });
const shown = estimateValue(plain[0].card);
assert(Math.round(plain[0].finalScore) === shown.average, `Rank value ${plain[0].finalScore} != shown ${shown.average}.`);
for (let i = 1; i < plain.length; i++) {
  assert(estimateValue(plain[i - 1].card).average >= estimateValue(plain[i].card).average, 'Shown values must not increase down the list.');
}
console.log(`Public value ranking OK: ${groceryCash.length} no-fee cash-back cards, top=${groceryCash[0].card.name} ($${Math.round(groceryCash[0].finalScore)}/yr); rewards #1=${plain[0].card.name} ($${shown.average}/yr shown).`);

const firstCardUser: UserProfile = {
  hasCreditCards: false,
  existingCards: [],
  creditBand: 'fair',
  isStudent: false,
  isBusinessOwner: false,
  preferredRewardSystem: 'cash_back',
  maxAnnualFee: 0,
  monthlySpend: { groceries: 700, gas: 250, dining: 250, general: 900 },
  goals: { earnRewards: true, buildCredit: true },
};
const firstCard = recommendCards(cards, firstCardUser, 5);
assert(firstCard.recommendations.length > 0, 'Expected first-card recommendations.');
assert(firstCard.recommendations.every((r) => deriveRankingCard(r.card).annualFee <= 0), 'Annual fee cutoff failed for $0 first-card user.');
assert(firstCard.aboveAnnualFeeLimit.length > 0, 'Expected separate above annual fee module.');
assert(firstCard.aboveAnnualFeeLimit.every((r) => deriveRankingCard(r.card).annualFee > 0), 'Above-limit module contains an eligible-fee card.');
assert(firstCard.recommendations.every((r) => r.explanation.some((line) => line.includes('$0 annual fee limit'))), 'Fee-limit explanation missing.');
console.log(`Annual fee hard cutoff OK: main=${firstCard.recommendations.length}, aboveLimit=${firstCard.aboveAnnualFeeLimit.length}, top=${firstCard.recommendations[0].card.name}.`);

const owned = groceryCash[0].card;
const existingUser: UserProfile = {
  hasCreditCards: true,
  existingCards: [{ id: owned.id }],
  creditBand: 'good',
  isStudent: false,
  isBusinessOwner: false,
  preferredRewardSystem: 'cash_back',
  maxAnnualFee: 95,
  monthlySpend: { groceries: 900, gas: 300, dining: 450, travel: 100, general: 1200 },
  goals: { earnRewards: true },
};
const nextCard = recommendCards(cards, existingUser, 8);
assert(nextCard.recommendations.length > 0, 'Expected existing-card recommendations.');
assert(!nextCard.recommendations.some((r) => r.card.id === owned.id), 'Duplicate suppression failed: owned card appears in recommendations.');
assert(nextCard.excluded.some((d) => d.cardId === owned.id && d.exclusionReasons?.some((r) => /already have/i.test(r))), 'Owned-card exclusion reason missing.');
assert(nextCard.recommendations.some((r) => (r.debug.complementarityScore ?? 0) > 0), 'Complementarity score was not populated.');
assert(nextCard.recommendations.every((r) => r.explanation.length > 0), 'Existing-card explanation missing.');
console.log(`Duplicate/complementarity OK: owned=${owned.name}; topNext=${nextCard.recommendations[0].card.name}; complementarity=${nextCard.recommendations[0].debug.complementarityScore?.toFixed(1)}.`);

const premium = cards.map(deriveRankingCard).find((card) => card.creditBand === 'excellent');
assert(premium, 'Expected at least one excellent-credit card for approval test.');
const poorUser: UserProfile = {
  hasCreditCards: false,
  existingCards: [],
  creditBand: 'poor',
  isStudent: false,
  isBusinessOwner: false,
  maxAnnualFee: 695,
  monthlySpend: {},
  goals: {},
};
const approval = computeApprovalLikelihood(poorUser, premium);
assert(approval === 10, `Expected poor-vs-excellent approval likelihood of 10, got ${approval}.`);
console.log(`Approval likelihood OK: poor user vs ${premium.name} (${premium.creditBand}) => ${approval}.`);

// Points are valued in cents, not 1:1 with cash back (lib/pointValues.ts).
const aspireCard = cards.find((card) => /hilton honors american express aspire/i.test(card.name));
assert(aspireCard, 'Expected the Hilton Aspire card in the snapshot.');
const aspire = deriveRankingCard(aspireCard);
assert(aspire.pointValueCents < 1, `Expected Hilton points valued below 1c, got ${aspire.pointValueCents}.`);
// 14x is Hilton-only (excluded as own-brand); 7x general travel at ~0.5c = ~3.5%.
assert(aspire.travelRate <= 4, `Expected Aspire's general travel to score ~3.5% value, got ${aspire.travelRate}.`);
// "N Hilton Honors Bonus Points after you spend $6,000": the bonus is the
// points at Hilton's ~0.5c, never the spend requirement. Derived from the
// live offer text so a new crawl's offer doesn't break the check.
const aspirePoints = Number((aspireCard.facts.bonus.match(/([\d,]{5,})\s+Hilton/i)?.[1] ?? '0').replace(/,/g, ''));
assert(aspirePoints > 0, 'Expected the Aspire bonus to state a points amount.');
assert(Math.round(aspire.welcomeBonusValue) === Math.round(aspirePoints * 0.005), `Expected Aspire bonus ~$${aspirePoints * 0.005}, got ${aspire.welcomeBonusValue}.`);
console.log(`Point valuation OK: ${aspire.name} travel=${aspire.travelRate}% bonus=$${aspire.welcomeBonusValue}.`);

const sample = nextCard.recommendations[0];
console.log('Sample explanation:', sample.explanation.join(' | '));
console.log('Sample debug:', JSON.stringify(sample.debug, null, 2));
console.log('Ranking verification complete.');
