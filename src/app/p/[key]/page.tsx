import { vkPixelCounterId } from "@/lib/engine/regions";
import { vkPixelSnippet } from "@/lib/platforms/vk-formats";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { MapPin, MessageCircle, Phone, Send, Star } from "lucide-react";
import { getDb, schema } from "@/lib/db";
import { listPhotos } from "@/lib/engine/images";
import { nicheById } from "@/lib/niches";
import { LeadForm } from "@/components/LeadForm";
import { formToken, signFirstTouch } from "@/lib/ratelimit";
import { landingColors } from "./colors";

export const dynamic = "force-dynamic";

async function load(key: string) {
  const db = await getDb();
  const [b] = await db.select().from(schema.businesses).where(eq(schema.businesses.publicKey, key));
  return b ?? null;
}

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }): Promise<Metadata> {
  const b = await load((await params).key);
  if (!b) return {};
  return { title: `${b.name} — ${nicheById(b.niche).label.toLowerCase()}, ${b.city}`, description: b.description || `${b.name}: запись онлайн. ${b.address ?? b.city}` };
}

const digits = (s: string) => s.replace(/[^\d+]/g, "");

/** Страница записи — для тех, у кого нет сайта. Сюда ведут объявления, здесь же считаются обращения. */
export default async function Landing({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const b = await load((await params).key);
  if (!b) notFound();
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  // Одноразовый токен формы: время открытия страницы (слишком быстрые заявки отклоняются) + nonce, срок 2 часа
  const ts = formToken(b.publicKey);
  // Пришли по рекламе — подписываем utm-метки сразу на сервере (трекер сделает то же самое, но позже)
  const ft = one(sp.utm_source) ? signFirstTouch(b.publicKey, { source: one(sp.utm_source), campaign: one(sp.utm_campaign), ad: one(sp.utm_content) }) : null;
  const n = nicheById(b.niche);
  const photos = (await listPhotos(b.id)).slice(0, 6);
  const vkPixel = await vkPixelCounterId(b.id).catch(() => null);
  // Код пикселя VK: берём только JS (скрипты из innerHTML React не выполняет)
  const vkJs = vkPixel ? (vkPixelSnippet(vkPixel).match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? "") : "";
  const c = landingColors(n.palette);
  const { bg, ink, accent } = c;
  const wa = b.whatsapp ? `https://wa.me/${digits(b.whatsapp).replace("+", "")}` : null;
  const tg = b.telegram ? `https://t.me/${b.telegram.replace(/^@|https?:\/\/t\.me\//g, "")}` : null;

  return (
    <div style={{ background: bg, color: ink }} className="min-h-dvh">
      {b.counterId ? (
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window,document,"script","https://mc.yandex.ru/metrika/tag.js","ym");ym(${b.counterId},"init",{clickmap:true,trackLinks:true,accurateTrackBounce:true,webvisor:true});`,
          }}
        />
      ) : null}
      {vkJs ? <script dangerouslySetInnerHTML={{ __html: vkJs }} /> : null}
      <script async src="/t.js" data-key={b.publicKey} {...(b.counterId ? { "data-ym": String(b.counterId) } : {})} />

      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8 sm:py-14">
        <div className="grid lg:grid-cols-[1.2fr_1fr] gap-8 items-start">
          <div>
            <div className="text-sm font-semibold" style={{ color: c.inkSoft }}>{n.label} · {b.city}</div>
            <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight mt-2 leading-[1.05]">{b.name}</h1>
            {b.offer ? <div className="inline-block mt-5 rounded-xl px-4 py-2 font-bold" style={{ background: accent, color: c.onAccent }}>{b.offer} — для новых клиентов</div> : null}
            {b.description ? <p className="mt-5 text-lg leading-relaxed max-w-xl">{b.description}</p> : null}
            {b.address ? <p id="contacts" className="mt-4 flex items-start gap-2 font-medium scroll-mt-6"><MapPin size={18} className="mt-0.5 shrink-0" />{b.address}{b.hours ? <span className="font-normal" style={{ color: c.inkSoft }}> · {b.hours}</span> : null}</p> : b.hours ? <p id="contacts" className="mt-4 font-medium">{b.hours}</p> : null}
            <div className="mt-6 flex flex-wrap gap-2">
              {b.phone ? <a href={`tel:${digits(b.phone)}`} className="btn bg-white" style={{ color: c.cardInk }}><Phone size={16} />{b.phone}</a> : null}
              {wa ? <a href={wa} className="btn bg-white" style={{ color: c.cardInk }} target="_blank" rel="noreferrer"><MessageCircle size={16} />WhatsApp</a> : null}
              {tg ? <a href={tg} className="btn bg-white" style={{ color: c.cardInk }} target="_blank" rel="noreferrer"><Send size={16} />Telegram</a> : null}
            </div>
          </div>
          <div id="form" style={{ background: accent }} className="rounded-3xl p-1.5 scroll-mt-6">
            <LeadForm publicKey={b.publicKey} services={b.services.map((s) => s.name)} accent={accent} onAccent={c.onAccent} ink={c.cardInk} ts={ts} ft={ft} counterId={b.counterId ?? null} vkPixel={vkPixel} privacyUrl={`/privacy?b=${encodeURIComponent(b.publicKey)}`} />
          </div>
        </div>

        {photos.length ? (
          <div className="mt-12 grid grid-cols-2 sm:grid-cols-3 gap-3">
            {photos.map((p) => <img key={p.id} src={`/api/images/${p.id}`} alt="" className="w-full aspect-square object-cover rounded-2xl" loading="lazy" />)}
          </div>
        ) : null}

        {b.services.length ? (
          <section id="services" className="mt-12 scroll-mt-6">
            <h2 className="text-2xl font-extrabold">Услуги и цены</h2>
            <ul className="mt-5 rounded-2xl bg-white" style={{ color: c.cardInk }}>
              {b.services.map((s, i) => (
                <li key={s.name} id={`s${i + 1}`} className="flex items-baseline gap-3 px-4 sm:px-5 py-4 text-base sm:text-lg scroll-mt-6" style={i ? { borderTop: `1px solid ${bg}` } : undefined}>
                  <span className="font-medium min-w-0 break-words">{s.name}</span>
                  <span className="flex-1 min-w-4 border-b border-dashed opacity-30 translate-y-[-4px]" />
                  <span className="font-extrabold whitespace-nowrap shrink-0" style={{ color: c.accentOnCard }}>{s.price || "по записи"}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {b.advantages.length || b.review ? (
          <section className="mt-12 grid md:grid-cols-2 gap-6">
            {b.advantages.length ? (
              <div id="about" className="scroll-mt-6">
                <h2 className="text-2xl font-extrabold">Почему к нам</h2>
                <ul className="mt-4 grid gap-3 text-lg">
                  {b.advantages.map((a) => <li key={a} className="flex gap-3"><span className="mt-2.5 w-2 h-2 rounded-full shrink-0" style={{ background: c.accentOnBg }} />{a}</li>)}
                </ul>
              </div>
            ) : null}
            {b.review ? (
              <figure id="reviews" className="rounded-2xl bg-white p-6 scroll-mt-6" style={{ color: c.cardInk }}>
                <div className="flex gap-0.5" style={{ color: c.accentOnCard }} aria-label="Оценка 5 из 5">{[0, 1, 2, 3, 4].map((i) => <Star key={i} size={18} fill="currentColor" />)}</div>
                <blockquote className="mt-3 text-lg leading-relaxed">«{b.review}»</blockquote>
                <figcaption className="mt-3 text-sm" style={{ color: c.cardSoft }}>Отзыв клиента</figcaption>
              </figure>
            ) : null}
          </section>
        ) : null}

        <footer style={{ color: c.inkSoft }} className="mt-16 text-sm flex flex-wrap gap-x-4 gap-y-1">
          <span>{b.name}{b.address ? `, ${b.address}` : `, ${b.city}`}</span>
          <a href={`/privacy?b=${encodeURIComponent(b.publicKey)}`} className="underline">Политика обработки данных</a>
        </footer>
      </main>
    </div>
  );
}
