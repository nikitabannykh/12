import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { AdAccount } from "../db/schema";
import { decrypt, encrypt } from "../crypto";
import { YandexDirect, yandexRefresh } from "./yandex";
import { VkAds } from "./vk";
import { DemoPlatform } from "./demo";
import type { PlatformClient } from "./types";
import { CHANNEL_INFO } from "../channels";

export async function clientFor(account: AdAccount): Promise<PlatformClient> {
  const db = await getDb();
  if (account.platform === "demo") return new DemoPlatform(account.id);

  if (account.platform === "yandex") {
    let token = decrypt(account.accessToken);
    // Токены Яндекса живут год; обновляем заранее, за 14 дней до окончания
    if (account.refreshToken && account.expiresAt && account.expiresAt.getTime() - Date.now() < 14 * 864e5) {
      try {
        const t = await yandexRefresh(decrypt(account.refreshToken));
        token = t.accessToken;
        await db.update(schema.adAccounts).set({
          accessToken: encrypt(t.accessToken),
          refreshToken: t.refreshToken ? encrypt(t.refreshToken) : account.refreshToken,
          expiresAt: new Date(Date.now() + t.expiresIn * 1000),
        }).where(eq(schema.adAccounts.id, account.id));
      } catch {
        /* старый токен ещё действует — попробуем в следующий раз */
      }
    }
    return new YandexDirect(token);
  }

  if (account.platform === "vk") {
    return new VkAds(
      { accessToken: decrypt(account.accessToken), refreshToken: account.refreshToken ? decrypt(account.refreshToken) : null },
      async (t) => {
        await db.update(schema.adAccounts).set({
          accessToken: encrypt(t.accessToken),
          refreshToken: t.refreshToken ? encrypt(t.refreshToken) : account.refreshToken,
          expiresAt: new Date(Date.now() + t.expiresIn * 1000),
          status: "ok",
          statusNote: null,
        }).where(eq(schema.adAccounts.id, account.id));
      },
      account.clientId && account.clientSecret ? { clientId: account.clientId, clientSecret: decrypt(account.clientSecret) } : null,
    );
  }
  throw new Error(`Неизвестная площадка ${account.platform}`);
}

export const PLATFORM_NAME: Record<string, string> = {
  yandex: "Яндекс Директ",
  vk: "VK Реклама",
  demo: "Демо-кабинет",
};

export const CHANNEL_NAME: Record<string, string> = Object.fromEntries(Object.entries(CHANNEL_INFO).map(([k, v]) => [k, v.name]));

export const CHANNEL_HINT: Record<string, string> = Object.fromEntries(Object.entries(CHANNEL_INFO).map(([k, v]) => [k, v.hint]));
