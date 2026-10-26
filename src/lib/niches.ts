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
  proof: string; // что обычно убеждает клиента
};

const COMMON_NEG = [
  "бесплатно", "вакансия", "вакансии", "работа", "обучение", "курсы", "курс", "школа", "своими руками",
  "дома", "видео", "фото", "картинки", "скачать", "реферат", "википедия", "игра", "оптом", "купить", "авито",
];

export const NICHES: Niche[] = [
  {
    id: "nails",
    label: "Маникюр и педикюр",
    examples: ["Маникюр с покрытием гель-лаком", "Педикюр", "Наращивание ногтей", "Снятие и укрепление"],
    searchSeeds: ["маникюр {city}", "маникюр рядом", "маникюр с покрытием", "гель лак маникюр", "педикюр {city}", "наращивание ногтей", "ногтевой сервис", "маникюр запись"],
    negatives: [...COMMON_NEG, "дизайн ногтей фото", "лампа", "гель лак купить", "пилки", "аппарат", "мастер на дому"],
    audience: { sex: "female", ageFrom: 20, ageTo: 50, text: "Женщины 20–50 лет, живут или работают рядом" },
    visuals: [
      "close-up of a freshly manicured hand with glossy nude gel polish resting on a linen towel, soft daylight, shallow depth of field, editorial beauty photography",
      "flat lay of a neat manicure workstation: polish bottles in pastel tones, a ceramic dish, fresh flowers, top view, clean bright salon interior",
      "detail shot of almond-shaped nails with milky pink gel polish holding a cup of coffee, morning light, cozy cafe table",
    ],
    palette: { bg: "#F3E9EC", ink: "#3A1F2B", accent: "#C2185B" },
    proof: "аккуратность покрытия, стерильность инструментов, держится 3–4 недели",
  },
  {
    id: "brows",
    label: "Брови и ресницы",
    examples: ["Архитектура бровей", "Ламинирование ресниц", "Наращивание ресниц", "Окрашивание бровей"],
    searchSeeds: ["ламинирование ресниц {city}", "наращивание ресниц", "коррекция бровей", "ламинирование бровей", "архитектура бровей", "брови и ресницы рядом"],
    negatives: [...COMMON_NEG, "клей", "материалы", "сыворотка", "тушь", "набор"],
    audience: { sex: "female", ageFrom: 18, ageTo: 45, text: "Женщины 18–45 лет рядом с салоном" },
    visuals: [
      "macro beauty shot of long natural curled eyelashes after lash lift, soft studio light, clean skin texture, editorial",
      "minimal beauty studio flat lay: brow tweezers, small brushes, cream-colored towel, morning light",
    ],
    palette: { bg: "#EEE8E2", ink: "#2B2420", accent: "#8D5B3B" },
    proof: "натуральный результат, держится 6–8 недель",
  },
  {
    id: "hair",
    label: "Парикмахерская, окрашивание",
    examples: ["Женская стрижка", "Окрашивание AirTouch", "Мелирование", "Укладка"],
    searchSeeds: ["парикмахерская {city}", "стрижка женская", "окрашивание волос {city}", "салон красоты рядом", "сложное окрашивание", "укладка волос"],
    negatives: [...COMMON_NEG, "краска купить", "шампунь", "маска для волос", "плойка", "фен"],
    audience: { sex: "female", ageFrom: 20, ageTo: 55, text: "Женщины 20–55 лет в вашем районе" },
    visuals: [
      "back view of glossy healthy hair with soft balayage color, warm light in a modern salon, editorial photography",
      "hairdresser tools neatly arranged: scissors, comb, brushes on a marble counter, bright salon",
    ],
    palette: { bg: "#ECE7DF", ink: "#2A2622", accent: "#A0522D" },
    proof: "мастер подбирает цвет под тип внешности, бережные составы",
  },
  {
    id: "barber",
    label: "Барбершоп",
    examples: ["Мужская стрижка", "Стрижка + борода", "Детская стрижка", "Королевское бритьё"],
    searchSeeds: ["барбершоп {city}", "мужская стрижка", "барбершоп рядом", "стрижка бороды", "мужская парикмахерская"],
    negatives: [...COMMON_NEG, "машинка купить", "триммер", "воск", "масло для бороды"],
    audience: { sex: "male", ageFrom: 18, ageTo: 50, text: "Мужчины 18–50 лет рядом с барбершопом" },
    visuals: [
      "vintage barber chair in a dark wood barbershop interior, warm tungsten light, cinematic",
      "close-up of barber tools: straight razor, comb, scissors on a leather towel, moody light",
    ],
    palette: { bg: "#1F2326", ink: "#F2EDE4", accent: "#D4A24C" },
    proof: "без очереди по записи, стрижка 45 минут, кофе включён",
  },
  {
    id: "massage",
    label: "Массаж и SPA",
    examples: ["Классический массаж", "Антицеллюлитный массаж", "Массаж спины", "SPA-программа"],
    searchSeeds: ["массаж {city}", "массаж спины", "массажный салон рядом", "антицеллюлитный массаж", "лимфодренажный массаж", "спа салон"],
    negatives: [...COMMON_NEG, "массажер", "интим", "эротический", "масло купить", "кресло"],
    audience: { sex: "any", ageFrom: 25, ageTo: 60, text: "Женщины и мужчины 25–60 лет рядом" },
    visuals: [
      "calm spa room with rolled white towels, warm stones and eucalyptus, soft candle light, minimal",
      "hands of a massage therapist pouring oil into a palm, warm soft light, spa atmosphere, close-up",
    ],
    palette: { bg: "#E6ECE5", ink: "#1E2A22", accent: "#4E7C59" },
    proof: "дипломированные массажисты, тишина и чистота",
  },
  {
    id: "cosmetology",
    label: "Косметология",
    examples: ["Чистка лица", "Пилинг", "Биоревитализация", "Уход для лица"],
    searchSeeds: ["косметолог {city}", "чистка лица", "пилинг лица", "косметология рядом", "уход за лицом салон"],
    negatives: [...COMMON_NEG, "крем купить", "маска купить", "аппарат для дома", "сыворотка"],
    audience: { sex: "female", ageFrom: 23, ageTo: 55, text: "Женщины 23–55 лет" },
    visuals: [
      "skincare treatment room, clean white towels, glass bottles with serums, soft daylight, clinical yet warm",
    ],
    palette: { bg: "#EAF0F2", ink: "#1C2B33", accent: "#2E7D8C" },
    proof: "врач-косметолог с медицинской лицензией, сертифицированные препараты",
  },
  {
    id: "yoga",
    label: "Йога-студия",
    examples: ["Хатха-йога", "Йога для начинающих", "Пробное занятие", "Абонемент на месяц"],
    searchSeeds: ["йога {city}", "йога для начинающих", "йога студия рядом", "хатха йога", "йога занятия", "йога пробное занятие", "йога утром"],
    negatives: [...COMMON_NEG, "коврик", "одежда для йоги", "йога дома видео", "онлайн бесплатно", "асаны картинки", "инструктор вакансия"],
    audience: { sex: "female", ageFrom: 22, ageTo: 55, text: "В основном женщины 22–55 лет, живут неподалёку" },
    visuals: [
      "sunlit yoga studio with wooden floor, rolled mats and plants by large windows, morning light, calm, no people",
      "close-up of a yoga mat, wooden blocks and a strap on a light wooden floor, soft shadows of window frames",
      "silhouette of a person in a simple seated pose by a large window at sunrise, wide shot, minimal, serene",
    ],
    palette: { bg: "#EEF0E6", ink: "#232A1E", accent: "#5B7B3A" },
    proof: "маленькие группы до 10 человек, первое занятие — пробное",
  },
  {
    id: "fitness",
    label: "Фитнес, пилатес, растяжка",
    examples: ["Пилатес на реформерах", "Растяжка", "Персональная тренировка", "Пробное занятие"],
    searchSeeds: ["пилатес {city}", "растяжка {city}", "фитнес студия рядом", "персональный тренер", "пилатес на реформерах", "стретчинг занятия"],
    negatives: [...COMMON_NEG, "тренажер купить", "дома видео", "программа тренировок", "спортпит", "форма"],
    audience: { sex: "female", ageFrom: 20, ageTo: 50, text: "Женщины 20–50 лет рядом со студией" },
    visuals: [
      "bright pilates studio with reformer machines in a row, clean minimal interior, daylight, no people",
      "close-up of hands gripping a pilates reformer bar, athletic, soft focus background, studio light",
    ],
    palette: { bg: "#ECEEF3", ink: "#1D2233", accent: "#4A5BD4" },
    proof: "группы до 6 человек, тренер следит за техникой",
  },
  {
    id: "dance",
    label: "Танцы",
    examples: ["Танцы для взрослых", "Детские танцы", "Пробный урок"],
    searchSeeds: ["танцы для взрослых {city}", "школа танцев рядом", "танцы для начинающих", "детские танцы", "пробное занятие танцы"],
    negatives: [...COMMON_NEG, "видео уроки", "музыка", "песня", "фильм"],
    audience: { sex: "any", ageFrom: 18, ageTo: 45, text: "Взрослые 18–45 лет" },
    visuals: ["empty dance studio with mirrors and wooden floor, warm evening light, motion blur of a dress, cinematic"],
    palette: { bg: "#F1E9F2", ink: "#2A1D2E", accent: "#8E3BA8" },
    proof: "без опыта можно, первое занятие — пробное",
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
    proof: "работаем по записи, понятные цены",
  },
];

export const nicheById = (id: string) => NICHES.find((n) => n.id === id) ?? NICHES[NICHES.length - 1];

/** Подходы к объявлениям — это гипотезы, которые потом проверяются A/B-тестами */
export const ANGLES: Record<string, { name: string; hint: string }> = {
  price: { name: "Цена", hint: "Конкретная цена или «от» — человек сразу понимает, подходит ли ему" },
  offer: { name: "Предложение новым клиентам", hint: "Скидка или подарок на первый визит" },
  proof: { name: "Доверие", hint: "Отзывы, рейтинг, опыт мастеров" },
  convenience: { name: "Удобство", hint: "Рядом, без очереди, онлайн-запись" },
  result: { name: "Результат", hint: "Что получит клиент и как долго это держится" },
  emotion: { name: "Эмоция", hint: "Время для себя, забота, настроение" },
};

/** Популярные города: ID регионов в Яндексе. Остальные ищем в справочнике Директа. */
export const CITY_REGIONS: Record<string, number> = {
  "москва": 213, "санкт-петербург": 2, "петербург": 2, "спб": 2, "новосибирск": 65, "екатеринбург": 54, "казань": 43,
  "нижний новгород": 47, "челябинск": 56, "самара": 51, "омск": 66, "ростов-на-дону": 39, "уфа": 172, "красноярск": 62,
  "пермь": 50, "воронеж": 193, "волгоград": 38, "краснодар": 35, "саратов": 194, "тюмень": 55, "сочи": 239,
  "калининград": 22, "ярославль": 16, "иркутск": 63, "хабаровск": 76, "владивосток": 75,
};
