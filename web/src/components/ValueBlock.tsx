import { useMemo } from 'react';
import { Info } from 'lucide-react';
import { CreditCard } from '../types';
import { estimateValue, MonthlySpend, TYPICAL_SPEND } from '../lib/insights';

// The headline of every card: what it's worth to *you* in dollars per year,
// with the parts shown (rewards, bonus, fee). Research on how people choose
// financial products points the same way every time — they pick on the deal,
// they walk away from costs they didn't see coming, and they trust numbers
// whose workings are visible. So the fee sits inside the number, not in a
// footnote, and the estimate says what it's based on.

const usd = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString()}`;

interface ValueBlockProps {
  card: CreditCard;
  spend?: MonthlySpend;
  /** Always stack number over breakdown (narrow columns, e.g. beside the card). */
  stacked?: boolean;
  /** Cards the user already holds: rewards then count only what this card
   *  adds on top of them (the same basis the quiz ranks by). */
  owned?: CreditCard[];
}

export default function ValueBlock({ card, spend, stacked = false, owned = [] }: ValueBlockProps) {
  const row = stacked ? "" : "md:flex-row md:items-center md:justify-between";
  const left = stacked ? "text-left" : "text-center md:text-left";
  const justify = stacked ? "justify-start" : "justify-center md:justify-start";
  const v = useMemo(() => estimateValue(card, spend, owned), [card, spend, owned]);
  // The headline is the exact number the card was ranked by.
  const positive = v.average > 0;
  const monthlyTotal = Object.values(v.personalized ? { ...TYPICAL_SPEND, ...spend } : TYPICAL_SPEND)
    .reduce((a, b) => a + (b || 0), 0);

  return (
    <div className={`w-full ${stacked ? "" : "max-w-3xl"} rounded-3xl border border-[var(--cl-hairline)] bg-[var(--cl-surface)] px-5 py-5 md:px-8 md:py-6 shadow-[0_18px_40px_-32px_oklch(0.25_0.045_262/0.45)]`}>
      <div className={`flex flex-col gap-5 ${row}`}>
        <div className={left}>
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[var(--cl-muted)]">
            {v.incremental ? 'Extra value over your cards' : `Estimated value ${v.personalized ? 'for you' : 'on typical spending'}`}
          </p>
          <p className={`mt-1 flex items-baseline gap-1.5 ${justify}`}>
            <span className={`font-editorial text-5xl md:text-6xl leading-none ${positive ? 'text-[var(--cl-value)]' : 'text-[var(--cl-caution)]'}`}>
              {usd(v.average)}
            </span>
            <span className="text-sm text-[var(--cl-muted)]">/ year</span>
          </p>
          <p className="mt-1.5 text-sm text-[var(--cl-muted)]">
            {!v.annualFeeKnown ? (
              <span className="text-[var(--cl-caution)]">Before the annual fee — we couldn't confirm it, so check the issuer's site.</span>
            ) : v.bonus > 0 ? (
              <>
                Averaged over 2 years: <span className="font-semibold text-[var(--cl-ink)]">{usd(v.firstYear)}</span> in year one,
                then <span className="font-semibold text-[var(--cl-ink)]">{usd(v.everyYear)}</span>/yr
              </>
            ) : (
              'Every year, after the annual fee'
            )}
          </p>
        </div>

        {/* The workings: every part of the number, fee included. */}
        <dl className={`grid grid-cols-3 gap-2 text-center ${stacked ? "" : "md:min-w-[22rem]"}`}>
          <div className="rounded-2xl bg-[var(--cl-value-soft)] px-3 py-2.5">
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-[var(--cl-muted)]">{v.incremental ? 'Extra rewards' : 'Rewards'}</dt>
            <dd className="mt-0.5 font-semibold text-[var(--cl-value)]">+{usd(v.rewards)}</dd>
          </div>
          <div className="rounded-2xl bg-[var(--cl-value-soft)] px-3 py-2.5">
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-[var(--cl-muted)]">Bonus</dt>
            <dd className="mt-0.5 font-semibold text-[var(--cl-value)]">{v.bonus > 0 ? `+${usd(v.bonus)}` : '—'}</dd>
          </div>
          <div className={`rounded-2xl px-3 py-2.5 ${v.annualFee > 0 ? 'bg-[var(--cl-caution-soft)]' : 'bg-[var(--cl-panel)]'}`}>
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-[var(--cl-muted)]">Annual fee</dt>
            <dd className={`mt-0.5 font-semibold ${v.annualFee > 0 ? 'text-[var(--cl-caution)]' : 'text-[var(--cl-ink)]'}`}>
              {!v.annualFeeKnown ? 'Unknown' : v.annualFee > 0 ? `−${usd(v.annualFee)}` : '$0'}
            </dd>
          </div>
        </dl>
      </div>

      <div className={`mt-4 flex flex-col gap-1.5 border-t border-[var(--cl-hairline)] pt-3 text-xs text-[var(--cl-muted)] ${stacked ? "" : "md:flex-row md:items-start md:justify-between md:gap-6"}`}>
        <p className="flex items-start gap-1.5">
          <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Estimate on {v.personalized ? 'your' : 'a typical'} ~${monthlyTotal.toLocaleString()}/month of spending{v.incremental ? ', counting only what beats your current cards' : ''}. Rewards rankings use this number, adjusted for approval odds.
            Points are valued conservatively. Confirm terms with the issuer.
          </span>
        </p>
        <p className={stacked ? "" : "md:max-w-[19rem] md:text-right"}>
          Carry a balance? Interest at 20%+ APR usually costs more than any card earns. Pay in full to keep these rewards.
        </p>
      </div>
    </div>
  );
}
