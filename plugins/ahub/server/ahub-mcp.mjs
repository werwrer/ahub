#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { appendFile, chmod, lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

const VERSION = "0.6.1";
const DEFAULT_MODEL = "deepseek-v4-flash";
const MAX_CONTEXT = 60_000;
const MAX_THREAD_TURNS = 6;     // cap prior turns replayed for thread continuity (bounds token cost)
const MAX_REPLAY_TASK = 2_000;  // per-turn char caps so huge earlier turns can't blow up the payload
const MAX_REPLAY_OUTPUT = 8_000;
const MAX_DELEGATIONS = 500;    // soft cap on the delegation log; compacted past 2x

// Slice by UTF-16 code units but never end on a lone high surrogate (which would emit invalid
// JSON/UTF). If the cut would split a surrogate pair, back up one code unit.
function safeSlice(value, max) {
  if (value.length <= max) return value;
  let end = max;
  if (end > 0) {
    const unit = value.charCodeAt(end - 1);
    if (unit >= 0xD800 && unit <= 0xDBFF) end -= 1;
  }
  return value.slice(0, end);
}

// Keep the head and tail of a replayed thread turn, marking the elided middle, so thread
// replay never re-sends an unbounded earlier task/answer.
function headAndTail(value, max) {
  if (value.length <= max) return value;
  const head = Math.floor(max * 0.6);
  const tail = max - head;
  return `${value.slice(0, head)}\n…[${value.length - max} characters elided from this earlier turn]…\n${value.slice(-tail)}`;
}

const builtins = {
  "/ds": { model: "external" },
  "/native": { model: "native" },
  "/brief": { contextMode: "brief" },
  "/related": { contextMode: "related" },
  "/full": { contextMode: "full" },
  "/fresh": { contextMode: "fresh" },
  "/analyze": { role: "architect" },
  "/code": { role: "coder" },
  "/review": { role: "reviewer" },
};

async function readJson(file) {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return {}; throw error; }
}

async function credential(cwd = process.cwd(), providerName = "deepseek", credentialHome = homedir()) {
  const project = await readJson(resolve(cwd, ".ahub", "secrets.json"));
  if (project[providerName]?.apiKey) return { ...project[providerName], scope: "project" };
  const shared = await readJson(resolve(credentialHome, ".ahub", "credentials.json"));
  return shared[providerName]?.apiKey ? { ...shared[providerName], scope: "ahub" } : undefined;
}

function credentialsFile(credentialHome = homedir()) {
  return resolve(credentialHome, ".ahub", "credentials.json");
}

// Serialize credential writes within this process. The stdio handler is async and can run
// two `connect` calls concurrently; without this, read-modify-write loses one provider's key.
let credentialWriteChain = Promise.resolve();
function serializedCredentialWrite(write) {
  const next = credentialWriteChain.then(write, write);
  // Keep the chain alive even if callers don't await, and don't let one failure break the next.
  credentialWriteChain = next.catch(() => {});
  return next;
}

// Atomically write a validated provider key to ahub's owner-only credential store.
// Mirrors src/secrets.mjs: temp file (0o600) + rename, so a crash never truncates the store.
async function writeCredential(providerName, apiKey, options = {}) {
  return serializedCredentialWrite(async () => {
    const file = credentialsFile(options.credentialHome);
    const dir = resolve(file, "..");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    try { await chmod(dir, 0o700); } catch { /* best-effort */ }
    const secrets = await readJson(file);
    secrets[providerName] = { apiKey: apiKey.trim(), updatedAt: new Date().toISOString(), ...(options.verifiedAt ? { verifiedAt: options.verifiedAt } : {}) };
    const tmp = resolve(dir, `.credentials.${process.pid}.${randomUUID()}.tmp`);
    await writeFile(tmp, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 });
    try { await chmod(tmp, 0o600); } catch { /* best-effort */ }
    await rename(tmp, file);
  });
}

// --- Delegation memory: an append-only log of @ahub delegations, so the host can retrieve
// what a delegated model said (recall) and a thread can resume across turns. Terminal `ask`
// already keeps its own run history in state.json; this is the in-app (@ahub) equivalent.

function delegationsFile(cwd) {
  return resolve(cwd, ".ahub", "delegations.jsonl");
}

// Serialize log appends/compactions so concurrent delegate calls never interleave lines.
let delegationChain = Promise.resolve();
function serializedDelegation(write) {
  const next = delegationChain.then(write, write);
  delegationChain = next.catch(() => {});
  return next;
}

// Append one delegation entry; compact the log to the last MAX_DELEGATIONS once it exceeds 2x.
// `entry.task`/`entry.output` are already redacted (delegation redacts before sending).
async function appendDelegation(cwd, entry) {
  return serializedDelegation(async () => {
    const file = delegationsFile(cwd);
    const dir = resolve(file, "..");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    try { await chmod(dir, 0o700); } catch { /* best-effort */ }
    await appendFile(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    try { await chmod(file, 0o600); } catch { /* best-effort */ }
    let lines = [];
    try { lines = (await readFile(file, "utf8")).split("\n").filter(Boolean); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (lines.length > MAX_DELEGATIONS * 2) {
      const kept = lines.slice(-MAX_DELEGATIONS);
      const tmp = resolve(dir, `.delegations.${process.pid}.${randomUUID()}.tmp`);
      await writeFile(tmp, `${kept.join("\n")}\n`, { mode: 0o600 });
      try { await chmod(tmp, 0o600); } catch { /* best-effort */ }
      await rename(tmp, file);
    }
  });
}

// Read parsed delegation entries, optionally filtered to a thread, newest-last, capped.
async function readDelegations(cwd, { threadId, limit = 50 } = {}) {
  let raw;
  try { raw = await readFile(delegationsFile(cwd), "utf8"); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
  const entries = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    try { entries.push(JSON.parse(line)); } catch { /* skip malformed */ }
  }
  const filtered = threadId ? entries.filter((entry) => entry.threadId === threadId) : entries;
  return limit ? filtered.slice(-limit) : filtered;
}

// Delete delegation history (all, or one thread), via an atomic rewrite inside the same
// serialized chain as appends. Returns the number of entries removed.
async function clearDelegations(cwd, { threadId } = {}) {
  return serializedDelegation(async () => {
    const file = delegationsFile(cwd);
    const all = await readDelegations(cwd, {});
    const kept = threadId ? all.filter((entry) => entry.threadId !== threadId) : [];
    const removed = all.length - kept.length;
    if (removed === 0) return 0;
    const dir = resolve(file, "..");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const tmp = resolve(dir, `.delegations.${process.pid}.${randomUUID()}.tmp`);
    await writeFile(tmp, kept.length ? `${kept.map((entry) => JSON.stringify(entry)).join("\n")}\n` : "", { mode: 0o600 });
    try { await chmod(tmp, 0o600); } catch { /* best-effort */ }
    await rename(tmp, file);
    return removed;
  });
}

// Validate a key against a provider's /models endpoint (kept inline — the MCP server is standalone).
async function validateKey(provider, apiKey, options = {}) {
  const baseUrl = (provider?.baseUrl ?? "").replace(/\/$/u, "");
  if (!baseUrl) return { ok: false, reason: "no-base-url" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  try {
    const response = await (options.fetch ?? fetch)(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${apiKey.trim()}` }, signal: controller.signal });
    if (response.ok) return { ok: true };
    if (response.status === 401 || response.status === 403) return { ok: false, reason: "invalid-key", status: response.status };
    return { ok: false, reason: "service", status: response.status };
  } catch (error) {
    return { ok: false, reason: error.name === "AbortError" ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}

// Connect a provider by reading its key from a LOCAL file — the key never enters the chat,
// is validated against the provider, then stored in the private credential store.
async function connectProviderFile(input, options = {}) {
  const cwd = input.workspace ?? process.cwd();
  const config = await settings(cwd);
  const providerName = input.provider;
  const provider = config.providers?.[providerName];
  if (!provider?.baseUrl) throw new Error(`Unknown or unconfigured provider "${providerName}". Register it first: \`ahub provider add ${providerName} <baseUrl>\`.`);
  if (!input.keyFile) throw new Error("A keyFile path is required. The key is read from that local file and never enters the conversation.");
  const keyPath = resolve(input.keyFile);
  // Defense against prompt-injected exfiltration: the file's contents are sent to the provider
  // for validation, so reject well-known sensitive locations first (never even stat them),
  // then refuse symlinks and cap size.
  const lower = keyPath.toLowerCase();
  if (["/.ssh/", "/.aws/", "/.gnupg/", "/.config/gh/", "/.config/git/"].some((seg) => lower.includes(seg))) {
    throw new Error(`Refusing to read a sensitive path (${keyPath}). Point keyFile at a file that contains only the API key.`);
  }
  try {
    if ((await lstat(keyPath)).isSymbolicLink()) throw new Error("key file is a symlink; refused for safety");
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`Key file not found: ${keyPath}`);
    throw error;
  }
  let apiKey;
  try { apiKey = (await readFile(keyPath, { encoding: "utf8", flag: "r" })).trim(); }
  catch (error) { throw new Error(`Could not read key file ${keyPath}: ${error.message}`); }
  if (apiKey.length > 8192) throw new Error("Key file is too large (>8KB); expected a file containing only the API key.");
  if (!apiKey) throw new Error("The key file is empty.");
  const result = await validateKey(provider, apiKey, options);
  if (!result.ok) {
    const reason = result.reason === "invalid-key" ? "the provider rejected the key"
      : result.reason === "timeout" ? "the provider did not respond in time"
      : result.reason === "network" ? "the provider could not be reached"
      : "the connection could not be verified";
    throw new Error(`${provider.label ?? providerName} key not saved: ${reason}.`);
  }
  await writeCredential(providerName, apiKey, { credentialHome: options.credentialHome, verifiedAt: new Date().toISOString() });
  return { ok: true, provider: providerName, label: provider.label ?? providerName, scope: "ahub" };
}

// Defense-in-depth: scrub common credential shapes before context leaves the host.
// This is best-effort, not a guarantee — the host must still avoid selecting secrets.
function redact(text = "") {
  return String(text)
    // Bare `sk-` keys only, and only when long enough and containing a digit — a loose
    // sk|ds|api pattern was corrupting legitimate prose like "api-endpoint-implementation".
    .replace(/\bsk-[A-Za-z0-9_-]{24,}\b/giu, (token) => (/\d/u.test(token) ? "[REDACTED_KEY]" : token))
    .replace(/\b(AKIA|ASIA)[0-9A-Z]{16}\b/gu, "[REDACTED_AWS_KEYID]")
    .replace(/\bAIza[0-9A-Za-z_-]{35}\b/g, "[REDACTED_GOOGLE_KEY]")
    .replace(/\bya29\.[0-9A-Za-z_-]+/g, "[REDACTED_GOOGLE_TOKEN]")
    .replace(/\bxox[baprs]-[0-9A-Za-z-]{10,}/g, "[REDACTED_SLACK_TOKEN]")
    .replace(/\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_JWT]")
    .replace(/\bBearer\s+[A-Za-z0-9._-]{16,}/giu, "Bearer [REDACTED]")
    // Covers env/YAML (`api_key: x`) AND JSON (`"api_key":"x"`); \b avoids matching inside larger words.
    .replace(/\b(api[_-]?key|auth(?:orization)?|access[_-]?token|secret(?:[_-]?key)?|password|token)["']?\s*[:=]\s*['"]?[^\s,;}'"]+/giu, "$1=[REDACTED]")
    .replace(/-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/gu, "[REDACTED_PRIVATE_KEY]");
}

async function settings(cwd = process.cwd()) {
  const configPath = resolve(cwd, ".ahub", "config.json");
  const config = await readJson(configPath);
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error(`ahub config at ${configPath} is not a JSON object`);
  }
  const defaultProviders = { deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com", kind: "openai" } };
  const defaultModels = { ds4f: { name: "DeepSeek V4 Flash", provider: "deepseek", model: DEFAULT_MODEL, favorite: true } };
  const models = Object.fromEntries(Object.entries({ ...defaultModels, ...(config.models ?? {}) }).map(([alias, model]) => [alias, { ...(defaultModels[alias] ?? {}), ...model }]));
  const activeModel = config.defaults?.activeModel ?? config.defaults?.externalModel ?? "ds4f";
  return {
    models,
    providers: { ...defaultProviders, ...(config.providers ?? {}) },
    activeModel,
    externalModel: activeModel,
    delegationLog: config.delegationLog !== false,
    shortcuts: { ...builtins, ...(config.shortcuts ?? {}) },
  };
}

function resolveShortcuts(shortcuts, available) {
  const route = {};
  for (const name of shortcuts ?? []) {
    const preset = available[name];
    if (!preset) throw new Error(`Unknown ahub shortcut: ${name}`);
    Object.assign(route, preset);
  }
  return route;
}

function roleInstruction(role) {
  if (role === "architect") return "Analyze deeply. Identify assumptions, tradeoffs, and a concrete recommendation. Do not claim to edit files.";
  if (role === "reviewer") return "Review independently. Prioritize concrete risks, errors, and missing evidence.";
  if (role === "coder") return "Propose implementation-ready changes and verification steps. Do not claim changes were applied.";
  return "Answer the user's task directly and distinguish facts from assumptions.";
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Estimate USD from a model cost config (usd per 1M tokens) and token usage.
// `cost` may be a number (blended per-1M) or { input, output } per-1M.
function computeCost(cost, usage) {
  if (!cost || !usage) return undefined;
  const prompt = usage.prompt_tokens ?? usage.input_tokens ?? 0;
  const completion = usage.completion_tokens ?? usage.output_tokens ?? 0;
  const inputPerM = typeof cost === "number" ? cost : (cost.input ?? cost.output ?? 0);
  const outputPerM = typeof cost === "number" ? cost : (cost.output ?? cost.input ?? 0);
  const usd = (prompt / 1_000_000) * inputPerM + (completion / 1_000_000) * outputPerM;
  return Number(usd.toFixed(6));
}

// Parse an OpenAI-compatible SSE chunk stream: accumulate content deltas and usage,
// emitting each delta via onProgress(delta, fullTextSoFar). Uses a streaming TextDecoder so
// multi-byte sequences split across chunks decode correctly. onChunk (if given) is called per
// chunk to reset an idle timer. Returns aborted=true if the stream was interrupted, with the
// partial text accumulated so far.
async function parseSseStream(body, onProgress, onChunk) {
  const decoder = new TextDecoder("utf8");
  let buffer = "";
  let text = "";
  let usage;
  let aborted = false;
  try {
    for await (const chunk of body) {
      onChunk?.();
      buffer += decoder.decode(chunk, { stream: true });
      if (buffer.length > 1_000_000) throw new Error("provider streamed >1MB without a newline; aborting");
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, "").trim();
        buffer = buffer.slice(nl + 1);
        if (!line || line.startsWith(":") || !line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const event = JSON.parse(data);
          const delta = event.choices?.[0]?.delta?.content;
          if (delta) { text += delta; onProgress?.(delta, text); }
          if (event.usage) usage = event.usage;
        } catch { /* skip malformed/keepalive lines */ }
      }
    }
    buffer += decoder.decode(); // flush trailing bytes
  } catch (error) {
    if (error.name === "AbortError") aborted = true;
    else throw error;
  }
  return { text, usage, aborted };
}

// POST /chat/completions with streaming, an idle + total timeout, and a single retry on
// transient errors. Sniffs content-type to distinguish a real SSE stream from a provider that
// ignored stream:true and returned JSON. On an interrupted stream, returns the partial text
// already received rather than discarding it.
async function completeChat(url, headers, payload, options = {}) {
  const totalMs = options.timeoutMs ?? 120_000;
  const idleMs = options.idleTimeoutMs ?? 30_000;
  const started = Date.now();
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    let timer = setTimeout(() => controller.abort(), totalMs);
    const resetIdle = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(), idleMs); };
    try {
      const response = await (options.fetch ?? fetch)(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...payload, stream: true, stream_options: { include_usage: true } }),
        signal: controller.signal,
      });
      if (response.ok) {
        const contentType = response.headers?.get?.("content-type") ?? "";
        const iterable = response.body && typeof response.body[Symbol.asyncIterator] === "function";
        if (iterable && contentType.includes("text/event-stream")) {
          resetIdle();
          const { text, usage, aborted } = await parseSseStream(response.body, options.onProgress, resetIdle);
          clearTimeout(timer);
          if (aborted && !text) throw Object.assign(new Error("stream produced no content before timing out"), { status: "timeout" });
          return { text, usage, elapsedMs: Date.now() - started, attempts: attempt, streamInterrupted: Boolean(aborted) };
        }
        // Provider returned JSON (ignored stream:true) or no SSE content-type.
        const json = await response.json().catch(() => ({}));
        return { text: json.choices?.[0]?.message?.content, usage: json.usage, elapsedMs: Date.now() - started, attempts: attempt };
      }
      const body = await response.json().catch(() => ({}));
      if (!RETRYABLE.has(response.status)) {
        const error = new Error(body.error?.message ?? `${response.status}`);
        error.status = response.status;
        error.elapsedMs = Date.now() - started;
        throw error;
      }
      lastError = Object.assign(new Error(body.error?.message ?? `${response.status}`), { status: response.status });
    } catch (error) {
      if (error.name === "AbortError") lastError = Object.assign(new Error("request timed out"), { status: "timeout" });
      else if (error.status) throw error; // non-retryable already packaged above
      else lastError = error;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < 2) await sleep(800 * attempt); // back off before the final retry
  }
  lastError.elapsedMs = Date.now() - started;
  lastError.attempts = 2;
  throw lastError;
}

async function delegate(input, options = {}) {
  const cwd = input.workspace ?? process.cwd();
  const config = await settings(cwd);
  const shortcutRoute = resolveShortcuts(input.shortcuts, config.shortcuts);
  const route = {
    model: input.model ?? shortcutRoute.model ?? config.activeModel,
    contextMode: input.contextMode ?? shortcutRoute.contextMode ?? "related",
    role: input.role ?? shortcutRoute.role ?? "general",
  };
  if (route.model === "external") route.model = config.activeModel;
  if (route.model === "native") throw new Error("The native host model does not need delegation; answer in the host directly.");
  const selectedModel = config.models[route.model];
  if (!selectedModel) throw new Error(`Unknown ahub model: ${route.model}`);
  if (selectedModel.enabled === false) throw new Error(`Model ${route.model} is hidden. Enable it in ahub's model library first.`);
  const providerName = selectedModel.provider;
  if (!providerName) throw new Error(`Model ${route.model} uses the host CLI's own provider, so there is nothing to delegate. Answer in the host directly, or connect a provider for this model in ahub.`);
  const provider = config.providers[providerName];
  if (!provider?.baseUrl) throw new Error(`Model ${route.model} references provider "${providerName}", which is not configured. Add it under providers in .ahub/config.json or run \`ahub provider add ${providerName}\`.`);
  if (route.contextMode === "full" && input.confirmed !== true) throw new Error("Full context requires explicit user confirmation before it is sent to an external model.");
  const auth = await credential(cwd, providerName, options.credentialHome);
  if (!auth?.apiKey) throw new Error(`${provider.label ?? providerName} is not connected. Connect it with the ahub \`connect\` tool (from a local key file) or run \`ahub auth set ${providerName}\` in a terminal.`);
  // Resolve the delegation thread: an explicit threadId, or `continue` to resume the most
  // recent one. A thread lets the delegated model continue across turns using only its OWN
  // prior delegations — never the host's full transcript.
  let threadId = input.threadId;
  let priorTurns = [];
  if (config.delegationLog !== false) {
    if (input.continue && !threadId) {
      const recent = await readDelegations(cwd, { limit: 1 });
      threadId = recent[0]?.threadId;
    }
    if (threadId) {
      const history = await readDelegations(cwd, { threadId, limit: MAX_THREAD_TURNS });
      priorTurns = history
        .filter((entry) => entry.task && entry.output)
        .flatMap((entry) => [
          { role: "user", content: headAndTail(entry.task, MAX_REPLAY_TASK) },
          { role: "assistant", content: headAndTail(entry.output, MAX_REPLAY_OUTPUT) },
        ]);
    }
  }
  if (!threadId) threadId = `t_${randomUUID()}`;

  const rawContext = redact(input.context ?? "");
  const contextTruncated = rawContext.length > MAX_CONTEXT;
  const context = contextTruncated ? safeSlice(rawContext, MAX_CONTEXT) : rawContext;
  const task = redact(input.task ?? "").trim();
  if (!task) throw new Error("A task is required.");
  const truncationNote = contextTruncated ? `\n\n[ahub note: the host context above was truncated to ${MAX_CONTEXT} characters; earlier content was omitted. Do not assume you saw everything.]` : "";
  const threadNote = priorTurns.length ? `\n${priorTurns.length / 2} prior turn(s) from this delegation thread are included as your own earlier messages; continue from there. You still have not seen the host's full transcript.` : "";
  const payload = {
    model: selectedModel.model,
    messages: [
      { role: "system", content: `${roleInstruction(route.role)}\nYou are a delegated model inside a host conversation. Use only the supplied context. Never claim you saw the full host transcript.${threadNote}` },
      ...priorTurns,
      { role: "user", content: `Task:\n${task}\n\nHost context (${route.contextMode}):\n${context || "No additional context supplied."}${truncationNote}` },
    ],
  };
  const baseUrl = (options.baseUrl ?? provider.baseUrl ?? "").replace(/\/$/u, "");
  let result;
  try {
    result = await completeChat(`${baseUrl}/chat/completions`, { Authorization: `Bearer ${auth.apiKey}`, "Content-Type": "application/json" }, payload, options);
  } catch (error) {
    const label = provider.label ?? providerName;
    const hint = error.status === 401 || error.status === 403 ? ` Check the ${label} key with \`ahub auth set ${providerName}\`.`
      : error.status === "timeout" ? " The provider did not respond in time; retry or raise the model timeout."
      : error.status === 429 ? " The provider rate-limited the request; retry shortly."
      : "";
    throw new Error(`${label} delegation failed: ${error.message}${error.status ? ` (HTTP ${error.status})` : ""}.${hint}`);
  }
  const { text, usage = {}, elapsedMs, attempts, streamInterrupted } = result;
  if (!text) throw new Error(`${provider.label ?? providerName} returned no message.`);
  const promptTokens = usage.prompt_tokens ?? usage.input_tokens;
  const completionTokens = usage.completion_tokens ?? usage.output_tokens;
  const tokens = { prompt: promptTokens, completion: completionTokens, total: usage.total_tokens ?? ((promptTokens ?? 0) + (completionTokens ?? 0)) };
  const costUsd = computeCost(selectedModel.cost, usage);
  // Persist the delegation (task/output already redacted) so recall and thread continuity work.
  if (config.delegationLog !== false) {
    await appendDelegation(cwd, {
      id: randomUUID(), threadId, model: selectedModel.model, provider: providerName, role: route.role,
      task, output: text, contextMode: route.contextMode, contextTruncated,
      streamInterrupted: Boolean(streamInterrupted),
      tokens, estimatedCostUsd: costUsd, elapsedMs, at: new Date().toISOString(),
    }).catch(() => { /* logging is best-effort; never fail a delegation on it */ });
  }
  return {
    output: text,
    model: selectedModel.model,
    modelAlias: route.model,
    provider: providerName,
    role: route.role,
    threadId,
    threadContinued: priorTurns.length > 0,
    contextMode: route.contextMode,
    contextCharacters: context.length,
    contextTruncated,
    streamInterrupted: Boolean(streamInterrupted),
    tokens,
    estimatedCostUsd: costUsd,
    elapsedMs,
    attempts,
    credentialScope: auth.scope,
  };
}

const tools = [
  {
    name: "delegate",
    title: "Delegate to an ahub model",
    description: "Send the current task and host-selected relevant context to any connected ahub provider (e.g. DeepSeek or another OpenAI-compatible model), then return its answer to this conversation. The host must explicitly supply context; this tool never reads the host transcript.",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "The user's current request, without ahub shortcuts." },
        context: { type: "string", description: "Relevant context selected from what the host currently sees. Exclude secrets and irrelevant history." },
        contextMode: { type: "string", enum: ["brief", "related", "full", "fresh"] },
        role: { type: "string", enum: ["general", "architect", "coder", "reviewer"] },
        model: { type: "string", description: "A model-library alias, native, or external for the active (current) model." },
        shortcuts: { type: "array", items: { type: "string" }, description: "Optional composable built-in or project shortcuts such as /ds, /related, and /review." },
        threadId: { type: "string", description: "Resume a delegation thread so the model continues from its own prior turns in this workspace. Omit for a fresh, stateless delegation." },
        continue: { type: "boolean", description: "True to resume the most recent delegation thread (equivalent to passing the last threadId)." },
        confirmed: { type: "boolean", description: "Must be true when contextMode is full." },
        workspace: { type: "string", description: "Current workspace path, used only for ahub config and legacy project credentials." }
      },
      required: ["task"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true }
  },
  {
    name: "status",
    title: "Check ahub model readiness",
    description: "List every configured provider and whether it is connected, show the active (current) model, and list the shortcuts available in this workspace.",
    inputSchema: { type: "object", properties: { workspace: { type: "string" } }, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: "connect",
    title: "Connect a provider from a local key file",
    description: "Connect a provider by reading its API key from a LOCAL file path. The key is validated against the provider, stored in ahub's private owner-only credential store (mode 600), and never returned or sent in the conversation. Use this only when the user points to a key file on disk; never ask the user to paste a key into the conversation. If the user has no key file, tell them to run `ahub auth set <provider>` in a terminal instead.",
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string", description: "A registered provider name (e.g. deepseek)." },
        keyFile: { type: "string", description: "Absolute path to a local file containing the API key. The key is read from disk, never from the conversation." },
        workspace: { type: "string", description: "Current workspace path." }
      },
      required: ["provider", "keyFile"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
  },
  {
    name: "recall",
    title: "Recall prior @ahub delegations",
    description: "Retrieve what delegated models said in this workspace — the host's way to obtain a delegated (sub-) agent's prior context from ahub's local memory. Returns recent delegations, or the full history of one thread. Use this to recall a previous answer or to find a threadId to continue. Outputs are stored locally (gitignored, owner-only); they never include the host's full transcript.",
    inputSchema: {
      type: "object",
      properties: {
        threadId: { type: "string", description: "If given, return only this thread's history (oldest→newest)." },
        limit: { type: "number", description: "Maximum entries to return (default 20)." },
        workspace: { type: "string", description: "Current workspace path." }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: "forget",
    title: "Forget recorded delegations",
    description: "Delete delegation history from this workspace's local memory — all of it, or a single thread (by threadId). Use only when the user explicitly asks to clear history or remove a thread. Affects only ahub's local delegation log; it never touches provider data.",
    inputSchema: {
      type: "object",
      properties: {
        threadId: { type: "string", description: "If given, delete only this thread's history; otherwise delete all delegation history." },
        workspace: { type: "string", description: "Current workspace path." }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
  }
];

async function callTool(name, input, options = {}) {
  if (name === "delegate") {
    const result = await delegate(input, options);
    return { structuredContent: result, content: [{ type: "text", text: result.output }] };
  }
  if (name === "connect") {
    const result = await connectProviderFile(input, options);
    return { structuredContent: result, content: [{ type: "text", text: `${result.label} connected and verified (credential scope: ${result.scope}).` }] };
  }
  if (name === "recall") {
    const cwd = input.workspace ?? process.cwd();
    const limit = Number.isFinite(input.limit) && input.limit > 0 ? Math.floor(input.limit) : 20;
    const entries = await readDelegations(cwd, { threadId: input.threadId, limit });
    // Cap outputs in structuredContent so recalling doesn't flood the host's context; the full
    // text of the latest answer is already in the host transcript.
    const delegations = entries.map((entry) => ({ ...entry, output: headAndTail(String(entry.output ?? ""), 4_000) }));
    const totalTokens = entries.reduce((sum, entry) => sum + (entry.tokens?.total ?? 0), 0);
    const totalCostUsd = entries.reduce((sum, entry) => sum + (Number(entry.estimatedCostUsd) || 0), 0);
    const threads = [...new Set(entries.map((entry) => entry.threadId))];
    const summary = entries.map((entry, index) => `${index + 1}. [${entry.at}] ${entry.model} (thread ${entry.threadId})\n   task: ${String(entry.task).slice(0, 160)}\n   answer: ${String(entry.output).slice(0, 160)}${entry.tokens?.total ? ` · ${entry.tokens.total} tokens${entry.estimatedCostUsd != null ? ` · ≈$${entry.estimatedCostUsd}` : ""}` : ""}`).join("\n\n");
    const totals = `\nTotal across these ${entries.length} delegation(s): ${totalTokens} tokens${totalCostUsd ? ` · ≈$${totalCostUsd.toFixed(6)}` : ""}.`;
    return {
      structuredContent: { delegations, threads, count: entries.length, totalTokens, totalCostUsd: Number(totalCostUsd.toFixed(6)) },
      content: [{ type: "text", text: entries.length ? `${entries.length} delegation(s):\n\n${summary}${totals}` : "No delegations recorded yet in this workspace." }],
    };
  }
  if (name === "forget") {
    const cwd = input.workspace ?? process.cwd();
    const removed = await clearDelegations(cwd, { threadId: input.threadId });
    const what = input.threadId ? `thread ${input.threadId}` : "all delegation history";
    return {
      structuredContent: { removed },
      content: [{ type: "text", text: removed ? `Forgot ${removed} delegation(s) from ${what} in this workspace.` : `Nothing to forget for ${what} in this workspace.` }],
    };
  }
  if (name === "status") {
    const cwd = input.workspace ?? process.cwd();
    const config = await settings(cwd);
    const providerNames = [...new Set(Object.values(config.models).map((model) => model.provider).filter(Boolean))];
    const providers = {};
    for (const providerName of providerNames) {
      const auth = await credential(cwd, providerName);
      const providerConf = config.providers[providerName];
      providers[providerName] = { label: providerConf?.label ?? providerName, ready: Boolean(auth?.apiKey), verified: Boolean(auth?.verifiedAt), scope: auth?.scope };
    }
    const result = { providers, activeModel: config.activeModel, models: config.models, shortcuts: config.shortcuts };
    const active = config.models[config.activeModel];
    const activeLabel = active ? `${active.name ?? config.activeModel} (${config.activeModel})` : config.activeModel;
    const parts = Object.values(providers).map((p) => `${p.label}: ${p.ready ? "ready" : "not connected"}`);
    const customShortcuts = Object.keys(config.shortcuts).filter((name) => !(name in builtins));
    const shortcutHint = customShortcuts.length ? ` Shortcuts: ${customShortcuts.join(", ")}.` : "";
    const summary = providerNames.length
      ? `Providers — ${parts.join(", ")}. Active model: ${activeLabel}.${shortcutHint}`
      : `No external providers configured. Active model: ${activeLabel}.${shortcutHint}`;
    return { structuredContent: result, content: [{ type: "text", text: summary }] };
  }
  throw new Error(`Unknown tool: ${name}`);
}

async function handle(message, options = {}) {
  if (message.method === "initialize") return { protocolVersion: message.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "ahub", version: VERSION }, instructions: "Use delegate only when the user asks for an external model. Any connected provider works, not only DeepSeek. Pass only relevant host-visible context. Never include secrets. Full context requires confirmation." };
  if (message.method === "notifications/initialized") return undefined;
  if (message.method === "tools/list") return { tools };
  if (message.method === "tools/call") return callTool(message.params?.name, message.params?.arguments ?? {}, options);
  if (message.method === "ping") return {};
  throw Object.assign(new Error(`Method not found: ${message.method}`), { code: -32601 });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const MAX_LINE = 4_000_000; // defend against unbounded line buffering / OOM
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on("line", async (line) => {
    if (line.length > MAX_LINE) {
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "request line too large" } })}\n`);
      return;
    }
    let message;
    try { message = JSON.parse(line); }
    catch { return; }
    if (message === null || typeof message !== "object" || Array.isArray(message)) return; // malformed; ignore
    const { jsonrpc, id, method } = message;
    const isRequest = id !== undefined && method !== undefined;
    // Only true notifications (no id) may be processed without a reply. A tools/call without an
    // id is a client bug — refuse it instead of silently running a paid network call.
    if (method !== undefined && id === undefined) {
      if (method === "tools/call" || method === "initialize") {
        process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32600, message: `${method} requires an id` } })}\n`);
      }
      try { await handle(message, {}); } catch {}
      return;
    }
    if (!isRequest) return;
    // During a tool call, stream content deltas as MCP progress notifications only when the
    // client explicitly supplied a progressToken. Hosts that render them give live token
    // streaming; others ignore them and still receive the final assembled result.
    const handleOptions = {};
    const progressToken = message.params?._meta?.progressToken;
    if (method === "tools/call" && progressToken !== undefined) {
      handleOptions.onProgress = (delta) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: { progressToken, data: { type: "token", text: delta } } })}\n`);
    }
    try { process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result: await handle(message, handleOptions) })}\n`); }
    catch (error) { process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code: error.code ?? -32000, message: error.message } })}\n`); }
  });
}

export { builtins, connectProviderFile, delegate, handle, redact, resolveShortcuts };
