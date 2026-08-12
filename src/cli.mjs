import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG, loadConfig, resolveAgent, resolveConfiguredModel, resolveProfileCommand, saveConfig } from "./config.mjs";
import { compileContext } from "./context.mjs";
import { commandVersion, runRuntime } from "./runtimes.mjs";
import { getProviderCredential, getProviderSecret, loadSecrets, readHidden, removeProviderSecret, setProviderSecret } from "./secrets.mjs";
import { validateDeepSeekCredential } from "./providers.mjs";
import { createPrompts } from "./prompts.mjs";
import { banner, clearScreen, hint, section, spinner, statusMark, success, warning } from "./ui.mjs";
import { inferLanguage, translator } from "./i18n.mjs";
import { emptyState, exists, findSession, loadState, migrateLegacyState, mutate, paths, saveState } from "./store.mjs";

const HELP = `ahub — coordinate coding agents without memorizing commands

Start here:
  ahub setup
  ahub config
  ahub status

In Codex App, type @ahub- and describe what you want.
Run \`ahub help --all\` for scripting and advanced commands.`;

const FULL_HELP = `${HELP}

Automation and advanced commands:
  ahub ask <architect|coder|reviewer> [--cli claude|codex] [--model inherit|alias|model-id] -- <task>
  ahub model list
  ahub model set <alias> <model-id> [--provider <provider>]
  ahub auth set deepseek
  ahub auth status
  ahub auth remove deepseek
  ahub agent list
  ahub agent set <agent> <cli|model> <value>
  ahub command list
  ahub command set </command> <model:name|profile:name|cli:name>
  ahub shortcut list
  ahub shortcut set </name> [--model ds4f|native] [--context brief|related|full|fresh] [--role architect|coder|reviewer]
  ahub shortcut remove </name>
  ahub install <claude|codex|all>
  ahub init
  ahub doctor
  ahub session create <name>
  ahub session list
  ahub session show <name-or-id>
  ahub task add <session> <title>
  ahub task list <session>
  ahub task done <session> <task-id>
  ahub run <runtime> <session> <task> [--context task|summary|session|full]
  ahub demo

Runtimes: claude, codex, mock`;

function flag(args, name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function withoutFlags(args, recognized = []) {
  const names = new Set(recognized);
  const result = [];
  for (let index = 0; index < args.length; index += 1) {
    if (names.has(args[index])) index += 1;
    else result.push(args[index]);
  }
  return result;
}

function short(id) { return id.slice(0, 8); }

function redact(value, secret) {
  if (!secret || typeof value !== "string") return value;
  return value.split(secret).join("[REDACTED]");
}

async function connectDeepSeek(root, prompts, t, options = {}) {
  section(t("connectDeepseek"), t("connectDeepseekSub"));
  hint(t("credentialScopeHint"));
  while (true) {
    const apiKey = options.readSecret ? await options.readSecret("deepseek") : prompts.password ? await prompts.password("DeepSeek API key") : await readHidden("DeepSeek API key: ");
    const progress = spinner(t("validatingKey"));
    const validate = options.validateCredential ?? validateDeepSeekCredential;
    const result = await validate(apiKey, options.deepseekValidation);
    if (!result.ok) {
      progress.fail(t(result.reason === "invalid-key" ? "invalidKey" : "validationFailed"));
      warning(t(result.reason === "invalid-key" ? "invalidKeyHelp" : "validationFailedHelp"));
      if (!prompts.interactive) throw new Error(t(result.reason === "invalid-key" ? "invalidKeyHelp" : "validationFailedHelp"));
      const action = await prompts.select(t("connectionNotSaved"), [
        { name: t("retryKey"), value: "retry" },
        { name: t("back"), value: "back" },
      ]);
      if (action === "back") return false;
      continue;
    }
    progress.succeed(t("connectionVerified"));
    await setProviderSecret(root, "deepseek", apiKey, { scope: "ahub", credentialHome: options.credentialHome, verifiedAt: new Date().toISOString() });
    success(t("deepseekReadyEverywhere"));
    hint(t("globalKeyHint"));
    return true;
  }
}

async function ensureModelReady(root, model, prompts, t, options = {}) {
  if (model !== "ds4f") return true;
  if (await getProviderSecret(root, "deepseek", options)) return true;
  const action = await prompts.select(t("deepseekNotConnected"), [
    { name: t("connectNow"), value: "connect" },
    { name: t("chooseAnotherModel"), value: "back" },
  ]);
  if (action === "back") return false;
  return connectDeepSeek(root, prompts, t, options);
}

async function chooseLanguage(root, prompts, force = false) {
  const config = await loadConfig(root);
  if (!force && config.ui?.language) return config.ui.language;
  const fallback = inferLanguage();
  const language = prompts.interactive
    ? await prompts.select("选择界面语言 / Select interface language", [
      { name: `${fallback === "zh-CN" ? "●" : " "} 中文（简体）`, value: "zh-CN" },
      { name: `${fallback === "en" ? "●" : " "} English`, value: "en" },
    ])
    : fallback;
  config.ui = { ...config.ui, language };
  await saveConfig(root, config);
  return language;
}

async function showConfig(root, config, t = translator(config.ui?.language ?? inferLanguage()), options = {}) {
  const deepseekReady = Boolean(await getProviderSecret(root, "deepseek", options));
  section(t("currentSetup"), t("currentSetupSub"));
  console.log(`\n${t("agents")}`);
  for (const [name, agent] of Object.entries(config.agents)) {
    const model = agent.model ?? "inherit";
    const readiness = model === "ds4f" ? (deepseekReady ? t("readyShort") : t("blockedShort")) : t("readyShort");
    console.log(`  ${name.padEnd(11)} ${agent.cli ?? agent.runtime} · ${model} · ${readiness}`);
  }
  console.log(`\n${t("models")}`);
  console.log(`  inherit     ${t("inheritRow")}`);
  for (const [name, model] of Object.entries(config.models)) {
    const readiness = model.provider === "deepseek" ? (deepseekReady ? t("readyShort") : t("blockedShort")) : t("readyShort");
    console.log(`  ${name.padEnd(11)} ${model.provider ?? "CLI provider"} · ${model.model} · ${readiness}`);
  }
}

async function configure(root, options = {}) {
  if (!(await exists(paths(root).state))) await init(root);
  const prompts = options.prompts ?? createPrompts();
  const config = await loadConfig(root);
  const t = translator(config.ui?.language ?? inferLanguage());
  const action = options.initialAction ?? await prompts.select(t("settings"), [
    { name: t("agentsChoice"), value: "agent" },
    { name: t("modelsChoice"), value: "models" },
    { name: t("viewConfig"), value: "show" },
    { name: t("back"), value: "back" },
  ]);
  if (action === "back") return;
  if (action === "show") return showConfig(root, config, t, options);
  let modelAction = action;
  if (action === "models") {
    modelAction = await prompts.select(t("modelsCredentials"), [
      { name: t("deepseekChoice"), value: "deepseek" },
      { name: t("customModel"), value: "custom" },
      { name: t("viewModels"), value: "show-models" },
      { name: t("back"), value: "back" },
    ]);
  }
  if (modelAction === "back") return;
  if (modelAction === "show-models") return showConfig(root, config, t, options);
  if (modelAction === "custom") {
    const alias = await prompts.ask(t("modelAlias"));
    const modelId = await prompts.ask(t("modelId"));
    if (!alias || alias === "inherit" || !/^[a-z0-9][a-z0-9_-]*$/iu.test(alias)) throw new Error("model name must use letters, numbers, hyphens, or underscores");
    if (!modelId) throw new Error("model ID cannot be empty");
    config.models[alias] = { model: modelId };
    await saveConfig(root, config);
    success(`${t("modelSaved")} ${alias} → ${modelId}`);
    hint(t("assignHint"));
    return;
  }
  if (modelAction === "deepseek") {
    const credential = await getProviderCredential(root, "deepseek", options);
    let credentialAction = await prompts.select("DeepSeek", [
      { name: credential ? t("deepseekConnected", { scope: t(credential.scope === "ahub" ? "ahubScope" : "projectScope") }) : t("connectDeepseek"), value: credential ? "status" : "set" },
      ...(credential ? [{ name: t("replaceKey"), value: "set" }, { name: t("removeKey"), value: "remove" }] : []),
      ...(credential ? [{ name: t("assignDeepseek"), value: "agent" }] : []),
      { name: t("back"), value: "back" },
    ]);
    if (credentialAction === "back") return;
    if (credentialAction === "status") {
      success(t("deepseekReadyEverywhere"));
      hint(t("globalKeyHint"));
      return;
    }
    if (credentialAction === "set") {
      if (!await connectDeepSeek(root, prompts, t, options)) return;
      credentialAction = await prompts.select(t("whatNext"), [
        { name: t("assignDeepseek"), value: "agent" },
        { name: t("done"), value: "done" },
      ]);
      if (credentialAction === "done") return;
    }
    if (credentialAction === "remove") {
      await removeProviderSecret(root, "deepseek", { scope: credential.scope, credentialHome: options.credentialHome });
      success(t("keyRemoved"));
      return;
    }
  }
  const agentName = await prompts.select(t("whichAgent"), Object.keys(config.agents).map((name) => ({ label: name, value: name })));
  const cli = await prompts.select(t("whichCli"), [
    { label: "Claude Code", value: "claude" },
    { label: "Codex", value: "codex" },
  ]);
  const model = await prompts.select(t("whichModel"), [
    { label: t("inheritModel", { cli: cli === "claude" ? "Claude Code" : "Codex" }), value: "inherit" },
    ...Object.entries(config.models).map(([name, item]) => ({
      label: `${name === "ds4f" ? "DeepSeek V4 Flash" : name} · ${item.model}${item.provider ? ` via ${item.provider}` : ""}`,
      value: name,
    })),
  ]);
  if (!await ensureModelReady(root, model, prompts, t, options)) return;
  config.agents[agentName].cli = cli;
  config.agents[agentName].model = model;
  delete config.agents[agentName].runtime;
  await saveConfig(root, config);
  success(`${agentName} → ${cli === "claude" ? "Claude Code" : "Codex"} · ${model === "inherit" ? "CLI's own model" : model}`);
}

async function installPlugin(target, options = {}) {
  const packageRoot = options.packageRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const { spawnSync } = await import("node:child_process");
  const execute = (command, args, missingName) => {
    const result = spawnSync(command, args, { encoding: "utf8" });
    if (result.error?.code === "ENOENT") throw new Error(`${missingName} CLI was not found. Install it and try again.`);
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status !== 0 && !output.match(/already|exists|configured|installed/i)) throw new Error(output.trim() || `could not configure ${missingName}`);
    return output;
  };
  if (target === "claude") {
    execute("claude", ["plugin", "marketplace", "add", packageRoot], "Claude Code");
    const current = execute("claude", ["plugin", "list", "--json"], "Claude Code");
    let installed = current.includes("ahub@ahub");
    try { installed = JSON.parse(current).some((item) => item.id === "ahub@ahub"); } catch {}
    if (installed) execute("claude", ["plugin", "uninstall", "ahub@ahub", "--scope", "user"], "Claude Code");
    execute("claude", ["plugin", "install", "ahub@ahub", "--scope", "user"], "Claude Code");
    if (!options.silent) console.log("✓ Claude Code plugin installed. Start a new session or run `/reload-plugins` in Claude Code.");
    return;
  }
  if (target === "codex") {
    const installed = execute("codex", ["plugin", "list", "--json"], "Codex");
    if (installed.includes("ahub@ahub-local")) execute("codex", ["plugin", "remove", "ahub@ahub-local"], "Codex");
    execute("codex", ["plugin", "marketplace", "add", packageRoot], "Codex");
    execute("codex", ["plugin", "add", "ahub@ahub"], "Codex");
    if (!options.silent) console.log("✓ Codex plugin installed. Start a new Codex task, then type `@ahub-`.");
    return;
  }
  throw new Error("install target must be claude, codex, or all");
}

async function inspectPlugin(command, args, id, available) {
  if (!available) return "CLI not found";
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) return "status unavailable";
  try {
    const value = JSON.parse(result.stdout);
    const installed = Array.isArray(value) ? value.some((item) => item.id === id || item.pluginId === id || item.name === "ahub") : value.installed?.some((item) => item.pluginId === id || item.name === "ahub");
    return installed ? "installed" : "not installed";
  } catch {
    return result.stdout.includes("ahub") ? "installed" : "not installed";
  }
}

async function getSystemStatus(root) {
  const [claudeVersion, codexVersion] = await Promise.all([commandVersion("claude"), commandVersion("codex")]);
  const [claudePlugin, codexPlugin, deepseek] = await Promise.all([
    inspectPlugin("claude", ["plugin", "list", "--json"], "ahub@ahub", claudeVersion),
    inspectPlugin("codex", ["plugin", "list", "--json"], "ahub@ahub", codexVersion),
    getProviderCredential(root, "deepseek"),
  ]);
  const config = await loadConfig(root);
  const deepseekRequired = Object.values(config.agents).some((agent) => agent.model === "ds4f");
  return { claudeVersion, codexVersion, claudePlugin, codexPlugin, deepseek: Boolean(deepseek), deepseekScope: deepseek?.scope, deepseekVerified: Boolean(deepseek?.verifiedAt), deepseekRequired };
}

async function pluginStatus(root, t = translator(inferLanguage())) {
  const status = await getSystemStatus(root);
  const marks = { ready: t("ready"), needsSetup: t("needsSetup"), unavailable: t("unavailable") };
  section(t("systemStatus"), t("systemStatusSub"));
  console.log(`\n  Claude Code  ${statusMark(status.claudeVersion ? status.claudePlugin : undefined, marks)}  ${status.claudeVersion ?? t("notFound")}`);
  console.log(`  Codex        ${statusMark(status.codexVersion ? status.codexPlugin : undefined, marks)}  ${status.codexVersion ?? t("notFound")}`);
  console.log(`  DeepSeek     ${statusMark(status.deepseek ? true : status.deepseekRequired ? false : undefined, marks)}  ${status.deepseek ? t(status.deepseekVerified ? "connectionVerified" : "keyNotVerified") : status.deepseekRequired ? t("keyRequired") : t("optional")}`);
  if (status.claudePlugin !== "installed" && status.codexPlugin !== "installed") hint(t("installHint"));
  return status;
}

const BUILTIN_SHORTCUTS = new Set(["/ds", "/native", "/brief", "/related", "/full", "/fresh", "/analyze", "/code", "/review"]);

function shortcutSummary(preset) {
  return Object.entries(preset).map(([key, value]) => `${key === "contextMode" ? "context" : key}:${value}`).join(" · ");
}

async function configureShortcuts(root, prompts, t) {
  const config = await loadConfig(root);
  const custom = Object.entries(config.shortcuts).filter(([name]) => !BUILTIN_SHORTCUTS.has(name));
  section(t("shortcutsTitle"), t("shortcutsSub"));
  const action = await prompts.select(t("shortcutsTitle"), [
    { name: t("shortcutCreate"), value: "create" },
    { name: t("shortcutView"), value: "view" },
    ...(custom.length ? [{ name: t("shortcutRemove"), value: "remove" }] : []),
    { name: t("back"), value: "back" },
  ]);
  if (action === "back") return;
  if (action === "view") {
    if (!custom.length) return warning(t("noShortcuts"));
    for (const [name, preset] of custom) console.log(`  ${name.padEnd(18)} ${shortcutSummary(preset)}`);
    return;
  }
  if (action === "remove") {
    const name = await prompts.select(t("chooseShortcutRemove"), custom.map(([shortcut, preset]) => ({ name: `${shortcut}  ${shortcutSummary(preset)}`, value: shortcut })));
    delete config.shortcuts[name];
    await saveConfig(root, config);
    success(`${t("shortcutRemoved")} ${name}`);
    return;
  }
  let name = (await prompts.ask(t("shortcutName"))).trim();
  if (name && !name.startsWith("/")) name = `/${name}`;
  if (!/^\/[\p{L}\p{N}_-]+$/u.test(name)) throw new Error("shortcut name must contain only letters, numbers, hyphens, or underscores");
  const model = await prompts.select(t("shortcutModel"), [
    { name: "DeepSeek V4 Flash", value: "ds4f" },
    { name: t("noOverride"), value: undefined },
    { name: "Host / Native", value: "native" },
  ]);
  const contextMode = await prompts.select(t("shortcutContext"), [
    { name: t("contextRelated"), value: "related" },
    { name: t("contextBrief"), value: "brief" },
    { name: t("contextFresh"), value: "fresh" },
    { name: t("contextFull"), value: "full" },
    { name: t("noOverride"), value: undefined },
  ]);
  const role = await prompts.select(t("shortcutRole"), [
    { name: t("roleGeneral"), value: undefined },
    { name: t("architect"), value: "architect" },
    { name: t("coder"), value: "coder" },
    { name: t("reviewer"), value: "reviewer" },
  ]);
  config.shortcuts[name] = {
    ...(model ? { model } : {}),
    ...(contextMode ? { contextMode } : {}),
    ...(role ? { role } : {}),
  };
  await saveConfig(root, config);
  success(`${t("shortcutSaved")} ${name} → ${shortcutSummary(config.shortcuts[name])}`);
  hint(`@ahub ${name} …`);
}

async function controlCenter(root, options = {}) {
  const prompts = options.prompts ?? createPrompts();
  const repeat = options.loop ?? prompts.interactive === true;
  do {
    const config = await loadConfig(root);
    const t = translator(config.ui?.language ?? inferLanguage());
    const action = await prompts.select(t("controlCenter"), [
      { name: t("runAgent"), value: "run" },
      { name: t("agentSettings"), value: "agents" },
      { name: t("modelSettings"), value: "models" },
      { name: t("shortcutSettings"), value: "shortcuts" },
      { name: t("install"), value: "install" },
      { name: t("statusDoctor"), value: "status" },
      { name: t("language"), value: "language" },
      { name: t("exit"), value: "exit" },
    ]);
    if (action === "exit") return;
    if (action === "language") {
      const language = await chooseLanguage(root, prompts, true);
      success(translator(language)("languageSaved"));
      continue;
    }
    if (action === "agents") await configure(root, { ...options, prompts, initialAction: "agent" });
    if (action === "models") await configure(root, { ...options, prompts, initialAction: "models" });
    if (action === "shortcuts") await configureShortcuts(root, prompts, t);
    if (action === "status") {
      showConfig(root, await loadConfig(root), t, options);
      await pluginStatus(root, t);
    }
    if (action === "install") {
      const status = await getSystemStatus(root);
      const choices = [];
      if (status.claudeVersion) choices.push({ name: `Claude Code  ${status.claudePlugin === "installed" ? t("refresh") : ""}`, value: "claude", checked: status.claudePlugin !== "installed" });
      if (status.codexVersion) choices.push({ name: `Codex        ${status.codexPlugin === "installed" ? t("refresh") : ""}`, value: "codex", checked: status.codexPlugin !== "installed" });
      if (!choices.length) throw new Error("Claude Code and Codex CLIs were not found.");
      const targets = prompts.checkbox ? await prompts.checkbox(t("selectIntegrations"), choices) : [await prompts.select(t("selectIntegrations"), choices)];
      if (!await (prompts.confirm?.(t("installConfirm", { targets: targets.join(" + ") }), true) ?? true)) continue;
      for (const target of targets) {
        const targetName = target === "claude" ? "Claude Code" : "Codex";
        const progress = spinner(t("installing", { target: targetName }));
        try { await installPlugin(target, { ...options, silent: true }); progress.succeed(t("integrationReady", { target: targetName })); }
        catch (error) { progress.fail(t("installFailed")); throw error; }
      }
    }
    if (action === "run") {
      if (!(await exists(paths(root).state))) await init(root);
      const agent = await prompts.select(t("chooseAgent"), [
        { label: t("coder"), value: "coder" },
        { label: t("architect"), value: "architect" },
        { label: t("reviewer"), value: "reviewer" },
        { label: t("back"), value: "back" },
      ]);
      if (agent === "back") continue;
      const route = await prompts.select(t("runWith"), [
        { label: t("agentDefaults"), value: {} },
        { label: t("cliOwnModel", { cli: "Claude Code" }), value: { cli: "claude", model: "inherit" } },
        { label: t("cliOwnModel", { cli: "Codex" }), value: { cli: "codex", model: "inherit" } },
        { label: "Claude Code · DeepSeek V4 Flash", value: { cli: "claude", model: "ds4f" } },
        { label: "Codex · DeepSeek V4 Flash", value: { cli: "codex", model: "ds4f" } },
      ]);
      if (!await ensureModelReady(root, route.model, prompts, t, options)) continue;
      const task = await prompts.ask(t("describeTask"));
      if (!task) { warning(t("emptyTask")); continue; }
      const args = ["ask", agent];
      if (route.cli) args.push("--cli", route.cli);
      if (route.model) args.push("--model", route.model);
      args.push("--", task);
      await main(args, { ...options, root, interactive: false });
    }
  } while (repeat);
}

async function onboarding(root, config, available, options = {}) {
  const prompts = options.prompts ?? createPrompts();
  const language = await chooseLanguage(root, prompts);
  config = await loadConfig(root);
  const t = translator(language);
  if (!options.quietUi) {
    clearScreen();
    banner("0.3.0", t("tagline"));
    section(t("quick1"), t("quick1Sub"));
  }
  const choices = [];
  if (available.claude) choices.push({ label: "Claude Code", value: "claude" });
  if (available.codex) choices.push({ label: "Codex", value: "codex" });
  if (!choices.length) return;
  const cli = choices.length === 1 ? choices[0].value : await prompts.select(t("defaultCli"), choices);
  if (!options.quietUi) section(t("quick2"), t("quick2Sub"));
  const model = await prompts.select(t("defaultModel"), [
    { label: t("inheritModel", { cli: cli === "claude" ? "Claude Code" : "Codex" }), value: "inherit" },
    { label: t("deepseekLowCost"), value: "ds4f" },
  ]);
  for (const agent of Object.values(config.agents)) {
    agent.cli = cli;
    agent.model = model;
    delete agent.runtime;
  }
  await saveConfig(root, config);
  if (!await ensureModelReady(root, model, prompts, t, options)) {
    for (const agent of Object.values(config.agents)) agent.model = "inherit";
    await saveConfig(root, config);
  }
  if (!options.quietUi) {
    section(t("quick3"), t("quick3Sub"));
    const cliName = cli === "claude" ? "Claude Code" : "Codex";
    const shouldInstall = prompts.confirm ? await prompts.confirm(t("installNow", { cli: cliName }), true) : false;
    if (shouldInstall) {
      const progress = spinner(t("installingIntegration"));
      try { await installPlugin(cli, { ...options, silent: true }); progress.succeed(t("integrationReady", { target: cliName })); }
      catch (error) { progress.fail(t("couldNotInstall")); warning(error.message); }
    }
    success(t("setupComplete"));
    hint(t("changeAnytime"));
  }
}

async function init(root) {
  if (await migrateLegacyState(root)) {
    console.log(`Migrated .agenthub to ${paths(root).dir}`);
    return;
  }
  const target = paths(root);
  if (await exists(target.state)) {
    console.log(`Already initialized: ${target.dir}`);
    return;
  }
  await mkdir(target.dir, { recursive: true });
  await saveState(root, emptyState());
  await saveConfig(root, DEFAULT_CONFIG);
  await writeFile(resolve(target.dir, ".gitignore"), "state.json\nsecrets.json\n*.tmp\n");
  console.log(`Initialized ahub in ${target.dir}`);
}

async function createSession(root, name) {
  if (!name) throw new Error("session name is required");
  const session = { id: crypto.randomUUID(), name, workspace: root, createdAt: new Date().toISOString(), tasks: [], runs: [] };
  await mutate(root, "SessionCreated", { sessionId: session.id, name }, (state) => {
    if (state.sessions.some((item) => item.name === name)) throw new Error(`session already exists: ${name}`);
    state.sessions.push(session);
  });
  console.log(`Created session ${name} (${short(session.id)})`);
  return session;
}

async function getOrCreateSession(root, name) {
  let state = await loadState(root);
  const existing = state.sessions.find((item) => item.name === name);
  if (existing) return existing;
  try {
    return await createSession(root, name);
  } catch (error) {
    if (!error.message.startsWith("session already exists:")) throw error;
    state = await loadState(root);
    const concurrent = state.sessions.find((item) => item.name === name);
    if (!concurrent) throw error;
    return concurrent;
  }
}

async function run(root, runtime, sessionName, task, mode, runtimeOptions = {}, agentName) {
  if (!runtime || !sessionName || !task) throw new Error("run requires <runtime> <session> <task>");
  if ((runtime === "deepseek" || runtimeOptions.provider === "deepseek") && !runtimeOptions.apiKey) {
    runtimeOptions = { ...runtimeOptions, apiKey: await getProviderSecret(root, "deepseek") };
  }
  const state = await loadState(root);
  const session = findSession(state, sessionName);
  const context = compileContext(session, task, mode);
  const record = { id: crypto.randomUUID(), runtime, provider: runtimeOptions.provider, agent: agentName, model: runtimeOptions.model, permissionMode: runtimeOptions.permissionMode, sandbox: runtimeOptions.sandbox, task, context: context.manifest, baseRevision: state.revision, status: "running", startedAt: new Date().toISOString() };
  await mutate(root, "AgentRunStarted", { sessionId: session.id, runId: record.id, runtime }, (next) => findSession(next, session.id).runs.push(record));
  console.log(`Running ${runtime} for ${session.name} (${short(record.id)})...`);
  try {
    const result = await runRuntime(runtime, context.prompt, { cwd: session.workspace, ...runtimeOptions });
    result.output = redact(result.output, runtimeOptions.apiKey);
    await mutate(root, "AgentRunCompleted", { sessionId: session.id, runId: record.id }, (next) => {
      Object.assign(findSession(next, session.id).runs.find((item) => item.id === record.id), result, { status: "completed", completedAt: new Date().toISOString() });
    });
    console.log(`\n${result.output}`);
  } catch (error) {
    const safeMessage = redact(error.message, runtimeOptions.apiKey);
    await mutate(root, "AgentRunFailed", { sessionId: session.id, runId: record.id, error: safeMessage }, (next) => {
      Object.assign(findSession(next, session.id).runs.find((item) => item.id === record.id), { status: "failed", error: safeMessage, completedAt: new Date().toISOString() });
    });
    throw new Error(safeMessage);
  }
}

export async function main(argv, options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const [command, subcommand, ...rest] = argv;
  const interactive = options.interactive ?? (Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY));
  if (!command) {
    if (!interactive) return console.log(HELP);
    if (!(await exists(paths(root).state))) await main(["setup"], { ...options, root, interactive: true });
    const config = await loadConfig(root);
    const t = translator(config.ui?.language ?? inferLanguage());
    if (!options.quietUi) {
      clearScreen();
      banner("0.3.0", t("tagline"));
      hint(`${t("project")}  ${root}`);
    }
    return controlCenter(root, options);
  }
  if (command === "help" || command === "--help" || command === "-h") return console.log(subcommand === "--all" ? FULL_HELP : HELP);
  if (command === "setup") {
    const firstSetup = !(await exists(paths(root).state));
    if (firstSetup) await init(root);
    else if (await migrateLegacyState(root)) console.log("Migrated existing data.");
    const config = await loadConfig(root);
    const [claude, codex] = await Promise.all([commandVersion("claude"), commandVersion("codex")]);
    const onlyAvailableCli = claude && !codex ? "claude" : codex && !claude ? "codex" : undefined;
    if (firstSetup && interactive) await onboarding(root, config, { claude, codex }, options);
    else if (firstSetup && onlyAvailableCli) await onboarding(root, config, { claude, codex }, { ...options, prompts: { select: async (_message, choices) => choices[0].value } });
    console.log("\nahub is ready.\n");
    if (onlyAvailableCli && firstSetup) console.log(`  Using ${onlyAvailableCli} for every agent (the other CLI was not found).\n`);
    const configuredCli = (name) => config.agents[name].cli ?? config.agents[name].runtime;
    const cliReady = (cli) => cli === "claude" ? claude : cli === "codex" ? codex : true;
    for (const name of ["architect", "coder", "reviewer"]) {
      const cli = configuredCli(name);
      console.log(`  ${name.padEnd(11)} ${cli}${cliReady(cli) ? " ✓" : " (CLI missing)"}`);
    }
    console.log("\nTry: ahub ask coder \"inspect this project\"");
    return;
  }
  if (command === "ask") {
    if (!(await exists(paths(root).state))) await init(root);
    const config = await loadConfig(root);
    const agentName = subcommand;
    const agent = resolveAgent(config, agentName);
    const separator = rest.indexOf("--");
    const optionArgs = separator === -1 ? rest : rest.slice(0, separator);
    const requestedTask = (separator === -1 ? withoutFlags(rest, ["--cli", "--model"]) : rest.slice(separator + 1)).join(" ");
    if (!requestedTask) throw new Error("ask requires an agent and task");
    const selection = resolveProfileCommand(config, requestedTask);
    if (!selection.task) throw new Error(`${selection.commands.join(" ")} requires a task`);
    const task = selection.task;
    const session = await getOrCreateSession(root, config.defaultSession);
    const requestedCli = flag(optionArgs, "--cli", undefined);
    if (requestedCli && !["claude", "codex", "mock"].includes(requestedCli)) throw new Error("CLI must be claude or codex");
    const runtime = requestedCli ?? selection.cli ?? selection.profile?.runtime ?? agent.cli ?? agent.runtime;
    const runtimeConfig = config.runtimes[runtime] ?? {};
    const accessConfig = agent.access === "read-only"
      ? { permissionMode: "plan", sandbox: "read-only" }
      : {};
    const prompt = `${agent.instructions}\n\n${task}`;
    const requestedModel = flag(optionArgs, "--model", undefined);
    const configuredModel = requestedModel !== undefined
      ? resolveConfiguredModel(config, requestedModel)
      : selection.model ?? resolveConfiguredModel(config, agent.model) ?? resolveConfiguredModel(config, runtimeConfig.model);
    const runtimeOptions = { ...runtimeConfig, ...selection.profile, ...configuredModel, ...accessConfig };
    delete runtimeOptions.cli;
    if (requestedModel === "inherit" || runtimeOptions.model === "inherit") {
      delete runtimeOptions.model;
      delete runtimeOptions.provider;
      delete runtimeOptions.baseUrl;
      delete runtimeOptions.apiKey;
    }
    if (runtime !== "mock" && runtimeOptions.provider === "deepseek" && !await getProviderSecret(root, "deepseek", options)) {
      const configLanguage = config.ui?.language ?? inferLanguage();
      const t = translator(configLanguage);
      throw new Error(`${t("deepseekNotConnectedShort")} ${t("runAhubToConnect")}`);
    }
    if (runtime !== "mock" && runtimeOptions.provider === "deepseek") runtimeOptions.apiKey = await getProviderSecret(root, "deepseek", options);
    if (selection.commands.length || requestedCli || requestedModel !== undefined) console.log(`Using request settings: ${runtime} CLI / ${runtimeOptions.provider ?? "CLI config"} / ${runtimeOptions.model ?? "inherit"}`);
    return run(root, runtime, session.name, prompt, agent.fresh ? "task" : agent.context ?? config.defaultContext, runtimeOptions, agentName);
  }
  if (command === "status") {
    if (!(await exists(paths(root).state))) throw new Error("not initialized; run `ahub setup`");
    const state = await loadState(root);
    if (!state.sessions.length) return console.log("No work yet. Try: ahub ask coder \"inspect this project\"");
    for (const session of state.sessions) {
      const last = session.runs.at(-1);
      console.log(`${session.name}: ${session.tasks.filter((item) => item.status !== "done").length} open tasks, ${session.runs.length} runs${last ? `, last ${last.agent ?? last.runtime} ${last.status}` : ""}`);
    }
    return;
  }
  if (command === "config") {
    if (subcommand !== "--show" && interactive) return configure(root, options);
    const config = await loadConfig(root);
    await showConfig(root, config, translator(config.ui?.language ?? inferLanguage()), options);
    return;
  }
  if (command === "model" && subcommand === "list") {
    const config = await loadConfig(root);
    console.log("Alias       Provider     Model ID");
    console.log(`${"inherit".padEnd(11)} ${"CLI config".padEnd(12)} (no override)`);
    for (const [name, model] of Object.entries(config.models)) console.log(`${name.padEnd(11)} ${(model.provider ?? "CLI config").padEnd(12)} ${model.model}`);
    return;
  }
  if (command === "model" && subcommand === "set") {
    if (!(await exists(paths(root).state))) await init(root);
    const positional = withoutFlags(rest, ["--provider"]);
    const [name, modelId] = positional;
    if (!name || !modelId || name === "inherit") throw new Error("usage: ahub model set <alias> <model-id> [--provider <provider>]");
    const config = await loadConfig(root);
    const provider = flag(rest, "--provider", undefined);
    if (provider && provider !== "deepseek") throw new Error("unsupported provider. Currently supported: deepseek. Omit --provider to use the selected CLI's own provider configuration.");
    config.models[name] = { ...(provider ? { provider } : {}), model: modelId };
    await saveConfig(root, config);
    console.log(`Saved model ${name} → ${provider ? `${provider} / ` : ""}${modelId}`);
    return;
  }
  if (command === "auth" && subcommand === "set") {
    if (!(await exists(paths(root).state))) await init(root);
    const provider = rest[0];
    if (provider !== "deepseek") throw new Error("usage: ahub auth set deepseek");
    const prompts = options.prompts ?? createPrompts();
    const config = await loadConfig(root);
    await connectDeepSeek(root, prompts, translator(config.ui?.language ?? inferLanguage()), options);
    return;
  }
  if (command === "auth" && subcommand === "status") {
    const credential = await getProviderCredential(root, "deepseek", options);
    console.log(`DeepSeek: ${credential?.apiKey ? `configured (${credential.scope === "ahub" ? "all ahub projects" : "this project"})${credential.verifiedAt ? ", verified" : ", not verified"}` : "not configured"}`);
    return;
  }
  if (command === "auth" && subcommand === "remove") {
    const provider = rest[0];
    if (provider !== "deepseek") throw new Error("usage: ahub auth remove deepseek");
    const credential = await getProviderCredential(root, provider, options);
    const removed = credential ? await removeProviderSecret(root, provider, { scope: credential.scope, credentialHome: options.credentialHome }) : false;
    console.log(removed ? "Removed DeepSeek credentials from this project." : "DeepSeek credentials were not configured for this project.");
    return;
  }
  if (command === "agent" && subcommand === "list") {
    const config = await loadConfig(root);
    console.log("Agent       CLI       Model       Access");
    for (const [name, agent] of Object.entries(config.agents)) console.log(`${name.padEnd(11)} ${(agent.cli ?? agent.runtime).padEnd(9)} ${(agent.model ?? "inherit").padEnd(11)} ${agent.access ?? "default"}`);
    return;
  }
  if (command === "agent" && subcommand === "set") {
    if (!(await exists(paths(root).state))) await init(root);
    const [name, field, value] = rest;
    const config = await loadConfig(root);
    if (!config.agents[name]) throw new Error(`unknown agent: ${name}`);
    if (field === "cli") {
      if (!["claude", "codex"].includes(value)) throw new Error("CLI must be claude or codex");
      config.agents[name].cli = value;
      delete config.agents[name].runtime;
    } else if (field === "model") {
      if (!value) throw new Error("model value is required");
      if (value !== "inherit" && !config.models[value]) throw new Error(`unknown model alias: ${value}. Try: inherit, ${Object.keys(config.models).join(", ")}. Add one with \`ahub model set <alias> <model-id>\`.`);
      if (config.models[value]?.provider === "deepseek" && !await getProviderSecret(root, "deepseek", options)) {
        const t = translator(config.ui?.language ?? inferLanguage());
        throw new Error(`${t("deepseekNotConnectedShort")} ${t("runAhubToConnect")}`);
      }
      config.agents[name].model = value;
    } else throw new Error("field must be cli or model");
    await saveConfig(root, config);
    console.log(`Saved ${name}.${field} → ${value}`);
    return;
  }
  if (command === "command" && subcommand === "list") {
    const config = await loadConfig(root);
    for (const [shortcut, profile] of Object.entries(config.commands)) console.log(`${shortcut.padEnd(12)} ${profile}`);
    return;
  }
  if (command === "command" && subcommand === "set") {
    if (!(await exists(paths(root).state))) await init(root);
    const [shortcut, rawTarget] = rest;
    if (!shortcut?.startsWith("/") || !rawTarget) throw new Error("usage: ahub command set </command> <model:name|profile:name|cli:name>");
    const config = await loadConfig(root);
    const target = rawTarget.includes(":") ? rawTarget : `profile:${rawTarget}`;
    const [kind, value] = target.split(":", 2);
    if (kind === "profile" && !config.profiles[value]) throw new Error(`unknown profile: ${value}. Try: ${Object.keys(config.profiles).join(", ")}`);
    if (kind === "model" && !config.models[value]) throw new Error(`unknown model: ${value}. Try: inherit, ${Object.keys(config.models).join(", ")}`);
    if (kind === "cli" && !["claude", "codex"].includes(value)) throw new Error("CLI must be claude or codex");
    if (!["model", "profile", "cli"].includes(kind)) throw new Error("target must start with model:, profile:, or cli:");
    config.commands[shortcut] = target;
    await saveConfig(root, config);
    console.log(`Saved ${shortcut} → ${target}`);
    return;
  }
  if (command === "shortcut" && subcommand === "list") {
    const config = await loadConfig(root);
    for (const [name, preset] of Object.entries(config.shortcuts)) {
      console.log(`${name.padEnd(14)} ${Object.entries(preset).map(([key, value]) => `${key}:${value}`).join(" · ")}`);
    }
    return;
  }
  if (command === "shortcut" && subcommand === "set") {
    if (!(await exists(paths(root).state))) await init(root);
    const name = rest[0];
    if (!name?.startsWith("/") || !/^\/[\p{L}\p{N}_-]+$/u.test(name)) throw new Error("shortcut name must start with / and contain letters, numbers, hyphens, or underscores");
    const preset = {
      ...(flag(rest, "--model", undefined) ? { model: flag(rest, "--model") } : {}),
      ...(flag(rest, "--context", undefined) ? { contextMode: flag(rest, "--context") } : {}),
      ...(flag(rest, "--role", undefined) ? { role: flag(rest, "--role") } : {}),
    };
    if (!Object.keys(preset).length) throw new Error("choose at least one of --model, --context, or --role");
    if (preset.model && !["ds4f", "native"].includes(preset.model)) throw new Error("model must be ds4f or native");
    if (preset.contextMode && !["brief", "related", "full", "fresh"].includes(preset.contextMode)) throw new Error("context must be brief, related, full, or fresh");
    if (preset.role && !["architect", "coder", "reviewer"].includes(preset.role)) throw new Error("role must be architect, coder, or reviewer");
    const config = await loadConfig(root);
    config.shortcuts[name] = preset;
    await saveConfig(root, config);
    console.log(`Saved ${name} → ${Object.entries(preset).map(([key, value]) => `${key}:${value}`).join(" · ")}`);
    return;
  }
  if (command === "shortcut" && subcommand === "remove") {
    const name = rest[0];
    const config = await loadConfig(root);
    if (!config.shortcuts[name]) throw new Error(`unknown shortcut: ${name}`);
    delete config.shortcuts[name];
    await saveConfig(root, config);
    console.log(`Removed ${name}`);
    return;
  }
  if (command === "install") {
    if (!['claude', 'codex', 'all'].includes(subcommand)) throw new Error("usage: ahub install <claude|codex|all>");
    if (subcommand === "all") {
      await installPlugin("claude", options);
      await installPlugin("codex", options);
    } else await installPlugin(subcommand, options);
    return;
  }
  if (command === "init") return init(root);
  if (command === "doctor") {
    const [claude, codex] = await Promise.all([commandVersion("claude"), commandVersion("codex")]);
    section("ahub doctor", "Runtime and project health");
    console.log(`\n  Node         ${statusMark(true)}  ${process.version}`);
    console.log(`  Claude Code  ${statusMark(Boolean(claude))}  ${claude ?? "not found"}`);
    console.log(`  Codex        ${statusMark(Boolean(codex))}  ${codex ?? "not found"}`);
    console.log(`  Project      ${statusMark(await exists(paths(root).state))}  ${root}`);
    if (await exists(paths(root).state)) await pluginStatus(root);
    process.exitCode = claude || codex ? 0 : 1;
    return;
  }
  if (command === "session" && subcommand === "create") return createSession(root, rest.join(" "));
  if (command === "session" && subcommand === "list") {
    const state = await loadState(root);
    if (!state.sessions.length) return console.log("No sessions.");
    for (const session of state.sessions) console.log(`${short(session.id)}  ${session.name}  ${session.tasks.length} tasks  ${session.runs.length} runs`);
    return;
  }
  if (command === "session" && subcommand === "show") {
    const session = findSession(await loadState(root), rest.join(" "));
    console.log(JSON.stringify(session, null, 2));
    return;
  }
  if (command === "task" && subcommand === "add") {
    const [sessionName, ...titleParts] = rest;
    const title = titleParts.join(" ");
    if (!sessionName || !title) throw new Error("task add requires <session> <title>");
    const task = { id: crypto.randomUUID(), title, status: "pending", createdAt: new Date().toISOString() };
    await mutate(root, "TaskCreated", { session: sessionName, taskId: task.id }, (state) => findSession(state, sessionName).tasks.push(task));
    console.log(`Added task ${short(task.id)}: ${title}`);
    return;
  }
  if (command === "task" && subcommand === "list") {
    const session = findSession(await loadState(root), rest.join(" "));
    if (!session.tasks.length) return console.log("No tasks.");
    for (const task of session.tasks) console.log(`${short(task.id)}  ${task.status.padEnd(11)} ${task.title}`);
    return;
  }
  if (command === "task" && subcommand === "done") {
    const [sessionName, taskId] = rest;
    if (!sessionName || !taskId) throw new Error("task done requires <session> <task-id>");
    await mutate(root, "TaskCompleted", { session: sessionName, taskId }, (state) => {
      const task = findSession(state, sessionName).tasks.find((item) => item.id === taskId || item.id.startsWith(taskId));
      if (!task) throw new Error(`task not found: ${taskId}`);
      task.status = "done";
      task.completedAt = new Date().toISOString();
    });
    console.log(`Completed task ${taskId}`);
    return;
  }
  if (command === "run") {
    const config = await loadConfig(root);
    const args = withoutFlags([subcommand, ...rest], ["--context"]);
    const [runtime, sessionName, ...taskParts] = args;
    return run(root, runtime, sessionName, taskParts.join(" "), flag(argv, "--context", config.defaultContext), config.runtimes[runtime] ?? {});
  }
  if (command === "demo") {
    if (!(await exists(paths(root).state))) await init(root);
    const state = await loadState(root);
    const name = `demo-${Date.now()}`;
    await createSession(root, name);
    await run(root, "mock", name, "Design a refresh-token strategy", "task");
    await run(root, "mock", name, "Implement the previous design", "summary");
    console.log(`\nDemo complete. Inspect with: ahub session show ${name}`);
    return;
  }
  throw new Error(`unknown command\n\n${HELP}`);
}
