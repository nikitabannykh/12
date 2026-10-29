import Link from "next/link";
import { Logo } from "@/components/Logo";
import { getUser } from "@/lib/auth";

/**
 * Лендинг «Полного зала» — страница тетради в клетку и журнал записи администратора.
 * Смелость потрачена в одном месте: журнал недели в первом экране, который заполняется маркером.
 * Остальное — тихие линованные строки, поля с пометками от руки, без сетки одинаковых карточек.
 *
 * Смыслы: работа директолога за 15 минут · ведёт рекламу каждый день · считает клиентов, а не клики ·
 * деньги под контролем · только правда в объявлениях · каждое решение объяснено и отменяется.
 */

const DAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const HOURS = ["10", "12", "14", "16", "18", "20"];
const FILLED: Record<string, string> = {
  "0-4": "Анна", "1-1": "Оля", "1-4": "Катя", "2-0": "Вика", "2-3": "Лена", "2-5": "Маша",
  "3-2": "Ира", "3-4": "Даша", "4-1": "Юля", "4-3": "Нина", "4-4": "Таня", "4-5": "Лиза",
  "5-0": "Алла", "5-1": "Женя", "5-2": "Рита", "5-3": "Вера", "5-4": "Зоя", "6-1": "Соня", "6-2": "Ася",
};
/** Пометки администратора: откуда пришёл человек */
const NOTES: Record<string, string> = { "0-4": "поиск", "1-1": "VK", "3-2": "вернулась", "5-3": "VK", "4-5": "карты" };

const ROUTINE = [
  ["Отдать агентству", "фикс плюс процент от бюджета, отчёт раз в месяц, что поменяли — непонятно"],
  ["Настроить Директ самой", "сотни настроек, модерация, а бюджет уходит на «маникюр обучение» и «лампа для ногтей»"],
  ["Платить за клики", "реклама идёт, деньги списываются, а сколько стоила живая запись — никто не считает"],
] as const;

const PROMISES: { note: string; t: string; d: string }[] = [
  { note: "за 15 минут", t: "Собирает рекламу вместо директолога", d: "Из анкеты о бизнесе — поисковые запросы по услугам и проблемам клиентов, минус-слова, тексты, картинки под каждый формат и страница записи, если нет сайта." },
  { note: "каждый день", t: "Ведёт её, а не просто запускает", d: "Отключает слабые объявления, проверяет новые тексты и аудитории, убирает мусорные запросы, переносит деньги туда, где запись дешевле." },
  { note: "считаем записи", t: "Смотрит на клиентов, а не на клики", d: "Счётчики и цели настраиваются сами. В кабинете видно, сколько стоит обращение и клиент в каждом канале." },
  { note: "ваши деньги", t: "Не выходит за бюджет", d: "Деньги лежат в ваших кабинетах Яндекса и VK. Месячный лимит — жёсткая граница, вся реклама останавливается одной кнопкой." },
  { note: "без выдумок", t: "Пишет в объявлениях только правду", d: "Никаких «скидок» и «лучших мастеров», которых у вас нет: каждое утверждение сверяется с анкетой. Медицинские услуги — по закону о рекламе." },
  { note: "по-человечески", t: "Объясняет каждое решение", d: "Всё, что сделал робот, записано в историю простыми словами. Не согласны — отменяете одной кнопкой." },
];

const LOG = [
  { time: "09:12", t: "Перестали платить за «маникюр обучение»", d: "14 кликов и ни одной записи — добавили минус-слово." },
  { time: "09:12", t: "Проверяем цену в заголовке", d: "«Маникюр с покрытием — 1 900 ₽» против текущего заголовка. Через неделю оставим тот, что приводит больше записей." },
  { time: "09:13", t: "Перенесли 15% бюджета во ВКонтакте", d: "Запись из VK выходит 640 ₽, из сетей Яндекса — 1 100 ₽. Общий лимит прежний." },
  { time: "09:13", t: "Выключили слабое объявление", d: "Его кликали в три раза реже соседних в той же группе." },
];

const READY = [
  ["62 объявления", "в пяти каналах: поиск, сети Яндекса, ВКонтакте и два ретаргетинга"],
  ["12 групп запросов", "по услугам, по проблемам клиентов и по смежным запросам"],
  ["54 минус-слова", "чтобы не платить за «обучение», «вакансии» и «своими руками»"],
  ["3 аудитории во ВКонтакте", "искали услугу, по интересам, живут рядом — робот сравнит их между собой"],
] as const;

const COMPARE: [string, string, string, string][] = [
  ["Запуск", "1–2 недели брифов", "вечера и выходные", "около 15 минут"],
  ["Оптимизация", "раз в неделю или месяц", "когда дойдут руки", "каждый день"],
  ["Цена клиента", "в отчёте, если попросить", "не считается", "видна по каждому каналу"],
  ["Деньги", "часто через счёт агентства", "ваш кабинет", "ваш кабинет и жёсткий лимит"],
  ["Почему так", "«мы оптимизировали»", "—", "объяснение к каждому решению"],
];

const NICHES = ["маникюр", "брови и ресницы", "парикмахерские", "барбершопы", "массаж", "косметология", "остеопатия", "йога", "пилатес", "танцы"];

const FAQ = [
  ["Нужен ли опыт в рекламе?", "Нет. Вы отвечаете на вопросы о своём бизнесе, остальное сервис делает сам. Перед запуском объявления можно посмотреть и поправить."],
  ["Чьи деньги и кто платит площадкам?", "Рекламный бюджет лежит в ваших кабинетах Яндекс Директа и VK Рекламы, пополняете их вы. Мы подключаемся по доступу, который можно отозвать в любой момент."],
  ["А если у меня нет сайта?", "Сервис сделает страницу записи с формой и кнопками мессенджеров. Вести рекламу можно и на свой сайт, и в Telegram или WhatsApp."],
  ["Не нравятся тексты — что делать?", "Поправьте любое объявление вручную, попросите робота переписать все тексты по вашему пожеланию или добавить ещё вариантов."],
  ["Можно ли остановить рекламу?", "Да, одной кнопкой — сразу во всех каналах. Включается обратно так же, статистика сохраняется."],
  ["Работаете с медицинскими услугами?", "Да: остеопатия, массаж, косметология. Объявления пишутся без обещаний результата, а мы подскажем, какую лицензию указать."],
] as const;

function Week() {
  const order = Object.keys(FILLED);
  return (
    <div className="sheet rounded-[6px] p-3 sm:p-5">
      <div className="flex items-baseline justify-between gap-3 pb-2 border-b-2 border-ink">
        <span className="font-extrabold text-lg sm:text-xl tracking-tight">Запись на неделю</span>
        <span className="hand text-xl sm:text-2xl text-ink-2">{order.length} из {DAYS.length * HOURS.length} окон</span>
      </div>
      <div className="grid grid-cols-[1.6rem_repeat(7,minmax(0,1fr))] sm:grid-cols-[2.2rem_repeat(7,minmax(0,1fr))] mt-2">
        <div />
        {DAYS.map((d) => <div key={d} className="hand text-center text-lg sm:text-xl text-muted pb-1">{d}</div>)}
        {HOURS.map((h, hi) => (
          <div key={h} className="contents">
            <div className="text-[11px] sm:text-xs text-faint pt-1.5 tabular-nums">{h}<span className="hidden sm:inline">:00</span></div>
            {DAYS.map((_, di) => {
              const k = `${di}-${hi}`;
              const name = FILLED[k];
              return (
                <div key={k} className="relative h-10 sm:h-14 border-t border-l border-[var(--rule)] last:border-r">
                  {name ? (
                    <div className="slot-fill absolute inset-[3px] sm:inset-1 stroke flex flex-col justify-center px-1 sm:px-1.5 overflow-hidden" style={{ animationDelay: `${250 + order.indexOf(k) * 80}ms` }}>
                      <span className="hand text-[1.05rem] sm:text-[1.35rem] leading-none text-ink truncate">{name}</span>
                      {NOTES[k] ? <span className="hidden sm:block text-[10px] leading-tight text-ink-2/80 truncate mt-0.5">{NOTES[k]}</span> : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Строка тетради: слева на полях — пометка от руки, справа — текст */
function Line({ note, children, className = "" }: { note?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`grid md:grid-cols-[11rem_minmax(0,1fr)] gap-x-8 ${className}`}>
      <div className="hand text-2xl text-[var(--margin)] leading-tight md:text-right md:pt-0.5">{note}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export default async function Home() {
  const user = await getUser();
  const cta = user ? { href: "/app", text: "Открыть кабинет" } : { href: "/login?tab=register", text: "Запустить рекламу" };
  return (
    <main className="lp min-h-dvh overflow-x-clip text-ink">
      <header className="mx-auto max-w-6xl px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        <Logo />
        <nav className="hidden md:flex items-center gap-7 text-[0.95rem] text-ink-2">
          <a href="#robot" className="hover:text-ink">Что делает робот</a>
          <a href="#compare" className="hover:text-ink">Сравнение</a>
          <a href="#faq" className="hover:text-ink">Вопросы</a>
          {user ? null : <Link href="/login" className="hover:text-ink">Войти</Link>}
        </nav>
        <Link href={cta.href} className="btn btn-primary btn-sm">{user ? "Кабинет" : "Начать"}</Link>
      </header>

      <div className="lp-margin mx-auto max-w-6xl px-4 sm:px-6 [--margin-x:0.5rem] md:[--margin-x:13.5rem]">
        {/* Первый экран: журнал записи */}
        <section className="pt-8 sm:pt-14 pb-16 sm:pb-24">
          <Line note={<span className="hidden md:inline">для салонов,<br />студий и клиник</span>}>
            <h1 className="text-[2.6rem] leading-[0.98] sm:text-[4.6rem] font-extrabold tracking-[-0.035em] max-w-[14ch]">
              Реклама, которая заполняет запись сама
            </h1>
            <p className="mt-6 text-lg sm:text-xl text-ink-2 leading-relaxed max-w-[36rem]">
              Расскажите о бизнесе — за 15 минут сервис соберёт рекламу в Яндексе и ВКонтакте, а дальше каждый день будет сам убирать лишнее, пробовать новое и объяснять каждое решение простыми словами.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href={cta.href} className="btn btn-primary h-12 px-6 text-base">{cta.text}</Link>
              <Link href="/login?demo=1" className="btn btn-ghost h-12 px-6 text-base bg-white">Посмотреть на демо</Link>
            </div>
          </Line>

          <Line className="mt-12 sm:mt-16" note={<span className="hidden md:block">каждое жёлтое окно — человек, который увидел рекламу и&nbsp;записался</span>}>
            <Week />
            <p className="hand md:hidden text-xl text-[var(--margin)] mt-3">каждое жёлтое окно — человек, который увидел рекламу и записался</p>
          </Line>
        </section>

        {/* Как обычно */}
        <section className="pb-16 sm:pb-24">
          <Line note="как обычно">
            <h2 className="text-3xl sm:text-5xl font-extrabold tracking-[-0.03em] max-w-[18ch] leading-[1.05]">Три способа потратить бюджет и не заполнить окна</h2>
          </Line>
          <div className="mt-8 grid gap-0">
            {ROUTINE.map(([t, d]) => (
              <Line key={t} className="py-4 border-t border-[var(--rule)]" note={<span className="hidden md:inline text-3xl">✗</span>}>
                <div className="text-xl sm:text-2xl font-bold"><span className="scratch">{t}</span></div>
                <p className="mt-1 text-muted text-lg leading-relaxed max-w-[42rem]">{d}</p>
              </Line>
            ))}
          </div>
          <Line className="mt-8">
            <p className="text-2xl sm:text-3xl font-extrabold tracking-tight leading-snug max-w-[28ch]">
              <span className="stroke">«Полный зал» делает работу директолога за вас</span> — а вам остаётся принимать клиентов.
            </p>
          </Line>
        </section>

        {/* Обещания */}
        <section className="pb-16 sm:pb-24">
          <Line note="что вы получаете">
            <h2 className="text-3xl sm:text-5xl font-extrabold tracking-[-0.03em] leading-[1.05]">Шесть обещаний</h2>
          </Line>
          <div className="mt-8">
            {PROMISES.map((p) => (
              <Line key={p.t} className="py-5 border-t border-[var(--rule)]" note={p.note}>
                <div className="grid lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] gap-x-8 gap-y-1">
                  <div className="text-xl font-bold leading-snug">{p.t}</div>
                  <p className="text-ink-2 leading-relaxed max-w-[40rem]">{p.d}</p>
                </div>
              </Line>
            ))}
          </div>
        </section>

        {/* Готово через 15 минут */}
        <section className="pb-16 sm:pb-24">
          <Line note="через 15 минут">
            <div className="sheet rounded-[6px] p-5 sm:p-8">
              <h2 className="text-2xl sm:text-4xl font-extrabold tracking-[-0.03em] leading-tight">Что будет готово к запуску</h2>
              <p className="mt-2 text-muted">Пример: студия маникюра в Казани, бюджет 70 000 ₽ в месяц.</p>
              <ul className="mt-6 grid sm:grid-cols-2 gap-x-10 gap-y-5">
                {READY.map(([t, d]) => (
                  <li key={t} className="flex gap-3">
                    <svg viewBox="0 0 28 28" className="w-7 h-7 shrink-0 text-good" aria-hidden><path d="M4 15 L11 22 L24 5" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    <div>
                      <div className="text-xl font-extrabold tracking-tight">{t}</div>
                      <div className="text-ink-2 leading-snug mt-0.5">{d}</div>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-7 pt-5 border-t border-[var(--rule)] text-muted leading-relaxed">Перед запуском всё видно так, как увидят люди. Тексты можно поправить, лишнее выключить, а робота — попросить переписать.</p>
            </div>
          </Line>
        </section>

        {/* Робот каждый день */}
        <section id="robot" className="pb-16 sm:pb-24 scroll-mt-8">
          <Line note="каждое утро">
            <h2 className="text-3xl sm:text-5xl font-extrabold tracking-[-0.03em] leading-[1.05] max-w-[20ch]">Робот разбирает вчерашний день и записывает, что сделал</h2>
            <p className="mt-4 text-lg text-ink-2 leading-relaxed max-w-[38rem]">Решения — по накопленной статистике: первые три дня он только наблюдает. Любое действие можно отменить.</p>
          </Line>
          <div className="mt-8">
            {LOG.map((x) => (
              <Line key={x.t} className="py-4 border-t border-[var(--rule)]" note={<span className="tabular-nums">{x.time}</span>}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                  <div className="text-xl font-bold">{x.t}</div>
                  <span className="hand text-xl text-ink-2 underline decoration-[var(--margin)] decoration-2 underline-offset-4">отменить</span>
                </div>
                <p className="mt-1 text-ink-2 leading-relaxed max-w-[42rem]">{x.d}</p>
              </Line>
            ))}
          </div>
          <Line className="mt-2"><p className="text-sm text-faint">Пример записей из истории, цифры условные.</p></Line>
        </section>

        {/* Сравнение */}
        <section id="compare" className="pb-16 sm:pb-24 scroll-mt-8">
          <Line note="честно">
            <h2 className="text-3xl sm:text-5xl font-extrabold tracking-[-0.03em] leading-[1.05]">Агентство, сама или робот</h2>
          </Line>
          <Line className="mt-8">
            <div className="hidden md:grid grid-cols-[9rem_1fr_1fr_1.15fr] text-[0.95rem]">
              <div className="pb-3 border-b-2 border-ink" />
              <div className="pb-3 border-b-2 border-ink text-muted">Агентство</div>
              <div className="pb-3 border-b-2 border-ink text-muted">Сама в кабинете</div>
              <div className="pb-3 border-b-2 border-ink font-extrabold">Полный зал</div>
              {COMPARE.map(([row, a, s, us]) => (
                <div key={row} className="contents">
                  <div className="py-3.5 border-b border-[var(--rule)] font-bold">{row}</div>
                  <div className="py-3.5 border-b border-[var(--rule)] text-muted pr-4">{a}</div>
                  <div className="py-3.5 border-b border-[var(--rule)] text-muted pr-4">{s}</div>
                  <div className="py-3.5 border-b border-[var(--rule)] font-semibold"><span className="stroke">{us}</span></div>
                </div>
              ))}
            </div>
            <ul className="md:hidden">
              {COMPARE.map(([row, a, s, us]) => (
                <li key={row} className="py-3.5 border-t border-[var(--rule)]">
                  <div className="font-bold">{row}</div>
                  <div className="mt-1 font-semibold"><span className="stroke">{us}</span></div>
                  <div className="mt-1 text-sm text-muted">Агентство: {a}. Сама: {s}.</div>
                </li>
              ))}
            </ul>
          </Line>
        </section>

        {/* Для кого и каналы */}
        <section className="pb-16 sm:pb-24">
          <Line note="для кого">
            <p className="text-3xl sm:text-[2.75rem] font-extrabold tracking-[-0.03em] leading-[1.15] max-w-[26ch]">
              {NICHES.map((n, i) => (
                <span key={n}>{n}{i < NICHES.length - 1 ? ", " : ""}</span>
              ))}
              <span className="text-muted"> — и любой бизнес, который живёт записью.</span>
            </p>
            <p className="mt-5 text-lg text-ink-2 leading-relaxed max-w-[40rem]">Робот знает, как ищут каждую услугу и какие запросы нецелевые, и подстраивается под ваш прайс. До запуска покажет, сколько обращений ждать за ваш бюджет.</p>
          </Line>
          <Line className="mt-10" note="где покажем">
            <dl className="grid sm:grid-cols-2 gap-x-10">
              {[
                ["Поиск Яндекса", "тем, кто прямо сейчас ищет услугу"],
                ["Сайты и приложения Яндекса", "картинки тем, кто недавно интересовался"],
                ["ВКонтакте и Одноклассники", "живут рядом, искали услугу, подходят по интересам"],
                ["Ретаргетинг", "возвращает тех, кто был на странице, но не записался"],
              ].map(([t, d]) => (
                <div key={t} className="py-3.5 border-t border-[var(--rule)]">
                  <dt className="font-bold text-lg">{t}</dt>
                  <dd className="text-ink-2">{d}</dd>
                </div>
              ))}
            </dl>
          </Line>
        </section>

        {/* Как начать — это последовательность, поэтому номера */}
        <section className="pb-16 sm:pb-24">
          <Line note="как начать">
            <h2 className="text-3xl sm:text-5xl font-extrabold tracking-[-0.03em] leading-[1.05]">Три шага до первых записей</h2>
          </Line>
          <ol className="mt-8">
            {[
              ["Расскажите о бизнесе", "Услуги, цены, адрес, чем вы лучше. Есть сайт — заполним по нему."],
              ["Подключите кабинеты и выберите бюджет", "Яндекс Директ и VK Реклама подключаются в пару кликов."],
              ["Проверьте объявления и запустите", "Поправьте что хотите — показы включатся сразу во всех каналах."],
            ].map(([t, d], i) => (
              <li key={t}>
                <Line className="py-4 border-t border-[var(--rule)]" note={<span className="text-4xl leading-none">{i + 1}</span>}>
                  <div className="text-xl font-bold">{t}</div>
                  <p className="mt-1 text-ink-2">{d}</p>
                </Line>
              </li>
            ))}
          </ol>
        </section>

        {/* FAQ */}
        <section id="faq" className="pb-16 sm:pb-24 scroll-mt-8">
          <Line note="вопросы">
            <h2 className="text-3xl sm:text-5xl font-extrabold tracking-[-0.03em] leading-[1.05]">Что обычно спрашивают</h2>
          </Line>
          <div className="mt-8">
            {FAQ.map(([q, a]) => (
              <Line key={q} className="border-t border-[var(--rule)]">
                <details className="group py-4">
                  <summary className="cursor-pointer list-none flex items-baseline justify-between gap-4 text-xl font-bold">
                    {q}
                    <span className="hand text-3xl text-[var(--margin)] leading-none transition-transform group-open:rotate-45" aria-hidden>+</span>
                  </summary>
                  <p className="mt-2 text-ink-2 text-lg leading-relaxed max-w-[42rem]">{a}</p>
                </details>
              </Line>
            ))}
          </div>
        </section>

        {/* Финал: пустое окно в журнале */}
        <section className="pb-20 sm:pb-28">
          <Line note={<span className="hidden md:inline">свободно</span>}>
            <div className="rounded-[6px] border-[3px] border-dashed border-ink/40 bg-white/70 p-6 sm:p-10">
              <div className="hand text-2xl text-[var(--margin)]">завтра, 18:00 — свободно</div>
              <h2 className="mt-2 text-3xl sm:text-5xl font-extrabold tracking-[-0.03em] leading-[1.05] max-w-[20ch]">Пустое окно в записи — это деньги, которые не пришли</h2>
              <p className="mt-4 text-lg text-ink-2 max-w-[38rem]">Запустите рекламу сегодня, остальное сделает робот. Посмотреть, как всё устроено, можно на демо — без кабинетов и оплаты.</p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link href={cta.href} className="btn btn-primary h-12 px-6 text-base">{cta.text}</Link>
                <Link href="/login?demo=1" className="btn btn-ghost h-12 px-6 text-base bg-white">Открыть демо</Link>
              </div>
            </div>
          </Line>
        </section>
      </div>

      <footer className="bg-white border-t border-[var(--rule)]">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 flex flex-wrap gap-x-8 gap-y-3 justify-between items-center text-sm text-muted">
          <Logo size={22} />
          <span className="max-w-xl">Работаем напрямую через API Яндекс Директа и VK Рекламы. Маркировку рекламы площадки делают автоматически.</span>
          <Link href="/privacy" className="underline underline-offset-2">Политика конфиденциальности</Link>
        </div>
      </footer>
    </main>
  );
}
