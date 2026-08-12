# ahub

[English](README.md) | [简体中文](README.zh-CN.md)

Use DeepSeek and other models inside Codex or Claude Code without losing the context of your current conversation.

ahub is a bilingual local control center and plugin for model routing, agent roles, host-context delegation, and reusable shortcuts. Natural language is the primary interface; terminal commands are available for automation.

## Highlights

- **Stay in the same conversation** — Codex selects relevant visible context, sends it to DeepSeek through ahub, and returns the answer to the same task.
- **Private credentials** — provider keys live in ahub's owner-only credential store, never in global shell environment variables.
- **Simple by default** — configure models, agents, integrations, and shortcut presets from a bilingual terminal menu.
- **Explicit context control** — choose `brief`, `related`, `full`, or `fresh`; full-context sharing requires confirmation.
- **Codex and Claude Code** — install either integration or both.
- **Safe roles** — architect analyzes, coder implements, and reviewer performs an independent read-only review.

## Quick start

Requires Node.js 20+, Claude Code, and/or Codex CLI.

For users:

```bash
npm install -g @haruw/ahub
ahub
```

In the guided menu:

1. Select 中文 or English.
2. Connect DeepSeek under **Models & API keys** if you want to use it.
3. Choose **Install integrations** and install ahub into Codex, Claude Code, or both.
4. Start a new Codex task or Claude Code session.

Then use natural language:

```text
@ahub Use DeepSeek to continue analyzing the architecture we just discussed
@ahub Ask DeepSeek for an independent review without using the previous answer
```

The first run asks for 中文 or English, then opens a three-step setup wizard: choose a coding CLI, choose a model, and install the integration. The language is saved per project and can be changed any time from **Language / 语言** in the control center. Use ↑/↓ and Enter—there are no commands to memorize.

ahub only calls a model “ready” when it can actually run. Choosing DeepSeek opens one guided flow that securely accepts the key, verifies the connection, stores it in ahub's private credential store, and then assigns the model. The key works across ahub projects but is never written to your shell environment.

Inside Codex App, the ahub plugin delegates directly through its bundled MCP tool. Codex selects the relevant context it can already see, ahub redacts common secret patterns, DeepSeek answers, and the result returns to the same task. ahub never scrapes Codex's internal transcript files.

Natural language is the recommended interface:

```text
@ahub 用 DeepSeek 继续分析我们刚才讨论的方案
@ahub 请让 DeepSeek 独立审查这个结论，不参考前面的答案
```

Optional shortcuts compose across three independent dimensions:

- Model: `/ds`, `/native`
- Context: `/brief`, `/related`, `/full`, `/fresh`
- Work mode: `/analyze`, `/code`, `/review`

For example, `@ahub /ds /fresh /review 审查这个结论` asks DeepSeek for a fresh independent review. Full-context delegation always requires confirmation. To save `/省钱审查` as DeepSeek + related context + reviewer, open **Shortcut presets / 快捷预设** in the `ahub` menu—no command syntax is required.

For development from this checkout:

```bash
npm install
npm link
ahub init
ahub doctor
```

For development directly from this checkout, `npm link` installs the `ahub` command globally. To remove the link later, run `npm unlink -g ahub`.

## Terminal menu

```bash
ahub
```

```text
? Control center
❯ ▶  Run an agent       Start architect, coder, or reviewer
  ⚙  Agent settings     Choose default CLI and model
  ◇  Models & API keys  Configure low-cost and custom models
  ⌁  Shortcut presets   Combine model, context, and agent role
  ＋ Install integrations  Add ahub to Claude Code or Codex
  ●  Status & doctor     Check configuration and integrations
  ×  Exit
```

The setup wizard handles the initial flow:

1. Configure `architect`, `coder`, and `reviewer`.
2. Choose models and project credentials.
3. Install the configured ahub plugin into Claude Code, Codex, or both.
4. Verify everything from Status & doctor.
5. Return to the control center automatically after each action.

The three roles have safe defaults: `architect` analyzes, `coder` edits and tests, and `reviewer` performs an independent review.

Install CLI integrations directly when you need scripting instead of the menu:

```bash
ahub install claude
ahub install codex
ahub install all
```

Claude Code loads ahub in a new session or after `/reload-plugins`. Codex loads it in a new task.

Start a new Codex task and ask:

```text
@ahub ask the architect to analyze this project
```

Typing `@` in the Codex or GPT app shows five namespaced shortcuts:

- `@ahub-architect` — analyze and design without editing files.
- `@ahub-coder` — implement changes and run tests.
- `@ahub-reviewer` — perform an independent read-only review.
- `@ahub-config` — configure agents, CLIs, and models through conversation.
- `@ahub` — general coordination and status.

Natural language is the primary interface:

```text
@ahub-coder 用 Claude Code 自带的模型修复登录问题
@ahub-reviewer 这次用便宜模型审查支付模块
@ahub-config 以后 coder 默认使用 Claude Code，并继承它自己的模型配置
@ahub-config 添加一个叫 fast 的模型，模型 ID 是 my-fast-model
```

“这次” affects one request. “以后” or “默认” changes persistent agent configuration. ahub confirms persistent changes in plain language.

For host-context delegation, use the small composable vocabulary shown above. The older terminal automation aliases below remain compatible, but they are no longer the recommended in-app interface:

```text
@ahub-coder /cc Fix all lint errors
@ahub-coder /ds4f /cx Fix all lint errors
@ahub-architect /ds4f /cc Analyze this architecture
@ahub-reviewer /best Review the payment changes
```

Commands are composable and represent separate dimensions:

- `/ds4f`, `/cheap`, `/flash`, `/省钱` choose `deepseek-v4-flash`.
- `/cc` chooses Claude Code CLI.
- `/cx` chooses Codex CLI.
- Without `/cc` or `/cx`, the selected agent keeps its default CLI.
- Without a model command, ahub passes no model override. Claude Code or Codex uses the model already configured in that CLI.

This means `@ahub-coder /cc Fix the tests` uses Claude Code and its own configured model. Only `@ahub-coder /ds4f /cc Fix the tests` explicitly overrides that model with DeepSeek V4 Flash.

Choose **Models & API keys → DeepSeek → Connect** in the terminal menu. ahub validates the key before saving it, then offers to assign DeepSeek to an agent. The equivalent scripting command is:

```bash
ahub auth set deepseek
```

The prompt hides input. ahub writes the key to `~/.ahub/credentials.json` with owner-only permissions and injects it only into the selected child CLI. It does not modify your shell environment. Check or remove it with `ahub auth status` and `ahub auth remove deepseek`. Legacy project-only `.ahub/secrets.json` keys remain supported and take priority.

Legacy terminal automation can still define low-level commands without editing JSON:

```bash
ahub command set /省点 profile:cheap
ahub command set /克劳德 cli:claude
ahub command set /考德克斯 cli:codex
```

Then use `@ahub-coder /省点 /考德克斯 Fix the tests`.

For Codex App host-context delegation, create a single readable preset from the terminal menu instead:

```text
ahub → Shortcut presets → Create
Name: /省钱审查
Model: DeepSeek V4 Flash
Context: Related
Role: Reviewer
```

Then type `@ahub /省钱审查 检查当前方案` in Codex. The preset is a preference, not a hidden prompt: explicit natural-language instructions in the current request take priority.

## Advanced automation

The menu is the normal interface. These commands exist for scripts and CI:

```bash
ahub session create auth
ahub task add auth "Fix refresh-token races"

ahub run claude auth "Analyze the refresh-token implementation"
ahub run codex auth "Implement the previous analysis" --context summary
ahub run claude auth "Review Codex's implementation" --context session

ahub session show auth
```

Mark a task complete using the full ID or the short prefix printed by `task list`:

```bash
ahub task done auth 12ab34cd
```

Use `mock` to verify the complete coordination path without calling a paid model:

```bash
ahub demo
```

## Context modes

- `task`: current task and open task list; no previous agent results.
- `summary`: up to 3 successful previous results. This is the default.
- `session`: up to 12 successful previous results.
- `full`: all successful previous results.

Each run stores a context manifest recording which earlier runs it received. Failed output is never inherited.

## Configuration

Open settings directly:

```bash
ahub config
```

The menu asks which agent, CLI, and model to use. DeepSeek setup and project credentials live in the same place.

The commands below are scripting interfaces; ordinary users do not need them. To list active values:

```bash
ahub agent list
ahub model list
```

Choose which terminal an agent uses while keeping that terminal's own model configuration:

```bash
ahub agent set coder cli claude
ahub agent set coder model inherit
```

Create a reusable model alias and make it the coder's persistent override:

```bash
ahub model set myfast my-fast-model
ahub agent set coder model myfast
```

Set the model back to the Claude Code or Codex CLI default at any time:

```bash
ahub agent set coder model inherit
```

The selection priority is: a model command in the current request, then the agent's configured model, then the terminal CLI's native model configuration. Run `ahub config` for the complete effective configuration.

Advanced users can also edit `.ahub/config.json` directly:

```json
{
  "models": {
    "myfast": { "model": "my-fast-model" }
  },
  "agents": {
    "architect": { "cli": "claude", "model": "inherit" },
    "coder": { "cli": "codex", "model": "myfast" },
    "reviewer": { "cli": "claude", "model": "inherit" }
  }
}
```

Unspecified values keep safe defaults. The configuration is loaded for every run, so changes take effect immediately.

## Storage and safety

Project state lives in `.ahub/state.json` and is written atomically. Existing `.agenthub` state is migrated automatically. State and legacy `.ahub/secrets.json` credentials are ignored by Git because prompts, model output, and credentials may be private. Provider keys stored with `ahub auth set` stay in ahub's owner-only credential store and are never written to state, model configuration, or shell environment.

This MVP runs Codex with its `workspace-write` sandbox and Claude with `acceptEdits`. Run it only in a workspace you trust. ahub does not bypass either runtime's sandbox.

## Current scope

Included: local sessions, append-only event records, tasks, Claude/Codex adapters, context inheritance, run manifests, failure persistence, diagnostics, offline demo, and tests.

Deferred: live bidirectional mailboxes, parallel conflict resolution, semantic retrieval, long-term memory, web UI, and additional runtimes.

## Local development

```bash
git clone https://github.com/werwrer/ahub.git
cd ahub
npm install
npm test
npm link
ahub doctor
```

Remove the global development link with `npm unlink -g @haruw/ahub`.

## License

[MIT](LICENSE)
