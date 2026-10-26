/** Предпросмотр объявлений — максимально похоже на то, как их увидит человек */
import type { AdExtras } from "@/lib/engine/extras";

const LINK = "text-[#2a3eb1]";

export function SearchAdPreview({
  title, title2, text, host, callouts, extras, full = true, image,
}: { title: string; title2?: string | null; text: string; host: string; callouts?: string[]; extras?: AdExtras | null; full?: boolean; image?: string | null }) {
  // Яндекс обычно показывает 3–4 уточнения — столько и показываем
  const cl = (extras?.callouts?.length ? extras.callouts : callouts ?? []).slice(0, 4);
  const v = extras?.vcard;
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <div className="flex items-center gap-2 text-[13px] text-muted min-w-0">
        <span className="w-4 h-4 rounded-full bg-paper border border-line inline-block shrink-0" />
        <span className="truncate">{host}{extras?.displayPath ? <span className="text-faint"> › {extras.displayPath}</span> : null}</span>
        <span className="pill bg-paper text-faint font-medium ml-auto shrink-0">Реклама</span>
      </div>
      <div className={`mt-1.5 text-[17px] leading-snug font-semibold ${LINK}`}>
        {title}
        {title2 ? <span className="font-normal"> — {title2}</span> : null}
      </div>
      <p className="mt-1 text-[14px] leading-snug text-ink-2">
        {image ? <img src={image} alt="" className="float-right ml-3 mb-1 w-28 sm:w-36 aspect-[16/9] object-cover rounded-lg bg-paper" loading="lazy" /> : null}
        {extras?.price ? <span className="inline-block mr-1.5 px-1.5 rounded bg-paper font-semibold text-ink">{extras.price.label}</span> : null}
        {text}
      </p>
      {cl.length ? <div className="mt-1.5 text-[13px] text-muted">{cl.join(" · ")}</div> : null}
      {extras?.sitelinks?.length ? (
        full ? (
          <div className="mt-2.5 grid sm:grid-cols-2 gap-x-4 gap-y-2">
            {extras.sitelinks.slice(0, 4).map((s) => (
              <div key={s.title} className="min-w-0">
                <div className={`text-[14px] font-medium ${LINK}`}>{s.title}</div>
                {s.description ? <div className="text-[12.5px] text-muted leading-snug line-clamp-2">{s.description}</div> : null}
              </div>
            ))}
            {extras.sitelinks.length > 4 ? (
              <div className={`sm:col-span-2 text-[13px] ${LINK} flex flex-wrap gap-x-3`}>{extras.sitelinks.slice(4).map((s) => <span key={s.title}>{s.title}</span>)}</div>
            ) : null}
          </div>
        ) : (
          <div className={`mt-1.5 text-[13.5px] ${LINK} flex flex-wrap gap-x-3`}>{extras.sitelinks.map((s) => <span key={s.title}>{s.title}</span>)}</div>
        )
      ) : null}
      {v ? (
        <div className="mt-2 text-[12.5px] text-muted flex flex-wrap gap-x-2">
          {v.phoneText ? <span className={LINK}>{v.phoneText}</span> : null}
          {v.street ? <span>· {v.city}, {v.street}{v.house ? `, ${v.house}` : ""}</span> : null}
          <span>· {v.hoursText}</span>
        </div>
      ) : null}
    </div>
  );
}

export function ImageAdPreview({
  title, text, host, image, cta = "Записаться", channel, extras, logo,
}: { title: string; text: string; host: string; image?: string | null; cta?: string; channel: "network" | "vk"; extras?: AdExtras | null; logo?: string | null }) {
  if (channel === "vk") {
    return (
      <div className="rounded-xl border border-line bg-white overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2.5">
          {logo ? <img src={logo} alt="" className="w-9 h-9 rounded-full" /> : <span className="w-9 h-9 rounded-full bg-paper border border-line" />}
          <div className="leading-tight min-w-0">
            <div className="text-[13px] font-semibold truncate">{host}</div>
            <div className="text-[11px] text-faint">Реклама</div>
          </div>
        </div>
        <p className="px-3 pb-2.5 text-[13.5px] leading-snug text-ink">{extras?.longText || text}</p>
        {image ? <img src={image} alt="" className="w-full aspect-auto bg-paper" loading="lazy" /> : <div className="aspect-[16/9] bg-paper grid place-items-center text-faint text-sm">Без картинки</div>}
        <div className="p-3 flex items-center justify-between gap-3 bg-paper/60">
          <div className="min-w-0">
            <div className="font-bold text-[14px] leading-snug">{title}</div>
            {extras?.about ? <div className="text-[12px] text-muted truncate">{extras.about}</div> : null}
          </div>
          <span className="pill bg-ink text-white px-3 py-1.5 rounded-lg text-[12.5px] shrink-0">{cta}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-line bg-white overflow-hidden">
      {image ? <img src={image} alt="" className="w-full aspect-auto bg-paper" loading="lazy" /> : <div className="aspect-[16/9] bg-paper grid place-items-center text-faint text-sm">Без картинки</div>}
      <div className="p-3">
        <div className="font-bold text-[15px] leading-snug">{title}</div>
        <p className="text-[13.5px] text-ink-2 mt-1 leading-snug">{text}</p>
        {extras?.price || extras?.vcard ? (
          <div className="mt-1.5 text-[12.5px] text-muted">
            {extras?.price ? <span className="font-semibold text-ink">{extras.price.label}</span> : null}
            {extras?.price && extras?.vcard?.street ? " · " : ""}
            {extras?.vcard?.street ? `${extras.vcard.street}${extras.vcard.house ? `, ${extras.vcard.house}` : ""}` : ""}
          </div>
        ) : null}
        <div className="mt-2.5 flex items-center justify-between gap-2">
          <span className="text-[12px] text-faint truncate">{host} · Реклама</span>
          <span className="pill bg-ink text-white px-3 py-1.5 rounded-lg text-[12.5px]">{cta}</span>
        </div>
      </div>
    </div>
  );
}
