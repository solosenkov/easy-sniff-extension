import { t } from "./i18n";
export type Pair = { id: string; enabled: boolean; key: string; value: string };
export type Draft = {
  id: string;
  name: string;
  method: string;
  url: string;
  headers: Pair[];
  body: string;
  bodyType: "json" | "text" | "none";
  token: string;
  credentials: boolean;
  timeout: number;
};
export type ApiResponse = {
  status: number;
  statusText: string;
  duration: number;
  size: number;
  headers: [string, string][];
  body: string;
  url: string;
  truncated?: boolean;
};
export type HistoryEntry = {
  id: string;
  at: number;
  request: Draft;
  response?: ApiResponse;
  error?: string;
};
export type Environment = { id: string; name: string; values: Pair[] };
export type CaptureRequest = {
  id: string;
  requestId: string;
  url: string;
  method: string;
  type: string;
  start: number;
  status?: number;
  duration?: number;
  requestHeaders: Record<string, string>;
  responseHeaders?: Record<string, string>;
  body?: string;
  responseBody?: string;
  error?: string;
  bodyError?: string;
  mime?: string;
  bytes?: number;
  wsState?: "connecting" | "open" | "closed" | "error";
  wsError?: string;
};
export type WsFrame = {
  id: string;
  requestId: string;
  url: string;
  direction: "in" | "out";
  time: number;
  data: string;
  opcode: number;
  synthetic?: boolean;
  truncated?: boolean;
};
export type WsRule = {
  id: string;
  name: string;
  action: "send" | "inject" | "replace";
  enabled: boolean;
  pattern: string;
  contains: string;
  replacement: string;
};
export type Rule = {
  id: string;
  name: string;
  enabled: boolean;
  pattern: string;
  method: string;
  action: "mock" | "block" | "delay" | "headers" | "request";
  request?: { url: string; method: string; body: string; headers: Pair[] };
  sourceWarning?: string;
  status: number;
  body: string;
  delay: number;
  headers: Pair[];
};
export type CaptureState = {
  sessionId?: string;
  tabId: number | null;
  title: string;
  requests: CaptureRequest[];
  frames: WsFrame[];
  rules: Rule[];
  wsRules: WsRule[];
  error: string;
};
export const pair = (key = "", value = ""): Pair => ({
  id: crypto.randomUUID(),
  enabled: true,
  key,
  value,
});
export const newDraft = (): Draft => ({
  id: crypto.randomUUID(),
  name: t("Новый запрос"),
  method: "GET",
  url: "",
  headers: [pair()],
  body: "",
  bodyType: "none",
  token: "",
  credentials: false,
  timeout: 30,
});
export const initialCapture = (): CaptureState => ({
  tabId: null,
  title: "",
  requests: [],
  frames: [],
  rules: [],
  wsRules: [],
  error: "",
});
