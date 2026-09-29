import { t } from "../lib/i18n";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  BracketsCurly,
  CheckCircle,
  Clock,
  Code,
  DownloadSimple,
  FloppyDisk,
  Play,
  Plus,
  Stop,
  TerminalWindow,
  X,
} from "@phosphor-icons/react";
import { Editor } from "./Editor";
import {
  Button,
  CopyButton,
  Empty,
  ErrorNote,
  IconButton,
  PairEditor,
  Tabs,
} from "./Primitives";
import {
  pair,
  type Draft,
  type ApiResponse,
  type Environment,
  type HistoryEntry,
} from "../lib/types";
import { sendRequest } from "../lib/request";
import { pretty } from "../lib/decoders";
import { download } from "../lib/storage";
export function ApiClient({
  active,
  drafts,
  setDrafts,
  activeId,
  setActiveId,
  environment,
  onImport,
  onSave,
  onHistory,
  onExport,
}: {
  active: boolean;
  drafts: Draft[];
  setDrafts: React.Dispatch<React.SetStateAction<Draft[]>>;
  activeId: string;
  setActiveId: (id: string) => void;
  environment?: Environment;
  onImport: () => void;
  onSave: (d: Draft) => void;
  onHistory: (h: HistoryEntry) => void;
  onExport: (d: Draft) => void;
}) {
  const draft = drafts.find((d) => d.id === activeId) || drafts[0];
  const [tab, setTab] = useState("body");
  const [responseTab, setResponseTab] = useState("body");
  const [results, setResults] = useState<Record<string, ApiResponse>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const result = results[draft.id];
  const error = errors[draft.id] || "";
  const update = (change: Partial<Draft>) =>
    setDrafts((ds) =>
      ds.map((d) => (d.id === draft.id ? { ...d, ...change } : d)),
    );
  async function send() {
    if (pending) return;
    const request = structuredClone(draft);
    const abort = new AbortController();
    controller.current = abort;
    setPending(request.id);
    setErrors((e) => ({ ...e, [request.id]: "" }));
    setResults((r) => {
      const next = { ...r };
      delete next[request.id];
      return next;
    });
    try {
      const response = await sendRequest(request, environment, abort.signal);
      setResults((r) => ({ ...r, [request.id]: response }));
      onHistory({ id: crypto.randomUUID(), at: Date.now(), request, response });
    } catch (e) {
      const message = abort.signal.aborted
        ? t("Запрос отменён")
        : e instanceof Error
          ? e.message
          : String(e);
      setErrors((r) => ({ ...r, [request.id]: message }));
      onHistory({
        id: crypto.randomUUID(),
        at: Date.now(),
        request,
        error: message,
      });
    } finally {
      setPending(null);
      controller.current = null;
    }
  }
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!active) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void send();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        onSave(draft);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  let params: [string, string][] = [];
  try {
    params = [...new URL(draft.url).searchParams.entries()];
  } catch {
    /* URL may contain variables. */
  }
  return (
    <div className="api-workspace">
      <div className="request-tabbar">
        {drafts.map((d) => (
          <div
            className={`request-tab ${draft.id === d.id ? "active" : ""}`}
            key={d.id}
          >
            <button onClick={() => setActiveId(d.id)}>
              <span className={`method ${d.method.toLowerCase()}`}>
                {d.method}
              </span>
              <span>{d.name}</span>
            </button>
            {drafts.length > 1 && (
              <IconButton
                icon={X}
                label={t("Закрыть {0}", [d.name])}
                disabled={pending === d.id}
                onClick={() => {
                  setDrafts((ds) => ds.filter((x) => x.id !== d.id));
                  if (d.id === activeId)
                    setActiveId(drafts.find((x) => x.id !== d.id)!.id);
                }}
              />
            )}
          </div>
        ))}
        <IconButton
          icon={Plus}
          label={t("Новый запрос")}
          onClick={() => {
            const d = {
              ...draft,
              id: crypto.randomUUID(),
              name: t("Новый запрос"),
              url: "",
              method: "GET",
              body: "",
              bodyType: "none" as const,
              token: "",
              headers: [pair()],
            };
            setDrafts((ds) => [...ds, d]);
            setActiveId(d.id);
          }}
        />
      </div>
      <div className="request-heading">
        <div>
          <span className="eyebrow">{t("API-КЛИЕНТ")}</span>
          <input
            className="request-name"
            aria-label={t("Название запроса")}
            value={draft.name}
            onChange={(e) => update({ name: e.target.value })}
          />
        </div>
        <div className="actions">
          <Button icon={TerminalWindow} onClick={onImport}>
            {t("Импорт cURL")}
          </Button>
          <Button icon={FloppyDisk} onClick={() => onSave(draft)}>
            {t("Сохранить")}
          </Button>
        </div>
      </div>
      <div className="url-bar">
        <select
          aria-label={t("HTTP метод")}
          className={`method-select ${draft.method.toLowerCase()}`}
          value={draft.method}
          onChange={(e) => update({ method: e.target.value })}
        >
          {["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map(
            (m) => (
              <option key={m}>{m}</option>
            ),
          )}
        </select>
        <input
          aria-label={t("URL запроса")}
          placeholder={t(
            "https://api.example.com/v1/users или {{base_url}}/users",
          )}
          value={draft.url}
          onChange={(e) => update({ url: e.target.value })}
          spellCheck={false}
        />
        <Button
          className={`primary ${pending === draft.id ? "sending" : ""}`}
          icon={pending === draft.id ? Stop : ArrowRight}
          disabled={!!pending && pending !== draft.id}
          onClick={() =>
            pending === draft.id ? controller.current?.abort() : void send()
          }
        >
          {pending === draft.id ? t("Отменить") : t("Отправить")}
          <kbd>⌘ ↵</kbd>
        </Button>
      </div>
      <div className="request-context">
        <span>
          <span className="small-dot" />{" "}
          {environment ? environment.name : t("Без окружения")}
        </span>
        <button onClick={() => onExport(draft)}>
          <Code size={13} />
          {t("Получить cURL")}
          <ArrowUpRight size={12} />
        </button>
      </div>
      <div className="editor-split">
        <section className="request-panel">
          <div className="panel-top">
            <span className="panel-label">{t("Запрос")}</span>
          </div>
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { id: "body", label: t("Тело") },
              { id: "params", label: t("Параметры"), count: params.length },
              {
                id: "headers",
                label: t("Заголовки"),
                count: draft.headers.filter((h) => h.enabled && h.key).length,
              },
              { id: "auth", label: t("Авторизация") },
              { id: "settings", label: t("Опции") },
            ]}
          />
          <div className="editor-content">
            {tab === "body" && (
              <>
                <div className="editor-toolbar">
                  <select
                    aria-label={t("Формат тела")}
                    value={draft.bodyType}
                    onChange={(e) =>
                      update({ bodyType: e.target.value as Draft["bodyType"] })
                    }
                  >
                    <option value="none">{t("Без тела")}</option>
                    <option value="json">JSON</option>
                    <option value="text">{t("Текст / form-urlencoded")}</option>
                  </select>
                  {draft.bodyType !== "none" && (
                    <Button
                      icon={BracketsCurly}
                      className="quiet"
                      onClick={() => {
                        try {
                          update({
                            body: JSON.stringify(
                              JSON.parse(draft.body),
                              null,
                              2,
                            ),
                          });
                          setErrors((x) => ({ ...x, [draft.id]: "" }));
                        } catch {
                          setErrors((x) => ({
                            ...x,
                            [draft.id]: t("Тело не является корректным JSON"),
                          }));
                        }
                      }}
                    >
                      {t("Форматировать")}
                    </Button>
                  )}
                </div>
                {draft.bodyType === "none" ? (
                  <Empty icon={Code} title={t("У этого запроса нет тела")}>
                    <p>
                      {t("Параметры можно передать в URL,")}
                      <br />
                      {t("а метаданные в заголовках.")}
                    </p>
                    <Button onClick={() => setTab("params")}>
                      {t("Добавить параметры")}
                      <ArrowRight size={14} />
                    </Button>
                  </Empty>
                ) : (
                  <Editor
                    value={draft.body}
                    onChange={(body) => update({ body })}
                    label={t("Тело запроса")}
                    language={draft.bodyType}
                  />
                )}
              </>
            )}
            {tab === "headers" && (
              <>
                <div className="inline-hint">
                  {t("Используйте")} <code>{t("{{переменная}}")}</code>{" "}
                  {t("для значений из окружения.")}
                </div>
                <PairEditor
                  rows={draft.headers}
                  onChange={(headers) => update({ headers })}
                />
              </>
            )}
            {tab === "params" && (
              <QueryEditor
                key={draft.id}
                url={draft.url}
                onChange={(url) => update({ url })}
              />
            )}
            {tab === "auth" && (
              <div className="form-stack">
                <label>
                  {t("Bearer-токен")}
                  <input
                    type="password"
                    placeholder={t("Токен или {{access_token}}")}
                    value={draft.token}
                    onChange={(e) => update({ token: e.target.value })}
                  />
                </label>
                <p className="muted">
                  {t(
                    "Добавит Authorization: Bearer. Для Basic и других схем используйте вкладку «Заголовки».",
                  )}
                </p>
              </div>
            )}
            {tab === "settings" && (
              <div className="form-stack">
                <label>
                  {t("Таймаут, секунды")}
                  <input
                    type="number"
                    min="1"
                    max="300"
                    value={draft.timeout}
                    onChange={(e) =>
                      update({ timeout: Number(e.target.value) })
                    }
                  />
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={draft.credentials}
                    onChange={(e) => update({ credentials: e.target.checked })}
                  />{" "}
                  {t("Отправлять cookies браузера")}
                </label>
                <p className="muted">
                  {t(
                    "Cookies подчиняются правилам SameSite и настройкам браузера. Сохранённые запросы и история хранятся локально, включая токены.",
                  )}
                </p>
              </div>
            )}
          </div>
          <div className="editor-footer">
            <span>
              {draft.bodyType === "json"
                ? "JSON"
                : draft.bodyType === "none"
                  ? t("Без тела")
                  : "Plain text"}
            </span>
            <span>UTF-8</span>
          </div>
        </section>
        <section className="response-panel">
          <div className="panel-top">
            <span className="panel-label">{t("Ответ")}</span>
            {result && (
              <div className="response-meta">
                <span
                  className={
                    result.status < 400 ? "success-text" : "danger-text"
                  }
                >
                  <CheckCircle size={13} />
                  {result.status} {result.statusText}
                </span>
                <span>
                  <Clock size={13} />
                  {result.duration} {t("мс")}
                </span>
                <span>
                  {(result.size / 1024).toFixed(1)} {t("КБ")}
                </span>
              </div>
            )}
          </div>
          <div className="response-tabrow">
            <Tabs
              value={responseTab}
              onChange={setResponseTab}
              items={[
                { id: "body", label: t("Тело") },
                {
                  id: "headers",
                  label: t("Заголовки"),
                  count: result?.headers.length,
                },
              ]}
            />
            {result && (
              <div className="actions">
                <CopyButton value={result.body} label={t("Копировать")} />
                <IconButton
                  icon={DownloadSimple}
                  label={t("Скачать ответ")}
                  onClick={() =>
                    download("response.txt", result.body, "text/plain")
                  }
                />
              </div>
            )}
          </div>
          <div className="editor-content">
            <ErrorNote error={error} />
            {pending === draft.id ? (
              <div className="request-progress">
                <div className="progress-line" />
                <Empty icon={Clock} title={t("Ожидаем ответ")}>
                  <p>
                    {t("Запрос выполняется.")}
                    <br />
                    {t("Можно отменить в любой момент.")}
                  </p>
                </Empty>
              </div>
            ) : result ? (
              <>
                {result.truncated && (
                  <div className="warning-note">
                    {t("Показаны первые 2 МБ ответа.")}
                  </div>
                )}
                {responseTab === "body" ? (
                  <Editor
                    value={pretty(result.body)}
                    readOnly
                    label={t("Тело ответа")}
                  />
                ) : (
                  <div className="headers-list">
                    {result.headers.map(([k, v]) => (
                      <div key={k}>
                        <span>{k}</span>
                        <code>{v}</code>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <Empty
                icon={ArrowUpRight}
                title={
                  error ? t("Запрос не выполнен") : t("Здесь появится ответ")
                }
              >
                <p>
                  {error
                    ? t("Проверьте URL, соединение и настройки запроса.")
                    : t("Отправьте запрос, чтобы посмотреть тело,")}
                  <br />
                  {!error && t("заголовки и время ответа.")}
                </p>
                {!error && (
                  <span className="shortcut-hint">
                    <kbd>⌘</kbd>
                    <kbd>Enter</kbd>
                    <span>{t("отправить запрос")}</span>
                  </span>
                )}
              </Empty>
            )}
          </div>
          <div className="editor-footer">
            <span>{result ? t("Ответ получен") : t("Готов к отправке")}</span>
            <span>{result ? "HTTP" : t("Локальное рабочее пространство")}</span>
          </div>
        </section>
      </div>
    </div>
  );
}
function QueryEditor({
  url,
  onChange,
}: {
  url: string;
  onChange: (value: string) => void;
}) {
  const hashAt = url.indexOf("#");
  const hash = hashAt >= 0 ? url.slice(hashAt) : "";
  const base = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const at = base.indexOf("?");
  const root = at >= 0 ? base.slice(0, at) : base;
  const [rows, setRows] = useState(() =>
    [...new URLSearchParams(at >= 0 ? base.slice(at + 1) : "")].map(([k, v]) =>
      pair(k, v),
    ),
  );
  const lastUrl = useRef(url);
  useEffect(() => {
    if (url !== lastUrl.current) {
      setRows(
        [
          ...new URLSearchParams(
            url.split("#")[0].split("?").slice(1).join("?"),
          ),
        ].map(([k, v]) => pair(k, v)),
      );
      lastUrl.current = url;
    }
  }, [url]);
  return (
    <>
      <div className="inline-hint">
        {t("Параметры автоматически добавляются к URL.")}
      </div>
      <PairEditor
        label={t("Параметры")}
        rows={rows}
        onChange={(next) => {
          setRows(next);
          const query = new URLSearchParams(
            next.filter((r) => r.enabled && r.key).map((r) => [r.key, r.value]),
          )
            .toString()
            .replaceAll("%7B", "{")
            .replaceAll("%7D", "}");
          const nextUrl = root + (query ? "?" + query : "") + hash;
          lastUrl.current = nextUrl;
          onChange(nextUrl);
        }}
      />
    </>
  );
}
