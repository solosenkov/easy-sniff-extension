import { t } from "./i18n";
import type { Rule } from "./types";
export function matchesRule(rule: Rule, url: string, method: string) {
  const pattern = rule.pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replaceAll("*", ".*");
  return (
    rule.enabled &&
    (rule.method === "*" || rule.method === method) &&
    new RegExp(`^${pattern}$`).test(url)
  );
}
export function validateRules(rules: Rule[]) {
  if (rules.length > 50) throw new Error(t("Максимум 50 правил"));
  if (JSON.stringify(rules).length > 500_000)
    throw new Error(
      t("Общий объём правил не должен превышать 500 000 символов"),
    );
  for (const rule of rules) {
    if (!/^https?:\/\//.test(rule.pattern) || rule.pattern.length > 2048)
      throw new Error(
        t("Укажите HTTP(S) URL-шаблон, например https://api.example.com/*"),
      );
    if (!["mock", "block", "delay", "headers", "request"].includes(rule.action))
      throw new Error(t("Неизвестный тип правила"));
    if (
      !Number.isInteger(rule.status) ||
      rule.status < 200 ||
      rule.status > 599
    )
      throw new Error(t("Код ответа должен быть от 200 до 599"));
    if (!Number.isFinite(rule.delay) || rule.delay < 0 || rule.delay > 10000)
      throw new Error(t("Задержка должна быть от 0 до 10000 мс"));
    if (rule.body.length > 100000)
      throw new Error(t("Тело подмены не должно превышать 100 000 символов"));
    if (rule.action === "request") {
      if (!rule.request)
        throw new Error(t("Заполните параметры изменённого запроса"));
      const url = new URL(rule.request.url);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.hash ||
        url.username ||
        url.password
      )
        throw new Error(
          t("Новый URL должен быть HTTP(S), без fragment и авторизации"),
        );
      if (!/^[A-Z]+$/.test(rule.request.method))
        throw new Error(t("Некорректный HTTP-метод"));
      if (["GET", "HEAD"].includes(rule.request.method) && rule.request.body)
        throw new Error(t("GET и HEAD не должны содержать тело"));
      if (rule.request.body.length > 100000)
        throw new Error(t("Тело запроса не должно превышать 100 000 символов"));
    }
    if (
      rule.action === "mock" &&
      rule.body &&
      rule.headers.some(
        (h) =>
          h.enabled &&
          h.key.toLowerCase() === "content-type" &&
          /json/i.test(h.value),
      )
    ) {
      try {
        JSON.parse(rule.body);
      } catch {
        throw new Error(t("Тело подмены должно быть корректным JSON"));
      }
    }
    for (const h of [...rule.headers, ...(rule.request?.headers || [])])
      if (h.enabled && h.key) {
        if (
          !/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(h.key) ||
          /[\r\n]/.test(h.value)
        )
          throw new Error(t("Некорректный заголовок в правиле"));
      }
  }
}
