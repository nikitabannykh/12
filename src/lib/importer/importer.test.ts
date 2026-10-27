/**
 * Тесты разборщиков автозаполнения на сохранённых страницах (__fixtures__).
 * Запуск: npm run test:importer  (tsx --test, без сети).
 * Фикстуры Яндекс Карт, 2ГИС и DIKIDI — урезанные настоящие ответы с заменёнными названиями, телефонами и отзывами.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseSite, nextPages } from "./sources/site";
import { parseYandexHtml, isYandexCaptcha, yandexFromUrl, yandexPartial } from "./sources/yandex";
import { parseDgisHtml, dgisFromUrl } from "./sources/dgis";
import { dikidiId, dikidiServices, parseDikidiHtml } from "./sources/dikidi";
import { parseTaplinkHtml, isVkWall } from "./sources/social";
import { mergeFound, missingOf } from "./merge";
import {
  cityFromAddress, detectNiche, formatPhone, formatWeek, hoursFromSchema, normalizePrice, pricesFromText, servicesFromJson, telegramFrom, whatsappFrom,
} from "./normalize";
import { checkUrl, decodeText, FetchError, isPrivateIp, safeFetch, safeLookup } from "./fetch";
import { parseWeekHours } from "../engine/extras";
import type { Found } from "./types";

const fx = (name: string) => readFileSync(path.join(__dirname, "__fixtures__", name));
const html = (name: string) => fx(name).toString("utf8");

test("JSON-LD салона: адрес, часы, услуги с ценами, рейтинг, отзыв, фото, мессенджеры", () => {
  const f = parseSite(html("salon-jsonld.html"), "https://lak-studio.example/");
  assert.equal(f.name, "Студия «Лак»");
  assert.equal(f.city, "Казань");
  assert.equal(f.address, "ул. Баумана, 15");
  assert.equal(f.phone, "+7 843 200-10-20");
  assert.equal(f.whatsapp, "+7 900 111-22-33");
  assert.equal(f.telegram, "@lak_studio");
  assert.equal(f.hours, "Пн–Пт 10:00–21:00, Сб–Вс 11:00–19:00");
  assert.deepEqual(parseWeekHours(f.hours)?.[0], { open: 10, close: 21 }); // формат понимает расписание показов
  assert.equal(f.servicesStructured, true);
  assert.deepEqual(f.services, [
    { name: "Маникюр с покрытием гель-лаком", price: "1 900 ₽" },
    { name: "Снятие и укрепление", price: "от 700 ₽" },
    { name: "Педикюр", price: "2 200–2 800 ₽" },
    { name: "Архитектура бровей", price: "1 200 ₽" },
  ]);
  assert.deepEqual(f.rating, { value: 4.9, count: 87 });
  assert.match(f.review ?? "", /второй год/);
  assert.ok(f.photos?.includes("https://lak-studio.example/img/hall.jpg"));
  assert.ok(f.photos?.includes("https://lak-studio.example/img/works-2.jpg"));
  assert.ok(!f.photos?.some((p) => /icon|logo/.test(p)), "иконки и логотип — не фото");
  assert.deepEqual(f.next, ["https://lak-studio.example/uslugi/", "https://lak-studio.example/kontakty"]);
  assert.ok(f.links?.some((l) => l.includes("yandex.ru/maps/org/lak/1234567890")));
  assert.ok(f.links?.some((l) => l.includes("dikidi.net/123456")));
  assert.equal(detectNiche({ categories: f.categories, name: f.name, services: f.services?.map((s) => s.name), text: f.text }), "nails");
});

test("Прайс в тексте страницы (таблица, точки-заполнители, цена отдельной строкой), windows-1251", () => {
  const page = decodeText({ body: fx("price-page-cp1251.html"), contentType: "text/html" });
  assert.match(page, /Барбершоп Борода/);
  const f = parseSite(page, "https://boroda.example/");
  const names = f.services?.map((s) => `${s.name}: ${s.price}`);
  assert.deepEqual(names, [
    "Тонирование бороды: 1 000 ₽", // карточка конструктора: название из .t-name, а не строка описания над ценой
    "Мужская стрижка: 1 500 ₽",
    "Стрижка + борода: 2 300 ₽",
    "Детская стрижка (до 12 лет): от 900 ₽",
    "Королевское бритьё: 1 800 ₽",
    "Камуфляж седины: 1 200–1 500 ₽",
  ]);
  assert.equal(f.servicesStructured, false);
  assert.equal(f.phone, "+7 846 300-40-50");
  assert.equal(f.whatsapp, "+7 927 000-00-00");
  assert.equal(f.name, "Барбершоп Борода");
  assert.deepEqual(nextPages(page, "https://boroda.example/"), ["https://boroda.example/price", "https://boroda.example/contacts"]);
  assert.equal(detectNiche({ name: f.name, services: f.services?.map((s) => s.name) }), "barber");
});

test("JSON вида YCLIENTS: услуги с диапазоном цен, без нулевых", () => {
  const s = servicesFromJson(JSON.parse(html("yclients-like.json")));
  assert.deepEqual(s, [
    { name: "Женская стрижка", price: "2 000–3 500 ₽" },
    { name: "Окрашивание в один тон", price: "4 500 ₽" },
    { name: "Укладка", price: "1 200 ₽" },
  ]);
});

test("Яндекс Карты: состояние страницы карточки", () => {
  const url = "https://yandex.ru/maps/org/manicure_workshop/229519022741/prices/?lang=ru";
  const f = parseYandexHtml(html("yandex-org.html"), url);
  assert.ok(f);
  assert.equal(f.name, "Студия Тестовая");
  assert.equal(f.city, "Пушкино");
  assert.equal(f.address, "территория 33-й километр автодороги М-8 Холмогоры, 18");
  assert.equal(f.phone, "+7 900 000-00-01");
  assert.equal(f.whatsapp, "+7 900 000-00-02");
  assert.equal(f.telegram, "@test_studio");
  assert.equal(f.hours, "Ежедневно 10:00–22:00");
  assert.equal(f.orgUrl, "https://yandex.ru/maps/org/manicure_workshop/229519022741/");
  assert.equal(f.siteUrl, "https://test-studio.example/");
  assert.ok((f.services?.length ?? 0) >= 10, `услуг ${f.services?.length}`);
  assert.ok(f.services?.every((s) => s.price && /₽$/.test(s.price)));
  assert.deepEqual(f.services?.[0], { name: "Окрашивание бровей (краской)", price: "700 ₽" });
  assert.deepEqual(f.rating, { value: 5, count: 150 });
  assert.match(f.review ?? "", /второй год/);
  assert.deepEqual(f.photos?.[0], "https://avatars.mds.yandex.net/get-altay/1/test-0/XXXL");
  assert.ok(f.advantages?.includes("Подарочные сертификаты"));
  assert.ok(!f.advantages?.some((a) => /наращивание/i.test(a)), "услуги — не преимущества");
  assert.ok(f.links?.includes("https://dikidi.ru/491109"));
  assert.equal(detectNiche({ categories: f.categories, name: f.name }), "nails");
});

test("Яндекс Карты: капча и частичный результат из ссылки", () => {
  assert.equal(isYandexCaptcha(html("yandex-captcha.html"), "https://yandex.ru/showcaptcha?retpath=x"), true);
  assert.equal(isYandexCaptcha(html("yandex-org.html"), "https://yandex.ru/maps/org/x/1/"), false);
  assert.deepEqual(yandexFromUrl("https://yandex.ru/maps/213/moscow/org/studiya_lak/1234567890/?ll=37.6"), { orgId: "1234567890", slug: "studiya_lak", city: "Москва" });
  const p = yandexPartial("https://yandex.ru/maps/213/moscow/org/studiya_lak/1234567890/", "blocked", "x");
  assert.equal(p.orgUrl, "https://yandex.ru/maps/org/studiya_lak/1234567890/");
  assert.equal(p.city, "Москва");
  assert.equal(p.name, "Studiya lak");
});

test("2ГИС: начальное состояние страницы фирмы", () => {
  const url = "https://2gis.ru/moscow/firm/70000001037334896";
  assert.deepEqual(dgisFromUrl(url), { firmId: "70000001037334896", city: "Москва" });
  const f = parseDgisHtml(html("dgis-firm.html"), url);
  assert.ok(f);
  assert.equal(f.name, "Тестовая");
  assert.equal(f.city, "Москва");
  assert.equal(f.address, "Лубянский проезд, 5 ст1");
  assert.equal(f.phone, "+7 900 000-00-03");
  assert.equal(f.whatsapp, "+7 900 000-00-04");
  assert.equal(f.telegram, "@test_lab");
  assert.equal(f.siteUrl, "http://test-lab.example/lubyanka");
  assert.equal(f.hours, "Ежедневно 10:00–22:00");
  assert.deepEqual(f.rating, { value: 5, count: 294 });
  assert.ok(f.categories?.includes("Парикмахерские услуги"));
  assert.equal(detectNiche({ categories: f.categories, name: f.name }), "hair");
});

test("DIKIDI: id из ссылок, прайс виджета, страница записи", () => {
  assert.equal(dikidiId("https://dikidi.net/491109"), "491109");
  assert.equal(dikidiId("https://dikidi.app/profile/delina_beauty_studio_1647610/"), "1647610");
  assert.equal(dikidiId("https://dikidi.ru/ru/record/?p=0.pi&o=2048412"), "2048412");
  const { services, categories } = dikidiServices(JSON.parse(html("dikidi-services.json")));
  assert.equal(services[0].name, "Маникюр+укрепление гелем");
  assert.equal(services[0].price, "3 000 ₽");
  assert.ok(services.length >= 6);
  assert.ok(categories.includes("Маникюр"));
  const info = parseDikidiHtml(html("dikidi-page.html"));
  assert.equal(info.name, "Ногти у Марины");
  assert.equal(info.city, "Москва");
  assert.equal(info.address, "Бескудниковский бульвар 30 к3");
  assert.deepEqual(info.photos, ["https://f1.dikidi.ru/c7/v1/test.jpg"]);
});

test("Taplink: блоки страницы, прайс, мессенджеры, ссылки на карты и запись", () => {
  const f = parseTaplinkHtml(html("taplink.html"), "https://taplink.cc/browlab_kzn");
  assert.equal(f.name, "Brow Lab — брови и ресницы");
  assert.deepEqual(f.services, [
    { name: "Ламинирование ресниц", price: "2 000 ₽" },
    { name: "Архитектура бровей", price: "1 200 ₽" },
    { name: "Окрашивание бровей хной", price: "от 900 ₽" },
  ]);
  assert.equal(f.whatsapp, "+7 917 000-00-01");
  assert.equal(f.telegram, "@browlab_kzn");
  assert.equal(f.phone, "+7 917 000-00-01");
  assert.ok(f.links?.includes("https://yandex.ru/maps/org/brow_lab/9876543210/"));
  assert.ok(f.links?.includes("https://dikidi.net/777001"));
  assert.match(f.description ?? "", /Студия бровей/);
  assert.equal(detectNiche({ name: f.name, services: f.services?.map((s) => s.name) }), "brows");
});

test("VK: заглушка для роботов распознаётся", () => {
  assert.equal(isVkWall(html("vk-challenge.html"), "https://vk.com/challenge.html?x=1"), true);
});

test("Склейка: адрес и часы с карт, услуги с сайта, недостающие поля", () => {
  const site: Found = { kind: "site", url: "https://a.example", status: "ok", name: "Лак", address: "Баумана 15", phone: "+7 843 000-00-00", services: [{ name: "Маникюр", price: "1 900 ₽" }, { name: "Педикюр", price: "2 500 ₽" }], servicesStructured: true, description: "Студия маникюра в центре", photos: ["https://a.example/1.jpg"] };
  const maps: Found = { kind: "yandex", url: "https://yandex.ru/maps/org/lak/1/", status: "ok", name: "Студия Лак", city: "Казань", address: "ул. Баумана, 15", hours: "Ежедневно 10:00–21:00", phone: "+7 843 111-11-11", rating: { value: 4.9, count: 120 }, services: [{ name: "Маникюр с покрытием", price: "2 000 ₽" }], servicesStructured: true, categories: ["Ногтевая студия"], orgUrl: "https://yandex.ru/maps/org/lak/1/", photos: ["https://y.example/2.jpg"] };
  const d = mergeFound([site, maps]);
  assert.equal(d.name, "Студия Лак");
  assert.equal(d.sources.name, "из Яндекс Карт");
  assert.equal(d.address, "ул. Баумана, 15");
  assert.equal(d.hours, "Ежедневно 10:00–21:00");
  assert.equal(d.phone, "+7 843 111-11-11");
  assert.equal(d.services.length, 2);
  assert.equal(d.sources.services, "с сайта");
  assert.equal(d.description, "Студия маникюра в центре");
  assert.equal(d.niche, "nails");
  assert.deepEqual(d.photos, ["https://a.example/1.jpg", "https://y.example/2.jpg"]);
  assert.equal(d.advantages[0], "Рейтинг 4,9 на Яндекс Картах");
  assert.deepEqual(d.missing, []);
  assert.deepEqual(missingOf({ ...d, city: "", phone: "", whatsapp: "", telegram: "", services: [] }), ["city", "contact", "services"]);
  // Частичная карточка (капча): название из «слага» подписано как «из ссылки — проверьте»
  const blocked = mergeFound([{ kind: "yandex", url: "u", status: "blocked", name: "Studiya lak", orgUrl: "https://yandex.ru/maps/org/studiya_lak/1/" }]);
  assert.equal(blocked.sources.name, "из ссылки — проверьте");
  assert.ok(blocked.missing.includes("services"));
});

test("Нормализация: телефоны, мессенджеры, цены, часы, город", () => {
  assert.equal(formatPhone("8(900)1234567"), "+7 900 123-45-67");
  assert.equal(whatsappFrom("https://api.whatsapp.com/send?phone=79001234567&text=hi"), "+7 900 123-45-67");
  assert.equal(telegramFrom("https://t.me/share/url?url=x"), "");
  assert.equal(telegramFrom("https://t.me/+79001234567"), "+7 900 123-45-67");
  assert.equal(normalizePrice("от 1500 руб."), "от 1 500 ₽");
  assert.equal(normalizePrice("12"), "");
  assert.equal(hoursFromSchema(["Mo-Fr 09:00-20:00", "Sa 10:00-18:00"]), "Пн–Пт 09:00–20:00, Сб 10:00–18:00, Вс выходной");
  assert.deepEqual(parseWeekHours("Пн–Пт 09:00–20:00, Сб 10:00–18:00, Вс выходной")?.[6], null);
  assert.equal(formatWeek(Array(7).fill({ open: "00:00", close: "24:00" })), "Круглосуточно");
  assert.equal(cityFromAddress("420111, г. Казань, ул. Баумана, 15"), "Казань");
  assert.equal(cityFromAddress("Россия, Ростов-на-Дону, Большая Садовая 1"), "Ростов-на-Дону");
  assert.equal(pricesFromText("Цены\nМаникюр\n1 900 ₽\nТелефон 8 900 000 00 00").length, 1);
});

test("Защита от SSRF: схемы, порты, частные адреса, DNS", async () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1"]) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ["77.88.55.88", "95.129.232.210", "2a02:6b8::2:242"]) assert.equal(isPrivateIp(ip), false, ip);
  const bad = ["file:///etc/passwd", "ftp://example.com/", "http://localhost:3000/", "http://127.0.0.1/", "http://[::1]/", "http://169.254.169.254/latest/meta-data", "http://user:pass@example.com/", "https://example.com:8443/", "http://intranet/", "http://printer.local/"];
  for (const u of bad) assert.throws(() => checkUrl(u), FetchError, u);
  await assert.rejects(safeFetch("http://127.0.0.1:3801/"), (e: FetchError) => e.code === "blocked_host");
  // Имя, которое резолвится в локальный адрес, режется на этапе соединения
  await new Promise<void>((resolve) => safeLookup("localhost", {}, (err) => {
    assert.ok(err && (err as NodeJS.ErrnoException).code === "EBLOCKED");
    resolve();
  }));
});
