import { english } from "./translations";
export type Language = "ru" | "en";
let language: Language = "en";
const listeners = new Set<() => void>();
export const getLanguage = () => language;
export const currentLocale = () => (language === "ru" ? "ru-RU" : "en-US");
export function subscribeLanguage(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function apply(value: unknown) {
  if ((value === "ru" || value === "en") && value !== language) {
    language = value;
    listeners.forEach((listener) => listener());
  }
}
export async function initLanguage() {
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    const stored = await chrome.storage.local.get("language");
    apply(stored.language);
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.language)
        apply(changes.language.newValue);
    });
  } else if (typeof localStorage !== "undefined") {
    apply(localStorage.getItem("easy-sniff:language"));
  }
}
export async function setLanguage(value: Language) {
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    await chrome.storage.local.set({ language: value });
  } else if (typeof localStorage !== "undefined") {
    localStorage.setItem("easy-sniff:language", value);
  }
  apply(value);
}
export function t(source: string, args: unknown[] = []): string {
  const translated = language === "en" ? (english[source] ?? source) : source;
  return translated.replace(/\{(\d+)\}/g, (match, index: string) =>
    Number(index) < args.length ? String(args[Number(index)]) : match,
  );
}
