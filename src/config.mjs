import { readFile, writeFile } from "node:fs/promises";
import { paths } from "./store.mjs";

export const DEFAULT_CONFIG = {
  version: 1,
  ui: {
    language: null,
  },
  defaultSession: "main",
  defaultContext: "summary",
  models: {
    ds4f: {
      provider: "deepseek",
      model: "deepseek-v4-flash",
    },
  },
  profiles: {
    cheap: {
      model: "ds4f",
      effort: "low",
    },
    balanced: {},
    best: {
      effort: "high",
    },
  },
  commands: {
    "/ds4f": "model:ds4f",
    "/cheap": "profile:cheap",
    "/flash": "profile:cheap",
    "/省钱": "profile:cheap",
    "/balanced": "profile:balanced",
    "/best": "profile:best",
    "/cc": "cli:claude",
    "/cx": "cli:codex",
  },
  shortcuts: {
    "/ds": { model: "ds4f" },
    "/native": { model: "native" },
    "/brief": { contextMode: "brief" },
    "/related": { contextMode: "related" },
    "/full": { contextMode: "full" },
    "/fresh": { contextMode: "fresh" },
    "/analyze": { role: "architect" },
    "/code": { role: "coder" },
    "/review": { role: "reviewer" },
  },
  agents: {
    architect: {
      runtime: "claude",
      context: "session",
      access: "read-only",
      instructions: "Analyze the problem and propose a clear architecture. Do not modify files.",
    },
    coder: {
      runtime: "codex",
      context: "summary",
      access: "write",
      instructions: "Implement the requested change, run relevant tests, and report the result.",
    },
    reviewer: {
      runtime: "claude",
      context: "session",
      access: "read-only",
      fresh: true,
      instructions: "Review independently. Identify concrete risks and do not modify files.",
    },
  },
  runtimes: {
    claude: { permissionMode: "acceptEdits" },
    codex: { sandbox: "workspace-write" },
    deepseek: { command: "claude", permissionMode: "acceptEdits" },
  },
};

function mergeConfig(value = {}) {
  const agents = Object.fromEntries(
    Object.entries({ ...DEFAULT_CONFIG.agents, ...value.agents }).map(([name, agent]) => [
      name,
      { ...(DEFAULT_CONFIG.agents[name] ?? {}), ...agent },
    ]),
  );
  return {
    ...DEFAULT_CONFIG,
    ...value,
    ui: { ...DEFAULT_CONFIG.ui, ...value.ui },
    agents,
    models: { ...DEFAULT_CONFIG.models, ...value.models },
    profiles: { ...DEFAULT_CONFIG.profiles, ...value.profiles },
    commands: { ...DEFAULT_CONFIG.commands, ...value.commands },
    shortcuts: { ...DEFAULT_CONFIG.shortcuts, ...value.shortcuts },
    runtimes: {
      claude: { ...DEFAULT_CONFIG.runtimes.claude, ...value.runtimes?.claude },
      codex: { ...DEFAULT_CONFIG.runtimes.codex, ...value.runtimes?.codex },
      deepseek: { ...DEFAULT_CONFIG.runtimes.deepseek, ...value.runtimes?.deepseek },
      ...value.runtimes,
    },
  };
}

export async function loadConfig(root) {
  try {
    return mergeConfig(JSON.parse(await readFile(paths(root).config, "utf8")));
  } catch (error) {
    if (error.code === "ENOENT") return mergeConfig();
    if (error instanceof SyntaxError) throw new Error(`invalid config: ${paths(root).config}`);
    throw error;
  }
}

export async function saveConfig(root, config) {
  await writeFile(paths(root).config, `${JSON.stringify(config, null, 2)}\n`);
}

export function resolveAgent(config, name) {
  const agent = config.agents[name];
  if (!agent) throw new Error(`unknown agent: ${name}. Try: ${Object.keys(config.agents).join(", ")}`);
  return { name, ...agent };
}

export function resolveProfileCommand(config, task) {
  const parts = task.trim().split(/\s+/u);
  const commands = [];
  let profileName;
  let modelName;
  let cli;
  while (parts[0]?.startsWith("/")) {
    const command = parts.shift();
    const target = config.commands[command];
    if (!target) throw new Error(`unknown ahub command: ${command}. Try: ${Object.keys(config.commands).join(", ")}`);
    commands.push(command);
    const normalized = target.includes(":") ? target : `profile:${target}`;
    const [kind, value] = normalized.split(":", 2);
    if (kind === "profile") profileName = value;
    else if (kind === "model") modelName = value;
    else if (kind === "cli") cli = value;
    else throw new Error(`command ${command} has unsupported target: ${target}`);
  }
  const profile = profileName ? config.profiles[profileName] : undefined;
  if (profileName && !profile) throw new Error(`unknown profile: ${profileName}`);
  const requestedModel = modelName ?? profile?.model;
  const model = requestedModel && requestedModel !== "inherit"
    ? (config.models[requestedModel] ?? { model: requestedModel })
    : undefined;
  return { commands, profileName, profile, modelName, model, cli, task: parts.join(" ") };
}

export function resolveConfiguredModel(config, value) {
  if (!value || value === "inherit") return undefined;
  return config.models[value] ?? { model: value };
}
