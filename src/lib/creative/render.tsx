import "server-only";
import { ImageResponse } from "next/og";
import { readFile } from "fs/promises";
import path from "path";
import type { Business } from "../db/schema";
import { isMedical, nicheById } from "../niches";
import { Illustration } from "./illustrations";
import { imageSize } from "./imagesize";
import { withoutSuperlatives } from "../engine/extras";

/**
 * Макеты рекламных картинок. Принцип: настоящее фото (владельца или реалистичная генерация YandexART)
 * + один крупный факт, который продаёт: цена, предложение, отзыв или прайс.
 * Без фото — типографские карточки в цветах ниши: прайс, предложение, отзыв.
 * Никаких «нейро-лиц» и шаблонных градиентов — так объявления выглядят как от живого бизнеса.
 */
export type Layout = "photo" | "tag" | "pricelist" | "review" | "offer" | "benefit";
export const LAYOUT_NAME: Record<Layout, string> = {
  photo: "Чистое фото",
  tag: "Подпись на фото",
  pricelist: "Прайс-карточка",
  review: "Отзыв клиента",
  offer: "Предложение крупно",
  benefit: "Преимущество с рисунком",
};

type Font = { name: string; data: ArrayBuffer; weight: 500 | 700 | 800; style: "normal" };
let fontsPromise: Promise<Font[]> | null = null;
function fonts() {
  fontsPromise ??= (async () => {
    const dir = path.join(process.cwd(), "assets", "fonts");
    const files: [string, 500 | 700 | 800][] = [["Onest_500Medium.ttf", 500], ["Onest_700Bold.ttf", 700], ["Onest_800ExtraBold.ttf", 800]];
    return Promise.all(
      files.map(async ([f, weight]) => {
        const buf = await readFile(path.join(dir, f));
        return { name: "Onest", data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, weight, style: "normal" as const };
      }),
    );
  })();
  return fontsPromise;
}

export type RenderInput = {
  layout: Layout;
  width: number;
  height: number;
  business: Pick<Business, "name" | "niche" | "services" | "offer" | "review" | "address" | "city"> & Partial<Pick<Business, "description" | "advantages">>;
  photo?: { data: Buffer; mime: string } | null;
  headline?: string;
  price?: string;
  /** Номер сюжета иллюстрации (когда нет фото): разные объявления — разные картинки */
  variant?: number;
};

const dataUri = (p: { data: Buffer; mime: string }) => `data:${p.mime};base64,${p.data.toString("base64")}`;

/** Предупреждение для рекламы медуслуг (закон «О рекламе», ст. 24 ч. 7; Директ требует его на картинках и баннерах) */
export const MEDICAL_WARNING = "Есть противопоказания. Посоветуйтесь с врачом";

/**
 * Заголовок на картинке — коротко: без уточнений в скобках («(новорожденные и дети до 14 лет)») и не длиннее ~34 символов,
 * обрезаем по слову. Полное название услуги остаётся в тексте объявления
 */
export function shortHeadline(s: string): string {
  let t = s.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
  if (t.length > 34) {
    const cut = t.slice(0, 34);
    t = (cut.includes(" ") ? cut.slice(0, cut.lastIndexOf(" ")) : cut).replace(/[\s,.;:–—-]+$/, "");
  }
  return t ? t[0].toUpperCase() + t.slice(1) : s;
}

export async function renderCreative(inp: RenderInput): Promise<Buffer> {
  const n = nicheById(inp.business.niche);
  const { bg, ink, accent } = n.palette;
  // Медуслуги: полоса с предупреждением внизу на всю ширину — 6,5% площади (нужно не меньше 5%), не сверху:
  // верх баннера закрывают значки площадки, и Директ такое отклоняет
  const strip = isMedical(inp.business) ? Math.ceil(inp.height * 0.065) : 0;
  const W = inp.width, H = inp.height - strip;
  const wide = W / H > 1.3;
  const u = W / 1080;
  const photo = inp.photo ? dataUri(inp.photo) : null;
  const svc = inp.business.services?.[0];
  // Без услуг от владельца — нейтральное название ниши, а не пример вроде «Пилатес на реформерах»
  const headline = shortHeadline(inp.headline || svc?.name || (n.id === "other" ? inp.business.name : n.generic));
  const variant = inp.variant ?? 0;
  // Цены на картинках не пишем: цена есть в тексте объявления и уточнениях, а на картинке она старит креатив
  // и путает, когда цена меняется. Картинка продаёт настроение, результат и преимущество
  const price = "";
  const place = inp.business.address?.split(",")[0] || inp.business.city;
  const layout: Layout = inp.layout;
  // На тёмных палитрах (барбершоп) «ink» светлый — для бумажного ценника берём тёмный текст
  const isLight = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16) > 500;
  const tagInk = isLight(ink) ? bg : ink;
  const box = { position: "absolute" as const, top: 0, left: 0, width: W, height: H, display: "flex", overflow: "hidden" as const };
  const dims = inp.photo ? imageSize(inp.photo.data) : null;
  const crop = dims && dims.width && dims.height ? (() => {
    const k = Math.max(W / dims.width, H / dims.height);
    const w = Math.ceil(dims.width * k), h = Math.ceil(dims.height * k);
    return { w, h, x: Math.round((W - w) / 2), y: Math.round((H - h) * 0.22) };
  })() : null;

  // Без фото вместо него — тематическая иллюстрация ниши
  // 4:3 тоже «широкая» картинка, но иллюстрацию считаем как для 16:9 — иначе она наезжает на текст
  const wideH = Math.min(H, (W * 9) / 16);
  const illoSize = (wide ? 0.62 * wideH : 0.62 * W);
  const Photo = ({ dim = 0, illo = "right" }: { dim?: number; illo?: "right" | "center" | "corner" | "none" }) =>
    photo ? (
      <div style={box}>
        {/* Кадрируем чуть выше центра: вывески, лица и интерьер обычно в верхней части кадра, а пол и низ можно обрезать
            (object-position рендерер картинок не понимает — считаем положение сами) */}
        {crop ? <img src={photo} width={crop.w} height={crop.h} style={{ position: "absolute", left: crop.x, top: crop.y, width: crop.w, height: crop.h }} /> : <img src={photo} width={W} height={H} style={{ width: W, height: H, objectFit: "cover" }} />}
        {dim ? <div style={{ ...box, background: `rgba(14,12,24,${dim})` }} /> : null}
      </div>
    ) : (
      <div style={{ ...box, background: bg }}>
        {illo === "none" ? null : (
          <div
            style={{
              position: "absolute", display: "flex",
              ...(illo === "center"
                ? { left: (W - illoSize * 1.15) / 2, top: (wide ? 10 : 40) * u }
                : illo === "corner"
                  ? { right: 30 * u, top: 30 * u }
                  : { right: wide ? 40 * u : 10 * u, top: wide ? (H - illoSize) / 2 : 20 * u }),
            }}
          >
            <Illustration niche={inp.business.niche} variant={variant} palette={n.palette} size={illo === "center" ? illoSize * 1.15 : illo === "corner" ? 0.3 * Math.min(W, H) : illoSize} />
          </div>
        )}
      </div>
    );

  let el: React.ReactElement;
  switch (layout) {
    case "photo":
      el = photo ? (
        <div style={{ width: W, height: H, display: "flex", position: "relative" }}>
          <Photo />
        </div>
      ) : (
        <div style={{ width: W, height: H, display: "flex", position: "relative", fontFamily: "Onest", color: ink }}>
          <Photo illo="center" />
          <div style={{ position: "absolute", left: 64 * u, right: 64 * u, bottom: 56 * u, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
            <div style={{ display: "flex", flexDirection: "column", maxWidth: (price ? 0.62 : 0.9) * W }}>
              <div style={{ fontSize: (wide ? 40 : 52) * u, fontWeight: 800, letterSpacing: -1 * u, display: "flex", lineHeight: 1.05 }}>{headline}</div>
              <div style={{ fontSize: 28 * u, fontWeight: 500, opacity: 0.7, marginTop: 6 * u, display: "flex" }}>{`${inp.business.name} · ${place}`}</div>
            </div>
            {price ? <div style={{ fontSize: (wide ? 52 : 64) * u, fontWeight: 800, color: accent, display: "flex", whiteSpace: "nowrap" }}>{price}</div> : null}
          </div>
        </div>
      );
      break;

    case "tag": {
      // Карточка на фото — ровная, без наклона (наклонная выглядела небрежно). Без фото — по центру, крупно.
      const tw = (wide ? 480 : 600) * u;
      const pos = { left: 60 * u, bottom: 64 * u };
      el = (
        <div style={{ width: W, height: H, display: "flex", position: "relative", fontFamily: "Onest" }}>
          <Photo />
          <div
            style={{
              position: "absolute", ...pos, width: tw, display: "flex", flexDirection: "column",
              background: "#FFFDF8", color: tagInk, borderRadius: 22 * u, padding: `${40 * u}px ${46 * u}px ${36 * u}px`,
              boxShadow: "0 24px 50px rgba(0,0,0,0.25)",
            }}
          >
            <div style={{ position: "absolute", top: 24 * u, right: 28 * u, width: 24 * u, height: 24 * u, borderRadius: 99, background: accent, display: "flex" }} />
            <div style={{ fontSize: (wide ? 42 : 52) * u, fontWeight: 700, lineHeight: 1.1, display: "flex", paddingRight: 40 * u }}>{headline}</div>
            {price ? <div style={{ fontSize: (wide ? 92 : 118) * u, fontWeight: 800, color: accent, marginTop: 14 * u, display: "flex", letterSpacing: -2 * u }}>{price}</div> : null}
            <div style={{ fontSize: 28 * u, fontWeight: 500, opacity: 0.7, marginTop: 14 * u, display: "flex" }}>{`${inp.business.name} · ${place}`}</div>
          </div>
        </div>
      );
      break;
    }

    case "pricelist": {
      const rows = (inp.business.services ?? []).filter((s) => s.price).slice(0, wide ? 3 : 5);
      const fs = (wide ? 36 : rows.length > 4 ? 44 : 50) * u;
      el = (
        <div style={{ width: W, height: H, display: "flex", background: bg, color: ink, fontFamily: "Onest", position: "relative" }}>
          {photo && wide ? <img src={photo} width={W * 0.4} height={H} style={{ position: "absolute", right: 0, top: 0, width: W * 0.4, height: H, objectFit: "cover" }} /> : null}
          {!photo ? (
            <div style={{ position: "absolute", right: 40 * u, top: 30 * u, display: "flex" }}>
              <Illustration niche={inp.business.niche} variant={variant} palette={n.palette} size={(wide ? 0.42 : 0.3) * H} />
            </div>
          ) : null}
          <div style={{ display: "flex", flexDirection: "column", padding: `${(wide ? 56 : 80) * u}px ${(wide ? 60 : 80) * u}px`, width: photo && wide ? W * 0.6 : W, height: H, justifyContent: "space-between" }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: (wide ? 50 : 72) * u, fontWeight: 800, letterSpacing: -1.5 * u, display: "flex", lineHeight: 1 }}>{inp.business.name}</div>
              <div style={{ fontSize: (wide ? 26 : 32) * u, fontWeight: 500, opacity: 0.65, marginTop: 12 * u, display: "flex" }}>{`Цены · ${place}`}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: (wide ? 16 : 30) * u }}>
              {rows.map((r) => (
                <div key={r.name} style={{ display: "flex", alignItems: "flex-end", fontSize: fs }}>
                  <div style={{ display: "flex", fontWeight: 500, maxWidth: (photo && wide ? 360 : wide ? 620 : 640) * u, lineHeight: 1.1 }}>{r.name}</div>
                  <div style={{ flex: 1, borderBottom: `${3 * u}px dashed ${ink}`, opacity: 0.3, margin: `0 ${16 * u}px ${12 * u}px`, minWidth: 30 * u }} />
                  <div style={{ display: "flex", fontWeight: 800, color: accent, whiteSpace: "nowrap" }}>{r.price}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", fontSize: (wide ? 28 : 34) * u, fontWeight: 700, color: accent }}>Запись онлайн — выберите удобное время</div>
          </div>
        </div>
      );
      break;
    }

    case "review": {
      const full = withoutSuperlatives(inp.business.review) || (inp.business.review ?? "");
      const max = wide ? 150 : 220;
      const text = full.length > max ? `${full.slice(0, max).replace(/\s+\S*$/, "")}...` : full;
      const color = photo ? "#fff" : ink;
      el = (
        <div style={{ width: W, height: H, display: "flex", position: "relative", fontFamily: "Onest", color }}>
          <Photo dim={0.62} illo="corner" />
          <div style={{ ...box, flexDirection: "column", justifyContent: "center", padding: `${80 * u}px ${90 * u}px` }}>
            {/* Без звёзд: рейтинга владелец не давал — только кавычка как знак цитаты */}
            <div style={{ display: "flex", fontSize: 150 * u, lineHeight: 0.8, height: 80 * u, fontWeight: 800, color: photo ? "#fff" : accent }}>“</div>
            <div style={{ fontSize: (wide ? 50 : text.length > 140 ? 54 : 64) * u, fontWeight: 700, lineHeight: 1.18, display: "flex", marginTop: 20 * u, letterSpacing: -0.5 * u }}>{`«${text}»`}</div>
            <div style={{ fontSize: 30 * u, fontWeight: 500, marginTop: 40 * u, opacity: 0.8, display: "flex" }}>{`Отзыв клиента · ${inp.business.name}, ${place}`}</div>
          </div>
        </div>
      );
      break;
    }

    case "benefit": {
      // Текст + рисунок: одно сильное преимущество крупно на цвете, иллюстрация ниши. Цвет и сюжет меняются от варианта
      const advs = (inp.business.advantages ?? []).map((x) => x.trim()).filter((x) => x.length >= 6 && x.length <= 70);
      const line = advs.length ? advs[variant % advs.length] : inp.business.offer || headline;
      const schemes = [
        { back: accent, fore: "#FFFFFF", sub: "rgba(255,255,255,0.85)", illo: { ink, accent: "#FFFDF8", bg } },
        { back: bg, fore: ink, sub: ink, illo: n.palette },
        { back: "#FFFDF8", fore: tagInk, sub: tagInk, illo: n.palette },
      ];
      const sc = schemes[variant % schemes.length];
      // Широкая: рисунок справа или слева по варианту. Квадрат: текст сверху, рисунок внизу справа — не наезжают
      const left = !wide || variant % 2 === 0;
      el = wide ? (
        <div style={{ width: W, height: H, display: "flex", position: "relative", background: sc.back, color: sc.fore, fontFamily: "Onest" }}>
          <div style={{ position: "absolute", display: "flex", ...(left ? { right: -30 * u } : { left: -30 * u }), bottom: -20 * u, opacity: 0.95 }}>
            <Illustration niche={inp.business.niche} variant={variant + 1} palette={sc.illo} size={0.85 * wideH} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: `${56 * u}px`, width: 0.6 * W, height: H, ...(left ? {} : { marginLeft: 0.4 * W }) }}>
            <div style={{ display: "flex", fontSize: 28 * u, fontWeight: 700, color: sc.sub }}>{headline}</div>
            <div style={{ display: "flex", fontSize: (line.length > 40 ? 60 : 72) * u, fontWeight: 800, lineHeight: 1.0, letterSpacing: -2.5 * u }}>{line}</div>
            <div style={{ display: "flex", fontSize: 28 * u, fontWeight: 700, color: sc.sub }}>{`${inp.business.name} · ${place}`}</div>
          </div>
        </div>
      ) : (
        <div style={{ width: W, height: H, display: "flex", position: "relative", background: sc.back, color: sc.fore, fontFamily: "Onest" }}>
          <div style={{ position: "absolute", display: "flex", right: -20 * u, bottom: -20 * u, opacity: 0.95 }}>
            <Illustration niche={inp.business.niche} variant={variant + 1} palette={sc.illo} size={0.5 * W} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", padding: `${80 * u}px`, width: W, height: H }}>
            <div style={{ display: "flex", fontSize: 34 * u, fontWeight: 700, color: sc.sub }}>{headline}</div>
            <div style={{ display: "flex", fontSize: (line.length > 40 ? 76 : 92) * u, fontWeight: 800, lineHeight: 1.02, letterSpacing: -2.5 * u, marginTop: 44 * u, maxWidth: 0.86 * W }}>{line}</div>
            <div style={{ display: "flex", fontSize: 32 * u, fontWeight: 700, color: sc.sub, marginTop: "auto", maxWidth: 0.42 * W }}>{`${inp.business.name} · ${place}`}</div>
          </div>
        </div>
      );
      break;
    }

    case "offer":
    default: {
      const offer = inp.business.offer || (price ? `${headline} — ${price}` : headline);
      if (!photo) {
        el = (
          <div style={{ width: W, height: H, display: "flex", flexDirection: "column", justifyContent: "space-between", background: accent, color: "#fff", fontFamily: "Onest", padding: `${(wide ? 60 : 90) * u}px`, position: "relative" }}>
            <div style={{ position: "absolute", right: -40 * u, bottom: -30 * u, display: "flex", opacity: 0.95 }}>
              <Illustration niche={inp.business.niche} variant={variant} palette={{ ink, accent: "#FFFDF8", bg }} size={(wide ? 0.75 * wideH : 0.55 * W)} />
            </div>
            <div style={{ fontSize: (wide ? 30 : 36) * u, fontWeight: 700, opacity: 0.85, display: "flex" }}>{inp.business.offer ? "Для новых клиентов" : inp.business.name}</div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: (wide ? 96 : offer.length > 24 ? 104 : 140) * u, fontWeight: 800, lineHeight: 0.98, letterSpacing: -3 * u, display: "flex", maxWidth: (wide ? 0.62 : 0.7) * W }}>{offer}</div>
              <div style={{ fontSize: (wide ? 36 : 44) * u, fontWeight: 500, marginTop: 24 * u, opacity: 0.92, display: "flex", maxWidth: (wide ? 0.55 : 0.52) * W }}>{inp.business.offer ? `${headline} в «${inp.business.name}»` : place}</div>
            </div>
            <div style={{ fontSize: (wide ? 28 : 32) * u, fontWeight: 700, display: "flex" }}>{`${place} · запись онлайн`}</div>
          </div>
        );
        break;
      }
      el = (
        <div style={{ width: W, height: H, display: "flex", position: "relative", fontFamily: "Onest" }}>
          <Photo />
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, display: "flex", flexDirection: "column", background: accent, color: "#fff", padding: `${44 * u}px ${64 * u}px ${52 * u}px` }}>
            <div style={{ fontSize: 30 * u, fontWeight: 700, opacity: 0.85, display: "flex" }}>{`Для новых клиентов · ${inp.business.name}`}</div>
            <div style={{ fontSize: (wide ? 64 : 82) * u, fontWeight: 800, lineHeight: 1.02, marginTop: 10 * u, letterSpacing: -2 * u, display: "flex" }}>{offer}</div>
          </div>
        </div>
      );
    }
  }

  if (strip) {
    const fs = Math.floor(Math.min(strip * 0.5, (W * 0.92) / (MEDICAL_WARNING.length * 0.56)));
    el = (
      <div style={{ width: W, height: H + strip, display: "flex", flexDirection: "column" }}>
        {el}
        <div style={{ width: W, height: strip, display: "flex", alignItems: "center", justifyContent: "center", background: "#FFFFFF", color: "#1A1A1A", fontFamily: "Onest", fontWeight: 700, fontSize: fs }}>{MEDICAL_WARNING}</div>
      </div>
    );
  }
  const res = new ImageResponse(el, { width: W, height: H + strip, fonts: await fonts() });
  return Buffer.from(await res.arrayBuffer());
}

/** Какие макеты имеют смысл для этого бизнеса */
export function availableLayouts(b: Pick<Business, "services" | "offer" | "review"> & Partial<Pick<Business, "niche" | "name" | "description" | "advantages">>, hasPhotos = true): Layout[] {
  void hasPhotos; // без фото «photo» и «tag» рисуются с тематической иллюстрацией
  // Цен на картинках нет: «прайс-карточку» больше не предлагаем; вместо неё — преимущество с рисунком
  const out: Layout[] = ["photo", "tag", "benefit"];
  if (b.offer || !hasPhotos) out.push("offer");
  // Медуслуги: отзывы и благодарности пациентов в рекламе запрещены (закон «О рекламе», ст. 24)
  if (b.review && b.review.length > 20 && !(b.niche && isMedical({ ...b, niche: b.niche }))) out.push("review");
  return out;
}

/** Логотип-монограмма 256×256 для VK, если у бизнеса нет своего: инициалы на цвете ниши */
export async function renderLogo(b: Pick<Business, "name" | "niche">): Promise<Buffer> {
  const n = nicheById(b.niche);
  const { bg, ink, accent } = n.palette;
  const words = b.name.replace(/[«»"']/g, "").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  const initials = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "•").slice(0, 2)).toUpperCase();
  const res = new ImageResponse(
    (
      <div style={{ width: 256, height: 256, display: "flex", alignItems: "center", justifyContent: "center", background: accent, fontFamily: "Onest" }}>
        <div style={{ width: 200, height: 200, borderRadius: 100, background: bg, display: "flex", alignItems: "center", justifyContent: "center", color: ink, fontSize: initials.length > 1 ? 92 : 110, fontWeight: 800, letterSpacing: -4 }}>
          {initials}
        </div>
      </div>
    ),
    { width: 256, height: 256, fonts: await fonts() },
  );
  return Buffer.from(await res.arrayBuffer());
}
