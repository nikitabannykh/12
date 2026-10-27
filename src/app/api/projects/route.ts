import { z } from "zod";
import { route, json, fail } from "@/lib/api";
import { listProjects, NEW_PROJECT, projectLimit, setCurrentProject } from "@/lib/engine/launch";

/**
 * Проекты владельца (несколько бизнесов в одном аккаунте).
 * GET — список и текущий; POST {id} — переключиться на свой проект; POST {id:"new"} — начать новый (анкета с шага 1).
 */
export const GET = route(async ({ user, business }) => {
  const list = await listProjects(user.id);
  return json({ projects: list, current: business?.id ?? null, limit: projectLimit(user.email) });
});

const Body = z.object({ id: z.string().trim().min(1).max(64) });

export const POST = route(async ({ user, req }) => {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail("Не понятно, какой проект открыть");
  const { id } = parsed.data;
  if (id === NEW_PROJECT) {
    const n = (await listProjects(user.id)).length;
    const limit = projectLimit(user.email);
    if (n >= limit) return fail(`Можно вести до ${limit} проектов в одном аккаунте${limit === 3 ? " (в демо)" : ""}. Удалить проект поможет поддержка.`);
  }
  if (!(await setCurrentProject(user.id, id))) return fail("Такого проекта нет", 404);
  return json({ ok: true, next: id === NEW_PROJECT ? "/app/start" : "/app" });
});
