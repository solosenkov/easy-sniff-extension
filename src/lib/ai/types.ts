import type {
  CaptureRequest,
  CaptureState,
  Draft,
  Environment,
  Rule,
  WsRule,
} from "../types";
export type AiProvider = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  models: string[];
  timeoutSeconds?: number;
  maxOutputTokens?: number;
};
export type AiSettings = {
  version: 1;
  providers: AiProvider[];
  activeId: string;
};
export const emptyAiSettings = (): AiSettings => ({
  version: 1,
  providers: [],
  activeId: "",
});
export type AiScope = "selected" | "traffic" | "request" | "none";
export type AiContext = {
  scope: AiScope;
  capture: CaptureState;
  selected?: CaptureRequest;
  draft: Draft;
  tabs: { id: number; url: string; title: string }[];
};
export type AiProposal = {
  id: string;
  title: string;
  state: "pending" | "applied";
} & (
  | { kind: "rule"; rule: Rule }
  | { kind: "ws-rule"; rule: WsRule }
  | { kind: "request"; request: Draft }
  | { kind: "environment"; environment: Environment }
  | { kind: "rule-state"; ruleId: string; enabled: boolean }
  | { kind: "capture"; operation: "start" | "stop"; tabId?: number }
  | { kind: "export"; format: "traffic" | "websocket" | "curl"; data: string }
);
export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};
export type AiMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  reasoning_content?: string;
};
export type AiTurn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  steps: string[];
  proposals: AiProposal[];
  error?: string;
};
