# Передача проекта

Что есть у проекта, где оно лежит, кому какие доступы передать и что новому владельцу сменить. Секретов в этом файле нет — только где их взять и как поменять.

> **Два сценария.**
> 1. **Развернуть свою копию с нуля** (из GitHub, без текущих данных) — ничего из этого файла не нужно: по [README → 2.1](../README.md#21-yandex-cloud-вм-так-работает-прод) человек создаёт свой Yandex Cloud, свои OAuth-приложения, свою заявку на API Директа и свой Lockbox; `APP_SECRET`, `CRON_SECRET` и пароль базы его ВМ сгенерирует сама. Наши ключи ему не нужны и не подойдут.
> 2. **Принять работающий сервис с клиентами** (эту ВМ или её бэкап) — нужно всё ниже, и главное — прежний `APP_SECRET`: им зашифрованы токены рекламных кабинетов в базе. Без него база откроется, но все кабинеты придётся подключать заново.

## Где что работает

```
Пользователь ──► https://81-26-176-249.sslip.io ──► ВМ polny-zal (Yandex Cloud, ru-central1-d)
                                                     ├─ Caddy (HTTPS, Let's Encrypt)
                                                     ├─ Docker: polny-zal (Next.js)  ──► Яндекс Директ, Метрика, VK Реклама, YandexGPT/ART, Wordstat
                                                     ├─ Docker: polny-zal-db (PostgreSQL 17, данные в /opt/polny-zal/pgdata)
                                                     └─ таймеры: deploy (5 мин) · cron (час) · backup (ночь) ──► бакет Object Storage

Старые ссылки ──► https://polny-zal.vercel.app ──► Vercel: только vercel.json (прокси /p/*, заявки, трекер; остальное — 308 на ВМ)
```

## Опись ресурсов

| Что | Где | Идентификатор | Комментарий |
|---|---|---|---|
| Код | GitHub | `nikitabannykh/12`, ветка `master` | ВМ собирает каждый новый коммит `master` сама |
| Облако | Yandex Cloud | облако `b1gkehf0btn99le0c79i`, каталог `b1g41fmd662na9uokrpi` | платёжный аккаунт — карта владельца, оплата по факту |
| ВМ | Compute Cloud | `polny-zal` (`fv4034b4gk7fnvv0e6eh`), зона `ru-central1-d` | 2 vCPU 20 %, 4 ГБ, HDD 20 ГБ, статический IP `81.26.176.249`, ≈ 2 000 ₽/мес |
| Сервисный аккаунт | IAM | `polny-zal-vm` | роли: `lockbox.payloadViewer`, `storage.uploader`, `ai.languageModels.user`, `ai.imageGeneration.user`, `search-api.webSearch.user` |
| Секреты | Lockbox | `polny-zal` (`e6qo3qbr2rannqfqicsj`) | ключи: `YANDEX_CLIENT_SECRET`, `YANDEX_LOGIN_CLIENT_SECRET`, `NEON_DATABASE_URL`. В каталоге есть ещё 3 пустых секрета от настройки — их можно удалить |
| Бэкапы | Object Storage | бакет `polny-zal-backups-b1g41f` | `polnyzal-YYYYMMDD-HHMM.sql.gz`, ночью |
| Несекретные настройки | метаданные ВМ, ключ `app-env` | — | `YANDEX_CLIENT_ID`, `YANDEX_LOGIN_CLIENT_ID`, `YANDEX_CLOUD_FOLDER_ID` |
| Ключи, созданные на ВМ | `/opt/polny-zal/local.env`, `db.env` | — | `APP_SECRET`, `CRON_SECRET`, пароль базы. **Есть только на ВМ** — сохраните копию в надёжном месте (без `APP_SECRET` токены кабинетов из бэкапа не расшифровать) |
| OAuth Директ + Метрика | oauth.yandex.ru | приложение «Полный зал», ClientID `3bd78aab2df84693bd715a06dc4f5fb9` | Redirect URI: `https://81-26-176-249.sslip.io/api/connect/yandex/callback` (и старый на vercel.app). Заявка на доступ к API Директа одобрена на этот ClientID — **приложение не пересоздавать** |
| OAuth «Войти через Яндекс» | oauth.yandex.ru | приложение «Самоход», ClientID `bbf9a15844154d29ad8b9d6bf3b85e9b` | Redirect URI: `…/api/auth/yandex/callback` |
| Старый адрес | Vercel | проект `polny-zal` (команда `nikitabannyhnikita-3181`) | сейчас там только прокси из [`deploy/vercel-proxy`](../deploy/vercel-proxy) |
| Старая база | Neon (через Vercel → Storage) | `neon-chestnut-car` | данные уже перенесены; см. «Что удалить после переезда» |

## Как передать доступы

Лучше добавить нового владельца, а не передавать свои логины:

1. **GitHub:** Settings → Collaborators → добавить (или Transfer repository). После передачи — поменять адрес репозитория в `/opt/polny-zal/app` на ВМ (`git remote set-url origin …`) и в [`cloud-init.yaml`](../deploy/vm/cloud-init.yaml).
2. **Yandex Cloud:** облако → Права доступа → добавить аккаунт с ролью `admin` (или `editor` на каталог). Платёжный аккаунт переоформляется в Yandex Billing.
3. **OAuth-приложения Яндекса** привязаны к аккаунту, на котором созданы. Передача владения — через поддержку Яндекс ID. Создавать новое приложение Директа нельзя без новой заявки на доступ к API.
4. **Vercel и Neon:** пригласить в команду или удалить после переезда (ниже).

## Что новому владельцу сменить

| Секрет | Как сменить | Что будет с работающим сервисом |
|---|---|---|
| `YANDEX_CLIENT_SECRET` | oauth.yandex.ru → «Полный зал» → сбросить секрет → новая версия секрета Lockbox с новым значением | ВМ подхватит за ≤ 5 минут. Токены уже подключённых кабинетов продолжают работать; если какой-то кабинет станет «ошибка доступа» — владелец переподключает его в «Настройках» |
| `YANDEX_LOGIN_CLIENT_SECRET` | то же для «Самоход» | только кнопка «Войти через Яндекс» |
| Доступ в Yandex Cloud, GitHub, Vercel | убрать прежних владельцев из прав доступа | — |
| `APP_SECRET`, `CRON_SECRET` | **не менять без нужды.** `APP_SECRET` шифрует токены кабинетов — после смены все кабинеты придётся переподключить. `CRON_SECRET` используется только на самой ВМ | — |

Новая версия секрета Lockbox: консоль → Lockbox → `polny-zal` → «Добавить версию» → у нужного ключа нажать карандаш, вставить значение → «Добавить версию». Остальные ключи в форме не трогать: они переносятся в новую версию как есть.

## Что удалить после переезда

- **GitHub Actions `optimizer` и `backup`** — уже отключены. Секреты Actions (`APP_URL`, `CRON_SECRET`, `DATABASE_URL`, `BACKUP_PASSPHRASE`) можно удалить.
- **База Neon** — через 3 суток после переезда (столько ВМ догружает заявки со старой базы, таймер `polny-zal-delta`): Vercel → Storage → `neon-chestnut-car` → Settings → Delete.
- **`NEON_DATABASE_URL` в Lockbox — не удалять сразу.** Из этой строки выводится прежний ключ, которым зашифрованы перенесённые токены и подписаны сессии. Токены робот перешифровывает новым ключом сам (каждый проход), а сессии со старым ключом живут до 30 дней. Через 30 дней после переезда строку можно убрать. Если базу Neon удалили раньше — строку всё равно оставьте: важна сама строка, а не база.
- **Прокси на Vercel** — когда ни в объявлениях, ни на сайтах клиентов не останется ссылок на `polny-zal.vercel.app` (см. ниже).
- **Лишние пустые секреты Lockbox** и старые Redirect URI с `vercel.app` в OAuth-приложениях — после отключения прокси.

## Что осталось сделать

- **Ссылки в уже запущенных объявлениях** ведут на `polny-zal.vercel.app/p/…`. Прокси их обслуживает, но адреса Vercel из части российских сетей открываются нестабильно, и заявки проходят через Vercel. Перевести их на новый адрес — смена ссылки в объявлениях (отправляет объявления на повторную модерацию). Механизм уже есть: `applyLanding` в [`src/lib/engine/landingApply.ts`](../src/lib/engine/landingApply.ts).
- **Свой домен** вместо `*.sslip.io`: A-запись на `81.26.176.249`, `APP_URL=https://домен` в `app-env` метаданных ВМ, Redirect URI в OAuth-приложениях, `sudo systemctl start polny-zal-deploy` (Caddy выпустит сертификат сам).
- **VK Реклама по OAuth** (Authorization Code Grant) не получена — подключение VK только по ключам API владельца ([README → VK Реклама](../README.md#vk-реклама--vk_ads_client_id-vk_ads_client_secret)).
- **Почта и Telegram** на проде не настроены (`SMTP_URL`, `TELEGRAM_BOT_TOKEN` — в Lockbox, когда понадобятся).

## Чек-лист приёмки

- [ ] `https://81-26-176-249.sslip.io/api/health` → `{"ok":true}`; с ключом (`?key=<CRON_SECRET>` из `/opt/polny-zal/local.env`) — `db.ok`, свежий `cron.at`, `failed: 0`.
- [ ] `curl -sI https://polny-zal.vercel.app/login` → `308` на новый адрес; `/api/health` там же → `x-served-by: yc-vm`.
- [ ] Вход через Яндекс работает, проекты на месте, кабинеты «Подключён».
- [ ] Cloud Shell на ВМ: `systemctl list-timers 'polny-zal*'` — 4 таймера; `journalctl -u polny-zal-cron -n 5` — `cron: HTTP 200`.
- [ ] В бакете есть вчерашний бэкап.
- [ ] Копия `/opt/polny-zal/local.env` сохранена вне ВМ.
- [ ] Права прежних владельцев в Yandex Cloud, GitHub, Vercel убраны; client secret'ы приложений Яндекса сменены.
