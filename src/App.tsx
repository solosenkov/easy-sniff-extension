import {
  t,
  getLanguage,
  setLanguage,
  subscribeLanguage,
  currentLocale,
} from "./lib/i18n";
import {
  lazy,
  Suspense,
  useSyncExternalStore,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Robot,
  ArrowRight,
  ArrowsLeftRight,
  BookOpen,
  BracketsCurly,
  Broadcast,
  CaretDown,
  Check,
  ClockCounterClockwise,
  Code,
  Command,
  Cube,
  DownloadSimple,
  FolderSimple,
  GearSix,
  Globe,
  MagnifyingGlass,
  Plus,
  Stack,
  SlidersHorizontal,
  TerminalWindow,
  Trash,
  X,
} from "@phosphor-icons/react";
import { ApiClient } from "./components/ApiClient";
import {
  Button,
  CopyButton,
  ErrorNote,
  IconButton,
  Modal,
  PairEditor,
} from "./components/Primitives";
import {
  initialCapture,
  newDraft,
  pair,
  type CaptureRequest,
  type CaptureState,
  type Draft,
  type Environment,
  type HistoryEntry,
  type Rule,
  type WsRule,
} from "./lib/types";
import {
  isExtension,
  readStore,
  rpc,
  writeStore,
  download,
} from "./lib/storage";
import { parseCurl, toCurl } from "./lib/curl";
import type { AiProposal } from "./lib/ai/types";
import type { AiActionMode } from "./components/AiAssistant";
import { sendRequest } from "./lib/request";
const AiAssistant = lazy(() =>
  import("./components/AiAssistant").then((m) => ({ default: m.AiAssistant })),
);
const Capture = lazy(() =>
  import("./components/Capture").then((m) => ({ default: m.Capture })),
);
const Tools = lazy(() =>
  import("./components/Tools").then((m) => ({ default: m.Tools })),
);
const Rules = lazy(() =>
  import("./components/Rules").then((m) => ({ default: m.Rules })),
);
const ScenarioPacks = lazy(() =>
  import("./components/ScenarioPacks").then((m) => ({
    default: m.ScenarioPacks,
  })),
);

function firstDraft() {
  const d = newDraft();
  return {
    ...d,
    name: t("Пример запроса"),
    method: "POST",
    url: "https://httpbin.org/anything",
    bodyType: "json" as const,
    headers: [
      pair("Content-Type", "application/json"),
      pair("Accept", "application/json"),
    ],
    body: JSON.stringify(
      {
        project: "easy-sniff",
        environment: "sandbox",
        check: {
          name: t("Первый запрос"),
          enabled: true,
          tags: ["api", "smoke"],
        },
      },
      null,
      2,
    ),
  };
}
export default function App() {
  const language = useSyncExternalStore(subscribeLanguage, getLanguage);
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = `Easy Sniff · ${t("Рабочее пространство QA")}`;
  }, [language]);
  const navigation = [
    { id: "api", label: t("API-клиент"), icon: TerminalWindow },
    { id: "network", label: t("Сетевой журнал"), icon: ArrowsLeftRight },
    { id: "ws", label: "WebSocket", icon: Broadcast },
    { id: "tools", label: t("Декодеры"), icon: BracketsCurly },
    { id: "rules", label: t("Подмены"), icon: SlidersHorizontal },
    { id: "scenarios", label: "Time Machine", icon: Stack },
  ];
  const [aiMounted, setAiMounted] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiSelected, setAiSelected] = useState<CaptureRequest>();
  const [aiSelectionVersion, setAiSelectionVersion] = useState(0);
  function showAi(request?: CaptureRequest) {
    if (request) {
      setAiSelected(request);
      setAiSelectionVersion((v) => v + 1);
    }
    setAiMounted(true);
    setAiOpen(true);
  }
  const [ruleDraft, setRuleDraft] = useState<Rule | null>(null);
  const [wsRuleDraft, setWsRuleDraft] = useState<WsRule | null>(null);
  const [section, setSection] = useState("api");
  useEffect(() => {
    if (section !== "ws") setWsRuleDraft(null);
  }, [section]);
  const [drafts, setDrafts] = useState<Draft[]>(() => [firstDraft()]);
  const [activeId, setActiveId] = useState("");
  const [saved, setSaved] = useState<Draft[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [envId, setEnvId] = useState("");
  const [capture, setCapture] = useState<CaptureState>(initialCapture);
  const [loaded, setLoaded] = useState(false);
  const [modal, setModal] = useState("");
  const [curlInput, setCurlInput] = useState("");
  const [modalError, setModalError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [toast, setToast] = useState("");
  const [query, setQuery] = useState("");
  const [toolInput, setToolInput] = useState("");
  const [sidebarTab, setSidebarTab] = useState("saved");
  const [exportCurl, setExportCurl] = useState("");
  const [editEnv, setEditEnv] = useState<Environment | null>(null);
  const [storageError, setStorageError] = useState("");
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  function notify(message: string) {
    setToast(message);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setToast(""), 3500);
  }
  useEffect(() => {
    Promise.all([
      readStore<Draft[]>("drafts", []),
      readStore<Draft[]>("saved", []),
      readStore<HistoryEntry[]>("history", []),
      readStore<Environment[]>("environments", []),
      readStore<string>("envId", ""),
      readStore<Rule[]>("rules", []),
    ])
      .then(([d, s, h, e, id, r]) => {
        if (d.length) {
          setDrafts(d);
          setActiveId(d[0].id);
        }
        setSaved(s);
        setHistory(h);
        setEnvironments(e);
        setEnvId(id);
        setCapture((c) => ({ ...c, rules: r }));
        setLoaded(true);
      })
      .catch((e) => {
        setStorageError(
          t("Не удалось прочитать локальные данные: {0}", [String(e)]),
        );
      });
  }, []);
  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(() => {
      void Promise.all([
        writeStore("drafts", drafts),
        writeStore("saved", saved),
        writeStore("history", history),
        writeStore("environments", environments),
        writeStore("envId", envId),
      ]).catch((e) =>
        setStorageError(t("Не удалось сохранить данные: {0}", [String(e)])),
      );
    }, 350);
    return () => clearTimeout(timer);
  }, [loaded, drafts, saved, history, environments, envId]);
  useEffect(() => {
    if (!isExtension) return;
    void rpc<CaptureState>("capture.get")
      .then(setCapture)
      .catch((e) => setStorageError(String(e)));
    const listener = (m: any) => {
      if (m.type === "capture.updated") setCapture(m.state);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setModal((m) => (m === "command" ? "" : "command"));
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "i") {
        e.preventDefault();
        setModal("import");
      }
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      clearTimeout(noticeTimer.current);
    };
  }, []);
  function openRequest(request: Draft) {
    const d = { ...structuredClone(request), id: crypto.randomUUID() };
    setDrafts((ds) => [...ds, d]);
    setActiveId(d.id);
    setSection("api");
  }
  function save(d: Draft) {
    setSaved((s) => {
      const i = s.findIndex((x) => x.id === d.id);
      return i >= 0
        ? s.map((x) => (x.id === d.id ? structuredClone(d) : x))
        : [...s, structuredClone(d)];
    });
    notify(t("Запрос сохранён в коллекцию"));
  }
  function addHistory(h: HistoryEntry) {
    setHistory((entries) =>
      [
        {
          ...h,
          response: h.response
            ? { ...h.response, body: h.response.body.slice(0, 24000) }
            : undefined,
        },
        ...entries,
      ].slice(0, 40),
    );
  }
  async function saveRules(rules: Rule[]) {
    if (isExtension)
      setCapture(await rpc<CaptureState>("capture.rules", { rules }));
    else {
      await writeStore("rules", rules);
      setCapture((c) => ({ ...c, rules }));
    }
    notify(t("Правила сохранены"));
  }
  async function applyAi(
    proposal: AiProposal,
    mode: AiActionMode,
    signal: AbortSignal,
  ): Promise<string> {
    signal.throwIfAborted();
    if (proposal.kind === "rule") {
      if (mode === "save") {
        await saveRules([
          ...capture.rules,
          { ...proposal.rule, enabled: false },
        ]);
        return t("Правило сохранено выключенным.");
      }
      setRuleDraft({ ...proposal.rule, enabled: false });
      setSection("rules");
      setAiOpen(false);
      return t("Правило открыто в редакторе.");
    }
    if (proposal.kind === "ws-rule") {
      if (mode === "save") {
        const current = isExtension
          ? await rpc<CaptureState>("capture.get")
          : capture;
        const rules = [
          ...(current.wsRules || []),
          { ...proposal.rule, enabled: false },
        ];
        if (isExtension)
          setCapture(await rpc<CaptureState>("capture.ws.rules", { rules }));
        else {
          await writeStore("wsRules", rules);
          setCapture((current) => ({ ...current, wsRules: rules }));
        }
        return t("Правило сохранено выключенным.");
      }
      setWsRuleDraft({ ...proposal.rule, enabled: false });
      setSection("ws");
      setAiOpen(false);
      return t("WS-сценарий открыт в редакторе.");
    }
    if (proposal.kind === "request") {
      if (mode === "save") {
        save(proposal.request);
        return t("Запрос сохранён в коллекцию");
      }
      if (mode === "send") {
        const request = structuredClone(proposal.request);
        const response = await sendRequest(request, activeEnvironment, signal);
        addHistory({
          id: crypto.randomUUID(),
          at: Date.now(),
          request,
          response,
        });
        return `HTTP ${response.status} · ${response.duration} ms\n${response.body.slice(0, 24000)}`;
      }
      openRequest(proposal.request);
      setAiOpen(false);
      return t("Запрос открыт в API-клиенте.");
    }
    if (proposal.kind === "environment") {
      setEnvironments((es) => [...es, proposal.environment]);
      return t("Окружение добавлено.");
    }
    if (proposal.kind === "rule-state") {
      if (!capture.rules.some((r) => r.id === proposal.ruleId))
        throw new Error(t("Правило больше не существует."));
      await saveRules(
        capture.rules.map((r) =>
          r.id === proposal.ruleId ? { ...r, enabled: proposal.enabled } : r,
        ),
      );
      return t("Правила сохранены");
    }
    if (proposal.kind === "capture") {
      setCapture(
        await rpc<CaptureState>(`capture.${proposal.operation}`, {
          tabId: proposal.tabId,
        }),
      );
      setSection("network");
      return t("Настройки захвата применены.");
    }
    if (proposal.kind === "export") {
      download(
        proposal.format === "curl"
          ? "request.sh"
          : `easy-sniff-${proposal.format}.json`,
        proposal.data,
        proposal.format === "curl" ? "text/plain" : "application/json",
      );
      return t("Файл подготовлен к скачиванию.");
    }
    return "";
  }
  function importCurl() {
    setModalError("");
    try {
      const result = parseCurl(curlInput);
      openRequest(result.draft);
      setWarnings(result.warnings);
      setModal("");
      setCurlInput("");
      notify(t("cURL импортирован. Запрос готов к редактированию."));
    } catch (e) {
      setModalError(e instanceof Error ? e.message : String(e));
    }
  }
  const activeEnvironment = environments.find((e) => e.id === envId);
  const selectedNav = navigation.find((n) => n.id === section)!;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Broadcast size={23} weight="bold" />
          </span>
          <span>
            easy sniff<span className="brand-version">3</span>
          </span>
        </div>
        <button className="workspace-switch" onClick={() => setModal("about")}>
          <span className="workspace-avatar">QA</span>
          <span>
            {t("Моё пространство")}
            <small>{t("Локально на устройстве")}</small>
          </span>
          <CaretDown size={13} />
        </button>
        <button
          className="command-trigger"
          onClick={() => {
            setQuery("");
            setModal("command");
          }}
        >
          <MagnifyingGlass size={15} />
          <span>{t("Быстрый переход")}</span>
          <kbd>⌘ K</kbd>
        </button>
        <div className="nav-label">{t("ИНСТРУМЕНТЫ")}</div>
        <nav>
          {navigation.map((item) => (
            <button
              className={section === item.id ? "active" : ""}
              key={item.id}
              onClick={() => setSection(item.id)}
            >
              <item.icon
                size={19}
                weight={section === item.id ? "duotone" : "regular"}
              />
              <span>{item.label}</span>
              {item.id === "rules" &&
                capture.rules.filter((r) => r.enabled).length > 0 && (
                  <span className="nav-counter">
                    {capture.rules.filter((r) => r.enabled).length}
                  </span>
                )}
              {(item.id === "network" || item.id === "ws") &&
                capture.tabId !== null && <span className="live-indicator" />}
            </button>
          ))}
        </nav>
        <div className="library-heading">
          <button
            className={sidebarTab === "saved" ? "active" : ""}
            onClick={() => setSidebarTab("saved")}
          >
            {t("Коллекция")}
          </button>
          <button
            className={sidebarTab === "history" ? "active" : ""}
            onClick={() => setSidebarTab("history")}
          >
            {t("История")}
          </button>
          <IconButton
            icon={Plus}
            label={t("Добавить запрос")}
            onClick={() => openRequest(newDraft())}
          />
        </div>
        <div className="library-list">
          {sidebarTab === "saved" ? (
            saved.length ? (
              saved.map((d) => (
                <div className="library-item" key={d.id}>
                  <button onClick={() => openRequest(d)}>
                    <span className={`method ${d.method.toLowerCase()}`}>
                      {d.method}
                    </span>
                    <span>{d.name}</span>
                  </button>
                  <IconButton
                    icon={Trash}
                    label={t("Удалить сохранённый {0}", [d.name])}
                    onClick={() =>
                      setSaved((s) => s.filter((x) => x.id !== d.id))
                    }
                  />
                </div>
              ))
            ) : (
              <div className="library-empty">
                <FolderSimple size={23} weight="light" />
                <p>{t("Ваши запросы, под рукой")}</p>
                <span>
                  {t("Сохраните запрос,")}
                  <br />
                  {t("чтобы вернуться к нему позже.")}
                </span>
              </div>
            )
          ) : history.length ? (
            <>
              {history.map((h) => (
                <div className="library-item" key={h.id}>
                  <button
                    onClick={() => openRequest(h.request)}
                    title={h.request.url}
                  >
                    <span
                      className={`method ${h.request.method.toLowerCase()}`}
                    >
                      {h.request.method}
                    </span>
                    <span>
                      {h.request.name}
                      <small>
                        {new Date(h.at).toLocaleTimeString(currentLocale(), {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}{" "}
                        · {h.error ? t("Ошибка") : h.response?.status}
                      </small>
                    </span>
                  </button>
                </div>
              ))}
              <Button
                className="quiet"
                icon={Trash}
                onClick={() => setHistory([])}
              >
                {t("Очистить историю")}
              </Button>
            </>
          ) : (
            <div className="library-empty">
              <ClockCounterClockwise size={24} />
              <p>{t("История пока пуста")}</p>
              <span>
                {t("Здесь будут последние")}
                <br />
                {t("40 отправленных запросов.")}
              </span>
            </div>
          )}
        </div>
        <div className="sidebar-bottom">
          <button
            onClick={() => {
              setEditEnv(environments[0] || null);
              setModal("environments");
            }}
          >
            <Globe size={17} />
            {t("Окружения")}
            <GearSix size={15} />
          </button>
          <button onClick={() => setModal("about")}>
            <BookOpen size={17} />
            {t("Краткое руководство")}
            <ArrowRight size={14} />
          </button>
          <div className="sidebar-status">
            <span className="small-dot" /> Easy Sniff 3{" "}
            <span>{t("Локальная версия")}</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <Cube size={16} />
            <span>{t("Рабочее пространство")}</span>
            <span className="slash">/</span>
            <strong>{selectedNav.label}</strong>
          </div>
          <div className="topbar-actions">
            <Button
              className={`ai-toggle ${aiOpen ? "active" : ""}`}
              icon={Robot}
              onClick={() => (aiOpen ? setAiOpen(false) : showAi())}
              aria-expanded={aiOpen}
            >
              {t("ИИ")}
            </Button>
            <select
              className="language-select"
              aria-label={t("Язык интерфейса")}
              value={language}
              onChange={(e) => {
                void setLanguage(e.target.value as "ru" | "en").catch((error) =>
                  setStorageError(String(error)),
                );
              }}
            >
              <option value="ru">RU</option>
              <option value="en">EN</option>
            </select>
            {!isExtension && (
              <span className="preview-label">{t("Превью")}</span>
            )}
            <Globe size={15} />
            <select
              aria-label={t("Активное окружение")}
              value={envId}
              onChange={(e) => setEnvId(e.target.value)}
            >
              <option value="">{t("Без окружения")}</option>
              {environments.map((env) => (
                <option key={env.id} value={env.id}>
                  {env.name}
                </option>
              ))}
            </select>
            <IconButton
              icon={GearSix}
              label={t("Настроить окружения")}
              onClick={() => {
                setEditEnv(activeEnvironment || null);
                setModal("environments");
              }}
            />
          </div>
        </header>
        <ErrorNote error={storageError} />
        {warnings.length > 0 && (
          <div className="import-warnings">
            <div>
              <strong>{t("Импорт с особенностями браузера")}</strong>
              {warnings.map((w, i) => (
                <p key={i}>{w}</p>
              ))}
            </div>
            <IconButton
              icon={X}
              label={t("Скрыть предупреждения импорта")}
              onClick={() => setWarnings([])}
            />
          </div>
        )}
        <main>
          {loaded && (
            <div className="api-container" hidden={section !== "api"}>
              <ApiClient
                active={section === "api" && !modal}
                drafts={drafts}
                setDrafts={setDrafts}
                activeId={activeId}
                setActiveId={setActiveId}
                environment={activeEnvironment}
                onImport={() => {
                  setModalError("");
                  setModal("import");
                }}
                onSave={save}
                onHistory={addHistory}
                onExport={(d) => {
                  setExportCurl(toCurl(d));
                  setModal("export");
                }}
              />
            </div>
          )}
          <Suspense
            fallback={
              <div className="loading-view">{t("Открываем инструмент…")}</div>
            }
          >
            {!loaded ? (
              <div className="loading-view">
                {t("Открываем рабочее пространство…")}
              </div>
            ) : section === "api" ? null : section === "tools" ? (
              <Tools key={toolInput} initialInput={toolInput} />
            ) : section === "rules" ? (
              <Rules
                key={ruleDraft?.id || "rules"}
                initialDraft={ruleDraft}
                onDraftChange={setRuleDraft}
                rules={capture.rules}
                onSave={saveRules}
                connected={capture.tabId !== null}
                onCapture={() => setSection("network")}
              />
            ) : section === "scenarios" ? (
              <ScenarioPacks
                capture={capture}
                onCapture={() => setSection("network")}
              />
            ) : (
              <Capture
                key={section}
                state={capture}
                setState={setCapture}
                websocket={section === "ws"}
                initialWsRule={section === "ws" ? wsRuleDraft : null}
                onModify={(rule) => {
                  setRuleDraft(rule);
                  setSection("rules");
                }}
                onAi={showAi}
                onReplay={openRequest}
                onDecode={(text) => {
                  setToolInput(text);
                  setSection("tools");
                }}
              />
            )}
          </Suspense>
        </main>
        <footer className="statusbar">
          <span>
            <span
              className={
                capture.tabId !== null ? "small-dot live" : "small-dot"
              }
            />
            {capture.tabId !== null
              ? t("Подключено: {0}", [capture.title])
              : t("Захват вкладки не подключён")}
          </span>
          <span>
            <Command size={12} /> K <span className="status-divider" />
            {t("Быстрый переход")}
          </span>
        </footer>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
      {aiMounted && (
        <Suspense fallback={null}>
          <AiAssistant
            open={aiOpen}
            onClose={() => setAiOpen(false)}
            capture={capture}
            draft={drafts.find((d) => d.id === activeId) || drafts[0]}
            selected={aiSelected}
            selectionVersion={aiSelectionVersion}
            onApply={applyAi}
          />
        </Suspense>
      )}
      {modal === "import" && (
        <Modal
          title={t("Импортировать cURL")}
          onClose={() => setModal("")}
          wide
        >
          <div className="modal-body">
            <p className="muted">
              {t(
                "Скопируйте запрос из DevTools или терминала. После импорта его можно изменить перед отправкой.",
              )}
            </p>
            <textarea
              autoFocus
              className="curl-input"
              aria-label={t("Команда cURL")}
              placeholder={
                "curl 'https://api.example.com/users' \\\n  -H 'Content-Type: application/json' \\\n  --data-raw '{\"name\":\"QA\"}'"
              }
              value={curlInput}
              onChange={(e) => setCurlInput(e.target.value)}
              spellCheck={false}
            />
            <ErrorNote error={modalError} />
          </div>
          <div className="modal-footer">
            <span>
              {t("Команда разбирается локально, без выполнения в shell.")}
            </span>
            <Button className="primary" icon={ArrowRight} onClick={importCurl}>
              {t("Импортировать")}
            </Button>
          </div>
        </Modal>
      )}
      {modal === "export" && (
        <Modal
          title={t("Запрос в формате cURL")}
          onClose={() => setModal("")}
          wide
        >
          <div className="modal-body">
            <textarea
              className="curl-input"
              aria-label={t("Экспорт cURL")}
              readOnly
              value={exportCurl}
            />
            <p className="muted">
              {t("Переменные окружения остаются в виде")} {t("{{имя}}")}
              {t(". Перед запуском в терминале замените их значениями.")}
            </p>
          </div>
          <div className="modal-footer">
            <Button
              icon={DownloadSimple}
              onClick={() => download("request.sh", exportCurl, "text/plain")}
            >
              {t("Скачать")}
            </Button>
            <CopyButton value={exportCurl} />
          </div>
        </Modal>
      )}
      {modal === "command" && (
        <Modal title={t("Быстрый переход")} onClose={() => setModal("")}>
          <input
            autoFocus
            className="command-input"
            placeholder={t("Найти инструмент…")}
            aria-label={t("Поиск инструментов")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="command-list">
            {navigation
              .filter((n) =>
                n.label.toLowerCase().includes(query.toLowerCase()),
              )
              .map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    setSection(n.id);
                    setModal("");
                  }}
                >
                  <n.icon size={20} />
                  {n.label}
                  <ArrowRight size={16} />
                </button>
              ))}
            <button onClick={() => setModal("import")}>
              <TerminalWindow size={20} />
              {t("Импортировать cURL")}
              <kbd>⌘ I</kbd>
            </button>
          </div>
        </Modal>
      )}
      {modal === "environments" && (
        <Modal title={t("Окружения")} onClose={() => setModal("")} wide>
          <div className="environments-layout">
            <div className="env-list">
              {environments.map((e) => (
                <button
                  className={editEnv?.id === e.id ? "active" : ""}
                  key={e.id}
                  onClick={() => setEditEnv(structuredClone(e))}
                >
                  <Globe size={15} />
                  {e.name}
                </button>
              ))}
              <Button
                icon={Plus}
                onClick={() =>
                  setEditEnv({
                    id: crypto.randomUUID(),
                    name: t("Новое окружение"),
                    values: [pair("base_url", "https://api.example.com")],
                  })
                }
              >
                {t("Добавить")}
              </Button>
            </div>
            <div className="env-editor">
              {editEnv ? (
                <>
                  <label className="field-label">
                    {t("Название")}
                    <input
                      aria-label={t("Название окружения")}
                      value={editEnv.name}
                      onChange={(e) =>
                        setEditEnv({ ...editEnv, name: e.target.value })
                      }
                    />
                  </label>
                  <PairEditor
                    label={t("Переменные")}
                    rows={editEnv.values}
                    onChange={(values) => setEditEnv({ ...editEnv, values })}
                  />
                  <div className="inline-hint">
                    {t("Подстановка")} {"{{base_url}}"}{" "}
                    {t(
                      "работает в URL, заголовках, токене и теле запроса. Значения сохраняются локально.",
                    )}
                  </div>
                  <div className="actions">
                    <Button
                      icon={Trash}
                      onClick={() => {
                        setEnvironments((es) =>
                          es.filter((e) => e.id !== editEnv.id),
                        );
                        if (envId === editEnv.id) setEnvId("");
                        setEditEnv(null);
                      }}
                    >
                      {t("Удалить")}
                    </Button>
                    <Button
                      className="primary"
                      onClick={() => {
                        setEnvironments((es) => [
                          ...es.filter((e) => e.id !== editEnv.id),
                          editEnv,
                        ]);
                        setEnvId(editEnv.id);
                        notify(t("Окружение сохранено"));
                        setModal("");
                      }}
                    >
                      {t("Сохранить и выбрать")}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="env-empty">
                  <Globe size={30} />
                  <h3>{t("Одно действие, другое окружение")}</h3>
                  <p>
                    {t(
                      "Добавьте base_url, токены и другие переменные для ваших стендов.",
                    )}
                  </p>
                  <Button
                    className="primary"
                    onClick={() =>
                      setEditEnv({
                        id: crypto.randomUUID(),
                        name: t("Разработка"),
                        values: [pair("base_url", "http://localhost:3000")],
                      })
                    }
                  >
                    {t("Создать окружение")}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}
      {modal === "about" && (
        <Modal title={t("Ваш рабочий набор QA")} onClose={() => setModal("")}>
          <div className="modal-body help-content">
            <p>
              {t(
                "Начните с cURL: импортируйте, отредактируйте и отправьте запрос. Сохраняйте часто используемые запросы и переключайте окружения.",
              )}
            </p>
            <dl>
              <dt>⌘ / Ctrl + I</dt>
              <dd>{t("Импорт cURL")}</dd>
              <dt>⌘ / Ctrl + Enter</dt>
              <dd>{t("Отправить запрос")}</dd>
              <dt>⌘ / Ctrl + S</dt>
              <dd>{t("Сохранить запрос в API-клиенте")}</dd>
              <dt>⌘ / Ctrl + K</dt>
              <dd>{t("Перейти к инструменту")}</dd>
            </dl>
            <h3>{t("Сеть, WebSocket и подмены")}</h3>
            <p>
              {t(
                "В установленном расширении откройте сетевой журнал, выберите вкладку и нажмите «Начать запись». Для существующих WS-соединений обновите тестируемую страницу после подключения.",
              )}
            </p>
            <p>
              {t(
                "Chrome показывает уведомление об отладке. Открытие DevTools может отключить захват. После отключения включённые правила перестают действовать на страницу.",
              )}
            </p>
            <h3>{t("Хранение")}</h3>
            <p>
              {t(
                "Данные остаются в браузере. Сохранённые запросы, история и окружения могут содержать токены. Журнал трафика хранится до завершения сессии браузера.",
              )}
            </p>
            {!isExtension && (
              <p>
                {t(
                  "Превью отправляет запросы с обычными ограничениями CORS. Для междоменных запросов установите расширение из папки dist.",
                )}
              </p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
