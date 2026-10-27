import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { route, json, fail } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { errorText, uid } from "@/lib/util";
import { VkAds, vkToken } from "@/lib/platforms/vk";

const Body = z.object({
  clientId: z.string().trim().min(4, "Вставьте client_id из кабинета VK Рекламы").max(200),
  clientSecret: z.string().trim().min(8, "Вставьте client_secret из кабинета VK Рекламы").max(400),
});

/**
 * Подключение VK Рекламы по ключам API самого рекламодателя: в кабинете VK «Настройки → Доступ к API».
 * Работает для любого кабинета без OAuth-приложения сервиса. Секрет храним зашифрованным — им же обновляем токен.
 */
export const POST = route(async ({ user, req }) => {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message || "Проверьте ключи");
  const { clientId, clientSecret } = parsed.data;
  const creds = { clientId, clientSecret };
  let t;
  try {
    t = await vkToken({ grant_type: "client_credentials" }, creds);
  } catch (e) {
    return fail(`VK не принял ключи: ${errorText(e)}. Проверьте client_id и client_secret — секрет VK показывает только 10 минут после выдачи; если не сохранили, запросите новый в кабинете.`);
  }
  let login = `VK Реклама (${clientId.slice(0, 6)}…)`;
  try {
    const u = await new VkAds({ accessToken: t.accessToken, refreshToken: t.refreshToken }).user();
    login = u.username || u.additional_info?.client_name || login;
  } catch {
    /* имя кабинета не критично */
  }
  const db = await getDb();
  const values = {
    accessToken: encrypt(t.accessToken),
    refreshToken: t.refreshToken ? encrypt(t.refreshToken) : null,
    clientId,
    clientSecret: encrypt(clientSecret),
    expiresAt: new Date(Date.now() + t.expiresIn * 1000),
    status: "ok",
    statusNote: null,
  };
  const [existing] = await db.select().from(schema.adAccounts).where(and(eq(schema.adAccounts.userId, user.id), eq(schema.adAccounts.platform, "vk")));
  if (existing) await db.update(schema.adAccounts).set({ ...values, login }).where(eq(schema.adAccounts.id, existing.id));
  else await db.insert(schema.adAccounts).values({ id: uid("acc_"), userId: user.id, platform: "vk", login, ...values });
  return json({ ok: true, login });
});
