import { route, json, needBusiness } from "@/lib/api";
import { ownerVariant } from "@/lib/engine/optimizer";

export const maxDuration = 60;

export const POST = route<{ id: string }>(async ({ business, params }) => {
  needBusiness(business);
  const ad = await ownerVariant(business, params.id);
  return json({ ad });
});
