import { macEqual } from "@/lib/crypto";
import { processUpdate, tgConfigured, webhookSecret } from "@/lib/notify";

export const dynamic = "force-dynamic";

/** Вебхук бота: сюда Telegram присылает сообщения (/start <код> — привязать чат, /stop — отвязать) */
export async function POST(req: Request) {
  if (!tgConfigured()) return new Response(null, { status: 404 });
  const got = req.headers.get("x-telegram-bot-api-secret-token") || "";
  if (!macEqual(got, webhookSecret())) return new Response(null, { status: 401 });
  try {
    await processUpdate(await req.json());
  } catch (e) {
    console.error("telegram webhook", e);
  }
  // Всегда 200: иначе Telegram будет бесконечно повторять то же обновление
  return Response.json({ ok: true });
}
