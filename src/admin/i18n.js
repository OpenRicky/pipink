import { createI18n } from "vue-i18n";
import en from "./locales/en";
import zh from "./locales/zh";

export const localeStorageKey = "pipink_admin_locale";

export const availableLocales = [
  { code: "en", label: "English" },
  { code: "zh", label: "中文" }
];

const normalizeLocale = (value) => (value?.toLowerCase().startsWith("zh") ? "zh" : "en");

const detectLocale = () => {
  if (typeof window !== "undefined") {
    const storedLocale = window.localStorage.getItem(localeStorageKey);
    if (storedLocale) {
      return normalizeLocale(storedLocale);
    }
  }

  const preferredLocale = navigator.languages?.find(Boolean) ?? navigator.language ?? "en";
  return normalizeLocale(preferredLocale);
};

export default createI18n({
  legacy: false,
  locale: detectLocale(),
  fallbackLocale: "en",
  messages: {
    en,
    zh
  }
});