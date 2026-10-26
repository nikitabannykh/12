// Образцы рекламных картинок по всем нишам и макетам (без фото).
// Запуск: npx tsx --conditions=react-server scripts/render-samples.tsx <папка>
import { writeFileSync, mkdirSync } from "fs";
import { renderCreative, type Layout } from "../src/lib/creative/render";
import { NICHES } from "../src/lib/niches";

const out = process.argv[2] || ".samples";
mkdirSync(out, { recursive: true });
const layouts: Layout[] = (process.argv[3]?.split(",") as Layout[]) || ["photo", "tag", "offer", "pricelist", "review"];
(async () => {
  for (const n of NICHES) {
    for (const layout of layouts) {
      const buf = await renderCreative({
        layout, width: 1080, height: 1080,
        business: {
          name: "Студия Лак", niche: n.id, city: "Казань", address: "ул. Баумана, 15", offer: "−20% на первый визит",
          review: "Хожу второй год — ни разу не разочаровалась, всегда аккуратно и вовремя.",
          services: [{ name: n.examples[0], price: "1 900 ₽" }, { name: n.examples[1] ?? "Консультация", price: "2 400 ₽" }],
        },
      });
      writeFileSync(`${out}/${n.id}-${layout}.png`, buf);
    }
  }
  console.log("ok");
})();
