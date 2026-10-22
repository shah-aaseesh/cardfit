import { motion } from 'motion/react';
import { FILTERS, toggleFilter, FilterDef } from '../lib/filters';

interface BubbleFiltersProps {
  activeFilters: string[];
  onFiltersChange?: (filters: string[]) => void;
  desktopCompact?: boolean;
}

// Two tiers: the primary filters (account · reward · quality, incl. No Annual
// Fee / Premium) on top, and the spend-category refinements (Dining, Groceries,
// Gas, Balance Transfer) below as comparatively smaller bubbles.
const UPPER_GROUPS: Array<FilterDef['group']> = ['account', 'reward', 'quality'];
const ACCOUNT_IDS = FILTERS.filter((f) => f.group === 'account').map((f) => f.id);
const SPEND_FILTERS = FILTERS.filter((f) => f.group === 'spend');
const REQUIRED_GROUP_PROMPTS = [
  {
    ids: ACCOUNT_IDS,
    text: 'Choose Personal, Business, or Student to refine results.',
  },
  {
    ids: FILTERS.filter((f) => f.group === 'reward').map((f) => f.id),
    text: 'Choose Rewards or Cash Back to refine results.',
  },
  {
    ids: FILTERS.filter((f) => f.group === 'quality').map((f) => f.id),
    text: 'Choose No Annual Fee or Premium to refine results.',
  },
];

export default function BubbleFilters({ activeFilters, onFiltersChange, desktopCompact = false }: BubbleFiltersProps) {
  const handleToggle = (id: string) => onFiltersChange?.(toggleFilter(activeFilters, id));
  const missingPrompts = REQUIRED_GROUP_PROMPTS.filter((prompt) => !activeFilters.some((id) => prompt.ids.includes(id)));

  const bubble = (filter: FilterDef, i: number, small: boolean) => {
    const isActive = activeFilters.includes(filter.id);
    return (
      <motion.button
        key={filter.id}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: i * 0.015, ease: [0.16, 1, 0.3, 1] }}
        onClick={() => handleToggle(filter.id)}
        aria-pressed={isActive}
        className={`${small ? 'px-3 py-1 text-xs' : 'px-3.5 py-1.5 text-sm'} ${desktopCompact ? 'md:px-2.5 md:py-0.5 md:text-[12px]' : ''} ${filter.id === 'rewards' ? 'md:min-w-[5.5rem]' : ''} font-medium rounded-full border shadow-[0_10px_24px_-22px_rgb(17_17_20_/_0.45),inset_0_1px_0_rgb(255_255_255_/_0.86)] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cl-ink)]/30 ${
          isActive
            ? 'bg-[var(--cl-pill)] text-[var(--cl-pill-ink)] border-[var(--cl-pill)]'
            : 'bg-[var(--cl-surface)] text-[var(--cl-muted)] border-[var(--cl-hairline-strong)] hover:bg-[var(--cl-panel)] hover:text-[var(--cl-ink)]'
        }`}
      >
        {filter.label}
      </motion.button>
    );
  };

  let i = 0;

  return (
    <div className={`w-full flex flex-col items-center z-40 relative ${desktopCompact ? 'gap-2 md:gap-1.5' : 'gap-2.5'}`}>
      {missingPrompts.length > 0 && (
        <p className="px-4 text-center text-[13px] font-medium text-[var(--cl-muted)]">
          {missingPrompts.map((prompt) => prompt.text).join(' | ')}
        </p>
      )}
      {/* Primary filters: account · reward · quality. On desktop they sit on a
          single line (no wrap, no width cap); smaller screens wrap as needed. */}
      <div className={`max-w-3xl lg:max-w-none px-4 md:px-6 flex flex-wrap lg:flex-nowrap justify-center items-center ${desktopCompact ? 'gap-x-1.5 gap-y-1.5' : 'gap-x-2 gap-y-2'}`}>
        {UPPER_GROUPS.map((group, gi) => (
          <div key={group} className="contents">
            {gi > 0 && (
              <span aria-hidden="true" className="mx-1 h-4 w-px bg-[var(--cl-hairline-strong)] self-center hidden sm:inline-block" />
            )}
            {FILTERS.filter((f) => f.group === group).map((filter) => bubble(filter, i++, false))}
          </div>
        ))}
      </div>
      <div className={`max-w-3xl px-4 md:px-6 flex flex-wrap justify-center items-center ${desktopCompact ? 'gap-x-1.5 gap-y-1.5' : 'gap-x-2 gap-y-2'}`}>
        {SPEND_FILTERS.map((filter) => bubble(filter, i++, true))}
      </div>
    </div>
  );
}
