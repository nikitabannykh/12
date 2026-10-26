import { route, json, needBusiness } from "@/lib/api";
import { revertChange } from "@/lib/engine/ops";

export const POST = route<{ id: string }>(async ({ business, params }) => {
  needBusiness(business);
  await revertChange(business.id, params.id);
  return json({ ok: true });
});
