import { route, json, fail } from "@/lib/api";
import { accountsFor } from "@/lib/engine/launch";
import { clientFor } from "@/lib/platforms";
import { VkAds } from "@/lib/platforms/vk";

export const maxDuration = 60;

/** Диагностика VK: пакеты кабинета и формат баннера выбранных пакетов (только чтение, только свой кабинет) */
export const GET = route(async ({ user, req }) => {
  const acc = (await accountsFor(user.id)).find((a) => a.platform === "vk" && a.status === "ok");
  if (!acc) return fail("VK не подключён");
  const c = await clientFor(acc);
  if (!(c instanceof VkAds)) return fail("VK не подключён");
  const url = new URL(req.url);
  const ids = (url.searchParams.get("packages") ?? "").split(",").map(Number).filter(Boolean);
  return json(await c.diagnostics(ids));
});
