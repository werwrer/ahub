import { spawn } from "node:child_process";

function execute(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; options.onData?.(chunk.toString()); });
    child.stderr.on("data", (chunk) => { stderr += chunk; options.onData?.(chunk.toString()); });
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
    child.stdin.end(options.input ?? "");
    options.onChild?.(child);
  });
}

export async function commandVersion(command) {
  try {
    const result = await execute(command, ["--version"]);
    return result.code === 0 ? (result.stdout || result.stderr).trim() : null;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function parseClaude(stdout) {
  try {
    const data = JSON.parse(stdout);
    if (data.is_error || data.api_error_status) throw new Error(data.result || `Claude API error ${data.api_error_status}`);
    return { output: data.result ?? stdout, externalSessionId: data.session_id, metadata: { costUsd: data.total_cost_usd } };
  } catch (error) {
    if (error instanceof SyntaxError) return { output: stdout.trim() };
    throw error;
  }
}

function parseCodex(stdout) {
  const lines = stdout.split("\n").filter(Boolean);
  let output = "";
  let externalSessionId;
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (event.type === "thread.started") externalSessionId = event.thread_id;
      if (event.type === "item.completed" && event.item?.type === "agent_message") output = event.item.text;
      if (event.type === "turn.failed") throw new Error(event.error?.message || "Codex turn failed");
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  return { output: output || stdout.trim(), externalSessionId };
}

export async function runRuntime(runtime, prompt, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  let command;
  let args;
  let parse;
  if (runtime === "claude" || runtime === "deepseek") {
    command = options.command ?? "claude";
    args = ["-p", "--output-format", "json", "--permission-mode", options.permissionMode ?? "acceptEdits", "-"];
    if (options.model) args.splice(-1, 0, "--model", options.model);
    if (options.effort) args.splice(-1, 0, "--effort", options.effort);
    parse = parseClaude;
    if (runtime === "deepseek" || options.provider === "deepseek") {
      const token = options.apiKey ?? process.env.DEEPSEEK_API_KEY;
      if (!token) throw new Error("DeepSeek credentials are missing. Run `ahub auth set deepseek` in this project, then retry.");
      options.env = {
        ...options.env,
        ANTHROPIC_BASE_URL: options.baseUrl ?? "https://api.deepseek.com/anthropic",
        ANTHROPIC_AUTH_TOKEN: token,
        ANTHROPIC_MODEL: options.model ?? "deepseek-v4-flash",
      };
    }
  } else if (runtime === "codex") {
    command = "codex";
    args = ["exec", "--json", "--color", "never", "--skip-git-repo-check", "-C", cwd, "-s", options.sandbox ?? "workspace-write", "-"];
    if (options.model) args.splice(-1, 0, "--model", options.model);
    if (options.profile) args.splice(-1, 0, "--profile", options.profile);
    if (options.provider === "deepseek") {
      const token = options.apiKey ?? process.env.DEEPSEEK_API_KEY;
      if (!token) throw new Error("DeepSeek credentials are missing. Run `ahub auth set deepseek` in this project, then retry.");
      options.env = { ...options.env, DEEPSEEK_API_KEY: token };
      const overrides = [
        'model_provider="deepseek"',
        'model_providers.deepseek.name="DeepSeek"',
        `model_providers.deepseek.base_url="${options.baseUrl ?? "https://api.deepseek.com/"}"`,
        'model_providers.deepseek.wire_api="responses"',
        'model_providers.deepseek.env_key="DEEPSEEK_API_KEY"',
      ];
      for (const value of overrides.reverse()) args.splice(1, 0, "--config", value);
    }
    parse = parseCodex;
  } else if (runtime === "mock") {
    return { output: `Mock completed: ${prompt.split("Current task:\n").at(-1).trim()}`, externalSessionId: `mock-${crypto.randomUUID()}` };
  } else {
    throw new Error(`unsupported runtime: ${runtime}`);
  }
  let result;
  try {
    result = await execute(command, args, { cwd, input: prompt, env: options.env, onChild: options.onChild });
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`${runtime} CLI was not found (${command}). Install it or choose another CLI.`);
    throw error;
  }
  if (result.code !== 0) {
    const structured = (result.stdout || result.stderr).trim();
    if (structured) {
      try {
        parse(structured);
      } catch (error) {
        throw new Error(`${runtime} failed: ${error.message}`);
      }
    }
    throw new Error(`${runtime} exited with ${result.code}: ${(result.stderr || result.stdout).trim()}`);
  }
  return parse(result.stdout);
}
