import { t } from "../i18n";
import type { AiMessage, AiProvider, ToolCall } from "./types";
export const presets = [
  { name: "OpenAI-compatible endpoint", baseUrl: "", model: "" },
  { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "" },
  { name: "Ollama Cloud", baseUrl: "https://ollama.com/v1", model: "" },
  { name: "Ollama Local", baseUrl: "http://localhost:11434/v1", model: "" },
  { name: "LM Studio", baseUrl: "http://localhost:1234/v1", model: "" },
];
export function normalizeBaseUrl(value: string) {
  const url = new URL(value.trim());
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      t("Укажите HTTP(S) адрес API без ключа, параметров и fragment."),
    );
  return url.href.replace(/\/+$/, "").replace(/\/chat\/completions$/, "");
}
export function validateProvider(p: AiProvider, requireModel = true) {
  normalizeBaseUrl(p.baseUrl);
  if (!p.name.trim() || p.name.length > 100)
    throw new Error(t("Укажите название подключения."));
  if (requireModel && !p.model.trim())
    throw new Error(t("Выберите или введите ID модели."));
  if (p.apiKey.length > 4096 || /[\r\n]/.test(p.apiKey))
    throw new Error(t("Некорректный API-ключ."));
  if (
    p.timeoutSeconds !== undefined &&
    (!Number.isInteger(p.timeoutSeconds) ||
      p.timeoutSeconds < 30 ||
      p.timeoutSeconds > 900)
  )
    throw new Error(t("Укажите таймаут от 30 до 900 секунд."));
  if (
    p.maxOutputTokens !== undefined &&
    (!Number.isInteger(p.maxOutputTokens) ||
      p.maxOutputTokens < 512 ||
      p.maxOutputTokens > 32768)
  )
    throw new Error(t("Укажите лимит ответа от 512 до 32768 токенов."));
}
async function request(
  p: AiProvider,
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<any> {
  validateProvider(p, false);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (p.apiKey.trim()) headers.Authorization = `Bearer ${p.apiKey.trim()}`;
  const timeoutSeconds = p.timeoutSeconds ?? 600;
  const timeout = AbortSignal.timeout(timeoutSeconds * 1000);
  let response: Response;
  try {
    response = await fetch(normalizeBaseUrl(p.baseUrl) + path, {
      method: body === undefined ? "GET" : "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "omit",
      redirect: "error",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (error) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (timeout.aborted)
      throw new Error(
        t("Модель не ответила за {0} секунд. Попробуйте другую модель.", [
          timeoutSeconds,
        ]),
      );
    throw new Error(
      t(
        "Не удалось подключиться к API. Проверьте адрес, сеть и CORS в браузерном превью.",
      ),
    );
  }
  if (!response.ok) {
    let detail = "";
    try {
      const raw = (await response.text()).slice(0, 4000);
      const parsed = JSON.parse(raw);
      const message = parsed?.error?.message ?? parsed?.message;
      if (typeof message === "string") {
        detail = message
          .replaceAll(p.apiKey.trim() || "\u0000", "[redacted]")
          .replace(/[\r\n\t]+/g, " ")
          .slice(0, 300);
      }
    } catch {
      // Some compatible endpoints return plain text or no body on errors.
    }
    const summary =
      response.status === 402 &&
      new URL(normalizeBaseUrl(p.baseUrl)).hostname === "openrouter.ai"
        ? t(
            "HTTP 402: для этой модели недостаточно кредитов OpenRouter. Выберите бесплатную модель или проверьте баланс.",
          )
        : t("Провайдер вернул HTTP {0}. Проверьте ключ, модель и лимиты.", [
            response.status,
          ]);
    throw new Error(detail ? `${summary} ${detail}` : summary);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error(t("Провайдер вернул пустой ответ."));
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.length;
      if (length > 2_000_000) {
        await reader.cancel();
        throw new Error(t("Ответ провайдера слишком большой."));
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error(t("Провайдер вернул некорректный JSON."));
  }
}
export async function listModels(
  p: AiProvider,
  signal?: AbortSignal,
): Promise<string[]> {
  const result = await request(p, "/models", undefined, signal);
  if (!Array.isArray(result.data))
    throw new Error(t("API не вернул список моделей. Введите ID вручную."));
  return [
    ...new Set<string>(
      result.data
        .map((x: any) => x.id)
        .filter((id: unknown) => typeof id === "string" && id.length < 300),
    ),
  ]
    .sort()
    .slice(0, 2000);
}
export async function complete(
  p: AiProvider,
  messages: AiMessage[],
  tools: unknown[],
  signal?: AbortSignal,
): Promise<AiMessage> {
  validateProvider(p);
  const data = await request(
    p,
    "/chat/completions",
    {
      model: p.model,
      messages,
      stream: false,
      max_tokens: p.maxOutputTokens ?? 8192,
      ...(tools.length ? { tools, tool_choice: "auto" } : {}),
    },
    signal,
  );
  const m = data.choices?.[0]?.message;
  if (data.choices?.[0]?.finish_reason === "length")
    throw new Error(
      t(
        "Модель исчерпала лимит выходных токенов. Увеличьте лимит ответа в настройках подключения.",
      ),
    );
  if (!m || (!m.content && !m.tool_calls?.length))
    throw new Error(
      m?.reasoning_content
        ? t(
            "Модель вернула только размышления без ответа или действия. Увеличьте лимит ответа или выберите другую модель.",
          )
        : t(
            "Модель не вернула текст или действие. Выберите модель с поддержкой tools.",
          ),
    );
  if (
    m.content !== null &&
    m.content !== undefined &&
    typeof m.content !== "string"
  )
    throw new Error(t("Неподдерживаемый формат ответа модели."));
  let calls: ToolCall[] | undefined;
  if (m.tool_calls !== undefined) {
    if (!Array.isArray(m.tool_calls) || m.tool_calls.length > 12)
      throw new Error(t("Модель вернула слишком много действий."));
    calls = m.tool_calls.map((call: any, index: number) => {
      if (
        call.type !== "function" ||
        typeof call.function?.name !== "string" ||
        typeof call.function?.arguments !== "string" ||
        call.function.arguments.length > 100_000
      )
        throw new Error(t("Некорректный вызов инструмента."));
      return {
        id:
          typeof call.id === "string"
            ? call.id
            : `call_${crypto.randomUUID()}_${index}`,
        type: "function",
        function: {
          name: call.function.name,
          arguments: call.function.arguments,
        },
      };
    });
  }
  return {
    role: "assistant",
    content: m.content || null,
    ...(calls ? { tool_calls: calls } : {}),
    ...(typeof m.reasoning_content === "string"
      ? { reasoning_content: m.reasoning_content }
      : {}),
  };
}
export async function testModel(p: AiProvider, signal?: AbortSignal) {
  const result = await complete(
    p,
    [
      {
        role: "user",
        content:
          "Call connection_check with ok=true to verify tool calling. Do not reply with text.",
      },
    ],
    [
      {
        type: "function",
        function: {
          name: "connection_check",
          description: "Verify this client connection",
          parameters: {
            type: "object",
            properties: { ok: { type: "boolean" } },
            required: ["ok"],
            additionalProperties: false,
          },
        },
      },
    ],
    signal,
  );
  return !!result.tool_calls?.some((c) => {
    try {
      return (
        c.function.name === "connection_check" &&
        JSON.parse(c.function.arguments).ok === true
      );
    } catch {
      return false;
    }
  });
}
