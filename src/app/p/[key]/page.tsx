import { vkPixelCounterId } from "@/lib/engine/regions";
import { vkPixelSnippet } from "@/lib/platforms/vk-formats";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { CalendarCheck, Clock, MapPin, MessageCircle, Navigation, Phone, Send, Star } from "lucide-react";
import { getDb, schema } from "@/lib/db";
import { listPhotos } from "@/lib/engine/images";
import { nicheById } from "@/lib/niches";
import { LeadForm } from "@/components/LeadForm";
import { formToken, signFirstTouch } from "@/lib/ratelimit";
import { landingColors } from "./colors";
import { groupServices, hasCategories } from "@/lib/services";

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
/** Частые опечатки в текстах, взятых с сайта клиента */
const tidy = (s: string) => s.replace(/счасли/gi, (m) => (m[0] === "С" ? "Счастли" : "счастли")).replace(/(\d)(\+)\s/g, "$1$2 ");

/** Страница записи — для тех, у кого нет сайта. Сюда ведут объявления, здесь же считаются обращения. */
export default async function Landing({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const b = await load((await params).key);
  if (!b) notFound();
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  // Одноразовый токен формы: время открытия страницы (слишком быстрые заявки отклоняются) + nonce, срок 2 часа
  const ts = formToken(b.publicKey);
  // Пришли по рекламе — подписываем utm-метки сразу на сервере (трекер сделает то же самое, но позже)
  const ft = one(sp.utm_source) ? await signFirstTouch(b, { source: one(sp.utm_source), campaign: one(sp.utm_campaign), ad: one(sp.utm_content) }) : null;
  const n = nicheById(b.niche);
  const photos = (await listPhotos(b.id)).slice(0, 6);
  const vkPixel = await vkPixelCounterId(b.id).catch(() => null);
  // Код пикселя VK: берём только JS (скрипты из innerHTML React не выполняет)
  const vkJs = vkPixel ? (vkPixelSnippet(vkPixel).match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? "") : "";
  const c = landingColors(n.palette);
  const { bg, ink, accent } = c;
  const wa = b.whatsapp ? `https://wa.me/${digits(b.whatsapp).replace("+", "")}` : null;
  const tg = b.telegram ? `https://t.me/${b.telegram.replace(/^@|https?:\/\/t\.me\//g, "")}` : null;
  const maps = b.address ? `https://yandex.ru/maps/?text=${encodeURIComponent(`${b.city ? `${b.city}, ` : ""}${b.address}`)}` : null;
  const contacts = [
    b.phone ? { href: `tel:${digits(b.phone)}`, label: b.phone, icon: <Phone size={16} />, ext: false, phone: true } : null,
    wa ? { href: wa, label: "WhatsApp", icon: <MessageCircle size={16} />, ext: true, phone: false } : null,
    tg ? { href: tg, label: "Telegram", icon: <Send size={16} />, ext: true, phone: false } : null,
  ].filter((x): x is NonNullable<typeof x> => Boolean(x));

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

      <main className="mx-auto max-w-5xl px-4 sm:px-6 pt-8 pb-28 sm:py-14">
        <div className="grid lg:grid-cols-[1.2fr_1fr] gap-8 items-start">
          <div>
            <div className="text-sm font-semibold" style={{ color: c.inkSoft }}>{n.label} · {b.city}</div>
            <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight mt-2 leading-[1.05]">{b.name}</h1>
            {b.offer ? <div className="inline-block mt-5 rounded-xl px-4 py-2 font-bold" style={{ background: accent, color: c.onAccent }}>{b.offer} — для новых клиентов</div> : null}
            {b.description ? <p className="mt-5 text-lg leading-relaxed max-w-xl">{b.description}</p> : null}
            {/* Главное действие на телефоне: форма ниже первого экрана, ведём к ней */}
            <div className="mt-6 flex flex-col sm:flex-row gap-2 lg:hidden">
              <a href="#form" className="btn h-12 text-base" style={{ background: accent, color: c.onAccent }}><CalendarCheck size={18} />Записаться онлайн</a>
              {b.phone ? <a href={`tel:${digits(b.phone)}`} className="btn h-12 text-base bg-white" style={{ color: c.cardInk }}><Phone size={18} />Позвонить</a> : null}
            </div>
            {b.address || b.hours ? (
              <ul className="mt-6 grid gap-2.5 text-base">
                {b.address ? (
                  <li className="flex items-start gap-2.5"><MapPin size={18} className="mt-0.5 shrink-0" style={{ color: c.accentOnBg }} /><span className="font-medium">{b.address}{maps ? <> · <a href={maps} target="_blank" rel="noreferrer" className="underline underline-offset-2 font-normal whitespace-nowrap">на карте</a></> : null}</span></li>
                ) : null}
                {b.hours ? <li className="flex items-start gap-2.5"><Clock size={18} className="mt-0.5 shrink-0" style={{ color: c.accentOnBg }} /><span>{b.hours}</span></li> : null}
              </ul>
            ) : null}
            {contacts.length ? (
              <div className={`mt-6 grid ${contacts.length === 1 && b.phone ? "max-lg:hidden" : ""} grid-cols-2 sm:flex sm:flex-wrap gap-2`}>
                {contacts.map((x, i) => (
                  <a key={x.href} href={x.href} {...(x.ext ? { target: "_blank", rel: "noreferrer" } : {})} className={`btn bg-white ${x.phone ? "max-lg:hidden" : ""} ${(contacts.length - (b.phone ? 1 : 0)) % 2 && i === (b.phone ? 1 : 0) ? "col-span-2 sm:col-span-1" : ""}`} style={{ color: c.cardInk }}>{x.icon}{x.label}</a>
                ))}
              </div>
            ) : null}
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
            {/* Разделы прайса («Маникюр», «Педикюр») — подзаголовками; якоря #s1, #s2… по исходному порядку (на них ведут быстрые ссылки) */}
            {(hasCategories(b.services) ? groupServices(b.services) : [{ category: "", items: b.services.map((s, i) => ({ s, i })) }]).map((g) => (
              <div key={g.category || "all"}>
                {g.category ? <h3 className="mt-6 text-lg font-bold">{g.category}</h3> : null}
                <ul className={`${g.category ? "mt-3" : "mt-5"} rounded-2xl bg-white`} style={{ color: c.cardInk }}>
                  {g.items.map(({ s, i }, k) => (
                    <li key={s.name} id={`s${i + 1}`} className="flex flex-wrap items-baseline gap-x-3 px-4 sm:px-5 py-4 text-base sm:text-lg scroll-mt-6" style={k ? { borderTop: `1px solid ${bg}` } : undefined}>
                      <span className="font-medium min-w-0 break-words max-w-[70%]">{s.name}</span>
                      <span className="flex-1 min-w-4 border-b border-dashed opacity-30 translate-y-[-4px]" />
                      <span className="font-extrabold whitespace-nowrap shrink-0" style={{ color: c.accentOnCard }}>{s.price || "по записи"}</span>
                      {s.note ? <span className="basis-full text-sm opacity-70 mt-1">{s.note}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ) : null}

        {b.advantages.length || b.review ? (
          <section className="mt-12 grid md:grid-cols-2 gap-6">
            {b.advantages.length ? (
              <div id="about" className="scroll-mt-6">
                <h2 className="text-2xl font-extrabold">Почему к нам</h2>
                <ul className="mt-4 grid gap-3 text-lg">
                  {b.advantages.map((a) => <li key={a} className="flex gap-3"><span className="mt-2.5 w-2 h-2 rounded-full shrink-0" style={{ background: c.accentOnBg }} />{tidy(a)}</li>)}
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

        {b.address || b.phone ? (
          <section id="contacts" className="mt-12 rounded-2xl bg-white p-5 sm:p-6 grid sm:grid-cols-[1fr_auto] gap-4 items-center scroll-mt-6" style={{ color: c.cardInk }}>
            <div className="grid gap-1.5">
              <h2 className="text-xl font-extrabold">Как нас найти</h2>
              {b.address ? <div className="flex items-start gap-2"><MapPin size={18} className="mt-0.5 shrink-0" />{b.city && !b.address.includes(b.city) ? `${b.city}, ` : ""}{b.address}</div> : null}
              {b.hours ? <div className="flex items-start gap-2" style={{ color: c.cardSoft }}><Clock size={18} className="mt-0.5 shrink-0" />{b.hours}</div> : null}
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              {maps ? <a href={maps} target="_blank" rel="noreferrer" className="btn btn-ghost"><Navigation size={16} />Построить маршрут</a> : null}
              <a href="#form" className="btn" style={{ background: accent, color: c.onAccent }}><CalendarCheck size={16} />Записаться</a>
            </div>
          </section>
        ) : null}

        <footer style={{ color: c.inkSoft }} className="mt-16 text-sm flex flex-wrap gap-x-4 gap-y-1">
          <span>{b.name}{b.address ? `, ${b.address}` : `, ${b.city}`}</span>
          <a href={`/privacy?b=${encodeURIComponent(b.publicKey)}`} className="underline">Политика обработки данных</a>
        </footer>
      </main>
      {/* Нижняя панель на телефоне: записаться и позвонить — всегда под пальцем */}
      <div className="sm:hidden fixed inset-x-0 bottom-0 z-10 p-3 flex gap-2 border-t" style={{ background: bg, borderColor: `${c.inkSoft}33`, paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
        <a href="#form" className="btn h-12 flex-1" style={{ background: accent, color: c.onAccent }}><CalendarCheck size={18} />Записаться</a>
        {b.phone ? <a href={`tel:${digits(b.phone)}`} className="btn h-12 bg-white px-4" style={{ color: c.cardInk }} aria-label="Позвонить"><Phone size={18} /></a> : null}
      </div>
    </div>
  );
}
