export function LogoMark({ size = 28 }: { size?: number }) {
  // Журнал записи, в котором все окна заняты
  const c = [0, 1, 2];
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true">
      <rect x="0.75" y="0.75" width="26.5" height="26.5" rx="7" fill="#1d2045" />
      {c.map((col) =>
        c.map((row) => (
          <rect key={`${col}-${row}`} x={5.5 + col * 6} y={5.5 + row * 6} width="5" height="5" rx="1.3" fill={row === 2 && col === 2 ? "#ffffff" : "#ffd84a"} opacity={row === 2 && col === 2 ? 0.25 : 1} />
        )),
      )}
    </svg>
  );
}

export function Logo({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 font-extrabold tracking-tight ${className}`}>
      <LogoMark size={size} />
      <span style={{ fontSize: size * 0.68 }}>Полный зал</span>
    </span>
  );
}
