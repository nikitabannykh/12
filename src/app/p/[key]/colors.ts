/**
 * Цвета страницы записи с гарантированной контрастностью (WCAG AA: текст ≥ 4,5:1).
 * Палитры ниш бывают и светлыми, и тёмными (барбершоп): белые карточки, кнопки и цены
 * получают свой цвет текста, а не наследуют цвет текста страницы.
 */
type RGB = [number, number, number];

const toRgb = (hex: string): RGB => {
  const h = hex.replace("#", "");
  const f = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)) as RGB;
};
const toHex = (c: RGB) => "#" + c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0")).join("").toUpperCase();
const lum = (hex: string) => {
  const [r, g, b] = toRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
/** t = 0 → a, t = 1 → b */
const mix = (a: string, b: string, t: number) => {
  const A = toRgb(a), B = toRgb(b);
  return toHex(A.map((v, i) => v + (B[i] - v) * t) as RGB);
};

/** Сдвигает цвет к чёрному или белому (что даёт больший контраст с фоном), пока не наберётся min */
export function ensure(fg: string, bg: string, min = 4.5): string {
  if (contrast(fg, bg) >= min) return fg.toUpperCase();
  const target = contrast("#000000", bg) >= contrast("#FFFFFF", bg) ? "#000000" : "#FFFFFF";
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const c = mix(fg, target, t);
    if (contrast(c, bg) >= min) return c;
  }
  return target;
}

/** Приглушённый текст: как можно ближе к фону, но не ниже min */
function soft(ink: string, bg: string, min = 4.5): string {
  let best = ink;
  for (let t = 0.05; t < 1; t += 0.05) {
    const c = mix(ink, bg, t);
    if (contrast(c, bg) >= min) best = c;
    else break;
  }
  return best;
}

export type LandingColors = {
  bg: string; ink: string; inkSoft: string;
  card: string; cardInk: string; cardSoft: string;
  accent: string; onAccent: string; accentOnCard: string; accentOnBg: string;
};

export function landingColors(p: { bg: string; ink: string; accent: string }): LandingColors {
  const bg = p.bg;
  const card = "#FFFFFF";
  const ink = ensure(p.ink, bg, 7);
  // Текст на белых карточках: тёмный цвет ниши, если он тёмный, иначе нейтральный тёмный
  const cardInk = ensure(contrast(p.ink, card) >= 7 ? p.ink : "#1F2128", card, 7);
  // Кнопки и плашки цвета акцента: белый текст, а если не читается — тёмный; если и он не читается — темнее сам акцент
  let accent = p.accent;
  let onAccent = contrast("#FFFFFF", accent) >= 4.5 ? "#FFFFFF" : contrast(cardInk, accent) >= 4.5 ? cardInk : "";
  if (!onAccent) {
    accent = ensure(accent, "#FFFFFF", 4.5);
    onAccent = "#FFFFFF";
  }
  return {
    bg, ink, inkSoft: soft(ink, bg),
    card, cardInk, cardSoft: soft(cardInk, card),
    accent, onAccent,
    accentOnCard: ensure(p.accent, card, 4.5),
    accentOnBg: ensure(p.accent, bg, 3), // только для декоративных точек и рамок (≥ 3:1)
  };
}
