import BrandMark from './BrandMark';
import { motion } from 'motion/react';
import { Menu } from 'lucide-react';
import { useEffect, useState } from 'react';

interface NavigationProps {
  currentPage: string;
  setCurrentPage: (page: string) => void;
  findActive: boolean;
  onFindClick: () => void;
  // Clicking the wordmark returns to the Cards page. Falls back to a plain
  // home nav if unset.
  onLogoClick?: () => void;
}

/**
 * Floating corner elements at the top of the page: wordmark top-left; a nav
 * pill top-right with the two pages plus a "Find Me a Card" action that
 * opens the bottom-sheet questionnaire (not a route). Once the page scrolls,
 * a cream bar fades in behind them — with no bar, content (headings, the
 * blue method card) scrolled straight under the wordmark.
 */
export default function Navigation({ currentPage, setCurrentPage, findActive, onFindClick, onLogoClick }: NavigationProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  const links = [
    { id: 'home', label: 'Cards' },
    { id: 'compare', label: 'Compare' },
  ];
  const goToPage = (page: string) => {
    setCurrentPage(page);
    setIsMenuOpen(false);
  };
  const openFind = () => {
    onFindClick();
    setIsMenuOpen(false);
  };

  return (
    <motion.div
      initial={{ y: -12, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className={`fixed top-0 left-0 right-0 z-40 flex flex-col items-stretch gap-3 px-4 pt-4 pb-3 md:px-7 md:pt-6 md:pb-4 sm:flex-row sm:items-center sm:justify-between transition-[background-color,border-color] duration-200 border-b ${
        scrolled ? 'bg-[#fffaf0] border-[var(--cl-hairline)]' : 'bg-transparent border-transparent pointer-events-none'
      }`}
    >
      <div className="pointer-events-auto -mx-2 -mt-2 flex items-center justify-between rounded-2xl bg-[#fffaf0]/95 px-2 py-1.5 backdrop-blur sm:contents">
        <button
          onClick={onLogoClick ?? (() => setCurrentPage('home'))}
          className="pointer-events-auto flex items-center gap-2.5 group"
          aria-label="CardFit home"
        >
          <BrandMark />
        </button>
        <button
          type="button"
          aria-label="Menu"
          onClick={() => setIsMenuOpen((open) => !open)}
          className="pointer-events-auto grid h-10 w-10 place-items-center text-[var(--cl-ink)] sm:hidden"
        >
          <Menu className="h-8 w-8" strokeWidth={2.2} />
        </button>
      </div>

      {isMenuOpen && (
        <div className="pointer-events-auto flex flex-col gap-1 pop rounded-[1.1rem] bg-white p-1.5 sm:hidden">
          {links.map((link) => (
            <button
              key={link.id}
              onClick={() => goToPage(link.id)}
              className={`h-10 rounded-[0.85rem] px-4 text-left text-[14px] font-medium transition-colors ${
                currentPage === link.id
                  ? `bg-[var(--cl-pill)] text-[var(--cl-pill-ink)]`
                  : 'text-[var(--cl-ink)] hover:bg-[var(--cl-panel)]'
              }`}
            >
              {link.label}
            </button>
          ))}
          <button
            onClick={openFind}
            className={`h-10 rounded-[0.85rem] px-4 text-left text-[14px] font-medium transition-colors ${
              findActive ? 'bg-[var(--cl-pill)] text-[var(--cl-pill-ink)]' : 'text-[var(--cl-ink)] hover:bg-[var(--cl-panel)]'
            }`}
          >
            Find Me a Card
          </button>
        </div>
      )}

      <nav className="pointer-events-auto hidden h-[48px] w-auto items-center gap-1 pop rounded-full bg-white p-1 sm:flex">
        {links.map(link => (
          <button
            key={link.id}
            onClick={() => setCurrentPage(link.id)}
            className={`h-[38px] min-w-[100px] flex-none rounded-full px-4 text-[14px] font-medium transition-colors duration-200 ${
              currentPage === link.id
                ? `bg-[var(--cl-pill)] text-[var(--cl-pill-ink)] shadow-[inset_0_1px_0_rgb(255_255_255_/_0.18)]`
                : 'text-[var(--cl-ink)] hover:text-[var(--cl-ink)] hover:bg-[var(--cl-panel)]'
            }`}
          >
            {link.label}
          </button>
        ))}
        <button
          onClick={onFindClick}
          className={`h-[38px] min-w-[136px] flex-none rounded-full px-4 text-[14px] font-medium transition-colors duration-200 ${
            findActive ? 'bg-[var(--cl-pill)] text-[var(--cl-pill-ink)]' : 'text-[var(--cl-ink)] hover:text-[var(--cl-ink)] hover:bg-[var(--cl-panel)]'
          }`}
        >
          Find Me a Card
        </button>
      </nav>
    </motion.div>
  );
}
