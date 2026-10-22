// APR is always shown as two labelled subsections — an intro/promotional
// rate and the ongoing/standard rate — normalized to a short, consistent
// shape so verbose issuer copy doesn't blow out the layout:
//
//   Regular : "19.49% to 28.49% variable"     (rate range + variable/fixed)
//   Intro   : "0% for the first 15 billing cycles"  (rate + duration only)
//
// Intro also resolves to "Not applicable" (no intro offer) or "Not listed"
// (no data yet); Regular resolves to "Not listed" when unknown.

import { CardFacts } from '../types';

export interface AprSection {
  label: string;
  value: string;
}

// Placeholder / unknown values — no real data to show.
const UNKNOWN = /^\s*$|see issuer|not specified|unsure|unknown|tbd/i;
// The card was checked and has no intro offer.
const NO_INTRO = /^(none|no\b|no intro|not applicable|n\/a)/i;

/** "19.49% to 28.49% variable APR on purchases" -> "19.49% to 28.49% variable" */
function normalizeRegular(raw: string): string {
  const pcts = raw.match(/\d+(?:\.\d+)?%/g);
  if (!pcts || pcts.length === 0) return raw.trim();
  const range = pcts.length >= 2 ? `${pcts[0]} to ${pcts[1]}` : pcts[0];
  const kind = /\bfixed\b/i.test(raw) ? 'fixed' : 'variable';
  return `${range} ${kind}`;
}

/** Long intro copy -> "<rate> for the first <N> <unit>", dropping the
 *  trailing conditions ("following each balance transfer that posts..."). */
function normalizeIntro(raw: string): string {
  const rate = (raw.match(/\d+(?:\.\d+)?%/) || ['0%'])[0];
  const dur = raw.match(/(\d+)\s+(billing cycle|month|week|day|year)s?/i);
  if (dur) {
    const n = parseInt(dur[1], 10);
    const unit = dur[2].toLowerCase() + (n === 1 ? '' : 's');
    return `${rate} for the first ${n} ${unit}`;
  }
  // No clean duration — keep the rate and the lead clause, drop the rest.
  const lead = raw.split(/,| following | then | when | after | that /i)[0].trim();
  return lead || rate;
}

function introValue(raw?: string): string {
  const t = (raw || '').trim();
  if (!t || UNKNOWN.test(t)) return 'Not listed';
  if (NO_INTRO.test(t)) return 'Not applicable';
  // Placeholder copy the scraper couldn't fill ("x% intro APR for x months")
  // has no real numbers — don't show it.
  if (!/\d/.test(t)) return 'Not listed';
  return normalizeIntro(t);
}

function regularValue(facts: CardFacts): string {
  const t = (facts.aprRegular || facts.apr || '').trim();
  if (!t || UNKNOWN.test(t)) return 'Not listed';
  // Needs at least one real percentage rate; "% – % variable" and the like
  // are unfilled placeholders, so treat them as unknown.
  if (!/\d+(?:\.\d+)?\s*%/.test(t)) return 'Not listed';
  return normalizeRegular(t);
}

export function aprSections(facts: CardFacts): AprSection[] {
  return [
    { label: 'Intro', value: introValue(facts.aprIntro) },
    { label: 'Regular', value: regularValue(facts) },
  ];
}
