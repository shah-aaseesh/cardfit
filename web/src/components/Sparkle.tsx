// A four-point sparkle — the site's little "pop" of delight. Decorative only.
export default function Sparkle({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="currentColor">
      <path d="M12 0c.6 5.6 2.4 9 6.4 10.6L24 12l-5.6 1.4C14.4 15 12.6 18.4 12 24c-.6-5.6-2.4-9-6.4-10.6L0 12l5.6-1.4C9.6 9 11.4 5.6 12 0z" />
    </svg>
  );
}
