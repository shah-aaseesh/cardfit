import { useState, useCallback, useEffect, useMemo } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { ChevronLeft, ChevronRight, ChevronDown, Sparkles, Plus, X, Check, ArrowUpRight, ShieldCheck, Receipt, Scale, Coins, Trophy, LayoutGrid } from 'lucide-react';
import CardVisual from './CardVisual';
import FinePrint from './FinePrint';
import BubbleFilters from './BubbleFilters';
import AISearchBar from './AISearchBar';
import { buildDeck, chipSpendBasis, getTopCards } from '../lib/ranking';
import { describeFilters } from '../lib/filters';
import { fetchAdvisorNote, advisorEnabled } from '../lib/advisor';
import { pushRecentlyViewed } from '../lib/recentlyViewed';
import ValueBlock, { ValueNotes } from './ValueBlock';
import HeroPreview from './HeroPreview';
import Sparkle from './Sparkle';
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

const TRUST_COLORS = ['bg-[var(--cl-lime)]', 'bg-[var(--cl-sky)]', 'bg-[var(--cl-pink)]', 'bg-[var(--cl-sun)]'];

const RANK_STEPS = [
  { title: 'Your spending', body: 'Groceries, dining, gas, travel and everything else, in your own monthly dollars.' },
  { title: 'Dollars after fees', body: 'Each card’s rewards on that spending, minus its annual fee, with any welcome bonus spread over two years.' },
  { title: 'Fit for you', body: 'Harder-to-get cards count for less, and only rewards your current cards don’t already earn count.' },
];


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
  const { cards: allCards, allCards: everyCard } = useCards();
  const [cards, setCards] = useState<CreditCard[]>(allCards);
  const [ranked, setRanked] = useState(false);
  const [aboveLimit, setAboveLimit] = useState<CreditCard[]>([]);
  // Per-card "why this fits you" bullets from the recommender (match mode).
  const [explanations, setExplanations] = useState<Record<string, string[]>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  // "View all": the whole deck as a grid, since clicking through 39 Chase
  // cards one at a time is no way to find a specific one.
  const [gridOpen, setGridOpen] = useState(false);
  // Ranked decks: cards[0, topCount) are the ranked top picks, the rest are
  // unranked further matches. atEnd is the "that's the top N" step shown
  // after the last top pick, before the further matches.
  const [topCount, setTopCount] = useState(0);
  const [byValue, setByValue] = useState(false);
  const [atEnd, setAtEnd] = useState(false);
  const [providerFilter, setProviderFilter] = useState('all');
  // The query submitted on the landing hero, carried into the results bar.
  const [lastQuery, setLastQuery] = useState('');
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  // Landing preview: the real top-3 rewards cards (with art), ranked by the
  // same engine as the results page.
  const preview = useMemo(() => {
    const ranked = getTopCards(allCards, { filters: ['rewards'] }, 40).map((r) => r.card);
    const cards = ranked.filter((c) => c.imageUrl).slice(0, 3);
    return { cards, topRank: ranked.indexOf(cards[0]) + 1 };
  }, [allCards]);
  // The quiz's monthly spend answers, when there are any, personalise the
  // value estimate; otherwise ValueBlock uses typical spending.
  const userSpend = useMemo(() => {
    const raw = matchAnswers?.spend;
    if (!raw || typeof raw !== 'object') return undefined;
    return raw as MonthlySpend;
  }, [matchAnswers]);
  // Outside the quiz, spending chips (Travel, Dining…) rank on weighted
  // spending; the value shown must be that same figure, labelled as such.
  const chipBasis = useMemo(
    () => (matchMode ? undefined : chipSpendBasis(activeFilters)),
    [matchMode, activeFilters],
  );
  const valueSpend = chipBasis?.spend ?? userSpend;
  // In quiz mode cards are ranked by what they add over the user's wallet,
  // so the value block measures the same thing.
  const ownedForValue = useMemo(
    () => (matchMode ? everyCard.filter((c) => ownedCards.includes(c.id)) : []),
    [matchMode, everyCard, ownedCards],
  );
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
    // everyCard, not allCards: buildDeck needs owned retired cards to value
    // the wallet, and keeps every retired card out of the deck itself.
    const pool = providerFilter === 'all' ? everyCard : everyCard.filter((c) => c.provider === providerFilter);
    const result = buildDeck(pool, activeFilters, ownedCards, matchMode, matchAnswers);
    // No pinned "featured" card: the site promises nobody pays for placement.
    setCards(result.deck);
    setRanked(result.ranked);
    setTopCount(result.topCount);
    setByValue(result.byValue);
    setAtEnd(false);
    setAboveLimit(result.aboveAnnualFeeLimit?.map((r) => r.card) || []);
    setExplanations(Object.fromEntries((result.results || []).map((r) => [r.card.id, r.explanation])));
    setCurrentIndex(0);
    setGridOpen(false);
  }, [everyCard, activeFilters, ownedCards, matchMode, matchAnswers, providerFilter]);

  // The arrows move within the current group (top picks or more matches).
  const moreCount = ranked ? cards.length - topCount : 0;
  const inMore = ranked && currentIndex >= topCount;
  const groupStart = inMore ? topCount : 0;
  const groupSize = ranked ? (inMore ? moreCount : topCount) : cards.length;
  const groupPos = currentIndex - groupStart;

  const nextCard = useCallback(() => {
    if (atEnd) {
      setAtEnd(false);
      setCurrentIndex(topCount);
    } else if (ranked && !inMore && moreCount > 0 && groupPos === groupSize - 1) {
      setAtEnd(true);
    } else {
      setCurrentIndex(groupStart + ((groupPos + 1) % groupSize));
    }
  }, [atEnd, ranked, inMore, moreCount, topCount, groupStart, groupPos, groupSize]);

  const prevCard = useCallback(() => {
    if (atEnd) {
      setAtEnd(false);
    } else if (inMore && groupPos === 0) {
      // Back out of the further matches the way you came in.
      setCurrentIndex(topCount - 1);
      setAtEnd(true);
    } else {
      setCurrentIndex(groupStart + ((groupPos - 1 + groupSize) % groupSize));
    }
  }, [atEnd, inMore, topCount, groupStart, groupPos, groupSize]);

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
  // "Top 10 for travel" — always the real count, and what it's ranked for.
  // Lowercased to read as a phrase; a detail that already starts with
  // "for"/"with" (spend- or fee-only filters) doesn't get a second "for".
  const detail = filterDetail?.toLowerCase();
  const topLabel = matchMode
    ? `Your top ${topCount}`
    : !detail ? `Top ${topCount}`
    : /^(for|with) /.test(detail) ? `Top ${topCount} ${detail}` : `Top ${topCount} for ${detail}`;
  const moreLabel = matchMode ? 'Other cards that fit your answers' : 'More matching cards';
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
      ownedCardNames: ownedCards.map((id) => everyCard.find((c) => c.id === id)?.name).filter(Boolean) as string[],
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

  // The card's title row — issuer, name, rank — centred above the
  // symmetric card | value pair.
  const renderTitle = () => activeCard && (
    <AnimatePresence mode="wait">
      <motion.div
        key={activeCard.id}
        initial={{ opacity: 0, y: reducedMotion ? 0 : 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, transition: { duration: 0.12 } }}
        transition={{ duration: reducedMotion ? 0 : 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="w-full text-center"
      >
        <p className="font-display text-[12px] font-bold uppercase tracking-[0.14em] text-[var(--cl-muted)] mb-2">{activeCard.issuer}</p>
        <h1 className="font-editorial text-[clamp(1.9rem,3vw,3rem)] leading-[1.05] text-[var(--cl-ink)] text-balance">{activeCard.name}</h1>
        {ranked && !inMore && (
          <p className="mt-3 pop-sm inline-flex -rotate-1 items-center gap-1.5 rounded-full bg-[var(--cl-lime)] px-3 py-1.5 text-xs font-bold text-[var(--cl-ink)]">
            <Trophy className="h-3.5 w-3.5" aria-hidden="true" />
            {topLabel} · <span className="font-bold">#{currentIndex + 1}</span>
          </p>
        )}
        {inMore && (
          <p className="mt-3 pop-sm inline-flex items-center rounded-full bg-white px-3 py-1.5 text-xs font-bold text-[var(--cl-ink)]">
            {moreLabel}
          </p>
        )}
        {advisorLoading ? (
          <p className="mt-3 flex items-center justify-center gap-2 text-xs text-[var(--cl-muted)]">
            <Sparkles className="w-3.5 h-3.5 animate-pulse text-[var(--cl-gold)]" /> Analyzing your wallet…
          </p>
        ) : advisorNote ? (
          <p className="mx-auto mt-3 max-w-md text-sm text-[var(--cl-ink)] leading-relaxed">
            <Sparkles className="inline w-3.5 h-3.5 text-[var(--cl-gold)] mr-1 align-[-0.15em]" />{advisorNote}
          </p>
        ) : null}
      </motion.div>
    </AnimatePresence>
  );

  // Landing hero: nothing but the search, centered on the page.
  if (!showResults) {
    return (
      <section className="compare-light cards-page relative w-full flex flex-col items-center px-6 pt-28 pb-20 sm:px-12 md:pt-36 lg:px-20">
        <div className="w-full max-w-6xl grid grid-cols-1 items-center gap-12 lg:grid-cols-[1.08fr_1fr]">
        <div className="min-w-0 flex flex-col items-center gap-7 text-center lg:items-start lg:text-left">
          {/* The promise, in the user's terms: money back, after fees. */}
          <div>
            <p className="pop-sm inline-flex -rotate-2 items-center gap-2 rounded-full bg-[var(--cl-lime)] px-3.5 py-1.5 text-xs font-bold text-[var(--cl-ink)]">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Independent · No sign-up · No credit check
            </p>
            <h1 className="mt-6 font-editorial text-[clamp(2.7rem,5.4vw,4.6rem)] leading-[0.98] text-[var(--cl-ink)] text-balance">
              Find the card that{' '}
              <span className="pop relative mt-2 inline-block -rotate-1 rounded-2xl bg-[var(--cl-sun)] px-3 pb-1">
                pays you back.
                <Sparkle className="absolute -right-5 -top-5 h-9 w-9 text-[var(--cl-brand)]" />
              </span>
            </h1>
            <p className="mt-7 max-w-xl text-base md:text-lg text-[var(--cl-muted)] text-balance">
              Tell us how you spend. We rank {allCards.length} cards from {providers.length} major issuers by what each is worth to you in dollars a year — after fees.
            </p>
          </div>

          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <button
              onClick={onFindMatches}
              className="pop pop-lift h-13 px-7 py-3 rounded-full bg-[var(--cl-pill)] text-[var(--cl-pill-ink)] font-bold flex items-center gap-2"
            >
              Get my matches <span className="font-normal opacity-75">· 2 min</span> <ChevronRight className="h-4 w-4" />
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
        <div className="-mt-6 -mb-10 origin-top scale-[0.82] sm:scale-100 lg:mt-0 lg:mb-0">
          <HeroPreview cards={preview.cards} topRank={preview.topRank} />
        </div>
        </div>

        {/* Who we cover — plain wordmarks, a quick credibility cue. */}
        <div className="mt-16 w-full max-w-6xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--cl-muted)]">Cards from {providers.length} major issuers</p>
          <p className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
            {providers.map((p, i) => (
              <span
                key={p}
                className={`pop-sm rounded-full bg-white px-3.5 py-1.5 text-sm font-semibold text-[var(--cl-ink)] ${i % 3 === 0 ? '-rotate-1' : i % 3 === 1 ? 'rotate-1' : ''}`}
              >
                {providerLabel(p)}
              </span>
            ))}
          </p>
        </div>

        {/* Trust strip: the four worries people bring to card shopping, each
            answered with something this product actually does. */}
        <ul className="mt-14 grid w-full max-w-6xl gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {TRUST_POINTS.map(({ icon: Icon, title, body }, i) => (
            <li key={title} className={`pop pop-lift rounded-[1.5rem] p-6 ${TRUST_COLORS[i % TRUST_COLORS.length]}`}>
              <span className="pop-sm grid h-10 w-10 place-items-center rounded-xl bg-white text-[var(--cl-ink)]">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <p className="mt-4 font-semibold text-[var(--cl-ink)]">{title}</p>
              <p className="mt-1 text-sm leading-relaxed text-[var(--cl-ink)]/75">{body}</p>
            </li>
          ))}
        </ul>

        {/* How we rank: the method, on the same blue "card" as the value
            figure on results — one motif across the site. */}
        <div className="pop relative mt-16 w-full max-w-6xl overflow-hidden rounded-[2rem] bg-[var(--cl-brand)] px-6 py-12 text-white md:px-14 md:py-16">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-20 [background-image:radial-gradient(white_1px,transparent_1.2px)] [background-size:20px_20px]" />
          <Sparkle className="absolute right-10 top-10 hidden h-14 w-14 text-[var(--cl-sun)] md:block" />
          <Sparkle className="absolute right-28 top-28 hidden h-6 w-6 text-[var(--cl-pink)] md:block" />
          <div className="relative">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-white">The method</p>
            <h2 className="mt-3 max-w-xl font-editorial text-3xl md:text-5xl leading-[1.02]">How we rank cards</h2>
            <ol className="mt-10 grid gap-8 md:grid-cols-3">
              {RANK_STEPS.map((step, i) => (
                <li key={step.title}>
                  <span className="pop-sm grid h-14 w-14 place-items-center rounded-2xl bg-[var(--cl-sun)] font-editorial text-2xl text-[var(--cl-ink)]">{i + 1}</span>
                  <p className="mt-4 text-lg font-semibold">{step.title}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-white">{step.body}</p>
                </li>
              ))}
            </ol>
            <button
              onClick={onFindMatches}
              className="pop pop-lift mt-10 h-12 px-6 rounded-full bg-white text-[var(--cl-ink)] text-sm font-bold whitespace-nowrap inline-flex items-center gap-2 md:px-7 md:text-base"
            >
              Rank cards for my spending <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="compare-light cards-page relative w-full min-h-screen pt-[7.6rem] flex flex-col items-center bg-[var(--cl-bg)] md:pt-[6.75rem] pb-16 md:pb-20">
      {matchMode && (
        <div className="relative z-20 w-full flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 text-center mb-8 md:mb-10">
          <h2 className="font-editorial text-4xl md:text-5xl text-[var(--cl-ink)]">Your best matches</h2>
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
        // Refine bar at the top on every size: it never covers results (the
        // old bottom dock hid the value number on laptop screens), and chips
        // stay folded behind "Refine" until wanted.
        <div className="relative z-40 mb-6 flex w-full flex-col items-center gap-3">
          <div className="w-full max-w-3xl px-4">
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
                    className="appearance-none bg-transparent text-[13px] text-[var(--cl-ink)] pl-1 pr-5 py-0.5 focus:outline-none cursor-pointer max-w-[7.5rem] truncate"
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
          {/* The chips would push the card below the fold, so they live
              behind a toggle that shows how many are active. */}
          <button
            onClick={() => setMobileFiltersOpen((o) => !o)}
            aria-expanded={mobileFiltersOpen}
            className="pop-sm h-8 px-4 rounded-full bg-white text-xs font-semibold text-[var(--cl-ink)] flex items-center gap-1.5"
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
      <div className="w-full flex flex-col items-center gap-8 px-4 md:px-[clamp(1.25rem,3vw,3.5rem)]">
        {atEnd ? (
          <div className="pop mt-4 flex w-full max-w-xl flex-col items-center gap-4 rounded-[2rem] bg-[var(--cl-sun)] px-6 py-10 text-center">
            <p className="font-editorial text-3xl leading-tight text-[var(--cl-ink)] text-balance">That&rsquo;s the {topLabel.replace(/^Your top/, 'your top').replace(/^Top/, 'top')}</p>
            <p className="max-w-sm text-sm text-[var(--cl-ink)]/80">
              {moreCount} more {moreCount === 1 ? 'card matches' : 'cards match'}, in the same order but without a rank.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={() => { setAtEnd(false); setCurrentIndex(0); }}
                className="pop-sm pop-lift h-11 px-5 rounded-full bg-white text-sm font-semibold text-[var(--cl-ink)] flex items-center gap-1.5"
              >
                <ChevronLeft className="w-4 h-4" /> Back to #1
              </button>
              <button
                onClick={nextCard}
                className="pop-sm pop-lift h-11 px-5 rounded-full bg-[var(--cl-pill)] text-[var(--cl-pill-ink)] text-sm font-bold flex items-center gap-1.5"
              >
                See {moreCount} more <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : (
        <>
        <div aria-live="polite" className="w-full max-w-4xl">{renderTitle()}</div>

        {/* Mirror-symmetric pair: the card (flat, a neat fan of the next two
            cards behind it) and its value card, same width and height.
            Controls sit centred under both (on phones: right under the card). */}
        <div className="grid w-full max-w-5xl grid-cols-1 items-center justify-items-center gap-x-14 gap-y-8 lg:grid-cols-2">
          <div className="order-1 w-full max-w-[26rem] px-6 py-4 sm:px-8">
            <div className="relative aspect-[1.586/1] w-full">
              {[2, 1].map((k) => {
                const back = groupSize > k ? cards[groupStart + ((groupPos + k) % groupSize)] : undefined;
                if (!back) return null;
                return (
                  <div
                    key={`${back.id}-back`}
                    aria-hidden="true"
                    className={`absolute inset-0 brightness-[0.97] ${k === 1 ? 'rotate-[6deg] translate-x-[5%]' : '-rotate-[6deg] -translate-x-[5%]'}`}
                  >
                    <CardVisual card={back} variant="fill" />
                  </div>
                );
              })}
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div
                  key={activeCard.id}
                  className="absolute inset-0 z-10 drop-shadow-[5px_5px_0_#141414]"
                  initial={{ opacity: 0, scale: reducedMotion ? 1 : 0.94, y: reducedMotion ? 0 : 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: reducedMotion ? 1 : 0.97 }}
                  transition={{ duration: reducedMotion ? 0 : 0.28, ease: [0.16, 1, 0.3, 1] }}
                >
                  <CardVisual card={activeCard} variant="fill" />
                </motion.div>
              </AnimatePresence>
            </div>
          </div>

          <div className="order-3 w-full max-w-[26rem] lg:order-2">
            <ValueBlock card={activeCard} spend={valueSpend} basis={chipBasis} stacked owned={ownedForValue} hideNotes />
          </div>

          {/* Controls: ‹ 1 of N ›  ·  Watchlist  ·  View all  ·  Visit — labelled, centred. */}
          <div className="order-2 flex flex-wrap items-center justify-center gap-3 lg:order-3 lg:col-span-2">
            <div className="pop-sm flex items-center gap-1 rounded-full bg-white p-1">
              <button
                onClick={prevCard}
                aria-label="Previous card"
                className="grid h-9 w-9 place-items-center rounded-full text-[var(--cl-ink)] hover:bg-[var(--cl-panel)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cl-brand)]/40"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <span className="min-w-[4.5rem] text-center text-sm font-semibold tabular-nums text-[var(--cl-ink)]" aria-live="polite">
                {groupPos + 1} of {groupSize}
              </span>
              <button
                onClick={nextCard}
                aria-label="Next card"
                className="grid h-9 w-9 place-items-center rounded-full text-[var(--cl-ink)] hover:bg-[var(--cl-panel)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cl-brand)]/40"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
            <button
              onClick={() => setWatchlist((prev) => (prev.includes(activeCard.id) ? prev.filter((id) => id !== activeCard.id) : [...prev, activeCard.id]))}
              aria-pressed={watchlist.includes(activeCard.id)}
              className={`pop-sm pop-lift h-11 px-4 rounded-full text-sm font-semibold flex items-center gap-1.5 ${watchlist.includes(activeCard.id) ? 'bg-[var(--cl-lime)]' : 'bg-white'} text-[var(--cl-ink)]`}
            >
              {watchlist.includes(activeCard.id) ? <><Check className="w-4 h-4" /> Saved</> : <><Plus className="w-4 h-4" /> Watchlist</>}
            </button>
            {cards.length > 1 && (
              <button
                onClick={() => setGridOpen((o) => !o)}
                aria-expanded={gridOpen}
                className={`pop-sm pop-lift h-11 px-4 rounded-full text-sm font-semibold flex items-center gap-1.5 text-[var(--cl-ink)] ${gridOpen ? 'bg-[var(--cl-sun)]' : 'bg-white'}`}
              >
                <LayoutGrid className="w-4 h-4" /> {gridOpen ? 'Hide list' : `View all ${cards.length}`}
              </button>
            )}
            {activeCard.applyUrl ? (
              <a
                href={activeCard.applyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="pop-sm pop-lift h-11 px-5 rounded-full bg-[var(--cl-pill)] text-[var(--cl-pill-ink)] text-sm font-bold flex items-center gap-1.5"
              >
                Visit issuer <ArrowUpRight className="w-4 h-4" />
              </a>
            ) : (
              <span className="h-11 px-5 rounded-full bg-[var(--cl-panel)] text-[var(--cl-muted)] text-sm font-semibold flex items-center">No apply link</span>
            )}
          </div>
        </div>
        </>
        )}

        {gridOpen && (
          <div className="flex w-full max-w-5xl flex-col gap-6">
            {(ranked
              ? [
                  { title: topLabel, start: 0, items: cards.slice(0, topCount) },
                  { title: `${moreLabel} (${moreCount})`, start: topCount, items: cards.slice(topCount) },
                ]
              : [{ title: '', start: 0, items: cards }]
            ).filter((g) => g.items.length > 0).map((g) => (
              <section key={g.start}>
                {g.title && <h3 className="mb-3 font-display text-lg font-bold text-[var(--cl-ink)]">{g.title}</h3>}
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {g.items.map((card, k) => {
                    const i = g.start + k;
                    const isTop = ranked && i < topCount;
                    return (
                      <li key={card.id}>
                        <button
                          onClick={() => {
                            setCurrentIndex(i);
                            setAtEnd(false);
                            setGridOpen(false);
                            window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
                          }}
                          aria-current={i === currentIndex && !atEnd}
                          className={`pop-sm pop-lift flex h-full w-full flex-col gap-2 rounded-2xl p-3 text-left ${i === currentIndex && !atEnd ? 'bg-[var(--cl-lime)]' : 'bg-white'}`}
                        >
                          {/* Absolute fill: the no-art face otherwise grows past the card shape. */}
                          <div className="relative aspect-[1.586/1] w-full"><div className="absolute inset-0"><CardVisual card={card} variant="thumb" /></div></div>
                          <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--cl-muted)]">
                            {isTop ? `#${i + 1} · ` : ''}{card.issuer}
                          </span>
                          <span className="text-sm font-semibold leading-snug text-[var(--cl-ink)]">{card.name}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            {ranked && byValue && (
              <p className="text-center text-xs text-[var(--cl-muted)]">Ranked by estimated yearly value on {matchMode ? 'your' : 'typical'} spending, after fees.</p>
            )}
          </div>
        )}

        {!atEnd && (
          <>
            <ValueNotes card={activeCard} spend={valueSpend} basis={chipBasis} owned={ownedForValue} />
            {/* Everything else, sticker style. */}
            <FinePrint card={activeCard} whyBullets={activeWhy} />
          </>
        )}
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

      </div>
    </section>
  );
}
