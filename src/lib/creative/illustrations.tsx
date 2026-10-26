/**
 * Тематические иллюстрации по нишам — когда нет фото владельца и не подключён YandexART.
 * Плоский стиль, цвета ниши. Рисуются как SVG и рендерятся в картинку вместе с макетом.
 * viewBox 400×400; size — сторона в пикселях.
 */
type P = { ink: string; accent: string; bg: string };
const SKIN = "#F2C9AE";
const SKIN_D = "#E3AE8E";
const WHITE = "#FFFDF8";

function Blob({ c }: { c: string }) {
  return <path d="M200 30c80 0 150 50 160 130s-30 170-120 200S50 350 35 260 120 30 200 30z" fill={c} opacity={0.16} />;
}

function Sparkles({ c }: { c: string }) {
  return (
    <g fill={c}>
      <path d="M330 70l6 16 16 6-16 6-6 16-6-16-16-6 16-6z" />
      <path d="M70 120l4 10 10 4-10 4-4 10-4-10-10-4 10-4z" />
      <circle cx="350" cy="250" r="5" />
      <circle cx="55" cy="300" r="4" />
    </g>
  );
}

const nails = ({ ink, accent }: P) => (
  <g>
    {/* флакон лака */}
    <rect x="262" y="170" width="70" height="110" rx="18" fill={accent} />
    <rect x="276" y="186" width="14" height="60" rx="7" fill={WHITE} opacity={0.45} />
    <rect x="280" y="120" width="34" height="56" rx="6" fill={ink} />
    {/* кисть руки снизу */}
    <path d="M95 400 L100 250 Q102 225 125 222 L215 222 Q240 225 240 250 L245 400 Z" fill={SKIN} />
    {[0, 1, 2, 3].map((i) => {
      const x = 104 + i * 34;
      const h = [118, 140, 132, 104][i];
      return (
        <g key={i}>
          <rect x={x} y={232 - h} width="30" height={h + 20} rx="15" fill={SKIN} />
          <rect x={x + 5} y={236 - h} width="20" height="30" rx="10" fill={accent} />
          <rect x={x + 9} y={241 - h} width="5" height="14" rx="2.5" fill={WHITE} opacity={0.6} />
          <path d={`M${x + 4} ${200} q11 6 22 0`} stroke={SKIN_D} strokeWidth="3" fill="none" strokeLinecap="round" />
        </g>
      );
    })}
  </g>
);

const brows = ({ ink, accent }: P) => (
  <g>
    <path d="M90 150 Q200 95 310 140" stroke={ink} strokeWidth="18" fill="none" strokeLinecap="round" />
    <path d="M70 240 Q200 140 330 240 Q200 330 70 240 Z" fill={WHITE} stroke={ink} strokeWidth="8" />
    <circle cx="200" cy="240" r="52" fill={accent} />
    <circle cx="200" cy="240" r="24" fill={ink} />
    <circle cx="216" cy="224" r="10" fill={WHITE} />
    {Array.from({ length: 9 }).map((_, i) => {
      const t = i / 8;
      const x = 85 + t * 230;
      const y = 240 - Math.sin(t * Math.PI) * 100 + 8;
      const ang = -90 + (t - 0.5) * 70;
      const dx = Math.cos((ang * Math.PI) / 180) * 34, dy = Math.sin((ang * Math.PI) / 180) * 34;
      return <path key={i} d={`M${x} ${y} q${dx * 0.3} ${dy * 0.8} ${dx} ${dy}`} stroke={ink} strokeWidth="6" fill="none" strokeLinecap="round" />;
    })}
  </g>
);

const hair = ({ ink, accent }: P) => (
  <g>
    <path d="M150 90 C90 100 80 200 95 270 C105 330 150 360 130 400 L300 400 C280 340 300 300 290 230 C280 140 250 80 150 90 Z" fill={accent} />
    <path d="M140 120 C110 180 120 260 150 330" stroke={WHITE} strokeWidth="6" fill="none" opacity={0.5} strokeLinecap="round" />
    <path d="M185 110 C215 120 240 160 236 205 C233 235 222 250 212 262 L214 300 L182 300 L182 262 C160 248 150 210 156 170 C160 135 168 112 185 110 Z" fill={SKIN} />
    <path d="M178 104 C130 120 128 190 150 230 C160 170 190 140 240 160 C230 120 210 100 178 104 Z" fill={ink} />
    {/* ножницы */}
    <g transform="translate(290 90) rotate(30)">
      <circle cx="0" cy="0" r="16" fill="none" stroke={ink} strokeWidth="7" />
      <circle cx="34" cy="0" r="16" fill="none" stroke={ink} strokeWidth="7" />
      <path d="M8 14 L40 90 M26 14 L-6 90" stroke={ink} strokeWidth="8" strokeLinecap="round" />
    </g>
  </g>
);

const barber = ({ ink, accent }: P) => (
  <g>
    {/* опасная бритва */}
    <g transform="rotate(-35 200 200)">
      <rect x="60" y="182" width="160" height="36" rx="18" fill={ink} />
      <path d="M210 182 L345 182 Q350 200 345 218 L210 218 Z" fill="#D9DEE6" />
      <path d="M210 182 L345 182 L345 190 L210 190 Z" fill={WHITE} opacity={0.7} />
      <circle cx="210" cy="200" r="8" fill={accent} />
    </g>
    {/* расчёска */}
    <g transform="rotate(30 200 200)">
      <rect x="70" y="250" width="260" height="26" rx="8" fill={accent} />
      {Array.from({ length: 22 }).map((_, i) => (
        <rect key={i} x={82 + i * 11} y="274" width="6" height={i % 2 ? 26 : 36} rx="2" fill={accent} />
      ))}
    </g>
    {/* усы-иконка */}
    <path d="M150 110 Q175 80 200 105 Q225 80 250 110 Q228 125 200 112 Q172 125 150 110 Z" fill={ink} />
  </g>
);

const massage = ({ ink, accent }: P) => (
  <g>
    <ellipse cx="200" cy="330" rx="130" ry="34" fill={accent} opacity={0.35} />
    <ellipse cx="200" cy="300" rx="110" ry="40" fill={ink} />
    <ellipse cx="200" cy="245" rx="88" ry="34" fill="#6D6A73" />
    <ellipse cx="200" cy="198" rx="66" ry="28" fill="#9A97A0" />
    <ellipse cx="200" cy="160" rx="44" ry="20" fill="#C9C6CC" />
    <path d="M250 150 C300 90 350 100 360 80 C350 150 300 170 250 150 Z" fill={accent} />
    <path d="M255 148 C290 125 320 112 352 86" stroke={WHITE} strokeWidth="3" fill="none" opacity={0.6} />
    {/* свеча */}
    <rect x="70" y="200" width="44" height="80" rx="8" fill={WHITE} />
    <path d="M92 178 C82 190 86 200 92 200 C98 200 102 190 92 178 Z" fill="#F4B740" />
  </g>
);

const cosmetology = ({ ink, accent }: P) => (
  <g>
    <rect x="95" y="170" width="100" height="170" rx="22" fill={accent} />
    <rect x="112" y="190" width="16" height="110" rx="8" fill={WHITE} opacity={0.4} />
    <rect x="125" y="120" width="40" height="56" rx="6" fill={ink} />
    <rect x="134" y="80" width="22" height="46" rx="11" fill="#1F1F24" />
    <rect x="215" y="250" width="110" height="90" rx="20" fill={WHITE} stroke={ink} strokeWidth="6" />
    <rect x="210" y="228" width="120" height="30" rx="10" fill={ink} />
    <path d="M300 120 C350 140 350 200 300 210 C280 170 280 140 300 120 Z" fill={accent} opacity={0.75} />
    <circle cx="250" cy="160" r="10" fill={accent} />
    <circle cx="272" cy="190" r="6" fill={accent} />
  </g>
);

const yoga = ({ ink, accent }: P) => (
  <g>
    <circle cx="300" cy="105" r="42" fill="#F4B740" opacity={0.85} />
    <path d="M60 345 L340 345 L370 375 L30 375 Z" fill={accent} />
    {/* фигура в позе дерева */}
    <circle cx="200" cy="95" r="24" fill={ink} />
    <path d="M200 120 L200 230" stroke={ink} strokeWidth="22" strokeLinecap="round" />
    <path d="M200 135 L160 80 M200 135 L240 80" stroke={ink} strokeWidth="14" strokeLinecap="round" />
    <path d="M160 80 Q200 30 240 80" stroke={ink} strokeWidth="10" fill="none" strokeLinecap="round" />
    <path d="M200 230 L200 345" stroke={ink} strokeWidth="16" strokeLinecap="round" />
    <path d="M200 232 L150 270 L195 292" stroke={ink} strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    <path d="M70 330 C60 290 80 260 100 250 C110 280 100 310 70 330 Z" fill={accent} opacity={0.7} />
  </g>
);

const fitness = ({ ink, accent }: P) => (
  <g>
    {/* гиря */}
    <path d="M140 150 C140 110 260 110 260 150" stroke={ink} strokeWidth="26" fill="none" strokeLinecap="round" />
    <circle cx="200" cy="245" r="95" fill={ink} />
    <rect x="160" y="230" width="80" height="34" rx="8" fill={accent} />
    <path d="M140 190 A70 70 0 0 1 180 165" stroke={WHITE} strokeWidth="8" fill="none" opacity={0.35} strokeLinecap="round" />
    {/* гантель */}
    <g transform="rotate(-20 320 330)">
      <rect x="270" y="320" width="100" height="16" rx="8" fill="#9A97A0" />
      <rect x="258" y="300" width="22" height="56" rx="6" fill={accent} />
      <rect x="360" y="300" width="22" height="56" rx="6" fill={accent} />
    </g>
  </g>
);

const dance = ({ ink, accent }: P) => (
  <g>
    <circle cx="215" cy="85" r="24" fill={ink} />
    <path d="M210 112 L195 220" stroke={ink} strokeWidth="22" strokeLinecap="round" />
    <path d="M207 130 L140 70 M207 130 L280 150" stroke={ink} strokeWidth="13" strokeLinecap="round" />
    <path d="M195 210 C150 230 120 300 110 330 L300 330 C270 290 240 240 198 210 Z" fill={accent} />
    <path d="M170 330 L160 390 M235 330 L290 370" stroke={ink} strokeWidth="13" strokeLinecap="round" />
    <path d="M300 70 l-6 40 a14 14 0 1 0 8 6 l4 -30 l18 6 l2 -10 z" fill={ink} />
  </g>
);

const other = ({ ink, accent }: P) => (
  <g>
    <rect x="80" y="100" width="240" height="220" rx="22" fill={WHITE} stroke={ink} strokeWidth="8" />
    <rect x="80" y="100" width="240" height="52" rx="22" fill={accent} />
    <rect x="80" y="130" width="240" height="22" fill={accent} />
    {[0, 1, 2].map((r) =>
      [0, 1, 2, 3].map((c) => (
        <rect key={`${r}${c}`} x={102 + c * 52} y={172 + r * 46} width="40" height="32" rx="7" fill={(r + c) % 3 === 0 ? accent : "#E9E6EE"} />
      )),
    )}
    <path d="M250 300 l20 20 l40 -46" stroke={ink} strokeWidth="14" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </g>
);

const SCENES: Record<string, (p: P) => React.ReactElement> = { nails, brows, hair, barber, massage, cosmetology, yoga, fitness, dance, other };

export function Illustration({ niche, palette, size }: { niche: string; palette: P; size: number }) {
  const Scene = SCENES[niche] ?? SCENES.other;
  return (
    <svg width={size} height={size} viewBox="0 0 400 400">
      {Blob({ c: palette.accent })}
      {Sparkles({ c: palette.accent })}
      {Scene(palette)}
    </svg>
  );
}
