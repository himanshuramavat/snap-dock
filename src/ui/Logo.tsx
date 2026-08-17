/**
 * SnapDock's mark: a capture frame snapping down onto a dock rail.
 * Drawn inline so it inherits the accent colour and stays crisp at any size.
 *
 * This is the same artwork as the toolbar icons in public/icons/. If you change it,
 * mirror the change in scripts/generate-icons.mjs and re-run `npm run icons`.
 */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="2" y="2" width="20" height="20" rx="6" fill="var(--sd-accent)" />
      <path
        d="M8 7.5h1.6M14.4 7.5H16a.5.5 0 0 1 .5.5v1.6M7.5 9.6V8a.5.5 0 0 1 .5-.5"
        stroke="#fff"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
        opacity="0.9"
      />
      <path
        d="M12 9.5v4.2m0 0 2-2m-2 2-2-2"
        stroke="#fff"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M8 16.5h8" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" opacity="0.75" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span style={{ fontWeight: 650, letterSpacing: '-0.01em', color: 'var(--sd-text)' }}>
      SnapDock
    </span>
  );
}
