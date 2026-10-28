import { z } from "zod";
import { route, json, fail, needBusiness } from "@/lib/api";
import { accountsFor, landingUrl } from "@/lib/engine/launch";
import { clientFor } from "@/lib/platforms";
import { VkAds } from "@/lib/platforms/vk";
import { saveVkPixelEmail, vkLeadGoal, vkPixelCounterId, vkPixelEmail } from "@/lib/engine/regions";
import { logChange } from "@/lib/engine/ops";
import { findUserById } from "@/lib/account";

export const maxDuration = 60;

async function vkClient(userId: string) {
  const acc = (await accountsFor(userId)).find((a) => a.platform === "vk" && a.status === "ok");
  if (!acc) return null;
  const c = await clientFor(acc);
  return c instanceof VkAds ? c : null;
}

/** Состояние пикселя VK: есть ли пиксель и событие «Заявка», какой email предложить */
export const GET = route(async ({ user, business }) => {
  needBusiness(business);
  const pixel = await vkPixelCounterId(business.id).catch(() => null);
  const client = pixel ? await vkClient(user.id).catch(() => null) : null;
  const goal = pixel && client ? await client.leadGoal(pixel).catch(() => null) : null;
  const u = await findUserById(user.id).catch(() => null);
  return json({ pixel, goal: Boolean(goal), email: (await vkPixelEmail(business.id)) ?? (u as { email?: string } | null)?.email ?? null, url: landingUrl(business, "vk") });
});

const Body = z.object({ email: z.string().trim().email("Укажите email, например name@mail.ru").max(200), consent: z.literal(true, { message: "Нужно ваше согласие" }) });

/**
 * «Настроить VK за меня»: с согласия владельца создаём пиксель VK через API (VK требует email владельца для
 * счётчика Top@Mail.ru) или находим уже созданный, и подключаем его к странице записи.
 */
export const POST = route(async ({ user, business, req }) => {
  needBusiness(business);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message || "Проверьте email");
  const client = await vkClient(user.id);
  if (!client) return fail("Сначала подключите кабинет VK Рекламы");
  await saveVkPixelEmail(business.id, parsed.data.email);
  const r = await vkLeadGoal(business, client, landingUrl(business, "vk"), parsed.data.email);
  const pixel = await vkPixelCounterId(business.id).catch(() => null);
  if (!pixel) return fail(r.note?.replace(/^VK: /, "") || "VK не создал пиксель");
  await logChange({
    businessId: business.id, actor: "owner", kind: "settings", title: "Подключили пиксель VK",
    reason: `Пиксель ${pixel} считает посещения и заявки со страницы, куда ведёт реклама. ${r.pricedGoal ? "Событие «Заявка» найдено — VK будет искать тех, кто записывается." : "Осталось добавить событие «Заявка» в настройках пикселя."}`,
  });
  return json({ pixel, goal: Boolean(r.pricedGoal), note: r.note ?? null });
});
