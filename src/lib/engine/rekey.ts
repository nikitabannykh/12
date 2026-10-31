import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import { decrypt, encrypt, isLegacyEncrypted } from "../crypto";

/**
 * Токены кабинетов, зашифрованные прежним ключом (выведенным из строки старой базы), перешифровываем текущим APP_SECRET.
 * Идёт в каждом проходе робота и почти ничего не стоит, когда перешифровывать нечего. После этого строка старой базы
 * нужна только для старых сессий (живут до 30 дней).
 */
export async function rekeyAccounts(): Promise<number> {
  const db = await getDb();
  const rows = await db.select().from(schema.adAccounts);
  let n = 0;
  for (const a of rows) {
    const patch: Partial<typeof a> = {};
    if (isLegacyEncrypted(a.accessToken)) patch.accessToken = encrypt(decrypt(a.accessToken));
    if (a.refreshToken && isLegacyEncrypted(a.refreshToken)) patch.refreshToken = encrypt(decrypt(a.refreshToken));
    if (a.clientSecret && isLegacyEncrypted(a.clientSecret)) patch.clientSecret = encrypt(decrypt(a.clientSecret));
    if (!Object.keys(patch).length) continue;
    await db.update(schema.adAccounts).set(patch).where(eq(schema.adAccounts.id, a.id));
    n++;
  }
  return n;
}
