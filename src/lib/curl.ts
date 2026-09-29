import { t } from "./i18n";
import { newDraft, pair, type Draft } from "./types";
// A small POSIX shell lexer. It parses strings only; no command execution or expansion.
export function shellTokens(input: string): string[] {
  const tokens: string[] = [];
  let word = "";
  let quote = "";
  let started = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quote === "'") {
      if (c === "'") quote = "";
      else word += c;
      started = true;
      continue;
    }
    if (c === "\\" && quote !== "'") {
      const next = input[++i];
      if (next === undefined)
        throw new Error(t("Незавершённое экранирование в cURL"));
      if (next === "\n") continue;
      if (next === "\r" && input[i + 1] === "\n") {
        i++;
        continue;
      }
      word +=
        quote === '"' && !["$", "`", '"', "\\"].includes(next)
          ? "\\" + next
          : next;
      started = true;
      continue;
    }
    if (quote === '"') {
      if (c === '"') quote = "";
      else word += c;
      started = true;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      started = true;
      continue;
    }
    if (/\s/.test(c)) {
      if (started) {
        tokens.push(word);
        word = "";
        started = false;
      }
      continue;
    }
    if (";|<>`".includes(c) || (c === "&" && input[i + 1] === "&"))
      throw new Error(t("Вставьте одну команду cURL без shell-операторов"));
    word += c;
    started = true;
  }
  if (quote) throw new Error(t("Незакрытые кавычки в cURL"));
  if (started) tokens.push(word);
  return tokens;
}
export const browserHeader = (name: string) =>
  /^(cookie2?|host|content-length|origin|referer|connection|accept-encoding|user-agent|sec-.*|proxy-.*|transfer-encoding|upgrade|te|trailer|expect|date|via|access-control-request-.*)$/i.test(
    name,
  );
export function parseCurl(input: string): { draft: Draft; warnings: string[] } {
  const tokens = shellTokens(input.trim());
  if (tokens.shift()?.toLowerCase() !== "curl")
    throw new Error(t("Команда должна начинаться с curl"));
  const draft = newDraft();
  const warnings: string[] = [];
  draft.headers = [];
  let explicitMethod = false;
  const data: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    let flag = tokens[i];
    let inline: string | undefined;
    if (flag.startsWith("--") && flag.includes("=")) {
      const at = flag.indexOf("=");
      inline = flag.slice(at + 1);
      flag = flag.slice(0, at);
    } else if (/^-[XHdub].+/.test(flag)) {
      inline = flag.slice(2);
      flag = flag.slice(0, 2);
    }
    const value = () => {
      const v = inline ?? tokens[++i];
      if (v === undefined) throw new Error(t("Нет значения для {0}", [flag]));
      return v;
    };
    if (flag === "-X" || flag === "--request") {
      draft.method = value().toUpperCase();
      explicitMethod = true;
    } else if (flag === "--url") draft.url = value();
    else if (flag === "-H" || flag === "--header") {
      const h = value();
      const at = h.indexOf(":");
      if (at < 1) throw new Error(t("Некорректный заголовок: {0}", [h]));
      const key = h.slice(0, at).trim();
      if (browserHeader(key))
        warnings.push(
          t("{0}: управляется браузером и не импортирован.", [key]),
        );
      else draft.headers.push(pair(key, h.slice(at + 1).trim()));
    } else if (
      [
        "-d",
        "--data",
        "--data-raw",
        "--data-binary",
        "--json",
        "--data-urlencode",
      ].includes(flag)
    ) {
      let v = value();
      if (v.startsWith("@") && flag !== "--data-raw")
        throw new Error(
          t(
            "Чтение @файлов не поддерживается. Вставьте содержимое в тело запроса.",
          ),
        );
      if (flag === "--data-urlencode") {
        const at = v.indexOf("=");
        v =
          at >= 0
            ? `${v.slice(0, at)}=${encodeURIComponent(v.slice(at + 1))}`
            : encodeURIComponent(v);
      }
      data.push(v);
      if (flag === "--json") {
        draft.headers.push(
          pair("Content-Type", "application/json"),
          pair("Accept", "application/json"),
        );
      }
    } else if (flag === "-u" || flag === "--user") {
      const bytes = new TextEncoder().encode(value());
      draft.headers.push(
        pair("Authorization", "Basic " + btoa(String.fromCharCode(...bytes))),
      );
    } else if (flag === "-b" || flag === "--cookie") {
      value();
      warnings.push(
        t(
          "Cookie из cURL не импортирован. Для cookies браузера включите опцию в настройках запроса.",
        ),
      );
    } else if (flag === "-I" || flag === "--head") {
      draft.method = "HEAD";
      explicitMethod = true;
    } else if (
      [
        "--compressed",
        "-L",
        "--location",
        "-s",
        "--silent",
        "-S",
        "--show-error",
        "-v",
        "--verbose",
      ].includes(flag)
    ) {
      /* Browser transport handles decompression and redirects. */
    } else if (flag === "-k" || flag === "--insecure")
      warnings.push(t("Проверку TLS нельзя отключить в браузерном клиенте."));
    else if (flag === "--max-time" || flag === "-m") {
      draft.timeout = Number(value());
      if (!Number.isFinite(draft.timeout) || draft.timeout <= 0)
        throw new Error(t("Некорректный таймаут"));
    } else if (!flag.startsWith("-") && !draft.url) draft.url = flag;
    else throw new Error(t("Пока не поддерживается аргумент: {0}", [flag]));
  }
  if (!draft.url) throw new Error(t("В команде нет URL"));
  if (data.length) {
    draft.body = data.join("&");
    draft.bodyType = "text";
    if (!explicitMethod) draft.method = "POST";
    try {
      JSON.parse(draft.body);
      draft.bodyType = "json";
    } catch {
      /* Preserve raw text. */
    }
    if (!draft.headers.some((h) => h.key.toLowerCase() === "content-type"))
      draft.headers.push(
        pair("Content-Type", "application/x-www-form-urlencoded"),
      );
  }
  if (!draft.headers.length) draft.headers = [pair()];
  try {
    draft.name = new URL(draft.url).pathname || t("Запрос");
  } catch {
    draft.name = t("Импортированный запрос");
  }
  return { draft, warnings };
}
const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
export function toCurl(draft: Draft): string {
  const parts = [`curl -X ${quote(draft.method)} ${quote(draft.url)}`];
  for (const h of draft.headers)
    if (
      h.enabled &&
      h.key.trim() &&
      !(draft.token && h.key.toLowerCase() === "authorization")
    )
      parts.push(`-H ${quote(`${h.key}: ${h.value}`)}`);
  if (
    draft.bodyType === "json" &&
    !draft.headers.some(
      (h) => h.enabled && h.key.toLowerCase() === "content-type",
    )
  )
    parts.push("-H 'Content-Type: application/json'");
  if (draft.token)
    parts.push(`-H ${quote(`Authorization: Bearer ${draft.token}`)}`);
  if (draft.bodyType !== "none" && !["GET", "HEAD"].includes(draft.method))
    parts.push(`--data-raw ${quote(draft.body)}`);
  return parts.join(" \\\n  ");
}
