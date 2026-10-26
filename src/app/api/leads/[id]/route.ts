import { route, json, fail, needBusiness } from "@/lib/api";
import { isLeadStatus, setLeadStatus, LEAD_STATUS_LABEL } from "@/lib/engine/ops";

/** Статус заявки в один тап: { status: "booked" | "no_answer" | "spam" | null } (null — снять отметку) */
export const PATCH = route<{ id: string }>(async ({ business, req, params }) => {
  needBusiness(business);
  const d = await req.json().catch(() => null);
  const status = d?.status ?? null;
  if (status !== null && !isLeadStatus(status)) return fail("Выберите: «Записался», «Не дозвонились» или «Спам»");
  const row = await setLeadStatus(business.id, String(params.id).slice(0, 64), status);
  return json({ ok: true, status: row.status, label: row.status ? LEAD_STATUS_LABEL[row.status as keyof typeof LEAD_STATUS_LABEL] : null });
});
