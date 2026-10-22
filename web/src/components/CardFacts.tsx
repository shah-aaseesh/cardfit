import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { ChevronDown, Gift } from 'lucide-react';
import { CreditCard as CreditCardType } from '../types';
import { cardRewardBullets, leadWithNumber } from '../lib/rewards';

interface CardFactsProps {
  card: CreditCardType;
}

/**
 * The headline facts shown beneath the analysis panel in the results view:
 * Rewards · Sign-up Bonus. The annual fee lives in ValueBlock (as the −$ in
 * the value breakdown), and every other fact (APR, credit, foreign fee, top
 * perk, best for) in CardInsightsPanel.
 */
export default function CardFacts({ card }: CardFactsProps) {
  const reducedMotion = useReducedMotion();
  // Cap at 4 so the headline matrix keeps a bounded height across cards.
  const rewardsBullets = cardRewardBullets(card.facts).slice(0, 4);

  const cells = [
    { label: 'Rewards', value: card.facts.rewards, rewards: true, icon: <Gift className="h-5 w-5" strokeWidth={1.8} /> },
    { label: 'Sign-up Bonus', value: leadWithNumber(card.facts.bonus), rewards: false, icon: <Gift className="h-5 w-5" strokeWidth={1.8} /> },
  ];

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={card.id}
        initial={{ opacity: 0, y: reducedMotion ? 0 : 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, transition: { duration: 0.15 } }}
        transition={{ duration: reducedMotion ? 0 : 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-[78rem] mx-auto px-4"
      >
        <div className="grid grid-cols-1 gap-3 md:gap-0 md:grid-cols-2">
          {cells.map((cell, i) => (
            <div
              key={cell.label}
              className={`mobile-fact-card flex items-start text-left gap-3 p-5 md:flex-col md:bg-transparent md:rounded-none md:shadow-none md:px-9 md:py-4 ${i < cells.length - 1 ? 'md:border-b-0 md:border-r' : ''} border-[var(--cl-hairline-strong)]`}
            >
              <span className="mobile-fact-icon hidden shrink-0 rounded-full bg-[var(--cl-panel)] text-[var(--cl-ink)]">{cell.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="font-display text-[11px] font-medium uppercase tracking-[0.15em] text-[var(--cl-muted)]">{cell.label}</span>
                {cell.rewards && rewardsBullets.length >= 1 ? (
                  <ul className="mt-2 flex flex-col gap-2 text-left">
                    {rewardsBullets.map((b, j) => (
                      <li key={j} className="flex gap-2.5 min-w-0 text-[14px] text-[var(--cl-ink)] leading-snug">
                        <span aria-hidden className="mt-[0.55em] h-1.5 w-1.5 rounded-full bg-[var(--cl-gold)] shrink-0" />
                        <span className="line-clamp-2">{b}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-[14px] text-[var(--cl-ink)] leading-relaxed max-w-[52ch] [overflow-wrap:anywhere]">{cell.value}</p>
                )}
              </span>
              <ChevronDown className="mobile-fact-chevron hidden h-5 w-5 shrink-0 text-[var(--cl-ink)]" strokeWidth={1.8} />
            </div>
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
