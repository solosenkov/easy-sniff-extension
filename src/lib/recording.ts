export type RecordingKind =
  | "request"
  | "response"
  | "console"
  | "exception"
  | "network-error"
  | "websocket"
  | "marker"
  | "system";
export type RecordingSeverity = "normal" | "warning" | "error";
export interface RecordingEvent {
  id: string;
  at: number;
  kind: RecordingKind;
  severity: RecordingSeverity;
  title: string;
  detail?: string;
  requestId?: string;
  status?: number;
  duration?: number;
}
export interface RecordingSession {
  id: string;
  title: string;
  tabUrl: string;
  startedAt: number;
  endedAt?: number;
  status: "recording" | "stopping" | "saved" | "failed";
  events: RecordingEvent[];
  error?: string;
  mimeType?: string;
  size?: number;
}
export interface StoredRecording {
  session: RecordingSession;
  video: Blob;
}
const DB_NAME = "easy-sniff-recordings";
const STORE = "sessions";
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () =>
      req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function transaction<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore, done: (value: T) => void) => void,
): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    let value: T;
    tx.oncomplete = () => {
      db.close();
      resolve(value);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
    run(tx.objectStore(STORE), (result) => {
      value = result;
    });
  });
}
export function saveVideo(id: string, video: Blob): Promise<void> {
  return transaction("readwrite", (store) => {
    store.put({ id, video });
  });
}
export function saveSession(session: RecordingSession): Promise<void> {
  return transaction("readwrite", (store) => {
    const req = store.get(session.id);
    req.onsuccess = () =>
      store.put({ id: session.id, video: req.result?.video, session });
  });
}
export function getRecording(id: string): Promise<StoredRecording | undefined> {
  return transaction("readonly", (store, done) => {
    const req = store.get(id);
    req.onsuccess = () =>
      done(
        req.result?.session && req.result?.video
          ? (req.result as StoredRecording)
          : undefined,
      );
  });
}
export function listRecordings(): Promise<RecordingSession[]> {
  return transaction("readonly", (store, done) => {
    const req = store.getAll();
    req.onsuccess = () =>
      done(
        (req.result as Array<{ session?: RecordingSession }>)
          .map((row) => row.session)
          .filter((s): s is RecordingSession => !!s)
          .sort((a, b) => b.startedAt - a.startedAt),
      );
  });
}
export function deleteRecording(id: string): Promise<void> {
  return transaction("readwrite", (store) => {
    store.delete(id);
  });
}
export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (
        /token|secret|password|passwd|authorization|auth|api.?key|session|code|credential|signature/i.test(
          key,
        )
      )
        url.searchParams.set(key, "[redacted]");
    }
    return url.toString();
  } catch {
    return raw.slice(0, 1000);
  }
}
export function redactText(input: string): string {
  return input
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\bsk-(?:or-v1-)?[A-Za-z0-9_-]{12,}\b/g, "[redacted key]")
    .slice(0, 2000);
}
