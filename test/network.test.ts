import test from "node:test";
import assert from "node:assert/strict";
import { limitRequests, socketTopics, trafficKind } from "../src/lib/network";
import type { CaptureRequest } from "../src/lib/types";

function request(type: string, url: string, mime?: string): CaptureRequest {
  return {
    id: "1",
    requestId: "1",
    type,
    url,
    method: "GET",
    start: 0,
    requestHeaders: {},
    mime,
  };
}

test("network filters classify captured resource types and image fallbacks", () => {
  assert.equal(trafficKind(request("XHR", "https://example.test/api")), "xhr");
  assert.equal(
    trafficKind(request("Fetch", "https://example.test/api")),
    "fetch",
  );
  assert.equal(
    trafficKind(request("WebSocket", "wss://example.test/live")),
    "ws",
  );
  assert.equal(
    trafficKind(request("Other", "https://example.test/favicon.ico?v=2")),
    "image",
  );
  assert.equal(
    trafficKind(request("Other", "https://example.test/blob", "image/webp")),
    "image",
  );
  assert.equal(
    trafficKind(request("Stylesheet", "https://example.test/site.css")),
    "style",
  );
  assert.equal(
    trafficKind(request("Font", "https://example.test/font.woff2")),
    "other",
  );
});

test("WebSocket topics are decoded from repeated URL parameters", () => {
  assert.deepEqual(
    socketTopics(
      "wss://example.test/sse?topics[]=user.42&topics[]=sprint%20updates&topics[]=user.42",
    ),
    ["user.42", "sprint updates"],
  );
  assert.deepEqual(socketTopics("wss://example.test/live?token=secret"), []);
  assert.deepEqual(socketTopics("not a url"), []);
});
test("WebSocket reconnect storms do not evict HTTP requests", () => {
  const http = Array.from({ length: 100 }, (_, index) => ({
    ...request("XHR", `https://test.example/api/${index}`),
    id: `http-${index}`,
  }));
  const sockets = Array.from({ length: 200 }, (_, index) => ({
    ...request("WebSocket", `wss://test.example/sse/${index}`),
    id: `ws-${index}`,
  }));
  const retained = limitRequests([...sockets, ...http]);
  assert.equal(retained.filter((row) => row.type === "WebSocket").length, 60);
  assert.equal(retained.filter((row) => row.type === "XHR").length, 100);
});
