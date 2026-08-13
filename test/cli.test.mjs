import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { main } from "../src/cli.mjs";
import { loadState } from "../src/store.mjs";

test("offline CLI workflow persists a context handoff", async () => {
  const root = await mkdtemp(join(tmpdir(), "agenthub-cli-"));
  const log = console.log;
  console.log = () => {};
  try {
    await main(["init"], { root });
    await main(["session", "create", "auth"], { root });
    await main(["task", "add", "auth", "Fix", "refresh"], { root });
    await main(["run", "mock", "auth", "Analyze", "race", "--context", "task"], { root });
    await main(["run", "mock", "auth", "Implement", "analysis", "--context", "summary"], { root });
    let state = await loadState(root);
    const session = state.sessions[0];
    assert.equal(session.runs.length, 2);
    assert.deepEqual(session.runs[1].context.previousRunIds, [session.runs[0].id]);
    await main(["task", "done", "auth", session.tasks[0].id.slice(0, 8)], { root });
    state = await loadState(root);
    assert.equal(state.sessions[0].tasks[0].status, "done");
  } finally {
    console.log = log;
    await rm(root, { recursive: true, force: true });
  }
});

test("simple setup and ask create a default session using agent configuration", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-simple-"));
  const log = console.log;
  console.log = () => {};
  try {
    await main(["setup"], { root });
    const configPath = join(root, ".ahub", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.agents.coder.runtime = "mock";
    config.agents.coder.model = "test-model";
    await writeFile(configPath, JSON.stringify(config));
    await main(["ask", "coder", "implement", "the", "feature"], { root });
    const state = await loadState(root);
    assert.equal(state.sessions[0].name, "main");
    assert.equal(state.sessions[0].runs[0].agent, "coder");
    assert.equal(state.sessions[0].runs[0].runtime, "mock");
    assert.equal(state.sessions[0].runs[0].model, "test-model");
    assert.match(state.sessions[0].runs[0].task, /Implement the requested change/);
  } finally {
    console.log = log;
    await rm(root, { recursive: true, force: true });
  }
});

test("custom slash commands select a configured model profile", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-command-"));
  const log = console.log;
  console.log = () => {};
  try {
    await main(["setup"], { root });
    const configPath = join(root, ".ahub", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.profiles.cheap = { runtime: "mock", provider: "deepseek", model: "deepseek-v4-flash" };
    await writeFile(configPath, JSON.stringify(config));
    await main(["command", "set", "/省点", "cheap"], { root });
    await main(["ask", "coder", "/省点", "fix", "lint"], { root });
    const state = await loadState(root);
    const run = state.sessions[0].runs[0];
    assert.equal(run.runtime, "mock");
    assert.equal(run.provider, "deepseek");
    assert.equal(run.model, "deepseek-v4-flash");
    assert.doesNotMatch(run.task, /省点/);
    assert.match(run.task, /fix lint/);
  } finally {
    console.log = log;
    await rm(root, { recursive: true, force: true });
  }
});

test("custom host shortcut presets persist model, context, and role together", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-shortcut-"));
  const log = console.log;
  console.log = () => {};
  try {
    await main(["setup"], { root });
    await main(["shortcut", "set", "/省钱审查", "--model", "ds4f", "--context", "related", "--role", "reviewer"], { root });
    const config = JSON.parse(await readFile(join(root, ".ahub", "config.json"), "utf8"));
    assert.deepEqual(config.shortcuts["/省钱审查"], { model: "ds4f", contextMode: "related", role: "reviewer" });
    await main(["shortcut", "remove", "/省钱审查"], { root });
    const updated = JSON.parse(await readFile(join(root, ".ahub", "config.json"), "utf8"));
    assert.equal(updated.shortcuts["/省钱审查"], undefined);
  } finally {
    console.log = log;
    await rm(root, { recursive: true, force: true });
  }
});

test("model and terminal CLI directives compose independently", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-compose-"));
  const log = console.log;
  console.log = () => {};
  try {
    await main(["setup"], { root });
    const configPath = join(root, ".ahub", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.commands["/testcli"] = "cli:mock";
    config.models.ds4f = { provider: "test-provider", model: "deepseek-v4-flash" };
    await writeFile(configPath, JSON.stringify(config));
    await main(["ask", "coder", "/ds4f", "/testcli", "fix", "tests"], { root });
    const run = (await loadState(root)).sessions[0].runs[0];
    assert.equal(run.runtime, "mock");
    assert.equal(run.provider, "test-provider");
    assert.equal(run.model, "deepseek-v4-flash");
    assert.doesNotMatch(run.task, /ds4f|testcli/);
  } finally {
    console.log = log;
    await rm(root, { recursive: true, force: true });
  }
});

test("agent can inherit its terminal CLI model or use a persistent alias", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-model-"));
  const log = console.log;
  console.log = () => {};
  try {
    await main(["setup"], { root });
    const configPath = join(root, ".ahub", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.runtimes.mock = {};
    config.agents.coder.cli = "mock";
    delete config.agents.coder.runtime;
    await writeFile(configPath, JSON.stringify(config));
    await main(["agent", "set", "coder", "model", "inherit"], { root });
    await main(["ask", "coder", "first"], { root });
    await main(["model", "set", "localfast", "my-fast-model"], { root });
    await main(["agent", "set", "coder", "model", "localfast"], { root });
    await main(["ask", "coder", "second"], { root });
    const runs = (await loadState(root)).sessions[0].runs;
    assert.equal(runs[0].model, undefined);
    assert.equal(runs[1].model, "my-fast-model");
  } finally {
    console.log = log;
    await rm(root, { recursive: true, force: true });
  }
});

test("one request can choose a CLI and model in structured form without changing defaults", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-once-"));
  const log = console.log;
  console.log = () => {};
  try {
    await main(["setup"], { root });
    const configPath = join(root, ".ahub", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.runtimes.mock = {};
    config.agents.coder.cli = "mock";
    config.agents.coder.model = "persistent-model";
    await writeFile(configPath, JSON.stringify(config));
    await main(["ask", "coder", "fix", "tests", "--cli", "mock", "--model", "inherit"], { root });
    await main(["ask", "coder", "fix", "lint", "--cli", "mock", "--model", "one-shot-model"], { root });
    const runs = (await loadState(root)).sessions[0].runs;
    assert.equal(runs[0].runtime, "mock");
    assert.equal(runs[0].model, undefined);
    assert.equal(runs[1].model, "one-shot-model");
    assert.doesNotMatch(runs[1].task, /--cli|--model|one-shot-model/);
    const saved = JSON.parse(await readFile(configPath, "utf8"));
    assert.equal(saved.agents.coder.model, "persistent-model");
  } finally {
    console.log = log;
    await rm(root, { recursive: true, force: true });
  }
});

test("explicit inherit clears model and provider selected by a profile", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-inherit-"));
  const log = console.log;
  console.log = () => {};
  try {
    await main(["setup"], { root });
    const configPath = join(root, ".ahub", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.runtimes.mock = {};
    config.profiles.cheap = { runtime: "mock", provider: "deepseek", model: "deepseek-v4-flash" };
    await writeFile(configPath, JSON.stringify(config));
    await main(["ask", "coder", "/cheap", "fix", "tests", "--model", "inherit"], { root });
    const run = (await loadState(root)).sessions[0].runs[0];
    assert.equal(run.runtime, "mock");
    assert.equal(run.model, undefined);
    assert.equal(run.provider, undefined);
  } finally {
    console.log = log;
    await rm(root, { recursive: true, force: true });
  }
});

test("Codex plugin installer registers the packaged marketplace and public selector", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-install-project-"));
  const fakeBin = await mkdtemp(join(tmpdir(), "ahub-install-bin-"));
  const calls = join(fakeBin, "calls.txt");
  const codex = join(fakeBin, "codex");
  const previousPath = process.env.PATH;
  const log = console.log;
  console.log = () => {};
  try {
    await writeFile(codex, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${calls}"\nif [ "$*" = "plugin list --json" ]; then printf '{"installed":[]}\\n'; fi\n`);
    await chmod(codex, 0o755);
    process.env.PATH = `${fakeBin}${delimiter}${previousPath}`;
    await main(["install", "codex"], { root });
    const invocations = await readFile(calls, "utf8");
    assert.match(invocations, /plugin marketplace add .*Agent-Hub/u);
    assert.match(invocations, /plugin add ahub@ahub/u);
  } finally {
    console.log = log;
    process.env.PATH = previousPath;
    await rm(root, { recursive: true, force: true });
    await rm(fakeBin, { recursive: true, force: true });
  }
});

test("Codex installer removes the legacy ahub-local conflict", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-install-migrate-"));
  const fakeBin = await mkdtemp(join(tmpdir(), "ahub-install-migrate-bin-"));
  const calls = join(fakeBin, "calls.txt");
  const codex = join(fakeBin, "codex");
  const previousPath = process.env.PATH;
  const log = console.log;
  console.log = () => {};
  try {
    await writeFile(codex, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${calls}"\nif [ "$*" = "plugin list --json" ]; then printf '{"installed":[{"pluginId":"ahub@ahub-local"}]}\\n'; fi\n`);
    await chmod(codex, 0o755);
    process.env.PATH = `${fakeBin}${delimiter}${previousPath}`;
    await main(["install", "codex"], { root });
    const invocations = await readFile(calls, "utf8");
    assert.match(invocations, /plugin remove ahub@ahub-local/u);
  } finally {
    console.log = log;
    process.env.PATH = previousPath;
    await rm(root, { recursive: true, force: true });
    await rm(fakeBin, { recursive: true, force: true });
  }
});

test("Claude plugin installer registers the marketplace and installs ahub", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-claude-install-project-"));
  const fakeBin = await mkdtemp(join(tmpdir(), "ahub-claude-install-bin-"));
  const calls = join(fakeBin, "calls.txt");
  const claude = join(fakeBin, "claude");
  const previousPath = process.env.PATH;
  const log = console.log;
  console.log = () => {};
  try {
    await writeFile(claude, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${calls}"\nif [ "$*" = "plugin list --json" ]; then printf '[]\\n'; fi\n`);
    await chmod(claude, 0o755);
    process.env.PATH = `${fakeBin}${delimiter}${previousPath}`;
    await main(["install", "claude"], { root });
    const invocations = await readFile(calls, "utf8");
    assert.match(invocations, /plugin marketplace add .*Agent-Hub/u);
    assert.match(invocations, /plugin install ahub@ahub --scope user/u);
  } finally {
    console.log = log;
    process.env.PATH = previousPath;
    await rm(root, { recursive: true, force: true });
    await rm(fakeBin, { recursive: true, force: true });
  }
});

test("Claude plugin refresh removes an installed copy before reinstalling", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-claude-refresh-project-"));
  const fakeBin = await mkdtemp(join(tmpdir(), "ahub-claude-refresh-bin-"));
  const calls = join(fakeBin, "calls.txt");
  const claude = join(fakeBin, "claude");
  const previousPath = process.env.PATH;
  const log = console.log;
  console.log = () => {};
  try {
    await writeFile(claude, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${calls}"\nif [ "$*" = "plugin list --json" ]; then printf '[{"id":"ahub@ahub"}]\\n'; fi\n`);
    await chmod(claude, 0o755);
    process.env.PATH = `${fakeBin}${delimiter}${previousPath}`;
    await main(["install", "claude"], { root });
    const invocations = await readFile(calls, "utf8");
    assert.match(invocations, /plugin uninstall ahub@ahub --scope user/u);
    assert.match(invocations, /plugin install ahub@ahub --scope user/u);
  } finally {
    console.log = log;
    process.env.PATH = previousPath;
    await rm(root, { recursive: true, force: true });
    await rm(fakeBin, { recursive: true, force: true });
  }
});

test("first setup uses the only installed CLI for every agent", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-single-cli-project-"));
  const fakeBin = await mkdtemp(join(tmpdir(), "ahub-single-cli-bin-"));
  const nodePath = process.execPath;
  const claude = join(fakeBin, "claude");
  const node = join(fakeBin, "node");
  const previousPath = process.env.PATH;
  const log = console.log;
  console.log = () => {};
  try {
    await writeFile(claude, "#!/bin/sh\nprintf 'claude test\\n'\n");
    await writeFile(node, `#!/bin/sh\nexec "${nodePath}" "$@"\n`);
    await chmod(claude, 0o755);
    await chmod(node, 0o755);
    process.env.PATH = fakeBin;
    await main(["setup"], { root });
    const config = JSON.parse(await readFile(join(root, ".ahub", "config.json"), "utf8"));
    for (const agent of Object.values(config.agents)) {
      assert.equal(agent.cli, "claude");
      assert.equal(agent.model, "inherit");
    }
  } finally {
    console.log = log;
    process.env.PATH = previousPath;
    await rm(root, { recursive: true, force: true });
    await rm(fakeBin, { recursive: true, force: true });
  }
});

test("model configuration rejects unregistered providers", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-provider-"));
  const log = console.log;
  console.log = () => {};
  try {
    await main(["init"], { root });
    await assert.rejects(
      () => main(["model", "set", "fast", "model-x", "--provider", "unknown"], { root }),
      /unknown provider/u,
    );
    const config = JSON.parse(await readFile(join(root, ".ahub", "config.json"), "utf8"));
    assert.equal(config.models.fast, undefined);
  } finally {
    console.log = log;
    await rm(root, { recursive: true, force: true });
  }
});

test("missing option values fail clearly instead of using persistent defaults", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-flags-"));
  const log = console.log;
  console.log = () => {};
  try {
    await main(["init"], { root });
    await assert.rejects(() => main(["ask", "coder", "fix", "tests", "--model"], { root }), /--model requires a value/u);
    await assert.rejects(() => main(["ask", "coder", "fix", "tests", "--cli"], { root }), /--cli requires a value/u);
    await assert.rejects(() => main(["model", "set", "fast", "model-x", "--provider"], { root }), /--provider requires a value/u);
  } finally {
    console.log = log;
    await rm(root, { recursive: true, force: true });
  }
});

test("task text keeps application flags that do not belong to ahub", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-task-flags-"));
  const log = console.log;
  console.log = () => {};
  try {
    await main(["init"], { root });
    const configPath = join(root, ".ahub", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.runtimes.mock = {};
    config.agents.coder.cli = "mock";
    await writeFile(configPath, JSON.stringify(config));
    await main(["ask", "coder", "fix", "the", "--watch", "and", "--dry-run", "flags"], { root });
    const task = (await loadState(root)).sessions[0].runs[0].task;
    assert.match(task, /--watch and --dry-run flags/u);
  } finally {
    console.log = log;
    await rm(root, { recursive: true, force: true });
  }
});

test("double dash protects ahub-looking flags inside task text", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-separator-"));
  const log = console.log;
  console.log = () => {};
  try {
    await main(["init"], { root });
    const configPath = join(root, ".ahub", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.runtimes.mock = {};
    config.agents.coder.cli = "mock";
    await writeFile(configPath, JSON.stringify(config));
    await main(["ask", "coder", "--cli", "mock", "--model", "inherit", "--", "fix", "the", "--model", "parser"], { root });
    const run = (await loadState(root)).sessions[0].runs[0];
    assert.equal(run.model, undefined);
    assert.match(run.task, /fix the --model parser/u);
  } finally {
    console.log = log;
    await rm(root, { recursive: true, force: true });
  }
});

test("agent model configuration rejects a misspelled alias", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-alias-"));
  const log = console.log;
  console.log = () => {};
  try {
    await main(["init"], { root });
    await assert.rejects(() => main(["agent", "set", "coder", "model", "ds4ff"], { root }), /unknown model alias/u);
  } finally {
    console.log = log;
    await rm(root, { recursive: true, force: true });
  }
});

test("agent cannot persist a DeepSeek default before the provider is connected", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-agent-readiness-"));
  const credentialHome = await mkdtemp(join(tmpdir(), "ahub-agent-readiness-home-"));
  const log = console.log;
  console.log = () => {};
  try {
    await main(["init"], { root });
    await assert.rejects(() => main(["agent", "set", "coder", "model", "ds4f"], { root, credentialHome }), /DeepSeek/u);
    const config = JSON.parse(await readFile(join(root, ".ahub", "config.json"), "utf8"));
    assert.notEqual(config.agents.coder.model, "ds4f");
  } finally {
    console.log = log;
    await rm(root, { recursive: true, force: true });
    await rm(credentialHome, { recursive: true, force: true });
  }
});

test("a missing DeepSeek connection fails before creating a run record", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-preflight-"));
  const credentialHome = await mkdtemp(join(tmpdir(), "ahub-preflight-home-"));
  const log = console.log;
  console.log = () => {};
  try {
    await main(["init"], { root });
    await assert.rejects(() => main(["ask", "coder", "--model", "ds4f", "--", "calculate"], { root, credentialHome }), /DeepSeek/u);
    const state = await loadState(root);
    assert.equal(state.sessions[0].runs.length, 0);
  } finally {
    console.log = log;
    await rm(root, { recursive: true, force: true });
    await rm(credentialHome, { recursive: true, force: true });
  }
});

test("profiles cannot escalate a read-only agent to write access", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-access-"));
  const log = console.log;
  console.log = () => {};
  try {
    await main(["init"], { root });
    const configPath = join(root, ".ahub", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.runtimes.mock = {};
    config.agents.reviewer.cli = "mock";
    config.profiles.unsafe = { runtime: "mock", permissionMode: "acceptEdits", sandbox: "danger-full-access" };
    config.commands["/unsafe"] = "profile:unsafe";
    await writeFile(configPath, JSON.stringify(config));
    await main(["ask", "reviewer", "/unsafe", "review"], { root });
    const run = (await loadState(root)).sessions[0].runs[0];
    assert.equal(run.runtime, "mock");
    assert.equal(run.status, "completed");
    assert.equal(run.permissionMode, "plan");
    assert.equal(run.sandbox, "read-only");
  } finally {
    console.log = log;
    await rm(root, { recursive: true, force: true });
  }
});

test("concurrent first asks share one default session without failing", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-first-race-"));
  const log = console.log;
  console.log = () => {};
  try {
    await main(["init"], { root });
    const configPath = join(root, ".ahub", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.runtimes.mock = {};
    config.agents.coder.cli = "mock";
    await writeFile(configPath, JSON.stringify(config));
    await Promise.all(Array.from({ length: 8 }, (_, index) => main(["ask", "coder", `task-${index}`], { root })));
    const state = await loadState(root);
    assert.equal(state.sessions.length, 1);
    assert.equal(state.sessions[0].name, "main");
    assert.equal(state.sessions[0].runs.length, 8);
    assert.ok(state.sessions[0].runs.every((run) => run.status === "completed"));
  } finally {
    console.log = log;
    await rm(root, { recursive: true, force: true });
  }
});

test("auth commands keep DeepSeek key out of config and state", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-auth-"));
  const credentialHome = await mkdtemp(join(tmpdir(), "ahub-auth-home-"));
  const log = console.log;
  console.log = () => {};
  try {
    const credentialOptions = { credentialHome, validateCredential: async () => ({ ok: true }) };
    await main(["auth", "set", "deepseek"], { root, ...credentialOptions, readSecret: async () => "project-secret-value" });
    await main(["auth", "status"], { root, ...credentialOptions });
    const config = await readFile(join(root, ".ahub", "config.json"), "utf8");
    const state = await readFile(join(root, ".ahub", "state.json"), "utf8");
    const ignores = await readFile(join(root, ".ahub", ".gitignore"), "utf8");
    assert.doesNotMatch(config, /project-secret-value/u);
    assert.doesNotMatch(state, /project-secret-value/u);
    assert.match(ignores, /^secrets\.json$/mu);
    await main(["auth", "remove", "deepseek"], { root, ...credentialOptions });
  } finally {
    console.log = log;
    await rm(root, { recursive: true, force: true });
    await rm(credentialHome, { recursive: true, force: true });
  }
});

test("a rejected DeepSeek key is never saved", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-invalid-auth-"));
  const credentialHome = await mkdtemp(join(tmpdir(), "ahub-invalid-auth-home-"));
  const log = console.log;
  console.log = () => {};
  try {
    await assert.rejects(() => main(["auth", "set", "deepseek"], {
      root,
      credentialHome,
      readSecret: async () => "invalid-key",
      validateCredential: async () => ({ ok: false, reason: "invalid-key" }),
    }), /rejected|拒绝/u);
    await assert.rejects(() => readFile(join(credentialHome, ".ahub", "credentials.json"), "utf8"), { code: "ENOENT" });
  } finally {
    console.log = log;
    await rm(root, { recursive: true, force: true });
    await rm(credentialHome, { recursive: true, force: true });
  }
});

test("stored provider credentials are redacted from model output and persisted state", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-redact-"));
  const fakeBin = await mkdtemp(join(tmpdir(), "ahub-redact-bin-"));
  const claude = join(fakeBin, "claude");
  const previousPath = process.env.PATH;
  const credentialHome = await mkdtemp(join(tmpdir(), "ahub-redact-home-"));
  const log = console.log;
  console.log = () => {};
  try {
    await writeFile(claude, `#!/bin/sh\ncat >/dev/null\nprintf '{"result":"leaked %s"}\\n' "$ANTHROPIC_AUTH_TOKEN"\n`);
    await chmod(claude, 0o755);
    process.env.PATH = `${fakeBin}${delimiter}${previousPath}`;
    const credentialOptions = { credentialHome, validateCredential: async () => ({ ok: true }) };
    await main(["auth", "set", "deepseek"], { root, ...credentialOptions, readSecret: async () => "redact-this-secret" });
    await main(["ask", "coder", "--cli", "claude", "--model", "ds4f", "--", "test redaction"], { root, ...credentialOptions });
    const stateText = await readFile(join(root, ".ahub", "state.json"), "utf8");
    assert.doesNotMatch(stateText, /redact-this-secret/u);
    assert.match(stateText, /\[REDACTED\]/u);
  } finally {
    console.log = log;
    process.env.PATH = previousPath;
    await rm(root, { recursive: true, force: true });
    await rm(fakeBin, { recursive: true, force: true });
    await rm(credentialHome, { recursive: true, force: true });
  }
});

test("terminal control center runs an agent through menu selections", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-menu-run-"));
  const log = console.log;
  console.log = () => {};
  const selections = ["run", "coder", { cli: "mock", model: "inherit" }];
  const prompts = {
    select: async () => selections.shift(),
    ask: async () => "menu task",
  };
  try {
    await main(["init"], { root });
    const configPath = join(root, ".ahub", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.runtimes.mock = {};
    await writeFile(configPath, JSON.stringify(config));
    await main([], { root, interactive: true, prompts });
    const run = (await loadState(root)).sessions[0].runs[0];
    assert.equal(run.runtime, "mock");
    assert.equal(run.model, undefined);
    assert.match(run.task, /menu task/u);
  } finally {
    console.log = log;
    await rm(root, { recursive: true, force: true });
  }
});

test("terminal config menu saves agent defaults without low-level commands", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-menu-config-"));
  const credentialHome = await mkdtemp(join(tmpdir(), "ahub-menu-config-home-"));
  const log = console.log;
  console.log = () => {};
  const selections = ["agent", "reviewer", "codex", "ds4f", "connect"];
  const prompts = { select: async () => selections.shift(), ask: async () => "" };
  try {
    await main(["config"], { root, interactive: true, prompts, credentialHome, readSecret: async () => "valid-key", validateCredential: async () => ({ ok: true }) });
    const config = JSON.parse(await readFile(join(root, ".ahub", "config.json"), "utf8"));
    assert.equal(config.agents.reviewer.cli, "codex");
    assert.equal(config.agents.reviewer.model, "ds4f");
  } finally {
    console.log = log;
    await rm(root, { recursive: true, force: true });
    await rm(credentialHome, { recursive: true, force: true });
  }
});

test("terminal model menu creates a reusable custom model", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-menu-model-"));
  const log = console.log;
  console.log = () => {};
  const selections = ["models", "add", undefined];
  const answers = ["fast", "provider-model-fast", "Fast Model"];
  const prompts = { select: async () => selections.shift(), ask: async () => answers.shift() };
  try {
    await main(["config"], { root, interactive: true, prompts });
    const config = JSON.parse(await readFile(join(root, ".ahub", "config.json"), "utf8"));
    assert.deepEqual(config.models.fast, { name: "Fast Model", model: "provider-model-fast", favorite: false, enabled: true });
  } finally {
    console.log = log;
    await rm(root, { recursive: true, force: true });
  }
});

test("terminal shortcut menu creates a reusable host-context preset", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-menu-shortcut-"));
  const log = console.log;
  console.log = () => {};
  const selections = ["shortcuts", "create", "ds4f", "related", "reviewer"];
  const prompts = { select: async () => selections.shift(), ask: async () => "省钱审查" };
  try {
    await main(["init"], { root });
    await main([], { root, interactive: true, prompts });
    const config = JSON.parse(await readFile(join(root, ".ahub", "config.json"), "utf8"));
    assert.deepEqual(config.shortcuts["/省钱审查"], { model: "ds4f", contextMode: "related", role: "reviewer" });
  } finally {
    console.log = log;
    await rm(root, { recursive: true, force: true });
  }
});

test("model library manages many models without turning every menu into a long list", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-model-library-"));
  const log = console.log;
  console.log = () => {};
  try {
    await main(["init"], { root });
    for (let index = 1; index <= 12; index += 1) await main(["model", "set", `model${index}`, `provider-model-${index}`], { root });
    const configPath = join(root, ".ahub", "config.json");
    let config = JSON.parse(await readFile(configPath, "utf8"));
    config.models.model12.name = "Favorite Twelve";
    config.models.model12.favorite = true;
    config.models.model2.enabled = false;
    await writeFile(configPath, JSON.stringify(config));
    const loaded = await import("../src/config.mjs");
    const choices = loaded.modelChoices(await loaded.loadConfig(root));
    assert.equal(choices[0].value, "ds4f");
    assert.equal(choices[1].value, "model12");
    assert.equal(choices.some((choice) => choice.value === "model2"), false);
    assert.equal(choices.length, 12);
  } finally {
    console.log = log;
    await rm(root, { recursive: true, force: true });
  }
});

test("host CLI models cannot become an invalid direct-delegation default", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-model-default-"));
  const log = console.log;
  console.log = () => {};
  try {
    await main(["init"], { root });
    await main(["model", "set", "claudehost", "claude-sonnet"], { root });
    await assert.rejects(() => main(["model", "default", "claudehost"], { root }), /directly delegatable/u);
    await assert.rejects(() => main(["shortcut", "set", "/host", "--model", "claudehost"], { root }), /direct delegation/u);
    const config = JSON.parse(await readFile(join(root, ".ahub", "config.json"), "utf8"));
    assert.equal(config.defaults.externalModel, "ds4f");
  } finally {
    console.log = log;
    await rm(root, { recursive: true, force: true });
  }
});

test("running ahub with no command on a new project performs onboarding then opens the menu", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-first-menu-"));
  const fakeBin = await mkdtemp(join(tmpdir(), "ahub-first-menu-bin-"));
  const nodePath = process.execPath;
  const claude = join(fakeBin, "claude");
  const node = join(fakeBin, "node");
  const previousPath = process.env.PATH;
  const log = console.log;
  console.log = () => {};
  const selections = ["inherit", "exit"];
  const prompts = { select: async () => selections.shift(), ask: async () => "" };
  try {
    await writeFile(claude, "#!/bin/sh\nprintf 'claude test\\n'\n");
    await writeFile(node, `#!/bin/sh\nexec "${nodePath}" "$@"\n`);
    await chmod(claude, 0o755);
    await chmod(node, 0o755);
    process.env.PATH = fakeBin;
    await main([], { root, interactive: true, prompts });
    const config = JSON.parse(await readFile(join(root, ".ahub", "config.json"), "utf8"));
    assert.ok(Object.values(config.agents).every((agent) => agent.cli === "claude" && agent.model === "inherit"));
  } finally {
    console.log = log;
    process.env.PATH = previousPath;
    await rm(root, { recursive: true, force: true });
    await rm(fakeBin, { recursive: true, force: true });
  }
});

test("first interactive setup stores the selected interface language", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-language-project-"));
  const fakeBin = await mkdtemp(join(tmpdir(), "ahub-language-bin-"));
  const nodePath = process.execPath;
  const claude = join(fakeBin, "claude");
  const node = join(fakeBin, "node");
  const previousPath = process.env.PATH;
  const log = console.log;
  console.log = () => {};
  const selections = ["zh-CN", "inherit", "exit"];
  const prompts = { interactive: true, select: async () => selections.shift(), confirm: async () => false, ask: async () => "" };
  try {
    await writeFile(claude, "#!/bin/sh\nprintf 'claude test\\n'\n");
    await writeFile(node, `#!/bin/sh\nexec "${nodePath}" "$@"\n`);
    await chmod(claude, 0o755);
    await chmod(node, 0o755);
    process.env.PATH = fakeBin;
    await main([], { root, interactive: true, prompts, quietUi: true, loop: false });
    const config = JSON.parse(await readFile(join(root, ".ahub", "config.json"), "utf8"));
    assert.equal(config.ui.language, "zh-CN");
  } finally {
    console.log = log;
    process.env.PATH = previousPath;
    await rm(root, { recursive: true, force: true });
    await rm(fakeBin, { recursive: true, force: true });
  }
});

test("provider add/list/remove manage the provider registry", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-provider-reg-"));
  const log = console.log;
  console.log = () => {};
  try {
    await main(["init"], { root });
    await main(["provider", "add", "acme", "https://api.acme.example.com/", "--label", "Acme"], { root });
    let config = JSON.parse(await readFile(join(root, ".ahub", "config.json"), "utf8"));
    assert.equal(config.providers.acme.baseUrl, "https://api.acme.example.com");
    assert.equal(config.providers.acme.label, "Acme");
    assert.equal(config.providers.deepseek.label, "DeepSeek");
    // a model can now use the newly registered provider
    await main(["model", "set", "fast", "acme-fast", "--provider", "acme"], { root });
    config = JSON.parse(await readFile(join(root, ".ahub", "config.json"), "utf8"));
    assert.equal(config.models.fast.provider, "acme");
    // the built-in deepseek provider cannot be removed
    await assert.rejects(() => main(["provider", "remove", "deepseek"], { root }), /cannot be removed/u);
    // a provider still referenced by a model cannot be removed
    await assert.rejects(() => main(["provider", "remove", "acme"], { root }), /used by models/u);
    await main(["model", "remove", "fast"], { root });
    await main(["provider", "remove", "acme"], { root });
    config = JSON.parse(await readFile(join(root, ".ahub", "config.json"), "utf8"));
    assert.equal(config.providers.acme, undefined);
  } finally {
    console.log = log;
    await rm(root, { recursive: true, force: true });
  }
});

test("active model can be set to any provider-backed model", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-active-model-"));
  const log = console.log;
  console.log = () => {};
  try {
    await main(["init"], { root });
    await main(["provider", "add", "acme", "https://api.acme.example.com"], { root });
    await main(["model", "set", "fast", "acme-fast", "--provider", "acme"], { root });
    await main(["model", "default", "fast"], { root });
    const config = JSON.parse(await readFile(join(root, ".ahub", "config.json"), "utf8"));
    assert.equal(config.defaults.activeModel, "fast");
    assert.equal(config.defaults.externalModel, "fast");
  } finally {
    console.log = log;
    await rm(root, { recursive: true, force: true });
  }
});

test("auth set connects any registered provider", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-auth-multi-"));
  const credentialHome = await mkdtemp(join(tmpdir(), "ahub-auth-multi-home-"));
  const log = console.log;
  console.log = () => {};
  try {
    await main(["init"], { root });
    await main(["provider", "add", "acme", "https://api.acme.example.com"], { root });
    await main(["auth", "set", "acme"], {
      root,
      credentialHome,
      validateCredential: async () => ({ ok: true }),
      readSecret: async () => "acme-key",
    });
    const creds = JSON.parse(await readFile(join(credentialHome, ".ahub", "credentials.json"), "utf8"));
    assert.equal(creds.acme.apiKey, "acme-key");
    assert.equal(creds.deepseek, undefined);
    // an unregistered provider is rejected with guidance
    await assert.rejects(() => main(["auth", "set", "nope"], { root }), /usage: ahub auth set/u);
  } finally {
    console.log = log;
    await rm(root, { recursive: true, force: true });
    await rm(credentialHome, { recursive: true, force: true });
  }
});

test("config view shows a context-window hint for models that declare one", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-ctx-window-"));
  const log = console.log;
  const out = [];
  console.log = (msg) => out.push(msg);
  try {
    await main(["init"], { root });
    await main(["model", "set", "big", "big-model"], { root });
    const cfgPath = join(root, ".ahub", "config.json");
    const cfg = JSON.parse(await readFile(cfgPath, "utf8"));
    cfg.models.big.contextWindow = 200000;
    await writeFile(cfgPath, JSON.stringify(cfg));
    await main(["config", "--show"], { root });
    assert.ok(out.some((line) => /200k ctx/u.test(String(line))), "context window hint not shown");
  } finally {
    console.log = log;
    await rm(root, { recursive: true, force: true });
  }
});

test("model set merges into an existing alias instead of wiping provider/name", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-model-set-merge-"));
  const log = console.log;
  console.log = () => {};
  try {
    await main(["init"], { root });
    await main(["provider", "add", "acme", "https://api.acme.example.com"], { root });
    await main(["model", "set", "fast", "acme-fast", "--provider", "acme"], { root });
    // Re-setting only the model ID must preserve provider/name/favorite.
    await main(["model", "set", "fast", "acme-fast-v2"], { root });
    let config = JSON.parse(await readFile(join(root, ".ahub", "config.json"), "utf8"));
    assert.equal(config.models.fast.model, "acme-fast-v2");
    assert.equal(config.models.fast.provider, "acme");
    // ds4f's provider cannot be changed away from deepseek.
    await assert.rejects(() => main(["model", "set", "ds4f", "other-model", "--provider", "acme"], { root }), /deepseek provider/u);
    // but changing ds4f's model id without --provider is allowed and keeps deepseek.
    await main(["model", "set", "ds4f", "deepseek-v4-flash"], { root });
    config = JSON.parse(await readFile(join(root, ".ahub", "config.json"), "utf8"));
    assert.equal(config.models.ds4f.provider, "deepseek");
  } finally {
    console.log = log;
    await rm(root, { recursive: true, force: true });
  }
});

test("terminal ask refuses a non-deepseek external provider with an actionable error", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-ask-external-"));
  const log = console.log;
  console.log = () => {};
  try {
    await main(["init"], { root });
    await main(["provider", "add", "acme", "https://api.acme.example.com"], { root });
    await main(["model", "set", "fast", "acme-fast", "--provider", "acme"], { root });
    await assert.rejects(
      () => main(["ask", "coder", "--model", "fast", "--", "do something"], { root }),
      /delegate provider 'acme' from the host via @ahub/u,
    );
  } finally {
    console.log = log;
    await rm(root, { recursive: true, force: true });
  }
});

test("hiding or removing the active model reassigns it to a usable one", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-active-guard-"));
  const log = console.log;
  console.log = () => {};
  try {
    await main(["init"], { root });
    await main(["provider", "add", "acme", "https://api.acme.example.com"], { root });
    await main(["model", "set", "fast", "acme-fast", "--provider", "acme"], { root });
    await main(["model", "set", "slow", "acme-slow", "--provider", "acme"], { root });
    await main(["model", "default", "fast"], { root });
    // hiding the active model must not leave the active model unusable
    await main(["model", "hide", "fast"], { root });
    let config = JSON.parse(await readFile(join(root, ".ahub", "config.json"), "utf8"));
    assert.equal(config.models.fast.enabled, false);
    assert.notEqual(config.defaults.activeModel, "fast");
    assert.ok(config.models[config.defaults.activeModel]?.provider, "active model is still delegatable");
    assert.notEqual(config.models[config.defaults.activeModel].enabled, false, "active model is still visible");
    // removing the active model reassigns again (make a removable model active first)
    await main(["model", "default", "slow"], { root });
    await main(["model", "remove", "slow"], { root });
    config = JSON.parse(await readFile(join(root, ".ahub", "config.json"), "utf8"));
    assert.equal(config.models.slow, undefined);
    assert.notEqual(config.defaults.activeModel, "slow");
    assert.ok(config.models[config.defaults.activeModel]?.provider || config.defaults.activeModel === "ds4f");
  } finally {
    console.log = log;
    await rm(root, { recursive: true, force: true });
  }
});

test("control center recovers from a failed action instead of dying with a stack trace", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-menu-recover-"));
  const emptyBin = await mkdtemp(join(tmpdir(), "ahub-menu-empty-bin-"));
  const previousPath = process.env.PATH;
  const log = console.log;
  console.log = () => {};
  try {
    await main(["init"], { root });
    process.env.PATH = emptyBin; // no claude/codex binaries → install action must fail cleanly
    const selections = ["install", "exit"];
    const prompts = { select: async () => selections.shift(), ask: async () => "task", confirm: async () => true, interactive: true };
    await main([], { root, interactive: true, prompts }); // must not throw; loops back and exits
  } finally {
    console.log = log;
    process.env.PATH = previousPath;
    await rm(root, { recursive: true, force: true });
    await rm(emptyBin, { recursive: true, force: true });
  }
});

test("provider add with a known catalog name fills the default base URL", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-catalog-cli-"));
  const log = console.log;
  console.log = () => {};
  try {
    await main(["init"], { root });
    await main(["provider", "add", "openai"], { root });
    const config = JSON.parse(await readFile(join(root, ".ahub", "config.json"), "utf8"));
    assert.equal(config.providers.openai.baseUrl, "https://api.openai.com/v1");
    assert.equal(config.providers.openai.label, "OpenAI");
    assert.equal(config.providers.openai.kind, "openai");
    // custom providers still need an explicit base URL
    await assert.rejects(() => main(["provider", "add", "mygw"], { root }), /Known providers/u);
  } finally {
    console.log = log;
    await rm(root, { recursive: true, force: true });
  }
});

test("provider catalog lists known providers with default base URLs", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-catalog-list-"));
  const log = console.log;
  const out = [];
  console.log = (line) => out.push(line);
  try {
    await main(["init"], { root });
    await main(["provider", "catalog"], { root });
    const text = out.join("\n");
    assert.match(text, /openai\s+OpenAI · https:\/\/api\.openai\.com\/v1/u);
    assert.match(text, /Kimi/u);
    assert.match(text, /ollama\s+Ollama/u);
  } finally {
    console.log = log;
    await rm(root, { recursive: true, force: true });
  }
});

test("menu adds a catalog provider with just a key (no manual base URL)", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-catalog-menu-"));
  const credentialHome = await mkdtemp(join(tmpdir(), "ahub-catalog-menu-home-"));
  const log = console.log;
  console.log = () => {};
  try {
    await main(["init"], { root });
    const selections = ["models", "providers", "__add__", "catalog", "openai", "__back__", "exit"];
    const prompts = {
      select: async () => selections.shift(),
      ask: async () => "",
      confirm: async () => true,
      interactive: true,
    };
    await main([], {
      root,
      interactive: true,
      prompts,
      credentialHome,
      readSecret: async () => "catalog-key",
      validateCredential: async () => ({ ok: true }),
    });
    const config = JSON.parse(await readFile(join(root, ".ahub", "config.json"), "utf8"));
    assert.equal(config.providers.openai.baseUrl, "https://api.openai.com/v1");
    const creds = JSON.parse(await readFile(join(credentialHome, ".ahub", "credentials.json"), "utf8"));
    assert.equal(creds.openai.apiKey, "catalog-key");
  } finally {
    console.log = log;
    await rm(root, { recursive: true, force: true });
    await rm(credentialHome, { recursive: true, force: true });
  }
});

test("add-model wizard does provider → key → model → active/assign in one pass", async () => {
  const root = await mkdtemp(join(tmpdir(), "ahub-wizard-"));
  const credentialHome = await mkdtemp(join(tmpdir(), "ahub-wizard-home-"));
  const log = console.log;
  console.log = () => {};
  try {
    await main(["init"], { root });
    // controlCenter: addModel → source=catalog → pick openai → connect(yes) → alias/id/name
    // → set active (yes) → assign to agent (yes) → pick coder → back to menu → exit
    const selections = ["addModel", "catalog", "openai", "coder", "exit"];
    const answers = ["gptmini", "gpt-4o-mini", "GPT Mini"];
    const prompts = {
      select: async () => selections.shift(),
      ask: async () => answers.shift(),
      confirm: async () => true,
      interactive: true,
    };
    await main([], {
      root,
      interactive: true,
      prompts,
      credentialHome,
      readSecret: async () => "wizard-key",
      validateCredential: async () => ({ ok: true }),
    });
    const config = JSON.parse(await readFile(join(root, ".ahub", "config.json"), "utf8"));
    assert.equal(config.providers.openai.baseUrl, "https://api.openai.com/v1");
    assert.deepEqual(config.models.gptmini, { name: "GPT Mini", provider: "openai", model: "gpt-4o-mini", favorite: false, enabled: true });
    assert.equal(config.defaults.activeModel, "gptmini");
    assert.equal(config.agents.coder.model, "gptmini");
    const creds = JSON.parse(await readFile(join(credentialHome, ".ahub", "credentials.json"), "utf8"));
    assert.equal(creds.openai.apiKey, "wizard-key");
  } finally {
    console.log = log;
    await rm(root, { recursive: true, force: true });
    await rm(credentialHome, { recursive: true, force: true });
  }
});
