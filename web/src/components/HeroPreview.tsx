import { motion, useReducedMotion } from 'motion/react';
import { CreditCard } from '../types';
import CardVisual from './CardVisual';
import { estimateValue } from '../lib/insights';
import Sparkle from './Sparkle';

// Landing-page product shot: the real top-ranked cards fanned out, with the
// #1 card's value chip computed by the same ranker the results page uses.
// Shows what CardFit does before a word is read, instead of a text-only hero.

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

const FAN = [
  { x: -46, y: 26, rotate: -11, z: 0 },
  { x: 46, y: 14, rotate: 9, z: 1 },
  { x: 0, y: -18, rotate: -2, z: 2 },
];

export default function HeroPreview({ cards, topRank }: { cards: CreditCard[]; topRank: number }) {
  const reduced = useReducedMotion();
  if (cards.length < 3) return null;
  const top = cards[0];
  const v = estimateValue(top);
  // Back to front: #3, #2, then #1 on top.
  const order = [cards[2], cards[1], cards[0]];

  return (
    <div className="relative mx-auto h-[24rem] w-full max-w-[34rem]" aria-hidden="true">
      {/* Lilac sticker disc + sparkles behind the fan. */}
      <div className="pop absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--cl-brand-soft)]" />
      <Sparkle className="absolute left-8 bottom-10 h-10 w-10 text-[var(--cl-brand)]" />
      <Sparkle className="absolute right-10 top-4 h-7 w-7 text-[var(--cl-coral)]" />
      {order.map((card, i) => (
        <motion.div
          key={card.id}
          className="absolute left-1/2 top-1/2 drop-shadow-[5px_5px_0_#141414]"
          style={{ zIndex: FAN[i].z }}
          initial={reduced ? false : { opacity: 0, y: 40, rotate: 0, x: '-50%' }}
          animate={{ opacity: 1, x: `calc(-50% + ${FAN[i].x}px)`, y: `calc(-50% + ${FAN[i].y}px)`, rotate: FAN[i].rotate }}
          transition={{ duration: 0.7, delay: reduced ? 0 : 0.12 * i, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="w-[17.5rem] [&>div]:!w-full [&>div]:!h-auto [&>div]:aspect-[420/266]">
            <CardVisual card={card} />
          </div>
        </motion.div>
      ))}

      {/* Floating value chip — the product's answer, at a glance. */}
      <motion.div
        className="pop absolute bottom-2 right-0 z-10 rotate-2 rounded-2xl bg-[var(--cl-sun)] px-4 py-3"
        initial={reduced ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: reduced ? 0 : 0.55 }}
      >
        {/* The preview only shows cards with art, so its first card may not be
            #1; a "#2" headline read as an odd choice. */}
        <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--cl-ink)]/70">{topRank === 1 ? '#1 for rewards' : 'Top 10 for rewards'}</p>
        <p className="mt-0.5 font-editorial text-3xl leading-none text-[var(--cl-ink)]">
          {usd(v.headline)}<span className="ml-1 text-sm font-semibold tracking-normal text-[var(--cl-ink)]/70">/ year</span>
        </p>
        <p className="mt-1 max-w-[13rem] truncate text-xs text-[var(--cl-ink)]">{top.name}</p>
      </motion.div>

      <motion.div
        className="pop-sm absolute left-0 top-6 z-10 -rotate-2 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-[var(--cl-ink)]"
        initial={reduced ? false : { opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: reduced ? 0 : 0.7 }}
      >
        {!v.annualFeeKnown ? 'Fee checked on issuer site' : v.annualFee > 0
          ? <><span className="text-[var(--cl-caution)]">−{usd(v.annualFee)}</span> fee already counted</>
          : 'No annual fee'}
      </motion.div>
    </div>
  );
}
