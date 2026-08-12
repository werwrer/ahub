import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { runRuntime } from "../src/runtimes.mjs";

async function withFakeCommand(name, source, callback) {
  const root = await mkdtemp(join(tmpdir(), "agenthub-runtime-"));
  const command = join(root, name);
  const previousPath = process.env.PATH;
  try {
    await writeFile(command, source);
    await chmod(command, 0o755);
    process.env.PATH = `${root}${delimiter}${previousPath}`;
    return await callback();
  } finally {
    process.env.PATH = previousPath;
    await rm(root, { recursive: true, force: true });
  }
}

test("Claude adapter sends prompt on stdin and parses structured result", async () => {
  await withFakeCommand("claude", `#!/bin/sh
input=$(cat)
case "$*" in
  *"-p"*"--output-format json"*"--permission-mode acceptEdits"*) ;;
  *) exit 9 ;;
esac
printf '{"type":"result","result":"CLAUDE_ADAPTER_OK: %s","session_id":"claude-session-1","total_cost_usd":0.01}\n' "$input"
`, async () => {
    const result = await runRuntime("claude", "handoff prompt", { cwd: process.cwd() });
    assert.equal(result.output, "CLAUDE_ADAPTER_OK: handoff prompt");
    assert.equal(result.externalSessionId, "claude-session-1");
    assert.equal(result.metadata.costUsd, 0.01);
  });
});

test("Claude adapter surfaces structured API failures", async () => {
  await withFakeCommand("claude", `#!/bin/sh
cat >/dev/null
printf '{"is_error":true,"api_error_status":403,"result":"authentication disabled"}\n'
exit 1
`, async () => {
    await assert.rejects(() => runRuntime("claude", "prompt"), /^Error: claude failed: authentication disabled$/);
  });
});

test("Claude adapter passes an explicit model and read-only permission mode", async () => {
  await withFakeCommand("claude", `#!/bin/sh
input=$(cat)
case "$*" in
  *"--permission-mode plan"*"--model sonnet"*) ;;
  *) printf 'unexpected args: %s' "$*" >&2; exit 9 ;;
esac
printf '{"result":"ok"}\n'
`, async () => {
    const result = await runRuntime("claude", "review", { permissionMode: "plan", model: "sonnet" });
    assert.equal(result.output, "ok");
  });
});

test("Codex adapter inherits its model when none is supplied", async () => {
  await withFakeCommand("codex", `#!/bin/sh
input=$(cat)
case "$*" in
  *"exec"*"--json"*"--skip-git-repo-check"*"-s read-only"*) ;;
  *) printf 'unexpected args: %s' "$*" >&2; exit 9 ;;
esac
case "$*" in *"--model"*) exit 8 ;; esac
printf '{"type":"thread.started","thread_id":"codex-session-1"}\n'
printf '{"type":"item.completed","item":{"type":"agent_message","text":"CODEX_OK: %s"}}\n' "$input"
`, async () => {
    const result = await runRuntime("codex", "review prompt", { sandbox: "read-only" });
    assert.equal(result.output, "CODEX_OK: review prompt");
    assert.equal(result.externalSessionId, "codex-session-1");
  });
});

test("DeepSeek refuses to run without a key instead of falling back", async () => {
  const previous = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    await assert.rejects(
      () => runRuntime("claude", "prompt", { provider: "deepseek", model: "deepseek-v4-flash" }),
      /ahub auth set deepseek/u,
    );
    await assert.rejects(
      () => runRuntime("codex", "prompt", { provider: "deepseek", model: "deepseek-v4-flash" }),
      /ahub auth set deepseek/u,
    );
  } finally {
    if (previous === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previous;
  }
});

test("DeepSeek token is passed through environment and never command arguments", async () => {
  await withFakeCommand("claude", `#!/bin/sh
cat >/dev/null
case "$*" in *"secret-test-token"*) exit 8 ;; esac
test "$ANTHROPIC_AUTH_TOKEN" = "secret-test-token" || exit 9
test "$ANTHROPIC_BASE_URL" = "https://api.deepseek.com/anthropic" || exit 10
printf '{"result":"secure"}\n'
`, async () => {
    const result = await runRuntime("claude", "prompt", {
      provider: "deepseek",
      model: "deepseek-v4-flash",
      apiKey: "secret-test-token",
    });
    assert.equal(result.output, "secure");
  });
});

test("Codex DeepSeek token is injected through environment and never arguments", async () => {
  await withFakeCommand("codex", `#!/bin/sh
cat >/dev/null
case "$*" in *"secret-codex-token"*) exit 8 ;; esac
test "$DEEPSEEK_API_KEY" = "secret-codex-token" || exit 9
printf '{"type":"item.completed","item":{"type":"agent_message","text":"secure-codex"}}\n'
`, async () => {
    const result = await runRuntime("codex", "prompt", {
      provider: "deepseek",
      model: "deepseek-v4-flash",
      apiKey: "secret-codex-token",
    });
    assert.equal(result.output, "secure-codex");
  });
});

test("missing runtime CLI returns an actionable error", async () => {
  const previousPath = process.env.PATH;
  process.env.PATH = "";
  try {
    await assert.rejects(() => runRuntime("claude", "prompt"), /claude CLI was not found \(claude\)/u);
    await assert.rejects(() => runRuntime("codex", "prompt"), /codex CLI was not found \(codex\)/u);
  } finally {
    process.env.PATH = previousPath;
  }
});
