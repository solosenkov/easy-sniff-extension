import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import {
  normalizeBaseUrl,
  listModels,
  complete,
  validateProvider,
} from "../src/lib/ai/client";
import {
  redact,
  boundedData,
  allowedRequests,
  contextOverview,
} from "../src/lib/ai/context";
import { executeTool, runAgent } from "../src/lib/ai/agent";
import { initialCapture, newDraft } from "../src/lib/types";
import {
  decodeMessage,
  encodeBase64,
  encodeMessageLike,
} from "../src/lib/decoders";
import type { AiContext, AiProvider } from "../src/lib/ai/types";
const capture = initialCapture();
capture.requests = [
  {
    id: "r1",
    requestId: "1",
    url: "https://test.example/api/items?project=1",
    method: "GET",
    type: "Fetch",
    start: 0,
    status: 200,
    requestHeaders: { Authorization: "Bearer local-only" },
    responseHeaders: {
      "Content-Type": "application/json",
      "Content-Encoding": "gzip",
    },
    responseBody: '{"title":"Сентябрь"}',
  },
];
const context: AiContext = {
  scope: "selected",
  selected: capture.requests[0],
  capture,
  draft: newDraft(),
  tabs: [{ id: 1, title: "Fixture", url: "https://test.example/" }],
};
test("AI finds decoded WebSocket events and prepares an encoded disabled replacement", async () => {
  const original = {
    type: "comment_added",
    context: { after: "old comment", author: "QA" },
    token: "local-only",
  };
  const inner = encodeBase64(JSON.stringify(original));
  const compressed = await new Response(
    new Blob([inner]).stream().pipeThrough(new CompressionStream("deflate")),
  ).arrayBuffer();
  const frame = {
    id: "ws-1",
    requestId: "socket-1",
    url: "wss://test.example/events",
    direction: "in" as const,
    time: 1,
    data: JSON.stringify(
      btoa(String.fromCharCode(...new Uint8Array(compressed))),
    ),
    opcode: 1,
  };
  const traffic: AiContext = {
    ...context,
    scope: "traffic",
    capture: { ...capture, frames: [frame] },
  };
  const found = await executeTool(
    "read_websocket",
    { query: "comment_added" },
    traffic,
  );
  assert.equal((found.data as { totalMatches: number }).totalMatches, 1);
  const read = await executeTool("read_ws_frame", { id: frame.id }, traffic);
  assert.match(
    (read.data as { decodedText: string }).decodedText,
    /old comment/,
  );
  const result = await executeTool(
    "propose_ws_rule",
    {
      sourceFrameId: frame.id,
      name: "Ivy comment",
      mode: "replace",
      jsonPath: "context.after",
      value: "Ivy",
    },
    traffic,
  );
  assert.equal(result.proposal?.kind, "ws-rule");
  if (result.proposal?.kind !== "ws-rule") return;
  assert.equal(result.proposal.rule.enabled, false);
  assert.equal(result.proposal.rule.action, "replace");
  assert.equal(result.proposal.rule.pattern, frame.url);
  assert.equal(result.proposal.rule.contains, frame.data);
  assert.deepEqual(
    JSON.parse((await decodeMessage(result.proposal.rule.replacement)).text),
    {
      ...original,
      context: { ...original.context, after: "Ivy" },
    },
  );
  const injected = await executeTool(
    "propose_ws_rule",
    {
      sourceFrameId: frame.id,
      name: "Ivy copy",
      jsonPath: "context.after",
      value: "Ivy",
    },
    traffic,
  );
  assert.equal(injected.proposal?.kind, "ws-rule");
  if (injected.proposal?.kind === "ws-rule") {
    assert.equal(injected.proposal.rule.action, "inject");
    assert.equal(injected.proposal.rule.contains, "");
  }
  await assert.rejects(
    executeTool(
      "propose_ws_rule",
      {
        sourceFrameId: frame.id,
        name: "Unsafe",
        jsonPath: "__proto__.x",
        value: "x",
      },
      traffic,
    ),
    /Invalid JSON path/,
  );
  await assert.rejects(
    executeTool(
      "propose_ws_rule",
      {
        sourceFrameId: frame.id,
        name: "Wrong scope",
        jsonPath: "context.after",
        value: "x",
      },
      context,
    ),
    /outside/,
  );
  assert.equal(
    (
      await decodeMessage(
        await encodeMessageLike(frame.data, JSON.stringify(original)),
      )
    ).text.includes("old comment"),
    true,
  );
});
test("AI provider accepts a slow-model timeout and rejects unsafe values", () => {
  const provider: AiProvider = {
    id: "slow",
    name: "Local model",
    baseUrl: "http://localhost:11434/v1",
    apiKey: "",
    model: "qa-model",
    models: [],
    timeoutSeconds: 600,
    maxOutputTokens: 8192,
  };
  assert.doesNotThrow(() => validateProvider(provider));
  assert.throws(() => validateProvider({ ...provider, timeoutSeconds: 901 }));
  assert.throws(() => validateProvider({ ...provider, timeoutSeconds: 0 }));
  assert.throws(() =>
    validateProvider({ ...provider, maxOutputTokens: 32769 }),
  );
  assert.throws(() => validateProvider({ ...provider, maxOutputTokens: 0 }));
});
test("AI redacts credentials in nested JSON, headers, query params, pair editors and known provider keys", () => {
  const result = JSON.stringify(
    redact(
      {
        headers: {
          Authorization: "Bearer auth-secret",
          Cookie: "sid=cookie-secret",
        },
        body: JSON.stringify({
          user: { password: "pw-secret", access_token: "token-secret" },
          title: "Сентябрь",
        }),
        url: "https://name:pass@test.example/api?api_key=query-secret&page=1",
        pairs: [{ key: "X-Api-Key", value: "pair-secret" }],
        text: "provider-key-value",
      },
      ["provider-key-value"],
    ),
  );
  for (const secret of [
    "auth-secret",
    "cookie-secret",
    "pw-secret",
    "token-secret",
    "query-secret",
    "pair-secret",
    "provider-key-value",
    "name:pass",
  ])
    assert.ok(!result.includes(secret), secret);
  assert.ok(result.includes("Сентябрь"));
  assert.ok(result.includes("page=1"));
});
test("AI cannot read requests outside selected scope", async () => {
  assert.deepEqual(allowedRequests({ ...context, scope: "none" }), []);
  await assert.rejects(
    executeTool("read_request", { id: "r1" }, { ...context, scope: "none" }),
    /outside/,
  );
  await assert.rejects(
    executeTool(
      "propose_rule",
      { sourceRequestId: "missing", name: "Error", action: "mock" },
      context,
    ),
    /not in/,
  );
  await assert.rejects(
    executeTool("eval", { code: "alert(1)" }, context),
    /Unknown tool/,
  );
});
test("AI searches the entire captured buffer even when the overview omits an older request", async () => {
  const requests = Array.from({ length: 85 }, (_, index) => ({
    ...capture.requests[0],
    id: `request-${index}`,
    requestId: String(index),
    url:
      index === 84
        ? "https://test.example/api/projects?objects[]=project"
        : `https://test.example/api/stream/${index}`,
  }));
  const traffic: AiContext = {
    ...context,
    scope: "traffic",
    capture: { ...capture, requests },
  };
  assert.equal(
    (contextOverview(traffic) as { requests: unknown[] }).requests.length,
    40,
  );
  const result = await executeTool(
    "find_requests",
    { query: "projects" },
    traffic,
  );
  assert.deepEqual(
    (result.data as { matches: { id: string }[] }).matches.map((r) => r.id),
    ["request-84"],
  );
  assert.equal(
    (result.data as { searchedRequests: number }).searchedRequests,
    85,
  );
  const detail = await executeTool(
    "read_request",
    { id: "request-84" },
    traffic,
  );
  assert.equal((detail.data as { url: string }).url, requests[84].url);
});
test("AI overview keeps useful HTTP rows visible during WebSocket reconnects", () => {
  const traffic: AiContext = {
    ...context,
    scope: "traffic",
    capture: {
      ...capture,
      requests: [
        ...Array.from({ length: 55 }, (_, index) => ({
          ...capture.requests[0],
          id: `ws-${index}`,
          type: "WebSocket",
          url: `wss://test.example/sse/${index}`,
        })),
        {
          ...capture.requests[0],
          id: "target",
          url: "https://test.example/api/projects?objects[]=project",
        },
      ],
    },
  };
  const overview = contextOverview(traffic) as {
    requests: { id: string }[];
    websocketConnectionCount: number;
  };
  assert.deepEqual(
    overview.requests.map((row) => row.id),
    ["target"],
  );
  assert.equal(overview.websocketConnectionCount, 55);
});
test("AI rule proposals preserve source URL and are always disabled; no capture mutation", async () => {
  const original = structuredClone(context);
  const { proposal } = await executeTool(
    "propose_rule",
    {
      sourceRequestId: "r1",
      name: "Error",
      action: "mock",
      status: 500,
      body: '{"error":"test"}',
      enabled: true,
    },
    context,
  );
  assert.equal(proposal?.kind, "rule");
  if (proposal?.kind !== "rule") throw new Error();
  assert.equal(proposal.rule.enabled, false);
  assert.equal(proposal.rule.pattern, capture.requests[0].url);
  assert.equal(proposal.rule.status, 500);
  assert.ok(!proposal.rule.headers.some((h) => h.key === "Content-Encoding"));
  assert.deepEqual(context, original);
});
test("AI validates generated rules and JSON", async () => {
  await assert.rejects(
    executeTool(
      "propose_rule",
      { sourceRequestId: "r1", name: "Error", action: "shell" },
      context,
    ),
  );
  await assert.rejects(
    executeTool(
      "propose_rule",
      { sourceRequestId: "r1", name: "Error", action: "mock", status: 999 },
      context,
    ),
  );
  await assert.rejects(
    executeTool(
      "propose_rule",
      { sourceRequestId: "r1", name: "Error", action: "mock", body: "{" },
      context,
    ),
  );
});
test("AI request proposal keeps original authentication locally and uses real source URL", async () => {
  const result = await executeTool(
    "propose_request",
    { sourceRequestId: "r1", name: "Replay" },
    context,
  );
  assert.equal(result.proposal?.kind, "request");
  if (result.proposal?.kind !== "request") throw new Error();
  assert.equal(result.proposal.request.url, capture.requests[0].url);
  assert.ok(
    result.proposal.request.headers.some(
      (h) => h.key === "Authorization" && h.value === "Bearer local-only",
    ),
  );
  assert.ok(!JSON.stringify(result.data).includes("local-only"));
});
test("AI capture proposal requires a real listed tab and state change requires an existing rule", async () => {
  await assert.rejects(
    executeTool("propose_capture", { operation: "start", tabId: 999 }, context),
  );
  await assert.rejects(
    executeTool(
      "propose_rule_state",
      { ruleId: "missing", enabled: true },
      context,
    ),
  );
  const result = await executeTool(
    "propose_capture",
    { operation: "start", tabId: 1 },
    context,
  );
  assert.equal(result.proposal?.kind, "capture");
});
test("AI endpoint validation excludes credentials and normalizes copied completion URLs", () => {
  assert.equal(
    normalizeBaseUrl("https://example.com/v1/chat/completions/"),
    "https://example.com/v1",
  );
  for (const url of [
    "file:///tmp/a",
    "https://user:pass@example.com/v1",
    "https://example.com/v1?api_key=secret",
  ])
    assert.throws(() => normalizeBaseUrl(url));
});
test("AI tool results carry explicit truncation metadata", () => {
  const result = JSON.parse(boundedData({ body: "x".repeat(100) }, [], 30));
  assert.equal(result.truncated, true);
});
test("AI protocol handles models, tool rounds, credentials, errors, redirects and cancellation", async () => {
  const requests: any[] = [];
  let mode = "tools",
    round = 0;
  const server = createServer(async (req, res) => {
    if (mode === "redirect") {
      res.writeHead(302, { Location: "https://example.com/" });
      res.end();
      return;
    }
    if (mode === "401") {
      res.writeHead(401);
      res.end("secret-service-data");
      return;
    }
    if (mode === "402") {
      res.writeHead(402, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            message: "Insufficient credits for provider-secret account",
          },
        }),
      );
      return;
    }
    if (mode === "truncated" || mode === "reasoning-only") {
      res.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: mode === "truncated" ? "length" : "stop",
              message: {
                role: "assistant",
                content: null,
                reasoning_content: "thinking",
              },
            },
          ],
        }),
      );
      return;
    }
    if (mode === "slow") return;
    if (req.url === "/v1/models") {
      res.end(JSON.stringify({ data: [{ id: "test" }, { id: "test" }] }));
      return;
    }
    let body = "";
    for await (const c of req) body += c;
    requests.push({ headers: req.headers, body: JSON.parse(body) });
    if (mode === "invalid") {
      res.end("not-json");
      return;
    }
    if (mode === "large") {
      res.end("x".repeat(2_100_000));
      return;
    }
    const message =
      round++ === 0
        ? {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "tool1",
                type: "function",
                function: { name: "read_request", arguments: '{"id":"r1"}' },
              },
            ],
          }
        : { role: "assistant", content: "Reviewed the request." };
    res.end(JSON.stringify({ choices: [{ message, finish_reason: "stop" }] }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error();
  const p: AiProvider = {
    id: "p",
    name: "Fixture",
    apiKey: "provider-secret",
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    model: "test",
    models: [],
  };
  try {
    assert.deepEqual(await listModels(p), ["test"]);
    const steps: string[] = [];
    await runAgent({
      provider: p,
      prompt: "Read the request",
      history: [],
      context,
      keys: [p.apiKey],
      signal: AbortSignal.timeout(5000),
      onStep: (s) => steps.push(s),
      onText: () => {},
      onProposal: () => assert.fail("Should only read"),
    });
    assert.equal(steps.length, 1);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].headers.authorization, "Bearer provider-secret");
    assert.equal(requests[0].body.max_tokens, 8192);
    assert.ok(
      !JSON.stringify(requests.map((r) => r.body)).includes("local-only"),
    );
    assert.ok(
      !JSON.stringify(requests.map((r) => r.body)).includes("provider-secret"),
    );
    mode = "401";
    await assert.rejects(
      listModels(p),
      (e) =>
        e instanceof Error &&
        e.message.includes("401") &&
        !e.message.includes("secret-service-data"),
    );
    mode = "402";
    await assert.rejects(
      complete(p, [], []),
      (e) =>
        e instanceof Error &&
        e.message.includes("402") &&
        e.message.includes("Insufficient credits") &&
        !e.message.includes("provider-secret"),
    );
    mode = "truncated";
    await assert.rejects(complete(p, [], []), /output token limit/);
    mode = "reasoning-only";
    await assert.rejects(complete(p, [], []), /reasoning only/);
    mode = "redirect";
    await assert.rejects(listModels(p));
    mode = "invalid";
    await assert.rejects(complete(p, [], []), /JSON/);
    mode = "large";
    await assert.rejects(complete(p, [], []));
    mode = "slow";
    const abort = new AbortController();
    const pending = listModels(p, abort.signal);
    abort.abort();
    await assert.rejects(
      pending,
      (e) => e instanceof Error && e.name === "AbortError",
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("AI cURL import prepares a request without executing shell code", async () => {
  const result = await executeTool(
    "import_curl",
    {
      command:
        "curl 'https://example.com/echo' -H 'Content-Type: application/json' --data-raw '{\"title\":\"Сентябрь\"}'",
    },
    context,
  );
  assert.equal(result.proposal?.kind, "request");
  if (result.proposal?.kind === "request") {
    assert.equal(result.proposal.request.method, "POST");
    assert.equal(result.proposal.request.body, '{"title":"Сентябрь"}');
  }
  await assert.rejects(
    executeTool(
      "import_curl",
      { command: "curl https://example.com; echo danger" },
      context,
    ),
  );
});
test("AI export snapshots only the chosen capture scope", async () => {
  const result = await executeTool(
    "propose_export",
    { format: "traffic" },
    context,
  );
  assert.equal(result.proposal?.kind, "export");
  if (result.proposal?.kind === "export")
    assert.equal(JSON.parse(result.proposal.data).length, 1);
  const empty = await executeTool(
    "propose_export",
    { format: "traffic" },
    { ...context, scope: "none" },
  );
  if (empty.proposal?.kind === "export")
    assert.deepEqual(JSON.parse(empty.proposal.data), []);
});
test("compressed AI messages have a bounded decompression size", async () => {
  const { gzipSync } = await import("node:zlib");
  await assert.rejects(
    executeTool(
      "decode",
      {
        format: "ws",
        value: gzipSync(Buffer.from("x".repeat(2_100_000))).toString("base64"),
      },
      context,
    ),
    RangeError,
  );
});
test("AI refreshes a growing capture before searching during a slow turn", async () => {
  let round = 0;
  let toolReply = "";
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    if (round++ === 0) {
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "search",
                    type: "function",
                    function: {
                      name: "find_requests",
                      arguments: '{"query":"projects"}',
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        }),
      );
    } else {
      toolReply =
        body.messages.find((m: { role: string }) => m.role === "tool")
          ?.content || "";
      res.end(
        JSON.stringify({
          choices: [
            {
              message: { role: "assistant", content: "Found it." },
              finish_reason: "stop",
            },
          ],
        }),
      );
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error();
  const first = {
    ...capture,
    tabId: 7,
    sessionId: "same-session",
    requests: [
      {
        ...capture.requests[0],
        id: "sse",
        url: "wss://test.example/sse",
        type: "WebSocket",
      },
    ],
  };
  const later = {
    ...first,
    requests: [
      {
        ...capture.requests[0],
        id: "target",
        url: "https://test.example/api/projects?objects[]=project",
      },
      ...first.requests,
    ],
  };
  try {
    await runAgent({
      provider: {
        id: "fixture",
        name: "Fixture",
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        apiKey: "",
        model: "test",
        models: [],
      },
      prompt: "Find projects",
      history: [],
      context: {
        ...context,
        scope: "traffic",
        capture: structuredClone(first),
      },
      keys: [],
      signal: AbortSignal.timeout(5000),
      refreshCapture: async () => later,
      onStep: () => {},
      onProposal: () => assert.fail("Read-only search"),
      onText: () => {},
    });
    assert.match(toolReply, /projects/);
    assert.match(toolReply, /"totalMatches":1/);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
