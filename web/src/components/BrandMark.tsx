// CardFit's mark: two offset card shapes in brand blue — "a card that fits"
// — next to a heavy, tightly tracked wordmark.
export default function BrandMark({ size = 'md', onDark = false }: { size?: 'md' | 'lg'; onDark?: boolean }) {
  const box = size === 'lg' ? 'h-8 w-8' : 'h-7 w-7';
  const text = size === 'lg' ? 'text-[26px]' : 'text-[22px]';
  return (
    <span className="inline-flex items-center gap-2">
      <svg viewBox="0 0 32 32" className={box} aria-hidden="true">
        <rect x="3" y="9" width="20" height="14" rx="3.5" fill="var(--cl-brand)" opacity="0.35" transform="rotate(-10 13 16)" />
        <rect x="9" y="8" width="20" height="14" rx="3.5" fill="var(--cl-brand)" />
        <rect x="12" y="17" width="6" height="2" rx="1" fill="#fff" opacity="0.85" />
      </svg>
      <span className={`font-editorial ${text} leading-none ${onDark ? 'text-white' : 'text-[var(--cl-ink)]'}`}>CardFit</span>
    </span>
  );
}
