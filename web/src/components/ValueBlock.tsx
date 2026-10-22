import { useMemo } from 'react';
import { Info } from 'lucide-react';
import { CreditCard } from '../types';
import { estimateValue, MonthlySpend, TYPICAL_SPEND } from '../lib/insights';

// The headline of every card: what it's worth to *you* in dollars per year.
// Styled as a solid brand "value card" — like the balance card in a banking
// app — with the arithmetic written out as an equation underneath, so the
// fee sits inside the number rather than in a footnote. People choose on the
// deal, walk away from costs they didn't see coming, and trust numbers whose
// workings are visible.

const usd = (n: number) => `$${Math.abs(Math.round(n)).toLocaleString()}`;

interface ValueBlockProps {
  card: CreditCard;
  spend?: MonthlySpend;
  /** Narrow column (beside the card): equation wraps instead of one line. */
  stacked?: boolean;
  /** Cards the user already holds: rewards then count only what this card
   *  adds on top of them (the same basis the quiz ranks by). */
  owned?: CreditCard[];
}

export default function ValueBlock({ card, spend, owned = [] }: ValueBlockProps) {
  const v = useMemo(() => estimateValue(card, spend, owned), [card, spend, owned]);
  const monthlyTotal = Object.values(v.personalized ? { ...TYPICAL_SPEND, ...spend } : TYPICAL_SPEND)
    .reduce((a, b) => a + (b || 0), 0);

  const label = v.incremental
    ? 'Extra value over your cards'
    : `Estimated value ${v.personalized ? 'for you' : 'on typical spending'}`;

  return (
    <div className="w-full">
      {/* The value card: the number the card is ranked by, white on brand blue. */}
      <div className="relative overflow-hidden rounded-[1.75rem] bg-[linear-gradient(135deg,oklch(0.55_0.23_262)_0%,oklch(0.46_0.24_268)_55%,oklch(0.38_0.20_275)_100%)] px-6 py-6 text-white shadow-[0_28px_50px_-28px_oklch(0.45_0.24_268/0.75)] md:px-8 md:py-7">
        {/* Soft light + fine grid for depth, like a premium card face. */}
        <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-white/15 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:28px_28px]" />

        <div className="relative">
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-white/75">{label}</p>
          <p className="mt-2 flex items-baseline gap-2">
            <span className="font-editorial text-6xl leading-none md:text-7xl">
              {v.average < 0 ? '−' : ''}{usd(v.average)}
            </span>
            <span className="text-base text-white/75">/ year</span>
          </p>
          <p className="mt-2 text-sm text-white/80">
            {!v.annualFeeKnown
              ? "Before the annual fee — we couldn't confirm it, so check the issuer's site."
              : v.bonus > 0
                ? <>Averaged over 2 years: <b className="font-semibold text-white">{usd(v.firstYear)}</b> in year one, then <b className="font-semibold text-white">{v.everyYear < 0 ? '−' : ''}{usd(v.everyYear)}</b>/yr</>
                : 'Every year, after the annual fee'}
          </p>

          {/* The workings, as an equation: rewards + bonus − fee. */}
          <div className="mt-5 flex flex-wrap items-center gap-2 text-sm">
            <Term sign="+" amount={usd(v.rewards)} label={v.incremental ? 'extra rewards' : 'rewards'} />
            <Term sign="+" amount={usd(v.bonus / 2)} label={v.bonus > 0 ? `bonus (½ of ${usd(v.bonus)})` : 'bonus'} muted={v.bonus === 0} />
            {v.annualFeeKnown
              ? <Term sign="−" amount={usd(v.annualFee)} label="annual fee" cost={v.annualFee > 0} muted={v.annualFee === 0} />
              : <Term sign="−" amount="?" label="fee not listed" cost />}
          </div>
        </div>
      </div>

      {/* Fine print sits outside the card, quiet. */}
      <div className="mt-3 flex flex-col gap-1 px-1 text-xs leading-relaxed text-[var(--cl-muted)]">
        <p className="flex items-start gap-1.5">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Based on {v.personalized ? 'your' : 'a typical'} ~${monthlyTotal.toLocaleString()}/month of spending
            {v.incremental ? ', counting only what beats your current cards' : ''}. Points valued conservatively; confirm terms with the issuer.
          </span>
        </p>
        <p className="pl-5">Carry a balance? At 20%+ APR, interest usually costs more than any card earns.</p>
      </div>
    </div>
  );
}

function Term({ sign, amount, label, cost, muted }: { sign: string; amount: string; label: string; cost?: boolean; muted?: boolean }) {
  return (
    <span
      className={`inline-flex items-baseline gap-1.5 rounded-full px-3 py-1.5 ring-1 ${
        cost ? 'bg-amber-300/20 ring-amber-200/40' : 'bg-white/12 ring-white/20'
      } ${muted ? 'opacity-60' : ''}`}
    >
      <span className={`font-semibold ${cost ? 'text-amber-200' : 'text-white'}`}>{sign}{amount}</span>
      <span className="text-white/75">{label}</span>
    </span>
  );
}
