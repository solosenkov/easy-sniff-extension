import { t } from "./i18n";
import { pair, type CaptureRequest, type Rule } from "./types";

const transportHeaders =
  /^(content-length|content-encoding|transfer-encoding|connection|keep-alive|host|upgrade|trailer|te|set-cookie|etag|last-modified)$/i;
export function ruleFromCapture(request: CaptureRequest): Rule {
  const usableResponse =
    request.responseBody !== undefined && !request.bodyError;
  return {
    id: crypto.randomUUID(),
    name: `${request.method} ${new URL(request.url).pathname}`,
    enabled: false,
    pattern: request.url,
    method: request.method,
    action: "mock",
    status: request.status && request.status >= 200 ? request.status : 200,
    body: usableResponse ? request.responseBody! : "",
    delay: 1500,
    headers: Object.entries(request.responseHeaders || {})
      .filter(([name]) => !name.startsWith(":") && !transportHeaders.test(name))
      .map(([name, value]) => pair(name, String(value))),
    request: {
      url: request.url,
      method: request.method,
      body: request.body || "",
      headers: Object.entries(request.requestHeaders)
        .filter(
          ([name]) => !name.startsWith(":") && !transportHeaders.test(name),
        )
        .map(([name, value]) => pair(name, String(value))),
    },
    sourceWarning: usableResponse
      ? ""
      : t(
          "Полный ответ недоступен. Вставьте полное тело вручную или выберите другой сценарий, например ошибку 500.",
        ),
  };
}
