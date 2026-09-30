import { t, initLanguage } from "./lib/i18n";
import {
  initialCapture,
  type CaptureState,
  type CaptureRequest,
  type Rule,
  type WsRule,
} from "./lib/types";
import { matchesRule, validateRules } from "./lib/rules";
import { decodeBase64, encodeBase64 } from "./lib/decoders";
import { limitRequests } from "./lib/network";
import { installWsBridge } from "./lib/ws-bridge";
import {
  redactText,
  redactUrl,
  getRecordingExchanges,
  saveExchange,
  type RecordingBody,
  saveSession,
  type RecordingEvent,
  type RecordingExchange,
  type RecordingSession,
} from "./lib/recording";
let state: CaptureState = initialCapture();
let recording: RecordingSession | null = null;
let exchanges = new Map<string, RecordingExchange[]>();
let pendingRequestExtra = new Map<string, any[]>();
let pendingResponseExtra = new Map<string, any[]>();
let detailsWrite = Promise.resolve();
let remainingBodyCharacters = 25_000_000;
let lastInvokedTabId: number | null = null;
let recordingTimer: ReturnType<typeof setTimeout> | undefined;
let wsScriptId = "";
const ready = chrome.storage.session.get("capture").then(async (data) => {
  await chrome.storage.local.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  });
  await initLanguage();
  if (data.capture)
    state = { ...initialCapture(), ...data.capture } as CaptureState;
  if (state.error?.startsWith("WebSocket:")) state.error = "";
  const saved = await chrome.storage.local.get(["rules", "wsRules"]);
  if (saved.rules) state.rules = saved.rules as Rule[];
  if (saved.wsRules) state.wsRules = saved.wsRules as WsRule[];
  const active = await chrome.storage.session.get("recording");
  if (active.recording) recording = active.recording as RecordingSession;
  if (recording?.status === "recording" && recording.fullHttp) {
    const savedExchanges = await getRecordingExchanges(recording.id);
    recording.networkCount = savedExchanges.length;
    for (const exchange of savedExchanges) {
      const list = exchanges.get(exchange.requestId) || [];
      list.push(exchange);
      exchanges.set(exchange.requestId, list);
      remainingBodyCharacters -=
        (exchange.requestBody?.content.length || 0) +
        (exchange.responseBody?.content.length || 0);
    }
  }
  const invocation = await chrome.storage.session.get("lastInvokedTabId");
  if (typeof invocation.lastInvokedTabId === "number")
    lastInvokedTabId = invocation.lastInvokedTabId;
});
function trimBuffer() {
  // Leave room for Chrome's UTF-16 storage accounting and rule configuration.
  state.requests = limitRequests(state.requests);
  let budget = 4_000_000;
  state.requests = state.requests.filter((request) => {
    budget -= JSON.stringify(request).length;
    return budget >= 0;
  });
  budget = 1_000_000;
  state.frames = state.frames.filter((frame) => {
    budget -= JSON.stringify(frame).length;
    return budget >= 0;
  });
}
let timer: ReturnType<typeof setTimeout> | undefined;
function publish() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = undefined;
    trimBuffer();
    void chrome.storage.session.set({ capture: state }).catch((error) => {
      state.error = t("Не удалось сохранить журнал: {0}", [String(error)]);
      void chrome.runtime
        .sendMessage({ type: "capture.updated", state })
        .catch(() => {});
    });
    void chrome.runtime
      .sendMessage({ type: "capture.updated", state })
      .catch(() => {});
  }, 250);
}
const command = (
  tabId: number,
  method: string,
  params?: Record<string, unknown>,
) => chrome.debugger.sendCommand({ tabId }, method, params) as Promise<any>;
function wsSource() {
  return `(${installWsBridge.toString()})(${JSON.stringify(state.wsRules)})`;
}
async function updateWsScript(tabId: number) {
  if (wsScriptId)
    await command(tabId, "Page.removeScriptToEvaluateOnNewDocument", {
      identifier: wsScriptId,
    });
  const result = await command(tabId, "Page.addScriptToEvaluateOnNewDocument", {
    source: wsSource(),
  });
  wsScriptId = result.identifier;
}
async function evaluateWs(tabId: number, expression: string) {
  const result = await command(tabId, "Runtime.evaluate", {
    expression,
    returnByValue: true,
  });
  if (result.exceptionDetails)
    throw new Error(
      result.exceptionDetails.exception?.description ||
        result.exceptionDetails.text ||
        "WebSocket page script failed",
    );
  return result.result?.value;
}
async function stopWsBridge(tabId: number) {
  await evaluateWs(tabId, "globalThis.__easySniffWs?.stop()").catch(() => {});
  wsScriptId = "";
}
function validateWsRules(rules: WsRule[]) {
  if (
    !Array.isArray(rules) ||
    rules.length > 30 ||
    JSON.stringify(rules).length > 500_000
  )
    throw new Error("Too many WebSocket rules");
  for (const rule of rules) {
    if (
      !rule.id ||
      !rule.name?.trim() ||
      !["send", "inject", "replace"].includes(rule.action) ||
      !/^wss?:\/\//.test(rule.pattern) ||
      rule.pattern.length > 2048 ||
      rule.contains.length > 4000 ||
      rule.replacement.length > 100_000
    )
      throw new Error("Invalid WebSocket rule");
  }
}
function matchesWsPattern(pattern: string, url: string) {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`).test(url);
}
chrome.action.onClicked.addListener(async (tab) => {
  await ready;
  if (typeof tab.id === "number" && /^https?:/.test(tab.url || "")) {
    lastInvokedTabId = tab.id;
    await chrome.storage.session.set({ lastInvokedTabId });
    void chrome.runtime
      .sendMessage({ type: "recording.target", tabId: tab.id })
      .catch(() => {});
  }
  const { toolWindowId } = await chrome.storage.session.get("toolWindowId");
  if (typeof toolWindowId === "number") {
    try {
      await chrome.windows.update(toolWindowId, { focused: true });
      return;
    } catch {
      /* Recreate a closed window. */
    }
  }
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL("index.html"),
    type: "popup",
    width: 1440,
    height: 940,
  });
  await chrome.storage.session.set({ toolWindowId: win?.id });
});
function recordingEvent(
  kind: RecordingEvent["kind"],
  severity: RecordingEvent["severity"],
  title: string,
  detail = "",
  extra: Partial<RecordingEvent> = {},
) {
  if (!recording || recording.status !== "recording") return;
  const event: RecordingEvent = {
    id: crypto.randomUUID(),
    at: Math.max(0, Date.now() - recording.startedAt),
    kind,
    severity,
    title: redactText(title).slice(0, 300),
    detail: redactText(detail).slice(0, 500),
    ...extra,
  };
  recording.events.push(event);
  if (recording.events.length > 2000) recording.events.shift();
  if (!recordingTimer)
    recordingTimer = setTimeout(() => {
      recordingTimer = undefined;
      void chrome.storage.session.set({ recording }).catch(() => {});
      void chrome.runtime
        .sendMessage({ type: "recording.updated", recording })
        .catch(() => {});
    }, 300);
}
function recordBody(content: string, base64 = false): RecordingBody {
  const limit = Math.max(0, Math.min(1_000_000, remainingBodyCharacters));
  const body: RecordingBody = {
    content: content.slice(0, limit),
    base64,
    truncated: content.length > limit,
  };
  if (!limit && content.length)
    body.error = "Recording body budget (25 million characters) reached";
  remainingBodyCharacters -= body.content.length;
  return body;
}
function currentExchange(requestId: string) {
  return exchanges.get(requestId)?.at(-1);
}
function persistExchange(exchange: RecordingExchange) {
  if (!recording?.fullHttp) return;
  const sessionId = recording.id;
  detailsWrite = detailsWrite
    .then(() => saveExchange(sessionId, structuredClone(exchange)))
    .catch((error) => {
      recordingEvent(
        "system",
        "warning",
        "Could not save full request details",
        String(error),
      );
    });
}
function applyRequestExtra(exchange: RecordingExchange, p: any) {
  exchange.requestHeaders = {
    ...exchange.requestHeaders,
    ...(p.headers || {}),
  };
  exchange.requestHeadersText = p.headersText;
  exchange.requestCookies = p.associatedCookies || [];
  exchange.requestExtraSeen = true;
  persistExchange(exchange);
}
function applyResponseExtra(exchange: RecordingExchange, p: any) {
  exchange.responseHeaders = {
    ...exchange.responseHeaders,
    ...(p.headers || {}),
  };
  exchange.responseHeadersText = p.headersText;
  exchange.responseCookies = p.blockedCookies || [];
  exchange.status = p.statusCode || exchange.status;
  exchange.responseExtraSeen = true;
  persistExchange(exchange);
}
function captureExchange(
  tabId: number,
  method: string,
  p: any,
): RecordingExchange | undefined {
  if (
    !recording?.fullHttp ||
    recording.status !== "recording" ||
    !method.startsWith("Network.")
  )
    return;
  const requestId = String(p.requestId || "");
  if (!requestId) return;
  if (method === "Network.requestWillBeSent") {
    const exchange: RecordingExchange = {
      id: crypto.randomUUID(),
      requestId,
      url: String(p.request.url || ""),
      method: String(p.request.method || "GET"),
      resourceType: String(p.type || "Other"),
      startedAt: Date.now(),
      requestHeaders: p.request.headers || {},
    };
    if (typeof p.request.postData === "string")
      exchange.requestBody = recordBody(p.request.postData);
    else if (p.request.hasPostData)
      exchange.requestBody = {
        content: "",
        base64: false,
        error: "Request body pending or omitted by Chrome",
      };
    const list = exchanges.get(requestId) || [];
    if (p.redirectResponse && list.length) {
      const prior = list.at(-1)!;
      prior.status = p.redirectResponse.status;
      prior.statusText = p.redirectResponse.statusText;
      prior.responseHeaders = p.redirectResponse.headers || {};
      prior.duration = Date.now() - prior.startedAt;
      persistExchange(prior);
    }
    list.push(exchange);
    exchanges.set(requestId, list);
    recording.networkCount = (recording.networkCount || 0) + 1;
    const requestExtra = pendingRequestExtra.get(requestId)?.shift();
    if (requestExtra) applyRequestExtra(exchange, requestExtra);
    const responseExtra = pendingResponseExtra.get(requestId)?.shift();
    if (responseExtra) applyResponseExtra(exchange, responseExtra);
    persistExchange(exchange);
    return exchange;
  }
  const list = exchanges.get(requestId) || [];
  if (method === "Network.requestWillBeSentExtraInfo") {
    const target = list.find((e) => !e.requestExtraSeen);
    if (target) applyRequestExtra(target, p);
    else
      pendingRequestExtra.set(requestId, [
        ...(pendingRequestExtra.get(requestId) || []),
        p,
      ]);
    return target;
  }
  if (method === "Network.responseReceivedExtraInfo") {
    const target = list.find((e) => !e.responseExtraSeen);
    if (target) applyResponseExtra(target, p);
    else
      pendingResponseExtra.set(requestId, [
        ...(pendingResponseExtra.get(requestId) || []),
        p,
      ]);
    return target;
  }
  const exchange = currentExchange(requestId);
  if (!exchange) return;
  if (method === "Network.responseReceived") {
    exchange.status = p.response.status;
    exchange.statusText = p.response.statusText;
    exchange.responseHeaders = {
      ...(p.response.headers || {}),
      ...exchange.responseHeaders,
    };
    exchange.mimeType = p.response.mimeType;
    exchange.protocol = p.response.protocol;
    exchange.remoteAddress = [p.response.remoteIPAddress, p.response.remotePort]
      .filter(Boolean)
      .join(":");
    exchange.timing = p.response.timing;
    exchange.fromDiskCache = !!p.response.fromDiskCache;
    persistExchange(exchange);
  } else if (method === "Network.requestServedFromCache") {
    exchange.fromDiskCache = true;
    persistExchange(exchange);
  } else if (method === "Network.loadingFailed") {
    exchange.error = p.errorText || "Request failed";
    exchange.duration = Date.now() - exchange.startedAt;
    persistExchange(exchange);
  } else if (method === "Network.loadingFinished") {
    exchange.duration = Date.now() - exchange.startedAt;
    exchange.encodedDataLength = p.encodedDataLength;
    const sessionId = recording.id;
    const bodyTask = (async () => {
      try {
        const result = await command(tabId, "Network.getResponseBody", {
          requestId,
        });
        exchange.responseBody = recordBody(
          result.body || "",
          !!result.base64Encoded,
        );
      } catch (error) {
        exchange.responseBody = {
          content: "",
          base64: false,
          error: String(error),
        };
      }
      if (exchange.requestBody?.error && !exchange.requestBody.content) {
        try {
          exchange.requestBody = recordBody(
            String(
              (
                await command(tabId, "Network.getRequestPostData", {
                  requestId,
                })
              ).postData || "",
            ),
          );
        } catch (error) {
          exchange.requestBody.error = String(error);
        }
      }
    })();
    detailsWrite = detailsWrite
      .then(() => bodyTask)
      .then(() => saveExchange(sessionId, structuredClone(exchange)))
      .catch((error) => {
        recordingEvent(
          "system",
          "warning",
          "Could not read full response",
          String(error),
        );
      });
  }
  return exchange;
}
function recordDebuggerEvent(method: string, p: any) {
  if (!recording || recording.status !== "recording") return;
  let exchange: RecordingExchange | undefined;
  try {
    exchange =
      state.tabId !== null
        ? captureExchange(state.tabId, method, p)
        : undefined;
  } catch (error) {
    recordingEvent(
      "system",
      "warning",
      "Could not capture HTTP details",
      String(error),
    );
  }
  if (method === "Network.requestWillBeSent") {
    recordingEvent(
      "request",
      "normal",
      `${p.request.method} ${redactUrl(p.request.url)}`,
      p.type || "",
      { requestId: p.requestId, exchangeId: exchange?.id },
    );
  } else if (method === "Network.responseReceived") {
    const severity = p.response.status >= 400 ? "error" : "normal";
    recordingEvent(
      "response",
      severity,
      `${p.response.status} ${redactUrl(p.response.url)}`,
      p.type || "",
      {
        requestId: p.requestId,
        exchangeId: exchange?.id,
        status: p.response.status,
      },
    );
  } else if (method === "Network.loadingFailed") {
    recordingEvent(
      "network-error",
      "error",
      redactUrl(
        state.requests.find((r) => r.requestId === p.requestId)?.url ||
          "Network request failed",
      ),
      p.errorText || "",
      { requestId: p.requestId, exchangeId: exchange?.id },
    );
  } else if (method === "Network.loadingFinished") {
    const row = state.requests.find((r) => r.requestId === p.requestId);
    const duration = row?.start
      ? Math.round((p.timestamp - row.start) * 1000)
      : 0;
    if (duration >= 1500)
      recordingEvent(
        "response",
        "warning",
        `Slow request · ${duration} ms`,
        redactUrl(row?.url || ""),
        { requestId: p.requestId, exchangeId: exchange?.id, duration },
      );
  } else if (method === "Runtime.consoleAPICalled") {
    const level = String(p.type || "log");
    const details = (p.args || [])
      .map((arg: any) =>
        String(
          arg.value ?? arg.description ?? arg.preview?.description ?? arg.type,
        ),
      )
      .join(" ");
    const severity =
      level === "error" || level === "assert"
        ? "error"
        : level === "warning"
          ? "warning"
          : "normal";
    recordingEvent(
      "console",
      severity,
      `${level}: ${details || "(empty)"}`,
      p.stackTrace?.callFrames?.[0]
        ? `${p.stackTrace.callFrames[0].url}:${p.stackTrace.callFrames[0].lineNumber + 1}`
        : "",
    );
  } else if (method === "Runtime.exceptionThrown") {
    recordingEvent(
      "exception",
      "error",
      p.exceptionDetails?.text || "Uncaught exception",
      p.exceptionDetails?.exception?.description || "",
    );
  } else if (method === "Log.entryAdded") {
    const entry = p.entry;
    if (entry?.source === "javascript" && entry?.level === "error")
      recordingEvent(
        "console",
        "error",
        entry.text || "JavaScript error",
        entry.url || "",
      );
  } else if (
    method === "Network.webSocketFrameReceived" ||
    method === "Network.webSocketFrameSent"
  ) {
    const row = state.requests.find((r) => r.requestId === p.requestId);
    recordingEvent(
      "websocket",
      "normal",
      `${method.endsWith("Sent") ? "→" : "←"} ${redactUrl(row?.url || "WebSocket frame")}`,
      `opcode ${p.response?.opcode ?? "?"}, ${p.response?.payloadData?.length ?? 0} chars`,
      { requestId: p.requestId },
    );
  }
}
async function ensureOffscreen() {
  const url = chrome.runtime.getURL("offscreen.html");
  if (
    !(
      await chrome.runtime.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"],
        documentUrls: [url],
      })
    ).length
  ) {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: [chrome.offscreen.Reason.USER_MEDIA],
      justification:
        "Record the user-selected browser tab for a local bug report",
    });
  }
}
async function mediaMessage<T>(
  type: string,
  data: Record<string, unknown> = {},
): Promise<T> {
  const response = await chrome.runtime.sendMessage({ type, ...data });
  if (!response?.ok)
    throw new Error(response?.error || "Recorder did not respond");
  return response.data as T;
}
async function stopRecording() {
  if (!recording || recording.status !== "recording") return recording;
  if (recordingTimer) {
    clearTimeout(recordingTimer);
    recordingTimer = undefined;
  }
  recording.status = "stopping";
  await chrome.storage.session.set({ recording });
  try {
    const result = await mediaMessage<{ size: number; mimeType: string }>(
      "recording.media.stop",
    );
    await finalizeRecording(result);
  } catch (error) {
    recording.status = "failed";
    recording.error = String(error);
  }
  await chrome.storage.session.set({ recording });
  void chrome.runtime
    .sendMessage({ type: "recording.updated", recording })
    .catch(() => {});
  return recording;
}
async function finalizeRecording(result: { size: number; mimeType: string }) {
  if (!recording) return;
  if (recording.fullHttp) await detailsWrite;
  if (state.tabId !== null) {
    await Promise.allSettled([
      command(state.tabId, "Runtime.disable"),
      command(state.tabId, "Log.disable"),
      recording.fullHttp
        ? command(state.tabId, "Network.enable", {
            maxTotalBufferSize: 10 * 1024 * 1024,
            maxResourceBufferSize: 2 * 1024 * 1024,
            maxPostDataSize: 24_000,
          })
        : Promise.resolve(),
    ]);
  }
  recording.endedAt = Date.now();
  recording.size = result.size;
  recording.mimeType = result.mimeType;
  recording.status = "saved";
  await saveSession(recording);
  exchanges.clear();
  pendingRequestExtra.clear();
  pendingResponseExtra.clear();
}
async function updateInterception() {
  if (state.tabId === null) return;
  const active = state.rules.filter((r) => r.enabled);
  const patterns = active.map((r) => r.pattern);
  if (patterns.length)
    await command(state.tabId, "Fetch.enable", {
      patterns: [...new Set(patterns)].map((urlPattern) => ({
        urlPattern,
        requestStage: "Request",
      })),
    });
  else await command(state.tabId, "Fetch.disable");
}
async function paused(tabId: number, p: any) {
  try {
    const rule = state.rules.find((r) =>
      matchesRule(r, p.request.url, p.request.method),
    );
    if (!rule) {
      await command(tabId, "Fetch.continueRequest", { requestId: p.requestId });
      return;
    }
    if (rule.action === "block")
      await command(tabId, "Fetch.failRequest", {
        requestId: p.requestId,
        errorReason: "BlockedByClient",
      });
    else if (rule.action === "mock") {
      const responseHeaders = rule.headers
        .filter((h) => h.enabled && h.key)
        .map((h) => ({ name: h.key, value: h.value }));
      if (!responseHeaders.some((h) => h.name.toLowerCase() === "content-type"))
        responseHeaders.push({
          name: "Content-Type",
          value: "application/json; charset=utf-8",
        });
      // Synthetic replies must remain readable by cross-origin applications.
      const origin = Object.entries(
        p.request.headers as Record<string, string>,
      ).find(([name]) => name.toLowerCase() === "origin")?.[1];
      if (
        origin &&
        !responseHeaders.some(
          (h) => h.name.toLowerCase() === "access-control-allow-origin",
        )
      ) {
        responseHeaders.push(
          { name: "Access-Control-Allow-Origin", value: origin },
          { name: "Access-Control-Allow-Credentials", value: "true" },
        );
      }
      await command(tabId, "Fetch.fulfillRequest", {
        requestId: p.requestId,
        responseCode: rule.status,
        responseHeaders,
        body: encodeBase64(
          [204, 205, 304].includes(rule.status) || p.request.method === "HEAD"
            ? ""
            : rule.body,
        ),
      });
    } else if (rule.action === "request" && rule.request) {
      await command(tabId, "Fetch.continueRequest", {
        requestId: p.requestId,
        url: rule.request.url,
        method: rule.request.method,
        postData: encodeBase64(rule.request.body),
        headers: rule.request.headers
          .filter((h) => h.enabled && h.key)
          .map((h) => ({ name: h.key, value: h.value })),
      });
    } else if (rule.action === "headers") {
      const headers = new Map(
        Object.entries(p.request.headers as Record<string, string>).map(
          ([name, value]) => [name.toLowerCase(), { name, value }],
        ),
      );
      for (const h of rule.headers)
        if (h.enabled && h.key)
          headers.set(h.key.toLowerCase(), { name: h.key, value: h.value });
      await command(tabId, "Fetch.continueRequest", {
        requestId: p.requestId,
        headers: [...headers.values()],
      });
    } else {
      await new Promise((resolve) => setTimeout(resolve, rule.delay));
      await command(tabId, "Fetch.continueRequest", { requestId: p.requestId });
    }
  } catch (error) {
    state.error = t("Подмена: {0}", [String(error)]);
    publish();
    await command(tabId, "Fetch.continueRequest", {
      requestId: p.requestId,
    }).catch(() => {});
  }
}
async function networkEvent(tabId: number, method: string, p: any) {
  if (method === "Fetch.requestPaused") {
    await paused(tabId, p);
    return;
  }
  if (method === "Network.requestWillBeSent") {
    const prior = state.requests.find((r) => r.requestId === p.requestId);
    if (prior && (p.type === "WebSocket" || prior.type === "WebSocket")) {
      Object.assign(prior, {
        url: p.request.url,
        start: p.timestamp,
        requestHeaders: p.request.headers,
        type: "WebSocket",
      });
      publish();
      return;
    }
    if (p.redirectResponse && prior) {
      prior.status = p.redirectResponse.status;
      prior.duration = Math.round((p.timestamp - prior.start) * 1000);
    }
    const request: CaptureRequest = {
      id: crypto.randomUUID(),
      requestId: p.requestId,
      url: p.request.url,
      method: p.request.method,
      type: p.type || "Other",
      start: p.timestamp,
      requestHeaders: p.request.headers,
      body: p.request.postData?.slice(0, 24000),
    };
    state.requests.unshift(request);
    state.requests = limitRequests(state.requests);
    publish();
  } else if (method === "Network.responseReceived") {
    const row = state.requests.find((r) => r.requestId === p.requestId);
    if (!row) return;
    Object.assign(row, {
      status: p.response.status,
      responseHeaders: p.response.headers,
      mime: p.response.mimeType,
    });
    publish();
  } else if (
    method === "Network.loadingFinished" ||
    method === "Network.loadingFailed"
  ) {
    const row = state.requests.find((r) => r.requestId === p.requestId);
    if (!row) return;
    row.duration = Math.round((p.timestamp - row.start) * 1000);
    row.bytes = p.encodedDataLength;
    if (p.errorText) row.error = p.errorText;
    else if (
      p.encodedDataLength > 2 * 1024 * 1024 ||
      (row.mime && !/json|text|xml|javascript|form/.test(row.mime))
    )
      row.bodyError = t("Тело пропущено: бинарный или большой ответ.");
    else {
      try {
        const result = await command(tabId, "Network.getResponseBody", {
          requestId: p.requestId,
        });
        row.responseBody = result.base64Encoded
          ? decodeBase64(result.body).slice(0, 24000)
          : result.body.slice(0, 24000);
        if (result.body.length > 24000)
          row.bodyError = t("В журнале сохранены первые 24 000 символов.");
      } catch {
        row.bodyError = t(
          "Chrome не предоставил тело ответа (например, редирект или очищенный буфер).",
        );
      }
    }
    publish();
  } else if (method === "Network.webSocketCreated") {
    const existing = state.requests.find((r) => r.requestId === p.requestId);
    if (existing) {
      Object.assign(existing, {
        url: p.url,
        type: "WebSocket",
        wsState: "connecting",
      });
      publish();
      return;
    }
    state.requests.unshift({
      id: crypto.randomUUID(),
      requestId: p.requestId,
      url: p.url,
      method: "GET",
      type: "WebSocket",
      start: 0,
      requestHeaders: {},
      wsState: "connecting",
    });
    state.requests = limitRequests(state.requests);
    publish();
  } else if (method === "Network.webSocketHandshakeResponseReceived") {
    const row = state.requests.find((r) => r.requestId === p.requestId);
    if (row)
      Object.assign(row, {
        status: p.response.status,
        responseHeaders: p.response.headers,
        wsState: p.response.status === 101 ? "open" : "error",
      });
    publish();
  } else if (method === "Network.webSocketWillSendHandshakeRequest") {
    const row = state.requests.find((r) => r.requestId === p.requestId);
    if (row) row.requestHeaders = p.request.headers;
    publish();
  } else if (method === "Network.webSocketClosed") {
    const row = state.requests.find((r) => r.requestId === p.requestId);
    if (row) row.wsState = "closed";
    publish();
  } else if (
    method === "Network.webSocketFrameReceived" ||
    method === "Network.webSocketFrameSent"
  ) {
    const connection = state.requests.find((r) => r.requestId === p.requestId);
    if (connection) connection.wsState = "open";
    state.frames.unshift({
      id: crypto.randomUUID(),
      requestId: p.requestId,
      url:
        state.requests.find((r) => r.requestId === p.requestId)?.url ||
        p.requestId,
      direction: method.endsWith("Sent") ? "out" : "in",
      time: Date.now(),
      data: p.response.payloadData.slice(0, 8000),
      opcode: p.response.opcode,
      truncated: p.response.payloadData.length > 8000,
    });
    state.frames.length = Math.min(state.frames.length, 300);
    publish();
  } else if (method === "Network.webSocketFrameError") {
    const message =
      typeof p.errorMessage === "string" ? p.errorMessage.trim() : "";
    const row = state.requests.find((r) => r.requestId === p.requestId);
    if (row && message) {
      row.wsState = "error";
      row.wsError = message;
      publish();
    }
  }
}
chrome.debugger.onEvent.addListener((source, method, params) => {
  void ready
    .then(() => {
      if (source.tabId === state.tabId) {
        recordDebuggerEvent(method, params);
        return networkEvent(source.tabId!, method, params);
      }
    })
    .catch((error) => {
      state.error = String(error);
      publish();
    });
});
chrome.debugger.onDetach.addListener((source) => {
  void ready.then(() => {
    if (source.tabId === state.tabId) {
      if (recording?.status === "recording") {
        recordingEvent(
          "system",
          "warning",
          "Debugger disconnected",
          "Console and network capture stopped",
        );
        void stopRecording();
      }
      wsScriptId = "";
      void chrome.scripting
        .executeScript({
          target: { tabId: source.tabId },
          world: "MAIN",
          func: () => (globalThis as any).__easySniffWs?.stop(),
        })
        .catch(() => {});
      state.tabId = null;
      state.error = t("Запись остановлена: отладчик отключён от вкладки.");
      publish();
    }
  });
});
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (
    sender.id !== chrome.runtime.id ||
    (!message.type?.startsWith("capture.") &&
      !message.type?.startsWith("recording.")) ||
    (message.type?.startsWith("recording.media.") &&
      message.type !== "recording.media.completed") ||
    message.type === "recording.updated" ||
    message.type === "recording.target"
  )
    return;
  void (async () => {
    await ready;
    if (message.type === "recording.media.completed") {
      if (
        recording?.status === "recording" &&
        message.result?.id === recording.id
      ) {
        if (recordingTimer) {
          clearTimeout(recordingTimer);
          recordingTimer = undefined;
        }
        recording.status = "stopping";
        await finalizeRecording(message.result);
        await chrome.storage.session.set({ recording });
        void chrome.runtime
          .sendMessage({ type: "recording.updated", recording })
          .catch(() => {});
      }
      return recording;
    }
    if (message.type === "recording.status") return recording;
    if (message.type === "recording.eligible") return lastInvokedTabId;
    if (message.type === "recording.start") {
      const tabId = Number(message.tabId);
      const fullHttp = message.fullHttp === true;
      if (tabId !== lastInvokedTabId)
        throw new Error(
          "Open the test tab and click the Easy Sniff icon before recording it",
        );
      if (recording?.status === "recording" || recording?.status === "stopping")
        throw new Error("A bug recording is already running");
      if (state.tabId !== tabId)
        throw new Error("Connect the selected tab in Network before recording");
      const tab = await chrome.tabs.get(tabId);
      if (fullHttp)
        await command(tabId, "Network.enable", {
          maxTotalBufferSize: 50 * 1024 * 1024,
          maxResourceBufferSize: 10 * 1024 * 1024,
          maxPostDataSize: 1_000_000,
        });
      await ensureOffscreen();
      const streamId = await chrome.tabCapture.getMediaStreamId({
        targetTabId: tabId,
      });
      const next: RecordingSession = {
        id: crypto.randomUUID(),
        title: tab.title || "Bug recording",
        tabUrl: redactUrl(tab.url || ""),
        startedAt: Date.now(),
        status: "recording",
        events: [],
        fullHttp,
        networkCount: 0,
      };
      const media = await mediaMessage<{ mimeType: string }>(
        "recording.media.start",
        { id: next.id, streamId },
      );
      try {
        await command(tabId, "Runtime.enable");
        await command(tabId, "Log.enable");
        recording = { ...next, mimeType: media.mimeType };
        exchanges = new Map();
        pendingRequestExtra = new Map();
        pendingResponseExtra = new Map();
        detailsWrite = Promise.resolve();
        remainingBodyCharacters = 25_000_000;
        await chrome.storage.session.set({ recording });
        void chrome.runtime
          .sendMessage({ type: "recording.updated", recording })
          .catch(() => {});
        return recording;
      } catch (error) {
        await mediaMessage("recording.media.stop").catch(() => {});
        throw error;
      }
    }
    if (message.type === "recording.stop") return stopRecording();
    if (message.type === "recording.marker") {
      if (!recording || recording.status !== "recording")
        throw new Error("No active recording");
      recordingEvent(
        "marker",
        "warning",
        String(message.label || "Bug appeared").slice(0, 120),
      );
      return recording;
    }
    if (message.type === "capture.get") return state;
    if (message.type === "capture.tabs")
      return (await chrome.tabs.query({}))
        .filter((t) => t.url && /^https?:/.test(t.url))
        .map((t) => ({ id: t.id, title: t.title, url: t.url }));
    if (message.type === "capture.start") {
      const tabId = Number(message.tabId);
      if (state.tabId === tabId) return state;
      if (state.tabId !== null) {
        await stopWsBridge(state.tabId);
        await chrome.debugger.detach({ tabId: state.tabId }).catch(() => {});
      }
      state.tabId = null;
      const tab = await chrome.tabs.get(tabId);
      await chrome.debugger.attach({ tabId }, "1.3");
      try {
        await command(tabId, "Network.enable", {
          maxTotalBufferSize: 10 * 1024 * 1024,
          maxResourceBufferSize: 2 * 1024 * 1024,
          maxPostDataSize: 24000,
        });
        state = {
          ...initialCapture(),
          sessionId: crypto.randomUUID(),
          rules: state.rules,
          wsRules: state.wsRules,
          tabId,
          title: tab.title || tab.url || "",
        };
        await updateInterception();
        await command(tabId, "Page.enable");
        await updateWsScript(tabId);
        await evaluateWs(tabId, wsSource());
      } catch (error) {
        await chrome.debugger.detach({ tabId }).catch(() => {});
        state.tabId = null;
        throw error;
      }
    }
    if (message.type === "capture.stop" && state.tabId !== null) {
      if (recording?.status === "recording") await stopRecording();
      const tabId = state.tabId;
      await stopWsBridge(tabId);
      state.tabId = null;
      await chrome.debugger.detach({ tabId }).catch(() => {});
    }
    if (message.type === "capture.clear") {
      state.requests = [];
      state.frames = [];
    }
    if (message.type === "capture.rules") {
      const rules = message.rules as Rule[];
      validateRules(rules);
      const previous = state.rules;
      state.rules = rules;
      try {
        await updateInterception();
        await chrome.storage.local.set({ rules });
      } catch (error) {
        state.rules = previous;
        await updateInterception().catch(() => {});
        throw error;
      }
    }
    if (message.type === "capture.ws.rules") {
      const rules = message.rules as WsRule[];
      validateWsRules(rules);
      const previous = state.wsRules;
      state.wsRules = rules;
      try {
        if (state.tabId !== null) {
          await updateWsScript(state.tabId);
          await evaluateWs(state.tabId, wsSource());
        }
        await chrome.storage.local.set({ wsRules: rules });
      } catch (error) {
        state.wsRules = previous;
        if (state.tabId !== null) {
          await updateWsScript(state.tabId).catch(() => {});
          await evaluateWs(state.tabId, wsSource()).catch(() => {});
        }
        throw error;
      }
    }
    if (
      message.type === "capture.ws.send" ||
      message.type === "capture.ws.inject"
    ) {
      if (state.tabId === null)
        throw new Error("Start capture before using WebSocket controls");
      const request = state.requests.find(
        (row) =>
          row.requestId === message.requestId && row.type === "WebSocket",
      );
      if (!request || request.wsState !== "open")
        throw new Error("Select an open WebSocket connection");
      const saved = message.ruleId
        ? state.wsRules.find((rule) => rule.id === message.ruleId)
        : undefined;
      const method = message.type === "capture.ws.send" ? "send" : "inject";
      if (
        message.ruleId &&
        (!saved ||
          saved.action !== method ||
          !matchesWsPattern(saved.pattern, request.url))
      )
        throw new Error(
          "The saved WebSocket scenario does not match this connection",
        );
      const data = saved ? saved.replacement : message.data;
      if (typeof data !== "string" || !data || data.length > 100_000)
        throw new Error("WebSocket text must contain 1–100,000 characters");
      const result = await evaluateWs(
        state.tabId,
        `globalThis.__easySniffWs?.${method}(${JSON.stringify(request.url)},${JSON.stringify(data)})`,
      );
      if (result !== (method === "send" ? "sent" : "injected"))
        throw new Error(
          "WebSocket page bridge is unavailable. Reload the captured tab.",
        );
      if (method === "inject") {
        state.frames.unshift({
          id: crypto.randomUUID(),
          requestId: request.requestId,
          url: request.url,
          direction: "in",
          time: Date.now(),
          data: data.slice(0, 8000),
          opcode: 1,
          synthetic: true,
        });
        state.frames.length = Math.min(state.frames.length, 300);
      }
    }
    state.error = "";
    trimBuffer();
    await chrome.storage.session.set({ capture: state });
    publish();
    return state;
  })()
    .then((data) => reply({ ok: true, data }))
    .catch((error) =>
      reply({ ok: false, error: String(error.message || error) }),
    );
  return true;
});
