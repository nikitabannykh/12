/**
 * Главный образ сервиса: неделя в журнале записи, которая заполняется.
 * Одна анимация на загрузке страницы — окна закрашиваются маркером по очереди.
 */
const DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const HOURS = ["10:00", "12:00", "14:00", "16:00", "18:00", "20:00"];
// Какие окна заполняются — правдоподобная неделя салона: в журнале записи стоят имена клиентов
const FILLED: Record<string, string> = {
  "0-4": "Анна", "1-1": "Оля", "1-4": "Катя", "2-0": "Вика", "2-3": "Лена", "2-5": "Маша",
  "3-2": "Ира", "3-4": "Даша", "4-1": "Юля", "4-3": "Нина", "4-4": "Таня", "4-5": "Лиза",
  "5-0": "Алла", "5-1": "Женя", "5-2": "Рита", "5-3": "Вера", "5-4": "Зоя", "6-1": "Соня", "6-2": "Ася",
};

export function ScheduleHero() {
  const order = Object.keys(FILLED);
  return (
    <div className="card p-4 sm:p-5 shadow-[0_24px_60px_-30px_rgba(29,32,69,0.35)]">
      <div className="flex items-baseline justify-between mb-3">
        <div className="font-bold">Записи на неделю</div>
        <div className="text-sm text-muted">
          <span className="marked font-bold text-ink">{order.length}</span> из {DAYS.length * HOURS.length} окон
        </div>
      </div>
      <div className="grid grid-cols-[2.6rem_repeat(7,1fr)] gap-1 text-[11px] sm:text-xs">
        <div />
        {DAYS.map((d) => (
          <div key={d} className="text-center text-muted font-semibold pb-1">{d}</div>
        ))}
        {HOURS.map((h, hi) => (
          <div key={h} className="contents">
            <div className="text-faint pr-1 text-right leading-8 sm:leading-9">{h}</div>
            {DAYS.map((_, di) => {
              const key = `${di}-${hi}`;
              const label = FILLED[key];
              const idx = order.indexOf(key);
              return (
                <div key={key} className="relative h-8 sm:h-9 rounded-md bg-paper border border-line overflow-hidden">
                  {label ? (
                    <div className="slot-fill absolute inset-0 bg-mark flex items-center px-1.5 font-semibold text-ink truncate" style={{ animationDelay: `${300 + idx * 90}ms` }}>
                      <span className="truncate">{label}</span>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <p className="hint mt-3">Каждое жёлтое окно — человек, который увидел рекламу и записался.</p>
    </div>
  );
}
