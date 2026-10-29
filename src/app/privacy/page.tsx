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

/** Адрес для запросов по данным аккаунта: из MAIL_FROM («"Самоход" <hello@…>» или просто адрес), иначе null */
function contactEmail(): string | null {
  const m = (process.env.MAIL_FROM ?? "").match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/);
  return m ? m[0] : null;
}

/**
 * Простая политика (152-ФЗ): кто, что, зачем, сколько хранит и как отозвать согласие.
 * Два раздела: посетители страниц записи (оставляют заявки) и владельцы аккаунтов (регистрация в сервисе).
 */
export default async function Privacy({ searchParams }: { searchParams: Promise<{ b?: string }> }) {
  const b = await business((await searchParams).b);
  const email = contactEmail();
  const operator = b ? `«${b.name}»${b.address ? `, ${b.address}` : `, ${b.city}`}` : "владелец страницы записи, на которой вы оставили заявку";
  return (
    <main className="mx-auto max-w-2xl px-4 sm:px-6 py-10 sm:py-14 leading-relaxed">
      {b ? <Link href={`/p/${b.publicKey}`} className="text-sm text-muted underline">← Вернуться на страницу записи</Link> : <Link href="/" className="text-sm text-muted underline">← На главную «Самохода»</Link>}
      <h1 className="text-3xl font-extrabold tracking-tight mt-4">Политика обработки персональных данных</h1>
      <p className="text-muted mt-2">Коротко и по делу: что происходит с вашими данными, когда вы оставляете заявку{b ? "" : " на странице записи или регистрируетесь в «Самоходе»"}.</p>
      {b ? null : (
        <nav className="mt-4 text-sm flex flex-wrap gap-x-4 gap-y-1">
          <a href="#visitors" className="underline">Если вы оставили заявку</a>
          <a href="#accounts" className="underline">Если у вас аккаунт в «Самоходе»</a>
        </nav>
      )}

      <section id="visitors" className="mt-8 grid gap-6 scroll-mt-6">
        <h2 className="text-xl font-extrabold tracking-tight">Посетителям страниц записи</h2>
        <div>
          <h3 className="text-lg font-bold">Кто обрабатывает</h3>
          <p className="mt-1">Оператор персональных данных — {operator}. По его поручению данные хранит и передаёт ему сервис «Самоход», через который работает страница записи.</p>
        </div>
        <div>
          <h3 className="text-lg font-bold">Какие данные</h3>
          <ul className="mt-1 list-disc pl-5 grid gap-1">
            <li>имя (если вы его указали) и номер телефона;</li>
            <li>выбранная услуга;</li>
            <li>технические данные: обезличенный номер посетителя и рекламное объявление, по которому вы пришли.</li>
          </ul>
          <p className="mt-2">Мы не собираем паспортные данные, адрес, e-mail и не храним ваш IP-адрес — для защиты от спама используется только его необратимый отпечаток, который хранится не дольше двух суток.</p>
        </div>
        <div>
          <h3 className="text-lg font-bold">Зачем</h3>
          <p className="mt-1">Чтобы перезвонить вам и записать на услугу, а также понять, какая реклама приводит клиентов. Данные не продаются и не передаются третьим лицам, кроме случаев, предусмотренных законом. Рекламных рассылок по вашему номеру не будет.</p>
        </div>
        <div>
          <h3 className="text-lg font-bold">Сколько хранятся</h3>
          <p className="mt-1">Пока они нужны для записи и учёта обращений, но не дольше 3 лет. После этого или по вашему требованию имя и телефон удаляются; в статистике остаётся только сам факт обращения.</p>
        </div>
        <div>
          <h3 className="text-lg font-bold">Ваши права</h3>
          <p className="mt-1">Вы можете узнать, какие данные о вас хранятся, попросить исправить или удалить их, а также отозвать согласие на обработку. Для этого свяжитесь с оператором{b?.phone ? <> по телефону <a className="underline" href={`tel:${b.phone.replace(/[^\d+]/g, "")}`}>{b.phone}</a></> : " любым удобным способом, указанным на странице записи"}. Ответим в течение 10 рабочих дней.</p>
        </div>
        <div>
          <h3 className="text-lg font-bold">Согласие</h3>
          <p className="mt-1">Отправляя заявку, вы даёте согласие на обработку указанных выше данных для перечисленных целей (ст. 9 Федерального закона № 152-ФЗ «О персональных данных»). Согласие действует до достижения целей обработки или до его отзыва.</p>
        </div>
        <div>
          <h3 className="text-lg font-bold">Аналитика</h3>
          <p className="mt-1">На странице может работать Яндекс Метрика — она учитывает посещения обезличенно. Содержимое полей с именем и телефоном Метрика не записывает.</p>
        </div>
      </section>

      {b ? null : (
        <section id="accounts" className="mt-12 grid gap-6 scroll-mt-6">
          <h2 className="text-xl font-extrabold tracking-tight">Владельцам аккаунтов «Самохода»</h2>
          <p>Этот раздел — для тех, кто зарегистрировался в сервисе, чтобы вести рекламу своего бизнеса.</p>
          <div>
            <h3 className="text-lg font-bold">Кто обрабатывает</h3>
            <p className="mt-1">Сервис «Самоход» — для работы вашего аккаунта и рекламы. Заявки ваших клиентов сервис обрабатывает по вашему поручению: оператором их данных остаётесь вы (см. раздел выше).</p>
          </div>
          <div>
            <h3 className="text-lg font-bold">Какие данные</h3>
            <ul className="mt-1 list-disc pl-5 grid gap-1">
              <li>e-mail и имя (если вы его указали);</li>
              <li>пароль — только в виде необратимого хеша, сам пароль мы не храним и не видим;</li>
              <li>доступы к рекламным кабинетам Яндекс Директа и VK Рекламы (токены) — в зашифрованном виде;</li>
              <li>данные о бизнесе из анкеты: название, сфера, адрес, телефон и мессенджеры, часы работы, услуги и цены, фото, реквизиты для маркировки рекламы;</li>
              <li>рекламные кампании, объявления и их статистика;</li>
              <li>заявки и обращения ваших клиентов (имя, телефон, услуга, источник);</li>
              <li>если вы подключили уведомления в Telegram — id чата.</li>
            </ul>
          </div>
          <div>
            <h3 className="text-lg font-bold">Зачем</h3>
            <p className="mt-1">Чтобы вы могли войти в аккаунт; чтобы создавать, запускать и настраивать рекламу от вашего имени в подключённых кабинетах; чтобы показывать статистику и присылать заявки, отчёты и служебные письма (подтверждение почты, восстановление пароля). Рекламных рассылок не будет, данные не продаются.</p>
          </div>
          <div>
            <h3 className="text-lg font-bold">Кому передаются</h3>
            <ul className="mt-1 list-disc pl-5 grid gap-1">
              <li>Яндексу (Яндекс Директ, Метрика, YandexGPT) и VK (VK Реклама) — данные о бизнесе и тексты объявлений, нужные для запуска и ведения рекламы в ваших кабинетах;</li>
              <li>хостинг-провайдеру и провайдеру базы данных, где работает сервис и хранятся данные;</li>
              <li>почтовому сервису — для отправки писем; Telegram — если вы подключили уведомления;</li>
              <li>сервису геокодирования — только адрес бизнеса, чтобы найти его на карте.</li>
            </ul>
            <p className="mt-2">Другим третьим лицам данные не передаются, кроме случаев, предусмотренных законом.</p>
          </div>
          <div>
            <h3 className="text-lg font-bold">Сколько хранятся</h3>
            <p className="mt-1">Пока существует аккаунт. Заявки клиентов — не дольше 3 лет, как сказано выше. Доступ к рекламному кабинету можно отозвать в любой момент в самом Яндексе или VK.</p>
          </div>
          <div>
            <h3 className="text-lg font-bold">Удаление и ваши права</h3>
            <p className="mt-1">Вы можете узнать, какие данные хранятся, исправить их или попросить удалить аккаунт вместе со всеми данными. Напишите {email ? <>на <a className="underline" href={`mailto:${email}`}>{email}</a></> : "в ответ на любое письмо сервиса"} с почты, на которую зарегистрирован аккаунт. Ответим и удалим данные в течение 10 рабочих дней; кампании в рекламных кабинетах остаются вашими — их удаляют в самих кабинетах.</p>
          </div>
          <div>
            <h3 className="text-lg font-bold">Согласие</h3>
            <p className="mt-1">Регистрируясь, вы даёте согласие на обработку указанных данных для перечисленных целей (152-ФЗ «О персональных данных»). Согласие действует до удаления аккаунта или до его отзыва.</p>
          </div>
        </section>
      )}
    </main>
  );
}
