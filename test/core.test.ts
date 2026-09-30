import test from "node:test";
import assert from "node:assert/strict";
import { parseCurl, toCurl, shellTokens } from "../src/lib/curl.ts";
import {
  interpolate,
  prepareRequest,
  sendRequest,
} from "../src/lib/request.ts";
import {
  decodeBase64,
  decodeJwt,
  decodeMessage,
  encodeBase64,
} from "../src/lib/decoders.ts";
import { matchesRule, validateRules } from "../src/lib/rules.ts";
import { newDraft, pair, type Rule } from "../src/lib/types.ts";
import { deflateSync, gzipSync } from "node:zlib";
import { createServer } from "node:http";

test("cURL export/import preserves quotes, Unicode, whitespace and method", () => {
  const draft = {
    ...newDraft(),
    method: "PATCH",
    url: "https://example.com/users?tag=a&tag=b",
    headers: [pair("X-Note", "It's QA")],
    bodyType: "json" as const,
    body: JSON.stringify({ name: "O'Brien", note: "двойной  пробел" }),
  };
  const result = parseCurl(toCurl(draft));
  assert.equal(result.draft.body, draft.body);
  assert.equal(result.draft.url, draft.url);
  assert.equal(result.draft.method, "PATCH");
  assert.equal(result.draft.headers[0].value, "It's QA");
});
test("Chrome copy as cURL handles multiline and double-quoted JSON", () => {
  const { draft, warnings } = parseCurl(
    `curl 'https://example.com' \\\n -H 'sec-ch-ua: chromium' \\\n --data-raw '{"a": "hello  world", "b": "привет"}'`,
  );
  assert.equal(draft.method, "POST");
  assert.equal(draft.body, '{"a": "hello  world", "b": "привет"}');
  assert.equal(warnings.length, 1);
});
test("rejects unsupported flags, shell chains, file bodies and bad quotes", () => {
  for (const text of [
    "curl https://example.com --form file=@a",
    "curl https://example.com; rm a",
    "curl 'oops",
    "curl https://example.com --data @file",
  ])
    assert.throws(() => parseCurl(text));
});
test("lexer preserves quoted whitespace and empty values", () =>
  assert.deepEqual(shellTokens('curl "a  b" \'\' "a\\q"'), [
    "curl",
    "a  b",
    "",
    "a\\q",
  ]));
test("request preparation interpolates and preserves text bodies", () => {
  const d = {
    ...newDraft(),
    method: "POST",
    url: "{{base}}/echo",
    bodyType: "text" as const,
    body: "hello  мир",
    headers: [pair("X-Test", "{{token}}")],
  };
  const env = {
    id: "e",
    name: "test",
    values: [pair("base", "https://example.com"), pair("token", "qa")],
  };
  const r = prepareRequest(d, env);
  assert.equal(r.options.body, "hello  мир");
  assert.equal(new Headers(r.options.headers).get("X-Test"), "qa");
  assert.throws(() => interpolate("{{missing}}", env));
  assert.throws(() => prepareRequest({ ...d, method: "GET" }, env));
  assert.throws(() =>
    prepareRequest({ ...d, headers: [pair("Cookie", "secret")] }, env),
  );
});
test("Base64 and JWT handle Unicode and Base64URL", () => {
  const value = { sub: "тестировщик 🧪" };
  const b64 = (s: string) =>
    encodeBase64(s)
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
  assert.equal(decodeBase64(encodeBase64("QA 🧪")), "QA 🧪");
  const result = decodeJwt(
    b64('{"alg":"none"}') + "." + b64(JSON.stringify(value)) + ".",
  );
  assert.equal(result.payload.sub, value.sub);
});
test("decodes compressed and nested WebSocket payloads", async () => {
  const original = JSON.stringify({ message: "Привет 🧪" });
  for (const bytes of [deflateSync(original), gzipSync(original)]) {
    const result = await decodeMessage(bytes.toString("base64"));
    assert.deepEqual(JSON.parse(result.text), JSON.parse(original));
  }
  assert.equal(
    (await decodeMessage(encodeBase64(encodeBase64(original)))).method,
    "Base64 → Base64",
  );
});
test("rule patterns treat punctuation literally and enforce method", () => {
  const r: Rule = {
    id: "x",
    name: "test",
    enabled: true,
    pattern: "https://example.com/v1/*?q=a.b",
    method: "POST",
    action: "mock",
    status: 500,
    body: "{}",
    delay: 100,
    headers: [],
  };
  assert.ok(matchesRule(r, "https://example.com/v1/users?q=a.b", "POST"));
  assert.ok(!matchesRule(r, "https://example.com/v1/users?q=axb", "POST"));
  assert.ok(!matchesRule(r, "https://example.com/v1/users?q=a.b", "GET"));
  validateRules([r]);
  assert.throws(() => validateRules([{ ...r, delay: 10001 }]));
});
test("real HTTP request preserves body, returns errors, supports abort", async () => {
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    if (req.url === "/slow") {
      setTimeout(() => {
        res.end("late");
      }, 500);
      return;
    }
    res.writeHead(418, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ body, header: req.headers["x-test"] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as { port: number };
    const d = {
      ...newDraft(),
      method: "POST",
      url: `http://127.0.0.1:${address.port}/echo`,
      headers: [pair("X-Test", "yes")],
      bodyType: "text" as const,
      body: "hello  world",
    };
    const response = await sendRequest(
      d,
      undefined,
      new AbortController().signal,
    );
    assert.equal(response.status, 418);
    assert.equal(JSON.parse(response.body).body, "hello  world");
    const controller = new AbortController();
    const pending = sendRequest(
      { ...d, url: `http://127.0.0.1:${address.port}/slow` },
      undefined,
      controller.signal,
    );
    controller.abort();
    await assert.rejects(pending);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
