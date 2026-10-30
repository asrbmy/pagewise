/** Original Pagewise mark: a page with a folded corner and a pen nib. */
export default function Logo({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true" focusable="false">
      <rect width="512" height="512" rx="112" fill="#0f766e" />
      <path d="M160 96h136l80 80v224a24 24 0 0 1-24 24H160a24 24 0 0 1-24-24V120a24 24 0 0 1 24-24z" fill="#fff" />
      <path d="M296 96v56a24 24 0 0 0 24 24h56z" fill="#99f6e4" />
      <rect x="176" y="216" width="160" height="16" rx="8" fill="#0f766e" />
      <rect x="176" y="256" width="160" height="16" rx="8" fill="#5eead4" />
      <rect x="176" y="296" width="112" height="16" rx="8" fill="#5eead4" />
      <path d="M352 336l44-44 24 24-44 44-34 10z" fill="#f59e0b" />
    </svg>
  );
}
