import { route, json, fail, needBusiness } from "@/lib/api";
import { revertChange } from "@/lib/engine/ops";
import { errorText } from "@/lib/util";

export const POST = route<{ id: string }>(async ({ business, params }) => {
  needBusiness(business);
  try {
    await revertChange(business.id, params.id);
    return json({ ok: true });
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status) return fail(errorText(e), status);
    console.error(e);
    // Технические подробности (SQL, ответы площадок на английском) владельцу не показываем
    const msg = errorText(e);
    return fail(/[а-яё]/i.test(msg) && !/failed query/i.test(msg) ? msg : "Не удалось отменить изменение. Попробуйте ещё раз через минуту.", 500);
  }
});
