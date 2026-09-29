import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  GearSix,
  Plus,
  Robot,
  Stop,
  X,
  ArrowRight,
} from "@phosphor-icons/react";
import { Button, CopyButton, ErrorNote, IconButton } from "./Primitives";
import { AiSettings } from "./AiSettings";
import { t } from "../lib/i18n";
import { isExtension, readStore, rpc, writeStore } from "../lib/storage";
import { boundedData, contextOverview, redactText } from "../lib/ai/context";
import { runAgent } from "../lib/ai/agent";
import {
  emptyAiSettings,
  type AiContext,
  type AiMessage,
  type AiProposal,
  type AiScope,
  type AiSettings as Settings,
  type AiTurn,
} from "../lib/ai/types";
import type { CaptureRequest, CaptureState, Draft } from "../lib/types";
export type AiActionMode = "open" | "save" | "send" | "apply";
export function AiAssistant({
  open,
  onClose,
  capture,
  draft,
  selected,
  selectionVersion,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  capture: CaptureState;
  draft: Draft;
  selected?: CaptureRequest;
  selectionVersion: number;
  onApply: (
    proposal: AiProposal,
    mode: AiActionMode,
    signal: AbortSignal,
  ) => Promise<string>;
}) {
  const [settings, setSettings] = useState<Settings>(emptyAiSettings),
    [ready, setReady] = useState(false),
    [configure, setConfigure] = useState(false);
  const [scope, setScope] = useState<AiScope>(
    selected ? "selected" : "traffic",
  );
  const [turns, setTurns] = useState<AiTurn[]>([]),
    [prompt, setPrompt] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(""),
    [results, setResults] = useState<Record<string, string>>({});
  const controller = useRef<AbortController | null>(null),
    actionController = useRef<AbortController | null>(null),
    history = useRef<AiMessage[]>([]),
    input = useRef<HTMLTextAreaElement>(null),
    bottom = useRef<HTMLDivElement>(null),
    busyRef = useRef(false);
  const active = settings.providers.find((p) => p.id === settings.activeId);
  const keys = settings.providers.map((p) => p.apiKey).filter(Boolean);
  const context: AiContext = { scope, capture, selected, draft, tabs: [] };
  useEffect(() => {
    let alive = true;
    void readStore<Settings>("ai.settings.v1", emptyAiSettings())
      .then((s) => {
        if (!alive) return;
        if (s.version !== 1 || !Array.isArray(s.providers))
          throw new Error(t("Не удалось прочитать настройки ИИ."));
        setSettings(s);
        setReady(true);
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
      controller.current?.abort();
      actionController.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (selected) {
      controller.current?.abort();
      setTurns([]);
      setResults({});
      setScope("selected");
      history.current = [];
    }
  }, [selectionVersion]);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  useEffect(() => {
    if (open) bottom.current?.scrollIntoView({ block: "nearest" });
  }, [turns, busy, open]);
  async function persist(next: Settings) {
    await writeStore("ai.settings.v1", next);
    setSettings(next);
    history.current = [];
    setTurns([]);
    setResults({});
  }
  function reset() {
    controller.current?.abort();
    history.current = [];
    setTurns([]);
    setResults({});
    setError("");
  }
  async function send(value = prompt) {
    if (busyRef.current || !value.trim() || !active) return;
    if (value.length > 12000) {
      setError(t("Сообщение слишком длинное. Максимум 12 000 символов."));
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError("");
    setPrompt("");
    const abort = new AbortController();
    controller.current = abort;
    const id = crypto.randomUUID();
    setTurns((ts) => [
      ...ts.slice(-18),
      {
        id: crypto.randomUUID(),
        role: "user",
        text: value,
        steps: [],
        proposals: [],
      },
      { id, role: "assistant", text: "", steps: [], proposals: [] },
    ]);
    const update = (fn: (turn: AiTurn) => AiTurn) =>
      setTurns((ts) => ts.map((turn) => (turn.id === id ? fn(turn) : turn)));
    try {
      const snapshot = structuredClone(context);
      if (isExtension) {
        const [latest, tabs] = await Promise.all([
          rpc<CaptureState>("capture.get"),
          rpc<AiContext["tabs"]>("capture.tabs"),
        ]);
        snapshot.capture = latest;
        snapshot.tabs = tabs;
        if (snapshot.scope === "selected" && snapshot.selected)
          snapshot.selected =
            latest.requests.find((r) => r.id === snapshot.selected?.id) ||
            snapshot.selected;
      }
      const messages = await runAgent({
        provider: structuredClone(active),
        prompt: value,
        history: history.current,
        context: snapshot,
        refreshCapture: isExtension
          ? () => rpc<CaptureState>("capture.get")
          : undefined,
        keys,
        signal: abort.signal,
        onStep: (label) =>
          update((turn) => ({ ...turn, steps: [...turn.steps, label] })),
        onProposal: (proposal) =>
          update((turn) => ({
            ...turn,
            proposals: [...turn.proposals, proposal],
          })),
        onText: (text) =>
          update((turn) => ({
            ...turn,
            text: turn.text ? turn.text + "\n\n" + text : text,
          })),
      });
      history.current = messages;
    } catch (e) {
      update((turn) => ({
        ...turn,
        error: abort.signal.aborted
          ? t("Генерация остановлена.")
          : e instanceof Error
            ? e.message
            : String(e),
      }));
    } finally {
      busyRef.current = false;
      setBusy(false);
      controller.current = null;
      input.current?.focus();
    }
  }
  async function apply(proposal: AiProposal, mode: AiActionMode) {
    if (applying) return;
    const abort = new AbortController();
    actionController.current = abort;
    setApplying(proposal.id);
    setError("");
    try {
      const result = await onApply(proposal, mode, abort.signal);
      setResults((r) => ({ ...r, [proposal.id]: result }));
      history.current.push({
        role: "user",
        content: `LOCAL APP EVENT: user clicked ${mode} on ${proposal.kind} card ${redactText(proposal.title, keys)}. Result: ${redactText(result.split("\n")[0], keys)}`,
      });
      setTurns((ts) =>
        ts.map((turn) => ({
          ...turn,
          proposals: turn.proposals.map((p) =>
            p.id === proposal.id ? { ...p, state: "applied" } : p,
          ),
        })),
      );
    } catch (e) {
      setError(
        abort.signal.aborted
          ? t("Запрос отменён")
          : e instanceof Error
            ? e.message
            : String(e),
      );
    } finally {
      setApplying("");
      actionController.current = null;
    }
  }
  return (
    <>
      {open && (
        <aside className="ai-panel" aria-label={t("ИИ-помощник")}>
          <header className="ai-panel-header">
            <div>
              <Robot size={21} />
              <strong>{t("ИИ-помощник")}</strong>
              <span className="ai-beta">BETA</span>
            </div>
            <div>
              <IconButton
                icon={Plus}
                label={t("Новый диалог")}
                onClick={reset}
                disabled={busy || !!applying}
              />
              <IconButton
                icon={GearSix}
                label={t("Подключения ИИ")}
                onClick={() => setConfigure(true)}
                disabled={busy || !!applying}
              />
              <IconButton icon={X} label={t("Закрыть ИИ")} onClick={onClose} />
            </div>
          </header>
          {active && (
            <div className="ai-model-bar">
              <select
                aria-label={t("Подключение ИИ")}
                disabled={busy || !!applying}
                value={active.id}
                onChange={(e) =>
                  void persist({ ...settings, activeId: e.target.value }).catch(
                    (e) => setError(String(e)),
                  )
                }
              >
                {settings.providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <input
                aria-label={t("Модель ИИ")}
                list="ai-active-models"
                value={active.model}
                disabled={busy || !!applying}
                onChange={(e) => {
                  const model = e.target.value;
                  setSettings((s) => ({
                    ...s,
                    providers: s.providers.map((p) =>
                      p.id === active.id ? { ...p, model } : p,
                    ),
                  }));
                  history.current = [];
                }}
                onBlur={() =>
                  void writeStore("ai.settings.v1", settings).catch((e) =>
                    setError(String(e)),
                  )
                }
              />
              <datalist id="ai-active-models">
                {[...new Set([active.model, ...active.models])].map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </div>
          )}
          <div className="ai-context-bar">
            <label>
              {t("Контекст")}
              <select
                aria-label={t("Контекст ИИ")}
                value={scope}
                disabled={busy}
                onChange={(e) => {
                  setScope(e.target.value as AiScope);
                  history.current = [];
                }}
              >
                <option value="selected" disabled={!selected}>
                  {t("Выбранный запрос")}
                </option>
                <option value="traffic">
                  {t("Весь захваченный трафик и WebSocket")}
                </option>
                <option value="request">
                  {t("Текущий запрос API-клиента")}
                </option>
                <option value="none">{t("Без трафика")}</option>
              </select>
            </label>
            <details>
              <summary>{t("Что увидит ИИ")}</summary>
              <p>
                {t(
                  "Содержимое выбранного контекста отправляется провайдеру. Auth, cookies и известные ключи маскируются; остальные данные могут быть конфиденциальными.",
                )}
              </p>
              <pre>{boundedData(contextOverview(context, keys), keys)}</pre>
            </details>
          </div>
          <div className="ai-conversation" aria-live="polite">
            {!active ? (
              <div className="ai-welcome">
                <Robot size={32} />
                <h2>{t("Ваш помощник для QA")}</h2>
                <p>
                  {t(
                    "Найдёт нужный запрос, объяснит ответ и подготовит подмену. Подключите модель, которой доверяете.",
                  )}
                </p>
                <Button
                  className="primary"
                  disabled={!ready}
                  onClick={() => setConfigure(true)}
                >
                  {t("Подключить модель")}
                  <ArrowRight size={15} />
                </Button>
              </div>
            ) : turns.length === 0 ? (
              <div className="ai-welcome">
                <h2>{t("Что проверим?")}</h2>
                <p>
                  {t(
                    "Опишите задачу своими словами. Готовые действия появятся здесь — их можно открыть и изменить.",
                  )}
                </p>
                {[
                  "Найди ошибочные запросы и объясни возможную причину.",
                  "Подготовь подмену выбранного запроса на 500.",
                  "Создай API-запрос из выбранного запроса.",
                ].map((example) => (
                  <button
                    className="ai-prompt-example"
                    key={example}
                    onClick={() => {
                      setPrompt(t(example));
                      input.current?.focus();
                    }}
                  >
                    {t(example)}
                    <ArrowRight size={15} />
                  </button>
                ))}
              </div>
            ) : (
              turns.map((turn) => (
                <article key={turn.id} className={`ai-turn ${turn.role}`}>
                  <div className="ai-turn-label">
                    {turn.role === "user" ? t("Вы") : t("ИИ-помощник")}
                    {turn.role === "assistant" && turn.text && (
                      <CopyButton value={turn.text} compact />
                    )}
                  </div>
                  {turn.steps.length > 0 && (
                    <details className="ai-steps">
                      <summary>
                        {t("Действия: {0}", [turn.steps.length])}
                      </summary>
                      {turn.steps.map((step, i) => (
                        <div key={i}>
                          <Check size={12} />
                          {step}
                        </div>
                      ))}
                    </details>
                  )}
                  {turn.text && (
                    <div className="ai-message-text">{turn.text}</div>
                  )}
                  {turn.proposals.map((p) => (
                    <div className="ai-proposal" key={p.id}>
                      <div className="ai-proposal-heading">
                        <strong>{p.title}</strong>
                        <span>
                          {t(p.state === "applied" ? "Готово" : "Черновик")}
                        </span>
                      </div>
                      <p className="ai-proposal-summary">
                        {p.kind === "rule"
                          ? `${p.rule.method} ${p.rule.pattern} · ${p.rule.action}${p.rule.action === "mock" ? " " + p.rule.status : ""}`
                          : p.kind === "ws-rule"
                            ? `WebSocket ${p.rule.pattern} · ${t(p.rule.action === "replace" ? "Подменить входящее" : "Имитировать входящее")}`
                            : p.kind === "request"
                              ? `${p.request.method} ${p.request.url}`
                              : p.kind === "rule-state"
                                ? t(
                                    p.enabled
                                      ? "Включить правило"
                                      : "Отключить правило",
                                  )
                                : p.kind === "environment"
                                  ? t("Окружения")
                                  : p.kind === "capture"
                                    ? t(
                                        p.operation === "start"
                                          ? "Начать запись"
                                          : "Остановить",
                                      )
                                    : t("Экспорт")}
                      </p>
                      <details>
                        <summary>{t("Посмотреть изменения")}</summary>
                        <pre>{boundedData(p, keys)}</pre>
                      </details>
                      <div className="ai-proposal-actions">
                        {p.state === "pending" && (
                          <>
                            <Button
                              className="primary"
                              disabled={!!applying || busy}
                              onClick={() =>
                                void apply(
                                  p,
                                  p.kind === "rule" ||
                                    p.kind === "ws-rule" ||
                                    p.kind === "request"
                                    ? "open"
                                    : "apply",
                                )
                              }
                            >
                              {t(
                                p.kind === "ws-rule"
                                  ? "Открыть сценарий"
                                  : p.kind === "rule"
                                    ? "Открыть правило"
                                    : p.kind === "request"
                                      ? "В API-клиент"
                                      : p.kind === "export"
                                        ? "Скачать"
                                        : "Применить",
                              )}
                            </Button>
                            {p.kind === "request" && (
                              <Button
                                disabled={!!applying || busy}
                                onClick={() => void apply(p, "send")}
                              >
                                {t("Отправить запрос")}
                              </Button>
                            )}
                            {p.kind === "request" && (
                              <Button
                                disabled={!!applying || busy}
                                onClick={() => void apply(p, "save")}
                              >
                                {t("В коллекцию")}
                              </Button>
                            )}
                            {(p.kind === "rule" || p.kind === "ws-rule") && (
                              <Button
                                disabled={!!applying || busy}
                                onClick={() => void apply(p, "save")}
                              >
                                {t("Сохранить выключенным")}
                              </Button>
                            )}
                          </>
                        )}
                        {applying === p.id && (
                          <Button
                            icon={Stop}
                            onClick={() => actionController.current?.abort()}
                          >
                            {t("Отменить")}
                          </Button>
                        )}
                      </div>
                      {results[p.id] && (
                        <pre className="ai-action-result">{results[p.id]}</pre>
                      )}
                    </div>
                  ))}
                  <ErrorNote error={turn.error || ""} />
                </article>
              ))
            )}
            {busy && (
              <div className="ai-working" role="status">
                <span />
                {t("Помощник работает…")}
              </div>
            )}
            <div ref={bottom} />
          </div>
          <ErrorNote error={error} />
          <form
            className="ai-composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <textarea
              ref={input}
              aria-label={t("Сообщение ИИ")}
              placeholder={t("Например: верни 500 для запроса спринтов…")}
              value={prompt}
              disabled={!active || busy}
              maxLength={12000}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <div>
              <span>{t("Enter — отправить · Shift+Enter — новая строка")}</span>
              {busy ? (
                <IconButton
                  icon={Stop}
                  label={t("Остановить ИИ")}
                  onClick={() => controller.current?.abort()}
                />
              ) : (
                <IconButton
                  icon={ArrowUp}
                  label={t("Отправить ИИ")}
                  disabled={!active || !prompt.trim() || !ready}
                  onClick={() => void send()}
                />
              )}
            </div>
          </form>
        </aside>
      )}
      {configure && (
        <AiSettings
          settings={settings}
          onSave={persist}
          onClose={() => setConfigure(false)}
        />
      )}
    </>
  );
}
