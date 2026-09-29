import { t } from "./i18n";
import { browserHeader } from "./curl";
import type { Draft, Environment, ApiResponse } from "./types";
export function interpolate(value: string, environment?: Environment): string {
  const values = new Map(
    environment?.values
      .filter((v) => v.enabled && v.key)
      .map((v) => [v.key, v.value]),
  );
  return value.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, key: string) => {
    if (!values.has(key))
      throw new Error(t("Переменная {{{0}}} не определена в окружении", [key]));
    return values.get(key)!;
  });
}
export function prepareRequest(draft: Draft, env?: Environment) {
  const url = new URL(interpolate(draft.url.trim(), env));
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error(t("Используйте HTTP или HTTPS URL"));
  if (url.username || url.password)
    throw new Error(
      t("Перенесите авторизацию из URL в заголовок Authorization"),
    );
  const headers = new Headers();
  for (const h of draft.headers)
    if (h.enabled && h.key.trim()) {
      if (browserHeader(h.key.trim()))
        throw new Error(
          t("Заголовком {0} управляет браузер. Отключите его в редакторе.", [
            h.key,
          ]),
        );
      headers.append(h.key.trim(), interpolate(h.value, env));
    }
  if (draft.token)
    headers.set("Authorization", `Bearer ${interpolate(draft.token, env)}`);
  const body =
    draft.bodyType === "none" ? undefined : interpolate(draft.body, env);
  if (body !== undefined && ["GET", "HEAD"].includes(draft.method))
    throw new Error(
      t("{0} не поддерживает тело в браузерном fetch. Выберите «Без тела».", [
        draft.method,
      ]),
    );
  if (body && draft.bodyType === "json") {
    JSON.parse(body);
    if (!headers.has("Content-Type"))
      headers.set("Content-Type", "application/json");
  }
  if (
    !Number.isFinite(draft.timeout) ||
    draft.timeout < 1 ||
    draft.timeout > 300
  )
    throw new Error(t("Таймаут должен быть от 1 до 300 секунд"));
  return {
    url: url.href,
    options: {
      method: draft.method,
      headers,
      body,
      credentials: draft.credentials ? "include" : "omit",
    } as RequestInit,
  };
}
export async function sendRequest(
  draft: Draft,
  env: Environment | undefined,
  signal: AbortSignal,
): Promise<ApiResponse> {
  const { url, options } = prepareRequest(draft, env);
  const start = performance.now();
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.any([
      signal,
      AbortSignal.timeout(draft.timeout * 1000),
    ]),
  });
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  const max = 2 * 1024 * 1024;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.byteLength > max) {
        chunks.push(value.slice(0, max - size));
        size = max;
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(value);
      size += value.byteLength;
    }
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.length;
  }
  return {
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers.entries()],
    body: new TextDecoder().decode(all),
    duration: Math.round(performance.now() - start),
    size,
    url: response.url,
    truncated,
  };
}
