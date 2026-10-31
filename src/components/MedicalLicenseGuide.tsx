/** Медицинские услуги: что за документ нужен, где его взять и куда загрузить — со ссылками */
import { ExternalLink, FileCheck2 } from "lucide-react";

const A = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a href={href} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2 inline-flex items-center gap-1">{children}<ExternalLink size={12} /></a>
);

export function MedicalLicenseGuide({ service, legalInfo, address }: { service?: string | null; legalInfo?: string | null; address?: string | null }) {
  return (
    <div className="rounded-xl border border-warn/40 bg-warn-soft/60 p-4 text-sm text-ink-2 grid gap-3">
      <div className="font-bold text-ink flex items-center gap-2"><FileCheck2 size={17} className="text-warn" /> Медицинские услуги: без лицензии объявления не пройдут модерацию</div>
      <ol className="list-decimal pl-5 grid gap-2.5 leading-relaxed">
        <li>
          <b>Какой документ.</b> Лицензия на медицинскую деятельность — организации или ИП, от имени которых вы принимаете. Нужны все страницы и приложения, и в них должны быть:
          <ul className="list-disc pl-5 mt-1 grid gap-0.5">
            <li>адрес, где идёт приём{address ? <> — тот же, что в рекламе: <b>{address}</b></> : ""};</li>
            <li>в перечне работ (услуг) — ваша услуга{service ? <> (для «{service}» — например, «остеопатия» или «мануальная терапия»)</> : ""};</li>
            <li>то же юрлицо, что указано на сайте или странице записи{legalInfo ? <> (<b>{legalInfo}</b>)</> : <> — укажите его в разделе <a href="/app/start#legal" className="underline">«О бизнесе» → «Юр. данные»</a></>}.</li>
          </ul>
        </li>
        <li>
          <b>Где взять копию.</b> С 2021 года лицензии — это запись в едином реестре: подойдёт выписка из реестра лицензий (заказывается на Госуслугах или на сайте Росздравнадзора) или скан бумажной лицензии с приложениями.
          {" "}<A href="https://www.gosuslugi.ru">Госуслуги</A> · <A href="https://roszdravnadzor.gov.ru">Росздравнадзор</A>
        </li>
        <li>
          <b>Яндекс Директ.</b> После запуска (когда объявления ушли на модерацию) отправьте копию через форму в справке Директа — укажите номер кампании, он есть в разделе «Реклама».
          {" "}<A href="https://yandex.ru/support/direct/ru/moderation/categories/medicine-medical-activity">Требования и форма отправки документов</A>
        </li>
        <li>
          <b>VK Реклама.</b> Если модерация попросит документы, в кабинете у объявления появится причина отклонения и кнопка загрузки документов — приложите ту же лицензию. Вопросы — в поддержку VK Рекламы.
          {" "}<A href="https://ads.vk.ru/hq/dashboard">Кабинет VK Рекламы</A>
        </li>
        <li>Предупреждение «Есть противопоказания. Посоветуйтесь с врачом» Директ добавит к тексту сам, на картинки мы его уже поставили.</li>
      </ol>
    </div>
  );
}
