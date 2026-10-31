import { Wallet, PauseCircle } from "lucide-react";

const TOPUP: Record<string, string> = { yandex: "https://direct.yandex.ru/", vk: "https://ads.vk.ru/hq/budget/transactions" };
const CABINET: Record<string, string> = { yandex: "Яндекс Директ", vk: "VK Реклама" };
const DOCS_HELP = "https://yandex.ru/support/tooltips-direct/moderation-warning-data-forms.html";

export type ServingInput = {
  platform: string;
  /** На счёте нет денег */
  money: boolean;
  /** Сколько объявлений Директ не показывает без лицензии */
  docs: number;
  /** Медицина, показов ещё не было, а Директ про лицензию молчит — напоминаем проверить */
  licenseUnknown: boolean;
  /** Прочие причины от площадки (уже без денег) */
  other?: string[];
  /** Сайт, куда ведёт реклама, не открывается — робот держит рекламу на паузе */
  site?: string | null;
};

type Issue = { title: string; text: string; tone: "bad" | "warn"; action?: React.ReactNode };

/** Одни и те же причины и тексты — на «Главном» и в карточке кампании */
export function servingIssues(x: ServingInput): Issue[] {
  const out: Issue[] = [];
  if (x.site)
    out.push({ tone: "bad", title: "Сайт не работает", text: `${x.site} не открывается — робот остановил рекламу и включит её сам, когда сайт заработает. Проверьте адрес сайта или переключите рекламу на страницу записи.`, action: <a className="btn btn-primary btn-sm" href="/app/settings#landing">Куда ведёт реклама</a> });
  if (x.money)
    out.push({ tone: "bad", title: "Нет денег на счёте", text: `Пополните кабинет ${CABINET[x.platform] ?? ""} — показы начнутся сами.`, action: <a className="btn btn-primary btn-sm" href={TOPUP[x.platform] ?? TOPUP.yandex} target="_blank" rel="noreferrer">Пополнить кабинет</a> });
  if (x.docs)
    out.push({ tone: "bad", title: "Директ ждёт лицензию", text: `Показы запрещены, пока Директ не проверит медицинскую лицензию. В кабинете Директа: объявление → «Отправить документы».`, action: <a className="btn btn-ghost btn-sm bg-white" href={DOCS_HELP} target="_blank" rel="noreferrer">Как отправить лицензию</a> });
  else if (x.licenseUnknown)
    out.push({ tone: "warn", title: "Лицензия: проверьте в Директе", text: "Медицинскую рекламу Директ показывает только после проверки лицензии. Если вы её не отправляли или проверка не закончилась — показов не будет даже с деньгами на счёте.", action: <a className="btn btn-ghost btn-sm bg-white" href={DOCS_HELP} target="_blank" rel="noreferrer">Как отправить лицензию</a> });
  for (const n of x.other ?? []) out.push({ tone: "bad", title: "Площадка не показывает рекламу", text: n.replace(/^Не показывается:\s*/, "") });
  return out;
}

export function ServingIssues({ issues, heading, compact = false, paused = false }: { issues: Issue[]; heading?: string; compact?: boolean; paused?: boolean }) {
  if (!issues.length) return null;
  const bad = issues.some((x) => x.tone === "bad");
  // Реклама на паузе: те же проблемы помешают показам, когда её включат
  const title = paused ? `Что помешает показам, когда включите рекламу${issues.length > 1 ? ` (${issues.length})` : ""}` : bad ? `Реклама не показывается${issues.length > 1 ? ` — причин: ${issues.length}` : ""}` : "Проверьте лицензию";
  const Icon = issues[0].title.startsWith("Нет денег") ? Wallet : PauseCircle;
  // Если реклама уже на паузе из-за сайта — заголовок «стоит», а не «не показывается»
  return (
    <section className={`rounded-[var(--radius-card)] border ${compact ? "p-4" : "p-4 sm:p-5"} flex items-start gap-3 ${bad ? "bg-bad-soft border-bad/30" : "bg-warn-soft border-warn/30"}`} role="status">
      <Icon size={22} className={`shrink-0 mt-0.5 ${bad ? "text-bad" : "text-warn"}`} />
      <div className="flex-1 min-w-0">
        <div className="font-bold leading-snug">{heading ? `${heading}: ${title.charAt(0).toLowerCase()}${title.slice(1)}` : title}</div>
        <ol className="mt-3 grid gap-4">
          {issues.map((x, i) => (
            <li key={`${i}-${x.title}`} className="text-sm">
              <div className="font-semibold">{issues.length > 1 ? `${i + 1}. ` : ""}{x.title}</div>
              <p className="text-ink-2 mt-0.5 leading-relaxed max-w-2xl">{x.text}</p>
              {x.action ? <div className="mt-2">{x.action}</div> : null}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
