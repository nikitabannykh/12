"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";

type W = Window & { pzGoal?: (kind: string) => void; pzFirstTouch?: () => string | null; ym?: (...a: unknown[]) => void };

/** Подписанное первое касание: из трекера (localStorage), иначе — выданное сервером по utm этой страницы */
function firstTouch(fallback: string | null): string | null {
  try {
    const w = window as W;
    const fromTracker = w.pzFirstTouch?.();
    if (fromTracker) return fromTracker;
    const x = JSON.parse(localStorage.getItem("pz_ft") || "null");
    if (x?.v && Date.now() - x.t < 30 * 864e5) return x.v;
  } catch {}
  return fallback;
}

/** Цели Метрики: pz_form и pz_lead (по pz_lead Директ оптимизирует стратегию «по заявкам») */
function reachGoals(counterId: number | null) {
  const w = window as W;
  try {
    if (w.pzGoal) return w.pzGoal("form");
    if (counterId && w.ym) {
      w.ym(counterId, "reachGoal", "pz_form");
      w.ym(counterId, "reachGoal", "pz_lead");
    }
  } catch {}
}

export function LeadForm({
  publicKey, services, accent, ts, ft, counterId, privacyUrl,
}: { publicKey: string; services: string[]; accent: string; ts: string; ft: string | null; counterId: number | null; privacyUrl: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [err, setErr] = useState("");

  // Первый заход по рекламе на нашу страницу: сохраняем подписанные метки, если трекер ещё не успел
  useEffect(() => {
    if (!ft) return;
    try {
      if (!localStorage.getItem("pz_ft")) localStorage.setItem("pz_ft", JSON.stringify({ v: ft, t: Date.now() }));
    } catch {}
  }, [ft]);

  if (state === "done") {
    return (
      <div className="rounded-2xl bg-white p-6 text-center" role="status">
        <div className="mx-auto w-12 h-12 rounded-full grid place-items-center text-white" style={{ background: accent }}><Check /></div>
        <div className="font-bold text-lg mt-3">Заявка отправлена</div>
        <p className="text-muted mt-1">Перезвоним в течение рабочего дня и подберём время.</p>
      </div>
    );
  }
  return (
    <form
      data-pz-ignore
      className="rounded-2xl bg-white p-5 sm:p-6 grid gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setErr("");
        setState("busy");
        const fd = new FormData(e.currentTarget);
        let vid: string | null = null;
        try { vid = localStorage.getItem("pz_vid"); } catch {}
        try {
          const res = await fetch("/api/lead", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              key: publicKey, ts, ft: firstTouch(ft), vid,
              name: fd.get("name"), contact: fd.get("phone"), message: fd.get("service"), website: fd.get("website"),
            }),
          });
          if (res.ok) {
            reachGoals(counterId);
            setState("done");
          } else {
            setErr((await res.json().catch(() => ({}))).error || "Не отправилось — попробуйте ещё раз");
            setState("idle");
          }
        } catch {
          setErr("Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.");
          setState("idle");
        }
      }}
    >
      <div className="font-bold text-lg">Записаться</div>
      {/* Ловушка для ботов: человек это поле не видит и не заполняет */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
        <label>Сайт<input name="website" tabIndex={-1} autoComplete="off" defaultValue="" /></label>
      </div>
      {/* ym-disable-keys: Вебвизор Метрики не записывает, что вводят в эти поля */}
      <input name="name" className="field ym-disable-keys" placeholder="Как к вам обращаться" autoComplete="given-name" maxLength={60} />
      <input name="phone" type="tel" className="field ym-disable-keys" placeholder="Телефон" inputMode="tel" autoComplete="tel" maxLength={30} required />
      {services.length ? (
        <select name="service" className="field" defaultValue="">
          <option value="">Выберите услугу</option>
          {services.map((s) => <option key={s}>{s}</option>)}
        </select>
      ) : null}
      {err ? <div className="text-sm text-bad" role="alert">{err}</div> : null}
      <button className="btn h-12 text-white" style={{ background: accent }} disabled={state === "busy"}>
        {state === "busy" ? <Loader2 size={16} className="spin" /> : null}Отправить заявку
      </button>
      <p className="text-xs text-muted leading-relaxed">
        Нажимая кнопку, вы соглашаетесь на обработку имени и телефона, чтобы с вами связались для записи.{" "}
        <a href={privacyUrl} target="_blank" rel="noreferrer" className="underline">Политика обработки данных</a>
      </p>
    </form>
  );
}
