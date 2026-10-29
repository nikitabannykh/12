export function LogoMark({ size = 28 }: { size?: number }) {
  // «С» с жёлтой фарой: реклама едет сама
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true">
      <rect x="0.75" y="0.75" width="26.5" height="26.5" rx="7" fill="#1d2045" />
      <path d="M20 8.6 A7.6 7.6 0 1 0 20 19.4" fill="none" stroke="#ffffff" strokeWidth="3.4" strokeLinecap="round" />
      <circle cx="21.2" cy="14" r="2.4" fill="#ffd84a" />
      <rect x="13" y="13" width="5" height="2" rx="1" fill="#ffd84a" opacity="0.35" />
    </svg>
  );
}

export function Logo({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 font-extrabold tracking-tight ${className}`}>
      <LogoMark size={size} />
      <span style={{ fontSize: size * 0.68 }}>Самоход</span>
    </span>
  );
}
