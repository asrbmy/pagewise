/** Minimal stroke-icon set (24×24). Decorative by default; pass `label` to expose it to screen readers. */
const P = {
  undo: ['M3 7v6h6', 'M3 13a9 9 0 1 0 3-7.7L3 8'],
  redo: ['M21 7v6h-6', 'M21 13a9 9 0 1 1-3-7.7L21 8'],
  print: ['M6 9V2h12v7', 'M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2', 'M6 14h12v8H6z'],
  bold: ['M6 4h8a4 4 0 0 1 0 8H6z', 'M6 12h9a4 4 0 0 1 0 8H6z'],
  italic: ['M19 4h-9', 'M14 20H5', 'M15 4 9 20'],
  underline: ['M6 4v6a6 6 0 0 0 12 0V4', 'M4 21h16'],
  strike: ['M16 4H9a3 3 0 0 0-2.8 4', 'M14 12a4 4 0 0 1 0 8H6', 'M4 12h16'],
  textColor: ['M9 15l3-9 3 9', 'M10 12h4'],
  highlight: ['m9 11-6 6v3h9l3-3', 'm22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4'],
  link: ['M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7', 'M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7'],
  image: ['M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3', 'm21 15-5-5L5 21'],
  table: ['M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M3 9h18', 'M3 15h18', 'M9 3v18', 'M15 3v18'],
  alignLeft: ['M3 6h18', 'M3 12h12', 'M3 18h16'],
  alignCenter: ['M3 6h18', 'M6 12h12', 'M4 18h16'],
  alignRight: ['M3 6h18', 'M9 12h12', 'M5 18h16'],
  alignJustify: ['M3 6h18', 'M3 12h18', 'M3 18h18'],
  list: ['M9 6h12', 'M9 12h12', 'M9 18h12', 'M4 6h.01', 'M4 12h.01', 'M4 18h.01'],
  listOrdered: ['M10 6h11', 'M10 12h11', 'M10 18h11', 'M4 6h1v4', 'M4 10h2', 'M6 18H4c0-1 2-2 2-3s-1-1.5-2-1'],
  indent: ['M3 6h18', 'M11 12h10', 'M3 18h18', 'M3 9l3 3-3 3'],
  outdent: ['M3 6h18', 'M11 12h10', 'M3 18h18', 'M6 9l-3 3 3 3'],
  lineSpacing: ['M11 6h10', 'M11 12h10', 'M11 18h10', 'M5 4v16', 'M3 6l2-2 2 2', 'M3 18l2 2 2-2'],
  clearFormat: ['M4 7V4h16v3', 'M5 20h6', 'M13 4 8 20', 'm15 15 5 5', 'm20 15-5 5'],
  minus: ['M5 12h14'],
  plus: ['M12 5v14', 'M5 12h14'],
  chevronDown: ['m6 9 6 6 6-6'],
  chevronLeft: ['m15 18-6-6 6-6'],
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16', 'm21 21-4.3-4.3'],
  x: ['M18 6 6 18', 'm6 6 12 12'],
  check: ['M20 6 9 17l-5-5'],
  file: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6'],
  filePlus: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M12 12v6', 'M9 15h6'],
  trash: ['M3 6h18', 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6', 'M10 11v6', 'M14 11v6', 'M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2'],
  copy: ['M9 9h11v11H9z', 'M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1'],
  download: ['M12 3v12', 'm7 10 5 5 5-5', 'M5 21h14'],
  upload: ['M12 15V3', 'm7 8 5-5 5 5', 'M5 21h14'],
  moon: ['M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z'],
  sun: ['M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10', 'M12 2v2', 'M12 20v2', 'm4.9 4.9 1.4 1.4', 'm17.7 17.7 1.4 1.4', 'M2 12h2', 'M20 12h2', 'm4.9 19.1 1.4-1.4', 'm17.7 6.3 1.4-1.4'],
  lock: ['M5 11h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z', 'M8 11V7a4 4 0 0 1 8 0v4'],
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  cloudCheck: ['M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 0 1 0 9z', 'm9 13 2 2 4-4'],
  cloudOff: ['m2 2 20 20', 'M5.8 5.8A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.3-.2', 'M21 15.5A4.5 4.5 0 0 0 17.5 10h-1.8A7 7 0 0 0 9 5'],
  alert: ['M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z', 'M12 9v4', 'M12 17h.01'],
  info: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20', 'M12 16v-4', 'M12 8h.01'],
  loader: ['M21 12a9 9 0 1 1-6.2-8.6'],
  pageBreak: ['M3 12h3', 'M10.5 12h3', 'M18 12h3', 'M7 9V4h10v5', 'M7 15v5h10v-5'],
  hr: ['M3 12h18'],
  quote: ['M4 6h6v6a5 5 0 0 1-4 5', 'M14 6h6v6a5 5 0 0 1-4 5'],
  more: ['M12 5h.01', 'M12 12h.01', 'M12 19h.01'],
  home: ['M3 11 12 3l9 8', 'M5 10v10h14V10', 'M10 20v-6h4v6'],
  folder: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
  shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', 'm9 12 2 2 4-4'],
  keyboard: ['M3 6h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z', 'M6 10h.01', 'M10 10h.01', 'M14 10h.01', 'M18 10h.01', 'M7 14h10'],
  pencil: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'],
  rowAdd: ['M3 4h18v6H3z', 'M3 14h10', 'M17 14v6', 'M14 17h6'],
  colAdd: ['M4 3h6v18H4z', 'M14 3h6', 'M14 8h6', 'M17 11v6', 'M14 14h6'],
};

export default function Icon({ name, size = 18, label, className = '', strokeWidth = 1.8 }) {
  const paths = P[name];
  if (!paths) return null;
  return (
    <svg
      className={`icon ${name === 'loader' ? 'spin' : ''} ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
      focusable="false"
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
