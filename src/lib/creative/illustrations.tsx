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

// ─── Дополнительные варианты: чтобы картинки без фото не были одинаковыми во всех объявлениях ───

const nails2 = ({ ink, accent }: P) => (
  <g>
    {/* три флакона лака разной высоты и пилка */}
    {[0, 1, 2].map((i) => {
      const x = 70 + i * 92, h = [120, 150, 105][i], y = 330 - h;
      return (
        <g key={i}>
          <rect x={x} y={y} width="74" height={h} rx="18" fill={i === 1 ? accent : i === 0 ? "#E9B8C6" : ink} />
          <rect x={x + 12} y={y + 14} width="12" height={h - 40} rx="6" fill={WHITE} opacity={0.4} />
          <rect x={x + 20} y={y - 60} width="34" height="64" rx="7" fill={i === 2 ? accent : ink} />
        </g>
      );
    })}
    <ellipse cx="200" cy="338" rx="170" ry="14" fill={ink} opacity={0.12} />
    <g transform="rotate(-28 300 120)">
      <rect x="230" y="108" width="150" height="24" rx="12" fill="#D9C3B0" />
      <rect x="230" y="108" width="60" height="24" rx="12" fill={ink} opacity={0.25} />
    </g>
  </g>
);

const nails3 = ({ ink, accent }: P) => (
  <g>
    {/* веер типсов-образцов цвета */}
    {[-50, -25, 0, 25, 50].map((a, i) => (
      <g key={i} transform={`rotate(${a} 200 330)`}>
        <rect x="178" y="110" width="44" height="200" rx="22" fill={WHITE} stroke={ink} strokeWidth="4" />
        <path d="M178 150 Q178 110 200 110 Q222 110 222 150 L222 190 L178 190 Z" fill={[accent, "#E9B8C6", ink, "#F2D7C9", accent][i]} opacity={i === 4 ? 0.6 : 1} />
      </g>
    ))}
    <circle cx="200" cy="330" r="16" fill={ink} />
    <circle cx="200" cy="330" r="6" fill={WHITE} />
  </g>
);

const brows2 = ({ ink, accent }: P) => (
  <g>
    {/* пинцет и щёточка для бровей */}
    <g transform="rotate(-40 200 200)">
      <path d="M120 186 L330 192 L330 200 L120 198 Z" fill="#B9BEC8" />
      <path d="M120 202 L330 208 L330 216 L120 214 Z" fill="#D9DEE6" />
      <rect x="110" y="184" width="40" height="32" rx="8" fill={accent} />
    </g>
    <g transform="rotate(35 200 200)">
      <rect x="70" y="250" width="190" height="16" rx="8" fill={ink} />
      <rect x="255" y="238" width="70" height="40" rx="12" fill={accent} opacity={0.85} />
      {Array.from({ length: 9 }).map((_, i) => (
        <rect key={i} x={262 + i * 7} y="226" width="3" height="14" rx="1.5" fill={ink} />
      ))}
    </g>
    <path d="M110 120 Q200 70 290 110" stroke={ink} strokeWidth="16" fill="none" strokeLinecap="round" />
  </g>
);

const brows3 = ({ ink, accent }: P) => (
  <g>
    {/* зеркальце с отражением брови и ресниц */}
    <rect x="186" y="270" width="28" height="110" rx="14" fill={ink} />
    <circle cx="200" cy="180" r="120" fill={accent} />
    <circle cx="200" cy="180" r="100" fill={WHITE} />
    <path d="M125 160 Q200 115 275 150" stroke={ink} strokeWidth="13" fill="none" strokeLinecap="round" />
    <path d="M130 215 Q200 175 270 215" stroke={ink} strokeWidth="7" fill="none" strokeLinecap="round" />
    {Array.from({ length: 7 }).map((_, i) => {
      const x = 145 + i * 18.5;
      return <path key={i} d={`M${x} ${205 - Math.sin((i / 6) * Math.PI) * 18} l${(i - 3) * 3} -16`} stroke={ink} strokeWidth="5" strokeLinecap="round" />;
    })}
    <path d="M270 100 Q290 120 285 150" stroke={WHITE} strokeWidth="6" fill="none" opacity={0.6} strokeLinecap="round" />
  </g>
);

const hair2 = ({ ink, accent }: P) => (
  <g>
    {/* фен */}
    <rect x="90" y="120" width="190" height="96" rx="48" fill={accent} />
    <rect x="270" y="132" width="44" height="72" rx="10" fill={ink} />
    <circle cx="138" cy="168" r="26" fill={WHITE} opacity={0.35} />
    <path d="M150 210 L180 210 L200 340 L160 340 Z" fill={accent} />
    <rect x="152" y="330" width="56" height="20" rx="8" fill={ink} />
    <path d="M200 250 L215 250" stroke={WHITE} strokeWidth="6" strokeLinecap="round" opacity={0.6} />
    {/* поток воздуха */}
    {[0, 1, 2].map((i) => (
      <path key={i} d={`M330 ${140 + i * 28} q20 -10 40 0`} stroke={ink} strokeWidth="6" fill="none" strokeLinecap="round" opacity={0.5} />
    ))}
  </g>
);

const hair3 = ({ ink, accent }: P) => (
  <g>
    {/* расчёска-брашинг, ножницы и прядь */}
    <path d="M60 330 C120 250 150 180 140 90 C190 160 200 250 150 340 Z" fill={accent} />
    <path d="M100 300 C130 240 145 190 142 130" stroke={WHITE} strokeWidth="5" fill="none" opacity={0.5} strokeLinecap="round" />
    <rect x="220" y="80" width="70" height="150" rx="35" fill={ink} />
    {Array.from({ length: 6 }).map((_, r) =>
      [0, 1, 2].map((c) => <circle key={`${r}${c}`} cx={236 + c * 19} cy={102 + r * 21} r="5" fill={WHITE} opacity={0.8} />),
    )}
    <rect x="243" y="225" width="24" height="120" rx="12" fill={ink} />
    <g transform="translate(300 270) rotate(-20)">
      <circle cx="0" cy="0" r="14" fill="none" stroke={accent} strokeWidth="7" />
      <circle cx="30" cy="0" r="14" fill="none" stroke={accent} strokeWidth="7" />
      <path d="M8 12 L34 80 M22 12 L-4 80" stroke={accent} strokeWidth="7" strokeLinecap="round" />
    </g>
  </g>
);

const barber2 = ({ ink, accent }: P) => (
  <g>
    {/* барбер-столб */}
    <rect x="160" y="60" width="80" height="26" rx="10" fill={accent} />
    <rect x="160" y="314" width="80" height="26" rx="10" fill={accent} />
    <circle cx="200" cy="50" r="16" fill={accent} />
    <rect x="170" y="86" width="60" height="228" fill={WHITE} />
    {Array.from({ length: 6 }).map((_, i) => (
      <path key={i} d={`M170 ${86 + i * 46} L230 ${56 + i * 46} L230 ${78 + i * 46} L170 ${108 + i * 46} Z`} fill={i % 2 ? "#C8453C" : "#2F5DA8"} />
    ))}
    <rect x="164" y="86" width="72" height="6" fill={ink} opacity={0.4} />
    <path d="M90 360 L310 360" stroke={accent} strokeWidth="8" strokeLinecap="round" opacity={0.5} />
  </g>
);

const barber3 = ({ ink, accent }: P) => (
  <g>
    {/* помазок и чаша с пеной */}
    <path d="M90 250 L310 250 L290 340 Q200 360 110 340 Z" fill={accent} />
    <ellipse cx="200" cy="250" rx="110" ry="20" fill="#C9A15A" />
    <path d="M110 250 Q120 215 150 222 Q165 195 195 210 Q215 185 245 205 Q275 200 290 250 Z" fill={WHITE} />
    <g transform="rotate(18 230 160)">
      <path d="M200 60 Q230 40 260 60 L250 130 L210 130 Z" fill="#E8DCC8" />
      <rect x="205" y="128" width="50" height="22" rx="6" fill={ink} opacity={0.9} />
      <rect x="212" y="148" width="36" height="70" rx="14" fill={accent} />
    </g>
  </g>
);

const massage2 = ({ ink, accent }: P) => (
  <g>
    {/* стопка полотенец и бутылочка масла */}
    {[0, 1, 2].map((i) => (
      <g key={i}>
        <rect x={70 + i * 6} y={300 - i * 50} width={190 - i * 12} height="46" rx="20" fill={i === 1 ? accent : WHITE} stroke={ink} strokeWidth="5" />
        <circle cx={92 + i * 6} cy={323 - i * 50} r="12" fill="none" stroke={ink} strokeWidth="4" opacity={0.5} />
      </g>
    ))}
    <path d="M280 345 L280 230 Q280 205 300 200 L300 170 L330 170 L330 200 Q350 205 350 230 L350 345 Z" fill={accent} opacity={0.85} />
    <rect x="296" y="150" width="38" height="24" rx="6" fill={ink} />
    <path d="M292 240 L292 320" stroke={WHITE} strokeWidth="6" strokeLinecap="round" opacity={0.5} />
    <path d="M150 140 C180 90 230 90 250 70 C250 130 200 150 150 140 Z" fill={accent} />
  </g>
);

const massage3 = ({ ink, accent }: P) => (
  <g>
    {/* лотос на воде и свечи */}
    <path d="M60 300 q35 -16 70 0 t70 0 t70 0 t70 0" stroke={accent} strokeWidth="7" fill="none" strokeLinecap="round" opacity={0.6} />
    <path d="M90 335 q35 -16 70 0 t70 0 t70 0" stroke={accent} strokeWidth="7" fill="none" strokeLinecap="round" opacity={0.35} />
    <path d="M200 120 C230 160 230 230 200 270 C170 230 170 160 200 120 Z" fill={accent} />
    <path d="M200 270 C150 260 120 210 125 170 C165 185 195 225 200 270 Z" fill={accent} opacity={0.75} />
    <path d="M200 270 C250 260 280 210 275 170 C235 185 205 225 200 270 Z" fill={accent} opacity={0.75} />
    <path d="M200 272 C140 280 95 250 80 225 C130 220 175 240 200 272 Z" fill={ink} opacity={0.35} />
    <path d="M200 272 C260 280 305 250 320 225 C270 220 225 240 200 272 Z" fill={ink} opacity={0.35} />
    <rect x="310" y="90" width="34" height="60" rx="6" fill={WHITE} />
    <path d="M327 68 C319 78 322 88 327 88 C332 88 335 78 327 68 Z" fill="#F4B740" />
  </g>
);

const cosmetology2 = ({ ink, accent }: P) => (
  <g>
    {/* пипетка с каплей сыворотки */}
    <g transform="rotate(20 200 200)">
      <rect x="180" y="40" width="40" height="50" rx="16" fill={ink} />
      <rect x="186" y="88" width="28" height="16" rx="4" fill={ink} opacity={0.75} />
      <path d="M190 104 L210 104 L206 250 Q200 266 194 250 Z" fill={WHITE} stroke={ink} strokeWidth="5" />
      <path d="M194 170 L206 170 L205 248 Q200 258 195 248 Z" fill={accent} />
    </g>
    <path d="M150 290 C130 320 135 350 160 352 C185 350 190 320 150 290 Z" fill={accent} />
    <circle cx="300" cy="300" r="40" fill={accent} opacity={0.25} />
    <circle cx="300" cy="300" r="22" fill={accent} opacity={0.5} />
    <path d="M80 140 C100 100 140 100 150 80 C150 130 120 150 80 140 Z" fill={accent} opacity={0.75} />
  </g>
);

const cosmetology3 = ({ ink, accent }: P) => (
  <g>
    {/* баночка крема с завитком и тюбик */}
    <rect x="70" y="210" width="170" height="120" rx="24" fill={accent} />
    <rect x="62" y="180" width="186" height="42" rx="14" fill={ink} />
    <path d="M110 270 Q155 240 200 270" stroke={WHITE} strokeWidth="8" fill="none" strokeLinecap="round" opacity={0.6} />
    <path d="M120 170 C120 120 190 120 190 160 C190 185 150 185 150 160" stroke={WHITE} strokeWidth="18" fill="none" strokeLinecap="round" />
    <path d="M120 170 C120 120 190 120 190 160 C190 185 150 185 150 160" stroke={ink} strokeWidth="4" fill="none" strokeLinecap="round" opacity={0.25} />
    <g transform="rotate(12 300 230)">
      <path d="M262 110 L338 110 L330 300 L270 300 Z" fill={WHITE} stroke={ink} strokeWidth="5" />
      <rect x="276" y="300" width="48" height="40" rx="8" fill={ink} />
      <rect x="282" y="150" width="36" height="70" rx="8" fill={accent} opacity={0.8} />
    </g>
  </g>
);

const yoga2 = ({ ink, accent }: P) => (
  <g>
    {/* свёрнутый коврик, блок и растение */}
    <rect x="60" y="250" width="200" height="80" rx="40" fill={accent} />
    <circle cx="100" cy="290" r="40" fill={accent} />
    <circle cx="100" cy="290" r="26" fill={WHITE} opacity={0.35} />
    <circle cx="100" cy="290" r="12" fill={accent} />
    <path d="M150 250 L150 330" stroke={ink} strokeWidth="6" opacity={0.3} />
    <rect x="270" y="270" width="80" height="60" rx="10" fill={ink} />
    <rect x="280" y="210" width="60" height="62" rx="10" fill="#D9C3A0" />
    <path d="M300 205 L300 140" stroke={ink} strokeWidth="6" strokeLinecap="round" />
    <path d="M300 170 C270 160 255 130 260 110 C285 120 300 140 300 170 Z" fill={accent} opacity={0.85} />
    <path d="M300 155 C330 145 345 115 340 95 C315 105 300 125 300 155 Z" fill={accent} />
    <ellipse cx="200" cy="345" rx="170" ry="10" fill={ink} opacity={0.12} />
  </g>
);

const yoga3 = ({ ink, accent }: P) => (
  <g>
    {/* фигура в позе лотоса и солнце */}
    <circle cx="200" cy="170" r="120" fill="#F4B740" opacity={0.3} />
    <circle cx="200" cy="105" r="24" fill={ink} />
    <path d="M200 132 L200 230" stroke={ink} strokeWidth="26" strokeLinecap="round" />
    <path d="M196 150 L140 210 L170 250 M204 150 L260 210 L230 250" stroke={ink} strokeWidth="13" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    <path d="M110 280 Q200 220 290 280 Q200 300 110 280 Z" fill={ink} />
    <path d="M70 315 L330 315" stroke={accent} strokeWidth="14" strokeLinecap="round" />
  </g>
);

const fitness2 = ({ ink, accent }: P) => (
  <g>
    {/* секундомер и скакалка */}
    <circle cx="170" cy="210" r="105" fill={WHITE} stroke={ink} strokeWidth="12" />
    <rect x="152" y="80" width="36" height="30" rx="6" fill={ink} />
    <rect x="140" y="64" width="60" height="22" rx="8" fill={accent} />
    <path d="M170 210 L170 140" stroke={accent} strokeWidth="10" strokeLinecap="round" />
    <path d="M170 210 L215 235" stroke={ink} strokeWidth="8" strokeLinecap="round" />
    <circle cx="170" cy="210" r="10" fill={ink} />
    <path d="M170 210 L170 120 A90 90 0 0 1 255 180 Z" fill={accent} opacity={0.25} />
    <path d="M300 120 C380 200 360 340 260 350 C200 355 180 330 190 320" stroke={accent} strokeWidth="7" fill="none" strokeLinecap="round" />
    <rect x="288" y="80" width="22" height="50" rx="10" fill={ink} />
    <rect x="180" y="300" width="22" height="50" rx="10" fill={ink} transform="rotate(60 191 325)" />
  </g>
);

const fitness3 = ({ ink, accent }: P) => (
  <g>
    {/* коврик, бутылка воды и эспандер-кольцо */}
    <path d="M40 330 L360 330 L330 290 L70 290 Z" fill={accent} opacity={0.85} />
    <rect x="90" y="140" width="64" height="150" rx="20" fill={WHITE} stroke={ink} strokeWidth="6" />
    <rect x="102" y="112" width="40" height="32" rx="8" fill={ink} />
    <rect x="96" y="200" width="52" height="84" rx="14" fill={accent} opacity={0.35} />
    <circle cx="265" cy="200" r="72" fill="none" stroke={ink} strokeWidth="20" />
    <rect x="190" y="185" width="24" height="30" rx="8" fill={accent} />
    <rect x="316" y="185" width="24" height="30" rx="8" fill={accent} />
  </g>
);

const dance2 = ({ ink, accent }: P) => (
  <g>
    {/* диско-шар и ноты */}
    <path d="M200 30 L200 90" stroke={ink} strokeWidth="6" />
    <circle cx="200" cy="190" r="100" fill={accent} />
    {Array.from({ length: 5 }).map((_, r) =>
      Array.from({ length: 5 }).map((__, c) => (
        <rect key={`${r}${c}`} x={128 + c * 30} y={118 + r * 30} width="24" height="24" rx="4" fill={WHITE} opacity={(r + c) % 3 === 0 ? 0.7 : 0.25} />
      )),
    )}
    <path d="M70 330 l0 -60 l40 -12 l0 60" stroke={ink} strokeWidth="8" fill="none" strokeLinejoin="round" />
    <circle cx="62" cy="332" r="12" fill={ink} />
    <circle cx="102" cy="320" r="12" fill={ink} />
    <path d="M320 330 l0 -55" stroke={ink} strokeWidth="8" />
    <circle cx="310" cy="333" r="13" fill={ink} />
    <path d="M320 275 q22 10 18 32" stroke={ink} strokeWidth="7" fill="none" strokeLinecap="round" />
  </g>
);

const dance3 = ({ ink, accent }: P) => (
  <g>
    {/* пара танцоров */}
    <circle cx="160" cy="90" r="22" fill={ink} />
    <circle cx="250" cy="80" r="22" fill={ink} />
    <path d="M160 115 L165 220" stroke={ink} strokeWidth="20" strokeLinecap="round" />
    <path d="M250 105 L238 215" stroke={ink} strokeWidth="20" strokeLinecap="round" />
    <path d="M165 135 L205 120 L245 128" stroke={ink} strokeWidth="11" strokeLinecap="round" fill="none" />
    <path d="M160 140 L115 95 M245 130 L295 90" stroke={ink} strokeWidth="11" strokeLinecap="round" />
    <path d="M165 210 C120 240 100 300 95 330 L230 330 C215 290 200 240 168 210 Z" fill={accent} />
    <path d="M238 210 L265 330 M238 210 L215 330" stroke={ink} strokeWidth="13" strokeLinecap="round" />
    <path d="M130 330 L125 380 M190 330 L200 380" stroke={ink} strokeWidth="11" strokeLinecap="round" />
  </g>
);

const other2 = ({ ink, accent }: P) => (
  <g>
    {/* витрина с маркизой */}
    <rect x="80" y="150" width="240" height="200" rx="10" fill={WHITE} stroke={ink} strokeWidth="8" />
    {Array.from({ length: 6 }).map((_, i) => (
      <path key={i} d={`M${80 + i * 40} 110 L${120 + i * 40} 110 L${120 + i * 40} 160 Q${100 + i * 40} 182 ${80 + i * 40} 160 Z`} fill={i % 2 ? WHITE : accent} stroke={ink} strokeWidth="5" />
    ))}
    <rect x="110" y="210" width="90" height="140" rx="6" fill={accent} opacity={0.85} />
    <circle cx="185" cy="285" r="6" fill={WHITE} />
    <rect x="225" y="210" width="70" height="70" rx="6" fill="#E9E6EE" stroke={ink} strokeWidth="5" />
  </g>
);

const other3 = ({ ink, accent }: P) => (
  <g>
    {/* чат-пузырь с галочкой и часы */}
    <path d="M70 110 Q70 80 100 80 L280 80 Q310 80 310 110 L310 220 Q310 250 280 250 L150 250 L100 300 L110 250 L100 250 Q70 250 70 220 Z" fill={accent} />
    <path d="M140 165 l35 35 l70 -75" stroke={WHITE} strokeWidth="18" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="300" cy="300" r="56" fill={WHITE} stroke={ink} strokeWidth="8" />
    <path d="M300 300 L300 266 M300 300 L324 312" stroke={ink} strokeWidth="8" strokeLinecap="round" />
  </g>
);

const SCENES: Record<string, ((p: P) => React.ReactElement)[]> = {
  nails: [nails, nails2, nails3],
  brows: [brows, brows2, brows3],
  hair: [hair, hair2, hair3],
  barber: [barber, barber2, barber3],
  massage: [massage, massage2, massage3],
  cosmetology: [cosmetology, cosmetology2, cosmetology3],
  yoga: [yoga, yoga2, yoga3],
  fitness: [fitness, fitness2, fitness3],
  dance: [dance, dance2, dance3],
  other: [other, other2, other3],
};

/** Сколько вариантов иллюстрации есть у ниши */
export const illustrationCount = (niche: string) => (SCENES[niche] ?? SCENES.other).length;

/** variant — номер сюжета; меняется от объявления к объявлению, чтобы картинки без фото различались */
export function Illustration({ niche, palette, size, variant = 0 }: { niche: string; palette: P; size: number; variant?: number }) {
  // «Другая услуга» — общие рисунки записи (галочка, часы): к доставке еды или магазину они не подходят, лучше без рисунка
  if (niche === "other" || !SCENES[niche]) return <div style={{ display: "flex", width: size, height: size }} />;
  const list = SCENES[niche];
  const Scene = list[((variant % list.length) + list.length) % list.length];
  return (
    <svg width={size} height={size} viewBox="0 0 400 400">
      {Blob({ c: palette.accent })}
      {Sparkles({ c: palette.accent })}
      {Scene(palette)}
    </svg>
  );
}
