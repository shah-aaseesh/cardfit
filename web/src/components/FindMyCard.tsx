import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { ChevronLeft, ChevronRight, X, Search, Plus } from 'lucide-react';
import { normalizeFilters } from '../lib/filters';
import { loadProfile } from '../lib/profile';
import { cardMatchesQuery } from '../lib/cardSearch';
import { useCards } from '../hooks/useCards';
import type { MatchResult } from '../App';

interface FindMyCardProps {
  open: boolean;
  onClose: () => void;
  onComplete: (result: MatchResult) => void;
}

type Answers = {
  firstName: string;
  lastName: string;
  email: string;
  hasCard?: boolean;
  ownedCards: string[];
  credit?: string;
  type?: string;
  rewards?: string;
  maxFee: number;                 // exact dollar cutoff — one of FEE_STOPS
  spend: Record<string, number>;  // dollars/month per category
};

// PRD §13.4 recommended annual-fee slider stops. The last is shown as "$695+".
const FEE_STOPS = [0, 49, 95, 150, 250, 395, 550, 695];

// Real monthly-dollar spend categories. Keys line up with the recommender's
// UserProfile.monthlySpend (ranking.ts → matchResultToUser).
const SPEND_CATS = [
  { key: 'dining', label: 'Dining & takeout' },
  { key: 'groceries', label: 'Groceries' },
  { key: 'gas', label: 'Gas & transit' },
  { key: 'general', label: 'Everything else' },
];
const SPEND_MAX = 2000; // slider ceiling per category ($/mo)

const BLANK: Answers = {
  firstName: '', lastName: '', email: '',
  ownedCards: [], maxFee: 95, // PRD default for a general cash-back user
  spend: { dining: 300, groceries: 400, gas: 150, general: 800 },
};

function deriveFilters(a: Answers): string[] {
  const ids: string[] = [];
  if (a.type) ids.push(a.type);
  if (a.rewards === 'cashback') ids.push('cashback');
  if (a.rewards === 'points') ids.push('rewards');
  // The fee is a hard *maximum*, never a floor — a $0 cap targets no-fee
  // cards; any higher cap is passed to the recommender as a cutoff, not a
  // push toward premium (PRD §13, §28).
  if (a.maxFee === 0) ids.push('no-fee');
  // Heaviest specific spend category becomes a soft ordering hint (dollars).
  // "general" is included in the comparison (even though it maps to no
  // filter) so the default wallet — mostly everyday spending — doesn't
  // spuriously hand a specific category like groceries the top spot.
  const spendGoal: Record<string, string> = { dining: 'dining', groceries: 'groceries', gas: 'gas' };
  const cats = ['dining', 'groceries', 'gas', 'general'] as const;
  const top = cats.map((k) => [k, a.spend[k] ?? 0] as const).sort((x, y) => y[1] - x[1])[0];
  if (top && top[1] >= 400) {
    if (spendGoal[top[0]]) ids.push(spendGoal[top[0]]);
  }
  return normalizeFilters([...new Set(ids)]);
}

export default function FindMyCard({ open, onClose, onComplete }: FindMyCardProps) {
  const reducedMotion = useReducedMotion();
  const [answers, setAnswers] = useState<Answers>(BLANK);
  const [index, setIndex] = useState(0);

  // Prefill a returning visitor's details each time the sheet opens —
  // including every prior answer (credit, type, rewards, fee, spend), so the
  // whole questionnaire comes back exactly as they last left it, no email
  // lookup required.
  useEffect(() => {
    if (!open) return;
    const p = loadProfile();
    const [first = '', ...rest] = (p.name || '').split(' ');
    const a = (p.answers || {}) as Partial<Answers> & { hasCard?: boolean };
    setAnswers({
      ...BLANK,
      firstName: first,
      lastName: rest.join(' '),
      email: p.email || '',
      ownedCards: p.ownedCards || [],
      hasCard: typeof a.hasCard === 'boolean' ? a.hasCard : undefined,
      credit: typeof a.credit === 'string' ? a.credit : undefined,
      type: typeof a.type === 'string' ? a.type : undefined,
      rewards: typeof a.rewards === 'string' ? a.rewards : undefined,
      maxFee: typeof a.maxFee === 'number' ? a.maxFee : BLANK.maxFee,
      spend: a.spend && typeof a.spend === 'object' ? (a.spend as Record<string, number>) : BLANK.spend,
    });
    setIndex(0);
  }, [open]);

  // A completed prior run (saved on finish) — lets us offer a jump straight
  // back to those matches from the intro step.
  const priorProfile = useMemo(() => loadProfile(), [open]);
  const hasPriorMatch = !!(priorProfile.filters?.length ||
    (priorProfile.answers && (priorProfile.answers.rewards || priorProfile.answers.type)));

  const seePriorMatches = () => onComplete({
    filters: priorProfile.filters || [],
    ownedCards: priorProfile.ownedCards || [],
    name: priorProfile.name,
    email: priorProfile.email,
    answers: priorProfile.answers,
  });

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const set = (patch: Partial<Answers>) => setAnswers(prev => ({ ...prev, ...patch }));

  // The step order branches on whether they already hold a card. Questions
  // come first; saving (name + email) is an optional last step, so nobody
  // has to hand over an email before seeing any value.
  const steps = useMemo(() => {
    const owns = answers.hasCard === true ? ['ownedCards', 'credit'] : [];
    return ['hasCard', ...owns, 'type', 'rewards', 'fee', 'spend', 'email'];
  }, [answers.hasCard]);

  const step = steps[Math.min(index, steps.length - 1)];
  const isLast = index >= steps.length - 1;

  // Every question is required to advance; the closing save step is optional.
  const answered = (() => {
    switch (step) {
      case 'email': return true;
      case 'hasCard': return answers.hasCard !== undefined;
      case 'ownedCards': return answers.ownedCards.length > 0;
      case 'credit': return !!answers.credit;
      case 'type': return !!answers.type;
      case 'rewards': return !!answers.rewards;
      default: return true; // fee + spend always have a value
    }
  })();

  const go = (n: number) => setIndex(Math.max(0, Math.min(steps.length - 1, n)));

  // `save: false` is the "skip" path: matches without storing name/email.
  const finish = (save = true) => onComplete({
    filters: deriveFilters(answers),
    ownedCards: answers.ownedCards,
    name: save ? `${answers.firstName} ${answers.lastName}`.trim() || undefined : undefined,
    email: save ? answers.email || undefined : undefined,
    answers: { credit: answers.credit, type: answers.type, rewards: answers.rewards, maxFee: answers.maxFee, spend: answers.spend, hasCard: answers.hasCard },
  });

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="compare-light fixed inset-0 z-50 overflow-y-auto bg-[var(--cl-bg)]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
        >
          <button
            onClick={onClose}
            aria-label="Close"
            className="fixed top-5 right-5 z-10 w-10 h-10 rounded-full bg-[var(--cl-panel)] border border-[var(--cl-hairline-strong)] text-[var(--cl-muted)] hover:text-[var(--cl-ink)] hover:border-[var(--cl-ink)] transition-colors flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>

          <motion.div
            className="min-h-full w-full max-w-xl mx-auto px-6 py-24 flex flex-col items-center justify-center text-center"
            initial={{ opacity: 0, scale: reducedMotion ? 1 : 0.96, y: reducedMotion ? 0 : 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: reducedMotion ? 1 : 0.97 }}
            transition={{ duration: reducedMotion ? 0.15 : 0.32, ease: [0.16, 1, 0.3, 1] }}
            onClick={e => e.stopPropagation()}
          >
            <motion.div
              key={step}
              initial={{ opacity: 0, x: reducedMotion ? 0 : 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: reducedMotion ? 0.16 : 0.28, ease: [0.16, 1, 0.3, 1] }}
              className="w-full flex flex-col items-center text-center"
            >
              {step === 'email' && <EmailStep answers={answers} set={set} />}
              {step === 'hasCard' && <HasCardStep answers={answers} set={set} />}
              {step === 'ownedCards' && <OwnedCardsStep answers={answers} set={set} />}
              {step === 'credit' && <CreditStep answers={answers} set={set} />}
              {step === 'type' && <TypeStep answers={answers} set={set} />}
              {step === 'rewards' && <RewardsStep answers={answers} set={set} />}
              {step === 'fee' && <FeeStep answers={answers} set={set} />}
              {step === 'spend' && <SpendStep answers={answers} set={set} />}
            </motion.div>

            <div className="flex items-center justify-center gap-3 mt-10">
              {step === 'email' ? (
                <>
                  <button
                    onClick={() => go(index - 1)}
                    aria-label="Back"
                    className="h-12 w-12 rounded-full bg-transparent border border-[var(--cl-hairline-strong)] text-[var(--cl-muted)] hover:text-[var(--cl-ink)] hover:border-[var(--cl-ink)] flex items-center justify-center transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => finish(false)}
                    className="px-6 py-3 rounded-full bg-transparent border border-[var(--cl-hairline-strong)] text-[var(--cl-muted)] hover:text-[var(--cl-ink)] hover:border-[var(--cl-ink)] font-medium transition-colors"
                  >
                    Skip — just show matches
                  </button>
                  <button
                    onClick={() => finish(true)}
                    className="px-8 py-3 rounded-full bg-[var(--cl-pill)] text-[var(--cl-pill-ink)] hover:opacity-90 font-bold flex items-center gap-2 transition-opacity"
                  >
                    Save & see matches <ChevronRight className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <>
                  {index > 0 && (
                    <button
                      onClick={() => go(index - 1)}
                      className="px-6 py-3 rounded-full bg-transparent border border-[var(--cl-hairline-strong)] text-[var(--cl-muted)] hover:text-[var(--cl-ink)] hover:border-[var(--cl-ink)] font-medium flex items-center gap-2 transition-colors"
                    >
                      <ChevronLeft className="w-4 h-4" /> Back
                    </button>
                  )}
                  {isLast ? (
                    <button
                      onClick={() => finish()}
                      className="px-8 py-3 rounded-full bg-[var(--cl-pill)] text-[var(--cl-pill-ink)] hover:opacity-90 font-bold flex items-center gap-2 transition-opacity"
                    >
                      Find My Matches <ChevronRight className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      onClick={() => go(index + 1)}
                      disabled={!answered}
                      className={`px-7 py-3 rounded-full font-semibold flex items-center gap-2 transition-opacity ${
                        answered ? 'bg-[var(--cl-pill)] text-[var(--cl-pill-ink)] hover:opacity-90' : 'bg-[var(--cl-hairline)] text-[var(--cl-muted)] cursor-not-allowed'
                      }`}
                    >
                      Continue <ChevronRight className="w-4 h-4" />
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Returning visitor: jump straight back to the matches from their
                last completed run, without redoing the questionnaire. */}
            {index === 0 && hasPriorMatch && (
              <button
                onClick={seePriorMatches}
                className="mt-8 text-sm font-medium text-[var(--cl-muted)] hover:text-[var(--cl-ink)] underline underline-offset-4 decoration-[var(--cl-hairline-strong)] hover:decoration-[var(--cl-ink)] transition-colors"
              >
                See my best matches from before →
              </button>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------- steps ------------------------------- */

function Heading({ title, hint }: { title: string; hint?: string }) {
  return (
    <>
      <h2 className="font-display font-bold text-2xl md:text-3xl text-[var(--cl-ink)] text-balance mb-2">{title}</h2>
      {hint && <p className="text-[var(--cl-muted)] text-sm mb-7 max-w-md">{hint}</p>}
      {!hint && <div className="mb-7" />}
    </>
  );
}

interface StepProps { answers: Answers; set: (p: Partial<Answers>) => void; }

function EmailStep({ answers, set }: StepProps) {
  const inputClass = 'flex-1 min-w-0 h-12 px-4 rounded-2xl bg-[var(--cl-bg)] border border-[var(--cl-hairline-strong)] text-[var(--cl-ink)] placeholder-[var(--cl-muted)] text-[15px] focus:outline-none focus:border-[var(--cl-gold)] transition-colors';
  return (
    <div className="w-full flex flex-col items-center">
      <Heading title="Save your matches?" hint="Optional. Add your name and email and we'll remember your cards and answers next time you visit on this device." />
      <div className="w-full max-w-md flex flex-col gap-3">
        <div className="flex gap-3">
          <input
            value={answers.firstName}
            onChange={e => set({ firstName: e.target.value })}
            placeholder="First name"
            className={inputClass}
          />
          <input
            value={answers.lastName}
            onChange={e => set({ lastName: e.target.value })}
            placeholder="Last name"
            className={inputClass}
          />
        </div>
        <input
          type="email"
          value={answers.email}
          onChange={e => set({ email: e.target.value })}
          placeholder="Email address"
          className="w-full h-12 px-4 rounded-2xl bg-[var(--cl-bg)] border border-[var(--cl-hairline-strong)] text-[var(--cl-ink)] placeholder-[var(--cl-muted)] text-[15px] focus:outline-none focus:border-[var(--cl-gold)] transition-colors"
        />
        <p className="text-xs text-[var(--cl-muted)] mt-1">No account, no password. We just use this to remember you.</p>
      </div>
    </div>
  );
}

const tileActive = 'bg-[var(--cl-panel)] border-[var(--cl-ink)] text-[var(--cl-ink)]';
const tileIdle = 'bg-transparent border-[var(--cl-hairline-strong)] text-[var(--cl-muted)] hover:border-[var(--cl-ink)] hover:text-[var(--cl-ink)]';

function HasCardStep({ answers, set }: StepProps) {
  return (
    <div className="w-full flex flex-col items-center">
      <Heading title="Do you have a credit card right now?" />
      <div className="flex flex-col sm:flex-row gap-4 w-full max-w-md">
        {[
          { v: true, label: 'Yes, I have one' },
          { v: false, label: 'No, this is my first' },
        ].map(o => (
          <button
            key={String(o.v)}
            onClick={() => set({ hasCard: o.v, ...(o.v ? {} : { ownedCards: [], credit: undefined }) })}
            aria-pressed={answers.hasCard === o.v}
            className={`flex-1 px-6 py-5 rounded-2xl border font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cl-ink)]/30 ${
              answers.hasCard === o.v ? tileActive : tileIdle
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function OwnedCardsStep({ answers, set }: StepProps) {
  const { cards } = useCards();
  const [query, setQuery] = useState('');
  const matches = query.trim()
    ? cards.filter(c => cardMatchesQuery(c, query)).slice(0, 6)
    : [];
  const add = (id: string) => { if (!answers.ownedCards.includes(id)) set({ ownedCards: [...answers.ownedCards, id] }); setQuery(''); };
  const remove = (id: string) => set({ ownedCards: answers.ownedCards.filter(x => x !== id) });

  return (
    <div className="w-full flex flex-col items-center">
      <Heading title="Which cards do you already have?" hint="Add at least one. These go straight to your Compare board." />
      <div className="w-full max-w-md">
        {answers.ownedCards.length > 0 && (
          <div className="flex flex-col gap-2 mb-3">
            {answers.ownedCards.map(id => {
              const c = cards.find(x => x.id === id);
              if (!c) return null;
              return (
                <div key={id} className="flex items-center gap-3 bg-[var(--cl-bg)] border border-[var(--cl-hairline-strong)] rounded-2xl p-2.5 pl-3">
                  <div className={`w-9 h-9 rounded-lg ${c.gradient} shrink-0`} />
                  <div className="flex-1 text-left min-w-0">
                    <div className="text-[var(--cl-ink)] font-medium text-sm truncate">{c.name}</div>
                    <div className="text-[var(--cl-muted)] text-xs uppercase tracking-wide">{c.issuer}</div>
                  </div>
                  <button onClick={() => remove(id)} aria-label={`Remove ${c.name}`} className="w-8 h-8 rounded-full text-[var(--cl-muted)] hover:text-[var(--cl-ink)] flex items-center justify-center shrink-0">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <div className="relative">
          <Search className="w-4 h-4 text-[var(--cl-muted)] absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search for a card…"
            className="w-full h-12 pl-11 pr-4 rounded-2xl bg-[var(--cl-bg)] border border-[var(--cl-hairline-strong)] text-[var(--cl-ink)] placeholder-[var(--cl-muted)] text-[15px] focus:outline-none focus:border-[var(--cl-gold)] transition-colors"
          />
        </div>
        {matches.length > 0 && (
          <div className="mt-2 bg-[var(--cl-bg)] border border-[var(--cl-hairline-strong)] rounded-2xl overflow-hidden">
            {matches.map(c => (
              <button key={c.id} onClick={() => add(c.id)} className="w-full flex items-center gap-3 p-2.5 pl-3 hover:bg-[var(--cl-panel)] transition-colors text-left">
                <div className={`w-8 h-8 rounded-lg ${c.gradient} shrink-0`} />
                <div className="flex-1 min-w-0">
                  <div className="text-[var(--cl-ink)] font-medium text-sm truncate">{c.name}</div>
                  <div className="text-[var(--cl-muted)] text-xs uppercase tracking-wide">{c.issuer}</div>
                </div>
                <Plus className="w-4 h-4 text-[var(--cl-gold)] shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CreditStep({ answers, set }: StepProps) {
  const opts = [
    { id: 'excellent', label: 'Excellent', sub: '720+' },
    { id: 'good', label: 'Good', sub: '690–719' },
    { id: 'fair', label: 'Fair', sub: '630–689' },
    { id: 'building', label: 'Building', sub: 'under 630' },
  ];
  return (
    <div className="w-full flex flex-col items-center">
      <Heading title="What's your credit score?" hint="A rough idea is plenty — no hard check." />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 w-full max-w-lg">
        {opts.map(o => (
          <button
            key={o.id}
            onClick={() => set({ credit: o.id })}
            aria-pressed={answers.credit === o.id}
            className={`p-5 rounded-2xl border flex flex-col items-center gap-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cl-ink)]/30 ${
              answers.credit === o.id ? tileActive : tileIdle
            }`}
          >
            <span className="font-display font-semibold text-lg">{o.label}</span>
            <span className="text-xs opacity-70">{o.sub}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function TypeStep({ answers, set }: StepProps) {
  return (
    <div className="w-full flex flex-col items-center">
      <Heading title="What type of card are you after?" />
      <ToggleRow
        options={[{ id: 'personal', label: 'Personal' }, { id: 'business', label: 'Business' }, { id: 'students', label: 'Student' }]}
        active={answers.type}
        onChange={id => set({ type: id })}
      />
    </div>
  );
}

function RewardsStep({ answers, set }: StepProps) {
  return (
    <div className="w-full flex flex-col items-center">
      <Heading title="How do you want your rewards?" />
      <ToggleRow
        large
        options={[
          { id: 'cashback', label: 'Cash Back', desc: 'Simple statement credits' },
          { id: 'points', label: 'Rewards Points', desc: 'Miles for travel & upgrades' },
        ]}
        active={answers.rewards}
        onChange={id => set({ rewards: id })}
      />
    </div>
  );
}

function RangeSlider({ value, min = 0, max, step = 1, onChange, ariaLabel }: {
  value: number; min?: number; max: number; step?: number; onChange: (v: number) => void; ariaLabel: string;
}) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div className="relative w-full h-1.5 bg-[var(--cl-hairline)] rounded-full">
      <div className="absolute top-0 left-0 h-full bg-[var(--cl-pill)] rounded-full" style={{ width: `${pct}%` }}>
        <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-4 h-4 bg-[var(--cl-ink)] rounded-full border-2 border-[var(--cl-bg)] shadow-md" />
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseInt(e.target.value))}
        className="absolute inset-0 w-full opacity-0 cursor-pointer z-10"
        aria-label={ariaLabel}
      />
    </div>
  );
}

function FeeStep({ answers, set }: StepProps) {
  // The slider moves between discrete PRD stops, not a continuous range.
  const idx = Math.max(0, FEE_STOPS.indexOf(answers.maxFee));
  const isMax = answers.maxFee >= FEE_STOPS[FEE_STOPS.length - 1];
  return (
    <div className="w-full flex flex-col items-center">
      <Heading title="Maximum annual fee I'm willing to pay" hint="We'll only recommend cards at or below this annual fee." />
      <div className="w-full max-w-md">
        <div className="font-display font-bold text-5xl text-[var(--cl-ink)] mb-6">${answers.maxFee}{isMax ? '+' : ''}</div>
        <RangeSlider
          value={idx}
          max={FEE_STOPS.length - 1}
          onChange={i => set({ maxFee: FEE_STOPS[i] })}
          ariaLabel="Maximum annual fee"
        />
        <div className="flex justify-between mt-3 px-0.5">
          {FEE_STOPS.map((f, i) => (
            <span key={f} className={`text-[11px] tabular-nums ${i === idx ? 'text-[var(--cl-ink)] font-semibold' : 'text-[var(--cl-muted)]'}`}>
              {f === FEE_STOPS[FEE_STOPS.length - 1] ? `${f}+` : f}
            </span>
          ))}
        </div>
        <p className="text-[var(--cl-muted)] text-sm mt-5">{answers.maxFee === 0 ? 'Targeting cards with no annual fee' : 'Cards above this fee are shown separately, never mixed in'}</p>
      </div>
    </div>
  );
}

function SpendStep({ answers, set }: StepProps) {
  return (
    <div className="w-full flex flex-col items-center">
      <Heading title="Roughly, how much do you spend each month?" hint="Drag to set your typical monthly spend. This is how we rank cards for your wallet." />
      <div className="grid grid-cols-1 sm:grid-cols-2 w-full max-w-3xl gap-x-8 gap-y-1">
        {SPEND_CATS.map(cat => {
          const val = answers.spend[cat.key] ?? 0;
          const isMax = val >= SPEND_MAX;
          return (
            <div key={cat.key} className="py-3.5 border-b border-[var(--cl-hairline)]">
              <div className="flex items-baseline justify-between mb-2.5">
                <span className="font-medium text-[var(--cl-ink)] text-[15px]">{cat.label}</span>
                <span className="font-display font-semibold text-[var(--cl-ink)] tabular-nums">${val}{isMax ? '+' : ''}<span className="text-[var(--cl-muted)] text-xs font-normal">/mo</span></span>
              </div>
              <RangeSlider
                value={val}
                max={SPEND_MAX}
                step={50}
                onChange={v => set({ spend: { ...answers.spend, [cat.key]: v } })}
                ariaLabel={`${cat.label} monthly spend`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ToggleRow({ options, active, onChange, large = false }: { options: { id: string; label: string; desc?: string }[]; active?: string; onChange: (id: string) => void; large?: boolean }) {
  return (
    <div className="flex flex-col sm:flex-row gap-3 w-full max-w-lg">
      {options.map(opt => (
        <button
          key={opt.id}
          onClick={() => onChange(opt.id)}
          aria-pressed={active === opt.id}
          className={`flex-1 rounded-2xl border p-5 flex flex-col items-center gap-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cl-ink)]/30 ${
            active === opt.id ? tileActive : tileIdle
          }`}
        >
          <span className={large ? 'text-lg font-display font-semibold' : 'font-medium'}>{opt.label}</span>
          {opt.desc && <span className="text-xs opacity-70">{opt.desc}</span>}
        </button>
      ))}
    </div>
  );
}
