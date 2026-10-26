import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { getBusinessForUser } from "@/lib/engine/launch";
import { getDb, schema } from "@/lib/db";
import { ChangeItem } from "@/components/ChangeItem";

const FILTERS = [
  { id: "all", label: "Все" },
  { id: "robot", label: "Робот" },
  { id: "owner", label: "Вы" },
];

export default async function History({ searchParams }: { searchParams: Promise<{ who?: string }> }) {
  const user = await requireUser();
  const b = await getBusinessForUser(user.id);
  if (!b) redirect("/app/start");
  const who = (await searchParams).who;
  const db = await getDb();
  const where = who === "robot" || who === "owner" ? and(eq(schema.changes.businessId, b.id), eq(schema.changes.actor, who)) : eq(schema.changes.businessId, b.id);
  const list = await db.select().from(schema.changes).where(where).orderBy(desc(schema.changes.at)).limit(200);

  // Группируем по дням
  const byDay = new Map<string, typeof list>();
  for (const c of list) {
    const key = c.at.toLocaleDateString("ru-RU", { day: "numeric", month: "long", weekday: "long", timeZone: "Europe/Moscow" });
    byDay.set(key, [...(byDay.get(key) ?? []), c]);
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">История изменений</h1>
          <p className="text-muted mt-1 max-w-2xl">Всё, что меняли в рекламе вы и робот, — с причинами. Большинство изменений можно отменить: реклама вернётся к прежнему состоянию.</p>
        </div>
        <div className="inline-flex rounded-xl bg-card border border-line p-1">
          {FILTERS.map((f) => {
            const active = (who ?? "all") === f.id;
            return (
              <Link key={f.id} href={f.id === "all" ? "/app/history" : `/app/history?who=${f.id}`} aria-current={active ? "page" : undefined} className={`px-4 h-9 grid place-items-center rounded-lg text-sm font-semibold ${active ? "bg-ink text-white" : "text-ink-2"}`}>
                {f.label}
              </Link>
            );
          })}
        </div>
      </div>
      {list.length ? (
        [...byDay.entries()].map(([day, items]) => (
          <section key={day} className="card p-5 sm:p-7">
            <h2 className="font-bold text-muted first-letter:uppercase">{day}</h2>
            <ul className="mt-5 grid gap-6">{items.map((c) => <ChangeItem key={c.id} c={c} />)}</ul>
          </section>
        ))
      ) : (
        <div className="card p-8 text-center text-muted">Изменений пока нет.</div>
      )}
    </div>
  );
}
