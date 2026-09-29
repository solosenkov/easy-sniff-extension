import { t } from "./i18n";
export const isExtension =
  typeof chrome !== "undefined" && !!chrome.runtime?.id;
export async function readStore<T>(key: string, fallback: T): Promise<T> {
  if (isExtension) {
    const result = await chrome.storage.local.get(key);
    return (result[key] as T | undefined) ?? fallback;
  }
  try {
    return (
      JSON.parse(localStorage.getItem("easy-sniff:" + key) || "null") ??
      fallback
    );
  } catch {
    return fallback;
  }
}
export async function writeStore(key: string, value: unknown) {
  if (isExtension) await chrome.storage.local.set({ [key]: value });
  else localStorage.setItem("easy-sniff:" + key, JSON.stringify(value));
}
export async function rpc<T>(type: string, data: object = {}): Promise<T> {
  if (!isExtension)
    throw new Error(t("Захват вкладок доступен в установленном расширении."));
  const response = await chrome.runtime.sendMessage({ type, ...data });
  if (!response?.ok)
    throw new Error(response?.error || t("Расширение не ответило"));
  return response.data;
}
export function download(
  name: string,
  content: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
