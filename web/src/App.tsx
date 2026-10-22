/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { useEffect, useState } from 'react';
import { Analytics } from '@vercel/analytics/react';
import Navigation from './components/Navigation';
import CardCarousel from './components/CardCarousel';
import FindMyCard from './components/FindMyCard';
import Compare from './components/Compare';
import CursorGlow from './components/CursorGlow';
import { loadProfile, saveProfile } from './lib/profile';
import { saveRemoteProfile } from './lib/remoteProfile';
import { SNAPSHOT_AS_OF } from './lib/snapshot';

export interface MatchResult {
  filters: string[];
  ownedCards: string[];
  name?: string;
  email?: string;
  answers?: Record<string, unknown>;
}

function isFirstTimeProfile() {
  const p = loadProfile();
  return !(
    p.hasSeenCardsIntro ||
    p.name ||
    p.email ||
    p.ownedCards?.length ||
    p.filters?.length ||
    p.answers
  );
}

export default function App() {
  const [currentPage, setCurrentPage] = useState(() => (window.location.pathname === '/compare' ? 'compare' : 'home'));
  const [watchlist, setWatchlist] = useState<string[]>([]);
  // Cards the user told us they already hold (via Find Me a Card). Kept
  // separate from the general watchlist and shown apart on Compare.
  const [ownedCards, setOwnedCards] = useState<string[]>([]);
  const [homeFilters, setHomeFilters] = useState<string[]>([]);
  const [matchAnswers, setMatchAnswers] = useState<Record<string, unknown> | undefined>();
  const [findOpen, setFindOpen] = useState(false);
  // True right after Find Me a Card completes: the home page shows only
  // "Your best matches" (no filter bubbles) until the user browses all.
  const [matchMode, setMatchMode] = useState(false);
  // Bumped to remount CardCarousel on a logo click, resetting its internal
  // search text, provider, and index while opening the full cards view.
  const [homeResetKey, setHomeResetKey] = useState(0);
  const [isFirstTime, setIsFirstTime] = useState(isFirstTimeProfile);

  // Restore a returning visitor's cards + filters on load.
  useEffect(() => {
    const p = loadProfile();
    if (p.ownedCards?.length) setOwnedCards(p.ownedCards);
    if (p.filters?.length) setHomeFilters(p.filters);
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPage(window.location.pathname === '/compare' ? 'compare' : 'home');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigatePage = (page: string) => {
    setCurrentPage(page);
    const path = page === 'compare' ? '/compare' : '/';
    if (window.location.pathname !== path) window.history.pushState(null, '', path);
  };

  const handleComplete = (r: MatchResult) => {
    setHomeFilters(r.filters);
    setOwnedCards(r.ownedCards);
    setMatchAnswers(r.answers);
    setMatchMode(true);
    const profile = {
      name: r.name,
      email: r.email,
      ownedCards: r.ownedCards,
      filters: r.filters,
      answers: r.answers,
      hasSeenCardsIntro: true,
    };
    saveProfile(profile);
    setIsFirstTime(false);
    // Also persist to Supabase (email + this browser's secret token, see
    // lib/remoteProfile.ts) so the profile survives cleared site data.
    // Fire-and-forget: localStorage already has it if this fails.
    void saveRemoteProfile(profile);
    setFindOpen(false);
    setCurrentPage('home');
  };

  // Exit "Your best matches" back to normal browsing with filter bubbles.
  const browseAll = () => {
    setMatchMode(false);
    setHomeFilters([]);
    setMatchAnswers(undefined);
  };

  // Logo click: return to the full Cards page with card details visible.
  // Clears match/filter state and remounts CardCarousel so its internal
  // search/provider/index state resets too.
  const goHome = () => {
    navigatePage('home');
    browseAll();
    setHomeResetKey((k) => k + 1);
  };

  const completeCardsIntro = () => {
    saveProfile({ hasSeenCardsIntro: true });
    setIsFirstTime(false);
  };

  return (
    <>
      <CursorGlow />
      <div className="compare-light min-h-screen bg-[var(--cl-bg)] text-[var(--cl-ink)] font-sans selection:bg-primary/30">
      <Navigation
        currentPage={currentPage}
        setCurrentPage={navigatePage}
        findActive={findOpen}
        onFindClick={() => setFindOpen(true)}
        onLogoClick={goHome}
      />

      <main>
        {currentPage === 'home' && (
          <CardCarousel
            key={homeResetKey}
            watchlist={watchlist}
            setWatchlist={setWatchlist}
            filters={homeFilters}
            setFilters={setHomeFilters}
            ownedCards={ownedCards}
            matchMode={matchMode}
            matchAnswers={matchAnswers}
            onBrowseAll={browseAll}
            startWithResults={!isFirstTime}
            onIntroComplete={completeCardsIntro}
            onFindMatches={() => setFindOpen(true)}
          />
        )}
        {currentPage === 'compare' && (
          <Compare
            watchlist={watchlist}
            setWatchlist={setWatchlist}
            ownedCards={ownedCards}
            setOwnedCards={setOwnedCards}
          />
        )}
      </main>

      {/* Disclosure up front, not buried: who pays us (nobody), what the
          numbers are, and how fresh the data is. Keep "not paid" true — if
          affiliate links are ever added, this copy must change with them. */}
      <footer className="compare-light border-t border-[var(--cl-hairline)] bg-[var(--cl-panel)] px-6 py-12 text-sm text-[var(--cl-muted)]">
        <div className="mx-auto grid max-w-5xl gap-8 md:grid-cols-[1.2fr_1fr_1fr]">
          <div>
            <p className="font-editorial text-2xl text-[var(--cl-ink)]">CardFit</p>
            <p className="mt-2 max-w-xs leading-relaxed">
              An independent card finder. No card issuer pays for placement, and seeing your matches never runs a credit check.
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--cl-ink)]">About the numbers</p>
            <p className="mt-2 leading-relaxed">
              Values are estimates from your spending, minus the annual fee. Points and miles use conservative cash values.
              Terms change, so always confirm on the issuer's site before applying.
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--cl-ink)]">Data</p>
            <p className="mt-2 leading-relaxed">
              Card details collected from issuer websites, last refreshed {SNAPSHOT_AS_OF}. Not financial advice.
            </p>
          </div>
        </div>
        <p className="mx-auto mt-10 max-w-5xl border-t border-[var(--cl-hairline)] pt-6 text-xs">© 2026 CardFit.</p>
      </footer>

      <FindMyCard open={findOpen} onClose={() => setFindOpen(false)} onComplete={handleComplete} />
      </div>
      <Analytics />
    </>
  );
}
