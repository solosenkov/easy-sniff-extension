import type { CaptureRequest } from "./types";

export type TrafficKind =
  | "all"
  | "xhr"
  | "fetch"
  | "ws"
  | "image"
  | "document"
  | "script"
  | "style"
  | "other";

export function trafficKind(
  request: CaptureRequest,
): Exclude<TrafficKind, "all"> {
  const type = request.type.toLowerCase();
  if (type === "websocket" || /^wss?:/i.test(request.url)) return "ws";
  if (type === "xhr") return "xhr";
  if (type === "fetch") return "fetch";
  if (
    type === "image" ||
    request.mime?.startsWith("image/") ||
    /\.(?:png|jpe?g|gif|webp|svg|ico|avif)(?:[?#]|$)/i.test(request.url)
  )
    return "image";
  if (type === "document") return "document";
  if (type === "script") return "script";
  if (type === "stylesheet") return "style";
  return "other";
}

export function socketTopics(url: string): string[] {
  try {
    const topics = new Set<string>();
    for (const [key, value] of new URL(url).searchParams) {
      if (
        /^(?:topics?(?:\[\])?|channels?(?:\[\])?|subscriptions?(?:\[\])?)$/i.test(
          key,
        ) &&
        value
      )
        topics.add(value);
    }
    return [...topics];
  } catch {
    return [];
  }
}

export function limitRequests(
  requests: CaptureRequest[],
  max = 300,
  maxSockets = 60,
): CaptureRequest[] {
  let sockets = 0;
  return requests
    .filter(
      (request) => request.type !== "WebSocket" || ++sockets <= maxSockets,
    )
    .slice(0, max);
}
