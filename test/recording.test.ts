import test from "node:test";
import assert from "node:assert/strict";
import { Script } from "node:vm";
import {
  curlFromExchange,
  redactText,
  redactUrl,
  type RecordingExchange,
  type RecordingSession,
} from "../src/lib/recording";
import { reportHtml, zipFiles } from "../src/lib/recording-export";

const exchange: RecordingExchange = {
  id: "exchange-1",
  requestId: "request-1",
  url: "https://example.test/api/items?name=O'Hara",
  method: "POST",
  resourceType: "XHR",
  startedAt: 100,
  requestHeaders: {
    Authorization: "Bearer fake-demo-token",
    Cookie: "sid=fake-demo-cookie",
    "Content-Length": "20",
    ":authority": "example.test",
  },
  requestBody: { content: '{"name":"O\'Hara"}', base64: false },
  status: 500,
  responseHeaders: { "Set-Cookie": "sid=fake-next-cookie; HttpOnly" },
};
const session: RecordingSession = {
  id: "demo",
  title: "Demo",
  tabUrl: "https://example.test",
  startedAt: 0,
  endedAt: 1000,
  status: "saved",
  events: [],
};

test("recording summaries redact credentials while preserving useful URLs", () => {
  const url = redactUrl(
    "https://user:fake-password@example.test/api?token=fake-token&page=2",
  );
  assert.ok(!url.includes("fake-password"));
  assert.ok(!url.includes("fake-token"));
  assert.ok(url.includes("page=2"));
  assert.equal(redactText("Bearer fake-demo-token"), "Bearer [redacted]");
});

test("full HTTP cURL retains credentials, safely quotes apostrophes and omits transport headers", () => {
  const curl = curlFromExchange(exchange);
  assert.ok(curl.includes("Bearer fake-demo-token"));
  assert.ok(curl.includes("sid=fake-demo-cookie"));
  assert.ok(curl.includes("'\\''"));
  assert.ok(!curl.includes("Content-Length"));
  assert.ok(!curl.includes(":authority"));
  assert.ok(curl.includes("--data-raw"));
});

test("cURL reconstructs only sent cookies and labels an incomplete body", () => {
  const curl = curlFromExchange({
    ...exchange,
    requestHeaders: {},
    requestCookies: [
      { cookie: { name: "sent", value: "fake" }, blockedReasons: [] },
      {
        cookie: { name: "blocked", value: "never-send" },
        blockedReasons: ["SecureOnly"],
      },
    ],
    requestBody: { content: "partial", base64: false, truncated: true },
  });
  assert.ok(curl.includes("Cookie: sent=fake"));
  assert.ok(!curl.includes("never-send"));
  assert.ok(curl.startsWith("# Request body was truncated"));
});

test("offline report escapes script-breaking content, retains opted-in details and has valid JavaScript", () => {
  const html = reportHtml({
    ...session,
    title: "</script><script>throw 'unsafe'</script>",
    fullHttp: true,
    network: [{ ...exchange, curl: curlFromExchange(exchange) }],
  });
  assert.ok(!html.includes("<script>throw 'unsafe'</script>"));
  assert.ok(html.includes("fake-demo-token"));
  assert.ok(html.includes("fake-next-cookie"));
  const script = html.match(/<script>\s*([\s\S]*?)<\/script><\/body>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Script(script));
  const data = html.match(
    /<script id="report" type="application\/json">([\s\S]*?)<\/script>/,
  )?.[1];
  assert.ok(data);
  assert.equal(
    JSON.parse(data).network[0].requestHeaders.Cookie,
    "sid=fake-demo-cookie",
  );
});

test("report ZIP includes the named files with their original bytes", async () => {
  const files = [
    { name: "report.html", data: reportHtml(session) },
    { name: "session.json", data: JSON.stringify(session) },
    { name: "video.webm", data: new Blob([new Uint8Array([1, 2, 3, 4])]) },
  ];
  const bytes = new Uint8Array(await (await zipFiles(files)).arrayBuffer());
  const view = new DataView(bytes.buffer);
  let offset = 0;
  for (const file of files) {
    assert.equal(view.getUint32(offset, true), 0x04034b50);
    assert.equal(view.getUint16(offset + 8, true), 0);
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(
      bytes.slice(offset + 30, offset + 30 + nameLength),
    );
    assert.equal(name, file.name);
    const start = offset + 30 + nameLength + extraLength;
    const expected =
      typeof file.data === "string"
        ? new TextEncoder().encode(file.data)
        : new Uint8Array(await file.data.arrayBuffer());
    assert.deepEqual(bytes.slice(start, start + size), expected);
    offset = start + size;
  }
  assert.equal(view.getUint32(offset, true), 0x02014b50);
});
