import { eq } from "drizzle-orm";
import { route, json, fail, needBusiness } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { accountsFor, publishStep, type LaunchPlan } from "@/lib/engine/launch";
import { releaseLock, runBusiness, tryLock } from "@/lib/engine/run";

// Hobby-план Vercel — до 60 с на запрос. Поэтому за один вызов создаём кампанию одного канала,
// а мастер запуска вызывает маршрут повторно, пока не придёт done=true.
export const maxDuration = 60;
const LAUNCH_LOCK = "launch";
const LAUNCH_LOCK_MS = 75_000; // дольше maxDuration: если функцию убьют, блокировка истечёт сама

export const POST = route(async ({ user, business }) => {
  needBusiness(business);
  if (business.status === "active") return json({ done: true, ok: true, already: true, warnings: [] });
  if (!(await tryLock(business.id, LAUNCH_LOCK, LAUNCH_LOCK_MS))) return fail("Запуск уже идёт — подождите несколько секунд", 409);
  try {
    // Перечитываем бизнес под блокировкой: параллельный запрос мог продвинуть запуск
    const db = await getDb();
    const [b] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, business.id));
    if (!b) return fail("Бизнес не найден", 404);
    if (b.status === "active") return json({ done: true, ok: true, already: true, warnings: [] });
    const plan = b.launchPlan as LaunchPlan | null;
    if (!plan || plan.stage !== "ready") return fail("Сначала подготовьте объявления и картинки");
    const accounts = await accountsFor(user.id);
    const res = await publishStep(b, plan, accounts);
    if (res.done && !res.ok) return fail(res.warnings.join("\n") || "Не удалось создать кампании");
    // Демо: сразу подтягиваем статусы и статистику (быстро). Для настоящих площадок это сделает робот при следующей
    // проверке — отчёты Директа готовятся долго и не должны съедать время запроса.
    if (res.done && accounts.some((a) => a.platform === "demo") && !accounts.some((a) => a.platform !== "demo")) {
      await runBusiness(b.id, { optimize: false }).catch(() => null);
    }
    return json(res);
  } finally {
    await releaseLock(business.id, LAUNCH_LOCK);
  }
});
