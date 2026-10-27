# Развёртывание в России: Yandex Cloud

Инструкция для тех, кому нужно хранить данные в РФ (152-ФЗ): приложение и база — в Yandex Cloud, регион `ru-central1`.
Код менять не нужно: сервис работает с любым PostgreSQL по `DATABASE_URL`, а для проверки сертификата Yandex Managed PostgreSQL есть переменная `PG_CA_CERT`.

> **Что проверено.** Образ из `Dockerfile` собран и прогнан с демо-сценарием на PostgreSQL 17 с TLS: сертификат своего центра через `PG_CA_CERT` и `sslmode=verify-full` принимается, чужой центр и несовпадающее имя хоста — отклоняются. Сам деплой в Yandex Cloud (команды `yc` ниже) по этой инструкции ещё не прогонялся — сверяйте флаги с `--help`.

- [Что хранится и где](#что-хранится-и-где)
- [Вариант А. Managed PostgreSQL + Serverless Containers](#вариант-а-managed-postgresql--serverless-containers) — без серверов, платите за запросы
- [Вариант Б. Managed PostgreSQL + виртуальная машина](#вариант-б-managed-postgresql--виртуальная-машина) — Node.js или Docker на своей ВМ
- [Расписание робота](#расписание-робота)
- [Переменные окружения](#переменные-окружения)
- [Перенос данных с Neon / Vercel](#перенос-данных-с-neon--vercel)
- [Что ещё учесть по 152-ФЗ](#что-ещё-учесть-по-152-фз)

---

## Что хранится и где

Всё постоянное лежит в одной базе PostgreSQL — файлов на диске сервис не хранит:

| Данные | Таблица | Персональные данные |
|---|---|---|
| Заявки со страницы записи и с сайта: имя, телефон или мессенджер | `leads` | да, клиенты бизнеса |
| Владельцы: email, имя (вход через Google) | `users` | да |
| Токены рекламных кабинетов | `ad_accounts` | зашифрованы `APP_SECRET` |
| Фото владельца и рекламные картинки | `images` (`bytea`) | обычно нет |
| Статистика, решения робота, история | остальные таблицы | нет |

Поэтому для локализации достаточно перенести **базу и само приложение** (запросы с телефонами проходят через сервер приложения). Контакты старше 3 лет обезличиваются автоматически при запуске робота по расписанию.

---

## Подготовка

1. Аккаунт в [Yandex Cloud](https://console.yandex.cloud), платёжный аккаунт, каталог (folder).
2. CLI: `curl -sSL https://storage.yandexcloud.net/yandexcloud-yc/install.sh | bash`, затем `yc init` (выберите каталог и зону `ru-central1-a`).
3. Запомните ID каталога и сети:
   ```bash
   yc config get folder-id
   yc vpc network list          # обычно есть сеть default и подсети default-ru-central1-a/b/d
   ```

---

## Вариант А. Managed PostgreSQL + Serverless Containers

### А1. База: Managed Service for PostgreSQL

**Через консоль:** Managed Service for PostgreSQL → **Создать кластер**:
- Окружение `PRODUCTION`, версия PostgreSQL 16 или 17.
- Класс хоста — самый маленький (`s2.micro` или burstable `b2.medium`), диск `network-ssd` 10 ГБ. Картинки лежат в базе — закладывайте ~1 ГБ на десяток клиентов.
- Сеть `default`, один хост в `ru-central1-a`, **публичный доступ — выключен** (контейнер подключится через сеть).
- База `polnyzal`, пользователь `polnyzal` с паролем.

**Или CLI** (проверьте флаги в `yc managed-postgresql cluster create --help`):
```bash
yc managed-postgresql cluster create \
  --name polny-zal-db \
  --environment production \
  --network-name default \
  --host zone-id=ru-central1-a,subnet-name=default-ru-central1-a,assign-public-ip=false \
  --resource-preset s2.micro \
  --disk-type network-ssd --disk-size 10 \
  --postgresql-version 16 \
  --user name=polnyzal,password='<пароль>' \
  --database name=polnyzal,owner=polnyzal
```

**Строка подключения** (порт 6432 — встроенный пулер Odyssey; сервис работает без prepared statements, поэтому пулер ему подходит):
```
postgresql://polnyzal:<пароль>@c-<ID кластера>.rw.mdb.yandexcloud.net:6432/polnyzal?sslmode=verify-full
```
- `c-<ID кластера>.rw.mdb.yandexcloud.net` — особый адрес, который всегда указывает на текущий мастер. ID кластера — `yc managed-postgresql cluster list`.
- Спецсимволы в пароле закодируйте (`@` → `%40`, `#` → `%23`, `/` → `%2F`).

**Сертификат.** Yandex Managed PostgreSQL принимает только TLS. Сертификат его центра:
```bash
curl -fsSL https://storage.yandexcloud.net/cloud-certs/CA.pem -o yandex-ca.pem
base64 -w0 yandex-ca.pem > yandex-ca.b64     # на macOS: base64 -i yandex-ca.pem
```
Сервис берёт его из `PG_CA_CERT` и проверяет и сертификат, и имя хоста (как `sslmode=verify-full`). `PG_CA_CERT` принимает:
- PEM в base64 (одна строка — удобно для переменных и Lockbox);
- PEM-текст целиком (переводы строк можно записать как `\n`);
- путь к файлу `.pem`.

Без `PG_CA_CERT` и без `sslmode` в строке сервис шифрует соединение, но сертификат не проверяет (так работают Neon и Supabase). С `sslmode=verify-ca` проверяется только сертификат, без имени хоста.

> Группы безопасности: если они включены в сети, разрешите входящий TCP 6432 к кластеру из подсетей `default`.

### А2. Реестр и образ

В корне репозитория есть `Dockerfile` (Node 22: `npm ci` → `next build` → `next start`, порт из `PORT`, по умолчанию 8080) и `.dockerignore`.

```bash
yc container registry create --name polny-zal
yc container registry configure-docker
REG=$(yc container registry get --name polny-zal --format json | jq -r .id)

docker build --platform linux/amd64 -t cr.yandex/$REG/polny-zal:1 .
docker push cr.yandex/$REG/polny-zal:1
```
- `--platform linux/amd64` обязателен при сборке на Mac с Apple Silicon.
- Если Docker Hub недоступен или упирается в лимит скачиваний, возьмите базовый образ из зеркала: `--build-arg NODE_IMAGE=mirror.gcr.io/library/node:22-bookworm-slim`.
- Переменные окружения при сборке не нужны — образ один для всех окружений.

### А3. Сервисный аккаунт и секреты

```bash
FOLDER=$(yc config get folder-id)
yc iam service-account create --name polny-zal-sa
SA=$(yc iam service-account get --name polny-zal-sa --format json | jq -r .id)
yc resource-manager folder add-access-binding $FOLDER --role container-registry.images.puller --subject serviceAccount:$SA
yc resource-manager folder add-access-binding $FOLDER --role lockbox.payloadViewer --subject serviceAccount:$SA
```

Секреты — в Lockbox, а не в открытых переменных ревизии:
```bash
yc lockbox secret create --name polny-zal --payload "[
  {'key': 'APP_SECRET',   'text_value': '$(openssl rand -hex 32)'},
  {'key': 'CRON_SECRET',  'text_value': '$(openssl rand -hex 24)'},
  {'key': 'DATABASE_URL', 'text_value': 'postgresql://polnyzal:<пароль>@c-<ID>.rw.mdb.yandexcloud.net:6432/polnyzal?sslmode=verify-full'},
  {'key': 'PG_CA_CERT',   'text_value': '$(cat yandex-ca.b64)'}
]"
SECRET=$(yc lockbox secret get --name polny-zal --format json | jq -r .id)
```
Ключи площадок (`YANDEX_CLIENT_SECRET`, `VK_ADS_CLIENT_SECRET`, `TELEGRAM_BOT_TOKEN`, `YANDEX_CLOUD_API_KEY`, `GOOGLE_CLIENT_SECRET`) добавьте в тот же секрет новой версией: `yc lockbox secret add-version --name polny-zal --payload "[…]"` (в новой версии перечислите все ключи).

> **`APP_SECRET` переносите, а не создавайте заново**, если переезжаете с работающего сервиса: им зашифрованы токены кабинетов и подписаны сессии.

### А4. Контейнер

```bash
yc serverless container create --name polny-zal
yc serverless container allow-unauthenticated-invoke --name polny-zal
URL=$(yc serverless container get --name polny-zal --format json | jq -r .url | sed 's#/$##')
echo $URL      # https://<id>.containers.yandexcloud.net — это APP_URL
NET=$(yc vpc network get --name default --format json | jq -r .id)

yc serverless container revision deploy \
  --container-name polny-zal \
  --image cr.yandex/$REG/polny-zal:1 \
  --cores 1 --core-fraction 100 --memory 1GB \
  --concurrency 8 \
  --execution-timeout 300s \
  --service-account-id $SA \
  --network-id $NET \
  --environment APP_URL=$URL,ALLOW_DEMO=false,YANDEX_CLIENT_ID=<…>,VK_ADS_CLIENT_ID=<…>,YANDEX_CLOUD_FOLDER_ID=<…> \
  --secret environment-variable=APP_SECRET,id=$SECRET,key=APP_SECRET \
  --secret environment-variable=CRON_SECRET,id=$SECRET,key=CRON_SECRET \
  --secret environment-variable=DATABASE_URL,id=$SECRET,key=DATABASE_URL \
  --secret environment-variable=PG_CA_CERT,id=$SECRET,key=PG_CA_CERT
```
- `--network-id` подключает контейнер к сети кластера — без него база без публичного адреса недоступна. Если деплой ругается на права, выдайте своему пользователю роль `vpc.user` на каталог.
- `--execution-timeout 300s`: запуск рекламы и проход робота идут дольше значения по умолчанию (3 с).
- `--memory 1GB`: хватает на Next.js и рендер картинок; при 512 МБ рендер может падать.
- Холодный старт — 2–5 с. Чтобы его не было, добавьте `--min-instances 1` (платно, контейнер работает постоянно).
- Таблицы создаются сами при первом запросе.

**Проверка:**
```bash
curl -s -o /dev/null -w "%{http_code}\n" $URL/login                 # 200
curl -s -o /dev/null -w "%{http_code}\n" $URL/api/cron/run          # 401 — без ключа нельзя
yc serverless container revision list --container-name polny-zal
yc logging read --group-name default --resource-types serverless.container --since 10m   # логи
```

**Свой домен:** API Gateway с доменом и сертификатом из Certificate Manager, интеграция `serverless_containers` на этот контейнер. После смены адреса обновите `APP_URL` новой ревизией.

**Новая версия:** соберите образ с новым тегом, `docker push`, повторите `revision deploy` с тем же набором флагов.

---

## Вариант Б. Managed PostgreSQL + виртуальная машина

База — как в [А1](#а1-база-managed-service-for-postgresql). ВМ создайте в той же сети `default`, тогда публичный доступ к базе не нужен.

1. **ВМ:** Compute Cloud → Создать ВМ → Ubuntu 24.04 LTS, 2 vCPU (можно 50 %), 2 ГБ RAM, диск 20 ГБ, публичный IP, SSH-ключ.
2. **Node.js 22 и код:**
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt-get install -y nodejs git
   sudo useradd -r -m -d /opt/polny-zal polnyzal
   sudo -u polnyzal git clone <ваш репозиторий> /opt/polny-zal/app
   cd /opt/polny-zal/app && sudo -u polnyzal sh -c 'npm ci && npm run build'
   sudo curl -fsSL https://storage.yandexcloud.net/cloud-certs/CA.pem -o /opt/polny-zal/yandex-ca.pem
   ```
3. **Переменные** — `/etc/polny-zal.env` (`sudo chmod 600`):
   ```
   APP_URL=https://zal.example.ru
   APP_SECRET=…
   CRON_SECRET=…
   DATABASE_URL=postgresql://polnyzal:<пароль>@c-<ID>.rw.mdb.yandexcloud.net:6432/polnyzal?sslmode=verify-full
   PG_CA_CERT=/opt/polny-zal/yandex-ca.pem
   ALLOW_DEMO=false
   TRUSTED_IP_HEADER=x-real-ip
   # + ключи площадок, см. «Переменные окружения»
   ```
4. **Служба** — `/etc/systemd/system/polny-zal.service`:
   ```ini
   [Unit]
   Description=Polny Zal
   After=network-online.target

   [Service]
   User=polnyzal
   WorkingDirectory=/opt/polny-zal/app
   EnvironmentFile=/etc/polny-zal.env
   Environment=NODE_ENV=production
   ExecStart=/usr/bin/node node_modules/next/dist/bin/next start -p 8080 -H 127.0.0.1
   Restart=always

   [Install]
   WantedBy=multi-user.target
   ```
   ```bash
   sudo systemctl daemon-reload && sudo systemctl enable --now polny-zal
   ```
5. **HTTPS через Caddy** (сертификат Let's Encrypt выпустится сам; A-запись домена — на публичный IP ВМ):
   ```bash
   sudo apt-get install -y caddy
   sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
   zal.example.ru {
     reverse_proxy 127.0.0.1:8080 {
       header_up X-Real-IP {remote_host}
     }
   }
   EOF
   sudo systemctl reload caddy
   ```
   `TRUSTED_IP_HEADER=x-real-ip` включает лимиты по IP: Caddy сам ставит этот заголовок, клиент его подделать не может.
6. **Обновление:** `cd /opt/polny-zal/app && sudo -u polnyzal sh -c 'git pull && npm ci && npm run build' && sudo systemctl restart polny-zal`.

**Docker вместо Node.js на ВМ:** тот же образ из [А2](#а2-реестр-и-образ):
```bash
docker run -d --name polny-zal --restart unless-stopped -p 127.0.0.1:8080:8080 \
  --env-file /etc/polny-zal.env -e PG_CA_CERT=/ca.pem -v /opt/polny-zal/yandex-ca.pem:/ca.pem:ro \
  cr.yandex/<registry_id>/polny-zal:1
```

---

## Расписание робота

Робот запускается запросом `GET {APP_URL}/api/cron/run` с заголовком `Authorization: Bearer <CRON_SECRET>`. Достаточно раза в 1–2 часа.

- **ВМ:** `crontab -e` от любого пользователя:
  ```
  17 */2 * * * curl -fsS --max-time 290 -H "Authorization: Bearer <CRON_SECRET>" https://zal.example.ru/api/cron/run > /dev/null
  ```
- **GitHub Actions** — уже настроено в [`.github/workflows/optimizer.yml`](../.github/workflows/optimizer.yml): секреты `APP_URL` и `CRON_SECRET` в репозитории.
- **Внутри Yandex Cloud** — функция с таймером. Триггер сам не умеет добавлять заголовок с `CRON_SECRET`, поэтому между ними маленькая функция:
  ```bash
  mkdir cron && cat > cron/index.js <<'EOF'
  module.exports.handler = async () => {
    const r = await fetch(`${process.env.APP_URL}/api/cron/run`, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
    return { statusCode: r.status, body: (await r.text()).slice(0, 2000) };
  };
  EOF
  yc serverless function create --name polny-zal-cron
  yc serverless function version create --function-name polny-zal-cron \
    --runtime nodejs22 --entrypoint index.handler --memory 128m --execution-timeout 300s \
    --source-path ./cron --service-account-id $SA \
    --environment APP_URL=$URL \
    --secret environment-variable=CRON_SECRET,id=$SECRET,key=CRON_SECRET
  yc resource-manager folder add-access-binding $FOLDER --role functions.functionInvoker --subject serviceAccount:$SA
  yc serverless trigger create timer --name polny-zal-cron \
    --cron-expression '17 */2 ? * * *' \
    --invoke-function-name polny-zal-cron --invoke-function-service-account-id $SA
  ```
  Доступные версии Node.js: `yc serverless function runtime list`. Cron в Yandex Cloud — 6 полей: минуты, часы, день месяца, месяц, день недели, год.

---

## Переменные окружения

Полный список с пояснениями — в [`.env.example`](../.env.example). Для Yandex Cloud:

| Переменная | Обязательна | Значение |
|---|---|---|
| `APP_URL` | да | Публичный адрес без `/` в конце: `https://<id>.containers.yandexcloud.net` или свой домен |
| `APP_SECRET` | да | `openssl rand -hex 32`; при переезде — прежнее значение |
| `CRON_SECRET` | да | `openssl rand -hex 24` |
| `DATABASE_URL` | да | `postgresql://…@c-<ID>.rw.mdb.yandexcloud.net:6432/polnyzal?sslmode=verify-full` |
| `PG_CA_CERT` | для Yandex MDB | Сертификат `CA.pem`: base64, PEM-текст или путь к файлу |
| `PG_POOL_MAX` | нет | Соединений к базе на один экземпляр, по умолчанию 5. Для Serverless Containers × `concurrency` экземпляров держите сумму ниже лимита соединений кластера |
| `ALLOW_DEMO` | нет | `false` в продакшене, если демо-вход не нужен |
| `TRUSTED_IP_HEADER` | нет | `x-real-ip` за своим прокси (Caddy, nginx). В Serverless Containers не задавайте, пока не проверите, какой заголовок с IP клиента ставит платформа: без него лимиты по IP не применяются, защита формы токеном и пометка «похоже на спам» работают |
| `YANDEX_CLIENT_ID`, `YANDEX_CLIENT_SECRET` | для Директа | Redirect URI в oauth.yandex.ru: `{APP_URL}/api/connect/yandex/callback` |
| `VK_ADS_CLIENT_ID`, `VK_ADS_CLIENT_SECRET` | для VK | Redirect URI: `{APP_URL}/api/connect/vk/callback` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | для входа | Redirect URI: `{APP_URL}/api/auth/google/callback` |
| `YANDEX_CLOUD_API_KEY`, `YANDEX_CLOUD_FOLDER_ID` | для генерации | YandexGPT и YandexART — тот же Yandex Cloud |
| `TELEGRAM_BOT_TOKEN` | нет | Вебхук `{APP_URL}/api/notify/telegram` ставится сам при https-адресе |

`PGLITE_DIR` в образе указывает на `/tmp/pglite` — это только для пробного запуска без `DATABASE_URL`: данные пропадут при перезапуске.

---

## Перенос данных с Neon / Vercel

1. Остановите расписание робота (GitHub Actions → Disable workflow; в Vercel уберите `crons` из `vercel.json` или удалите `CRON_SECRET`).
2. Выгрузите и загрузите базу (нужен `postgresql-client` той же или более новой версии):
   ```bash
   pg_dump --no-owner --no-acl -Fc "<строка Neon>" -f polnyzal.dump
   pg_restore --no-owner --no-acl \
     -d "postgresql://polnyzal:<пароль>@c-<ID>.rw.mdb.yandexcloud.net:6432/polnyzal?sslmode=verify-full&sslrootcert=yandex-ca.pem" \
     polnyzal.dump
   ```
   Без публичного доступа к кластеру выполняйте `pg_restore` с ВМ в той же сети (или временно включите публичный доступ хосту).
3. Задайте **тот же `APP_SECRET`**, что был на Vercel, — иначе токены кабинетов не расшифруются, и кабинеты придётся подключать заново.
4. Обновите redirect URI в кабинетах OAuth (Яндекс, VK, Google) на новый `APP_URL`. Telegram-вебхук переставится сам при первом запросе к сервису.
5. На сайтах клиентов, где стоит трекер `{APP_URL}/t.js`, и в ссылках на страницы записи `{APP_URL}/p/…` адрес меняется — при переезде на новый домен оставьте редирект со старого (Vercel → Settings → Domains → Redirect) или сразу используйте свой домен, который потом не меняется.
6. Включите расписание в Yandex Cloud и проверьте «Историю» после первого прохода.

---

## Что ещё учесть по 152-ФЗ

Это не юридическая консультация — список мест, где данные уходят за пределы базы в РФ:

- **Telegram-уведомления.** Имя и телефон из заявки отправляются владельцу через Telegram — это передача на серверы за рубежом. Если это недопустимо, не задавайте `TELEGRAM_BOT_TOKEN` (заявки останутся в «Статистике»).
- **Вход через Google.** Email владельца проходит через Google. Альтернатива — только демо-вход или свой способ входа.
- **Хостинг на Vercel** при базе в РФ: запросы с телефонами всё равно проходят через серверы Vercel. Для локализации переносите и приложение (варианты А и Б), а не только базу.
- **Яндекс Директ, Метрика, YandexGPT/ART, VK Реклама** — российские сервисы. В Метрику уходят только идентификаторы посетителя (ClientID, yclid) и отметка «Записался», без имён и телефонов.
- Владелец бизнеса — оператор персональных данных своих клиентов; политика обработки для страницы записи — `/privacy`. Уведомление Роскомнадзора об обработке ПДн подаёт оператор.
