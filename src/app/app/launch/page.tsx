import { isLaunched } from "@/lib/util";
import { timeTargeting } from "@/lib/engine/extras";
import type { ShowSettings } from "@/lib/engine/show";
import { pageUrl, type LandingSettings } from "@/lib/engine/landing";
import { appUrl } from "@/lib/util";
import { vkRadiusFor } from "@/lib/platforms/vk-formats";
import { ensureLogo } from "@/lib/engine/images";
import type { ExtrasBiz } from "@/lib/engine/extras";
import type { Business } from "@/lib/db/schema";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser, demoAllowed } from "@/lib/auth";
import { accountsFor, getBusinessForUser, landingUrl, type LaunchPlan } from "@/lib/engine/launch";
import { listPhotos } from "@/lib/engine/images";
import { LaunchWizard } from "@/components/LaunchWizard";
import { StageBar } from "@/components/StageBar";
import { ArrowLeft } from "lucide-react";
import { yandexConfigured } from "@/lib/platforms/yandex";
import { vkConfigured } from "@/lib/platforms/vk";
import { aiConfigured } from "@/lib/ai/yandex";
import { hostOf } from "@/lib/util";
import { isMedical } from "@/lib/niches";

/** Этап 2 «Запуск рекламы»: кабинеты → бюджет → объявления → запуск (разделы одной страницы) */
export default async function Launch() {
  const user = await requireUser();
  const b = await getBusinessForUser(user.id);
  if (!b) redirect("/app/start");
  if (isLaunched(b.status)) redirect("/app");
  const accounts = await accountsFor(user.id);
  const photos = await listPhotos(b.id);
  const plan = (b.launchPlan as LaunchPlan | null) ?? null;
  const logo = await ensureLogo(b).catch(() => null);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:gap-6">
      <Link href="/app/start" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink justify-self-start -mb-1">
        <ArrowLeft size={16} /> Вернуться к данным
      </Link>
      <StageBar current={2} dataDone canLaunch />
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Запуск рекламы</h1>
        <p className="text-muted mt-2 max-w-2xl leading-relaxed">
          {b.name}, {b.city}. Подключите кабинет, выберите бюджет, проверьте объявления — и запускайте.
        </p>
      </div>
      <LaunchWizard
        business={{ name: b.name, niche: b.niche, monthlyBudget: b.monthlyBudget, siteUrl: b.siteUrl, medical: isMedical(b) }}
        host={hostOf(landingUrl(b))}
        accounts={accounts.map((a) => ({ id: a.id, platform: a.platform, login: a.login, status: a.status, statusNote: a.statusNote }))}
        flags={{ yandex: yandexConfigured(), vk: vkConfigured(), demo: demoAllowed(), ai: aiConfigured() }}
        plan={plan}
        photos={photos.map((p) => ({ id: p.id, kind: p.kind }))}
        callouts={plan?.callouts ?? []}
        biz={pickBiz(b)}
        href={landingUrl(b)}
        logo={logo ? `/api/images/${logo.id}` : null}
        vkRadiusKm={b.geo ? Math.round(vkRadiusFor(b.city) / 100) / 10 : null}
        legalInfo={b.legalInfo}
        landing={{ initial: (b.landing ?? {}) as LandingSettings, siteUrl: b.siteUrl, pageUrl: pageUrl(b, appUrl()) }}
        show={{ initial: (b.showSettings ?? {}) as ShowSettings, city: b.city, address: b.address, autoTime: timeTargeting({ ...b, showSettings: {} })?.note ?? null, autoRadiusKm: b.geo ? Math.round(vkRadiusFor(b.city) / 100) / 10 : null }}
      />
    </div>
  );
}

function pickBiz(b: Business): ExtrasBiz {
  const { name, niche, city, address, phone, whatsapp, telegram, hours, services, advantages, offer, review, description, orgId, showSettings } = b;
  return { name, niche, city, address, phone, whatsapp, telegram, hours, services, advantages, offer, review, description, orgId, showSettings };
}
