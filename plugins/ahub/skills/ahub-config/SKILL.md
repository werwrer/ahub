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

For many models, treat ahub as a model library rather than a flat command list. Models have a short alias, display name, model ID, source/provider, favorite state, and visibility. Use `ahub model list`; add with `ahub model set`; manage the active model, favorites, and visibility with `ahub model default|favorite|hide|show`. Assign aliases to agents only after they exist.

Providers are registered separately from models. DeepSeek is built in; add any OpenAI-compatible provider with `ahub provider add <name> <baseUrl> [--label <label>]`, list with `ahub provider list`, and connect a key with `ahub auth set <name>`. A model is delegatable in the host app only when its provider is registered AND connected — so “add a model that actually works” usually means: register the provider, add a model alias pointing at it, then connect the key.

The **active model** is the sticky default that `@ahub /ds` and a bare `@ahub` delegate to. “以后/default 用 fast” or “make fast the default” → `ahub model default fast` (requires a provider-backed model). “这次用 fast” is a one-off, not a config change.

For custom conversation shortcuts, model them as presets with up to three independent dimensions: `model` (an enabled, provider-backed model alias or `native`), `contextMode` (`brief`, `related`, `full`, or `fresh`), and `role` (`architect`, `coder`, or `reviewer`). Host-CLI model aliases (no provider) belong on agents, not direct-delegation shortcuts. Prefer a memorable user word such as `/省钱审查` over several overlapping commands. Inspect with `ahub shortcut list`; persist with `ahub shortcut set` and remove with `ahub shortcut remove`. Do not overwrite built-ins unless the user explicitly requests it.

“这次/本次” is not persistent configuration. For that wording, route the task with `ahub ask <role> --cli ... --model ... -- "<task>"` instead.

For any provider, first check `ahub auth status` (it lists every provider and its connection state). If the needed provider is not connected, connect it without ever putting a key in the conversation:
- In the host app, call the ahub `connect` tool with `{ provider, keyFile }` pointing at a local file that holds the key. The key is read from disk, validated, and stored privately; it is never echoed.
- In a terminal, `ahub auth set <provider>` prompts with hidden input, or `ahub auth set <provider> --key-file <path>` reads a key file. Both validate before saving and make the key available to all ahub projects without touching shell environment variables.

Never request or accept a pasted API key in chat. Legacy project credentials in `.ahub/secrets.json` remain supported.

Do not describe a model as runnable merely because its alias exists. It is runnable in the host app only when `ahub auth status` reports a credential for its provider. Do not persist a provider-backed default until the connection flow succeeds.
