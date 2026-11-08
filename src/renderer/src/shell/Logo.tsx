/** The Pusar mark: an open letter P around a core. Placeholder until M5's logo pass. */
export function Logo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5 22V3h9.5a6.5 6.5 0 0 1 0 13H10"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="3.5"
        strokeLinecap="square"
      />
      <circle cx="13.5" cy="9.5" r="1.75" fill="var(--accent)" />
    </svg>
  );
}
