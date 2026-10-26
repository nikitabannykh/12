import { requireUser } from "@/lib/auth";
import { getBusinessForUser } from "@/lib/engine/launch";
import { NICHES } from "@/lib/niches";
import { BusinessForm } from "@/components/BusinessForm";
import { aiConfigured } from "@/lib/ai/yandex";

export default async function Start() {
  const user = await requireUser();
  const b = await getBusinessForUser(user.id);
  const editing = Boolean(b);
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">{editing ? "О бизнесе" : "Расскажите о бизнесе"}</h1>
        <p className="text-muted mt-2 max-w-2xl leading-relaxed">
          {editing
            ? "Новые объявления робот пишет по этому описанию. Уже запущенные не меняются — их можно поправить в разделе «Реклама»."
            : "Из этого робот напишет объявления, подберёт запросы и аудитории. Займёт 5 минут — дальше всё автоматически."}
        </p>
      </div>
      <BusinessForm
        aiOn={aiConfigured()}
        nicheLock={!b ? null : b.status !== "draft" || (b.launchPlan as { launch?: unknown } | null)?.launch ? "launched" : b.launchPlan ? "plan" : null}
        next={editing && b?.status === "active" ? "/app/settings" : "/app/launch"}
        niches={NICHES.map((n) => ({ id: n.id, label: n.label, examples: n.examples }))}
        initial={{
          name: b?.name ?? "",
          niche: b?.niche ?? "nails",
          city: b?.city ?? "",
          address: b?.address ?? "",
          phone: b?.phone ?? "",
          whatsapp: b?.whatsapp ?? "",
          telegram: b?.telegram ?? "",
          hours: b?.hours ?? "",
          siteUrl: b?.siteUrl ?? "",
          description: b?.description ?? "",
          services: b?.services ?? [],
          advantages: b?.advantages ?? [],
          audience: b?.audience ?? "",
          offer: b?.offer ?? "",
          review: b?.review ?? "",
          leadToClientRate: b?.leadToClientRate ?? 0.5,
        }}
      />
    </div>
  );
}
