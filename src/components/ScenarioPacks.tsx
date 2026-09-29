import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  DownloadSimple,
  FileArrowUp,
  Play,
  Stop,
  Waveform,
} from "@phosphor-icons/react";
import { Button, ErrorNote } from "./Primitives";
import { t } from "../lib/i18n";
import { download, isExtension, rpc } from "../lib/storage";
import {
  createScenarioPack,
  parseScenarioPack,
  type ScenarioPack,
} from "../lib/scenario-pack";
import type { CaptureState } from "../lib/types";

type ReplayStatus = {
  active: boolean;
  name: string;
  httpCount: number;
  wsCount: number;
  consumed: number;
  scheduledWs: number;
};

export function ScenarioPacks({
  capture,
  onCapture,
}: {
  capture: CaptureState;
  onCapture: () => void;
}) {
  const [pack, setPack] = useState<ScenarioPack | null>(null);
  const [name, setName] = useState("");
  const [status, setStatus] = useState<ReplayStatus>({
    active: false,
    name: "",
    httpCount: 0,
    wsCount: 0,
    consumed: 0,
    scheduledWs: 0,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isExtension) return;
    let alive = true;
    const refresh = () =>
      void rpc<ReplayStatus>("scenario.status")
        .then((next) => {
          if (alive) setStatus(next);
        })
        .catch(() => {});
    refresh();
    const timer = setInterval(refresh, 1500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  async function run(operation: "start" | "stop" | "playWs") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (operation === "start") {
        if (!pack) return;
        setStatus(await rpc<ReplayStatus>("scenario.start", { pack }));
        setNotice(
          t(
            "HTTP-воспроизведение запущено. Повторите действия на тестовой странице.",
          ),
        );
      } else if (operation === "stop") {
        setStatus(await rpc<ReplayStatus>("scenario.stop"));
        setNotice(t("Воспроизведение остановлено."));
      } else {
        const result = await rpc<{ scheduledWs: number }>("scenario.playWs");
        setStatus((current) => ({
          ...current,
          scheduledWs: result.scheduledWs,
        }));
        setNotice(t("Запланировано WS-сообщений: {0}", [result.scheduledWs]));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function importPack(file: File) {
    setError("");
    setNotice("");
    try {
      if (file.size > 3_000_000)
        throw new Error(t("Файл сценария больше 3 МБ."));
      const parsed = parseScenarioPack(JSON.parse(await file.text()));
      setPack(parsed);
      setName(parsed.meta.name);
      setNotice(t("Сценарий импортирован. Проверьте данные перед запуском."));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function makePack() {
    setError("");
    setNotice("");
    try {
      const next = parseScenarioPack(createScenarioPack(capture, name));
      setPack(next);
      setName(next.meta.name);
      setNotice(t("Пакет собран. Проверьте состав и скачайте файл."));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  const availableHttp = capture.requests.filter(
    (request) =>
      request.type !== "WebSocket" &&
      request.responseBody !== undefined &&
      !request.bodyError &&
      !request.error,
  ).length;
  const availableWs = capture.frames.filter(
    (frame) => frame.opcode === 1 && !frame.truncated,
  ).length;

  return (
    <div className="page scenario-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">{t("ВОСПРОИЗВОДИМЫЙ КЕЙС")}</span>
          <h1>Time Machine</h1>
          <p>
            {t("Запишите ответы в файл и передайте коллеге тот же сценарий.")}
          </p>
        </div>
        <span className={`scenario-state ${status.active ? "live" : ""}`}>
          <span className="small-dot" />
          {t(status.active ? "Воспроизведение идёт" : "Ожидание")}
        </span>
      </div>

      <div className="scenario-flow" aria-label={t("Порядок работы")}>
        <div>
          <b>01</b>
          <span>{t("Захватите трафик")}</span>
        </div>
        <div>
          <b>02</b>
          <span>{t("Создайте или откройте пакет")}</span>
        </div>
        <div>
          <b>03</b>
          <span>{t("Запустите воспроизведение")}</span>
        </div>
      </div>

      <div className="scenario-columns">
        <section className="scenario-panel">
          <div className="scenario-panel-head">
            <span className="eyebrow">{t("ИСТОЧНИК")}</span>
            <h2>{t("Текущая сессия")}</h2>
            <p>{capture.title || t("Нет подключённой вкладки")}</p>
          </div>
          <div className="scenario-counts">
            <div>
              <strong>{availableHttp}</strong>
              <span>HTTP</span>
            </div>
            <div>
              <strong>{availableWs}</strong>
              <span>WebSocket</span>
            </div>
          </div>
          <label className="scenario-name">
            {t("Имя пакета")}
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("Например: ошибка после комментария")}
            />
          </label>
          <div className="scenario-actions">
            <Button
              className="primary"
              disabled={
                availableHttp + availableWs === 0 || busy || status.active
              }
              onClick={makePack}
            >
              {t("Создать пакет")}
            </Button>
            {capture.tabId === null && (
              <Button onClick={onCapture}>
                {t("Открыть сетевой журнал")} <ArrowRight size={14} />
              </Button>
            )}
          </div>
          <p className="scenario-note">
            {t(
              "В пакет входят только полные текстовые ответы и текстовые WS-кадры. Секреты и персональные данные в ответах могут сохраниться — проверьте файл перед передачей.",
            )}
          </p>
        </section>

        <section className="scenario-panel scenario-pack-panel">
          <div className="scenario-panel-head">
            <span className="eyebrow">{t("ПАКЕТ")}</span>
            <h2>{pack?.meta.name || t("Пакет не выбран")}</h2>
            <p>
              {pack
                ? new Date(pack.meta.createdAt).toLocaleString()
                : t("Создайте пакет из записи или импортируйте файл коллеги.")}
            </p>
          </div>
          <div className="scenario-counts">
            <div>
              <strong>{pack?.http.length || 0}</strong>
              <span>HTTP</span>
            </div>
            <div>
              <strong>{pack?.ws.length || 0}</strong>
              <span>WebSocket</span>
            </div>
            <div>
              <strong>{pack?.rules.length || 0}</strong>
              <span>{t("Правил")}</span>
            </div>
          </div>
          <div className="scenario-actions">
            <Button
              icon={FileArrowUp}
              onClick={() => fileInput.current?.click()}
              disabled={busy || status.active}
            >
              {t("Импортировать")}
            </Button>
            <input
              ref={fileInput}
              className="scenario-file-input"
              type="file"
              accept=".json,.easysniff.json,application/json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importPack(file);
                event.target.value = "";
              }}
            />
            <Button
              icon={DownloadSimple}
              disabled={!pack || busy}
              onClick={() => {
                if (!pack) return;
                download(
                  `${pack.meta.name.replace(/[^a-z0-9-]+/gi, "-").toLowerCase() || "scenario"}.easysniff.json`,
                  JSON.stringify(pack, null, 2),
                );
              }}
            >
              {t("Скачать пакет")}
            </Button>
          </div>
          {pack && (
            <div className="scenario-preview">
              {pack.http.slice(0, 5).map((entry) => (
                <div key={entry.seq}>
                  <span>HTTP</span>
                  <code>
                    {entry.method} {entry.url}
                  </code>
                  <b>{entry.status}</b>
                </div>
              ))}
              {pack.http.length > 5 && (
                <small>
                  {t("И ещё {0} HTTP-запросов", [pack.http.length - 5])}
                </small>
              )}
            </div>
          )}
        </section>
      </div>

      <section className="scenario-replay">
        <div>
          <span className="eyebrow">{t("ВОСПРОИЗВЕДЕНИЕ")}</span>
          <h2>{status.active ? status.name : t("Готово к запуску")}</h2>
          <p>
            {t("HTTP: {0}/{1} ответов выдано", [
              status.consumed,
              status.httpCount,
            ])}
            {status.scheduledWs > 0 ? ` · WS: ${status.scheduledWs}` : ""}
          </p>
        </div>
        <div className="scenario-actions">
          {status.active ? (
            <>
              <Button
                icon={Waveform}
                disabled={busy || status.wsCount === 0}
                onClick={() => void run("playWs")}
              >
                {t("Показать WS-кадры")}
              </Button>
              <Button
                icon={Stop}
                disabled={busy}
                onClick={() => void run("stop")}
              >
                {t("Остановить")}
              </Button>
            </>
          ) : (
            <Button
              className="primary"
              icon={Play}
              disabled={!pack || capture.tabId === null || busy}
              onClick={() => void run("start")}
            >
              {t("Начать воспроизведение")}
            </Button>
          )}
        </div>
      </section>
      <p className="scenario-note">
        {t(
          "HTTP-пакет подменяет только записанные URL и методы; остальные запросы идут в сеть. Для WS откройте соединение на тестовой странице и запустите кадры отдельно. Сохранённые правила включены в пакет как справка, но не применяются. Клики и переходы пока не записываются.",
        )}
      </p>
      {notice && <div className="inline-hint">{notice}</div>}
      <ErrorNote error={error} />
    </div>
  );
}
