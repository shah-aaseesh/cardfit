import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { BarChart3, Check, Clock3, Coins, Gift, Globe2, Info, Percent, Sparkles, Star, Wallet } from 'lucide-react';
import { CreditCard } from '../types';
import { cardInsights } from '../lib/insights';
import { aprSections } from '../lib/apr';
import { cardRewardBullets, leadWithNumber, topPerkDisplay } from '../lib/rewards';
import { deriveRankingCard } from '../lib/ranking';
import { getPerks } from '../lib/perks';
import { pointValue } from '../lib/pointValues';
import Sparkle from './Sparkle';

// Everything below the value card, in the site's sticker style: six fact
// tiles (each with its own color chip), the rewards and sign-up bonus as two
// feature cards, and "best for" as lime stickers (it replaced a hairline
// table that read as a plain spreadsheet).

const APR_HINTS: Record<string, string> = {
  Intro: 'A reduced interest rate for a set period after you open the card.',
  Regular: "The ongoing yearly interest rate charged on any balance you don't pay in full.",
};

/** "Cash back", or the points program and the cents-per-point the value
 *  estimate assumes for it (lib/pointValues.ts). */
function rewardCurrency(card: CreditCard): { value: string; hint?: string } {
  const rc = deriveRankingCard(card);
  if (rc.pointValueCents === 1 && getPerks(card).currency !== 'points') return { value: 'Cash back' };
  const { program, cents } = pointValue(`${card.name} ${card.issuer}`, card.facts.rewards);
  return {
    value: `${program} · ~${cents}¢ each`,
    hint: 'A conservative cash value we assume for each point or mile when estimating value. Best-case redemptions can be worth more.',
  };
}

interface Tile {
  label: string;
  value: string;
  icon: React.ReactNode;
  chip: string;
  hint?: string;
}

export default function FinePrint({ card, whyBullets }: { card: CreditCard; whyBullets?: string[] }) {
  const reduced = useReducedMotion();
  const ins = cardInsights(card);
  const apr = aprSections(card.facts);
  const perk = topPerkDisplay(card.facts);
  const currency = rewardCurrency(card);
  const rewards = cardRewardBullets(card.facts).slice(0, 4);
  const personalized = !!whyBullets?.length;

  const tiles: Tile[] = [
    { label: 'Intro APR', value: apr[0].value, icon: <Clock3 className="h-5 w-5" />, chip: 'bg-[var(--cl-sky)]', hint: APR_HINTS.Intro },
    { label: 'Regular APR', value: apr[1].value, icon: <Percent className="h-5 w-5" />, chip: 'bg-[var(--cl-pink)]', hint: APR_HINTS.Regular },
    { label: 'Foreign fee', value: card.facts.foreignFee, icon: <Globe2 className="h-5 w-5" />, chip: 'bg-[var(--cl-lime)]' },
    perk !== 'See issuer site'
      ? { label: 'Top perk', value: perk, icon: <Star className="h-5 w-5" />, chip: 'bg-[var(--cl-sun)]' }
      : { label: 'Rewards paid as', value: currency.value, icon: <Coins className="h-5 w-5" />, chip: 'bg-[var(--cl-sun)]', hint: currency.hint },
    { label: 'Approval', value: ins.approval.label, icon: <BarChart3 className="h-5 w-5" />, chip: 'bg-[var(--cl-brand-soft)]' },
    { label: 'Redeem for', value: ins.redemption.join(' · '), icon: <Wallet className="h-5 w-5" />, chip: 'bg-[var(--cl-caution-soft)]' },
  ];

  return (
    <AnimatePresence mode="wait">
      <motion.section
        key={card.id}
        initial={{ opacity: 0, y: reduced ? 0 : 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, transition: { duration: 0.12 } }}
        transition={{ duration: reduced ? 0 : 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-5xl"
        aria-label="Card details"
      >
        <div className="mb-8 flex items-center justify-center gap-3">
          <Sparkle className="h-6 w-6 text-[var(--cl-brand)]" />
          <h2 className="font-editorial text-3xl text-[var(--cl-ink)] md:text-4xl">The fine print</h2>
          <Sparkle className="h-6 w-6 text-[var(--cl-coral)]" />
        </div>

        {/* Six fact tiles. */}
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tiles.map((t) => (
            <div key={t.label} className="pop-sm flex items-start gap-4 rounded-2xl bg-white p-5">
              <span className={`pop-sm grid h-11 w-11 shrink-0 place-items-center rounded-xl text-[var(--cl-ink)] ${t.chip}`}>{t.icon}</span>
              <div className="min-w-0">
                <dt className="flex items-center gap-1 text-[12px] font-bold uppercase tracking-[0.12em] text-[var(--cl-muted)]">
                  {t.label}
                  {t.hint && <Hint text={t.hint} />}
                </dt>
                <dd className="mt-1 text-[15px] font-semibold leading-snug text-[var(--cl-ink)] [overflow-wrap:anywhere]">{t.value}</dd>
              </div>
            </div>
          ))}
        </dl>

        {/* Rewards + sign-up bonus: the two things people compare most. */}
        <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="pop rounded-[1.5rem] bg-[var(--cl-sky)] p-6 md:p-7">
            <p className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.14em] text-[var(--cl-ink)]/75">
              <Sparkles className="h-4 w-4" /> Rewards
            </p>
            {rewards.length ? (
              <ul className="mt-4 flex flex-col gap-3">
                {rewards.map((b, i) => (
                  <li key={i} className="flex items-start gap-3 text-[15px] leading-snug text-[var(--cl-ink)]">
                    <span className="pop-sm mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white">
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                    <span className="line-clamp-2 font-medium">{b}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-[15px] text-[var(--cl-ink)]">{card.facts.rewards}</p>
            )}
          </div>
          <div className="pop rounded-[1.5rem] bg-[var(--cl-pink)] p-6 md:p-7">
            <p className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.14em] text-[var(--cl-ink)]/75">
              <Gift className="h-4 w-4" /> Sign-up bonus
            </p>
            <p className="mt-4 font-editorial text-2xl leading-snug text-[var(--cl-ink)] md:text-[1.7rem]">
              {leadWithNumber(card.facts.bonus)}
            </p>
          </div>
        </div>

        {/* Best for / why it fits: lime stickers, centred. */}
        <div className="mt-8 text-center">
          <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-[var(--cl-muted)]">
            {personalized ? 'Fits you because' : 'Best for'}
          </p>
          <ul className="mt-3 flex flex-wrap items-center justify-center gap-2.5">
            {(personalized ? whyBullets! : ins.bestFor.slice(0, 3)).map((it, i) => (
              <li key={i} className={`pop-sm inline-flex items-center gap-1.5 rounded-full bg-[var(--cl-lime)] px-3.5 py-1.5 text-sm font-semibold text-[var(--cl-ink)] ${i % 2 ? 'rotate-1' : '-rotate-1'}`}>
                <Check className="h-4 w-4" strokeWidth={3} /> {it}
              </li>
            ))}
          </ul>
        </div>
      </motion.section>
    </AnimatePresence>
  );
}

// Small (i) that reveals a definition on hover or keyboard focus.
function Hint({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label={text}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[var(--cl-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cl-brand)]/40"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 w-max max-w-[15rem] -translate-x-1/2 rounded-lg bg-[var(--cl-ink)] px-2.5 py-1.5 text-[12px] font-normal normal-case leading-snug tracking-normal text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}
