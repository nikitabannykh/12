// Образцы рекламных картинок по всем нишам и макетам (без фото).
// Запуск: npx tsx --conditions=react-server scripts/render-samples.tsx <папка> [макеты через запятую] [число вариантов]
import { writeFileSync, mkdirSync } from "fs";
import { renderCreative, type Layout } from "../src/lib/creative/render";
import { NICHES } from "../src/lib/niches";

const out = process.argv[2] || ".samples";
mkdirSync(out, { recursive: true });
const layouts: Layout[] = (process.argv[3]?.split(",") as Layout[]) || ["photo", "tag", "offer", "pricelist", "review"];
// Третий аргумент — сколько вариантов иллюстрации рисовать (по умолчанию все 3)
const variants = Number(process.argv[4] ?? 3);
(async () => {
  for (const n of NICHES) {
    for (const layout of layouts) for (let variant = 0; variant < variants; variant++) {
      const buf = await renderCreative({
        layout, width: 1080, height: 1080, variant,
        business: {
          name: "Студия Лак", niche: n.id, city: "Казань", address: "ул. Баумана, 15", offer: "−20% на первый визит",
          review: "Хожу второй год — ни разу не разочаровалась, всегда аккуратно и вовремя.",
          services: [{ name: n.examples[0], price: "1 900 ₽" }, { name: n.examples[1] ?? "Консультация", price: "2 400 ₽" }],
        },
      });
      writeFileSync(`${out}/${n.id}-${layout}-${variant}.png`, buf);
    }
  }
  console.log("ok");
})();
