#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

const VERSION = "0.3.0";
const DEFAULT_MODEL = "deepseek-v4-flash";
const MAX_CONTEXT = 60_000;

const builtins = {
  "/ds": { model: "ds4f" },
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

async function credential(cwd = process.cwd(), credentialHome = homedir()) {
  const project = await readJson(resolve(cwd, ".ahub", "secrets.json"));
  if (project.deepseek?.apiKey) return { ...project.deepseek, scope: "project" };
  const shared = await readJson(resolve(credentialHome, ".ahub", "credentials.json"));
  return shared.deepseek?.apiKey ? { ...shared.deepseek, scope: "ahub" } : undefined;
}

function redact(text = "") {
  return String(text)
    .replace(/\b(?:sk|ds|api)[-_][A-Za-z0-9_-]{16,}\b/giu, "[REDACTED_KEY]")
    .replace(/(api[_ -]?key|authorization|token|password)\s*[:=]\s*[^\s,;]+/giu, "$1=[REDACTED]")
    .replace(/-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/gu, "[REDACTED_PRIVATE_KEY]");
}

async function settings(cwd = process.cwd()) {
  const config = await readJson(resolve(cwd, ".ahub", "config.json"));
  return {
    model: config.models?.ds4f?.model ?? DEFAULT_MODEL,
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

async function delegate(input, options = {}) {
  const cwd = input.workspace ?? process.cwd();
  const config = await settings(cwd);
  const shortcutRoute = resolveShortcuts(input.shortcuts, config.shortcuts);
  const route = {
    model: input.model ?? shortcutRoute.model ?? "ds4f",
    contextMode: input.contextMode ?? shortcutRoute.contextMode ?? "related",
    role: input.role ?? shortcutRoute.role ?? "general",
  };
  if (route.model === "native") throw new Error("The native host model does not need delegation; answer in the host directly.");
  if (route.contextMode === "full" && input.confirmed !== true) throw new Error("Full context requires explicit user confirmation before it is sent to an external model.");
  const auth = await credential(cwd, options.credentialHome);
  if (!auth?.apiKey) throw new Error("DeepSeek is not connected. Open ahub and choose Models & API keys → DeepSeek → Connect.");
  const context = redact(input.context ?? "").slice(0, MAX_CONTEXT);
  const task = redact(input.task ?? "").trim();
  if (!task) throw new Error("A task is required.");
  const payload = {
    model: config.model,
    messages: [
      { role: "system", content: `${roleInstruction(route.role)}\nYou are a delegated model inside a host conversation. Use only the supplied context. Never claim you saw the full host transcript.` },
      { role: "user", content: `Task:\n${task}\n\nHost context (${route.contextMode}):\n${context || "No additional context supplied."}` },
    ],
    stream: false,
  };
  const baseUrl = options.baseUrl ?? process.env.AHUB_DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
  const response = await (options.fetch ?? fetch)(`${baseUrl.replace(/\/$/u, "")}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${auth.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message ?? `DeepSeek request failed (${response.status})`);
  const output = body.choices?.[0]?.message?.content;
  if (!output) throw new Error("DeepSeek returned no message.");
  return {
    output,
    model: config.model,
    role: route.role,
    contextMode: route.contextMode,
    contextCharacters: context.length,
    credentialScope: auth.scope,
  };
}

const tools = [
  {
    name: "delegate",
    title: "Delegate to an ahub model",
    description: "Send the current task and host-selected relevant context to DeepSeek, then return its answer to this conversation. The host must explicitly supply context; this tool never reads the host transcript.",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "The user's current request, without ahub shortcuts." },
        context: { type: "string", description: "Relevant context selected from what the host currently sees. Exclude secrets and irrelevant history." },
        contextMode: { type: "string", enum: ["brief", "related", "full", "fresh"] },
        role: { type: "string", enum: ["general", "architect", "coder", "reviewer"] },
        model: { type: "string", enum: ["ds4f", "native"] },
        shortcuts: { type: "array", items: { type: "string" }, description: "Optional composable built-in or project shortcuts such as /ds, /related, and /review." },
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
    description: "Check whether DeepSeek is connected and list the shortcuts available in this workspace.",
    inputSchema: { type: "object", properties: { workspace: { type: "string" } }, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }
];

async function callTool(name, input) {
  if (name === "delegate") {
    const result = await delegate(input);
    return { structuredContent: result, content: [{ type: "text", text: result.output }] };
  }
  if (name === "status") {
    const cwd = input.workspace ?? process.cwd();
    const [auth, config] = await Promise.all([credential(cwd), settings(cwd)]);
    const result = { deepseek: auth ? "ready" : "not_connected", verified: Boolean(auth?.verifiedAt), credentialScope: auth?.scope, shortcuts: config.shortcuts };
    return { structuredContent: result, content: [{ type: "text", text: auth ? `DeepSeek is ready (${auth.scope} credential).` : "DeepSeek is not connected." }] };
  }
  throw new Error(`Unknown tool: ${name}`);
}

async function handle(message) {
  if (message.method === "initialize") return { protocolVersion: message.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "ahub", version: VERSION }, instructions: "Use delegate only when the user asks for an external model. Pass only relevant host-visible context. Never include secrets. Full context requires confirmation." };
  if (message.method === "notifications/initialized") return undefined;
  if (message.method === "tools/list") return { tools };
  if (message.method === "tools/call") return callTool(message.params?.name, message.params?.arguments ?? {});
  if (message.method === "ping") return {};
  throw Object.assign(new Error(`Method not found: ${message.method}`), { code: -32601 });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on("line", async (line) => {
    let message;
    try { message = JSON.parse(line); }
    catch { return; }
    if (message.id === undefined) { try { await handle(message); } catch {} return; }
    try { process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: await handle(message) })}\n`); }
    catch (error) { process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: error.code ?? -32000, message: error.message } })}\n`); }
  });
}

export { builtins, delegate, handle, redact, resolveShortcuts };
