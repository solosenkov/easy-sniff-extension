import type { WsRule } from "./types";

// Serialized into the selected tab's MAIN world through CDP. Keep this function
// self-contained: imports and closures are not available in the page.
export function installWsBridge(initialRules: WsRule[]) {
  type Bridge = {
    setRules: (rules: WsRule[]) => void;
    send: (url: string, data: string) => string;
    inject: (url: string, data: string) => string;
    connections: (url: string) => number;
    stop: () => void;
  };
  const page = globalThis as typeof globalThis & { __easySniffWs?: Bridge };
  if (page.__easySniffWs) {
    page.__easySniffWs.setRules(initialRules);
    return;
  }
  const NativeWebSocket = page.WebSocket;
  const sockets = new Set<WebSocket>();
  const listeners = new Map<WebSocket, (event: MessageEvent) => void>();
  const synthetic = new WeakSet<Event>();
  let rules = initialRules;

  function matches(pattern: string, url: string) {
    const escaped = pattern
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replaceAll("*", ".*");
    return new RegExp(`^${escaped}$`).test(url);
  }
  function findSocket(url: string) {
    const found = [...sockets].filter(
      (socket) =>
        socket.url === url && socket.readyState === NativeWebSocket.OPEN,
    );
    if (!found.length)
      throw new Error(
        "No captured open socket for this URL. Reload the test page after starting capture.",
      );
    if (found.length > 1)
      throw new Error(
        "Several open sockets share this URL. Choose a unique connection or close the duplicates.",
      );
    return found[0];
  }
  function track(socket: WebSocket) {
    sockets.add(socket);
    const listener = (event: MessageEvent) => {
      if (synthetic.has(event)) return;
      const data = event.data;
      if (typeof data !== "string") return;
      const rule = rules.find(
        (item) =>
          item.action === "replace" &&
          item.enabled &&
          matches(item.pattern, socket.url) &&
          (!item.contains || data.includes(item.contains)),
      );
      if (!rule) return;
      event.stopImmediatePropagation();
      const replacement = new MessageEvent("message", {
        data: rule.replacement,
        origin: event.origin,
        lastEventId: event.lastEventId,
      });
      synthetic.add(replacement);
      socket.dispatchEvent(replacement);
    };
    socket.addEventListener("message", listener);
    listeners.set(socket, listener);
    socket.addEventListener(
      "close",
      () => {
        sockets.delete(socket);
        listeners.delete(socket);
      },
      { once: true },
    );
    return socket;
  }
  const WrappedWebSocket = new Proxy(NativeWebSocket, {
    construct(target, args) {
      return track(Reflect.construct(target, args));
    },
  });
  page.WebSocket = WrappedWebSocket;
  page.__easySniffWs = {
    setRules(next) {
      rules = next;
    },
    send(url, data) {
      findSocket(url).send(data);
      return "sent";
    },
    inject(url, data) {
      const socket = findSocket(url);
      const event = new MessageEvent("message", {
        data,
        origin: new URL(url).origin,
      });
      synthetic.add(event);
      socket.dispatchEvent(event);
      return "injected";
    },
    connections(url) {
      return [...sockets].filter(
        (socket) =>
          socket.url === url && socket.readyState === NativeWebSocket.OPEN,
      ).length;
    },
    stop() {
      rules = [];
      for (const [socket, listener] of listeners)
        socket.removeEventListener("message", listener);
      listeners.clear();
      sockets.clear();
      if (page.WebSocket === WrappedWebSocket) page.WebSocket = NativeWebSocket;
      delete page.__easySniffWs;
    },
  };
}
