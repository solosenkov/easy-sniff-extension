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
  nextScenarioResponse,
  parseScenarioPack,
  type ScenarioPack,
} from "./lib/scenario-pack";
let state: CaptureState = initialCapture();
let wsScriptId = "";
type ScenarioReplay = {
  pack: ScenarioPack;
  consumed: Record<string, number>;
  startedAt: number;
  scheduledWs: number;
};
let replay: ScenarioReplay | null = null;
const ready = chrome.storage.session
  .get(["capture", "scenarioReplay"])
  .then(async (data) => {
    await chrome.storage.local.setAccessLevel({
      accessLevel: "TRUSTED_CONTEXTS",
    });
    await initLanguage();
    if (data.capture)
      state = { ...initialCapture(), ...data.capture } as CaptureState;
    if (data.scenarioReplay) {
      const savedReplay = data.scenarioReplay as ScenarioReplay;
      replay = { ...savedReplay, pack: parseScenarioPack(savedReplay.pack) };
    }
    if (state.error?.startsWith("WebSocket:")) state.error = "";
    const saved = await chrome.storage.local.get(["rules", "wsRules"]);
    if (saved.rules) state.rules = saved.rules as Rule[];
    if (saved.wsRules) state.wsRules = saved.wsRules as WsRule[];
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
chrome.action.onClicked.addListener(async () => {
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
async function updateInterception() {
  if (state.tabId === null) return;
  const active = state.rules.filter((r) => r.enabled);
  const patterns = [
    ...active.map((r) => r.pattern),
    ...(replay?.pack.http.map((entry) => entry.url) || []),
  ];
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
    if (replay) {
      const activeReplay = replay;
      const { known, entry } = nextScenarioResponse(
        activeReplay.pack,
        activeReplay.consumed,
        p.request.url,
        p.request.method,
      );
      if (known) {
        if (!entry) {
          await command(tabId, "Fetch.failRequest", {
            requestId: p.requestId,
            errorReason: "BlockedByClient",
          });
          return;
        }
        await chrome.storage.session.set({ scenarioReplay: activeReplay });
        if (entry.delayMs)
          await new Promise((resolve) => setTimeout(resolve, entry.delayMs));
        if (replay !== activeReplay) {
          await command(tabId, "Fetch.continueRequest", {
            requestId: p.requestId,
          });
          return;
        }
        const responseHeaders = Object.entries(entry.responseHeaders).map(
          ([name, value]) => ({ name, value }),
        );
        if (
          !responseHeaders.some((h) => h.name.toLowerCase() === "content-type")
        )
          responseHeaders.push({
            name: "Content-Type",
            value: "text/plain; charset=utf-8",
          });
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
          responseCode: entry.status,
          responseHeaders,
          body: encodeBase64(entry.responseBody),
        });
        return;
      }
    }
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
      if (source.tabId === state.tabId)
        return networkEvent(source.tabId!, method, params);
    })
    .catch((error) => {
      state.error = String(error);
      publish();
    });
});
chrome.debugger.onDetach.addListener((source) => {
  void ready.then(() => {
    if (source.tabId === state.tabId) {
      replay = null;
      void chrome.storage.session.remove("scenarioReplay");
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
    !(
      message.type?.startsWith("capture.") ||
      message.type?.startsWith("scenario.")
    )
  )
    return;
  void (async () => {
    await ready;
    if (message.type === "capture.get") return state;
    if (message.type === "capture.tabs")
      return (await chrome.tabs.query({}))
        .filter((t) => t.url && /^https?:/.test(t.url))
        .map((t) => ({ id: t.id, title: t.title, url: t.url }));
    if (message.type === "capture.start") {
      const tabId = Number(message.tabId);
      if (state.tabId === tabId) return state;
      replay = null;
      await chrome.storage.session.remove("scenarioReplay");
      if (state.tabId !== null) {
        await evaluateWs(
          state.tabId,
          "(globalThis.__easySniffScenarioTimers || []).forEach(clearTimeout); globalThis.__easySniffScenarioTimers = []",
        ).catch(() => {});
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
      replay = null;
      await chrome.storage.session.remove("scenarioReplay");
      const tabId = state.tabId;
      await evaluateWs(
        tabId,
        "(globalThis.__easySniffScenarioTimers || []).forEach(clearTimeout); globalThis.__easySniffScenarioTimers = []",
      ).catch(() => {});
      await stopWsBridge(tabId);
      state.tabId = null;
      await chrome.debugger.detach({ tabId }).catch(() => {});
    }
    if (message.type === "capture.clear") {
      state.requests = [];
      state.frames = [];
    }
    if (message.type === "scenario.status")
      return replay
        ? {
            active: true,
            name: replay.pack.meta.name,
            httpCount: replay.pack.http.length,
            wsCount: replay.pack.ws.filter((frame) => frame.direction === "in")
              .length,
            consumed: Object.values(replay.consumed).reduce(
              (sum, n) => sum + n,
              0,
            ),
            scheduledWs: replay.scheduledWs,
          }
        : {
            active: false,
            name: "",
            httpCount: 0,
            wsCount: 0,
            consumed: 0,
            scheduledWs: 0,
          };
    if (message.type === "scenario.start") {
      if (state.tabId === null) throw new Error("Start capture before replay");
      const pack = parseScenarioPack(message.pack);
      await evaluateWs(
        state.tabId,
        "(globalThis.__easySniffScenarioTimers || []).forEach(clearTimeout); globalThis.__easySniffScenarioTimers = []",
      ).catch(() => {});
      replay = { pack, consumed: {}, startedAt: Date.now(), scheduledWs: 0 };
      try {
        await updateInterception();
        await chrome.storage.session.set({ scenarioReplay: replay });
      } catch (error) {
        replay = null;
        await updateInterception().catch(() => {});
        throw error;
      }
      return {
        active: true,
        name: pack.meta.name,
        httpCount: pack.http.length,
        wsCount: pack.ws.filter((frame) => frame.direction === "in").length,
        consumed: 0,
        scheduledWs: 0,
      };
    }
    if (message.type === "scenario.stop") {
      if (state.tabId !== null)
        await evaluateWs(
          state.tabId,
          "(globalThis.__easySniffScenarioTimers || []).forEach(clearTimeout); globalThis.__easySniffScenarioTimers = []",
        ).catch(() => {});
      replay = null;
      await chrome.storage.session.remove("scenarioReplay");
      await updateInterception();
      return {
        active: false,
        name: "",
        httpCount: 0,
        wsCount: 0,
        consumed: 0,
        scheduledWs: 0,
      };
    }
    if (message.type === "scenario.playWs") {
      if (!replay || state.tabId === null)
        throw new Error("Start scenario replay first");
      const frames = replay.pack.ws.filter((frame) => frame.direction === "in");
      for (const frame of frames)
        if (
          !state.requests.some(
            (r) =>
              r.type === "WebSocket" &&
              r.wsState === "open" &&
              r.url === frame.url,
          )
        )
          throw new Error(
            `Open a WebSocket connection for ${frame.url} before playing frames`,
          );
      for (const url of new Set(frames.map((frame) => frame.url))) {
        const connected = await evaluateWs(
          state.tabId,
          `globalThis.__easySniffWs?.connections(${JSON.stringify(url)}) ?? 0`,
        );
        if (connected !== 1)
          throw new Error(
            `Need exactly one captured page socket for ${url}. Reload the test page after starting capture.`,
          );
      }
      const payload = frames.map(({ url, payload, delayMs }) => ({
        url,
        payload,
        delayMs,
      }));
      const expression = `(() => {
        (globalThis.__easySniffScenarioTimers || []).forEach(clearTimeout);
        globalThis.__easySniffScenarioTimers = ${JSON.stringify(payload)}.map(item =>
          setTimeout(() => {
            try { globalThis.__easySniffWs?.inject(item.url, item.payload); }
            catch (error) { console.error("Easy Sniff scenario frame:", error); }
          }, item.delayMs)
        );
        return globalThis.__easySniffScenarioTimers.length;
      })()`;
      const count = await evaluateWs(state.tabId, expression);
      replay.scheduledWs = count;
      await chrome.storage.session.set({ scenarioReplay: replay });
      return { scheduledWs: count };
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
