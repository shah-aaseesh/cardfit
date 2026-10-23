// What a card's ongoing credits and perks are worth in a typical year, in
// dollars, so they can sit in the same value equation as rewards and fees.
//
// Face value overstates them: a "$15 monthly Uber credit" is $180 on paper
// but worth far less to someone who rarely rides. So each kind of credit
// counts at a realistic-use share of its face value. Like the cents-per-point
// table in lib/pointValues.ts, these are deliberately conservative, rounded
// *estimates*: keep them in this one table and say "estimated" in the UI.

import { CardCredit, CreditKind } from '../types';

/** Share of a credit's yearly face value counted, by kind. */
const USE_SHARE: Record<CreditKind, number> = {
  // Usable on nearly any travel purchase; anyone who travels at all uses it.
  travel_broad: 1,
  // One hotel/airline brand or a booking portal: real money, only if you'd
  // have booked there anyway.
  brand_travel: 0.5,
  // Coupon-book credits (Uber, DoorDash, streaming, a specific shop): most
  // people use some of them, some of the time.
  merchant: 0.35,
  // Global Entry / TSA PreCheck: used once per renewal; the period (usually
  // every 4 years) already spreads it out.
  trusted_traveler: 1,
  // Valued by fixed amounts below, not a share of face value.
  free_night: 0,
  anniversary_points: 0,
  // Only worth something to people who fly often — listed, not counted.
  lounge: 0,
  checked_bag: 0,
  other: 0,
};

/** Many small merchant credits add up on paper, but nobody uses them all:
 *  their combined counted value stops here. */
const MERCHANT_CAP = 250;
/** A free night certificate, at a typical mid-tier redemption. */
const FREE_NIGHT_VALUE = 150;

const PER_YEAR: Record<CardCredit['per'], number> = {
  month: 12,
  quarter: 4,
  half_year: 2,
  year: 1,
  '4_years': 0.25,
};

export interface ValuedCredit {
  credit: CardCredit;
  /** Face value per year (null when the page gives no dollar amount). */
  faceValue: number | null;
  /** What's counted in the card's value, per year. */
  counted: number;
}

export interface CreditsValue {
  total: number;
  items: ValuedCredit[];
}

/** pointValueCents: the card's cents-per-point estimate, for anniversary
 *  points/miles (lib/pointValues.ts). */
export function valueCredits(credits: CardCredit[] | undefined, pointValueCents: number): CreditsValue {
  const items: ValuedCredit[] = (credits || []).map((credit) => {
    const yearly = credit.amount != null ? credit.amount * PER_YEAR[credit.per] : null;
    let counted = 0;
    if (credit.kind === 'free_night') {
      counted = FREE_NIGHT_VALUE * PER_YEAR[credit.per];
    } else if (credit.kind === 'anniversary_points') {
      counted = yearly != null ? (yearly * pointValueCents) / 100 : 0;
    } else if (yearly != null) {
      counted = yearly * USE_SHARE[credit.kind];
    }
    const faceValue = credit.kind === 'anniversary_points' ? counted : yearly;
    return { credit, faceValue, counted };
  });

  // Apply the merchant cap by scaling those items down together.
  const merchant = items.filter((i) => i.credit.kind === 'merchant');
  const merchantSum = merchant.reduce((s, i) => s + i.counted, 0);
  if (merchantSum > MERCHANT_CAP) {
    const scale = MERCHANT_CAP / merchantSum;
    for (const i of merchant) i.counted *= scale;
  }

  return { total: Math.round(items.reduce((s, i) => s + i.counted, 0)), items };
}
