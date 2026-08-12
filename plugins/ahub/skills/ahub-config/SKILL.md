---
name: ahub-config
description: Use when the user selects @ahub-config or conversationally asks to view, set, change, or reset ahub agent, terminal CLI, model, alias, or shortcut configuration.
---

# ahub config

Configure ahub through conversation. The user should not need to know CLI syntax.

Treat model delegation in the host app separately from terminal-agent defaults. Host conversations use the ahub MCP `delegate` tool and host-selected context. Terminal defaults control `ahub ask` automation only.

Prefer completing configuration from the conversation. If the user wants to browse choices themselves, tell them to run `ahub config`, which opens an arrow-key terminal menu. Do not present low-level commands unless they ask for scripting details.

1. If `.ahub` is not initialized, run `ahub setup`.
2. Use `ahub agent list` and `ahub model list` when current state is needed.
3. Translate the request into the smallest persistent change:
   - “coder 以后用 Claude Code” → `ahub agent set coder cli claude`.
   - “模型用 Claude Code 自带的” → `ahub agent set coder model inherit`.
   - “添加 fast，模型 ID 是 model-x” → `ahub model set fast model-x`.
   - “coder 默认用 fast” → `ahub agent set coder model fast`.
4. Do not change model merely because CLI changed. Inheritance is a separate choice.
5. Read the resulting lists and confirm the effective configuration in natural language.

For custom conversation shortcuts, model them as presets with up to three independent dimensions: `model` (`ds4f` or `native`), `contextMode` (`brief`, `related`, `full`, or `fresh`), and `role` (`architect`, `coder`, or `reviewer`). Prefer a memorable user word such as `/省钱审查` over several overlapping commands. Inspect with `ahub shortcut list`; persist with `ahub shortcut set` and remove with `ahub shortcut remove`. Do not overwrite built-ins unless the user explicitly requests it.

“这次/本次” is not persistent configuration. For that wording, route the task with `ahub ask <role> --cli ... --model ... -- "<task>"` instead.

For DeepSeek, first check `ahub auth status`. If it is not connected, tell the user to run `ahub` and choose **Models & API keys → DeepSeek → Connect**. That single flow securely requests the key in the terminal, validates it before saving, and makes it available to all ahub projects without changing shell environment variables. Never request or accept an API key in chat. Legacy project credentials in `.ahub/secrets.json` remain supported.

Do not describe a DeepSeek model as configured merely because its alias exists. It is runnable only when `ahub auth status` reports a credential. Do not persist an agent's DeepSeek default until the connection flow succeeds.
