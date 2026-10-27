import { requireUser } from "@/lib/auth";
import { getBusinessForUser, listProjects } from "@/lib/engine/launch";
import { MAX_PHOTOS, ownerPhotoIds } from "@/lib/engine/images";
import { NICHES } from "@/lib/niches";
import { BusinessOnboarding } from "@/components/BusinessOnboarding";

export default async function Start() {
  const user = await requireUser();
  const b = await getBusinessForUser(user.id);
  const editing = Boolean(b);
  const projects = await listProjects(user.id);
  const savedPhotos = b ? await ownerPhotoIds(b.id) : [];
  const isNewProject = !b && projects.length > 0;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">{editing ? "О бизнесе" : isNewProject ? "Новый проект" : "Расскажите о бизнесе"}</h1>
        <p className="text-muted mt-2 max-w-2xl leading-relaxed">
          {editing
            ? "Новые объявления робот пишет по этому описанию. Уже запущенные не меняются — их можно поправить в разделе «Реклама»."
            : "Из этого робот напишет объявления, подберёт запросы и аудитории. Дайте ссылку — заполним сами, вам останется проверить."}
        </p>
      </div>
      <BusinessOnboarding
        key={b?.id ?? "new"}
        editing={editing}
        draftKey={`${user.id}:${b?.id ?? "new"}`}
        savedPhotos={savedPhotos}
        photoMax={MAX_PHOTOS}
        otherProjects={Math.max(0, projects.length - (b ? 1 : 0))}
        nicheLock={!b ? null : b.status !== "draft" || (b.launchPlan as { launch?: unknown } | null)?.launch ? "launched" : b.launchPlan ? "plan" : null}
        next={editing && b?.status === "active" ? "/app/settings" : "/app/launch"}
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
