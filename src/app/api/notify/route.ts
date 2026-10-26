import { route, json, needBusiness } from "@/lib/api";
import { getNotify, getUnlinked, pollUpdates, saveNotify, setUnlinked, tgConfigured } from "@/lib/notify";

export const dynamic = "force-dynamic";

/** Состояние уведомлений (страница настроек опрашивает его, пока владелец привязывает чат) */
export const GET = route(async ({ business }) => {
  needBusiness(business);
  await pollUpdates().catch(() => {});
  const s = await getNotify(business.id);
  const connected = Boolean(s?.telegramChatId);
  return json({
    configured: tgConfigured(),
    connected,
    name: s?.telegramName ?? null,
    digest: s ? s.digest === 1 : true,
    unlinked: connected ? null : await getUnlinked(business.id),
  });
});

/** Отключить Telegram */
export const DELETE = route(async ({ business }) => {
  needBusiness(business);
  const s = await getNotify(business.id);
  await saveNotify(business.id, { telegramChatId: null, telegramName: null });
  if (s?.telegramChatId) await setUnlinked(business.id, "вы отключили уведомления в настройках", s.telegramName);
  return json({ ok: true });
});

/** Включить/выключить утреннюю сводку */
export const PATCH = route(async ({ business, req }) => {
  needBusiness(business);
  const d = await req.json().catch(() => ({}));
  await saveNotify(business.id, { digest: d.digest ? 1 : 0 });
  return json({ ok: true });
});
