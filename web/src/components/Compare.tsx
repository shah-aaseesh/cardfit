import { useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { X, Search, Shuffle, Wallet, Bookmark, Check, Minus, ArrowUpRight, Plus, ChevronDown, ChevronLeft, Columns2, Calculator, Receipt, Trophy, ArrowLeftRight } from 'lucide-react';
import { useCards } from '../hooks/useCards';
import { estimateValue } from '../lib/insights';
import CardVisual from './CardVisual';
import { CreditCard } from '../types';
import { cardRewardBullets, leadWithNumber } from '../lib/rewards';
import { cardMatchesQuery } from '../lib/cardSearch';

interface CompareProps {
  watchlist: string[];
  setWatchlist: React.Dispatch<React.SetStateAction<string[]>>;
  ownedCards: string[];
  setOwnedCards: React.Dispatch<React.SetStateAction<string[]>>;
}

// --- Fact parsing --------------------------------------------------------
// The crawled facts are strings ("$95", "Variable APR 19.99%-28.99%",
// "None"); the editorial layout wants a bare numeral for the two hero
// stats and a clean yes/no/unknown for the parity checklist. `null` means
// "we genuinely don't know" (issuer-site fallbacks) and renders as a dash
// rather than a misleading check or cross.

type Tri = true | false | null;

function feeParts(fee: string): { value: string; unit: string | null } {
  const m = fee.match(/\$\s*([\d,]+)/);
  if (!m) return { value: '—', unit: null };
  return { value: m[1], unit: '$' };
}

function aprParts(apr: string): { value: string; unit: string | null } {
  const found = apr.match(/\d+\.?\d*%/g);
  if (!found) return { value: '—', unit: null };
  const high = Math.max(...found.map((n) => parseFloat(n)));
  return { value: String(high), unit: '%' };
}

function parity(card: CreditCard): { label: string; state: Tri }[] {
  const f = card.facts;
  const noFee: Tri = /see issuer|not specified/i.test(f.annualFee) ? null : /\$\s*0\b/.test(f.annualFee);
  const rewards: Tri = /see issuer/i.test(f.rewards) ? null : f.rewards.trim().length > 0;
  const bonus: Tri = /see issuer|not specified/i.test(f.bonus) ? null :!/^(none|no\b|n\/a)/i.test(f.bonus.trim());
  const ff = f.foreignFee.toLowerCase();
  const noForeign: Tri = /not specified|see issuer/.test(ff)
    ? null
    : /none|no foreign|\b0%|\$?0\b/.test(ff);
  return [
    { label: 'No annual fee', state: noFee },
    { label: 'Rewards on purchases', state: rewards },
    { label: 'Sign-up bonus', state: bonus },
    { label: 'No foreign transaction fee', state: noForeign },
  ];
}

export default function Compare({ watchlist, setWatchlist, ownedCards, setOwnedCards }: CompareProps) {
  // allCards includes retired cards: people still hold them, so they stay
  // searchable and comparable here. Shuffle's fallback deck is offers only.
  const { cards: offeredCards, allCards } = useCards();
  // Exactly two comparison slots.
  const [slots, setSlots] = useState<(string | null)[]>([null, null]);

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [activeSlot, setActiveSlot] = useState<number | 'watchlist' | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const reduce = useReducedMotion();

  const cardAt = (i: number) => allCards.find((c) => c.id === slots[i]);

  const handleDragStart = (e: React.DragEvent, cardId: string) => {
    e.dataTransfer.setData('cardId', cardId);
  };

  const handleDrop = (e: React.DragEvent, i: number) => {
    e.preventDefault();
    const cardId = e.dataTransfer.getData('cardId');
    if (cardId) setSlots((prev) => prev.map((s, idx) => (idx === i ? cardId : s)));
  };

  const openSearch = (slot: number | 'watchlist') => {
    setActiveSlot(slot);
    setIsSearchOpen(true);
    setSearchQuery('');
  };

  const selectCard = (cardId: string) => {
    if (activeSlot === 'watchlist') {
      if (!watchlist.includes(cardId)) setWatchlist((prev) => [...prev, cardId]);
    } else if (typeof activeSlot === 'number') {
      const i = activeSlot;
      setSlots((prev) => prev.map((s, idx) => (idx === i ? cardId : s)));
    }
    setIsSearchOpen(false);
  };

  // Clears a slot in place rather than removing it — there are always exactly two.
  const removeSlot = (i: number) => {
    setSlots((prev) => prev.map((s, idx) => (idx === i ? null : s)));
  };

  // Shuffle fills both slots with distinct random cards. Prefers the
  // user's own cards + watchlist, falling back to the full deck.
  const shuffleCards = () => {
    // Only ids that still resolve: a saved card can drop out of the data.
    const pool = [...new Set([...ownedCards, ...watchlist])].filter((id) => allCards.some((c) => c.id === id));
    const source = pool.length >= slots.length ? pool : offeredCards.map((c) => c.id);
    if (source.length < slots.length) return;
    const shuffled = [...source].sort(() => 0.5 - Math.random());
    setSlots((prev) => prev.map((_, i) => shuffled[i]));
  };

  // Empty query = browse mode: show the whole deck rather than nothing.
  const filteredCards = searchQuery.trim()
    ? allCards.filter((c) => cardMatchesQuery(c, searchQuery))
    : allCards;

  // The detailed side-by-side comparison only appears once BOTH slots are
  // filled; until then the hero shows the two slots (filled ones preview the
  // chosen card).
  const hasBoth = slots.every((s) => s);

  const watchlistAddMini = (
    <button
      onClick={() => openSearch('watchlist')}
      className="shrink-0 w-[115px] h-[73px] md:w-[134px] md:h-[85px] rounded-[0.6rem] border-2 border-dashed border-[var(--cl-hairline-strong)] text-[var(--cl-muted)] hover:text-[var(--cl-ink)] hover:border-[var(--cl-ink)] transition-colors flex flex-col items-center justify-center"
    >
      <Plus className="w-5 h-5" strokeWidth={1.5} />
      <span className="text-[12px] mt-0.5">Add</span>
    </button>
  );

  return (
    <div className="compare-light compare-page min-h-screen overflow-x-clip px-4 pb-16 pt-24 md:px-8 lg:px-0">
      {/* Mobile / tablet: horizontal wallet rails on top. On desktop these
          live as vertical drawers on the page edges instead. */}
      <div className="lg:hidden grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <Rail
          label="My Cards"
          icon={<Wallet className="w-3.5 h-3.5" />}
          ids={ownedCards}
          allCards={allCards}
          onDragStart={handleDragStart}
          onRemove={(id) => setOwnedCards((prev) => prev.filter((x) => x !== id))}
          emptyHint="Cards you own will show here."
        />
        <Rail
          label="Watchlist"
          icon={<Bookmark className="w-3.5 h-3.5" />}
          ids={watchlist}
          allCards={allCards}
          onDragStart={handleDragStart}
          onRemove={(id) => setWatchlist((prev) => prev.filter((x) => x !== id))}
          addButton={watchlistAddMini}
        />
      </div>

      {/* Desktop: My Cards + Watchlist drawers docked to the left screen edge,
          stacked vertically. The comparison stage is offset right to clear them. */}
      <aside className="compare-sidebar hidden lg:flex fixed left-0 top-0 bottom-0 z-30 flex-col gap-3 px-[25px] pt-[108px] pb-[35px]">
        <VerticalRail
          label="My Cards"
          icon={<Wallet className="w-[22px] h-[22px]" strokeWidth={2} />}
          tone="orange"
          ids={ownedCards}
          allCards={allCards}
          onDragStart={handleDragStart}
          onRemove={(id) => setOwnedCards((prev) => prev.filter((x) => x !== id))}
          emptyHint="Cards you own show here."
          defaultOpen
        />
        <VerticalRail
          label="Watchlist"
          icon={<Bookmark className="w-[22px] h-[22px]" strokeWidth={2} />}
          tone="violet"
          ids={watchlist}
          allCards={allCards}
          onDragStart={handleDragStart}
          onRemove={(id) => setWatchlist((prev) => prev.filter((x) => x !== id))}
          addButton={watchlistAddMini}
        />
      </aside>

      {/* lg:pr-10 keeps a right gutter: the workspace spans to the viewport
          edge, which clipped the comparison's outline and sticker shadow. */}
      <div className="compare-workspace w-full mx-auto lg:ml-[var(--compare-sidebar-width)] lg:pr-10">
        <div className="min-w-0">
          {!hasBoth ? (
            /* Hero empty state: headline + porcelain slots (a filled slot
               previews its chosen card) joined by a VS badge. The features
               strip hugs the bottom of the viewport. */
            <div className="compare-empty relative flex min-h-[calc(100dvh-6rem)] flex-col">
              <div className="compare-shuffle absolute z-20">
                <button
                  onClick={shuffleCards}
                  className="pop-sm pop-lift inline-flex h-[42px] items-center gap-2.5 rounded-full bg-white px-5 text-[14px] font-bold text-[var(--cl-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cl-brand)]/40"
                >
                  <Shuffle className="w-[15px] h-[15px]" />
                  Shuffle
                </button>
              </div>

              <section className="compare-hero relative z-10 text-center">
                <p className="pop-sm inline-flex -rotate-2 items-center gap-2 rounded-full bg-[var(--cl-lime)] px-3.5 py-1.5 text-xs font-bold text-[var(--cl-ink)]">
                  <Columns2 className="h-3.5 w-3.5" aria-hidden="true" /> Side by side · fees counted
                </p>
                <h1 className="compare-typewriter" aria-label="Find your perfect match">
                  <span aria-hidden="true">Find your perfect match</span>
                </h1>
                <p className="compare-subtitle">Compare rewards, fees, and benefits side-by-side{' '}<br />to make the best choice.</p>
              </section>

              <div className="relative z-10 flex flex-col items-center">
                {/* Two flat sticker slots with a VS badge between — symmetric. */}
                <div className="mt-10 flex w-full flex-col items-center justify-center gap-6 px-2 md:flex-row md:gap-4">
                  <HeroSlot card={cardAt(0)} side="left" onClick={() => openSearch(0)} onRemove={() => removeSlot(0)} onDrop={(e) => handleDrop(e, 0)} />
                  <span className="pop z-10 grid h-16 w-16 shrink-0 -rotate-6 place-items-center rounded-full bg-[var(--cl-sun)] font-editorial text-2xl text-[var(--cl-ink)]" aria-hidden="true">VS</span>
                  <HeroSlot card={cardAt(1)} side="right" onClick={() => openSearch(1)} onRemove={() => removeSlot(1)} onDrop={(e) => handleDrop(e, 1)} />
                </div>
                <CompareFeatures />
              </div>
            </div>
          ) : (
            /* Head-to-head: the verdict first, then both cards side by side
               with the better figure on each row marked. */
            <>
            <Verdict a={cardAt(0)!} b={cardAt(1)!} onSwap={() => setSlots(([x, y]) => [y, x])} onShuffle={shuffleCards} />
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduce ? 0 : 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="pop overflow-hidden rounded-[1.75rem] bg-white p-3 md:grid md:grid-cols-2 md:gap-0 md:divide-x-2 md:divide-[var(--cl-ink)] md:items-stretch md:[grid-template-rows:repeat(10,auto)]"
            >
              <CompareColumn
                card={cardAt(0)}
                other={cardAt(1)}
                side="A"
                onDrop={(e) => handleDrop(e, 0)}
                onOpenSearch={() => openSearch(0)}
                onRemove={() => removeSlot(0)}
              />
              <CompareColumn
                card={cardAt(1)}
                other={cardAt(0)}
                side="B"
                onDrop={(e) => handleDrop(e, 1)}
                onOpenSearch={() => openSearch(1)}
                onRemove={() => removeSlot(1)}
              />
            </motion.div>
            </>
          )}
        </div>
      </div>

      {/* Search Modal */}
      <AnimatePresence>
        {isSearchOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[30vh] pb-4 bg-[var(--cl-ink)]/18"
            onClick={() => setIsSearchOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.97, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.97, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="pop w-full max-w-xl bg-white rounded-2xl overflow-hidden flex flex-col max-h-[70vh]"
            >
              <div className="p-4 border-b border-[var(--cl-hairline)] flex items-center gap-3">
                <Search className="w-5 h-5 text-[var(--cl-muted)]" />
                <input
                  type="text"
                  placeholder="Search for a card..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-transparent border-none outline-none flex-1 text-[var(--cl-ink)] placeholder-[var(--cl-muted)] text-lg"
                  autoFocus
                />
                <button
                  onClick={() => setIsSearchOpen(false)}
                  className="text-[var(--cl-muted)] hover:text-[var(--cl-ink)] p-2"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="max-h-[256px] overflow-y-auto p-2">
                {filteredCards.length > 0 ? (
                  filteredCards.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => selectCard(c.id)}
                      className="w-full text-left p-4 hover:bg-[var(--cl-panel)] rounded-xl flex items-center gap-4 transition-colors"
                    >
                      <div className="aspect-[1.586/1] w-16 shrink-0"><CardVisual card={c} variant="thumb" /></div>
                      <div className="min-w-0">
                        <div className="text-[var(--cl-ink)] font-medium text-lg truncate">{c.name}</div>
                        <div className="text-[var(--cl-muted)] text-sm uppercase tracking-wider">{c.issuer}{c.retired && ' · No longer offered'}</div>
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="p-12 text-center text-[var(--cl-muted)]">No cards found matching your search.</div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Empty stage ----------------------------------------------------------

// A hero slot: the porcelain "Select a card" placeholder when empty, or a
// preview of the chosen card (with a remove button) once filled. Both slots
// must be filled before the detailed comparison appears.
function HeroSlot({
  card,
  side,
  onClick,
  onRemove,
  onDrop,
}: {
  card?: CreditCard;
  side: 'left' | 'right';
  onClick: () => void;
  onRemove: () => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  const left = side === 'left';
  const accent = left ? 'bg-[var(--cl-brand)] text-white' : 'bg-[var(--cl-coral)] text-[var(--cl-ink)]';
  if (!card) {
    return (
      <button
        onClick={onClick}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        aria-label={`Select card ${left ? 'A' : 'B'} to compare`}
        className="pop-lift group relative flex aspect-[1.586/1] w-full max-w-[21rem] flex-col items-center justify-center gap-2 rounded-[1.5rem] border-2 border-dashed border-[var(--cl-ink)] bg-white shadow-[4px_4px_0_var(--cl-ink)]"
      >
        <span className={`pop-sm absolute left-4 top-4 rounded-full px-2.5 py-0.5 text-xs font-bold ${accent}`}>Card {left ? 'A' : 'B'}</span>
        <span className={`pop-sm grid h-14 w-14 place-items-center rounded-full ${accent}`}>
          <Plus className="h-7 w-7" strokeWidth={2.4} />
        </span>
        <span className="mt-2 text-lg font-bold text-[var(--cl-ink)]">Pick a card</span>
        <span className="text-sm text-[var(--cl-muted)]">or drag one from the side</span>
      </button>
    );
  }
  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      className="relative aspect-[1.586/1] w-full max-w-[21rem] drop-shadow-[5px_5px_0_#141414]"
    >
      <CardVisual card={card} variant="fill" />
      <button
        onClick={onRemove}
        aria-label={`Remove ${card.name}`}
        className="pop-sm absolute -right-2 -top-2 z-10 grid h-8 w-8 place-items-center rounded-full bg-white text-[var(--cl-ink)]"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function CompareFeatures() {
  // Same tile language as the landing page trust strip.
  const items = [
    { icon: Calculator, title: 'Same maths as our rankings', sub: 'Each card’s dollars a year after fees, side by side.' },
    { icon: Receipt, title: 'Fees counted, not hidden', sub: 'Annual fees, APRs and foreign fees in one view.' },
    { icon: Columns2, title: 'Spot the real difference', sub: 'Rewards and perks lined up row by row.' },
  ];
  return (
    <div className="compare-feature-bar relative z-20 mx-auto grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
      {items.map(({ icon: Icon, title, sub }, i) => (
        <div key={title} className={`pop pop-lift rounded-[1.25rem] p-5 ${['bg-[var(--cl-sky)]', 'bg-[var(--cl-pink)]', 'bg-[var(--cl-lime)]'][i]}`}>
          <span className="pop-sm grid h-9 w-9 place-items-center rounded-xl bg-white text-[var(--cl-ink)]">
            <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
          </span>
          <p className="mt-3 text-[15px] font-semibold text-[var(--compare-text)]">{title}</p>
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--cl-ink)]/75">{sub}</p>
        </div>
      ))}
    </div>
  );
}

// --- Verdict + winners ------------------------------------------------------

const money = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString()}`;

/** Per-row winners between two cards: higher value, lower fee, lower APR.
 *  A row has no winner when either side is unknown or they tie. */
function winners(card: CreditCard, other?: CreditCard) {
  if (!other) return { value: false, fee: false, apr: false };
  const va = estimateValue(card), vb = estimateValue(other);
  const fa = feeParts(card.facts.annualFee).value, fb = feeParts(other.facts.annualFee).value;
  const aa = aprParts(card.facts.apr).value, ab = aprParts(other.facts.apr).value;
  const num = (x: string) => (/^[\d.,]+$/.test(x) ? parseFloat(x.replace(/,/g, '')) : NaN);
  const lower = (x: number, y: number) => !Number.isNaN(x) && !Number.isNaN(y) && x < y;
  return {
    value: va.annualFeeKnown && vb.annualFeeKnown && va.average > vb.average,
    fee: lower(num(fa), num(fb)),
    apr: lower(num(aa), num(ab)),
  };
}

function Verdict({ a, b, onSwap, onShuffle }: { a: CreditCard; b: CreditCard; onSwap: () => void; onShuffle: () => void }) {
  const va = estimateValue(a), vb = estimateValue(b);
  const comparable = va.annualFeeKnown && vb.annualFeeKnown;
  const [win, lose, vw, vl] = va.average >= vb.average ? [a, b, va, vb] : [b, a, vb, va];
  const diff = vw.average - vl.average;
  return (
    <div className="pop relative mb-6 overflow-hidden rounded-[1.75rem] bg-[var(--cl-brand)] px-6 py-6 text-white md:px-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-20 [background-image:radial-gradient(white_1px,transparent_1.2px)] [background-size:20px_20px]" />
      <div className="relative flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-4">
          <span className="pop-sm grid h-12 w-12 shrink-0 -rotate-6 place-items-center rounded-2xl bg-[var(--cl-sun)] text-[var(--cl-ink)]">
            <Trophy className="h-6 w-6" />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-white">The verdict</p>
            {!comparable ? (
              <p className="mt-1 font-editorial text-2xl leading-tight md:text-3xl">Too close to call — one card's annual fee isn't listed.</p>
            ) : Math.round(diff) === 0 ? (
              <p className="mt-1 font-editorial text-2xl leading-tight md:text-3xl">A dead heat at about {money(vw.average)} a year each.</p>
            ) : (
              <p className="mt-1 font-editorial text-2xl leading-tight md:text-3xl">
                {win.name} is worth about <span className="rounded-lg bg-[var(--cl-sun)] px-1.5 text-[var(--cl-ink)]">{money(diff)} more</span> a year.
              </p>
            )}
            <p className="mt-2 text-sm text-white">
              On typical spending, after fees, with welcome bonuses spread over two years{comparable && Math.round(diff) !== 0 ? ` (${money(vw.average)} vs ${money(vl.average)} for ${lose.name})` : ''}.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button onClick={onSwap} className="pop-sm pop-lift inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-bold text-[var(--cl-ink)]">
            <ArrowLeftRight className="h-4 w-4" /> Swap
          </button>
          <button onClick={onShuffle} className="pop-sm pop-lift inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-bold text-[var(--cl-ink)]">
            <Shuffle className="h-4 w-4" /> Shuffle
          </button>
        </div>
      </div>
    </div>
  );
}

function BetterTag() {
  return (
    <span className="pop-sm ml-2 inline-flex -rotate-3 items-center gap-1 rounded-full bg-[var(--cl-lime)] px-2 py-0.5 align-middle text-[11px] font-bold normal-case tracking-normal text-[var(--cl-ink)]">
      <Check className="h-3 w-3" strokeWidth={3} /> Better
    </span>
  );
}

// --- Value strip ------------------------------------------------------------

function CompareValue({ card, best }: { card: CreditCard; best: boolean }) {
  const v = estimateValue(card);
  return (
    <div className="pop-sm mt-6 rounded-2xl bg-[var(--cl-sun)] px-5 py-4 text-[var(--cl-ink)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--cl-ink)]/70">Est. value on typical spending{best && <BetterTag />}</p>
      <p className="mt-1 flex items-baseline gap-1.5">
        <span className="font-editorial text-4xl leading-none">{money(v.average)}</span>
        <span className="text-sm text-[var(--cl-ink)]/70">/ year</span>
      </p>
      <p className="mt-1.5 text-xs text-[var(--cl-ink)]/70">
        {v.annualFeeKnown ? `${money(v.rewards)} rewards · ${v.bonus ? `${money(v.bonus / 2)} bonus (½) · ` : ''}${v.annualFee ? `−${money(v.annualFee)} fee` : 'no annual fee'}` : 'Annual fee not listed — check the issuer'}
      </p>
    </div>
  );
}

// --- Comparison column ---------------------------------------------------

function CompareColumn({
  card,
  other,
  side,
  onDrop,
  onOpenSearch,
  onRemove,
}: {
  card?: CreditCard;
  other?: CreditCard;
  side: 'A' | 'B';
  onDrop: (e: React.DragEvent) => void;
  onOpenSearch: () => void;
  onRemove: () => void;
}) {
  if (!card) {
    return (
      <div className="md:row-span-full flex justify-center py-4 md:py-0">
        <button
          onClick={onOpenSearch}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          aria-label="Select a card to compare"
          className="w-[320px] h-[202px] md:w-full md:h-full rounded-[0.9rem] border border-dashed border-[var(--cl-hairline-strong)] bg-[var(--surface)] flex flex-col items-center justify-center gap-2.5 text-[var(--cl-muted)] hover:border-[var(--cl-ink)] hover:bg-[var(--compare-bg)] hover:text-[var(--cl-ink)] transition-colors"
        >
          <Plus className="w-7 h-7" strokeWidth={1.25} />
          <span className="font-medium text-[var(--cl-ink)]">Select a card</span>
          <span className="text-sm">or drag one from the side</span>
        </button>
      </div>
    );
  }

  const fee = feeParts(card.facts.annualFee);
  const apr = aprParts(card.facts.apr);
  const rows = parity(card);
  const best = winners(card, other);

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      className="md:row-span-full flex flex-col md:grid md:grid-rows-subgrid relative px-5 py-6 md:px-7 md:py-7"
    >
      {/* Masthead: identity + controls + product shot */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="mt-1.5 flex items-center gap-2 font-display text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cl-muted)]">
            <span className={`pop-sm rounded-full px-2 py-0.5 text-[11px] font-bold normal-case tracking-normal ${side === 'A' ? 'bg-[var(--cl-brand)] text-white' : 'bg-[var(--cl-coral)] text-[var(--cl-ink)]'}`}>Card {side}</span>
            {card.issuer}
          </p>
          <h2 className="mt-2 font-display font-semibold text-[1.25rem] md:text-[1.55rem] text-[var(--compare-text)] leading-[1.1] text-balance">
            {card.name}
          </h2>
        </div>

        <div className="flex flex-col items-end gap-3 shrink-0">
          <div className="flex items-center">
            <button
              onClick={onOpenSearch}
              className="text-[12px] font-semibold uppercase tracking-wider text-[var(--cl-muted)] hover:text-[var(--cl-ink)] px-2 py-1 transition-colors"
            >
              Change
            </button>
            <button
              onClick={onRemove}
              aria-label={`Remove ${card.name}`}
              className="p-1.5 rounded-full text-[var(--cl-muted)] hover:text-[var(--cl-ink)] hover:bg-[var(--cl-hairline)]/60 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="relative hidden aspect-[1.586/1] w-[150px] drop-shadow-[3px_3px_0_#141414] md:block">
            <CardVisual card={card} variant="fill" />
          </div>
        </div>
      </div>

      {/* The same value number the rankings use, on the brand value card. */}
      <CompareValue card={card} best={best.value} />

      {/* Hero stats: fee + APR share one row */}
      <div className="mt-7 grid grid-cols-2 divide-x divide-[var(--cl-hairline-strong)] border-y border-[var(--cl-hairline-strong)]">
        <StatBig value={fee.value} unit={fee.unit} label="Annual Fee" best={best.fee} />
        <StatBig value={apr.value} unit={apr.unit} label="APR" best={best.apr} />
      </div>

      {/* At-a-glance parity, two columns */}
      <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-3">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center gap-2.5">
            <ParityIcon state={r.state} />
            <span className={`text-[13px] ${r.state === false ? 'text-[var(--cl-muted)]' : 'text-[var(--cl-ink)]'}`}>
              {r.label}
            </span>
          </li>
        ))}
      </ul>

      {/* Detail spec list. `contents` keeps each row as its own subgrid
          track (aligned with the other card) while still grouping them
          under one <dl> for markup semantics. APR is dropped here since
          the hero stat above already covers it. */}
      <dl className="contents">
        <SpecRow label="Rewards" value={card.facts.rewards} bullets={cardRewardBullets(card.facts)} />
        <SpecRow label="Sign-up bonus" value={leadWithNumber(card.facts.bonus)} />
        <SpecRow label="Foreign fee" value={card.facts.foreignFee} />
        <SpecRow label="Best for" value={card.facts.bestFor} />
        <SpecRow label="Credit needed" value={card.facts.creditNeeded} />
      </dl>

      {/* CTA */}
      <div className="mt-7">
        {card.applyUrl ? (
          <a
            href={card.applyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="pop-sm pop-lift inline-flex items-center gap-2 rounded-full bg-[var(--cl-pill)] text-[var(--cl-pill-ink)] px-6 py-3 text-[13px] font-bold uppercase tracking-[0.12em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cl-brand)]/40"
          >
            Visit site <ArrowUpRight className="w-4 h-4" />
          </a>
        ) : (
          <span className="text-[12px] uppercase tracking-wider text-[var(--cl-muted)]">Link unavailable</span>
        )}
      </div>
    </div>
  );
}

function StatBig({ value, unit, label, best }: { value: string; unit: string | null; label: string; best?: boolean }) {
  return (
    <div className="flex flex-col gap-1 py-4 px-4 first:pl-0 last:pr-0">
      <span className="font-mono text-3xl md:text-[2.15rem] leading-none tracking-tight text-[var(--cl-ink)] tabular-nums">
        {value}
        {unit && <sup className="text-[0.4em] font-medium ml-1 top-[-0.8em]">{unit}</sup>}
      </span>
      <span className="text-[11px] uppercase tracking-wide text-[var(--cl-muted)]">{label}{best && <BetterTag />}</span>
    </div>
  );
}

function ParityIcon({ state }: { state: Tri }) {
  if (state === true) return <Check className="w-[18px] h-[18px] shrink-0 text-[var(--cl-ink)]" strokeWidth={2.5} />;
  if (state === false) return <X className="w-[18px] h-[18px] shrink-0 text-[var(--cl-muted)]" strokeWidth={2.5} />;
  return <Minus className="w-[18px] h-[18px] shrink-0 text-[var(--cl-hairline-strong)]" strokeWidth={2.5} />;
}

function SpecRow({
  label,
  value,
  bullets,
}: {
  label: string;
  value: string;
  bullets?: string[];
}) {
  const showBullets = bullets && bullets.length >= 1;
  return (
    <div className="flex justify-between gap-6 py-3 border-[var(--cl-hairline-strong)] border-b last:border-b-0 first:mt-7 first:border-t">
      <dt className="shrink-0 pt-0.5 text-[12px] text-[var(--cl-muted)]">{label}</dt>
      <dd className="max-w-[66%] text-right text-[13px] leading-relaxed text-[var(--cl-ink)] [overflow-wrap:anywhere]">
        {showBullets ? (
          <ul className="flex flex-col gap-1.5 text-left">
            {bullets!.map((b, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden className="mt-[0.5em] h-1 w-1 rounded-full bg-[var(--cl-gold)] shrink-0" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

// --- Mini card thumb ------------------------------------------------------
// Landscape thumbnail of the real card art, draggable into a slot.

function MiniCard({
  card,
  onDragStart,
  onRemove,
}: {
  card: CreditCard;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, card.id)}
      className="shrink-0 relative w-[115px] h-[73px] md:w-[134px] md:h-[85px] cursor-grab active:cursor-grabbing group"
    >
      {/* Clip the card art (and its heavy drop-shadow) to a neat, card-shaped
          rectangle so it sits flat in the rail. */}
      <div className="absolute inset-0 overflow-hidden rounded-[0.6rem]">
        <div className="absolute top-0 left-0 pointer-events-none origin-top-left scale-[0.32]">
          <CardVisual card={card} />
        </div>
      </div>
      <button
        onClick={() => onRemove(card.id)}
        aria-label={`Remove ${card.name}`}
        className="absolute top-1 right-1 bg-[var(--cl-bg)] text-[var(--cl-muted)] hover:text-[var(--cl-ink)] p-1 rounded-full border border-[var(--cl-hairline-strong)] shadow-sm opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity z-30"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

// --- Vertical wallet drawer (desktop) --------------------------------------
// Docked flush to the left screen edge (flat left, rounded right). Fills its
// share of the stacked sidebar when open; collapses to a slim tab that yields
// its height to its sibling.

function VerticalRail({
  label,
  icon,
  tone = 'orange',
  ids,
  allCards,
  onDragStart,
  onRemove,
  addButton,
  emptyHint,
  defaultOpen = false,
}: {
  label: string;
  icon: React.ReactNode;
  tone?: 'orange' | 'violet';
  ids: string[];
  allCards: CreditCard[];
  onDragStart: (e: React.DragEvent, id: string) => void;
  onRemove: (id: string) => void;
  addButton?: React.ReactNode;
  emptyHint?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const known = ids.filter((id) => allCards.some((c) => c.id === id));

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-expanded={false}
        aria-label={`Expand ${label}`}
        className="compare-sidebar-tile shrink-0 flex h-[58px] w-[150px] flex-row items-center justify-between gap-2 px-[10px] text-[var(--compare-muted)] hover:bg-[var(--surface)] transition-colors"
      >
        <span className="text-[14px] font-medium whitespace-nowrap flex items-center gap-2.5">
          <span className="text-[var(--compare-text)]">{icon}</span>
          <span className="text-[var(--compare-text)]">{label}</span>
        </span>
        <span className="grid h-[24px] min-w-[24px] place-items-center rounded-full bg-[var(--compare-peach)] px-1.5 text-[13px] font-semibold text-[var(--compare-text)] shadow-[inset_0_1px_0_rgb(255_255_255_/_0.95)]">{known.length}</span>
      </button>
    );
  }

  return (
    <div className="compare-sidebar-tile w-[150px] flex-1 min-h-0 flex flex-col px-2.5 py-4">
      <div className="flex items-center justify-between gap-2 shrink-0">
        <span className="text-[14px] font-medium text-[var(--compare-text)] flex items-center gap-2.5 min-w-0">
          <span className="text-[var(--compare-text)] shrink-0">{icon}</span>
          <span className="truncate">{label}</span>
        </span>
        <span className="text-[13px] font-medium text-[var(--compare-muted)]">{known.length}</span>
        <button
          onClick={() => setOpen(false)}
          aria-expanded
          aria-label={`Collapse ${label}`}
          className="p-1 rounded-full text-[var(--cl-muted)] hover:text-[var(--cl-ink)] hover:bg-[var(--cl-hairline)]/60 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>

      <div className="mt-3 flex-1 min-h-0 flex flex-col items-center gap-3 overflow-y-auto hide-scrollbar">
        {known.map((id) => {
          const card = allCards.find((c) => c.id === id)!;
          return <MiniCard key={id} card={card} onDragStart={onDragStart} onRemove={onRemove} />;
        })}
        {addButton}
        {known.length === 0 && !addButton && (
          <p className="text-xs text-[var(--cl-muted)] py-8 px-1 text-center">{emptyHint || 'Nothing here yet.'}</p>
        )}
      </div>
    </div>
  );
}

// --- Horizontal card rail (mobile wallets + recently-viewed tray) -----------

function Rail({
  label,
  icon,
  ids,
  allCards,
  onDragStart,
  onRemove,
  addButton,
  emptyHint,
}: {
  label: string;
  icon: React.ReactNode;
  ids: string[];
  allCards: CreditCard[];
  onDragStart: (e: React.DragEvent, id: string) => void;
  onRemove: (id: string) => void;
  addButton?: React.ReactNode;
  emptyHint?: string;
}) {
  const [open, setOpen] = useState(false);
  const known = ids.filter((id) => allCards.some((c) => c.id === id));
  return (
    <div className="rounded-2xl border border-[var(--cl-hairline-strong)] bg-[var(--surface)] px-4 py-3 min-w-0 shadow-[0_16px_40px_-34px_rgba(0,0,0,0.42)]">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2"
      >
        <span className="text-[12px] font-semibold uppercase tracking-wider text-[var(--cl-muted)] flex items-center gap-1.5">
          <span className="text-[var(--cl-gold)]">{icon}</span> {label}
          <span className="text-[var(--cl-muted)]/70 normal-case tracking-normal">({known.length})</span>
        </span>
        <ChevronDown className={`w-4 h-4 text-[var(--cl-muted)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="flex gap-3.5 overflow-x-auto pt-3 pb-1 hide-scrollbar max-w-full">
              {known.map((id) => {
                const card = allCards.find((c) => c.id === id)!;
                return <MiniCard key={id} card={card} onDragStart={onDragStart} onRemove={onRemove} />;
              })}
              {addButton}
              {known.length === 0 && !addButton && (
                <p className="text-sm text-[var(--cl-muted)] py-6 px-1">{emptyHint || 'Nothing here yet.'}</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
