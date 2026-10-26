import { ensureLogo } from "@/lib/engine/images";
import type { ExtrasBiz } from "@/lib/engine/extras";
import type { Business } from "@/lib/db/schema";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser, demoAllowed } from "@/lib/auth";
import { accountsFor, getBusinessForUser, landingUrl, type LaunchPlan } from "@/lib/engine/launch";
import { listPhotos } from "@/lib/engine/images";
import { LaunchWizard } from "@/components/LaunchWizard";
import { yandexConfigured } from "@/lib/platforms/yandex";
import { vkConfigured } from "@/lib/platforms/vk";
import { aiConfigured } from "@/lib/ai/yandex";
import { hostOf } from "@/lib/util";

export default async function Launch() {
  const user = await requireUser();
  const b = await getBusinessForUser(user.id);
  if (!b) redirect("/app/start");
  if (b.status === "active") redirect("/app");
  const accounts = await accountsFor(user.id);
  const photos = await listPhotos(b.id);
  const plan = (b.launchPlan as LaunchPlan | null) ?? null;
  const logo = await ensureLogo(b).catch(() => null);
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Запуск рекламы</h1>
        <p className="text-muted mt-2 max-w-2xl leading-relaxed">
          {b.name}, {b.city}. <Link href="/app/start" className="underline underline-offset-2">Изменить описание</Link>
        </p>
      </div>
      <LaunchWizard
        business={{ name: b.name, niche: b.niche, monthlyBudget: b.monthlyBudget, siteUrl: b.siteUrl }}
        host={hostOf(landingUrl(b))}
        accounts={accounts.map((a) => ({ id: a.id, platform: a.platform, login: a.login, status: a.status, statusNote: a.statusNote }))}
        flags={{ yandex: yandexConfigured(), vk: vkConfigured(), demo: demoAllowed(), ai: aiConfigured() }}
        plan={plan}
        photos={photos.map((p) => ({ id: p.id, kind: p.kind }))}
        callouts={plan?.callouts ?? []}
        biz={pickBiz(b)}
        href={landingUrl(b)}
        logo={logo ? `/api/images/${logo.id}` : null}
      />
    </div>
  );
}

function pickBiz(b: Business): ExtrasBiz {
  const { name, niche, city, address, phone, whatsapp, telegram, hours, services, advantages, offer, review, description } = b;
  return { name, niche, city, address, phone, whatsapp, telegram, hours, services, advantages, offer, review, description };
}
