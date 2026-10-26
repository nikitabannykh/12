"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Plus, Trash2, Wand2 } from "lucide-react";
import { api, useToast } from "./client";
import type { Service } from "@/lib/db/schema";

type NicheLite = { id: string; label: string; examples: string[] };
export type BusinessInput = {
  name: string; niche: string; city: string; address: string; phone: string; whatsapp: string; telegram: string; hours: string; siteUrl: string;
  description: string; services: Service[]; advantages: string[]; audience: string; offer: string; review: string; leadToClientRate: number;
};

export function BusinessForm({ initial, niches, next, aiOn }: { initial: BusinessInput; niches: NicheLite[]; next: string; aiOn: boolean }) {
  const [f, setF] = useState<BusinessInput>({ ...initial, services: initial.services.length ? initial.services : [{ name: "", price: "" }] });
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const toast = useToast();
  const router = useRouter();
  const set = <K extends keyof BusinessInput>(k: K, v: BusinessInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const niche = niches.find((n) => n.id === f.niche);

  async function importSite() {
    if (!f.siteUrl) return toast("Сначала укажите адрес сайта", "error");
    setImporting(true);
    try {
      const d = await api<any>("POST", "/api/business/import", { url: f.siteUrl, niche: niche?.label, city: f.city });
      setF((x) => ({
        ...x,
        name: x.name || d.name || "",
        description: x.description || d.description || "",
        address: x.address || d.address || "",
        phone: x.phone || d.phone || "",
        services: d.services?.length && !x.services.some((s) => s.name) ? d.services.slice(0, 10) : x.services,
        advantages: d.advantages?.length && !x.advantages.length ? d.advantages.slice(0, 5) : x.advantages,
      }));
      toast("Заполнили по сайту — проверьте поля");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setImporting(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("POST", "/api/business", {
        ...f,
        services: f.services.filter((s) => s.name.trim()).map((s) => ({ name: s.name.trim(), price: s.price?.trim() || undefined })),
        advantages: f.advantages.map((a) => a.trim()).filter(Boolean),
        address: f.address || null, phone: f.phone || null, whatsapp: f.whatsapp || null, telegram: f.telegram || null, hours: f.hours || null,
        siteUrl: f.siteUrl || null, audience: f.audience || null, offer: f.offer || null, review: f.review || null,
      });
      router.push(next);
      router.refresh();
    } catch (err) {
      toast((err as Error).message, "error");
      setBusy(false);
    }
  }

  const section = "card p-5 sm:p-7 grid gap-5";
  return (
    <form onSubmit={save} className="grid gap-5">
      <section className={section}>
        <h2 className="text-lg font-bold">Кто вы</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="name">Название</label>
            <input id="name" className="field" value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Студия «Лак»" required maxLength={80} />
          </div>
          <div>
            <label className="label" htmlFor="city">Город</label>
            <input id="city" className="field" value={f.city} onChange={(e) => set("city", e.target.value)} placeholder="Казань" required minLength={2} maxLength={60} />
          </div>
        </div>
        <div>
          <span className="label">Чем занимаетесь</span>
          <div className="flex flex-wrap gap-2">
            {niches.map((n) => (
              <button type="button" key={n.id} className="chip" aria-pressed={f.niche === n.id} onClick={() => set("niche", n.id)}>{n.label}</button>
            ))}
          </div>
        </div>
        <div>
          <label className="label" htmlFor="address">Адрес</label>
          <input id="address" className="field" value={f.address} onChange={(e) => set("address", e.target.value)} placeholder="ул. Баумана, 15 — у метро «Кремлёвская»" maxLength={200} />
          <p className="hint mt-1.5">Ориентир вроде метро или ТЦ помогает: «рядом с домом» — частая причина выбрать салон.</p>
        </div>
        <div>
          <label className="label" htmlFor="hours">Часы работы</label>
          <input id="hours" className="field" value={f.hours} onChange={(e) => set("hours", e.target.value)} placeholder="Ежедневно 10:00–21:00" maxLength={80} />
          <p className="hint mt-1.5">Покажем под объявлением вместе с адресом и телефоном. Не указаны часы — визитку в Директе не создаём, чтобы не показывать неверное время.</p>
        </div>
      </section>

      <section className={section}>
        <h2 className="text-lg font-bold">Куда приходят клиенты</h2>
        <div>
          <label className="label" htmlFor="site">Сайт</label>
          <div className="flex gap-2">
            <input id="site" className="field" value={f.siteUrl} onChange={(e) => set("siteUrl", e.target.value)} placeholder="lak-studio.ru или страница в Taplink" maxLength={300} />
            {aiOn ? (
              <button type="button" className="btn btn-ghost shrink-0" onClick={importSite} disabled={importing}>
                {importing ? <Loader2 size={16} className="spin" /> : <Wand2 size={16} />}
                <span className="hidden sm:inline">Заполнить по сайту</span>
              </button>
            ) : null}
          </div>
          <p className="hint mt-1.5">Нет сайта — не страшно. Сделаем простую страницу записи с вашими услугами, ценами и кнопками связи.</p>
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label className="label" htmlFor="phone">Телефон</label>
            <input id="phone" className="field" value={f.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+7 900 000-00-00" inputMode="tel" maxLength={40} />
          </div>
          <div>
            <label className="label" htmlFor="wa">WhatsApp</label>
            <input id="wa" className="field" value={f.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} placeholder="+7 900 000-00-00" maxLength={60} />
          </div>
          <div>
            <label className="label" htmlFor="tg">Telegram</label>
            <input id="tg" className="field" value={f.telegram} onChange={(e) => set("telegram", e.target.value)} placeholder="@lak_studio" maxLength={60} />
          </div>
        </div>
      </section>

      <section className={section}>
        <div>
          <h2 className="text-lg font-bold">Услуги и цены</h2>
          <p className="hint mt-1">Цена в объявлении — один из самых сильных аргументов. Пишите так, как есть в прайсе: «1 900 ₽» или «от 1 500 ₽».</p>
        </div>
        <div className="grid gap-2">
          {f.services.map((s, i) => (
            <div key={i} className="grid grid-cols-[1fr_8.5rem_auto] gap-2">
              <input className="field" aria-label="Услуга" maxLength={80} value={s.name} placeholder={niche?.examples[i % (niche?.examples.length || 1)] ?? "Услуга"} onChange={(e) => set("services", f.services.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <input className="field" aria-label="Цена" maxLength={40} value={s.price ?? ""} placeholder="1 900 ₽" onChange={(e) => set("services", f.services.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} />
              <button type="button" className="btn btn-ghost px-3" aria-label="Удалить услугу" onClick={() => set("services", f.services.filter((_, j) => j !== i))} disabled={f.services.length === 1}>
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          {f.services.length < 10 ? (
            <button type="button" className="btn btn-ghost btn-sm justify-self-start" onClick={() => set("services", [...f.services, { name: "", price: "" }])}>
              <Plus size={16} /> Добавить услугу
            </button>
          ) : null}
        </div>
      </section>

      <section className={section}>
        <div>
          <h2 className="text-lg font-bold">Почему выбирают вас</h2>
          <p className="hint mt-1">Только правда — объявления строятся на этих фактах, и робот не будет ничего придумывать.</p>
        </div>
        <div>
          <label className="label" htmlFor="adv">Преимущества — каждое с новой строки</label>
          <p className="hint mb-1.5">До 8 пунктов, каждый до 100 символов. Короткие (до 25 символов) покажем отдельными строками под объявлением. Без «лучший» и «самый» — модерация их не пропускает.</p>
          <textarea id="adv" className="field" rows={4} value={f.advantages.join("\n")} onChange={(e) => set("advantages", e.target.value.split("\n").slice(0, 8))} placeholder={"Покрытие держится 3–4 недели\nСтерилизация в сухожаре, крафт-пакеты при вас\nПарковка у входа"} />
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="offer">Предложение для новых клиентов</label>
            <input id="offer" className="field" value={f.offer} onChange={(e) => set("offer", e.target.value)} placeholder="−20% на первый визит" maxLength={80} />
            <p className="hint mt-1.5">Необязательно, но такие объявления обычно кликают чаще.</p>
          </div>
          <div>
            <label className="label" htmlFor="audience">Кто ваши клиенты</label>
            <input id="audience" className="field" value={f.audience} onChange={(e) => set("audience", e.target.value)} placeholder="Девушки 25–40, работают в центре" maxLength={300} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="review">Настоящий отзыв клиента</label>
          <textarea id="review" className="field" rows={2} value={f.review} onChange={(e) => set("review", e.target.value)} placeholder="Хожу к Алине второй год — маникюр ни разу не скололся раньше чем через три недели." maxLength={300} />
          <p className="hint mt-1.5">Из него сделаем отдельную рекламную картинку.</p>
        </div>
        <div>
          <label className="label" htmlFor="desc">Что ещё важно знать</label>
          <textarea id="desc" className="field" rows={3} value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="Работаем с 2019 года, 4 мастера, открыты до 22:00" maxLength={1500} />
        </div>
      </section>

      <section className={section}>
        <div>
          <h2 className="text-lg font-bold">Сколько обратившихся записываются</h2>
          <p className="hint mt-1">Нужно, чтобы считать стоимость клиента. Потом можно уточнять по неделям.</p>
        </div>
        <div className="flex items-center gap-4">
          <input type="range" min={1} max={10} step={1} value={Math.round(f.leadToClientRate * 10)} onChange={(e) => set("leadToClientRate", Number(e.target.value) / 10)} className="flex-1 accent-[#1d2045]" aria-label="Сколько из 10 обратившихся записываются" />
          <div className="w-44 text-right font-semibold">{Math.round(f.leadToClientRate * 10)} из 10 записываются</div>
        </div>
      </section>

      <div className="flex justify-end gap-3 sticky bottom-20 md:bottom-4">
        <button className="btn btn-primary h-12 px-6 shadow-lg" disabled={busy}>
          {busy ? <Loader2 size={16} className="spin" /> : null}
          Сохранить и продолжить
        </button>
      </div>
    </form>
  );
}
