import { useMemo } from 'react';
import { Info } from 'lucide-react';
import { CreditCard } from '../types';
import { estimateValue, MonthlySpend, TYPICAL_SPEND } from '../lib/insights';
import { RankMode, ValuePrefs } from '../lib/ranking';
import Sparkle from './Sparkle';

// The headline of every card: what it's worth to *you* in dollars per year.
// A sunny "sticker" card (sun = your money) with the arithmetic written out
// as an equation underneath, so the fee sits inside the number rather than
// in a footnote. People choose on the deal, walk away from costs they didn't
// see coming, and trust numbers whose workings are visible.

const usd = (n: number) => `$${Math.abs(Math.round(n)).toLocaleString()}`;

interface ValueBlockProps {
  card: CreditCard;
  spend?: MonthlySpend;
  /** Narrow column (beside the card): equation wraps instead of one line. */
  stacked?: boolean;
  /** Cards the user already holds: rewards then count only what this card
   *  adds on top of them (the same basis the quiz ranks by). */
  owned?: CreditCard[];
  /** Render the fine print elsewhere (e.g. centred under a symmetric layout). */
  hideNotes?: boolean;
  /** Describes `spend` when it's a filter's weighting rather than the
   *  user's own answers (see chipSpendBasis in lib/ranking.ts). */
  basis?: { label: string; note: string };
  /** Which value is the headline: every year (default) or year one. */
  mode?: RankMode;
  /** Quiz answers that personalise perks and bonus eligibility. */
  prefs?: ValuePrefs;
}

export default function ValueBlock({ card, spend, owned = [], hideNotes = false, basis, mode = 'ongoing', prefs }: ValueBlockProps) {
  const v = useMemo(() => estimateValue(card, spend, owned, mode, prefs), [card, spend, owned, mode, prefs]);
  const firstYear = mode === 'first_year';

  const what = v.incremental ? 'Extra value over your cards' : firstYear ? 'First-year value' : 'Estimated value every year';
  const label = v.incremental
    ? `${what}${firstYear ? ', year one' : ''}`
    : basis ? `${what} on ${basis.label}`
    : `${what} ${v.personalized ? 'for you' : 'on typical spending'}`;

  return (
    <div className="w-full">
      <div className="pop relative overflow-hidden rounded-[1.75rem] bg-[var(--cl-sun)] px-6 py-6 text-[var(--cl-ink)] md:px-8 md:py-7">
        <Sparkle className="absolute right-6 top-5 h-8 w-8 text-[var(--cl-ink)]" />
        <Sparkle className="absolute right-16 top-14 h-4 w-4 text-[var(--cl-ink)]" />

        {/* pr clears the sparkles in the top-right corner when the label wraps. */}
        <p className="pr-14 text-[12px] font-bold uppercase tracking-[0.14em] text-[var(--cl-ink)]/70">{label}</p>
        <p className="mt-2 flex items-baseline gap-2">
          <span className="font-editorial text-6xl leading-none md:text-7xl">
            {v.headline < 0 ? '−' : ''}{usd(v.headline)}
          </span>
          <span className="text-base font-semibold text-[var(--cl-ink)]/70">{firstYear ? 'in year one' : '/ year'}</span>
        </p>
        <p className="mt-2 text-sm text-[var(--cl-ink)]/80">
          {!v.annualFeeKnown
            ? "Before the annual fee — we couldn't confirm it, so check the issuer's site."
            : v.bonusIneligible
              ? <>Every year, after the annual fee. {v.bonusIneligible}</>
            : v.bonus === 0
              ? 'Every year, after the annual fee. No welcome bonus.'
              : firstYear
                ? <>Includes the {usd(v.bonus)} welcome bonus. After year one: <b>{v.everyYear < 0 ? '−' : ''}{usd(v.everyYear)}</b>/yr</>
                : <>Every year, after the annual fee. Year one adds a {usd(v.bonus)} welcome bonus: <b>{usd(v.firstYear)}</b></>}
        </p>

        {/* The workings, as an equation: rewards + bonus − fee. */}
        <div className="mt-5 flex flex-wrap items-center gap-2 text-sm">
          <Term sign="+" amount={usd(v.rewards)} label={v.incremental ? 'extra rewards' : 'rewards'} />
          {firstYear && <Term sign="+" amount={usd(v.bonus)} label="welcome bonus" muted={v.bonus === 0} />}
          {v.creditItems.length > 0 && <Term sign="+" amount={usd(v.credits)} label="credits & perks" muted={v.credits === 0} />}
          {v.annualFeeKnown
            ? <Term sign="−" amount={usd(v.annualFee)} label="annual fee" cost={v.annualFee > 0} muted={v.annualFee === 0} />
            : <Term sign="−" amount="?" label="fee not listed" cost />}
        </div>
      </div>

      {!hideNotes && <ValueNotes card={card} spend={spend} owned={owned} basis={basis} prefs={prefs} />}
    </div>
  );
}

/** The estimate's basis and the carry-a-balance caution — quiet fine print. */
export function ValueNotes({ card, spend, owned = [], basis, prefs }: { card: CreditCard; spend?: MonthlySpend; owned?: CreditCard[]; basis?: { label: string; note: string }; prefs?: ValuePrefs }) {
  const v = useMemo(() => estimateValue(card, spend, owned, 'ongoing', prefs), [card, spend, owned, prefs]);
  const monthlyTotal = Object.values(v.personalized ? { ...TYPICAL_SPEND, ...spend } : TYPICAL_SPEND)
    .reduce((a, b) => a + (b || 0), 0);
  return (
    <div className="mt-4 flex max-w-2xl flex-col items-center gap-1 px-1 text-center text-xs leading-relaxed text-[var(--cl-muted)]">
      <p className="flex items-start gap-1.5">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          {basis
            ? <>Based on ~${monthlyTotal.toLocaleString()}/month of spending, {basis.note}</>
            : <>Based on {v.personalized ? 'your' : 'a typical'} ~${monthlyTotal.toLocaleString()}/month of spending</>}
          {v.incremental ? ', counting only what beats your current cards' : ''}. Points valued conservatively; confirm terms with the issuer.
        </span>
      </p>
      {v.creditItems.length > 0 && (
        <p className="max-w-xl">
          Credits & perks, at estimated real use{prefs?.brands || prefs?.travel ? ' for how you travel' : ''}:{' '}
          {v.creditItems.map((i, k) => (
            <span key={k}>
              {k > 0 && ' · '}
              {i.credit.name}{' '}
              {i.counted === 0
                ? '(not counted)'
                : i.faceValue != null && Math.round(i.faceValue) !== Math.round(i.counted)
                  ? `${usd(i.faceValue)} → ${usd(i.counted)}`
                  : usd(i.counted)}
            </span>
          ))}
        </p>
      )}
      <p>Carry a balance? At 20%+ APR, interest usually costs more than any card earns.</p>
    </div>
  );
}

function Term({ sign, amount, label, cost, muted }: { sign: string; amount: string; label: string; cost?: boolean; muted?: boolean }) {
  return (
    <span
      className={`pop-sm inline-flex items-baseline gap-1.5 rounded-full px-3 py-1.5 ${
        cost ? 'bg-[var(--cl-coral)]' : 'bg-white'
      } ${muted ? 'opacity-55' : ''}`}
    >
      <span className="font-bold">{sign}{amount}</span>
      <span className={cost ? 'text-[var(--cl-ink)]' : 'text-[var(--cl-ink)]/70'}>{label}</span>
    </span>
  );
}
