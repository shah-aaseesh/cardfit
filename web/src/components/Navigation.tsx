import { motion } from 'motion/react';
import { Menu } from 'lucide-react';
import { useState } from 'react';

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
 * No header bar: floating corner elements. Wordmark top-left; a nav pill
 * top-right with the two pages plus a "Find Me a Card" action that opens
 * the bottom-sheet questionnaire (not a route).
 */
export default function Navigation({ currentPage, setCurrentPage, findActive, onFindClick, onLogoClick }: NavigationProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
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
      className="fixed top-4 left-4 right-4 md:top-6 md:left-7 md:right-7 z-40 flex flex-col items-stretch gap-3 pointer-events-none sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-center justify-between sm:contents">
        <button
          onClick={onLogoClick ?? (() => setCurrentPage('home'))}
          className="pointer-events-auto flex items-center gap-2.5 group"
          aria-label="CardFit home"
        >
          <span className="font-editorial text-[30px] leading-none text-[var(--cl-ink)] sm:text-[26px]">CardFit</span>
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
        <div className="pointer-events-auto flex flex-col gap-1 rounded-[1.1rem] border border-[var(--cl-hairline-strong)] bg-[var(--cl-surface)] p-1.5 shadow-[0_22px_54px_-34px_rgb(0_0_0_/_0.45)] sm:hidden">
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

      <nav className="pointer-events-auto hidden h-[48px] w-auto items-center gap-1 rounded-full border border-[var(--cl-hairline-strong)] bg-[var(--cl-surface)] p-1 shadow-[0_10px_28px_-24px_rgb(0_0_0_/_0.55)] sm:flex">
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
