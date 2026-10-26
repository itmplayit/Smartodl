/* Shared SmartODL identity used by public, auth and dashboard shells. */
export const BrandMark = ({ size = 44, radius: _radius, className = '' }) => (
  <svg className={`brand-mark-svg ${className}`.trim()} width={size} height={size} viewBox="0 0 68 68" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="smartodl-shield" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#0a7fba" />
        <stop offset="1" stopColor="#003654" />
      </linearGradient>
    </defs>
    <path d="M34 3 59 13v18c0 16-10 27-25 34C19 58 9 47 9 31V13L34 3Z" fill="url(#smartodl-shield)" />
    <path d="M45.5 20h-17C22.7 20 19 23.7 19 28.5s3.7 8.5 9.5 8.5h10c2.4 0 3.8 1.1 3.8 3s-1.4 3-3.8 3H20v7h18.5c6.6 0 11-3.9 11-10s-4.4-10-11-10h-10c-1.6 0-2.5-.8-2.5-2s.9-2 2.5-2h17Z" fill="#fff" />
    <circle cx="53" cy="15" r="7" fill="#ffc43d" />
    <path d="m50 15 2 2 4-5" fill="none" stroke="#002131" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const BrandLogo = ({ height = 44, compact = false, subtitle = true, className = '' }) => (
  <span className={`brand-logo ${compact ? 'brand-logo-compact' : ''} ${className}`.trim()}>
    <BrandMark size={height} />
    <span className="brand-logo-copy">
      <span className="brand-logo-name">Smart<span>ODL</span></span>
      {subtitle && <span className="brand-logo-subtitle">Open &amp; Distance Learning Platform</span>}
    </span>
  </span>
);

export default BrandMark;
