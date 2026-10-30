import { route, json } from "@/lib/api";
import { inboxFor, markInboxSeen } from "@/lib/engine/inbox";

/** Колокольчик: «сейчас требует действий» + лента событий */
export const GET = route(async ({ business }) => {
  if (!business) return json({ items: [], unread: 0 });
  return json(await inboxFor(business));
});

/** Открыли колокольчик — всё прочитано */
export const POST = route(async ({ business }) => {
  if (business) await markInboxSeen(business);
  return json({ ok: true });
});
