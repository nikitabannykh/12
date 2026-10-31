import { z } from "zod";
import { route, json, fail } from "@/lib/api";
import { listProjects, NEW_PROJECT, projectLimit, setCurrentProject } from "@/lib/engine/launch";
import { deleteProject } from "@/lib/engine/project-delete";

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
    if (n >= limit) return fail(`Можно вести до ${limit} проектов в одном аккаунте${limit === 3 ? " (в демо)" : ""}. Удалить лишний проект можно в «Настройках → Аккаунт».`);
  }
  if (!(await setCurrentProject(user.id, id))) return fail("Такого проекта нет", 404);
  return json({ ok: true, next: id === NEW_PROJECT ? "/app/start" : "/app" });
});

const Del = z.object({ id: z.string().trim().min(1).max(64), confirm: z.string().trim().max(200) });

/** Удалить проект: {id, confirm} — confirm должен совпасть с названием проекта (защита от случайного нажатия) */
export const DELETE = route(async ({ user, req }) => {
  const parsed = Del.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail("Не понятно, какой проект удалить");
  const p = (await listProjects(user.id)).find((x) => x.id === parsed.data.id);
  if (!p) return fail("Такого проекта нет", 404);
  if (parsed.data.confirm.toLowerCase() !== p.name.trim().toLowerCase()) return fail("Название не совпадает — введите его точно, как в проекте");
  const r = await deleteProject(user.id, p.id);
  return json({ ok: true, ...r });
});
