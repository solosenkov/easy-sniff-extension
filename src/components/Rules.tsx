import { t } from "../lib/i18n";
import { useState, useEffect } from "react";
import {
  ArrowRight,
  Plus,
  SlidersHorizontal,
  Trash,
} from "@phosphor-icons/react";
import { Button, Empty, ErrorNote, IconButton, PairEditor } from "./Primitives";
import { Editor } from "./Editor";
import { pair, type Rule } from "../lib/types";
import { validateRules } from "../lib/rules";

export function Rules({
  rules,
  onSave,
  connected,
  onCapture,
  initialDraft,
  onDraftChange,
}: {
  rules: Rule[];
  onSave: (rules: Rule[]) => Promise<void>;
  connected: boolean;
  onCapture: () => void;
  initialDraft?: Rule | null;
  onDraftChange: (rule: Rule | null) => void;
}) {
  const actionNames = {
    mock: t("Подмена ответа"),
    block: t("Блокировка"),
    delay: t("Задержка"),
    headers: t("Заголовки запроса"),
    request: t("Изменить запрос"),
  };
  const [draft, setDraft] = useState<Rule | null>(() =>
    initialDraft ? structuredClone(initialDraft) : null,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    onDraftChange(draft);
  }, [draft, onDraftChange]);
  async function commit(next: Rule[]) {
    setError("");
    setBusy(true);
    try {
      validateRules(next);
      await onSave(next);
      setDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const update = (value: Partial<Rule>) =>
    setDraft((d) => (d ? { ...d, ...value } : null));
  return (
    <div className="page rules-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">{t("КОНТРОЛЬ СЦЕНАРИЯ")}</span>
          <h1>{t("Подмены")}</h1>
          <p>{t("Проверьте, как приложение справляется с неожиданным.")}</p>
        </div>
        <Button
          icon={Plus}
          className="primary"
          onClick={() => {
            setError("");
            setDraft({
              id: crypto.randomUUID(),
              name: t("Новая подмена"),
              enabled: false,
              pattern: "https://api.example.com/*",
              method: "*",
              action: "mock",
              status: 500,
              body: '{\n  "error": "Service unavailable"\n}',
              delay: 1500,
              headers: [pair("Content-Type", "application/json")],
            });
          }}
        >
          {t("Новое правило")}
        </Button>
      </div>
      <div className="rules-notice">
        <SlidersHorizontal size={20} />
        <div>
          <strong>
            {connected
              ? t("Правила действуют на подключённой вкладке")
              : t("Правила готовы к подключению")}
          </strong>
          <p>
            {t(
              "Применяется первое включённое совпадение. «Подмена ответа» возвращает заданный ответ без обращения к серверу.",
            )}
          </p>
        </div>
        {!connected && (
          <Button onClick={onCapture}>
            {t("Выбрать вкладку")}
            <ArrowRight size={14} />
          </Button>
        )}
      </div>
      <ErrorNote error={error} />
      <div className={`rules-layout ${draft ? "editing" : ""}`}>
        <div className="rules-list">
          {rules.length
            ? rules.map((rule) => (
                <div
                  className={`rule-row ${draft?.id === rule.id ? "selected" : ""}`}
                  key={rule.id}
                >
                  <input
                    type="checkbox"
                    aria-label={t("Включить {0}", [rule.name])}
                    checked={rule.enabled}
                    disabled={busy}
                    onChange={(e) =>
                      void commit(
                        rules.map((r) =>
                          r.id === rule.id
                            ? { ...r, enabled: e.target.checked }
                            : r,
                        ),
                      )
                    }
                  />
                  <button onClick={() => setDraft(structuredClone(rule))}>
                    <strong>{rule.name}</strong>
                    <code>{rule.pattern}</code>
                  </button>
                  <span className="rule-action">
                    {actionNames[rule.action]}
                  </span>
                  <IconButton
                    icon={Trash}
                    label={t("Удалить {0}", [rule.name])}
                    disabled={busy}
                    onClick={() =>
                      void commit(rules.filter((r) => r.id !== rule.id))
                    }
                  />
                </div>
              ))
            : !draft && (
                <Empty
                  icon={SlidersHorizontal}
                  title={t("Любой ответ. По вашим правилам.")}
                >
                  <p>
                    {t("Сымитируйте ошибку сервера, медленную сеть")}
                    <br />
                    {t("или нужное состояние данных.")}
                  </p>
                </Empty>
              )}
        </div>
        {draft && (
          <section className="rule-editor">
            <div className="section-toolbar">
              <strong>{t("Настройка правила")}</strong>
              <Button className="quiet" onClick={() => setDraft(null)}>
                {t("Отмена")}
              </Button>
            </div>
            {draft.sourceWarning && (
              <div className="warning-note">{draft.sourceWarning}</div>
            )}
            <div className="rule-presets">
              <span>{t("Быстрый сценарий")}</span>
              <Button
                onClick={() =>
                  update({
                    action: "mock",
                    status: 500,
                    body: '{\n  "message": "Internal Server Error"\n}',
                    headers: [pair("Content-Type", "application/json")],
                    sourceWarning: "",
                  })
                }
              >
                {t("Вернуть 500")}
              </Button>
              <Button onClick={() => update({ action: "delay", delay: 1500 })}>
                {t("Задержать на 1,5 с")}
              </Button>
              <Button onClick={() => update({ action: "block" })}>
                {t("Заблокировать")}
              </Button>
            </div>
            <div className="form-stack">
              <label>
                {t("Название")}
                <input
                  value={draft.name}
                  onChange={(e) => update({ name: e.target.value })}
                />
              </label>
              <label>
                {t("URL-шаблон")}
                <input
                  value={draft.pattern}
                  onChange={(e) => update({ pattern: e.target.value })}
                />
                <small>
                  {t("* означает любую последовательность символов.")}
                </small>
              </label>
              <div className="form-row">
                <label>
                  {t("Метод")}
                  <select
                    value={draft.method}
                    onChange={(e) => update({ method: e.target.value })}
                  >
                    {[
                      "*",
                      "GET",
                      "POST",
                      "PUT",
                      "PATCH",
                      "DELETE",
                      "HEAD",
                      "OPTIONS",
                    ].map((v) => (
                      <option key={v} value={v}>
                        {v === "*" ? t("Любой") : v}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("Действие")}
                  <select
                    value={draft.action}
                    onChange={(e) =>
                      update({
                        action: e.target.value as Rule["action"],
                        request: draft.request || {
                          url: draft.pattern,
                          method: draft.method === "*" ? "GET" : draft.method,
                          body: "",
                          headers: [pair()],
                        },
                      })
                    }
                  >
                    {Object.entries(actionNames).map(([v, n]) => (
                      <option key={v} value={v}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {draft.action === "mock" && (
                <label>
                  {t("HTTP-статус")}
                  <input
                    type="number"
                    min="200"
                    max="599"
                    value={draft.status}
                    onChange={(e) => update({ status: Number(e.target.value) })}
                  />
                </label>
              )}
              {draft.action === "delay" && (
                <label>
                  {t("Задержка, мс")}
                  <input
                    type="number"
                    min="0"
                    max="10000"
                    value={draft.delay}
                    onChange={(e) => update({ delay: Number(e.target.value) })}
                  />
                </label>
              )}
            </div>
            {draft.action === "request" && draft.request && (
              <>
                <div className="inline-hint">
                  {t(
                    "Изменения применяются перед отправкой на сервер. URL-шаблон выше выбирает исходный запрос.",
                  )}
                </div>
                <div className="form-stack">
                  <label>
                    {t("Новый URL")}
                    <input
                      value={draft.request.url}
                      onChange={(e) =>
                        update({
                          request: { ...draft.request!, url: e.target.value },
                        })
                      }
                    />
                  </label>
                  <label>
                    {t("Новый метод")}
                    <select
                      value={draft.request.method}
                      onChange={(e) =>
                        update({
                          request: {
                            ...draft.request!,
                            method: e.target.value,
                            body: ["GET", "HEAD"].includes(e.target.value)
                              ? ""
                              : draft.request!.body,
                          },
                        })
                      }
                    >
                      {[
                        "GET",
                        "POST",
                        "PUT",
                        "PATCH",
                        "DELETE",
                        "HEAD",
                        "OPTIONS",
                      ].map((m) => (
                        <option key={m}>{m}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="section-toolbar">
                  {t("Тело исходящего запроса")}
                </div>
                <Editor
                  value={draft.request.body}
                  readOnly={["GET", "HEAD"].includes(draft.request.method)}
                  onChange={(body) =>
                    update({ request: { ...draft.request!, body } })
                  }
                  label={t("Тело исходящего запроса")}
                />
                <PairEditor
                  rows={draft.request.headers}
                  onChange={(headers) =>
                    update({ request: { ...draft.request!, headers } })
                  }
                />
              </>
            )}
            {draft.action === "mock" && (
              <Editor
                value={draft.body}
                onChange={(body) => update({ body })}
                label={t("Тело подмены")}
              />
            )}
            {["mock", "headers"].includes(draft.action) && (
              <PairEditor
                rows={draft.headers}
                onChange={(headers) => update({ headers })}
              />
            )}
            <div className="rule-editor-bottom">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(e) => update({ enabled: e.target.checked })}
                />{" "}
                {t("Включить правило")}
              </label>
              <Button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void commit(
                    rules.some((r) => r.id === draft.id)
                      ? rules.map((r) => (r.id === draft.id ? draft : r))
                      : [...rules, draft],
                  )
                }
              >
                {busy ? t("Сохранение…") : t("Сохранить правило")}
              </Button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
