import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { create } from "zustand";
import english from "./locales/en.json";
import systemEnglish from "./locales/system-en.json";
import { decodeSystemMessage } from "./system-messages";

export type Locale = "ja" | "en";
export type LanguagePreference = "system" | Locale;
const preferenceKey = "tanzakoo-language";

export function resolveLocale(
  preference: LanguagePreference,
  language = navigator.language,
): Locale {
  return preference === "system" ? (/^ja(?:-|$)/i.test(language) ? "ja" : "en") : preference;
}

export function readLanguagePreference(): LanguagePreference {
  try {
    const saved = localStorage.getItem(preferenceKey);
    if (saved === "ja" || saved === "en") return saved;
  } catch {
    /* UI preferences are optional. */
  }
  return "system";
}

const resources = { ...english, ...systemEnglish };
const sourceByEnglish = new Map(
  Object.entries(resources).map(([source, translated]) => [translated, source]),
);
const initialPreference = readLanguagePreference();
export const i18n = i18next.createInstance();
void i18n.use(initReactI18next).init({
  lng: resolveLocale(initialPreference),
  fallbackLng: "en",
  supportedLngs: ["ja", "en"],
  initAsync: false,
  keySeparator: false,
  nsSeparator: false,
  resources: {
    en: { translation: resources },
    ja: { translation: Object.fromEntries(Object.keys(resources).map((key) => [key, key])) },
  },
  interpolation: { escapeValue: false },
});

// Natural-language keys keep the Japanese source next to its use. Dynamic values
// are interpolated, never treated as translation keys or translated user content.
export function t(key: string, values?: Record<string, string | number>): string {
  return i18n.t(key, { ...values, defaultValue: key });
}
export const currentLocale = (): Locale => (i18n.resolvedLanguage === "ja" ? "ja" : "en");
export const useLanguage = create<{ preference: LanguagePreference }>(() => ({
  preference: initialPreference,
}));

export function setLanguage(preference: LanguagePreference) {
  useLanguage.setState({ preference });
  try {
    localStorage.setItem(preferenceKey, preference);
  } catch {
    /* Optional preference. */
  }
  void i18n.changeLanguage(resolveLocale(preference));
}

function updateDocumentLanguage() {
  document.documentElement.lang = currentLocale();
}
i18n.on("languageChanged", updateDocumentLanguage);
updateDocumentLanguage();
window.addEventListener("languagechange", () => {
  if (useLanguage.getState().preference === "system")
    void i18n.changeLanguage(resolveLocale("system"));
});

/** Only app-owned status/error fields call this; never pass cards or chat prose. */
export function systemMessage(message: string): string {
  const coded = decodeSystemMessage(message, currentLocale());
  if (coded !== null) return coded;
  if (Object.hasOwn(resources, message)) return t(message);
  const source = sourceByEnglish.get(message);
  if (source) return t(source);
  return message;
}
