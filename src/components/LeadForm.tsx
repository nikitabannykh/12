"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";

export function LeadForm({ publicKey, services, accent }: { publicKey: string; services: string[]; accent: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [err, setErr] = useState("");
  if (state === "done") {
    return (
      <div className="rounded-2xl bg-white p-6 text-center">
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
        let src: any = {};
        try { src = JSON.parse(localStorage.getItem("pz_src") || "{}"); } catch {}
        const res = await fetch("/api/lead", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: publicKey, name: fd.get("name"), contact: fd.get("phone"), message: fd.get("service"),
            source: src.s, campaign: src.c, ad: src.a, vid: localStorage.getItem("pz_vid"),
          }),
        });
        if (res.ok) {
          setState("done");
          try { (window as any).ym?.(Number(document.querySelector("script[data-ym]")?.getAttribute("data-ym")), "reachGoal", "pz_form"); } catch {}
        } else {
          setErr((await res.json().catch(() => ({}))).error || "Не отправилось — попробуйте ещё раз");
          setState("idle");
        }
      }}
    >
      <div className="font-bold text-lg">Записаться</div>
      <input name="name" className="field" placeholder="Как к вам обращаться" autoComplete="name" />
      <input name="phone" className="field" placeholder="Телефон" inputMode="tel" autoComplete="tel" required />
      {services.length ? (
        <select name="service" className="field" defaultValue="">
          <option value="">Выберите услугу</option>
          {services.map((s) => <option key={s}>{s}</option>)}
        </select>
      ) : null}
      {err ? <div className="text-sm text-bad">{err}</div> : null}
      <button className="btn h-12 text-white" style={{ background: accent }} disabled={state === "busy"}>
        {state === "busy" ? <Loader2 size={16} className="spin" /> : null}Отправить заявку
      </button>
      <p className="text-xs text-muted">Нажимая кнопку, вы соглашаетесь, что с вами свяжутся по указанному телефону.</p>
    </form>
  );
}
