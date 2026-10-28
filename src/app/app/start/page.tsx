import { requireUser } from "@/lib/auth";
import { getBusinessForUser, listProjects } from "@/lib/engine/launch";
import { MAX_PHOTOS, ownerPhotoIds } from "@/lib/engine/images";
import { NICHES } from "@/lib/niches";
import { BusinessOnboarding } from "@/components/BusinessOnboarding";
import { StageBar } from "@/components/StageBar";
import { businessLinks } from "@/lib/links";

/**
 * Этап 1 «Данные о бизнесе». ?new=<метка> — «+ Новый проект»: каждый раз чистая анкета (ссылки сверху),
 * даже если мы уже на этой странице.
 */
export default async function Start({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const b = await getBusinessForUser(user.id);
  const editing = Boolean(b);
  const projects = await listProjects(user.id);
  const savedPhotos = b ? await ownerPhotoIds(b.id) : [];
  const isNewProject = !b && projects.length > 0;
  const active = b?.status === "active";
  const links = b ? businessLinks(b) : [];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:gap-6">
      {active ? null : <StageBar current={1} dataDone={editing} canLaunch={editing} />}
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">{active ? "О бизнесе" : isNewProject ? "Новый проект: данные о бизнесе" : "Данные о бизнесе"}</h1>
        <p className="text-muted mt-2 max-w-2xl leading-relaxed max-sm:hidden">
          {active
            ? "Новые объявления робот пишет по этому описанию. Уже запущенные не меняются — их можно поправить в разделе «Реклама»."
            : "Из этого робот напишет объявления, подберёт запросы и аудитории. Дайте ссылку — заполним сами, вам останется проверить."}
        </p>
      </div>
      <BusinessOnboarding
        key={b?.id ?? `new:${(sp.new ?? "").slice(0, 20)}`}
        editing={editing}
        draftKey={`${user.id}:${b?.id ?? "new"}`}
        savedPhotos={savedPhotos}
        photoMax={MAX_PHOTOS}
        otherProjects={Math.max(0, projects.length - (b ? 1 : 0))}
        nicheLock={!b ? null : b.status !== "draft" || (b.launchPlan as { launch?: unknown } | null)?.launch ? "launched" : b.launchPlan ? "plan" : null}
        next={editing && b?.status === "active" ? "/app/settings" : "/app/launch"}
        saveLabel={editing && b?.status === "active" ? "Сохранить изменения" : "Сохранить и перейти к запуску"}
        initialLinks={links.map((l) => l.url)}
        niches={NICHES.map((n) => ({ id: n.id, label: n.label, examples: n.examples }))}
        initial={{
          name: b?.name ?? "",
          niche: b?.niche ?? "",
          city: b?.city ?? "",
          address: b?.address ?? "",
          phone: b?.phone ?? "",
          whatsapp: b?.whatsapp ?? "",
          telegram: b?.telegram ?? "",
          hours: b?.hours ?? "",
          siteUrl: b?.siteUrl ?? "",
          orgUrl: b?.orgUrl ?? "",
          dgisUrl: links.find((l) => l.kind === "dgis")?.url ?? "",
          legalInfo: b?.legalInfo ?? "",
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
