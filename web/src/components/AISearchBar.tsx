import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowUp, X } from 'lucide-react';
import { parseQueryToFilters } from '../lib/searchParse';

const PLACEHOLDERS = [
  "a travel card with lounge access and no foreign fees...",
  "cashback for groceries and gas...",
  "my first card, something to build credit with...",
  "big sign-up bonus, fee under $100...",
];

interface AISearchBarProps {
  onQueryChange: (query: string) => void;
  onFiltersParsed: (filters: string[]) => void;
  /** Fired only on an explicit submit (arrow press / Enter) with non-empty
   *  text. Used by the landing hero to advance to results only on submit. */
  onSubmit?: () => void;
  /** When true, typing does nothing — the bar reacts only when the user
   *  submits. Keeps the onboarding page from jumping to results mid-type;
   *  the results-view bar leaves this off for live filtering. */
  submitOnly?: boolean;
  /** Optional element pinned inside the bar on the left (e.g. a provider
   *  filter), separated from the input by a divider. */
  leftSlot?: React.ReactNode;
  compact?: boolean;
  examples?: string[];
  /** Text to start with, e.g. the query submitted on the landing hero, so the
   *  results-view bar shows what the user searched instead of going blank. */
  initialValue?: string;
}

export default function AISearchBar({ onQueryChange, onFiltersParsed, onSubmit, submitOnly, leftSlot, compact, examples, initialValue = '' }: AISearchBarProps) {
  const [value, setValue] = useState(initialValue);
  const [parsing, setParsing] = useState(false);
  const [placeholder, setPlaceholder] = useState('');
  const [phIndex, setPhIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const parseSeq = useRef(0);
  const reducedMotion = useRef(
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  // Typewriter placeholder, same behavior as the Find My Card free-text
  // step. Static text under prefers-reduced-motion.
  useEffect(() => {
    if (reducedMotion.current) {
      setPlaceholder('Describe your ideal card...');
      return;
    }
    let timeout: ReturnType<typeof setTimeout>;
    if (!isDeleting) {
      if (charIndex < PLACEHOLDERS[phIndex].length) {
        timeout = setTimeout(() => {
          setPlaceholder(prev => prev + PLACEHOLDERS[phIndex][charIndex]);
          setCharIndex(c => c + 1);
        }, 45);
      } else {
        timeout = setTimeout(() => setIsDeleting(true), 2800);
      }
    } else {
      if (charIndex > 0) {
        timeout = setTimeout(() => {
          setPlaceholder(prev => prev.slice(0, -1));
          setCharIndex(c => c - 1);
        }, 18);
      } else {
        setIsDeleting(false);
        setPhIndex(p => (p + 1) % PLACEHOLDERS.length);
      }
    }
    return () => clearTimeout(timeout);
  }, [charIndex, phIndex, isDeleting]);

  // Parse free text into filter toggles. Sequence-guarded so a slow LLM
  // response can never clobber the result of a newer keystroke.
  const runParse = useCallback(async (query: string) => {
    if (!query.trim()) return;
    const seq = ++parseSeq.current;
    setParsing(true);
    try {
      const filters = await parseQueryToFilters(query);
      if (seq === parseSeq.current) onFiltersParsed(filters);
    } finally {
      if (seq === parseSeq.current) setParsing(false);
    }
  }, [onFiltersParsed]);

  const handleChange = (next: string) => {
    setValue(next);
    // In submit-only mode typing never triggers anything — the user must
    // press the arrow (or Enter) to advance.
    if (submitOnly) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onQueryChange(next);
      runParse(next);
    }, 500);
  };

  const submit = () => {
    // Require typed text — mirrors the disabled arrow, and stops an empty
    // Enter from advancing the onboarding page.
    if (!value.trim()) return;
    clearTimeout(debounceRef.current);
    onQueryChange(value);
    runParse(value);
    onSubmit?.();
  };

  const clear = () => {
    setValue('');
    clearTimeout(debounceRef.current);
    parseSeq.current++;
    setParsing(false);
    onQueryChange('');
  };

  return (
    <div className={`relative w-full mx-auto ${compact ? 'max-w-[52rem] md:max-w-[46rem]' : 'max-w-[62.5rem]'}`}>
      <div className={`flex items-center rounded-full bg-[var(--cl-surface)] border border-[var(--cl-hairline-strong)] shadow-[0_18px_42px_-30px_rgb(0_0_0_/_0.38)] focus-within:border-[var(--cl-ink)] transition-colors ${
        compact ? 'gap-1 pl-3 pr-1.5 py-1.5 sm:pl-4 sm:pr-2 md:py-1' : 'gap-1.5 pl-4 pr-2 py-2 sm:pl-5 sm:pr-2.5 sm:py-2.5'
      }`}>
        {leftSlot && (
          <div className={`shrink-0 flex items-center border-r border-[var(--cl-hairline-strong)] ${compact ? 'pr-2 mr-1.5 sm:pr-3.5 sm:mr-2 md:pr-3 md:mr-1.5' : 'pr-3 mr-2 sm:pr-5 sm:mr-3'}`}>{leftSlot}</div>
        )}
        <input
          type="text"
          value={value}
          onChange={e => handleChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          placeholder={value ? '' : placeholder + (reducedMotion.current ? '' : '|')}
          aria-label="Describe the card you're looking for"
          className={`flex-1 min-w-0 bg-transparent border-none outline-none text-[var(--cl-ink)] placeholder-[var(--cl-muted)] ${
            compact ? 'text-[13px] py-1 pl-0.5 sm:text-[14px] md:text-[13px] md:py-0.5' : `text-[14px] py-1.5 sm:text-[15px] ${leftSlot ? 'pl-1' : 'pl-3'}`
          }`}
        />
        {value && (
          <button
            onClick={clear}
            aria-label="Clear search"
            className={`text-[var(--cl-muted)] hover:text-[var(--cl-ink)] transition-colors shrink-0 ${compact ? 'p-1' : 'p-1.5'}`}
          >
            <X className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
          </button>
        )}
        <button
          onClick={submit}
          disabled={!value.trim()}
          aria-label="Match filters to my description"
          className={`${compact ? 'w-8 h-8 md:w-7 md:h-7' : 'w-9 h-9 sm:w-10 sm:h-10'} rounded-full flex items-center justify-center shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cl-ink)]/30 ${
            value.trim()
              ? 'bg-[var(--cl-pill)] text-[var(--cl-pill-ink)] hover:opacity-90'
              : 'bg-[var(--cl-hairline)] text-[var(--cl-muted)] cursor-default'
          }`}
        >
          {parsing ? (
            <span className={`${compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} rounded-full border-2 border-[var(--cl-pill-ink)]/30 border-t-[var(--cl-pill-ink)] animate-spin`} aria-hidden="true" />
          ) : (
            <ArrowUp className={compact ? 'w-3.5 h-3.5 md:w-3 md:h-3' : 'w-4 h-4'} />
          )}
        </button>
      </div>
      {examples && examples.length > 0 && (
        <div className="mx-auto mt-5 grid w-full max-w-[44rem] grid-cols-1 gap-2 px-1 sm:grid-cols-2 sm:px-0">
          {examples.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setValue(example)}
              className="text-left text-[14px] leading-snug text-[var(--cl-muted)] underline decoration-[var(--cl-hairline-strong)] underline-offset-4 transition-colors hover:text-[var(--cl-ink)]"
            >
              {example}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
