/**
 * База знаний по нишам. Используется как подсказка для YandexGPT и как запасной вариант,
 * если генерация недоступна. Собрана из разборов кабинетов салонов и студий, курсов Яндекса
 * («Директ: продвинутый уровень»), справки VK Рекламы и интервью (docs/research.md).
 */
export type Niche = {
  id: string;
  label: string;
  examples: string[]; // примеры услуг для подсказок в форме
  searchSeeds: string[]; // базовые запросы; {city} подставляется
  negatives: string[]; // минус-слова по умолчанию
  audience: { sex: "female" | "male" | "any"; ageFrom: number; ageTo: number; text: string };
  visuals: string[]; // сюжеты картинок без людей в кадре крупно — чтобы не было «пластиковых» лиц
  palette: { bg: string; ink: string; accent: string };
  generic: string; // нейтральное название услуги, если владелец не перечислил услуги (без выдуманных деталей)
};

const COMMON_NEG = [
  "бесплатно", "вакансия", "вакансии", "работа", "требуется", "зарплата", "резюме", "стажировка", "обучение", "курсы", "курс",
  "школа", "научиться", "своими руками", "самостоятельно", "как сделать", "дома", "видео", "фото", "картинки", "идеи", "скачать",
  "реферат", "википедия", "что такое", "игра", "мультфильм", "сонник", "лунный календарь", "оптом", "купить", "магазин", "авито",
  "озон", "вайлдберриз", "aliexpress", "аренда", "франшиза", "открыть", "бизнес план",
];

export const NICHES: Niche[] = [
  {
    id: "nails",
    label: "Маникюр и педикюр",
    examples: ["Маникюр с покрытием гель-лаком", "Педикюр", "Наращивание ногтей", "Снятие и укрепление"],
    searchSeeds: ["маникюр {city}", "маникюр рядом", "маникюр с покрытием", "гель лак маникюр", "педикюр {city}", "наращивание ногтей", "ногтевой сервис", "маникюр запись"],
    negatives: [...COMMON_NEG, "дизайн ногтей фото", "лампа", "пилка", "пилки", "аппарат", "фрезы", "кисти", "набор", "слайдеры", "наклейки", "стемпинг", "тренды", "мастер на дому", "на дому"],
    audience: { sex: "female", ageFrom: 20, ageTo: 50, text: "Женщины 20–50 лет, живут или работают рядом" },
    visuals: [
      "close-up of a freshly manicured hand with glossy nude gel polish resting on a linen towel, soft daylight, shallow depth of field, editorial beauty photography",
      "flat lay of a neat manicure workstation: polish bottles in pastel tones, a ceramic dish, fresh flowers, top view, clean bright salon interior",
      "detail shot of almond-shaped nails with milky pink gel polish holding a cup of coffee, morning light, cozy cafe table",
    ],
    palette: { bg: "#F3E9EC", ink: "#3A1F2B", accent: "#C2185B" },
    generic: "Маникюр и педикюр",
  },
  {
    id: "brows",
    label: "Брови и ресницы",
    examples: ["Архитектура бровей", "Ламинирование ресниц", "Наращивание ресниц", "Окрашивание бровей"],
    searchSeeds: ["ламинирование ресниц {city}", "наращивание ресниц", "коррекция бровей", "ламинирование бровей", "архитектура бровей", "брови и ресницы рядом"],
    negatives: [...COMMON_NEG, "клей", "материалы", "сыворотка", "тушь", "набор", "пинцет", "состав", "краска для бровей", "на дому"],
    audience: { sex: "female", ageFrom: 18, ageTo: 45, text: "Женщины 18–45 лет рядом с салоном" },
    visuals: [
      "macro beauty shot of long natural curled eyelashes after lash lift, soft studio light, clean skin texture, editorial",
      "minimal beauty studio flat lay: brow tweezers, small brushes, cream-colored towel, morning light",
    ],
    palette: { bg: "#EEE8E2", ink: "#2B2420", accent: "#8D5B3B" },
    generic: "Брови и ресницы",
  },
  {
    id: "hair",
    label: "Парикмахерская, окрашивание",
    examples: ["Женская стрижка", "Окрашивание AirTouch", "Мелирование", "Укладка"],
    searchSeeds: ["парикмахерская {city}", "стрижка женская", "окрашивание волос {city}", "салон красоты рядом", "сложное окрашивание", "укладка волос"],
    negatives: [...COMMON_NEG, "краска", "шампунь", "маска для волос", "плойка", "фен", "утюжок", "расческа", "парик", "схема", "названия", "на дому"],
    audience: { sex: "female", ageFrom: 20, ageTo: 55, text: "Женщины 20–55 лет в вашем районе" },
    visuals: [
      "back view of glossy healthy hair with soft balayage color, warm light in a modern salon, editorial photography",
      "hairdresser tools neatly arranged: scissors, comb, brushes on a marble counter, bright salon",
    ],
    palette: { bg: "#ECE7DF", ink: "#2A2622", accent: "#A0522D" },
    generic: "Парикмахерская",
  },
  {
    id: "barber",
    label: "Барбершоп",
    examples: ["Мужская стрижка", "Стрижка + борода", "Детская стрижка", "Королевское бритьё"],
    searchSeeds: ["барбершоп {city}", "мужская стрижка", "барбершоп рядом", "стрижка бороды", "мужская парикмахерская"],
    negatives: [...COMMON_NEG, "машинка", "триммер", "бритва", "воск", "масло", "схема", "названия", "как стричь"],
    audience: { sex: "male", ageFrom: 18, ageTo: 50, text: "Мужчины 18–50 лет рядом с барбершопом" },
    visuals: [
      "vintage barber chair in a dark wood barbershop interior, warm tungsten light, cinematic",
      "close-up of barber tools: straight razor, comb, scissors on a leather towel, moody light",
    ],
    palette: { bg: "#1F2326", ink: "#F2EDE4", accent: "#D4A24C" },
    generic: "Барбершоп",
  },
  {
    id: "massage",
    label: "Массаж и SPA",
    examples: ["Классический массаж", "Антицеллюлитный массаж", "Массаж спины", "SPA-программа"],
    searchSeeds: ["массаж {city}", "массаж спины", "массажный салон рядом", "антицеллюлитный массаж", "лимфодренажный массаж", "спа салон"],
    negatives: [...COMMON_NEG.filter((w) => w !== "курс" && w !== "курсы"), "!курсы", "массажер", "массажное кресло", "кресло", "интим", "эротический", "эро", "с продолжением", "тантрический", "масло", "ролик", "валик", "пистолет", "техника", "схема", "противопоказания", "польза", "вред", "самомассаж", "омс", "лженаука"],
    audience: { sex: "any", ageFrom: 25, ageTo: 60, text: "Женщины и мужчины 25–60 лет рядом" },
    visuals: [
      "calm spa room with rolled white towels, warm stones and eucalyptus, soft candle light, minimal",
      "hands of a massage therapist pouring oil into a palm, warm soft light, spa atmosphere, close-up",
    ],
    palette: { bg: "#E6ECE5", ink: "#1E2A22", accent: "#4E7C59" },
    generic: "Массаж",
  },
  {
    id: "cosmetology",
    label: "Косметология",
    examples: ["Чистка лица", "Пилинг", "Биоревитализация", "Уход для лица"],
    searchSeeds: ["косметолог {city}", "чистка лица", "пилинг лица", "косметология рядом", "уход за лицом салон"],
    negatives: [...COMMON_NEG, "крем", "аппарат для дома", "сыворотка", "в домашних условиях", "последствия", "осложнения"],
    audience: { sex: "female", ageFrom: 23, ageTo: 55, text: "Женщины 23–55 лет" },
    visuals: [
      "skincare treatment room, clean white towels, glass bottles with serums, soft daylight, clinical yet warm",
    ],
    palette: { bg: "#EAF0F2", ink: "#1C2B33", accent: "#2E7D8C" },
    generic: "Косметология",
  },
  {
    id: "yoga",
    label: "Йога-студия",
    examples: ["Хатха-йога", "Йога для начинающих", "Пробное занятие", "Абонемент на месяц"],
    searchSeeds: ["йога {city}", "йога для начинающих", "йога студия рядом", "хатха йога", "йога занятия", "йога утром"],
    negatives: [...COMMON_NEG, "коврик", "одежда", "онлайн бесплатно", "асаны", "музыка", "книга", "инструктор вакансия", "упражнения"],
    audience: { sex: "female", ageFrom: 22, ageTo: 55, text: "В основном женщины 22–55 лет, живут неподалёку" },
    visuals: [
      "sunlit yoga studio with wooden floor, rolled mats and plants by large windows, morning light, calm, no people",
      "close-up of a yoga mat, wooden blocks and a strap on a light wooden floor, soft shadows of window frames",
      "silhouette of a person in a simple seated pose by a large window at sunrise, wide shot, minimal, serene",
    ],
    palette: { bg: "#EEF0E6", ink: "#232A1E", accent: "#5B7B3A" },
    generic: "Йога",
  },
  {
    id: "fitness",
    label: "Фитнес, пилатес, растяжка",
    examples: ["Пилатес на реформерах", "Растяжка", "Персональная тренировка", "Пробное занятие"],
    searchSeeds: ["пилатес {city}", "растяжка {city}", "фитнес студия рядом", "персональный тренер", "пилатес на реформерах", "стретчинг занятия"],
    negatives: [...COMMON_NEG, "тренажер купить", "программа тренировок", "упражнения", "спортпит", "протеин", "гантели", "резинки", "коврик", "браслет", "форма"],
    audience: { sex: "female", ageFrom: 20, ageTo: 50, text: "Женщины 20–50 лет рядом со студией" },
    visuals: [
      "bright pilates studio with reformer machines in a row, clean minimal interior, daylight, no people",
      "close-up of hands gripping a pilates reformer bar, athletic, soft focus background, studio light",
    ],
    palette: { bg: "#ECEEF3", ink: "#1D2233", accent: "#4A5BD4" },
    generic: "Фитнес-студия",
  },
  {
    id: "dance",
    label: "Танцы",
    examples: ["Танцы для взрослых", "Детские танцы", "Пробный урок"],
    searchSeeds: ["танцы для взрослых {city}", "школа танцев рядом", "танцы для начинающих", "детские танцы"],
    negatives: [...COMMON_NEG, "видео уроки", "музыка", "песня", "фильм", "клип", "текст", "костюм", "платье", "туфли", "движения"],
    audience: { sex: "any", ageFrom: 18, ageTo: 45, text: "Взрослые 18–45 лет" },
    visuals: ["empty dance studio with mirrors and wooden floor, warm evening light, motion blur of a dress, cinematic"],
    palette: { bg: "#F1E9F2", ink: "#2A1D2E", accent: "#8E3BA8" },
    generic: "Танцы",
  },
  {
    id: "other",
    label: "Другая услуга",
    examples: ["Основная услуга", "Пробное посещение"],
    searchSeeds: [],
    negatives: COMMON_NEG,
    audience: { sex: "any", ageFrom: 20, ageTo: 60, text: "Взрослые 20–60 лет рядом с вами" },
    visuals: ["bright modern small business interior, clean and welcoming, daylight, no people"],
    palette: { bg: "#ECEDEF", ink: "#1F2128", accent: "#3D5AFE" },
    generic: "Запись на услугу",
  },
];

export const nicheById = (id: string) => NICHES.find((n) => n.id === id) ?? NICHES[NICHES.length - 1];

/** Подходы к объявлениям — это гипотезы, которые потом проверяются A/B-тестами */
export const ANGLES: Record<string, { name: string; hint: string }> = {
  price: { name: "Цена", hint: "Конкретная цена или «от» — человек сразу понимает, подходит ли ему" },
  offer: { name: "Предложение новым клиентам", hint: "Скидка или подарок на первый визит" },
  proof: { name: "Доверие", hint: "Отзыв клиента или факты об опыте — только если они есть в анкете" },
  convenience: { name: "Удобство", hint: "Адрес, часы работы, онлайн-запись" },
  result: { name: "Результат", hint: "Что получит клиент — только из описания и преимуществ владельца" },
  emotion: { name: "Эмоция", hint: "Время для себя, забота, настроение" },
};

/** Популярные города: ID регионов в Яндексе. Остальные ищем в справочнике Директа. */
export const CITY_REGIONS: Record<string, number> = {
  "москва": 213, "санкт-петербург": 2, "петербург": 2, "спб": 2, "новосибирск": 65, "екатеринбург": 54, "казань": 43,
  "нижний новгород": 47, "челябинск": 56, "самара": 51, "омск": 66, "ростов-на-дону": 39, "уфа": 172, "красноярск": 62,
  "пермь": 50, "воронеж": 193, "волгоград": 38, "краснодар": 35, "саратов": 194, "тюмень": 55, "сочи": 239,
  "калининград": 22, "ярославль": 16, "иркутск": 63, "хабаровск": 76, "владивосток": 75,
};

// ─── Семантика: словари для семантического ядра (engine/semantics.ts) ──────────

/**
 * Понятие услуги: как люди называют одну и ту же услугу в поиске.
 * Главное понятие (маникюр, остеопат) даёт самостоятельные запросы; модификатор (mod: гель-лак, для детей) —
 * уточняет главное («маникюр гель лак», «остеопат для детей»). В словаре — только синонимы той же услуги:
 * «подолог» не синоним педикюра, а «наращивание» не синоним маникюра — это отдельные понятия, и в ядро они попадают,
 * только если такая услуга есть у владельца.
 */
export type Concept = {
  id: string;
  /** Семейство: общие запросы семейства («маникюр», «маникюр цена») получает одна группа, остальные — уточнённые */
  family: string;
  /** Ищем в названии услуги и разделе прайса (строчными, ё → е) */
  match: RegExp;
  /** Самостоятельные запросы (для mod — тоже, если они осмысленны без главного слова) */
  heads: string[];
  /** Главное слово для уточнений: «маникюр» → «японский маникюр», «чистка лица» → «ультразвуковая чистка лица» */
  noun?: string;
  /** Модификатор: присоединяется к главному слову */
  mod?: boolean;
  /** Формы модификатора после главного слова: «гель лак», «с покрытием», «для детей» */
  attach?: string[];
  /** Прилагательное модификатора (основа): «детск» → «детский массаж», «детская стрижка» */
  adj?: string;
  /** Специалист и место: «мастер маникюра», «массажный кабинет» — только для общих запросов */
  pros?: string[];
  /** Дательный падеж специалиста: «записаться к остеопату» */
  dat?: string;
  /** Короткое имя для сочетаний «мужская стрижка и борода» */
  combo?: string;
  kind?: "procedure" | "class" | "visit";
};

export type NicheSemantics = {
  concepts: Concept[];
  /** Где оказывают услугу: «маникюр салон», «йога студия» */
  venues: string[];
  kind: "procedure" | "class" | "visit";
  /** Дополнительные намерения ниши: {acc} — винительный падеж услуги, {x} — услуга как есть */
  intents?: string[];
};

/** Модификаторы для всех ниш */
const SHARED_MODS: Concept[] = [
  { id: "kids", family: "kids", mod: true, match: /детск|для детей|ребен|ребён|малыш|подрост/, heads: [], attach: ["для детей", "ребенку"], adj: "детск" },
  { id: "adult", family: "adult", mod: true, match: /взросл/, heads: [], attach: ["для взрослых"], adj: "взросл" },
  { id: "men", family: "men", mod: true, match: /мужск|для мужчин/, heads: [], attach: ["для мужчин"], adj: "мужск" },
  { id: "women", family: "women", mod: true, match: /женск|для женщин/, heads: [], attach: ["для женщин"], adj: "женск" },
  { id: "beginners", family: "beginners", mod: true, match: /начинающ|новичк|с нуля/, heads: [], attach: ["для начинающих", "с нуля"] },
  { id: "pregnant", family: "pregnant", mod: true, match: /беремен/, heads: [], attach: ["для беременных"] },
];

/** Покрытие ногтей (кроме «без покрытия»): одно понятие для «гель-лак», «шеллак», «покрытие лаком» */
const COAT: Concept = { id: "coat", family: "coat", mod: true, match: /покрыти|гель[\s-]?лак|шеллак|shellac/, heads: ["покрытие гель лаком", "гель лак на ногти"], attach: ["гель лак", "с покрытием", "шеллак"] };

export const SEMANTICS: Record<string, NicheSemantics> = {
  nails: {
    kind: "procedure",
    venues: ["салон", "студия"],
    concepts: [
      { id: "extension", family: "extension", match: /наращ/, heads: ["наращивание ногтей", "нарастить ногти"], noun: "наращивание ногтей", combo: "наращивание" },
      { id: "removal", family: "removal", match: /^сняти|^снять/, heads: ["снятие гель лака", "снятие покрытия", "снять гель лак"], noun: "снятие гель лака" },
      { id: "strengthen", family: "strengthen", match: /укреплен/, heads: ["укрепление ногтей", "укрепление ногтей гелем"], noun: "укрепление ногтей" },
      { id: "design", family: "design", mod: true, match: /дизайн/, heads: ["дизайн ногтей"], attach: ["с дизайном"] },
      { id: "french", family: "french", mod: true, match: /френч/, heads: [], attach: ["френч"] },
      COAT,
      { id: "podology", family: "podology", match: /подолог|вросш|мозол|натоптыш/, heads: ["подолог", "подология", "прием подолога"], noun: "подолог", dat: "подологу", kind: "visit" },
      { id: "pedicure", family: "pedicure", match: /педикюр/, heads: ["педикюр", "сделать педикюр"], noun: "педикюр", pros: ["мастер педикюра"] },
      { id: "manicure", family: "manicure", match: /маникюр|ногт/, heads: ["маникюр", "ногти", "ноготочки", "сделать ногти"], noun: "маникюр", pros: ["мастер маникюра", "маникюрный салон", "ногтевая студия", "ногтевой сервис"] },
    ],
  },
  brows: {
    kind: "procedure",
    venues: ["салон", "студия"],
    concepts: [
      { id: "brow_lam", family: "brow_lam", match: /ламинир\S*\s+бров|бров\S*\s+ламинир|долговременн\S*\s+уклад/, heads: ["ламинирование бровей", "долговременная укладка бровей"], noun: "ламинирование бровей" },
      { id: "brow_tint", family: "brow_tint", match: /(окраш|покраск|хн)\S*\s+(бров|ресниц)|бров\S*\s+(окраш|хн)|хной/, heads: ["окрашивание бровей", "покраска бровей", "окрашивание бровей хной"], noun: "окрашивание бровей" },
      { id: "lash_lam", family: "lashes", match: /ламинир\S*\s+ресниц|ресниц\S*\s+ламинир/, heads: ["ламинирование ресниц", "ламинировать ресницы"], noun: "ламинирование ресниц" },
      { id: "lash_ext", family: "lashes", match: /наращ\S*\s+ресниц|ресниц\S*\s+наращ/, heads: ["наращивание ресниц", "нарастить ресницы"], noun: "наращивание ресниц", pros: ["лешмейкер"] },
      { id: "lashes", family: "lashes", match: /ресниц/, heads: ["ресницы", "процедуры для ресниц"], noun: "ресницы" },
      { id: "brows", family: "brows", match: /бров/, heads: ["коррекция бровей", "архитектура бровей", "оформление бровей", "брови"], noun: "коррекция бровей", pros: ["бровист", "мастер по бровям"] },
      { id: "pmu", family: "pmu", match: /перманент|татуаж/, heads: ["перманентный макияж", "татуаж", "татуаж бровей"], noun: "перманентный макияж" },
    ],
  },
  hair: {
    kind: "procedure",
    venues: ["салон", "парикмахерская"],
    concepts: [
      { id: "airtouch", family: "color", match: /airtouch|эйр\s?тач|аиртач/, heads: ["окрашивание airtouch", "эйртач", "аиртач окрашивание"], noun: "окрашивание airtouch" },
      { id: "balayage", family: "color", match: /балаяж/, heads: ["балаяж", "окрашивание балаяж"], noun: "окрашивание балаяж" },
      { id: "shatush", family: "color", match: /шатуш/, heads: ["шатуш", "окрашивание шатуш"], noun: "окрашивание шатуш" },
      { id: "highlights", family: "color", match: /мелир/, heads: ["мелирование", "мелирование волос"], noun: "мелирование" },
      { id: "toning", family: "color", match: /тонир/, heads: ["тонирование волос", "тонировка волос"], noun: "тонирование волос" },
      { id: "color", family: "color", match: /окраш|покраск|колорир|омбре/, heads: ["окрашивание волос", "покраска волос", "покрасить волосы"], noun: "окрашивание волос", pros: ["колорист"] },
      { id: "keratin", family: "keratin", match: /кератин|ботокс/, heads: ["кератиновое выпрямление волос", "кератин для волос", "ботокс для волос"], noun: "кератиновое выпрямление" },
      { id: "hair_care", family: "care", match: /уход|восстановлен/, heads: ["уход за волосами", "восстановление волос"], noun: "уход за волосами" },
      { id: "hair_ext", family: "hair_ext", match: /наращ/, heads: ["наращивание волос", "нарастить волосы"], noun: "наращивание волос" },
      { id: "styling", family: "styling", match: /уклад|причес|локон/, heads: ["укладка волос", "укладка", "прическа"], noun: "укладка" },
      { id: "haircut", family: "haircut", match: /стрижк|стриж/, heads: ["стрижка", "подстричься", "стрижка волос"], noun: "стрижка", pros: ["парикмахер", "парикмахерская"] },
    ],
  },
  barber: {
    kind: "procedure",
    venues: ["барбершоп"],
    concepts: [
      { id: "beard", family: "beard", match: /бород|(?<!\p{L})усы?(?!\p{L})/u, heads: ["стрижка бороды", "оформление бороды", "моделирование бороды"], noun: "стрижка бороды", combo: "борода" },
      { id: "shave", family: "shave", match: /брить|бритьё|бритье|бритв/, heads: ["королевское бритье", "бритье опасной бритвой"], noun: "бритье", combo: "бритье" },
      { id: "camo", family: "camo", match: /камуфляж|тонир\S*\s+(седин|бород)/, heads: ["камуфляж седины", "тонирование седины"], noun: "камуфляж седины" },
      { id: "mcut", family: "mcut", match: /стрижк|стриж|машинк|фейд|fade/, heads: ["мужская стрижка", "стрижка мужская", "подстричься мужчине"], noun: "стрижка", pros: ["барбершоп", "барбер", "мужская парикмахерская"] },
    ],
  },
  massage: {
    kind: "procedure",
    venues: ["салон", "кабинет"],
    intents: ["куда сходить на {acc}"],
    concepts: [
      { id: "osteo", family: "osteo", match: /остеопат/, heads: ["остеопат", "остеопатия", "прием остеопата", "врач остеопат"], noun: "остеопат", dat: "остеопату", kind: "visit", pros: ["центр остеопатии"] },
      { id: "manual", family: "manual", match: /мануал|хиропракт/, heads: ["мануальный терапевт", "мануальная терапия"], noun: "мануальный терапевт", dat: "мануальному терапевту", kind: "visit" },
      { id: "lymph", family: "massage", match: /лимфодренаж/, heads: ["лимфодренажный массаж", "лимфодренаж"], noun: "лимфодренажный массаж" },
      { id: "anticell", family: "massage", match: /антицеллюлит|целлюлит/, heads: ["антицеллюлитный массаж", "массаж от целлюлита"], noun: "антицеллюлитный массаж" },
      { id: "face_m", family: "massage", match: /лиц/, heads: ["массаж лица"], noun: "массаж лица" },
      { id: "neck", family: "massage", match: /ше[йи]|воротник|швз/, heads: ["массаж шеи", "массаж шейно воротниковой зоны", "массаж воротниковой зоны"], noun: "массаж шеи" },
      { id: "back", family: "massage", match: /спин/, heads: ["массаж спины"], noun: "массаж спины" },
      { id: "feet_m", family: "massage", match: /ног|стоп/, heads: ["массаж ног", "массаж стоп"], noun: "массаж ног" },
      { id: "thai", family: "massage", match: /тайск/, heads: ["тайский массаж"], noun: "тайский массаж" },
      { id: "cup", family: "massage", match: /баноч|вакуум/, heads: ["баночный массаж", "вакуумный массаж"], noun: "баночный массаж" },
      { id: "spa", family: "spa", match: /(?<!\p{L})(spa|спа)(?!\p{L})/u, heads: ["спа", "спа салон", "спа программа", "спа процедуры"], noun: "спа программа" },
      { id: "massage", family: "massage", match: /массаж/, heads: ["массаж", "сделать массаж", "массаж тела"], noun: "массаж", pros: ["массажист", "массажный салон", "массажный кабинет"] },
    ],
  },
  cosmetology: {
    kind: "procedure",
    venues: ["кабинет", "салон"],
    concepts: [
      { id: "cleaning", family: "cleaning", match: /чистк/, heads: ["чистка лица", "почистить лицо", "чистка лица у косметолога"], noun: "чистка лица" },
      { id: "peel", family: "peel", match: /пилинг/, heads: ["пилинг лица", "пилинг"], noun: "пилинг" },
      { id: "biorev", family: "biorev", match: /биоревитал/, heads: ["биоревитализация", "биоревитализация лица"], noun: "биоревитализация" },
      { id: "meso", family: "meso", match: /мезотерап/, heads: ["мезотерапия", "мезотерапия лица"], noun: "мезотерапия" },
      { id: "botox", family: "botox", match: /ботокс|ботулин|диспорт|релатокс/, heads: ["ботокс", "уколы ботокса", "ботулинотерапия"], noun: "ботокс" },
      { id: "lips", family: "lips", match: /губ/, heads: ["увеличение губ", "увеличение губ гиалуроновой кислотой"], noun: "увеличение губ" },
      { id: "fillers", family: "fillers", match: /контурн|филлер/, heads: ["контурная пластика", "филлеры"], noun: "контурная пластика" },
      { id: "laser_epil", family: "epil", match: /лазерн\S*\s+эпил|эпиляц\S*\s+лазер/, heads: ["лазерная эпиляция", "эпиляция лазером"], noun: "лазерная эпиляция" },
      { id: "sugar", family: "epil", match: /шугаринг/, heads: ["шугаринг", "депиляция сахаром"], noun: "шугаринг" },
      { id: "wax", family: "epil", match: /воск/, heads: ["восковая депиляция", "депиляция воском"], noun: "восковая депиляция" },
      { id: "epil", family: "epil", match: /эпиляц|депиляц/, heads: ["эпиляция", "депиляция"], noun: "эпиляция" },
      { id: "face_care", family: "face_care", match: /уход|маск|увлажн/, heads: ["уход за лицом", "уходовая процедура для лица"], noun: "уход за лицом" },
      { id: "face_massage", family: "face_massage", match: /массаж/, heads: ["массаж лица", "косметический массаж лица"], noun: "массаж лица" },
      { id: "cosm", family: "cosm", match: /космет|консультац/, heads: ["косметолог", "косметология", "прием косметолога"], noun: "косметолог", dat: "косметологу", kind: "visit", pros: ["кабинет косметолога", "салон косметологии"] },
    ],
  },
  yoga: {
    kind: "class",
    venues: ["студия", "центр"],
    concepts: [
      { id: "hatha", family: "yoga", match: /хатха/, heads: ["хатха йога"], noun: "хатха йога" },
      { id: "kundalini", family: "yoga", match: /кундалини/, heads: ["кундалини йога"], noun: "кундалини йога" },
      { id: "aero", family: "yoga", match: /аэро|антиграв|гамак/, heads: ["аэройога", "антигравити йога", "йога в гамаках"], noun: "аэройога" },
      { id: "yin", family: "yoga", match: /(?<!\p{L})инь(?!\p{L})/u, heads: ["инь йога"], noun: "инь йога" },
      { id: "iyengar", family: "yoga", match: /айенгар/, heads: ["йога айенгара"], noun: "йога айенгара" },
      { id: "vinyasa", family: "yoga", match: /виньяс/, heads: ["виньяса йога"], noun: "виньяса йога" },
      { id: "ashtanga", family: "yoga", match: /аштанг/, heads: ["аштанга йога"], noun: "аштанга йога" },
      { id: "face_yoga", family: "face_yoga", match: /фейс|для лица|лица/, heads: ["йога для лица", "фейсйога"], noun: "йога для лица" },
      { id: "nidra", family: "yoga", match: /нидр/, heads: ["йога нидра"], noun: "йога нидра" },
      { id: "meditation", family: "meditation", match: /медитац/, heads: ["медитация", "медитация в группе"], noun: "медитация" },
      { id: "yoga", family: "yoga", match: /йог/, heads: ["йога", "занятия йогой", "йога для начинающих", "заниматься йогой"], noun: "йога" },
    ],
  },
  fitness: {
    kind: "class",
    venues: ["студия", "зал"],
    concepts: [
      { id: "reformer", family: "pilates", match: /реформер/, heads: ["пилатес на реформерах", "реформер пилатес"], noun: "пилатес на реформерах" },
      { id: "pilates", family: "pilates", match: /пилатес/, heads: ["пилатес", "занятия пилатесом"], noun: "пилатес" },
      { id: "stretch", family: "stretch", match: /растяж|стретч|шпагат/, heads: ["растяжка", "стретчинг", "занятия растяжкой", "растяжка на шпагат"], noun: "растяжка" },
      { id: "personal", family: "personal", match: /персональн|индивидуальн/, heads: ["персональный тренер", "персональная тренировка", "индивидуальные тренировки"], noun: "персональная тренировка" },
      { id: "functional", family: "functional", match: /функциональн|trx|кроссфит/, heads: ["функциональный тренинг", "функциональные тренировки"], noun: "функциональный тренинг" },
      { id: "barre", family: "barre", match: /барре|barre|бодибалет/, heads: ["барре", "бодибалет"], noun: "барре" },
      { id: "gym", family: "gym", match: /тренаж|(?<!\p{L})зал(?!\p{L})/u, heads: ["тренажерный зал", "тренажерка"], noun: "тренажерный зал" },
      { id: "fitness", family: "fitness", match: /фитнес|групповые\s+тренировк/, heads: ["фитнес", "фитнес студия", "групповые тренировки"], noun: "фитнес" },
    ],
  },
  dance: {
    kind: "class",
    venues: ["школа", "студия"],
    concepts: [
      { id: "strip", family: "dance", match: /стрип|strip|high\s?heels|хай\s?хилс|хилс/, heads: ["стрип пластика", "хай хилс", "танцы на каблуках"], noun: "стрип пластика" },
      { id: "latin", family: "dance", match: /латин|сальс|бачат|кизомб/, heads: ["латина", "сальса", "бачата"], noun: "латина" },
      { id: "hiphop", family: "dance", match: /хип.?хоп|hip.?hop/, heads: ["хип хоп", "хип хоп танцы"], noun: "хип хоп" },
      { id: "contemp", family: "dance", match: /контемп|современ/, heads: ["контемпорари", "современные танцы"], noun: "контемпорари" },
      { id: "ballroom", family: "dance", match: /бальн/, heads: ["бальные танцы"], noun: "бальные танцы" },
      { id: "belly", family: "dance", match: /восточн|беллиданс|belly/, heads: ["восточные танцы", "танец живота"], noun: "восточные танцы" },
      { id: "wedding", family: "wedding", match: /свадеб/, heads: ["свадебный танец", "постановка свадебного танца"], noun: "свадебный танец" },
      { id: "kpop", family: "dance", match: /k-?pop|кей.?поп/, heads: ["k pop танцы", "кей поп"], noun: "k pop танцы" },
      { id: "dance", family: "dance", match: /танц|хореограф|балет/, heads: ["танцы", "школа танцев", "студия танцев", "уроки танцев", "танцы для взрослых"], noun: "танцы" },
    ],
  },
  other: { kind: "procedure", venues: [], concepts: [] },
};

export const sharedMods = () => SHARED_MODS;
export const semanticsFor = (nicheId: string): NicheSemantics => SEMANTICS[nicheId] ?? SEMANTICS.other;

/** Коммерческие уточнения: {x} — услуга. «лучший/хороший» в объявления не попадают, а в запросах допустимы */
export const COMMERCIAL = {
  suffix: ["цена", "стоимость", "недорого", "запись", "онлайн запись", "рядом", "рядом со мной", "поблизости", "отзывы"],
  prefix: ["сколько стоит"],
  /** Прилагательные: согласуются с услугой («лучший маникюр», «хорошая стрижка») */
  adjectives: ["лучш", "хорош"],
} as const;

/** Короткие названия городов, которыми ищут */
export const CITY_ALIASES: Record<string, string[]> = {
  "москва": ["мск"], "санкт-петербург": ["спб", "питер"], "петербург": ["спб", "питер"], "екатеринбург": ["екб"],
  "ростов-на-дону": ["ростов"],};
