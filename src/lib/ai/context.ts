import type { AiContext } from "./types";
const secretKey =
  /(?:authorization|cookie|password|passwd|secret|token|api[-_]?key|session[-_]?id|credential)/i;
export function redactText(text: string, knownSecrets: string[] = []): string {
  let value = text;
  for (const secret of knownSecrets)
    if (secret.length >= 4) value = value.split(secret).join("[REDACTED]");
  return value
    .replace(/\bBearer\s+[^\s"'<>;,]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "[REDACTED]")
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
      "[REDACTED]",
    )
    .replace(
      /((?:authorization|cookie|password|passwd|secret|token|api[-_]?key|session[-_]?id)\s*[=:]\s*)([^&\s"'<>;,]+)/gi,
      "$1[REDACTED]",
    );
}
export function redact(
  value: unknown,
  knownSecrets: string[] = [],
  depth = 0,
): unknown {
  if (depth > 16) return "[DEPTH LIMIT]";
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object")
        return JSON.stringify(redact(parsed, knownSecrets, depth + 1));
    } catch {
      /* Plain text. */
    }
    try {
      const url = new URL(value);
      if (["http:", "https:", "ws:", "wss:"].includes(url.protocol)) {
        url.username = "";
        url.password = "";
        for (const name of [...url.searchParams.keys()])
          if (secretKey.test(name)) url.searchParams.set(name, "[REDACTED]");
        return redactText(url.href, knownSecrets);
      }
    } catch {
      /* Not a URL. */
    }
    return redactText(value, knownSecrets);
  }
  if (Array.isArray(value))
    return value.map((item) => redact(item, knownSecrets, depth + 1));
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (
      typeof obj.key === "string" &&
      secretKey.test(obj.key) &&
      "value" in obj
    )
      return { ...obj, value: "[REDACTED]" };
    return Object.fromEntries(
      Object.entries(obj).map(([key, v]) => [
        key,
        secretKey.test(key) ? "[REDACTED]" : redact(v, knownSecrets, depth + 1),
      ]),
    );
  }
  return value;
}
export function allowedRequests(ctx: AiContext) {
  return ctx.scope === "selected"
    ? ctx.selected
      ? [ctx.selected]
      : []
    : ctx.scope === "traffic"
      ? ctx.capture.requests
      : [];
}
export function contextOverview(ctx: AiContext, keys: string[] = []) {
  const requests = allowedRequests(ctx);
  const preview =
    ctx.scope === "traffic"
      ? requests.filter((request) => request.type !== "WebSocket").slice(0, 40)
      : requests;
  return redact(
    {
      scope: ctx.scope,
      connectedTab: ctx.capture.tabId,
      capturedRequestCount:
        ctx.scope === "traffic" ? ctx.capture.requests.length : undefined,
      searchableRequestCount: requests.length,
      websocketConnectionCount:
        ctx.scope === "traffic"
          ? requests.length -
            requests.filter((request) => request.type !== "WebSocket").length
          : undefined,
      requestsPreviewCount: preview.length,
      requests: preview.map((r) => ({
        id: r.id,
        method: r.method,
        url: r.url,
        type: r.type,
        status: r.status,
        duration: r.duration,
        bodyAvailable: r.responseBody !== undefined && !r.bodyError,
      })),
      websocketCount: ctx.scope === "traffic" ? ctx.capture.frames.length : 0,
      currentRequest: ctx.scope === "request" ? ctx.draft : undefined,
      ruleCount: ctx.capture.rules.length,
    },
    keys,
  );
}
export function boundedData(data: unknown, keys: string[] = [], max = 18000) {
  const content = JSON.stringify(redact(data, keys));
  return content.length <= max
    ? content
    : JSON.stringify({
        truncated: true,
        preview: content.slice(0, max),
        note: "Only a preview is available; do not treat this as a complete response.",
      });
}
