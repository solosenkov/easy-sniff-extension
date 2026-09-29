import { t } from "./i18n";
export function decodeBase64(input: string): string {
  const normalized = input.trim().replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized);
  return new TextDecoder("utf-8", { fatal: true }).decode(
    Uint8Array.from(binary, (c) => c.charCodeAt(0)),
  );
}
export function decodeJwt(input: string) {
  const parts = input
    .trim()
    .replace(/^Bearer\s+/i, "")
    .split(".");
  if (parts.length !== 3)
    throw new Error(t("JWT должен состоять из трёх частей"));
  const header = JSON.parse(decodeBase64(parts[0]));
  const payload = JSON.parse(decodeBase64(parts[1]));
  return {
    header,
    payload,
    signature: parts[2],
    expired:
      typeof payload.exp === "number" ? payload.exp * 1000 < Date.now() : null,
  };
}
export async function decodeMessage(
  input: string,
  maxOutputBytes = 2_000_000,
): Promise<{ text: string; method: string }> {
  let value = input.trim();
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== "string")
      return { text: JSON.stringify(parsed, null, 2), method: "JSON" };
    value = parsed;
  } catch {
    /* Encoded message. */
  }
  try {
    const once = decodeBase64(value);
    try {
      return {
        text: JSON.stringify(JSON.parse(once), null, 2),
        method: "Base64 → JSON",
      };
    } catch {
      try {
        const twice = decodeBase64(once);
        return { text: pretty(twice), method: "Base64 → Base64" };
      } catch {
        return { text: once, method: "Base64 → UTF-8" };
      }
    }
  } catch {
    /* Try compressed binary below. */
  }
  const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  for (const format of [
    "deflate",
    "gzip",
    "deflate-raw",
  ] as CompressionFormat[]) {
    try {
      const stream = new Blob([bytes])
        .stream()
        .pipeThrough(new DecompressionStream(format));
      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > maxOutputBytes) {
            await reader.cancel();
            throw new RangeError(
              t("Распакованное сообщение превышает допустимый размер."),
            );
          }
          chunks.push(part.value);
        }
      } finally {
        reader.releaseLock();
      }
      const output = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.length;
      }
      const text = new TextDecoder().decode(output);
      try {
        return {
          text: pretty(decodeBase64(text)),
          method: `Base64 → ${format} → Base64`,
        };
      } catch {
        return { text: pretty(text), method: `Base64 → ${format}` };
      }
    } catch (error) {
      if (error instanceof RangeError) throw error;
      /* Try next format. */
    }
  }
  throw new Error(
    t(
      "Не удалось распознать сообщение. Поддерживаются JSON, Base64, zlib и gzip.",
    ),
  );
}
export function pretty(text: string) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
export function encodeBase64(input: string) {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function encodeMessageLike(source: string, replacement: string) {
  const { method } = await decodeMessage(source);
  let wrapped = false;
  try {
    wrapped = typeof JSON.parse(source.trim()) === "string";
  } catch {
    /* Raw payload. */
  }
  const finish = (value: string) => (wrapped ? JSON.stringify(value) : value);
  if (method === "JSON") return replacement;
  if (method === "Base64 → JSON" || method === "Base64 → UTF-8")
    return finish(encodeBase64(replacement));
  if (method === "Base64 → Base64")
    return finish(encodeBase64(encodeBase64(replacement)));
  const match = /^Base64 → (deflate|gzip|deflate-raw)( → Base64)?$/.exec(
    method,
  );
  if (!match) throw new Error("Unsupported WebSocket encoding");
  const plain = match[2] ? encodeBase64(replacement) : replacement;
  const stream = new Blob([plain])
    .stream()
    .pipeThrough(new CompressionStream(match[1] as CompressionFormat));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return finish(btoa(binary));
}
