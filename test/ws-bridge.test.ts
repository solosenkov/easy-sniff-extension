import test from "node:test";
import assert from "node:assert/strict";
import { installWsBridge } from "../src/lib/ws-bridge";

class FakeSocket extends EventTarget {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSING = 2;
  static CLOSED = 3;
  url: string;
  readyState = 1;
  sent: string[] = [];
  constructor(url: string) {
    super();
    this.url = url;
  }
  send(data: string) {
    this.sent.push(data);
  }
  receive(data: string) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
  close() {
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  }
}

test("WebSocket bridge sends, injects, replaces matching incoming frames and restores the page", () => {
  const original = globalThis.WebSocket;
  (globalThis as any).WebSocket = FakeSocket;
  try {
    installWsBridge([
      {
        id: "one",
        name: "test",
        action: "replace",
        enabled: true,
        pattern: "wss://example.test/events*",
        contains: "page_updated",
        replacement: '{"type":"mocked"}',
      },
    ]);
    const socket = new WebSocket(
      "wss://example.test/events",
    ) as unknown as FakeSocket;
    const received: string[] = [];
    socket.addEventListener("message", (event) =>
      received.push((event as MessageEvent).data),
    );
    socket.receive('{"type":"other"}');
    socket.receive('{"type":"page_updated"}');
    const bridge = (globalThis as any).__easySniffWs;
    assert.deepEqual(received, ['{"type":"other"}', '{"type":"mocked"}']);
    assert.equal(bridge.send(socket.url, "hello"), "sent");
    assert.deepEqual(socket.sent, ["hello"]);
    assert.equal(bridge.inject(socket.url, "synthetic"), "injected");
    assert.equal(received.at(-1), "synthetic");
    bridge.setRules([
      {
        id: "manual",
        name: "manual",
        action: "send",
        enabled: true,
        pattern: socket.url,
        contains: "",
        replacement: "should not replace",
      },
    ]);
    socket.receive("still original");
    assert.equal(received.at(-1), "still original");
    const duplicate = new WebSocket(socket.url) as unknown as FakeSocket;
    assert.throws(
      () => bridge.send(socket.url, "unsafe"),
      /Several open sockets/,
    );
    duplicate.close();
    bridge.stop();
    assert.equal(
      globalThis.WebSocket,
      FakeSocket as unknown as typeof WebSocket,
    );
    socket.receive('{"type":"page_updated"}');
    assert.equal(received.at(-1), '{"type":"page_updated"}');
  } finally {
    (globalThis as any).__easySniffWs?.stop();
    globalThis.WebSocket = original;
  }
});
