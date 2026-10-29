import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Политика обработки персональных данных", robots: { index: false } };

async function business(key: string | undefined) {
  if (!key || key.length > 64) return null;
  const db = await getDb();
  const [b] = await db
    .select({ name: schema.businesses.name, city: schema.businesses.city, address: schema.businesses.address, phone: schema.businesses.phone, publicKey: schema.businesses.publicKey })
    .from(schema.businesses)
    .where(eq(schema.businesses.publicKey, key));
  return b ?? null;
}

/** Простая политика для формы записи (152-ФЗ): кто, что, зачем, сколько хранит и как отозвать согласие */
export default async function Privacy({ searchParams }: { searchParams: Promise<{ b?: string }> }) {
  const b = await business((await searchParams).b);
  const operator = b ? `«${b.name}»${b.address ? `, ${b.address}` : `, ${b.city}`}` : "владелец страницы записи, на которой вы оставили заявку";
  return (
    <main className="mx-auto max-w-2xl px-4 sm:px-6 py-10 sm:py-14 leading-relaxed">
      {b ? <Link href={`/p/${b.publicKey}`} className="text-sm text-muted underline">← Вернуться на страницу записи</Link> : null}
      <h1 className="text-3xl font-extrabold tracking-tight mt-4">Политика обработки персональных данных</h1>
      <p className="text-muted mt-2">Коротко и по делу: что происходит с вашими данными, когда вы оставляете заявку.</p>

      <section className="mt-8 grid gap-6">
        <div>
          <h2 className="text-lg font-bold">Кто обрабатывает</h2>
          <p className="mt-1">Оператор персональных данных — {operator}. По его поручению данные хранит и передаёт ему сервис «Самоход», через который работает страница записи.</p>
        </div>
        <div>
          <h2 className="text-lg font-bold">Какие данные</h2>
          <ul className="mt-1 list-disc pl-5 grid gap-1">
            <li>имя (если вы его указали) и номер телефона;</li>
            <li>выбранная услуга;</li>
            <li>технические данные: обезличенный номер посетителя и рекламное объявление, по которому вы пришли.</li>
          </ul>
          <p className="mt-2">Мы не собираем паспортные данные, адрес, e-mail и не храним ваш IP-адрес — для защиты от спама используется только его необратимый отпечаток, который хранится не дольше двух суток.</p>
        </div>
        <div>
          <h2 className="text-lg font-bold">Зачем</h2>
          <p className="mt-1">Чтобы перезвонить вам и записать на услугу, а также понять, какая реклама приводит клиентов. Данные не продаются и не передаются третьим лицам, кроме случаев, предусмотренных законом. Рекламных рассылок по вашему номеру не будет.</p>
        </div>
        <div>
          <h2 className="text-lg font-bold">Сколько хранятся</h2>
          <p className="mt-1">Пока они нужны для записи и учёта обращений, но не дольше 3 лет. После этого или по вашему требованию имя и телефон удаляются; в статистике остаётся только сам факт обращения.</p>
        </div>
        <div>
          <h2 className="text-lg font-bold">Ваши права</h2>
          <p className="mt-1">Вы можете узнать, какие данные о вас хранятся, попросить исправить или удалить их, а также отозвать согласие на обработку. Для этого свяжитесь с оператором{b?.phone ? <> по телефону <a className="underline" href={`tel:${b.phone.replace(/[^\d+]/g, "")}`}>{b.phone}</a></> : " любым удобным способом, указанным на странице записи"}. Ответим в течение 10 рабочих дней.</p>
        </div>
        <div>
          <h2 className="text-lg font-bold">Согласие</h2>
          <p className="mt-1">Отправляя заявку, вы даёте согласие на обработку указанных выше данных для перечисленных целей (ст. 9 Федерального закона № 152-ФЗ «О персональных данных»). Согласие действует до достижения целей обработки или до его отзыва.</p>
        </div>
        <div>
          <h2 className="text-lg font-bold">Аналитика</h2>
          <p className="mt-1">На странице может работать Яндекс Метрика — она учитывает посещения обезличенно. Содержимое полей с именем и телефоном Метрика не записывает.</p>
        </div>
      </section>
    </main>
  );
}
