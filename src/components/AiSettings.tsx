import { useEffect, useRef, useState } from "react";
import { CaretDown, CheckCircle, Plus, Trash } from "@phosphor-icons/react";
import { Button, ErrorNote, Modal } from "./Primitives";
import { t } from "../lib/i18n";
import {
  listModels,
  normalizeBaseUrl,
  presets,
  testModel,
  validateProvider,
} from "../lib/ai/client";
import type { AiProvider, AiSettings as Settings } from "../lib/ai/types";
export function AiSettings({
  settings,
  onSave,
  onClose,
}: {
  settings: Settings;
  onSave: (s: Settings) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(settings));
  const [id, setId] = useState(
    settings.activeId || settings.providers[0]?.id || "",
  );
  const [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const modelSearchRef = useRef<HTMLInputElement>(null);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [freeOnly, setFreeOnly] = useState(false);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (modelPickerOpen) modelSearchRef.current?.focus();
  }, [modelPickerOpen]);
  const provider = draft.providers.find((p) => p.id === id);
  const matchingModels = (provider?.models ?? []).filter(
    (model) =>
      (!freeOnly || model.endsWith(":free") || model === "openrouter/free") &&
      model.toLowerCase().includes(modelSearch.trim().toLowerCase()),
  );
  function change(values: Partial<AiProvider>) {
    setError("");
    setStatus("");
    setDraft((d) => ({
      ...d,
      providers: d.providers.map((p) =>
        p.id === id ? { ...p, ...values } : p,
      ),
    }));
  }
  function add(index: number) {
    const preset = presets[index];
    const p = {
      ...preset,
      id: crypto.randomUUID(),
      apiKey: "",
      timeoutSeconds: 600,
      maxOutputTokens: 8192,
      models: preset.model ? [preset.model] : [],
    };
    setDraft((d) => ({
      ...d,
      providers: [...d.providers, p],
      activeId: d.activeId || p.id,
    }));
    setId(p.id);
    setModelPickerOpen(false);
    setModelSearch("");
    setFreeOnly(false);
    setStatus("");
    setError("");
  }
  async function check(modelsOnly: boolean) {
    if (!provider) return;
    setError("");
    setStatus("");
    setBusy(true);
    const abort = new AbortController();
    controller.current = abort;
    try {
      if (modelsOnly) {
        const models = await listModels(provider, abort.signal);
        change({ models });
        setStatus(t("Получено моделей: {0}", [models.length]));
        setModelSearch("");
        setFreeOnly(false);
        setModelPickerOpen(true);
      } else {
        const tools = await testModel(provider, abort.signal);
        setStatus(
          tools
            ? t("Подключение работает. Модель поддерживает действия.")
            : t(
                "Модель отвечает, но не вызвала инструмент. Для действий выберите другую модель.",
              ),
        );
      }
    } catch (e) {
      if (!abort.signal.aborted)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      controller.current = null;
    }
  }
  async function save() {
    setError("");
    try {
      for (const p of draft.providers) validateProvider(p);
      setBusy(true);
      const next = {
        ...draft,
        activeId: id || draft.providers[0]?.id || "",
        providers: draft.providers.map((p) => ({
          ...p,
          name: p.name.trim(),
          baseUrl: normalizeBaseUrl(p.baseUrl),
          apiKey: p.apiKey.trim(),
          model: p.model.trim(),
        })),
      };
      await onSave(next);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t("Подключения ИИ")}
      onClose={() => {
        controller.current?.abort();
        onClose();
      }}
      wide
    >
      <div className="ai-settings-intro">
        {t(
          "Подключите свои модели. Запросы идут напрямую выбранному провайдеру. Ключи сохраняются только в этом браузере, без синхронизации.",
        )}
      </div>
      <div className="ai-settings-grid">
        <aside className="ai-provider-list">
          {draft.providers.map((p) => (
            <button
              className={p.id === id ? "selected" : ""}
              key={p.id}
              disabled={busy}
              onClick={() => {
                setId(p.id);
                setModelPickerOpen(false);
                setModelSearch("");
                setFreeOnly(false);
                setError("");
                setStatus("");
              }}
            >
              <strong>{p.name}</strong>
              <small>{p.model || t("Модель не выбрана")}</small>
            </button>
          ))}
          <label className="ai-add-provider">
            <Plus size={15} />
            {t("Добавить подключение")}
            <select
              aria-label={t("Добавить подключение")}
              value=""
              disabled={busy || draft.providers.length >= 12}
              onChange={(e) => add(Number(e.target.value))}
            >
              <option value="" disabled>
                {t("Выберите провайдера")}
              </option>
              {presets.map((p, i) => (
                <option value={i} key={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </aside>
        <div className="ai-provider-form">
          {provider ? (
            <fieldset disabled={busy}>
              <label>
                {t("Название")}
                <input
                  value={provider.name}
                  onChange={(e) => change({ name: e.target.value })}
                />
              </label>
              <label>
                {t("Адрес API")}
                <input
                  placeholder="https://provider.example/v1"
                  spellCheck={false}
                  value={provider.baseUrl}
                  onChange={(e) => change({ baseUrl: e.target.value })}
                />
              </label>
              <label>
                {t("API-ключ")}
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={provider.apiKey}
                  placeholder={t("Для локальных моделей можно оставить пустым")}
                  onChange={(e) => change({ apiKey: e.target.value })}
                />
              </label>
              <div className="ai-model-field">
                <label htmlFor="ai-model-id">{t("Модель")}</label>
                <div className="ai-model-input-row">
                  <input
                    id="ai-model-id"
                    placeholder="model-id"
                    spellCheck={false}
                    value={provider.model}
                    onChange={(e) => change({ model: e.target.value })}
                  />
                  <button
                    type="button"
                    className="ai-model-browse"
                    aria-label={t("Выбрать из загруженных моделей")}
                    aria-expanded={modelPickerOpen}
                    disabled={!provider.models.length}
                    onClick={() => {
                      setModelSearch("");
                      setModelPickerOpen((open) => !open);
                    }}
                  >
                    <CaretDown size={16} />
                  </button>
                </div>
                {provider.models.length > 0 && (
                  <small className="ai-model-count">
                    {t("В каталоге моделей: {0}", [provider.models.length])}
                  </small>
                )}
                {modelPickerOpen && (
                  <div
                    className="ai-model-picker"
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setModelPickerOpen(false);
                    }}
                  >
                    <div className="ai-model-picker-controls">
                      <input
                        ref={modelSearchRef}
                        type="search"
                        aria-label={t("Поиск по всем моделям")}
                        placeholder={t("Поиск по всем моделям")}
                        value={modelSearch}
                        onChange={(event) => setModelSearch(event.target.value)}
                      />
                      <label className="ai-model-free-filter">
                        <input
                          type="checkbox"
                          checked={freeOnly}
                          onChange={(event) =>
                            setFreeOnly(event.target.checked)
                          }
                        />
                        {t("Бесплатные")}
                      </label>
                    </div>
                    <div
                      className="ai-model-results"
                      role="listbox"
                      aria-label={t("Загруженные модели")}
                    >
                      {matchingModels.length ? (
                        matchingModels.map((model) => (
                          <button
                            type="button"
                            role="option"
                            aria-selected={model === provider.model}
                            key={model}
                            onClick={() => {
                              change({ model });
                              setModelPickerOpen(false);
                            }}
                          >
                            {model}
                          </button>
                        ))
                      ) : (
                        <p>{t("Совпадений нет. Измените поиск или фильтр.")}</p>
                      )}
                    </div>
                    <small className="ai-model-count">
                      {t("Найдено моделей: {0}", [matchingModels.length])}
                    </small>
                  </div>
                )}
              </div>
              <label>
                {t("Таймаут модели, секунды (30–900)")}
                <input
                  type="number"
                  min={30}
                  max={900}
                  step={1}
                  value={provider.timeoutSeconds ?? 600}
                  onChange={(e) =>
                    change({ timeoutSeconds: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                {t("Лимит ответа, токены (512–32768)")}
                <input
                  type="number"
                  min={512}
                  max={32768}
                  step={512}
                  value={provider.maxOutputTokens ?? 8192}
                  onChange={(e) =>
                    change({ maxOutputTokens: Number(e.target.value) })
                  }
                />
              </label>
              <div className="ai-provider-actions">
                <Button onClick={() => void check(true)}>
                  {t("Загрузить модели")}
                </Button>
                <Button onClick={() => void check(false)}>
                  {t("Проверить модель")}
                </Button>
              </div>
              <p className="muted">
                {t(
                  "Можно ввести ID вручную. Для помощника нужна модель с поддержкой вызова инструментов (tools).",
                )}
              </p>
              <Button
                className="quiet danger-text"
                icon={Trash}
                onClick={() => {
                  const remaining = draft.providers.filter((p) => p.id !== id);
                  setDraft({
                    ...draft,
                    providers: remaining,
                    activeId: remaining[0]?.id || "",
                  });
                  setId(remaining[0]?.id || "");
                  setModelPickerOpen(false);
                  setError("");
                  setStatus("");
                }}
              >
                {t("Удалить подключение")}
              </Button>
            </fieldset>
          ) : (
            <div className="ai-provider-empty">
              {t(
                "Выберите провайдера слева, чтобы добавить первое подключение.",
              )}
            </div>
          )}
        </div>
      </div>
      <div className="ai-settings-status">
        <ErrorNote error={error} />
        {busy && <p role="status">{t("Проверяем подключение…")}</p>}
        {status && (
          <p role="status">
            <CheckCircle size={16} />
            {status}
          </p>
        )}
      </div>
      <div className="modal-footer">
        <span className="muted">
          {t("Ключи хранятся локально без шифрования.")}
        </span>
        <Button onClick={onClose} disabled={busy}>
          {t("Отмена")}
        </Button>
        <Button className="primary" onClick={() => void save()} disabled={busy}>
          {t("Сохранить")}
        </Button>
      </div>
    </Modal>
  );
}
