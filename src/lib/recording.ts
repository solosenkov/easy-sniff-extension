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
  exchangeId?: string;
  status?: number;
  duration?: number;
}
export interface RecordingBody {
  content: string;
  base64: boolean;
  truncated?: boolean;
  error?: string;
}
export interface RecordingExchange {
  id: string;
  requestId: string;
  url: string;
  method: string;
  resourceType: string;
  startedAt: number;
  requestHeaders: Record<string, string>;
  requestHeadersText?: string;
  requestCookies?: unknown[];
  requestExtraSeen?: boolean;
  requestBody?: RecordingBody;
  responseHeaders?: Record<string, string>;
  responseHeadersText?: string;
  responseCookies?: unknown[];
  responseExtraSeen?: boolean;
  responseBody?: RecordingBody;
  status?: number;
  statusText?: string;
  mimeType?: string;
  protocol?: string;
  remoteAddress?: string;
  fromDiskCache?: boolean;
  timing?: Record<string, unknown>;
  duration?: number;
  encodedDataLength?: number;
  error?: string;
}
export interface RecordingSession {
  id: string;
  title: string;
  tabUrl: string;
  startedAt: number;
  endedAt?: number;
  status: "recording" | "stopping" | "saved" | "failed";
  events: RecordingEvent[];
  fullHttp?: boolean;
  networkCount?: number;
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
const NETWORK_STORE = "network";
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE))
        req.result.createObjectStore(STORE, { keyPath: "id" });
      if (!req.result.objectStoreNames.contains(NETWORK_STORE)) {
        const network = req.result.createObjectStore(NETWORK_STORE, {
          keyPath: "id",
        });
        network.createIndex("sessionId", "sessionId");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function transaction<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore, done: (value: T) => void) => void,
  storeName = STORE,
): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
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
    run(tx.objectStore(storeName), (result) => {
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
  return Promise.all([
    transaction<void>("readwrite", (store) => {
      store.delete(id);
    }),
    transaction<void>(
      "readwrite",
      (store) => {
        const range = IDBKeyRange.only(id);
        const cursor = store.index("sessionId").openCursor(range);
        cursor.onsuccess = () => {
          if (!cursor.result) return;
          cursor.result.delete();
          cursor.result.continue();
        };
      },
      NETWORK_STORE,
    ),
  ]).then(() => {});
}
export function saveExchange(
  sessionId: string,
  exchange: RecordingExchange,
): Promise<void> {
  return transaction(
    "readwrite",
    (store) => {
      store.put({
        ...structuredClone(exchange),
        id: `${sessionId}:${exchange.id}`,
        exchangeId: exchange.id,
        sessionId,
      });
    },
    NETWORK_STORE,
  );
}
export function getRecordingExchanges(
  sessionId: string,
): Promise<RecordingExchange[]> {
  return transaction(
    "readonly",
    (store, done) => {
      const req = store.index("sessionId").getAll(IDBKeyRange.only(sessionId));
      req.onsuccess = () =>
        done(
          (
            req.result as Array<
              RecordingExchange & { exchangeId: string; sessionId: string }
            >
          )
            .map((row) => {
              const {
                exchangeId,
                sessionId: _sessionId,
                id: _key,
                ...rest
              } = row;
              return { ...rest, id: exchangeId };
            })
            .sort((a, b) => a.startedAt - b.startedAt),
        );
    },
    NETWORK_STORE,
  );
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
function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
export function curlFromExchange(exchange: RecordingExchange): string {
  const headers = new Map(Object.entries(exchange.requestHeaders || {}));
  const hasCookie = [...headers.keys()].some(
    (key) => key.toLowerCase() === "cookie",
  );
  if (!hasCookie && exchange.requestCookies?.length) {
    const cookies = exchange.requestCookies
      .map((entry: any) =>
        entry?.blockedReasons?.length
          ? ""
          : entry?.cookie?.name
            ? `${entry.cookie.name}=${entry.cookie.value}`
            : "",
      )
      .filter(Boolean);
    if (cookies.length) headers.set("Cookie", cookies.join("; "));
  }
  const parts = [
    `curl -X ${shellQuote(exchange.method)} ${shellQuote(exchange.url)}`,
  ];
  for (const [name, value] of headers) {
    if (/^:|^(content-length|transfer-encoding)$/i.test(name)) continue;
    parts.push(`  -H ${shellQuote(`${name}: ${value}`)}`);
  }
  if (exchange.requestBody?.content && !exchange.requestBody.base64) {
    parts.push(`  --data-raw ${shellQuote(exchange.requestBody.content)}`);
  }
  const command = parts.join(" \\\n");
  if (exchange.requestBody?.truncated || exchange.requestBody?.base64)
    return `# Request body was ${exchange.requestBody.truncated ? "truncated" : "captured as base64"}; review before running.\n${command}`;
  return command;
}
