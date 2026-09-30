import { useEffect, useRef, useState } from "react";
import {
  DownloadSimple,
  Flag,
  Play,
  Record,
  Stop,
  Trash,
  VideoCamera,
} from "@phosphor-icons/react";
import { t, currentLocale } from "../lib/i18n";
import {
  type RecordingEvent,
  type RecordingSession,
  deleteRecording,
  getRecording,
  listRecordings,
} from "../lib/recording";
import { reportHtml, zipFiles } from "../lib/recording-export";
import { isExtension, rpc } from "../lib/storage";
import { Button, ErrorNote } from "./Primitives";
import type { CaptureState } from "../lib/types";

type BrowserTab = { id: number; title: string; url: string };
function time(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
function kindLabel(kind: RecordingEvent["kind"]) {
  return {
    request: "HTTP →",
    response: "HTTP ←",
    console: "Console",
    exception: "Exception",
    "network-error": "Network error",
    websocket: "WebSocket",
    marker: "Marker",
    system: "System",
  }[kind];
}
export function BugRecording({
  capture,
  onCapture,
}: {
  capture: CaptureState;
  onCapture: (state: CaptureState) => void;
}) {
  const [tabs, setTabs] = useState<BrowserTab[]>([]);
  const [tabId, setTabId] = useState<number | null>(capture.tabId);
  const [eligibleTabId, setEligibleTabId] = useState<number | null>(null);
  const [active, setActive] = useState<RecordingSession | null>(null);
  const [saved, setSaved] = useState<RecordingSession[]>([]);
  const [selected, setSelected] = useState<RecordingSession | null>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [filter, setFilter] = useState<
    "all" | "errors" | "network" | "console" | "markers"
  >("all");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const video = useRef<HTMLVideoElement>(null);
  const [playhead, setPlayhead] = useState(0);
  async function refresh() {
    if (!isExtension) return;
    const [browserTabs, recordings, current, eligible] = await Promise.all([
      rpc<BrowserTab[]>("capture.tabs"),
      listRecordings(),
      rpc<RecordingSession | null>("recording.status"),
      rpc<number | null>("recording.eligible"),
    ]);
    setTabs(browserTabs);
    setSaved(recordings);
    setActive(
      current?.status === "recording" || current?.status === "stopping"
        ? current
        : null,
    );
    setEligibleTabId(eligible);
    if (current?.status === "saved") setSelected((s) => s || current);
    setTabId(
      (id) => eligible ?? id ?? capture.tabId ?? browserTabs[0]?.id ?? null,
    );
  }
  useEffect(() => {
    void refresh().catch((e) => setError(String(e)));
    const listener = (message: any) => {
      if (message.type === "recording.updated") {
        setActive(
          message.recording?.status === "recording" ||
            message.recording?.status === "stopping"
            ? message.recording
            : null,
        );
        if (message.recording?.status === "saved") {
          setSelected(message.recording);
          void listRecordings().then(setSaved);
        }
      }
      if (message.type === "recording.target") {
        setEligibleTabId(message.tabId);
        setTabId(message.tabId);
        void rpc<BrowserTab[]>("capture.tabs").then(setTabs);
      }
    };
    if (isExtension) chrome.runtime.onMessage.addListener(listener);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(tick);
      if (isExtension) chrome.runtime.onMessage.removeListener(listener);
    };
  }, []);
  useEffect(() => {
    if (!selected) {
      setVideoUrl("");
      return;
    }
    let url = "";
    let cancelled = false;
    void getRecording(selected.id).then((record) => {
      if (record) {
        url = URL.createObjectURL(record.video);
        if (cancelled) URL.revokeObjectURL(url);
        else setVideoUrl(url);
      }
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [selected?.id]);
  async function start() {
    if (tabId === null) return;
    setBusy(true);
    setError("");
    try {
      if (capture.tabId !== tabId)
        onCapture(await rpc<CaptureState>("capture.start", { tabId }));
      const session = await rpc<RecordingSession>("recording.start", { tabId });
      setSelected(null);
      setActive(session);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }
  async function stop() {
    setBusy(true);
    setError("");
    try {
      const session = await rpc<RecordingSession>("recording.stop");
      if (session.status === "failed")
        throw new Error(session.error || "Recording could not be saved");
      setActive(null);
      setSelected(session);
      setSaved(await listRecordings());
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }
  async function marker() {
    try {
      setActive(
        await rpc<RecordingSession>("recording.marker", {
          label: t("Баг проявился"),
        }),
      );
    } catch (e) {
      setError(String(e));
    }
  }
  async function exportZip(session: RecordingSession) {
    setBusy(true);
    setError("");
    try {
      const record = await getRecording(session.id);
      if (!record) throw new Error("Recording data is missing");
      const zip = await zipFiles([
        { name: "report.html", data: reportHtml(record.session) },
        { name: "session.json", data: JSON.stringify(record.session, null, 2) },
        { name: "video.webm", data: record.video },
      ]);
      const url = URL.createObjectURL(zip);
      const link = document.createElement("a");
      link.href = url;
      link.download = `bug-replay-${new Date(session.startedAt).toISOString().slice(0, 16).replaceAll(":", "-")}-${session.id.slice(0, 6)}.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove(session: RecordingSession) {
    if (!confirm(t("Удалить эту запись с устройства?"))) return;
    try {
      await deleteRecording(session.id);
      if (selected?.id === session.id) setSelected(null);
      setSaved(await listRecordings());
    } catch (e) {
      setError(String(e));
    }
  }
  const duration = selected
    ? Math.max(1, (selected.endedAt || selected.startedAt) - selected.startedAt)
    : 1;
  const events =
    selected?.events.filter(
      (event) =>
        filter === "all" ||
        (filter === "errors" && event.severity === "error") ||
        (filter === "network" &&
          ["request", "response", "network-error", "websocket"].includes(
            event.kind,
          )) ||
        (filter === "console" &&
          ["console", "exception"].includes(event.kind)) ||
        (filter === "markers" && event.kind === "marker"),
    ) || [];
  const errorCount =
    (active || selected)?.events.filter((e) => e.severity === "error").length ||
    0;
  return (
    <div className="recording-page">
      <div className="recording-heading">
        <div>
          <span className="eyebrow">BUG REPLAY</span>
          <h1>{t("Запись бага")}</h1>
          <p>
            {t("Видео вкладки, консоль и сеть — на одной временной шкале.")}
          </p>
        </div>
        <span className="recording-local">
          {t("Только на этом устройстве")}
        </span>
      </div>
      <ErrorNote error={error} />
      <div className="recording-setup">
        <div className="recording-setup-label">
          <VideoCamera size={22} />
          <div>
            <strong>{t("Вкладка для записи")}</strong>
            <small>{t("Выберите страницу, затем воспроизведите баг.")}</small>
          </div>
        </div>
        <select
          aria-label={t("Вкладка для записи")}
          value={tabId ?? ""}
          disabled={!!active}
          onChange={(e) => setTabId(Number(e.target.value))}
        >
          {tabs.map((tab) => (
            <option key={tab.id} value={tab.id}>
              {tab.title} · {tab.url}
            </option>
          ))}
        </select>
        {!active ? (
          <Button
            className="primary"
            icon={Record}
            disabled={
              busy || tabId === null || !isExtension || tabId !== eligibleTabId
            }
            onClick={() => void start()}
          >
            {t("Начать запись")}
          </Button>
        ) : (
          <Button icon={Stop} disabled={busy} onClick={() => void stop()}>
            {t("Остановить")}
          </Button>
        )}
      </div>
      {!active && tabId !== eligibleTabId && (
        <p className="recording-guidance">
          {t(
            "На выбранной вкладке нажмите иконку Easy Sniff, затем вернитесь сюда и начните запись.",
          )}
        </p>
      )}
      {active ? (
        <section className="recording-live">
          <div className="recording-live-top">
            <div>
              <span className="recording-pulse" /> REC{" "}
              <strong>{time(now - active.startedAt)}</strong>
            </div>
            <span>
              {t("Событий: {0}", [active.events.length])} ·{" "}
              {t("Ошибок: {0}", [errorCount])}
            </span>
          </div>
          <p>{active.title}</p>
          <Button icon={Flag} onClick={() => void marker()} disabled={busy}>
            {t("Баг проявился")}
          </Button>
          <small>
            {t(
              "Запись экрана может содержать личные данные. Просмотрите видео перед отправкой.",
            )}
          </small>
        </section>
      ) : (
        <section className="recording-intro">
          <strong>{t("Один файл вместо переписки о баге")}</strong>
          <p>
            {t(
              "Запишите воспроизведение, отметьте момент ошибки и скачайте ZIP. Разработчик откроет report.html рядом с видео и логами.",
            )}
          </p>
        </section>
      )}
      <div className="recording-columns">
        <aside className="recording-sessions">
          <h2>{t("Записи")}</h2>
          {saved.length ? (
            saved.map((session) => (
              <button
                key={session.id}
                className={selected?.id === session.id ? "selected" : ""}
                onClick={() => {
                  setSelected(session);
                  setFilter("all");
                }}
              >
                <span>
                  {new Date(session.startedAt).toLocaleString(currentLocale())}
                </span>
                <strong>{session.title}</strong>
                <small>
                  {time(
                    (session.endedAt || session.startedAt) - session.startedAt,
                  )}{" "}
                  · {session.events.length} {t("событий")}
                </small>
              </button>
            ))
          ) : (
            <p>{t("Записей пока нет. Они появятся здесь после остановки.")}</p>
          )}
        </aside>
        <div className="recording-review">
          {selected ? (
            <>
              <div className="recording-review-head">
                <div>
                  <span className="eyebrow">REVIEW</span>
                  <h2>{selected.title}</h2>
                  <small>
                    {new Date(selected.startedAt).toLocaleString(
                      currentLocale(),
                    )}{" "}
                    · {selected.events.length} {t("событий")}
                  </small>
                </div>
                <div>
                  <Button
                    icon={DownloadSimple}
                    disabled={busy}
                    onClick={() => void exportZip(selected)}
                  >
                    {t("Скачать ZIP")}
                  </Button>
                  <Button
                    className="quiet"
                    icon={Trash}
                    onClick={() => void remove(selected)}
                  >
                    {t("Удалить")}
                  </Button>
                </div>
              </div>
              {videoUrl && (
                <video
                  ref={video}
                  src={videoUrl}
                  controls
                  preload="metadata"
                  onLoadedMetadata={(e) => {
                    const player = e.currentTarget;
                    if (!Number.isFinite(player.duration)) {
                      player.currentTime = 1e10;
                      player.addEventListener(
                        "seeked",
                        () => {
                          player.currentTime = 0;
                        },
                        { once: true },
                      );
                    }
                  }}
                  onTimeUpdate={(e) =>
                    setPlayhead(e.currentTarget.currentTime * 1000)
                  }
                />
              )}
              <div
                className="recording-timeline"
                aria-label={t("Временная шкала")}
              >
                <span
                  className="recording-cursor"
                  style={{
                    left: `${Math.min(100, (playhead / duration) * 100)}%`,
                  }}
                />
                {selected.events
                  .filter((e) => e.severity !== "normal" || e.kind === "marker")
                  .map((event) => (
                    <button
                      key={event.id}
                      title={`${time(event.at)} · ${event.title}`}
                      className={`recording-tick ${event.severity}`}
                      style={{
                        left: `${Math.min(99.5, (event.at / duration) * 100)}%`,
                      }}
                      onClick={() => {
                        if (video.current) {
                          video.current.currentTime = event.at / 1000;
                          void video.current.play();
                        }
                      }}
                    />
                  ))}
              </div>
              <div className="recording-scale">
                <span>00:00</span>
                <span>{time(duration)}</span>
              </div>
              <div className="recording-filter">
                {(
                  ["all", "errors", "network", "console", "markers"] as const
                ).map((item) => (
                  <button
                    key={item}
                    className={filter === item ? "active" : ""}
                    onClick={() => setFilter(item)}
                  >
                    {t(
                      {
                        all: "Все",
                        errors: "Ошибки",
                        network: "Сеть",
                        console: "Консоль",
                        markers: "Метки",
                      }[item],
                    )}
                  </button>
                ))}
              </div>
              <div className="recording-events">
                {events.map((event) => (
                  <button
                    key={event.id}
                    className={`recording-event ${event.severity}`}
                    onClick={() => {
                      if (video.current) {
                        video.current.currentTime = event.at / 1000;
                        void video.current.play();
                      }
                    }}
                  >
                    <span>{time(event.at)}</span>
                    <em>{kindLabel(event.kind)}</em>
                    <strong>{event.title}</strong>
                    {event.detail && <small>{event.detail}</small>}
                  </button>
                ))}
                {events.length === 0 && (
                  <p>{t("Для этого фильтра событий нет.")}</p>
                )}
              </div>
              <p className="recording-privacy">
                {t(
                  "Отчёт включает видео и URL запросов. Секретные query-параметры скрываются автоматически, но проверьте экран перед отправкой.",
                )}
              </p>
            </>
          ) : (
            <div className="recording-empty">
              <Play size={30} />
              <strong>{t("Выберите запись для просмотра")}</strong>
              <p>{t("Здесь появятся видео, события и отметки ошибок.")}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
