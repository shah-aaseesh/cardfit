import rawRows from '../src/cards.snapshot.json';
import { mapRowToCard, CardRow } from '../src/lib/cardMapper';
import {
  computeApprovalLikelihood,
  deriveRankingCard,
  getTop15Cards,
  recommendCards,
  RankingDebugOutput,
  UserProfile,
} from '../src/lib/ranking';

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
// 162 crawled rows minus 3 same-card duplicates (scripts/clean-snapshot.ts).
assert(cards.length === 159, `Expected 159 snapshot cards, got ${cards.length}.`);

const groceryCash = getTop15Cards(cards, {
  filters: ['personal', 'cashback', 'no-fee', 'gas'],
});

assert(groceryCash.length > 0, 'Expected no-fee gas cash-back public ranking to return cards.');
for (const result of groceryCash) {
  const rankingCard = deriveRankingCard(result.card);
  assert(rankingCard.audience === 'personal', `${result.card.name} violates personal hard pool.`);
  assert(rankingCard.rewardSystem === 'cash_back', `${result.card.name} violates cash-back hard pool.`);
  assert(rankingCard.annualFee === 0, `${result.card.name} violates no-fee hard pool.`);
  assert((result.softScore ?? 0) >= 0, `${result.card.name} missing soft score.`);
  assert(result.explanation.length > 0, `${result.card.name} missing public explanation.`);
  assert(hasDebugShape(result.debug), `${result.card.name} missing RankingDebugOutput shape.`);
}
// Soft categories are a within-hard-tier tiebreaker (PRD §10.2 sorts by
// hardTier first), so the #1 card isn't guaranteed to carry gas rewards —
// assert instead that the gas soft score is populated and orders the pool.
assert(groceryCash.some((r) => (r.softScore ?? 0) > 0), 'Expected gas soft category to affect ordering.');
for (let i = 1; i < groceryCash.length; i++) {
  const prev = groceryCash[i - 1], cur = groceryCash[i];
  const prevTier = Math.floor((prev.debug.hardScore ?? 0) / 5);
  const curTier = Math.floor((cur.debug.hardScore ?? 0) / 5);
  if (prevTier === curTier) {
    assert((prev.softScore ?? 0) >= (cur.softScore ?? 0), 'Within a hard tier, cards must be ordered by soft score.');
  }
}
console.log(`Public hard/soft ranking OK: ${groceryCash.length} no-fee personal cash-back cards; top=${groceryCash[0].card.name}; soft=${groceryCash[0].softScore?.toFixed(1)}.`);

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
// "175,000 ... Points after you spend $6,000": the bonus is the points, not the spend.
assert(Math.round(aspire.welcomeBonusValue) === 875, `Expected Aspire bonus ~$875, got ${aspire.welcomeBonusValue}.`);
console.log(`Point valuation OK: ${aspire.name} travel=${aspire.travelRate}% bonus=$${aspire.welcomeBonusValue}.`);

const sample = nextCard.recommendations[0];
console.log('Sample explanation:', sample.explanation.join(' | '));
console.log('Sample debug:', JSON.stringify(sample.debug, null, 2));
console.log('Ranking verification complete.');
