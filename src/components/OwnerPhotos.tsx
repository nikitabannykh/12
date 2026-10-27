"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { api, resizeToJpeg, useToast } from "./client";

function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

/** Свои фото владельца после запуска: загрузить, посмотреть, где используются, удалить */
export function OwnerPhotos({ photos, max }: { photos: { id: string; uses: number }[]; max: number }) {
  const router = useRouter();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const left = Math.max(0, max - photos.length);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    let done = 0;
    try {
      for (const f of Array.from(files).slice(0, Math.min(6, left))) {
        await api("POST", "/api/photos", { dataUrl: await resizeToJpeg(f) });
        done++;
      }
      toast(done === 1 ? "Фото загружено — робот поставит его в объявления при следующей проверке" : "Фото загружены — робот поставит их в объявления при следующей проверке");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
      if (done) router.refresh();
    }
  }

  async function remove(id: string, uses: number) {
    const msg = uses
      ? `Это фото уже в ${uses} ${plural(uses, "объявлении", "объявлениях", "объявлениях")}. Они продолжат работать, но новые объявления робот будет делать без него. Удалить?`
      : "Удалить фото?";
    if (!window.confirm(msg)) return;
    setDeleting(id);
    try {
      await api("DELETE", `/api/photos/${id}`);
      toast("Фото удалено");
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 sm:gap-3">
        {photos.map((ph) => (
          <figure key={ph.id} className="m-0 min-w-0">
            <div className="relative aspect-square rounded-xl overflow-hidden border border-line bg-paper">
              <img src={`/api/images/${ph.id}`} alt="Ваше фото" className="w-full h-full object-cover" loading="lazy" />
              <button type="button" className="absolute right-1 top-1 bg-white/95 rounded-lg p-1.5 shadow-sm hover:text-bad disabled:opacity-60" aria-label="Удалить фото"
                disabled={deleting === ph.id} onClick={() => remove(ph.id, ph.uses)}>
                {deleting === ph.id ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} />}
              </button>
            </div>
            <figcaption className={`mt-1 text-xs leading-tight ${ph.uses ? "text-ink-2 font-semibold" : "text-muted"}`}>
              {ph.uses ? `В ${ph.uses} ${plural(ph.uses, "объявлении", "объявлениях", "объявлениях")}` : "Пока не в рекламе"}
            </figcaption>
          </figure>
        ))}
        {left > 0 ? (
          <button type="button" className="aspect-square self-start rounded-xl border-2 border-dashed border-line-2 grid place-items-center text-muted hover:border-ink hover:text-ink disabled:opacity-60"
            onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="spin" /> : <span className="flex flex-col items-center gap-1 text-xs font-semibold text-center px-1"><ImagePlus size={22} />Добавить фото</span>}
          </button>
        ) : null}
      </div>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png" multiple hidden onChange={(e) => upload(e.target.files)} />
      {left === 0 ? <p className="hint mt-3">Загружено {max} фото — больше не нужно. Чтобы добавить новое, удалите одно из старых.</p> : null}
    </div>
  );
}
