import test from "node:test";
import assert from "node:assert/strict";
import { ruleFromCapture } from "../src/lib/capture-rule";
import { validateRules } from "../src/lib/rules";
import { setLanguage, t } from "../src/lib/i18n";
import { pair, type CaptureRequest } from "../src/lib/types";
const captured: CaptureRequest = {
  id: "1",
  requestId: "r1",
  url: "https://example.com/api/items?page=1",
  method: "GET",
  type: "XHR",
  start: 0,
  status: 200,
  requestHeaders: { Accept: "application/json", Host: "example.com" },
  responseHeaders: {
    "Content-Type": "application/json",
    "Content-Length": "999",
    "Content-Encoding": "gzip",
    "Set-Cookie": "token=123",
    ETag: "v1",
  },
  responseBody: '{\n  "title": "Сентябрь 🎉"\n}',
};
test("capture creates a disabled editable rule preserving the exact response and URL", () => {
  const rule = ruleFromCapture(captured);
  assert.equal(rule.enabled, false);
  assert.equal(rule.pattern, captured.url);
  assert.equal(rule.body, captured.responseBody);
  assert.deepEqual(
    rule.headers.map((h) => h.key),
    ["Content-Type"],
  );
  assert.equal(rule.request?.url, captured.url);
  assert.deepEqual(
    rule.request?.headers.map((h) => h.key),
    ["Accept"],
  );
  validateRules([rule]);
});
test("partial bodies never silently become a mock response", () => {
  const rule = ruleFromCapture({ ...captured, bodyError: "truncated" });
  assert.equal(rule.body, "");
  assert.ok(rule.sourceWarning);
  assert.equal(rule.enabled, false);
});
test("request overrides validate methods, credentials, body size and header injection", () => {
  const rule = ruleFromCapture(captured);
  rule.action = "request";
  rule.request = {
    url: "https://example.com/echo",
    method: "POST",
    body: "Привет",
    headers: [pair("Content-Type", "text/plain")],
  };
  validateRules([rule]);
  rule.request.method = "GET";
  assert.throws(() => validateRules([rule]), /GET/);
  rule.request.method = "POST";
  rule.request.url = "https://user:secret@example.com";
  assert.throws(() => validateRules([rule]));
  rule.request.url = "https://example.com/echo";
  rule.request.headers = [pair("X-Test", "one\r\nInjected: two")];
  assert.throws(() => validateRules([rule]));
});
test("JSON mocks reject invalid JSON", () => {
  const rule = ruleFromCapture(captured);
  rule.body = "{";
  assert.throws(() => validateRules([rule]), /JSON/);
});
test("English translation preserves substitutions and arbitrary user data", async () => {
  await setLanguage("en");
  assert.equal(t("Копировать ответ"), "Copy response");
  assert.equal(
    t("Переменная {{{0}}} не определена в окружении", ["base_url"]),
    "Variable {{base_url}} is not defined in the environment",
  );
  assert.equal(t("Сентябрь 🎉"), "Сентябрь 🎉");
  await setLanguage("ru");
  assert.equal(t("Копировать ответ"), "Копировать ответ");
});
