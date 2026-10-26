import "server-only";
import { ImageResponse } from "next/og";
import { readFile } from "fs/promises";
import path from "path";
import type { Business } from "../db/schema";
import { nicheById } from "../niches";
import { Illustration } from "./illustrations";

/**
 * Макеты рекламных картинок. Принцип: настоящее фото (владельца или реалистичная генерация YandexART)
 * + один крупный факт, который продаёт: цена, предложение, отзыв или прайс.
 * Без фото — типографские карточки в цветах ниши: прайс, предложение, отзыв.
 * Никаких «нейро-лиц» и шаблонных градиентов — так объявления выглядят как от живого бизнеса.
 */
export type Layout = "photo" | "tag" | "pricelist" | "review" | "offer";
export const LAYOUT_NAME: Record<Layout, string> = {
  photo: "Чистое фото",
  tag: "Ценник",
  pricelist: "Прайс-карточка",
  review: "Отзыв клиента",
  offer: "Предложение крупно",
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
  business: Pick<Business, "name" | "niche" | "services" | "offer" | "review" | "address" | "city">;
  photo?: { data: Buffer; mime: string } | null;
  headline?: string;
  price?: string;
};

const dataUri = (p: { data: Buffer; mime: string }) => `data:${p.mime};base64,${p.data.toString("base64")}`;

export async function renderCreative(inp: RenderInput): Promise<Buffer> {
  const n = nicheById(inp.business.niche);
  const { bg, ink, accent } = n.palette;
  const W = inp.width, H = inp.height;
  const wide = W / H > 1.3;
  const u = W / 1080;
  const photo = inp.photo ? dataUri(inp.photo) : null;
  const svc = inp.business.services?.[0];
  const headline = inp.headline || svc?.name || n.examples[0];
  const price = inp.price || svc?.price || "";
  const place = inp.business.address?.split(",")[0] || inp.business.city;
  const layout: Layout = inp.layout;
  // На тёмных палитрах (барбершоп) «ink» светлый — для бумажного ценника берём тёмный текст
  const isLight = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16) > 500;
  const tagInk = isLight(ink) ? bg : ink;
  const box = { position: "absolute" as const, top: 0, left: 0, width: W, height: H, display: "flex" };

  // Без фото вместо него — тематическая иллюстрация ниши
  const illoSize = (wide ? 0.62 * H : 0.62 * W);
  const Photo = ({ dim = 0, illo = "right" }: { dim?: number; illo?: "right" | "center" | "corner" | "none" }) =>
    photo ? (
      <div style={box}>
        <img src={photo} width={W} height={H} style={{ width: W, height: H, objectFit: "cover" }} />
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
            <Illustration niche={inp.business.niche} palette={n.palette} size={illo === "center" ? illoSize * 1.15 : illo === "corner" ? 0.3 * Math.min(W, H) : illoSize} />
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
      // Бумажный ценник, «приколотый» к фото. Без фото — по центру, крупно.
      const tw = (wide ? 520 : 620) * u;
      const pos = { left: 60 * u, bottom: 64 * u };
      el = (
        <div style={{ width: W, height: H, display: "flex", position: "relative", fontFamily: "Onest" }}>
          <Photo />
          <div
            style={{
              position: "absolute", ...pos, width: tw, display: "flex", flexDirection: "column",
              background: "#FFFDF8", color: tagInk, borderRadius: 22 * u, padding: `${40 * u}px ${46 * u}px ${36 * u}px`,
              transform: "rotate(-3deg)", boxShadow: "0 24px 50px rgba(0,0,0,0.25)",
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
              <Illustration niche={inp.business.niche} palette={n.palette} size={(wide ? 0.42 : 0.3) * H} />
            </div>
          ) : null}
          <div style={{ display: "flex", flexDirection: "column", padding: `${(wide ? 56 : 80) * u}px ${(wide ? 60 : 80) * u}px`, width: photo && wide ? W * 0.6 : W, height: H, justifyContent: "space-between" }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: (wide ? 50 : 72) * u, fontWeight: 800, letterSpacing: -1.5 * u, display: "flex", lineHeight: 1 }}>{inp.business.name}</div>
              <div style={{ fontSize: (wide ? 26 : 32) * u, fontWeight: 500, opacity: 0.65, marginTop: 12 * u, display: "flex" }}>{`Цены без сюрпризов · ${place}`}</div>
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
      const text = (inp.business.review || "").slice(0, wide ? 150 : 220);
      const color = photo ? "#fff" : ink;
      el = (
        <div style={{ width: W, height: H, display: "flex", position: "relative", fontFamily: "Onest", color }}>
          <Photo dim={0.62} illo="corner" />
          <div style={{ ...box, flexDirection: "column", justifyContent: "center", padding: `${80 * u}px ${90 * u}px` }}>
            <div style={{ display: "flex", gap: 8 * u }}>
              {[0, 1, 2, 3, 4].map((i) => (
                <svg key={i} width={36 * u} height={36 * u} viewBox="0 0 24 24"><path fill={accent} d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7-6.2-3.8-6.2 3.8 1.6-7L2 9.2l7.1-.6z" /></svg>
              ))}
            </div>
            <div style={{ fontSize: (wide ? 50 : text.length > 140 ? 54 : 64) * u, fontWeight: 700, lineHeight: 1.18, display: "flex", marginTop: 36 * u, letterSpacing: -0.5 * u }}>{`«${text}»`}</div>
            <div style={{ fontSize: 30 * u, fontWeight: 500, marginTop: 40 * u, opacity: 0.8, display: "flex" }}>{`Отзыв клиента · ${inp.business.name}, ${place}`}</div>
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
              <Illustration niche={inp.business.niche} palette={{ ink, accent: "#FFFDF8", bg }} size={(wide ? 0.75 * H : 0.55 * W)} />
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

  const res = new ImageResponse(el, { width: W, height: H, fonts: await fonts() });
  return Buffer.from(await res.arrayBuffer());
}

/** Какие макеты имеют смысл для этого бизнеса */
export function availableLayouts(b: Pick<Business, "services" | "offer" | "review">, hasPhotos = true): Layout[] {
  void hasPhotos; // без фото «photo» и «tag» рисуются с тематической иллюстрацией
  const out: Layout[] = ["photo", "tag"];
  if ((b.services ?? []).filter((s) => s.price).length >= 2) out.push("pricelist");
  if (b.offer || !hasPhotos) out.push("offer");
  if (b.review && b.review.length > 20) out.push("review");
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
