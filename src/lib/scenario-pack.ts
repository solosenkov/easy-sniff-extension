import type { CaptureState, Rule, WsRule } from "./types";

export type ScenarioPack = {
  format: "easy-sniff-scenario";
  version: 1;
  meta: { id: string; name: string; createdAt: string; sourceTitle: string };
  http: {
    seq: number;
    method: string;
    url: string;
    requestBody?: string;
    status: number;
    responseHeaders: Record<string, string>;
    responseBody: string;
    delayMs: number;
  }[];
  ws: {
    seq: number;
    url: string;
    direction: "in" | "out";
    payload: string;
    delayMs: number;
  }[];
  rules: Rule[];
  wsRules: WsRule[];
};

export function createScenarioPack(
  capture: CaptureState,
  name: string,
): ScenarioPack {
  const http = [...capture.requests]
    .reverse()
    .filter(
      (request) =>
        request.type !== "WebSocket" &&
        request.status !== undefined &&
        request.responseBody !== undefined &&
        !request.bodyError &&
        !request.error &&
        /^https?:\/\//.test(request.url) &&
        /^[A-Z]+$/.test(request.method) &&
        (() => {
          const url = new URL(request.url);
          return !url.username && !url.password;
        })(),
    )
    .map((request, seq) => ({
      seq,
      method: request.method,
      url: request.url,
      requestBody: request.body,
      status: request.status!,
      responseHeaders: Object.fromEntries(
        Object.entries(request.responseHeaders || {}).filter(([header]) =>
          /^(content-type|cache-control|access-control-allow-origin|access-control-allow-credentials)$/i.test(
            header,
          ),
        ),
      ),
      responseBody: request.responseBody!,
      delayMs: Math.min(Math.max(request.duration || 0, 0), 10_000),
    }));
  const frames = [...capture.frames]
    .reverse()
    .filter(
      (frame) =>
        !frame.truncated && frame.opcode === 1 && /^wss?:\/\//.test(frame.url),
    );
  const firstFrameTime = frames[0]?.time || 0;
  const ws = frames.map((frame, seq) => ({
    seq,
    url: frame.url,
    direction: frame.direction,
    payload: frame.data,
    delayMs: Math.min(Math.max(frame.time - firstFrameTime, 0), 60_000),
  }));
  return {
    format: "easy-sniff-scenario",
    version: 1,
    meta: {
      id: crypto.randomUUID(),
      name: name.trim() || capture.title || "Untitled scenario",
      createdAt: new Date().toISOString(),
      sourceTitle: capture.title,
    },
    http,
    ws,
    rules: capture.rules.filter((rule) => rule.enabled),
    wsRules: capture.wsRules.filter((rule) => rule.enabled),
  };
}

export function parseScenarioPack(value: unknown): ScenarioPack {
  if (!value || typeof value !== "object")
    throw new Error("Invalid scenario pack");
  const pack = value as ScenarioPack;
  if (
    pack.format !== "easy-sniff-scenario" ||
    pack.version !== 1 ||
    !pack.meta ||
    typeof pack.meta.name !== "string" ||
    !Array.isArray(pack.http) ||
    !Array.isArray(pack.ws) ||
    pack.http.length > 300 ||
    pack.ws.length > 300 ||
    !Array.isArray(pack.rules) ||
    !Array.isArray(pack.wsRules) ||
    new TextEncoder().encode(JSON.stringify(pack)).byteLength > 3_000_000
  )
    throw new Error("Invalid or oversized scenario pack");
  for (const entry of pack.http) {
    const url = new URL(entry.url);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      !/^[A-Z]+$/.test(entry.method) ||
      !Number.isInteger(entry.seq) ||
      !Number.isInteger(entry.status) ||
      entry.status < 100 ||
      entry.status > 599 ||
      typeof entry.responseBody !== "string" ||
      entry.responseBody.length > 24_000 ||
      !entry.responseHeaders ||
      typeof entry.responseHeaders !== "object" ||
      Array.isArray(entry.responseHeaders) ||
      !Object.entries(entry.responseHeaders).every(
        ([key, header]) =>
          /^(content-type|cache-control|access-control-allow-origin|access-control-allow-credentials)$/i.test(
            key,
          ) &&
          typeof header === "string" &&
          header.length <= 2000 &&
          !/[\r\n]/.test(header),
      ) ||
      !Number.isFinite(entry.delayMs) ||
      entry.delayMs < 0 ||
      entry.delayMs > 10_000
    )
      throw new Error("Invalid HTTP entry in scenario pack");
  }
  for (const frame of pack.ws) {
    const url = new URL(frame.url);
    if (
      !["ws:", "wss:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      !Number.isInteger(frame.seq) ||
      !["in", "out"].includes(frame.direction) ||
      typeof frame.payload !== "string" ||
      frame.payload.length > 8000 ||
      !Number.isFinite(frame.delayMs) ||
      frame.delayMs < 0 ||
      frame.delayMs > 60_000
    )
      throw new Error("Invalid WebSocket entry in scenario pack");
  }
  return pack;
}

export function nextScenarioResponse(
  pack: ScenarioPack,
  consumed: Record<string, number>,
  url: string,
  method: string,
) {
  const matches = pack.http.filter(
    (entry) => entry.url === url && entry.method === method,
  );
  if (!matches.length) return { known: false, entry: undefined };
  const key = JSON.stringify([method, url]);
  const index = consumed[key] || 0;
  const entry = matches[index];
  if (entry) consumed[key] = index + 1;
  return { known: true, entry };
}
