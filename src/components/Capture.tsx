import { t, currentLocale } from "../lib/i18n";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowRight,
  Broadcast,
  DownloadSimple,
  Globe,
  Play,
  PlugsConnected,
  Stop,
  Trash,
  ArrowsClockwise,
  PencilSimple,
  Robot,
} from "@phosphor-icons/react";
import {
  Button,
  CopyButton,
  Empty,
  ErrorNote,
  IconButton,
  Tabs,
} from "./Primitives";
import { Editor } from "./Editor";
import {
  type CaptureState,
  type CaptureRequest,
  type Draft,
  type Rule,
  type WsRule,
  newDraft,
  pair,
} from "../lib/types";
import { download, isExtension, rpc } from "../lib/storage";
import { pretty } from "../lib/decoders";
import { ruleFromCapture } from "../lib/capture-rule";
import { socketTopics, trafficKind, type TrafficKind } from "../lib/network";
type BrowserTab = { id: number; title: string; url: string };
export function Capture({
  state,
  setState,
  websocket = false,
  initialWsRule,
  onReplay,
  onModify,
  onAi,
  onDecode,
}: {
  state: CaptureState;
  setState: (s: CaptureState) => void;
  websocket?: boolean;
  initialWsRule?: WsRule | null;
  onReplay: (d: Draft) => void;
  onModify: (rule: Rule) => void;
  onAi: (request: CaptureRequest) => void;
  onDecode: (text: string) => void;
}) {
  const [tabs, setTabs] = useState<BrowserTab[]>([]);
  const [target, setTarget] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState("");
  const [detailTab, setDetailTab] = useState("response");
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [direction, setDirection] = useState("all");
  const [kind, setKind] = useState<TrafficKind>("all");
  const [socketId, setSocketId] = useState("");
  const [wsMode, setWsMode] = useState<"send" | "inject" | "replace">("send");
  const [wsPayload, setWsPayload] = useState("");
  const [wsRuleId, setWsRuleId] = useState("");
  const [wsName, setWsName] = useState("");
  const [wsPattern, setWsPattern] = useState("");
  const [wsContains, setWsContains] = useState("");
  const [wsNotice, setWsNotice] = useState("");
  const wsLabRef = useRef<HTMLDetailsElement>(null);
  const wsPayloadRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!websocket || !initialWsRule) return;
    setWsMode(initialWsRule.action);
    setWsRuleId("");
    setWsName(initialWsRule.name);
    setWsPattern(initialWsRule.pattern);
    setWsContains(initialWsRule.contains);
    setWsPayload(initialWsRule.replacement);
    const matchingSocket = state.requests.find(
      (request) =>
        request.type === "WebSocket" &&
        request.url === initialWsRule.pattern &&
        request.wsState === "open",
    );
    if (matchingSocket) setSocketId(matchingSocket.requestId);
    if (wsLabRef.current) wsLabRef.current.open = true;
    requestAnimationFrame(() => {
      wsLabRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      wsPayloadRef.current?.focus({ preventScroll: true });
    });
  }, [websocket, initialWsRule]);
  async function refresh() {
    if (!isExtension) return;
    try {
      const list = await rpc<BrowserTab[]>("capture.tabs");
      setTabs(list);
      if (!target && list.length) setTarget(String(list[0].id));
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  async function action(type: string, data = {}) {
    setBusy(true);
    setError("");
    setWsNotice("");
    try {
      setState(await rpc<CaptureState>(type, data));
      if (type === "capture.ws.send")
        setWsNotice(t("Сообщение отправлено серверу."));
      if (type === "capture.ws.inject")
        setWsNotice(t("Тестовое сообщение доставлено странице."));
      if (type === "capture.ws.rules")
        setWsNotice(t("Правила WebSocket сохранены."));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const rows = state.requests.filter(
    (r) =>
      (!onlyErrors || !!r.error || (r.status ?? 0) >= 400) &&
      (kind === "all" || trafficKind(r) === kind) &&
      `${r.url} ${r.method} ${r.status ?? ""}`
        .toLowerCase()
        .includes(filter.toLowerCase()),
  );
  const query = filter.toLowerCase();
  const sockets = state.requests.filter(
    (r) =>
      trafficKind(r) === "ws" &&
      (`${r.url} ${socketTopics(r.url).join(" ")}`
        .toLowerCase()
        .includes(query) ||
        state.frames.some(
          (f) =>
            f.requestId === r.requestId && f.data.toLowerCase().includes(query),
        )),
  );
  const socket = sockets.find((r) => r.id === socketId) || sockets[0];
  const socketMatches =
    socket &&
    `${socket.url} ${socketTopics(socket.url).join(" ")}`
      .toLowerCase()
      .includes(query);
  const frames = state.frames.filter(
    (f) =>
      (!socket || f.requestId === socket.requestId) &&
      (direction === "all" || f.direction === direction) &&
      (socketMatches || `${f.url} ${f.data}`.toLowerCase().includes(query)),
  );
  const request = state.requests.find((r) => r.id === selected);
  const frame = frames.find((f) => f.id === selected);
  const wsRules = state.wsRules || [];
  function editWsRule(rule: WsRule) {
    setWsMode(rule.action);
    setWsRuleId(rule.id);
    setWsName(rule.name);
    setWsPattern(rule.pattern);
    setWsContains(rule.contains);
    setWsPayload(rule.replacement);
  }
  function resetWsRule() {
    setWsRuleId("");
    setWsName("");
    setWsPattern(socket?.url || "");
    setWsContains("");
    setWsPayload("");
  }
  function useFrameInScenario(frame: { data: string; url: string }) {
    setWsRuleId("");
    setWsName("");
    setWsPattern(frame.url);
    setWsContains("");
    setWsPayload(frame.data);
    setWsMode("inject");
    setError("");
    setWsNotice("");
    if (wsLabRef.current) wsLabRef.current.open = true;
    requestAnimationFrame(() => {
      wsLabRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      wsPayloadRef.current?.focus({ preventScroll: true });
    });
  }
  function saveWsRule() {
    const next: WsRule = {
      id: wsRuleId || crypto.randomUUID(),
      name: wsName,
      action: wsMode,
      enabled:
        wsMode === "replace" &&
        (wsRules.find((r) => r.id === wsRuleId)?.enabled || false),
      pattern: wsPattern,
      contains: wsMode === "replace" ? wsContains : "",
      replacement: wsPayload,
    };
    void action("capture.ws.rules", {
      rules: wsRuleId
        ? wsRules.map((r) => (r.id === wsRuleId ? next : r))
        : [...wsRules, next],
    });
  }
  return (
    <div className="page capture-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">{t("ЖИВОЙ ТРАФИК")}</span>
          <h1>{websocket ? "WebSocket" : t("Сетевой журнал")}</h1>
          <p>
            {websocket
              ? t("Сообщения настоящих соединений приложения.")
              : t("Запросы выбранной вкладки, от отправки до ответа.")}
          </p>
        </div>
        <Button
          icon={DownloadSimple}
          onClick={() =>
            download(
              websocket ? "websocket.json" : "network.json",
              JSON.stringify(
                websocket
                  ? {
                      connections: state.requests.filter(
                        (r) => trafficKind(r) === "ws",
                      ),
                      frames: state.frames,
                    }
                  : state.requests,
                null,
                2,
              ),
            )
          }
        >
          {t("Экспорт JSON")}
        </Button>
      </div>
      {!isExtension && (
        <div className="preview-note">
          {t(
            "Это браузерное превью. Для захвата трафика загрузите папку dist как расширение в chrome://extensions.",
          )}
        </div>
      )}
      <div className="capture-controls">
        <Globe size={18} />
        <select
          aria-label={t("Вкладка для захвата")}
          value={state.tabId !== null ? String(state.tabId) : target}
          disabled={state.tabId !== null}
          onChange={(e) => setTarget(e.target.value)}
        >
          <option value="">{t("Выберите вкладку")}</option>
          {tabs.map((t) => (
            <option value={t.id} key={t.id}>
              {t.title} · {t.url}
            </option>
          ))}
        </select>
        <CopyButton
          compact
          value={
            tabs.find((tab) => String(tab.id) === String(state.tabId ?? target))
              ?.url || ""
          }
          label={t("Копировать URL вкладки")}
        />
        <IconButton
          icon={ArrowsClockwise}
          label={t("Обновить вкладки")}
          onClick={() => void refresh()}
        />
        <Button
          className={state.tabId !== null ? "recording" : "primary"}
          icon={state.tabId !== null ? Stop : Play}
          disabled={!isExtension || busy || (!target && state.tabId === null)}
          onClick={() =>
            void action(
              state.tabId !== null ? "capture.stop" : "capture.start",
              { tabId: Number(target) },
            )
          }
        >
          {state.tabId !== null ? t("Остановить") : t("Начать запись")}
        </Button>
      </div>
      <ErrorNote error={error || state.error} />
      <div className="capture-filter">
        <input
          aria-label={t("Поиск в трафике")}
          placeholder={
            websocket
              ? t("Найти в сообщениях или URL…")
              : t("Найти по URL, методу или статусу…")
          }
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {websocket ? (
          <select
            aria-label={t("Направление сообщений")}
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
          >
            <option value="all">{t("Все направления")}</option>
            <option value="in">{t("Входящие")}</option>
            <option value="out">{t("Исходящие")}</option>
          </select>
        ) : (
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={onlyErrors}
              onChange={(e) => setOnlyErrors(e.target.checked)}
            />{" "}
            {t("Только ошибки")}
          </label>
        )}
        <span className="muted">
          {websocket ? frames.length : rows.length} {t("записей")}
        </span>
        <IconButton
          icon={Trash}
          label={t("Очистить журнал HTTP и WS")}
          disabled={!isExtension}
          onClick={() => void action("capture.clear")}
        />
      </div>
      {!websocket && (
        <div
          className="traffic-kinds"
          role="group"
          aria-label={t("Тип запроса")}
        >
          {(
            [
              "all",
              "xhr",
              "fetch",
              "ws",
              "image",
              "document",
              "script",
              "style",
              "other",
            ] as const
          ).map((value) => (
            <button
              key={value}
              type="button"
              className={kind === value ? "active" : ""}
              aria-pressed={kind === value}
              onClick={() => setKind(value)}
            >
              {value === "all"
                ? t("Все")
                : value === "image"
                  ? t("Изображения")
                  : value === "document"
                    ? t("Документы")
                    : value === "script"
                      ? t("Скрипты")
                      : value === "style"
                        ? t("Стили")
                        : value === "other"
                          ? t("Прочее")
                          : value === "ws"
                            ? "WS"
                            : value.toUpperCase()}
            </button>
          ))}
        </div>
      )}
      {websocket && (
        <details className="ws-lab" ref={wsLabRef}>
          <summary className="ws-lab-heading">
            <div>
              <strong>{t("Сценарии WebSocket")}</strong>
              <p>
                {t(
                  "Работают с соединениями страницы, открытыми после начала записи. При необходимости обновите сайт.",
                )}
              </p>
            </div>
            <span>
              {socket ? new URL(socket.url).host : t("Выберите соединение")}
            </span>
          </summary>
          <div
            className="ws-modes"
            role="group"
            aria-label={t("Тип сценария WebSocket")}
          >
            {(["send", "inject", "replace"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={wsMode === mode ? "active" : ""}
                onClick={() => {
                  setWsMode(mode);
                  setWsRuleId("");
                  setError("");
                  setWsNotice("");
                  setWsPattern(socket?.url || "");
                }}
              >
                {t(
                  mode === "send"
                    ? "Отправить на сервер"
                    : mode === "inject"
                      ? "Имитировать входящее"
                      : "Подменить входящее",
                )}
              </button>
            ))}
          </div>
          <div className="ws-rule-fields">
            <label>
              {t("Название правила")}
              <input
                value={wsName}
                onChange={(e) => setWsName(e.target.value)}
                placeholder={t("Например: подмена события страницы")}
              />
            </label>
            <label>
              {t("URL-шаблон соединения")}
              <input
                value={wsPattern}
                onChange={(e) => setWsPattern(e.target.value)}
                placeholder={socket?.url || "wss://example.com/*"}
              />
            </label>
            {wsMode === "replace" && (
              <label>
                {t("Текст в исходном сообщении (необязательно)")}
                <input
                  value={wsContains}
                  onChange={(e) => setWsContains(e.target.value)}
                  placeholder={t("Пусто — все входящие текстовые сообщения")}
                />
              </label>
            )}
          </div>
          <label className="ws-payload-label">
            {t(wsMode === "replace" ? "Новое сообщение" : "Текст сообщения")}
            <textarea
              ref={wsPayloadRef}
              value={wsPayload}
              onChange={(e) => setWsPayload(e.target.value)}
              spellCheck={false}
              placeholder={'{"type":"test"}'}
            />
          </label>
          <div className="ws-lab-footer">
            <p className="muted">
              {t(
                wsMode === "send"
                  ? "Отправка попадёт на сервер через сокет страницы."
                  : wsMode === "inject"
                    ? "Событие увидит приложение; на сервер оно не отправляется."
                    : "Первое включённое совпадение заменит будущий текстовый кадр только для приложения. В журнале останется исходный сетевой кадр.",
              )}
            </p>
            <div className="ws-lab-actions">
              {wsRuleId && (
                <Button onClick={resetWsRule}>{t("Новое правило")}</Button>
              )}
              <Button
                disabled={busy || !wsPattern || !wsName || !wsPayload}
                onClick={saveWsRule}
              >
                {t(
                  wsMode === "replace"
                    ? "Сохранить правило"
                    : "Сохранить сценарий",
                )}
              </Button>
              {wsMode !== "replace" && (
                <Button
                  className="primary"
                  disabled={
                    busy || !socket || socket.wsState !== "open" || !wsPayload
                  }
                  onClick={() =>
                    void action(
                      wsMode === "send"
                        ? "capture.ws.send"
                        : "capture.ws.inject",
                      { requestId: socket?.requestId, data: wsPayload },
                    )
                  }
                >
                  {t(
                    wsMode === "send"
                      ? "Отправить сообщение"
                      : "Показать приложению",
                  )}
                </Button>
              )}
            </div>
          </div>
          {wsNotice && <div className="inline-hint">{wsNotice}</div>}
          {wsRules.length > 0 && (
            <div className="ws-rule-list">
              <span className="eyebrow">{t("Сохранённые WS-сценарии")}</span>
              {wsRules.map((rule) => (
                <div className="ws-rule-row" key={rule.id}>
                  {rule.action === "replace" ? (
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      disabled={busy}
                      aria-label={t("Включить {0}", [rule.name])}
                      onChange={(e) =>
                        void action("capture.ws.rules", {
                          rules: wsRules.map((r) =>
                            r.id === rule.id
                              ? { ...r, enabled: e.target.checked }
                              : r,
                          ),
                        })
                      }
                    />
                  ) : (
                    <Button
                      disabled={busy || !socket || socket.wsState !== "open"}
                      onClick={() =>
                        void action(
                          rule.action === "send"
                            ? "capture.ws.send"
                            : "capture.ws.inject",
                          { requestId: socket?.requestId, ruleId: rule.id },
                        )
                      }
                    >
                      {t("Запустить")}
                    </Button>
                  )}
                  <button type="button" onClick={() => editWsRule(rule)}>
                    <strong>{rule.name}</strong>
                    <small>
                      {t(
                        rule.action === "send"
                          ? "Отправить на сервер"
                          : rule.action === "inject"
                            ? "Имитировать входящее"
                            : "Подменить входящее",
                      )}{" "}
                      · {rule.pattern}
                      {rule.contains ? ` · ${rule.contains}` : ""}
                    </small>
                  </button>
                  <IconButton
                    icon={Trash}
                    label={t("Удалить {0}", [rule.name])}
                    disabled={busy}
                    onClick={() =>
                      void action("capture.ws.rules", {
                        rules: wsRules.filter((r) => r.id !== rule.id),
                      })
                    }
                  />
                </div>
              ))}
            </div>
          )}
        </details>
      )}
      <div className="capture-content">
        <div className="traffic-list">
          {websocket ? (
            sockets.length ? (
              <>
                <div className="socket-section-label">
                  {t("Соединения")} · {sockets.length}
                </div>
                {sockets.map((connection) => (
                  <button
                    type="button"
                    key={connection.id}
                    className={`socket-row ${socket?.id === connection.id ? "selected" : ""}`}
                    onClick={() => {
                      setSocketId(connection.id);
                      setSelected("");
                      if (!wsRuleId) setWsPattern(connection.url);
                    }}
                  >
                    <span
                      className={`socket-state ${connection.wsState || (connection.status === 101 ? "open" : "connecting")}`}
                    />
                    <span className="socket-row-content">
                      <strong>
                        {(() => {
                          try {
                            return new URL(connection.url).host;
                          } catch {
                            return connection.url;
                          }
                        })()}
                      </strong>
                      <small>{connection.url}</small>
                      <small>
                        {socketTopics(connection.url).length
                          ? socketTopics(connection.url).join(" · ")
                          : t("Топики в URL не указаны")}
                      </small>
                    </span>
                    <span className="socket-frame-count">
                      {
                        state.frames.filter(
                          (f) => f.requestId === connection.requestId,
                        ).length
                      }
                    </span>
                  </button>
                ))}
                <div className="socket-section-label">
                  {t("Сообщения")} · {frames.length}
                </div>
                {frames.length ? (
                  frames.map((f) => (
                    <button
                      className={`frame-row ${selected === f.id ? "selected" : ""}`}
                      key={f.id}
                      onClick={() => setSelected(f.id)}
                    >
                      {f.direction === "in" ? (
                        <ArrowDown size={16} className="success-text" />
                      ) : (
                        <ArrowUp size={16} />
                      )}
                      <span>
                        <code>{f.data.slice(0, 110)}</code>
                        <small>{f.url}</small>
                      </span>
                      <time>
                        {new Date(f.time).toLocaleTimeString(currentLocale())}
                      </time>
                    </button>
                  ))
                ) : (
                  <div className="socket-no-frames">
                    {t(
                      "Соединение найдено. Сообщений пока нет. Если оно открылось до начала записи, обновите тестируемую вкладку.",
                    )}
                  </div>
                )}
              </>
            ) : (
              <Empty icon={Broadcast} title={t("Слушаем, когда вы готовы")}>
                <p>
                  {t("Начните запись и откройте WebSocket-соединение")}
                  <br />
                  {t("в тестируемой вкладке. При необходимости обновите её.")}
                </p>
              </Empty>
            )
          ) : rows.length ? (
            <table className="network-table">
              <thead>
                <tr>
                  <th>{t("Метод")}</th>
                  <th>{t("Запрос")}</th>
                  <th>{t("Статус")}</th>
                  <th>{t("Время")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className={selected === r.id ? "selected" : ""}
                  >
                    <td>
                      <span className={`method ${r.method.toLowerCase()}`}>
                        {r.method}
                      </span>
                    </td>
                    <td>
                      <button onClick={() => setSelected(r.id)} title={r.url}>
                        {r.url}
                        <small>{r.type}</small>
                      </button>
                    </td>
                    <td
                      className={
                        r.error || (r.status ?? 0) >= 400
                          ? "danger-text"
                          : "success-text"
                      }
                    >
                      {r.error ? t("Ошибка") : (r.status ?? "…")}
                    </td>
                    <td>
                      {r.duration !== undefined
                        ? t("{0} мс", [r.duration])
                        : "…"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty
              icon={PlugsConnected}
              title={t("Подключите рабочую вкладку")}
            >
              <p>
                {t("Выберите страницу и начните запись.")}
                <br />
                {t("Здесь появятся её новые HTTP-запросы.")}
              </p>
            </Empty>
          )}
        </div>
        {(request || frame || (websocket && socket)) && (
          <section className="traffic-detail">
            {websocket && frame ? (
              <>
                <div className="section-toolbar">
                  <span>
                    {frame.direction === "in" ? t("Входящее") : t("Исходящее")}{" "}
                    · opcode {frame.opcode}
                    {frame.synthetic ? ` · ${t("имитация")}` : ""}
                  </span>
                  <Button
                    disabled={frame.truncated}
                    onClick={() => useFrameInScenario(frame)}
                  >
                    {t("В сценарий")}
                  </Button>
                  <Button onClick={() => onDecode(frame.data)}>
                    {t("В декодер")}
                    <ArrowRight size={14} />
                  </Button>
                </div>
                <div className="inline-hint">{frame.url}</div>
                {frame.truncated && (
                  <div className="warning-note">
                    {t(
                      "Кадр обрезан до 8000 символов; использовать его как готовое сообщение нельзя.",
                    )}
                  </div>
                )}
                <CopyButton value={frame.data} />
                <Editor
                  value={pretty(frame.data)}
                  readOnly
                  label={t("Сообщение WebSocket")}
                />
              </>
            ) : websocket && socket ? (
              <>
                <div className="section-toolbar">
                  <strong>{t("Соединение WebSocket")}</strong>
                  <span>
                    {t(
                      socket.wsState === "closed"
                        ? "Закрыто"
                        : socket.wsState === "error"
                          ? "Ошибка"
                          : socket.wsState === "open" || socket.status === 101
                            ? "Открыто"
                            : "Подключение",
                    )}
                  </span>
                </div>
                <div className="detail-url-row">
                  <div className="detail-url">{socket.url}</div>
                  <CopyButton
                    compact
                    value={socket.url}
                    label={t("Копировать URL")}
                  />
                </div>
                {socket.wsError && <ErrorNote error={socket.wsError} />}
                <div className="socket-detail-block">
                  <span className="eyebrow">{t("Топики в URL")}</span>
                  {socketTopics(socket.url).length ? (
                    <div className="socket-topics">
                      {socketTopics(socket.url).map((topic) => (
                        <code key={topic}>{topic}</code>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">{t("Топики в URL не указаны")}</p>
                  )}
                </div>
                <div className="socket-detail-block">
                  <span className="eyebrow">{t("Рукопожатие")}</span>
                  <p className="muted">HTTP {socket.status ?? "…"}</p>
                  <pre>
                    {JSON.stringify(
                      {
                        request: socket.requestHeaders,
                        response: socket.responseHeaders,
                      },
                      null,
                      2,
                    )}
                  </pre>
                </div>
              </>
            ) : request ? (
              <>
                <div className="section-toolbar capture-detail-toolbar">
                  <span className={`method ${request.method.toLowerCase()}`}>
                    {request.method}
                  </span>
                  <div className="capture-detail-actions">
                    <Button icon={Robot} onClick={() => onAi(request)}>
                      {t("Спросить ИИ")}
                    </Button>
                    <Button
                      className="primary"
                      icon={PencilSimple}
                      onClick={() => onModify(ruleFromCapture(request))}
                    >
                      {t("Модифицировать")}
                    </Button>
                    <Button
                      onClick={() => {
                        const d = newDraft();
                        Object.assign(d, {
                          name: new URL(request.url).pathname,
                          url: request.url,
                          method: request.method,
                          body: request.body || "",
                          bodyType: request.body ? "text" : "none",
                          headers: Object.entries(request.requestHeaders)
                            .filter(
                              ([k]) =>
                                !k.startsWith(":") &&
                                !/^(host|cookie|content-length|origin|referer|connection|accept-encoding|user-agent|sec-.*)$/i.test(
                                  k,
                                ),
                            )
                            .map(([k, v]) => pair(k, v)),
                        });
                        onReplay(d);
                      }}
                    >
                      {t("В API-клиент")}
                      <ArrowRight size={14} />
                    </Button>
                  </div>
                </div>
                <div className="detail-url-row">
                  <div className="detail-url">{request.url}</div>
                  <CopyButton
                    compact
                    value={request.url}
                    label={t("Копировать URL")}
                  />
                </div>
                <Tabs
                  value={detailTab}
                  onChange={setDetailTab}
                  items={[
                    { id: "response", label: t("Ответ") },
                    { id: "request", label: t("Запрос") },
                    { id: "headers", label: t("Заголовки") },
                  ]}
                />
                <div className="capture-copy-toolbar">
                  <span>
                    {detailTab === "response"
                      ? t("Тело ответа")
                      : detailTab === "request"
                        ? t("Тело запроса")
                        : t("Заголовки")}
                  </span>
                  <CopyButton
                    value={
                      detailTab === "response"
                        ? (request.responseBody ?? "")
                        : detailTab === "request"
                          ? (request.body ?? "")
                          : JSON.stringify(
                              {
                                request: request.requestHeaders,
                                response: request.responseHeaders,
                              },
                              null,
                              2,
                            )
                    }
                    label={
                      detailTab === "response"
                        ? t("Копировать ответ")
                        : detailTab === "request"
                          ? t("Копировать тело")
                          : t("Копировать заголовки")
                    }
                  />
                </div>
                <ErrorNote error={request.error || ""} />
                {detailTab === "response" ? (
                  <>
                    {request.bodyError && (
                      <div className="inline-hint">{request.bodyError}</div>
                    )}
                    <Editor
                      value={pretty(request.responseBody || "")}
                      readOnly
                      label={t("Перехваченный ответ")}
                    />
                  </>
                ) : detailTab === "request" ? (
                  <Editor
                    value={pretty(request.body || "")}
                    readOnly
                    label={t("Перехваченный запрос")}
                  />
                ) : (
                  <Editor
                    value={JSON.stringify(
                      {
                        request: request.requestHeaders,
                        response: request.responseHeaders,
                      },
                      null,
                      2,
                    )}
                    readOnly
                    label={t("Перехваченные заголовки")}
                  />
                )}
              </>
            ) : null}
          </section>
        )}
      </div>
      <div className="capture-footnote">
        <span className={state.tabId !== null ? "success-text" : ""}>
          {state.tabId !== null ? t("● Запись идёт") : t("Запись остановлена")}
        </span>
        <span>
          {t(
            "Буфер: 300 запросов · 300 WS-сообщений. Захват основного target вкладки.",
          )}
        </span>
      </div>
    </div>
  );
}
