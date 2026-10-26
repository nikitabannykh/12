import Link from "next/link";
import { Logo } from "@/components/Logo";
import { ScheduleHero } from "@/components/ScheduleHero";
import { getUser } from "@/lib/auth";

export default async function Home() {
  const user = await getUser();
  const cta = user ? { href: "/app", text: "Открыть кабинет" } : { href: "/login", text: "Начать бесплатно" };
  return (
    <main className="min-h-dvh">
      <header className="mx-auto max-w-6xl px-4 sm:px-6 h-16 flex items-center justify-between">
        <Logo />
        <Link href={cta.href} className="btn btn-ghost btn-sm">{user ? "Кабинет" : "Войти"}</Link>
      </header>

      <section className="mx-auto max-w-6xl px-4 sm:px-6 pt-8 sm:pt-16 pb-16 grid lg:grid-cols-[1.05fr_1fr] gap-10 lg:gap-14 items-center">
        <div>
          <h1 className="text-[2.35rem] leading-[1.05] sm:text-6xl font-extrabold tracking-[-0.03em]">
            Реклама для салона, которая ведёт себя сама
          </h1>
          <p className="mt-5 text-lg sm:text-xl text-ink-2 leading-relaxed max-w-[34rem]">
            Расскажите о бизнесе и выберите бюджет. Сервис запустит рекламу в Яндексе и ВКонтакте, каждый день будет убирать то, что не работает, и объяснит каждое решение простыми словами.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href={cta.href} className="btn btn-primary h-12 px-6 text-base">{cta.text}</Link>
            <Link href="/login?demo=1" className="btn btn-ghost h-12 px-6 text-base">Посмотреть на демо-данных</Link>
          </div>
          <p className="hint mt-4">Для маникюрных и бровных салонов, барбершопов, массажа, йоги, пилатеса и танцев. Платите только площадкам — со своего рекламного кабинета.</p>
        </div>
        <ScheduleHero />
      </section>

      <section className="bg-card border-y border-line">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-14 sm:py-20">
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight max-w-xl">Три шага до первых обращений</h2>
          <ol className="mt-10 grid md:grid-cols-3 gap-8">
            {[
              ["Расскажите о бизнесе", "Услуги, цены, адрес, чем вы лучше. Есть сайт — заполним по нему. Нет сайта — сделаем страницу записи."],
              ["Подключите кабинеты и выберите бюджет", "Яндекс Директ и VK Реклама подключаются в два клика. Покажем, сколько обращений ждать за ваши деньги."],
              ["Проверьте объявления и запустите", "Тексты, ключевые фразы и картинки готовы. Поправьте что хотите — и реклама уходит на модерацию."],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-4">
                <span className="shrink-0 w-9 h-9 rounded-full bg-mark font-extrabold grid place-items-center">{i + 1}</span>
                <div>
                  <div className="font-bold text-lg leading-snug">{t}</div>
                  <p className="text-muted mt-1.5 leading-relaxed">{d}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 sm:px-6 py-14 sm:py-20 grid lg:grid-cols-2 gap-10">
        <div>
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Что робот делает каждый день</h2>
          <p className="text-muted mt-3 leading-relaxed max-w-md">Решения принимаются по накопленной статистике, а не наугад. Любое можно отменить одной кнопкой.</p>
        </div>
        <ul className="grid gap-3">
          {[
            ["Отключает слабые объявления", "Если объявление кликают втрое реже соседних, деньги переходят к тем, что работают."],
            ["Проверяет гипотезы", "Цена в заголовке или подарок на первый визит? Робот запускает A/B-тест и оставляет победителя."],
            ["Чистит поисковые запросы", "Видит, что люди искали «маникюр обучение», и перестаёт платить за такие клики."],
            ["Переносит бюджет", "Где клиенты дешевле — туда больше денег. Общий бюджет месяца не превышается никогда."],
            ["Переписывает отклонённое", "Модерация не пропустила текст — робот напишет новый вариант сам."],
          ].map(([t, d]) => (
            <li key={t} className="card p-4 sm:p-5">
              <div className="font-bold">{t}</div>
              <p className="text-muted mt-1 leading-relaxed text-[0.95rem]">{d}</p>
            </li>
          ))}
        </ul>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 flex flex-wrap gap-4 justify-between text-sm text-muted">
          <Logo size={22} />
          <span>Работаем напрямую через API Яндекс Директа и VK Рекламы. Маркировку рекламы площадки делают автоматически.</span>
        </div>
      </footer>
    </main>
  );
}
