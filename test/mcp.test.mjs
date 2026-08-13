import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectProviderFile, delegate, handle, redact, resolveShortcuts } from "../plugins/ahub/server/ahub-mcp.mjs";

test("MCP server advertises host-context delegation tools", async () => {
  const initialized = await handle({ method: "initialize", params: { protocolVersion: "2025-06-18" } });
  const listed = await handle({ method: "tools/list" });
  assert.equal(initialized.serverInfo.name, "ahub");
  assert.deepEqual(listed.tools.map((tool) => tool.name), ["delegate", "status", "connect", "recall", "forget"]);
  assert.match(listed.tools[0].description, /host.*context/iu);
});

test("shortcut dimensions compose without coupling model, context, and role", () => {
  const route = resolveShortcuts(["/ds", "/fresh", "/review"], {
    "/ds": { model: "ds4f" },
    "/fresh": { contextMode: "fresh" },
    "/review": { role: "reviewer" },
  });
  assert.deepEqual(route, { model: "ds4f", contextMode: "fresh", role: "reviewer" });
});

test("outbound context redacts common secrets", () => {
  const value = redact("API_KEY=secret-value token: abcdefghijklmnopqrstuvwxyz sk-a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6");
  assert.doesNotMatch(value, /secret-value|abcdefghijklmnopqrstuvwxyz|sk-a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6/u);
  assert.match(value, /REDACTED/u);
});

test("delegate sends host-selected context and returns DeepSeek output", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "ahub-mcp-workspace-"));
  const credentialHome = await mkdtemp(join(tmpdir(), "ahub-mcp-home-"));
  await mkdir(join(workspace, ".ahub"), { recursive: true });
  await mkdir(join(credentialHome, ".ahub"), { recursive: true });
  await writeFile(join(workspace, ".ahub", "config.json"), JSON.stringify({ models: { ds4f: { model: "deepseek-v4-flash" } } }));
  await writeFile(join(credentialHome, ".ahub", "credentials.json"), JSON.stringify({ deepseek: { apiKey: "private-key", verifiedAt: "now" } }));
  let sent;
  try {
    const result = await delegate({ task: "continue the design", context: "The host discussed option A.", workspace }, {
      credentialHome,
      fetch: async (_url, request) => {
        sent = { headers: request.headers, body: JSON.parse(request.body) };
        return { ok: true, json: async () => ({ choices: [{ message: { content: "Choose option A." } }] }) };
      },
    });
    assert.equal(result.output, "Choose option A.");
    assert.equal(result.contextMode, "related");
    assert.match(sent.body.messages[1].content, /host discussed option A/u);
    assert.equal(sent.headers.Authorization, "Bearer private-key");
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(credentialHome, { recursive: true, force: true });
  }
});

test("full host context requires explicit confirmation", async () => {
  await assert.rejects(() => delegate({ task: "analyze", contextMode: "full" }), /confirmation/u);
});

test("external shortcut resolves to the configured model-library default", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "ahub-mcp-default-"));
  const credentialHome = await mkdtemp(join(tmpdir(), "ahub-mcp-default-home-"));
  await mkdir(join(workspace, ".ahub"), { recursive: true });
  await mkdir(join(credentialHome, ".ahub"), { recursive: true });
  await writeFile(join(workspace, ".ahub", "config.json"), JSON.stringify({
    defaults: { externalModel: "reasoner" },
    models: { reasoner: { name: "DeepSeek Reasoner", provider: "deepseek", model: "deepseek-reasoner" } },
  }));
  await writeFile(join(credentialHome, ".ahub", "credentials.json"), JSON.stringify({ deepseek: { apiKey: "private-key" } }));
  let selectedModel;
  try {
    const result = await delegate({ task: "think", shortcuts: ["/ds"], workspace }, {
      credentialHome,
      fetch: async (_url, request) => {
        selectedModel = JSON.parse(request.body).model;
        return { ok: true, json: async () => ({ choices: [{ message: { content: "done" } }] }) };
      },
    });
    assert.equal(selectedModel, "deepseek-reasoner");
    assert.equal(result.modelAlias, "reasoner");
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(credentialHome, { recursive: true, force: true });
  }
});

test("delegate routes to any registered OpenAI-compatible provider", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "ahub-mcp-multi-"));
  const credentialHome = await mkdtemp(join(tmpdir(), "ahub-mcp-multi-home-"));
  await mkdir(join(workspace, ".ahub"), { recursive: true });
  await mkdir(join(credentialHome, ".ahub"), { recursive: true });
  await writeFile(join(workspace, ".ahub", "config.json"), JSON.stringify({
    providers: { acme: { label: "Acme", baseUrl: "https://api.acme.example.com", kind: "openai" } },
    models: { fast: { name: "Acme Fast", provider: "acme", model: "acme-fast" } },
    defaults: { activeModel: "fast" },
  }));
  await writeFile(join(credentialHome, ".ahub", "credentials.json"), JSON.stringify({ acme: { apiKey: "acme-key", verifiedAt: "now" } }));
  let sent;
  try {
    const result = await delegate({ task: "summarize", workspace }, {
      credentialHome,
      fetch: async (url, request) => {
        sent = { url, headers: request.headers, body: JSON.parse(request.body) };
        return { ok: true, json: async () => ({ choices: [{ message: { content: "acme says hi" } }] }) };
      },
    });
    assert.equal(result.output, "acme says hi");
    assert.equal(result.provider, "acme");
    assert.equal(sent.url, "https://api.acme.example.com/chat/completions");
    assert.equal(sent.headers.Authorization, "Bearer acme-key");
    assert.equal(sent.body.model, "acme-fast");
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(credentialHome, { recursive: true, force: true });
  }
});

test("delegate rejects a model whose provider is not configured", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "ahub-mcp-unconfigured-"));
  await mkdir(join(workspace, ".ahub"), { recursive: true });
  await writeFile(join(workspace, ".ahub", "config.json"), JSON.stringify({
    models: { stray: { provider: "ghost", model: "ghost-1" } },
    defaults: { activeModel: "stray" },
  }));
  try {
    await assert.rejects(() => delegate({ task: "x", workspace }), /provider "ghost".*not configured/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("status reports readiness for every configured provider", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "ahub-mcp-status-"));
  await mkdir(join(workspace, ".ahub"), { recursive: true });
  await writeFile(join(workspace, ".ahub", "config.json"), JSON.stringify({
    providers: {
      deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com", kind: "openai" },
      acme: { label: "Acme", baseUrl: "https://api.acme.example.com", kind: "openai" },
    },
    models: {
      ds4f: { provider: "deepseek", model: "deepseek-v4-flash" },
      fast: { provider: "acme", model: "acme-fast" },
    },
    defaults: { activeModel: "fast" },
  }));
  // project-scoped credential for acme only (no global homedir access in tests)
  await writeFile(join(workspace, ".ahub", "secrets.json"), JSON.stringify({ acme: { apiKey: "acme-key" } }));
  try {
    const response = await handle({ method: "tools/call", params: { name: "status", arguments: { workspace } } });
    // every provider referenced by a model is enumerated; acme readiness comes from the
    // project-scoped secret written above (deterministic regardless of the host's global store).
    assert.deepEqual(Object.keys(response.structuredContent.providers).sort(), ["acme", "deepseek"]);
    assert.equal(response.structuredContent.providers.acme.ready, true);
    assert.equal(response.structuredContent.activeModel, "fast");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("redact covers realistic credential shapes", () => {
  const jwt = `eyJ${"a".repeat(20)}.${"b".repeat(20)}.${"c".repeat(20)}`;
  const samples = {
    jwt,
    aws: "AKIAIOSFODNN7EXAMPLE",
    googleKey: `AIza${"a".repeat(35)}`,
    googleOAuth: `ya29.${"a".repeat(20)}`,
    slack: `xoxb-${"a".repeat(20)}`,
    github: `ghp_${"a".repeat(36)}`,
    bearer: `Bearer ${"a".repeat(20)}`,
    apiKeyAssign: "api_key=sk-live-abcd1234efgh5678ijkl",
  };
  const cleaned = redact(Object.values(samples).join(" || "));
  for (const raw of Object.values(samples)) {
    const secretTail = raw.replace(/^(Bearer\s+|api_key=)/u, "");
    assert.doesNotMatch(cleaned, new RegExp(secretTail.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"), `still present: ${raw}`);
  }
  assert.match(cleaned, /REDACTED/u);
});

test("delegate returns token usage and estimated cost", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "ahub-mcp-cost-"));
  const credentialHome = await mkdtemp(join(tmpdir(), "ahub-mcp-cost-home-"));
  await mkdir(join(workspace, ".ahub"), { recursive: true });
  await mkdir(join(credentialHome, ".ahub"), { recursive: true });
  await writeFile(join(workspace, ".ahub", "config.json"), JSON.stringify({
    models: { ds4f: { provider: "deepseek", model: "deepseek-v4-flash", cost: { input: 0.1, output: 0.2 } } },
  }));
  await writeFile(join(credentialHome, ".ahub", "credentials.json"), JSON.stringify({ deepseek: { apiKey: "k" } }));
  try {
    const result = await delegate({ task: "hi", workspace }, {
      credentialHome,
      fetch: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "hi" } }], usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 } }) }),
    });
    assert.deepEqual(result.tokens, { prompt: 1000, completion: 500, total: 1500 });
    // (1000/1M)*0.1 + (500/1M)*0.2 = 0.0002
    assert.equal(result.estimatedCostUsd, 0.0002);
    assert.ok(result.elapsedMs >= 0);
    assert.equal(result.attempts, 1);
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(credentialHome, { recursive: true, force: true });
  }
});

test("delegate retries once on a transient HTTP 429 then succeeds", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "ahub-mcp-retry-"));
  const credentialHome = await mkdtemp(join(tmpdir(), "ahub-mcp-retry-home-"));
  await mkdir(join(workspace, ".ahub"), { recursive: true });
  await mkdir(join(credentialHome, ".ahub"), { recursive: true });
  await writeFile(join(workspace, ".ahub", "config.json"), JSON.stringify({ models: { ds4f: { provider: "deepseek", model: "x" } } }));
  await writeFile(join(credentialHome, ".ahub", "credentials.json"), JSON.stringify({ deepseek: { apiKey: "k" } }));
  let calls = 0;
  try {
    const result = await delegate({ task: "hi", workspace }, {
      credentialHome,
      fetch: async () => {
        calls += 1;
        if (calls === 1) return { ok: false, status: 429, json: async () => ({ error: { message: "rate limit" } }) };
        return { ok: true, json: async () => ({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) };
      },
    });
    assert.equal(result.output, "ok");
    assert.equal(result.attempts, 2);
    assert.equal(calls, 2);
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(credentialHome, { recursive: true, force: true });
  }
});

test("delegate surfaces a timeout clearly", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "ahub-mcp-timeout-"));
  const credentialHome = await mkdtemp(join(tmpdir(), "ahub-mcp-timeout-home-"));
  await mkdir(join(workspace, ".ahub"), { recursive: true });
  await mkdir(join(credentialHome, ".ahub"), { recursive: true });
  await writeFile(join(workspace, ".ahub", "config.json"), JSON.stringify({ models: { ds4f: { provider: "deepseek", model: "x" } } }));
  await writeFile(join(credentialHome, ".ahub", "credentials.json"), JSON.stringify({ deepseek: { apiKey: "k" } }));
  try {
    await assert.rejects(
      () => delegate({ task: "hi", workspace }, {
        credentialHome,
        timeoutMs: 30,
        fetch: (_url, request) => new Promise((_resolve, reject) => {
          request.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        }),
      }),
      /did not respond in time|timed out/iu,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(credentialHome, { recursive: true, force: true });
  }
});

test("delegate truncates long context and signals it to the model", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "ahub-mcp-trunc-"));
  const credentialHome = await mkdtemp(join(tmpdir(), "ahub-mcp-trunc-home-"));
  await mkdir(join(workspace, ".ahub"), { recursive: true });
  await mkdir(join(credentialHome, ".ahub"), { recursive: true });
  await writeFile(join(workspace, ".ahub", "config.json"), JSON.stringify({ models: { ds4f: { provider: "deepseek", model: "x" } } }));
  await writeFile(join(credentialHome, ".ahub", "credentials.json"), JSON.stringify({ deepseek: { apiKey: "k" } }));
  let sent;
  try {
    const result = await delegate({ task: "x", context: "z".repeat(70_000), workspace }, {
      credentialHome,
      fetch: async (_url, request) => { sent = JSON.parse(request.body); return { ok: true, json: async () => ({ choices: [{ message: { content: "done" } }] }) }; },
    });
    assert.equal(result.contextTruncated, true);
    assert.equal(result.contextCharacters, 60_000);
    assert.match(sent.messages[1].content, /truncated to 60000 characters/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(credentialHome, { recursive: true, force: true });
  }
});

// Build a fake OpenAI-style streaming response whose body is an async iterable of SSE chunks.
function sseResponse(deltas, usage) {
  const events = deltas.map((d) => `data: ${JSON.stringify({ choices: [{ delta: { content: d } }] })}\n\n`);
  if (usage) events.push(`data: ${JSON.stringify({ choices: [], usage })}\n\n`);
  events.push("data: [DONE]\n\n");
  const data = events.join("");
  const body = {
    async *[Symbol.asyncIterator]() {
      for (const part of data.match(/[\s\S]{1,48}/gu) ?? []) yield Buffer.from(part);
    },
  };
  return { ok: true, body, headers: { get: (name) => (name === "content-type" ? "text/event-stream" : null) } };
}

test("delegate streams content deltas via onProgress and parses streamed usage", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "ahub-mcp-stream-"));
  const credentialHome = await mkdtemp(join(tmpdir(), "ahub-mcp-stream-home-"));
  await mkdir(join(workspace, ".ahub"), { recursive: true });
  await mkdir(join(credentialHome, ".ahub"), { recursive: true });
  await writeFile(join(workspace, ".ahub", "config.json"), JSON.stringify({ models: { ds4f: { provider: "deepseek", model: "x", cost: 0.2 } } }));
  await writeFile(join(credentialHome, ".ahub", "credentials.json"), JSON.stringify({ deepseek: { apiKey: "k" } }));
  const deltas = [];
  try {
    const result = await delegate({ task: "hi", workspace }, {
      credentialHome,
      onProgress: (delta) => deltas.push(delta),
      fetch: async () => sseResponse(["Hello", ", ", "world"], { prompt_tokens: 5, completion_tokens: 3 }),
    });
    assert.equal(result.output, "Hello, world");
    assert.deepEqual(deltas, ["Hello", ", ", "world"]);
    assert.equal(result.tokens.completion, 3);
    assert.equal(result.attempts, 1);
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(credentialHome, { recursive: true, force: true });
  }
});

test("connect tool reads a key file, validates, and stores it without echoing the key", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "ahub-mcp-connect-"));
  const credentialHome = await mkdtemp(join(tmpdir(), "ahub-mcp-connect-home-"));
  await mkdir(join(workspace, ".ahub"), { recursive: true });
  await writeFile(join(workspace, ".ahub", "config.json"), JSON.stringify({
    providers: { acme: { label: "Acme", baseUrl: "https://api.acme.example.com", kind: "openai" } },
    models: { fast: { provider: "acme", model: "acme-fast" } },
  }));
  const keyFile = join(workspace, "acme.key");
  await writeFile(keyFile, "acme-secret-key\n");
  let validateUrl;
  try {
    const result = await connectProviderFile({ provider: "acme", keyFile, workspace }, {
      credentialHome,
      fetch: async (url) => { validateUrl = url; return { ok: true, status: 200 }; },
    });
    assert.equal(result.ok, true);
    assert.equal(result.provider, "acme");
    assert.match(validateUrl, /api\.acme\.example\.com\/models/u);
    const stored = JSON.parse(await readFile(join(credentialHome, ".ahub", "credentials.json"), "utf8"));
    assert.equal(stored.acme.apiKey, "acme-secret-key");
    // the tool result must never contain the key
    assert.doesNotMatch(JSON.stringify(result), /acme-secret-key/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(credentialHome, { recursive: true, force: true });
  }
});

test("connect tool rejects an invalid key without storing it", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "ahub-mcp-connect-bad-"));
  const credentialHome = await mkdtemp(join(tmpdir(), "ahub-mcp-connect-bad-home-"));
  await mkdir(join(workspace, ".ahub"), { recursive: true });
  await writeFile(join(workspace, ".ahub", "config.json"), JSON.stringify({
    providers: { acme: { label: "Acme", baseUrl: "https://api.acme.example.com", kind: "openai" } },
  }));
  const keyFile = join(workspace, "acme.key");
  await writeFile(keyFile, "bad-key");
  try {
    await assert.rejects(
      () => connectProviderFile({ provider: "acme", keyFile, workspace }, {
        credentialHome,
        fetch: async () => ({ ok: false, status: 401 }),
      }),
      /rejected the key/u,
    );
    // nothing written
    await assert.rejects(() => readFile(join(credentialHome, ".ahub", "credentials.json"), "utf8"), /ENOENT/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(credentialHome, { recursive: true, force: true });
  }
});

test("redact covers JSON-formatted secrets and word-bounded key names", () => {
  const json = JSON.stringify({ api_key: "sk-secret-abcdefghijklmnop", token: "tok_1234567890abcdef", password: "p4ssw0rdValue!" });
  const cleaned = redact(`config=${json}`);
  assert.doesNotMatch(cleaned, /sk-secret-abcdefghijklmnop|tok_1234567890abcdef|p4ssw0rdValue!/u);
  assert.match(cleaned, /REDACTED/u);
  // the bare alternation must not corrupt benign words like "passwords" mid-key... but the value
  // after "password" is still scrubbed. Confirm the keyword boundary itself behaves:
  const benign = "mytokenholder secrets manager";
  const b = redact(benign);
  assert.equal(b, benign); // no false-positive redaction of "token"/"secret" inside larger words
});

test("redact leaves legitimate API/ds/sk prose untouched", () => {
  const prose = "the api-endpoint-implementation needs caching; ds-datastore-lookups are fast";
  assert.equal(redact(prose), prose);
  assert.equal(redact("sk-module-registration-factory"), "sk-module-registration-factory");
});

test("delegate preserves multibyte text split across SSE chunk boundaries", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "ahub-mcp-utf8-"));
  const credentialHome = await mkdtemp(join(tmpdir(), "ahub-mcp-utf8-home-"));
  await mkdir(join(workspace, ".ahub"), { recursive: true });
  await mkdir(join(credentialHome, ".ahub"), { recursive: true });
  await writeFile(join(workspace, ".ahub", "config.json"), JSON.stringify({ models: { ds4f: { provider: "deepseek", model: "x" } } }));
  await writeFile(join(credentialHome, ".ahub", "credentials.json"), JSON.stringify({ deepseek: { apiKey: "k" } }));
  // One event whose content is a single 3-byte CJK char, split between chunks inside the char.
  const full = Buffer.from(`data: ${JSON.stringify({ choices: [{ delta: { content: "中" } }] })}\n\ndata: [DONE]\n\n`, "utf8");
  const splitAt = full.indexOf(0xe4); // first byte of 中
  const body = { async *[Symbol.asyncIterator]() { yield full.slice(0, splitAt + 1); yield full.slice(splitAt + 1); } };
  try {
    const result = await delegate({ task: "x", workspace }, {
      credentialHome,
      fetch: async () => ({ ok: true, body, headers: { get: () => "text/event-stream" } }),
    });
    assert.equal(result.output, "中");
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(credentialHome, { recursive: true, force: true });
  }
});

test("delegate does not split a surrogate pair when truncating context", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "ahub-mcp-surrogate-"));
  const credentialHome = await mkdtemp(join(tmpdir(), "ahub-mcp-surrogate-home-"));
  await mkdir(join(workspace, ".ahub"), { recursive: true });
  await mkdir(join(credentialHome, ".ahub"), { recursive: true });
  await writeFile(join(workspace, ".ahub", "config.json"), JSON.stringify({ models: { ds4f: { provider: "deepseek", model: "x" } } }));
  await writeFile(join(credentialHome, ".ahub", "credentials.json"), JSON.stringify({ deepseek: { apiKey: "k" } }));
  // 59999 'a' + a surrogate-pair emoji (2 UTF-16 units) + 100 'b' => length 60101 > 60000,
  // and the 60000 cut would land on the high surrogate.
  const context = "a".repeat(59999) + "\uD83D\uDE00" + "b".repeat(100);
  try {
    const result = await delegate({ task: "x", context, workspace }, {
      credentialHome,
      fetch: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "ok" } }] }) }),
    });
    assert.equal(result.contextTruncated, true);
    assert.equal(result.contextCharacters, 59999); // backed off one code unit to avoid a lone surrogate
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(credentialHome, { recursive: true, force: true });
  }
});

test("settings rejects a non-object config instead of silently defaulting", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "ahub-mcp-badconfig-"));
  await mkdir(join(workspace, ".ahub"), { recursive: true });
  await writeFile(join(workspace, ".ahub", "config.json"), "null");
  try {
    await assert.rejects(() => delegate({ task: "x", workspace }), /not a JSON object/iu);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("connect refuses sensitive key-file paths and symlinks", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "ahub-mcp-connect-safe-"));
  const credentialHome = await mkdtemp(join(tmpdir(), "ahub-mcp-connect-safe-home-"));
  await mkdir(join(workspace, ".ahub"), { recursive: true });
  await writeFile(join(workspace, ".ahub", "config.json"), JSON.stringify({
    providers: { acme: { label: "Acme", baseUrl: "https://api.acme.example.com", kind: "openai" } },
  }));
  try {
    await assert.rejects(
      () => connectProviderFile({ provider: "acme", keyFile: "/home/user/.ssh/id_rsa", workspace }, { credentialHome, fetch: async () => ({ ok: true }) }),
      /sensitive path/u,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(credentialHome, { recursive: true, force: true });
  }
});

async function jsonDelegateReply(content) {
  return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
}

test("a delegation thread resumes the model's own prior turns", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "ahub-mcp-thread-"));
  const credentialHome = await mkdtemp(join(tmpdir(), "ahub-mcp-thread-home-"));
  await mkdir(join(workspace, ".ahub"), { recursive: true });
  await mkdir(join(credentialHome, ".ahub"), { recursive: true });
  await writeFile(join(workspace, ".ahub", "config.json"), JSON.stringify({ models: { ds4f: { provider: "deepseek", model: "x" } } }));
  await writeFile(join(credentialHome, ".ahub", "credentials.json"), JSON.stringify({ deepseek: { apiKey: "k" } }));
  let sent;
  try {
    const first = await delegate({ task: "define X", workspace, threadId: "t1" }, { credentialHome, fetch: async (_u, req) => { sent = JSON.parse(req.body); return jsonDelegateReply("X is A"); } });
    assert.equal(first.threadId, "t1");
    assert.equal(first.threadContinued, false);
    // first turn has no prior messages
    assert.deepEqual(sent.messages.map((m) => m.role), ["system", "user"]);

    const second = await delegate({ task: "now define Y", workspace, threadId: "t1" }, { credentialHome, fetch: async (_u, req) => { sent = JSON.parse(req.body); return jsonDelegateReply("Y is B"); } });
    assert.equal(second.threadContinued, true);
    // system, prior task, prior answer, new task
    assert.deepEqual(sent.messages.map((m) => m.role), ["system", "user", "assistant", "user"]);
    assert.match(sent.messages[1].content, /define X/u);
    assert.equal(sent.messages[2].content, "X is A");
    assert.match(sent.messages[3].content, /now define Y/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(credentialHome, { recursive: true, force: true });
  }
});

test("continue:true resumes the most recent thread", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "ahub-mcp-continue-"));
  const credentialHome = await mkdtemp(join(tmpdir(), "ahub-mcp-continue-home-"));
  await mkdir(join(workspace, ".ahub"), { recursive: true });
  await mkdir(join(credentialHome, ".ahub"), { recursive: true });
  await writeFile(join(workspace, ".ahub", "config.json"), JSON.stringify({ models: { ds4f: { provider: "deepseek", model: "x" } } }));
  await writeFile(join(credentialHome, ".ahub", "credentials.json"), JSON.stringify({ deepseek: { apiKey: "k" } }));
  let sent;
  try {
    const first = await delegate({ task: "first task", workspace }, { credentialHome, fetch: () => jsonDelegateReply("ans1") });
    const second = await delegate({ task: "second task", workspace, continue: true }, { credentialHome, fetch: async (_u, req) => { sent = JSON.parse(req.body); return jsonDelegateReply("ans2"); } });
    assert.equal(second.threadId, first.threadId);
    assert.equal(second.threadContinued, true);
    assert.ok(sent.messages.some((m) => m.role === "assistant" && m.content === "ans1"));
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(credentialHome, { recursive: true, force: true });
  }
});

test("recall returns recorded delegations", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "ahub-mcp-recall-"));
  const credentialHome = await mkdtemp(join(tmpdir(), "ahub-mcp-recall-home-"));
  await mkdir(join(workspace, ".ahub"), { recursive: true });
  await mkdir(join(credentialHome, ".ahub"), { recursive: true });
  await writeFile(join(workspace, ".ahub", "config.json"), JSON.stringify({ models: { ds4f: { provider: "deepseek", model: "x" } } }));
  await writeFile(join(credentialHome, ".ahub", "credentials.json"), JSON.stringify({ deepseek: { apiKey: "k" } }));
  try {
    await delegate({ task: "first task", workspace, threadId: "shared" }, { credentialHome, fetch: () => jsonDelegateReply("ans1") });
    await delegate({ task: "second task", workspace, threadId: "shared" }, { credentialHome, fetch: () => jsonDelegateReply("ans2") });
    await delegate({ task: "unrelated", workspace, threadId: "other" }, { credentialHome, fetch: () => jsonDelegateReply("ans3") });
    const response = await handle({ method: "tools/call", params: { name: "recall", arguments: { workspace } } });
    assert.equal(response.structuredContent.count, 3);
    assert.match(response.content[0].text, /first task[\s\S]*second task[\s\S]*unrelated/u);
    // recall filtered to one thread returns only that thread's entries
    const one = await handle({ method: "tools/call", params: { name: "recall", arguments: { workspace, threadId: "shared" } } });
    assert.equal(one.structuredContent.count, 2);
    assert.ok(one.structuredContent.delegations.every((entry) => entry.threadId === "shared"));
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(credentialHome, { recursive: true, force: true });
  }
});

test("delegationLog:false disables persistence and thread replay", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "ahub-mcp-nolog-"));
  const credentialHome = await mkdtemp(join(tmpdir(), "ahub-mcp-nolog-home-"));
  await mkdir(join(workspace, ".ahub"), { recursive: true });
  await mkdir(join(credentialHome, ".ahub"), { recursive: true });
  await writeFile(join(workspace, ".ahub", "config.json"), JSON.stringify({ delegationLog: false, models: { ds4f: { provider: "deepseek", model: "x" } } }));
  await writeFile(join(credentialHome, ".ahub", "credentials.json"), JSON.stringify({ deepseek: { apiKey: "k" } }));
  try {
    await delegate({ task: "t1", workspace, threadId: "tx" }, { credentialHome, fetch: () => jsonDelegateReply("a1") });
    const second = await delegate({ task: "t2", workspace, threadId: "tx" }, { credentialHome, fetch: () => jsonDelegateReply("a2") });
    assert.equal(second.threadContinued, false); // no replay when logging is off
    await assert.rejects(() => readFile(join(workspace, ".ahub", "delegations.jsonl"), "utf8"), /ENOENT/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(credentialHome, { recursive: true, force: true });
  }
});

test("thread replay caps huge prior turns instead of resending them whole", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "ahub-mcp-replaycap-"));
  const credentialHome = await mkdtemp(join(tmpdir(), "ahub-mcp-replaycap-home-"));
  await mkdir(join(workspace, ".ahub"), { recursive: true });
  await mkdir(join(credentialHome, ".ahub"), { recursive: true });
  await writeFile(join(workspace, ".ahub", "config.json"), JSON.stringify({ models: { ds4f: { provider: "deepseek", model: "x" } } }));
  await writeFile(join(credentialHome, ".ahub", "credentials.json"), JSON.stringify({ deepseek: { apiKey: "k" } }));
  let sent;
  try {
    const huge = "z".repeat(20_000);
    await delegate({ task: "big question", workspace, threadId: "big" }, { credentialHome, fetch: () => jsonDelegateReply(huge) });
    await delegate({ task: "follow up", workspace, threadId: "big" }, { credentialHome, fetch: async (_u, req) => { sent = JSON.parse(req.body); return jsonDelegateReply("ok"); } });
    const assistant = sent.messages.find((m) => m.role === "assistant");
    assert.ok(assistant.content.length < 20_000, "replayed turn was not capped");
    assert.match(assistant.content, /characters elided/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(credentialHome, { recursive: true, force: true });
  }
});

test("recall aggregates token and cost totals", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "ahub-mcp-totals-"));
  const credentialHome = await mkdtemp(join(tmpdir(), "ahub-mcp-totals-home-"));
  await mkdir(join(workspace, ".ahub"), { recursive: true });
  await mkdir(join(credentialHome, ".ahub"), { recursive: true });
  await writeFile(join(workspace, ".ahub", "config.json"), JSON.stringify({ models: { ds4f: { provider: "deepseek", model: "x", cost: 0.1 } } }));
  await writeFile(join(credentialHome, ".ahub", "credentials.json"), JSON.stringify({ deepseek: { apiKey: "k" } }));
  const reply = (content) => ({ ok: true, json: async () => ({ choices: [{ message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 50 } }) });
  try {
    await delegate({ task: "a", workspace }, { credentialHome, fetch: () => reply("1") });
    await delegate({ task: "b", workspace }, { credentialHome, fetch: () => reply("2") });
    const response = await handle({ method: "tools/call", params: { name: "recall", arguments: { workspace } } });
    assert.equal(response.structuredContent.totalTokens, 300);
    assert.equal(response.structuredContent.totalCostUsd, 0.00003);
    assert.match(response.content[0].text, /Total across these 2 delegation/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(credentialHome, { recursive: true, force: true });
  }
});

test("forget clears all history or a single thread", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "ahub-mcp-forget-"));
  const credentialHome = await mkdtemp(join(tmpdir(), "ahub-mcp-forget-home-"));
  await mkdir(join(workspace, ".ahub"), { recursive: true });
  await mkdir(join(credentialHome, ".ahub"), { recursive: true });
  await writeFile(join(workspace, ".ahub", "config.json"), JSON.stringify({ models: { ds4f: { provider: "deepseek", model: "x" } } }));
  await writeFile(join(credentialHome, ".ahub", "credentials.json"), JSON.stringify({ deepseek: { apiKey: "k" } }));
  try {
    await delegate({ task: "a", workspace, threadId: "t1" }, { credentialHome, fetch: () => jsonDelegateReply("1") });
    await delegate({ task: "b", workspace, threadId: "t1" }, { credentialHome, fetch: () => jsonDelegateReply("2") });
    await delegate({ task: "c", workspace, threadId: "t2" }, { credentialHome, fetch: () => jsonDelegateReply("3") });
    // forget one thread keeps the other
    const partial = await handle({ method: "tools/call", params: { name: "forget", arguments: { workspace, threadId: "t1" } } });
    assert.equal(partial.structuredContent.removed, 2);
    const after = await handle({ method: "tools/call", params: { name: "recall", arguments: { workspace } } });
    assert.equal(after.structuredContent.count, 1);
    assert.equal(after.structuredContent.delegations[0].threadId, "t2");
    // forget all clears everything
    const all = await handle({ method: "tools/call", params: { name: "forget", arguments: { workspace } } });
    assert.equal(all.structuredContent.removed, 1);
    const empty = await handle({ method: "tools/call", params: { name: "recall", arguments: { workspace } } });
    assert.equal(empty.structuredContent.count, 0);
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(credentialHome, { recursive: true, force: true });
  }
});
