import { useState, useCallback, useEffect, useMemo } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { ChevronLeft, ChevronRight, ChevronDown, Sparkles, Plus, X, ArrowUpRight, ShieldCheck, Receipt, Scale, Coins } from 'lucide-react';
import CardVisual from './CardVisual';
import CardFacts from './CardFacts';
import BubbleFilters from './BubbleFilters';
import AISearchBar from './AISearchBar';
import { buildDeck } from '../lib/ranking';
import { describeFilters } from '../lib/filters';
import { fetchAdvisorNote, advisorEnabled } from '../lib/advisor';
import { pushRecentlyViewed } from '../lib/recentlyViewed';
import CardInsightsPanel from './CardInsightsPanel';
import ValueBlock from './ValueBlock';
import { MonthlySpend } from '../lib/insights';
import { useCards } from '../hooks/useCards';
import { CreditCard } from '../types';

// Friendly names for the provider filter; unknown slugs fall back to a
// title-cased version of the slug.
const PROVIDER_LABELS: Record<string, string> = {
  chase: 'Chase', citi: 'Citi', capital_one: 'Capital One', amex: 'American Express',
  wells_fargo: 'Wells Fargo', us_bank: 'U.S. Bank', discover: 'Discover',
  barclays: 'Barclays', bank_of_america: 'Bank of America', synchrony: 'Synchrony',
};
const providerLabel = (p: string) =>
  PROVIDER_LABELS[p] ?? p.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// Landing-page trust strip. Every claim must stay literally true of the
// product: no issuer pays for placement (there are no affiliate links), and
// no credit data is ever requested.
const TRUST_POINTS = [
  { icon: ShieldCheck, title: 'No credit check', body: 'Seeing your matches never touches your credit score.' },
  { icon: Receipt, title: 'Fees counted, not hidden', body: 'Every estimate subtracts the annual fee before you see it.' },
  { icon: Scale, title: 'Not paid to rank', body: 'No card issuer pays for placement or a better spot.' },
  { icon: Coins, title: 'Honest point values', body: 'Points and miles are valued conservatively, not at best-case.' },
];

const RANK_STEPS = [
  { title: 'Your spending', body: 'Groceries, dining, gas, travel and everything else, in your own monthly dollars.' },
  { title: 'Dollars after fees', body: 'Each card’s rewards on that spending, plus any bonus, minus its annual fee.' },
  { title: 'Fit for you', body: 'Approval odds for your credit and what your current cards already cover.' },
];

const FEATURED_CARD_NAME ='Costco Anywhere Visa® Card by Citi';

interface CardCarouselProps {
  watchlist: string[];
  setWatchlist: React.Dispatch<React.SetStateAction<string[]>>;
  filters: string[];
  setFilters: React.Dispatch<React.SetStateAction<string[]>>;
  ownedCards: string[];
  matchMode: boolean;
  matchAnswers?: Record<string, unknown>;
  onBrowseAll: () => void;
  startWithResults?: boolean;
  onIntroComplete?: () => void;
  /** Opens the Find My Card quiz (the landing page's primary action). */
  onFindMatches?: () => void;
}

export default function CardCarousel({
  watchlist, setWatchlist,
  filters: activeFilters, setFilters: setActiveFilters,
  ownedCards, matchMode, matchAnswers, onBrowseAll, startWithResults = false, onIntroComplete, onFindMatches,
}: CardCarouselProps) {
  const { cards: allCards } = useCards();
  const [cards, setCards] = useState<CreditCard[]>(allCards);
  const [ranked, setRanked] = useState(false);
  const [complement, setComplement] = useState(false);
  const [aboveLimit, setAboveLimit] = useState<CreditCard[]>([]);
  // Per-card "why this fits you" bullets from the recommender (match mode).
  const [explanations, setExplanations] = useState<Record<string, string[]>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [providerFilter, setProviderFilter] = useState('all');
  // The query submitted on the landing hero, carried into the results bar.
  const [lastQuery, setLastQuery] = useState('');
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  // The quiz's monthly spend answers, when there are any, personalise the
  // value estimate; otherwise ValueBlock uses typical spending.
  const userSpend = useMemo(() => {
    const raw = matchAnswers?.spend;
    if (!raw || typeof raw !== 'object') return undefined;
    return raw as MonthlySpend;
  }, [matchAnswers]);
  // Landing state: on first load show only the centered search + filters; the
  // deck appears once the user searches or picks a filter.
  const [started, setStarted] = useState(startWithResults);
  const reducedMotion = useReducedMotion();

  // Distinct providers present in the deck, for the filter dropdown.
  const providers = useMemo(
    () => [...new Set(allCards.map((c) => c.provider).filter(Boolean) as string[])].sort(),
    [allCards],
  );

  // Rebuild the deck whenever the inputs to ranking change. Ranked decks
  // are deterministic (best-first, stable); browse decks are shuffled.
  useEffect(() => {
    const pool = providerFilter === 'all' ? allCards : allCards.filter((c) => c.provider === providerFilter);
    const result = buildDeck(pool, activeFilters, ownedCards, matchMode, matchAnswers);
    const featured = pool.find((card) => card.name.includes(FEATURED_CARD_NAME));
    const deck = (!matchMode && activeFilters.length === 0 && providerFilter === 'all' && featured)
      ? [featured, ...result.deck.filter((card) => card.id !== featured.id)]
      : result.deck;
    setCards(deck);
    setRanked(result.ranked);
    setComplement(result.complement);
    setAboveLimit(result.aboveAnnualFeeLimit?.map((r) => r.card) || []);
    setExplanations(Object.fromEntries((result.results || []).map((r) => [r.card.id, r.explanation])));
    setCurrentIndex(0);
  }, [allCards, activeFilters, ownedCards, matchMode, matchAnswers, providerFilter]);

  const nextCard = useCallback(() => {
    setCurrentIndex((prev) => (prev + 1) % cards.length);
  }, [cards.length]);

  const prevCard = useCallback(() => {
    setCurrentIndex((prev) => (prev - 1 + cards.length) % cards.length);
  }, [cards.length]);

  // Arrow keys browse the deck, except while typing in a field.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') prevCard();
      if (e.key === 'ArrowRight') nextCard();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [nextCard, prevCard]);

  const cardTransition = reducedMotion
    ? { duration: 0 }
    : { type: "spring" as const, stiffness: 300, damping: 30, mass: 0.8 };

  const activeCard = cards[currentIndex];
  const filterDetail = describeFilters(activeFilters);
  const rankLabel = filterDetail
    ? `best choice for ${filterDetail}`
    : complement ? 'best choice for you' : 'best match';
  // Results appear only after an explicit submit (Enter / arrow) or a Find Me
  // a Card match. Landing filters can be staged without navigating away.
  const showResults = matchMode || started;
  // Show the tailored reasoning only in match mode (Find Me a Card results).
  // Rendered as "Fits you because" in the insights panel, not under the name.
  const activeWhy = matchMode && activeCard ? explanations[activeCard.id] : undefined;

  // AI advisor note (Phase 2) for the active best-match card. Only runs when
  // the endpoint is configured; degrades to nothing otherwise.
  const [advisorNote, setAdvisorNote] = useState<string | null>(null);
  const [advisorLoading, setAdvisorLoading] = useState(false);
  useEffect(() => {
    setAdvisorNote(null);
    setAdvisorLoading(false);
    if (!advisorEnabled || !activeCard || !activeWhy || activeWhy.length === 0) return;
    const card = {
      id: activeCard.id, name: activeCard.name, issuer: activeCard.issuer,
      annualFee: activeCard.facts.annualFee, rewards: activeCard.facts.rewards,
      topPerk: activeCard.facts.topPerk, bonus: activeCard.facts.bonus, tags: activeCard.tags,
    };
    const profile = {
      ownedCardNames: ownedCards.map((id) => allCards.find((c) => c.id === id)?.name).filter(Boolean) as string[],
      spend: matchAnswers?.spend as Record<string, number> | undefined,
      credit: matchAnswers?.credit as string | undefined,
      maxFee: matchAnswers?.maxFee as number | undefined,
      rewardPref: activeFilters.includes('cashback') ? 'cash back' : activeFilters.includes('rewards') ? 'points/miles' : 'no preference',
      whyBullets: activeWhy,
    };
    let cancelled = false;
    setAdvisorLoading(true);
    fetchAdvisorNote(card, profile).then((note) => {
      if (!cancelled) { setAdvisorNote(note); setAdvisorLoading(false); }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCard?.id, matchMode, explanations]);

  // Remember the focused card for the "Recently viewed" rail (Compare page) —
  // only once results are shown, so the hero deck doesn't pollute the list.
  useEffect(() => {
    if (showResults && activeCard) pushRecentlyViewed(activeCard.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCard?.id, showResults]);

  // The carousel only mounts the cards next to the current one, so warm the
  // browser cache with the whole deck's art (~12KB each, self-hosted) and
  // swiping never waits on a download.
  useEffect(() => {
    if (!showResults) return;
    for (const card of cards) {
      if (card.imageUrl) new Image().src = card.imageUrl;
    }
  }, [cards, showResults]);

  // Landing hero: nothing but the search, centered on the page.
  if (!showResults) {
    return (
      <section className="compare-light cards-page relative w-full flex flex-col items-center px-6 pt-32 pb-20 sm:px-12 md:pt-40 lg:px-24">
        <div className="w-full max-w-4xl flex flex-col items-center gap-8">
          {/* The promise, in the user's terms: money back, after fees. */}
          <div className="text-center">
            <p className="inline-flex items-center gap-2 rounded-full border border-[var(--cl-hairline)] bg-[var(--cl-surface)] px-3.5 py-1.5 text-xs font-medium text-[var(--cl-muted)]">
              <ShieldCheck className="h-3.5 w-3.5 text-[var(--cl-value)]" aria-hidden="true" />
              Independent · No sign-up · No credit check
            </p>
            <h1 className="mt-6 font-editorial text-[clamp(2.6rem,6vw,4.6rem)] leading-[1.02] text-[var(--cl-ink)] text-balance">
              Find the card that <em className="text-[var(--cl-value)]">actually</em> pays you back.
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-base md:text-lg text-[var(--cl-muted)] text-balance">
              Tell us how you spend. We rank {allCards.length} cards from {providers.length} major issuers by what each is worth to you in dollars a year — after fees.
            </p>
          </div>

          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <button
              onClick={onFindMatches}
              className="h-12 px-7 rounded-full bg-[var(--cl-pill)] text-[var(--cl-pill-ink)] font-semibold flex items-center gap-2 shadow-[0_14px_30px_-18px_oklch(0.27_0.06_262/0.8)] hover:opacity-95 transition-opacity"
            >
              Get my matches <span className="font-normal opacity-70">· 2 min</span> <ChevronRight className="h-4 w-4" />
            </button>
            <span className="text-sm text-[var(--cl-muted)]">or search below</span>
          </div>

          <AISearchBar
            submitOnly
            onQueryChange={setLastQuery}
            onFiltersParsed={setActiveFilters}
            examples={[
              'cashback cards with no annual fee for students',
              'rewards travel card under $300',
              'business card with gas rewards',
              'premium dining card with no foreign fees',
            ]}
            onSubmit={() => {
              setStarted(true);
              onIntroComplete?.();
            }}
            leftSlot={
              <div className="relative flex items-center">
                <select
                  value={providerFilter}
                  onChange={(e) => setProviderFilter(e.target.value)}
                  aria-label="Filter by card provider"
                  className="appearance-none bg-transparent text-sm text-[var(--cl-ink)] pl-1 pr-6 py-1 focus:outline-none cursor-pointer max-w-[9rem] truncate"
                >
                  <option value="all">All providers</option>
                  {providers.map((p) => (
                    <option key={p} value={p}>{providerLabel(p)}</option>
                  ))}
                </select>
                <ChevronDown className="w-4 h-4 absolute right-0 pointer-events-none text-[var(--cl-muted)]" />
              </div>
            }
          />
        </div>

        {/* Trust strip: the four worries people bring to card shopping, each
            answered with something this product actually does. */}
        <ul className="mt-16 grid w-full max-w-5xl gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {TRUST_POINTS.map(({ icon: Icon, title, body }) => (
            <li key={title} className="rounded-2xl border border-[var(--cl-hairline)] bg-[var(--cl-surface)] p-5">
              <Icon className="h-5 w-5 text-[var(--cl-value)]" aria-hidden="true" />
              <p className="mt-3 font-semibold text-[var(--cl-ink)]">{title}</p>
              <p className="mt-1 text-sm leading-relaxed text-[var(--cl-muted)]">{body}</p>
            </li>
          ))}
        </ul>

        {/* How we rank: the method in three plain steps. */}
        <div className="mt-20 w-full max-w-5xl">
          <h2 className="text-center font-editorial text-3xl md:text-4xl text-[var(--cl-ink)]">How we rank cards</h2>
          <ol className="mt-8 grid gap-6 md:grid-cols-3">
            {RANK_STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-4">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--cl-pill)] text-sm font-semibold text-[var(--cl-pill-ink)]">{i + 1}</span>
                <div>
                  <p className="font-semibold text-[var(--cl-ink)]">{step.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-[var(--cl-muted)]">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>
    );
  }

  return (
    <section className="compare-light cards-page relative w-full min-h-screen pt-[7.6rem] pb-8 flex flex-col items-center bg-[var(--cl-bg)] md:pt-[clamp(4.25rem,7vh,6.1rem)] md:pb-0">
      {matchMode && (
        <div className="relative z-20 w-full flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 text-center mb-8 md:mb-10">
          <h2 className="font-display font-semibold text-3xl md:text-4xl text-[var(--cl-ink)]">Your best matches</h2>
          <button
            onClick={() => { setStarted(true); onBrowseAll(); }}
            className="shrink-0 h-7 px-3 rounded-full bg-transparent border border-[var(--cl-hairline-strong)] flex items-center gap-1.5 hover:bg-[var(--cl-panel)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cl-ink)]/30 transition-colors text-[var(--cl-muted)] hover:text-[var(--cl-ink)] text-xs"
          >
            Browse all cards instead
          </button>
        </div>
      )}

      {/* Auto-margins center the whole group vertically when it fits, and cleanly
          top-align + scroll (never clip) when the viewport is too short. */}
      <div className="w-full flex flex-col items-center">
      {!matchMode && (
        <div className="relative z-40 mb-6 flex w-full flex-col items-center gap-3 md:hidden">
          <div className="w-full px-4">
            <AISearchBar
              compact
              initialValue={lastQuery}
              onQueryChange={(q) => { if (q.trim()) setStarted(true); }}
              onFiltersParsed={setActiveFilters}
              leftSlot={
                <div className="relative flex items-center">
                  <select
                    value={providerFilter}
                    onChange={(e) => setProviderFilter(e.target.value)}
                    aria-label="Filter by card provider"
                    className="appearance-none bg-transparent text-[12px] text-[var(--cl-ink)] pl-1 pr-5 py-0.5 focus:outline-none cursor-pointer max-w-[7.5rem] truncate"
                  >
                    <option value="all">All providers</option>
                    {providers.map((p) => (
                      <option key={p} value={p}>{providerLabel(p)}</option>
                    ))}
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 absolute right-0 pointer-events-none text-[var(--cl-muted)]" />
                </div>
              }
            />
          </div>
          {/* On phones the chips would push the card below the fold, so they
              live behind a toggle that shows how many are active. */}
          <button
            onClick={() => setMobileFiltersOpen((o) => !o)}
            aria-expanded={mobileFiltersOpen}
            className="h-8 px-4 rounded-full border border-[var(--cl-hairline-strong)] text-xs font-medium text-[var(--cl-ink)] flex items-center gap-1.5"
          >
            Refine{activeFilters.length ? ` · ${activeFilters.length} active` : ''}
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${mobileFiltersOpen ? 'rotate-180' : ''}`} />
          </button>
          {mobileFiltersOpen && <BubbleFilters activeFilters={activeFilters} onFiltersChange={setActiveFilters} />}
        </div>
      )}
      {activeCard ? (
      <>
      {/* Centered stage: caps its width on large monitors and scales fluidly so
          it fits every desktop height. The whole section is vertically centered
          and grows to scroll only on very short screens (never clips). */}
      <div className="w-full flex flex-col gap-8 max-w-[104rem] mx-auto md:gap-[clamp(1.25rem,3.2vh,3.35rem)]">
      {/* Upper: carousel (left) + analysis (right). Fixed (fluid) height on
          desktop so the card sits at the same spot regardless of how tall the
          active card's analysis panel is — keeps positions stable across cards. */}
      <div className="relative z-10 w-full px-4 grid grid-cols-1 lg:grid-cols-[1.12fr_1.08fr] gap-7 md:px-[clamp(1.25rem,3vw,3.5rem)] lg:gap-[clamp(2.75rem,4.2vw,4.75rem)] items-center lg:h-[clamp(330px,38vh,430px)]">
        {/* Left: carousel (edges fade into the page bg) with the controls
            sitting directly below the main card. */}
        <div className="flex flex-col items-center">
          <div className="cards-dot-stage relative w-full h-[250px] md:h-[clamp(280px,34vh,400px)] flex items-center justify-center [perspective:1400px] overflow-hidden [mask-image:radial-gradient(ellipse_at_center,#000_0%,#000_56%,rgba(0,0,0,0.62)_70%,transparent_90%)]">
          <div className="relative w-full h-full flex justify-center items-center [transform-style:preserve-3d]">
          <AnimatePresence initial={false}>
            {cards.map((card, index) => {
              // Calculate circular offset
              let offset = index - currentIndex;
              const total = cards.length;
              if (offset > Math.floor(total / 2)) offset -= total;
              if (offset < -Math.floor(total / 2)) offset += total;

              // Product-shot composition: one hero card, one softened card on
              // either side. Extra cards stay out of view until navigated to.
              const isVisible = Math.abs(offset) <= 1;
              if (!isVisible) return null;

              const isCenter = offset === 0;
              const depth = Math.abs(offset);

              return (
                <motion.div
                  key={card.id}
                  initial={false}
                  animate={{
                    x: isCenter
                      ? -8
                      : `calc(${offset * 104}% + ${offset * (window.innerWidth < 768 ? 16 : 68)}px)`,
                    y: isCenter ? -2 : 8,
                    scale: isCenter ? 1.06 : 0.68,
                    rotateY: reducedMotion ? 0 : isCenter ? -16 : offset * -7,
                    rotateX: reducedMotion ? 0 : isCenter ? 2.4 : 0.8,
                    rotateZ: reducedMotion ? 0 : isCenter ? 1.2 : offset * -2,
                    z: isCenter ? 130 : -170,
                    // Neighbours stay recognisable (lighter blur/fade) so it's
                    // obvious there are more cards to swipe through.
                    opacity: isCenter ? 1 : 0.6,
                    filter: `blur(${isCenter ? 0 : 2}px) saturate(${isCenter ? 1 : 0.8}) brightness(${isCenter ? 1 : 1.08})`,
                  }}
                  transition={cardTransition}
                  className={`absolute origin-center will-change-transform ${isCenter ? 'z-20 cursor-default' : depth === 1 ? 'z-10 cursor-pointer' : 'z-0 cursor-pointer'}`}
                  onClick={() => {
                    if (offset < 0) prevCard();
                    if (offset > 0) nextCard();
                  }}
                >
                  <CardVisual card={card} variant="fluid" />
                </motion.div>
              );
            })}
          </AnimatePresence>
          </div>
          </div>
          {cards.length > 1 && (
            <p className="relative z-10 -mt-3 mb-5 text-xs font-medium tabular-nums text-[var(--cl-muted)]" aria-live="polite">
              {currentIndex + 1} of {cards.length}
            </p>
          )}
          {/* Carousel controls, right below the main card: prev · watchlist ·
              visit · next. Labels reveal on hover. */}
          <div className="shrink-0 -mt-4 flex items-center justify-center gap-4">
            <button
              onClick={prevCard}
              aria-label="Previous card"
              className="h-10 w-10 rounded-full bg-[var(--cl-bg)] border border-[var(--cl-hairline-strong)] shadow-sm hover:bg-[var(--cl-panel)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cl-ink)]/30 transition-colors text-[var(--cl-muted)] hover:text-[var(--cl-ink)] flex items-center justify-center"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="group relative flex items-center justify-center">
              <button
                onClick={() => setWatchlist((prev) => (prev.includes(activeCard.id) ? prev.filter((id) => id !== activeCard.id) : [...prev, activeCard.id]))}
                aria-label={watchlist.includes(activeCard.id) ? `Remove ${activeCard.name} from watchlist` : `Add ${activeCard.name} to watchlist`}
                className="h-10 w-10 rounded-full bg-[var(--cl-bg)] border border-[var(--cl-hairline-strong)] shadow-sm text-[var(--cl-muted)] hover:text-[var(--cl-ink)] hover:border-[var(--cl-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cl-ink)]/30 transition-colors flex items-center justify-center"
              >
                {watchlist.includes(activeCard.id) ? <X className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
              </button>
              <span className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-2 whitespace-nowrap text-[9px] font-semibold uppercase tracking-wider text-[var(--cl-muted)] opacity-0 group-hover:opacity-100 transition-opacity duration-150">{watchlist.includes(activeCard.id) ? 'Saved' : 'Watchlist'}</span>
            </div>
            <div className="group relative flex items-center justify-center">
              {activeCard.applyUrl ? (
                <a
                  href={activeCard.applyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Visit ${activeCard.name} on the issuer's site`}
                  className="h-10 w-10 rounded-full bg-[var(--cl-pill)] text-[var(--cl-pill-ink)] shadow-sm hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cl-ink)]/40 transition-opacity flex items-center justify-center"
                >
                  <ArrowUpRight className="w-5 h-5" />
                </a>
              ) : (
                <span aria-hidden="true" title="Application link unavailable" className="h-10 w-10 rounded-full bg-[var(--cl-pill)]/30 text-[var(--cl-pill-ink)]/50 flex items-center justify-center cursor-not-allowed">
                  <ArrowUpRight className="w-5 h-5" />
                </span>
              )}
              <span className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-2 whitespace-nowrap text-[9px] font-semibold uppercase tracking-wider text-[var(--cl-gold)] opacity-0 group-hover:opacity-100 transition-opacity duration-150">Visit</span>
            </div>
            <button
              onClick={nextCard}
              aria-label="Next card"
              className="h-10 w-10 rounded-full bg-[var(--cl-bg)] border border-[var(--cl-hairline-strong)] shadow-sm hover:bg-[var(--cl-panel)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cl-ink)]/30 transition-colors text-[var(--cl-muted)] hover:text-[var(--cl-ink)] flex items-center justify-center"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Right: compact analysis */}
        <div className="hidden lg:block">
          <CardInsightsPanel card={activeCard} whyBullets={activeWhy} />
        </div>
      </div>

      {/* Lower: card identity + headline facts. Fixed (fluid) height, content
          top-aligned, so the title starts at a constant vertical point and the
          search bar below always begins at the same place across cards. */}
      <div aria-live="polite" className="relative z-20 w-full flex flex-col items-center gap-[clamp(1.5rem,3vh,2.35rem)] px-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeCard.id}
            initial={{ opacity: 0, y: reducedMotion ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            transition={{ duration: reducedMotion ? 0 : 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="w-full flex flex-col items-center"
          >
            {/* Card name, centered. Watchlist / Visit actions live in the
                carousel control row beneath the card. */}
            <div className="w-full flex justify-center px-2">
              <div className="text-center">
                <p className="font-display text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--cl-muted)] mb-2">{activeCard.issuer}</p>
                <h1 className="font-editorial text-[clamp(1.9rem,2.6vw,2.6rem)] leading-[1.05] text-[var(--cl-ink)] text-balance">{activeCard.name}</h1>
                {ranked && (
                  <p className="mt-3 inline-flex items-center gap-2 rounded-full border border-[var(--cl-hairline)] bg-[var(--cl-surface)] px-3 py-1 text-xs text-[var(--cl-muted)]">
                    <span className="font-semibold text-[var(--cl-ink)]">#{currentIndex + 1}</span> {rankLabel}
                  </p>
                )}
              </div>
            </div>

            {advisorLoading ? (
              <p className="mt-2 flex items-center justify-center gap-2 text-xs text-[var(--cl-muted)]">
                <Sparkles className="w-3.5 h-3.5 animate-pulse text-[var(--cl-gold)]" /> Analyzing your wallet…
              </p>
            ) : advisorNote ? (
              <p className="mt-2 max-w-md mx-auto text-sm text-[var(--cl-ink)] leading-relaxed text-center">
                <Sparkles className="inline w-3.5 h-3.5 text-[var(--cl-gold)] mr-1 align-[-0.15em]" />{advisorNote}
              </p>
            ) : null}
          </motion.div>
        </AnimatePresence>

        {/* The headline number: this card's value to the user, fee included. */}
        <ValueBlock card={activeCard} spend={userSpend} />

        <div className="w-full lg:hidden">
          <CardInsightsPanel card={activeCard} whyBullets={activeWhy} />
        </div>

        {/* Headline facts: Annual Fee · Rewards · Sign-up Bonus */}
        <CardFacts card={activeCard} />
      </div>
      </div>

      {/* PARKED FOR THE FUTURE: the "cards above your selected annual fee
          limit" suggestions. Stashed off with `false &&` — the aboveLimit
          data still computes in buildDeck/effect, so re-enabling is just
          deleting the `false &&`. */}
      {false && matchMode && aboveLimit.length > 0 && (
        <div className="relative z-10 mt-5 w-full max-w-3xl px-4">
          <div className="border-t border-[var(--cl-hairline)] pt-4 text-center">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--cl-muted)]">Cards above your selected annual fee limit</p>
            <p className="mt-2 text-sm text-[var(--cl-muted)]">
              {aboveLimit.slice(0, 3).map((card, i) => (
                <span key={card.id}>
                  {i > 0 && ' · '}
                  {card.applyUrl ? (
                    <a
                      href={card.applyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline decoration-[var(--cl-hairline-strong)] underline-offset-2 hover:text-[var(--cl-ink)] transition-colors"
                    >
                      {card.name}
                    </a>
                  ) : (
                    card.name
                  )}
                </span>
              ))}
            </p>
          </div>
        </div>
      )}
      </>
      ) : (
        <div className="relative z-20 mt-24 md:mt-32 px-6 text-center flex flex-col items-center gap-3">
          <p className="font-display text-2xl md:text-3xl text-[var(--cl-ink)]">No cards match these filters</p>
          <p className="text-sm text-[var(--cl-muted)] max-w-sm">These categories are strict — try removing one to widen the results.</p>
          <button
            onClick={() => { setActiveFilters([]); setProviderFilter('all'); }}
            className="mt-2 h-10 px-5 rounded-full bg-[var(--cl-pill)] text-[var(--cl-pill-ink)] text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Bottom refine bar: provider (inside the bar) + search + filters.
          Small top gap (less padding before the search bar); the section's
          pb-8 plus the natural bottom slack open the space below it. */}
      {!matchMode && (
        <div className="cards-bottom-dock z-40 mt-10 hidden w-full flex-col items-center gap-3 md:sticky md:bottom-0 md:flex">
          <div className="w-full px-4">
            <AISearchBar
              compact
              initialValue={lastQuery}
              onQueryChange={(q) => { if (q.trim()) setStarted(true); }}
              onFiltersParsed={setActiveFilters}
              leftSlot={
                <div className="relative flex items-center">
                  <select
                    value={providerFilter}
                    onChange={(e) => setProviderFilter(e.target.value)}
                    aria-label="Filter by card provider"
                    className="appearance-none bg-transparent text-[11px] text-[var(--cl-ink)] pl-1 pr-4 py-0 focus:outline-none cursor-pointer max-w-[7rem] truncate"
                  >
                    <option value="all">All providers</option>
                    {providers.map((p) => (
                      <option key={p} value={p}>{providerLabel(p)}</option>
                    ))}
                  </select>
                  <ChevronDown className="w-3 h-3 absolute right-0 pointer-events-none text-[var(--cl-muted)]" />
                </div>
              }
            />
          </div>
          <BubbleFilters activeFilters={activeFilters} onFiltersChange={setActiveFilters} desktopCompact />
        </div>
      )}
      </div>
    </section>
  );
}
