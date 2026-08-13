import { readFile, writeFile } from "node:fs/promises";
import { paths } from "./store.mjs";

export const DEFAULT_CONFIG = {
  version: 1,
  ui: {
    language: null,
  },
  defaultSession: "main",
  defaultContext: "summary",
  defaults: {
    externalModel: "ds4f",
    activeModel: "ds4f",
  },
  providers: {
    deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com", kind: "openai" },
  },
  models: {
    ds4f: {
      name: "DeepSeek V4 Flash",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      tags: ["fast", "low-cost"],
      favorite: true,
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
    "/ds": { model: "external" },
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
  // Tolerate a config file that contains a non-object (null/array/scalar) without crashing.
  const source = (value && typeof value === "object" && !Array.isArray(value)) ? value : {};
  const agents = Object.fromEntries(
    Object.entries({ ...DEFAULT_CONFIG.agents, ...source.agents }).map(([name, agent]) => [
      name,
      { ...(DEFAULT_CONFIG.agents[name] ?? {}), ...agent },
    ]),
  );
  const defaults = { ...DEFAULT_CONFIG.defaults, ...source.defaults };
  // activeModel is the canonical "current model"; externalModel is a legacy alias kept in sync.
  if (!defaults.activeModel) defaults.activeModel = defaults.externalModel ?? DEFAULT_CONFIG.defaults.activeModel;
  if (!defaults.externalModel) defaults.externalModel = defaults.activeModel;
  // Merge per-key runtime defaults, then spread any non-builtin runtime keys the user added.
  const extraRuntimes = Object.fromEntries(Object.entries(source.runtimes ?? {}).filter(([key]) => !(key in DEFAULT_CONFIG.runtimes)));
  return {
    ...DEFAULT_CONFIG,
    ...source,
    ui: { ...DEFAULT_CONFIG.ui, ...source.ui },
    defaults,
    providers: { ...DEFAULT_CONFIG.providers, ...source.providers },
    agents,
    models: { ...DEFAULT_CONFIG.models, ...source.models },
    profiles: { ...DEFAULT_CONFIG.profiles, ...source.profiles },
    commands: { ...DEFAULT_CONFIG.commands, ...source.commands },
    shortcuts: { ...DEFAULT_CONFIG.shortcuts, ...source.shortcuts },
    runtimes: {
      claude: { ...DEFAULT_CONFIG.runtimes.claude, ...source.runtimes?.claude },
      codex: { ...DEFAULT_CONFIG.runtimes.codex, ...source.runtimes?.codex },
      deepseek: { ...DEFAULT_CONFIG.runtimes.deepseek, ...source.runtimes?.deepseek },
      ...extraRuntimes,
    },
  };
}

export const CURRENT_CONFIG_VERSION = 1;

// Ordered migrations from one schema version to the next. Each entry upgrades a config
// whose version is below `version` to exactly `version`. Add new entries here when the
// schema changes; bump CURRENT_CONFIG_VERSION to match the last entry.
const migrations = [
  { version: 1, migrate: (config) => ({ ...config, version: 1 }) },
];

// Validate and forward-migrate a config. Refuses configs written by a newer ahub
// (which could be silently mis-merged) instead of guessing.
export function migrateConfig(input = {}) {
  const declared = Number(input?.version) || 0;
  if (declared > CURRENT_CONFIG_VERSION) {
    throw new Error(`ahub config version ${declared} is newer than this ahub supports (v${CURRENT_CONFIG_VERSION}). Upgrade ahub (\`npm i -g @haruw/ahub\`) or remove ${"<root>/.ahub/config.json"} to reset.`);
  }
  let config = { ...input };
  for (const step of migrations) {
    if (declared < step.version) config = step.migrate(config);
  }
  return { ...config, version: CURRENT_CONFIG_VERSION };
}

export async function loadConfig(root) {
  try {
    return migrateConfig(mergeConfig(JSON.parse(await readFile(paths(root).config, "utf8"))));
  } catch (error) {
    if (error.code === "ENOENT") return migrateConfig(mergeConfig());
    if (error instanceof SyntaxError) throw new Error(`invalid config: ${paths(root).config}`);
    throw error;
  }
}

export async function saveConfig(root, config) {
  const stamped = { ...config, version: CURRENT_CONFIG_VERSION };
  await writeFile(paths(root).config, `${JSON.stringify(stamped, null, 2)}\n`);
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

// Compact label for pickers: "★ DeepSeek V4 Flash [ds4f]" — searchable by alias or name.
export function modelLabel(alias, model, _providers = {}) {
  const title = model.name ?? alias;
  const suffix = alias && title !== alias ? ` [${alias}]` : "";
  return `${model.favorite ? "★ " : ""}${title}${suffix}`;
}

// Ultra-short for dashboards: "★ DeepSeek V4 Flash" — no alias, no details.
export function modelShort(alias, model) {
  const title = model.name ?? alias;
  return `${model.favorite ? "★ " : ""}${title}`;
}

// Full detail line for browse/view (model ID + provider + cost + tags appended).
export function modelDetail(alias, model, providers = {}) {
  const title = model.name ?? alias;
  const providerConf = model.provider ? providers[model.provider] : undefined;
  const source = providerConf?.label ?? model.provider ?? "host CLI";
  const tags = Array.isArray(model.tags) && model.tags.length ? ` · ${model.tags.join(", ")}` : "";
  const costPerM = typeof model.cost === "number" ? model.cost : (model.cost && (model.cost.output ?? model.cost.input));
  const costHint = costPerM ? ` · $${costPerM}/M` : "";
  const ctx = model.contextWindow ? ` · ${Math.round(model.contextWindow / 1000)}k ctx` : "";
  return `${model.model} · ${source}${costHint}${tags}${ctx}`;
}

// Pick a fallback active model when the current one is being hidden or removed.
// Returns the first provider-backed, visible alias (preferring favorites), or undefined.
export function fallbackActiveModel(config, exclude) {
  const entries = Object.entries(config.models ?? {})
    .filter(([alias, model]) => alias !== exclude && model.provider && model.enabled !== false)
    .sort(([, a], [, b]) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)));
  return entries[0]?.[0];
}

export function modelChoices(config, options = {}) {
  const providers = config.providers ?? {};
  const assigned = new Set(Object.values(config.agents ?? {}).map((agent) => agent.model).filter(Boolean));
  return Object.entries(config.models)
    .filter(([, model]) => model.enabled !== false)
    .filter(([alias, model]) => options.filter ? options.filter(alias, model) : true)
    .sort(([aliasA, a], [aliasB, b]) => {
      const rank = (alias, model) => (assigned.has(alias) ? 0 : model.favorite ? 1 : 2);
      return rank(aliasA, a) - rank(aliasB, b) || (a.name ?? aliasA).localeCompare(b.name ?? aliasB);
    })
    .map(([alias, model]) => ({ name: modelLabel(alias, model, providers), value: alias, ...(options.description ? { description: options.description(alias, model) } : {}) }));
}
