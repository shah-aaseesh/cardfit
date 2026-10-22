// What one point or mile is worth, in cents, so points cards and cash-back
// cards compete in the same unit (dollars).
//
// Before this, the ranker scored 1 point as 1 cent everywhere, so a hotel
// co-brand's "14x" read as 14% cash back and swept the travel rankings,
// even though those points redeem for roughly half a cent.
//
// These are deliberately conservative, rounded *estimates* of a typical
// redemption (not best-case transfer-partner sweet spots), and they drift
// as programs devalue. Keep them in this one table, review them
// periodically, and say "estimated" wherever they surface in the UI.

interface Program {
  name: string;
  match: RegExp;
  cents: number;
}

// First match wins, so co-brands come before the bank programs whose
// names they can contain ("Marriott Bonvoy ... from Chase").
const PROGRAMS: Program[] = [
  // Hotels
  { name: 'Hilton Honors', match: /hilton/i, cents: 0.5 },
  { name: 'Marriott Bonvoy', match: /marriott|bonvoy/i, cents: 0.7 },
  { name: 'IHG One Rewards', match: /\bihg\b/i, cents: 0.5 },
  { name: 'World of Hyatt', match: /hyatt/i, cents: 1.5 },
  { name: 'Wyndham Rewards', match: /wyndham/i, cents: 0.8 },
  { name: 'Choice Privileges', match: /choice privileges/i, cents: 0.6 },
  // Airlines (one rounded figure; individual programs vary ~1.0-1.4c)
  {
    name: 'Airline miles',
    match: /united|delta|skymiles|american airlines|aadvantage|southwest|rapid rewards|alaska|jetblue|trueblue|aeroplan|avios|british airways|aer lingus|iberia|frontier|spirit|hawaiian|air france|flying blue|emirates|lufthansa|miles & more/i,
    cents: 1.1,
  },
  // Bank programs: value at the cash / statement-credit floor.
  { name: 'Chase Ultimate Rewards', match: /ultimate rewards|sapphire|freedom|\bink\b/i, cents: 1.0 },
  { name: 'Amex Membership Rewards', match: /membership rewards/i, cents: 0.8 },
  { name: 'Citi ThankYou', match: /thankyou|strata|citi rewards/i, cents: 1.0 },
  { name: 'Capital One miles', match: /venture|capital one miles/i, cents: 1.0 },
];

/** Points of unknown program: below the bank-program floor, since we can't
 *  confirm a cash-out option exists. */
const UNKNOWN_POINTS_CENTS = 0.8;

export interface PointValue {
  cents: number;
  program: string;
}

/** Cents per point/mile for a points card. Matches on the card name first
 *  (most specific), then the rewards text. */
export function pointValue(name: string, rewardsText = ''): PointValue {
  for (const hay of [name, rewardsText]) {
    const program = PROGRAMS.find((p) => p.match.test(hay));
    if (program) return { cents: program.cents, program: program.name };
  }
  return { cents: UNKNOWN_POINTS_CENTS, program: 'Points' };
}
