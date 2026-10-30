/** Мгновенный каркас страницы, пока сервер собирает данные — переход ощущается сразу, без «зависания» */
export default function Loading() {
  return (
    <div className="grid gap-6 animate-pulse" aria-busy="true" aria-label="Загрузка">
      <div>
        <div className="h-9 w-48 rounded-xl bg-line/70" />
        <div className="h-4 w-36 rounded-lg bg-line/50 mt-3" />
      </div>
      <div className="rounded-[1.75rem] bg-white ring-1 ring-black/[0.05] p-6 sm:p-8">
        <div className="h-4 w-28 rounded bg-line/60" />
        <div className="h-9 w-3/5 rounded-xl bg-line/70 mt-3" />
        <div className="grid sm:grid-cols-2 gap-3 mt-6">
          <div className="h-28 rounded-2xl bg-paper" />
          <div className="h-28 rounded-2xl bg-paper" />
        </div>
        <div className="h-40 rounded-2xl bg-paper mt-6" />
      </div>
      <div className="h-32 rounded-[1.75rem] bg-white ring-1 ring-black/[0.05]" />
    </div>
  );
}
