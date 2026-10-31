/** Разделы «Настроек»: страница ?tab=… и подпункты в боковом меню */
export const SETTINGS_TABS = [
  { id: "business", label: "Бизнес" },
  { id: "site", label: "Сайт и ссылки" },
  { id: "ads", label: "Показ и бюджет" },
  { id: "accounts", label: "Кабинеты" },
  { id: "notify", label: "Уведомления" },
  { id: "account", label: "Аккаунт и проект" },
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number]["id"];
/** Старые якоря (#site, #budget…) → раздел */
export const HASH_TAB: Record<string, SettingsTab> = { site: "site", counter: "site", landing: "site", budget: "ads", show: "ads", vk: "accounts", "vk-pixel": "accounts", notify: "notify", links: "business", account: "account", delete: "account" };
