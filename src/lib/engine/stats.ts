/** Байесовское сравнение долей: вероятность, что у A конверсия (CTR, CR) выше, чем у B */

function gauss() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function gamma(k: number): number {
  if (k < 1) return gamma(k + 1) * Math.pow(Math.random(), 1 / k);
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number, v: number;
    do {
      x = gauss();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

const beta = (a: number, b: number) => {
  const x = gamma(a);
  return x / (x + gamma(b));
};

export function probBetter(succA: number, totalA: number, succB: number, totalB: number, draws = 4000) {
  let wins = 0;
  for (let i = 0; i < draws; i++) {
    if (beta(1 + succA, 1 + Math.max(0, totalA - succA)) > beta(1 + succB, 1 + Math.max(0, totalB - succB))) wins++;
  }
  return wins / draws;
}

export const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits).replace(".", ",")}%`;
export const times = (x: number) => `${x.toFixed(1).replace(".", ",")}`;
