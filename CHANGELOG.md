# Changelog

## 0.8.0 — 2026-08-14

- **Menu system rebuilt on @clack/prompts** (inquirer replaced): the prompts now render with the same `◆ │ └` frame as the rest of the UI, Esc = back is native (the raw-keypress AbortController hack is gone), and long lists (models, providers) use clack's filterable autocomplete instead of a threshold-swapped select.
- **Main menu flattened to one level** (informed by gh CLI / clack / gum conventions): the three frequent actions — Run, Add model, **Switch active model** (new, was 4 levels deep) — sit on top; Model library, Providers (promoted out of the models submenu), Agent settings, and Shortcuts are single entries below. Settings menus are at most two levels deep.
- **Status strip instead of a static dashboard**: a compact 3-row strip (active model + readiness, agent → CLI routing, provider ●/○) is re-rendered above the menu on *every* loop, so state can never go stale; the `showDashboard` flag and the "back to menu" pause prompt are gone. Action output stays in the scrollback instead of being wiped.
- **Readability**: menu items are short verb labels; explanations moved to dim per-item hints shown on focus (clack pattern); separator rows group the menu; one vocabulary across all entry points (main menu, `ahub config`, CLI help) — no more "Models / Model library / Manage models" meaning the same thing.
- Two-key contract preserved and simplified: Esc = back, Ctrl+C = exit (a parallel keypress observer distinguishes the two, both of which clack maps to cancel).

## 0.7.2 — 2026-08-13

- **Terminal interaction overhaul** (informed by gh CLI, Vercel CLI, and clack research): clack-style `◆`/`└` session framing via chalk (no new dependency); Esc = back one level, Ctrl+C = exit (per Go promptui / gh convention); menu labels trimmed to action names with separator-grouped lists; always-visible minimal key hint (`↑↓ · Enter · Esc`); shared 14-char column width across agents/models/providers; search/filter threshold lowered from >8 to >4 items; bilingual language menu label.
- **Add-model wizard**: host-default (inherit) is the first source; registered providers (DeepSeek direct) listed inline with ●/○ readiness; official catalog vs custom split.
- **Provider catalog**: `ahub provider add <name>` auto-fills the default base URL for 14 well-known OpenAI-compatible providers (`ahub provider catalog`).

## 0.7.1 — 2026-08-13

- **Backup vs handover, separated**: delegations now store the **full** redacted context (no 16k cap), and two distinct capabilities replace the old conflated export: `backup` (lossless JSON snapshot of delegations + terminal sessions + config to `.ahub/backups/`; credentials deliberately excluded; MCP `backup` tool + `ahub backup`) and `export` (the readable Markdown handover document for other AI clients, unchanged).
- Docs: the two READMEs are now strictly single-language — the English README contains only English examples, the Chinese README only Chinese ones (UI labels and CLI commands excepted).

## 0.7.0 — 2026-08-13

- **Conversation migration (export to Markdown)**: export ahub-held conversations into a self-contained Markdown document — tasks, the shared host context, and answers per turn, with model/token/cost metadata — ready to hand to another AI client (ChatGPT, Cursor, …). In-app via the new `export` MCP tool (optionally per `threadId`); from the terminal via `ahub export [<threadId>] [--session <name>] [--out <path>]`, which also exports terminal automation sessions. Files land in `.ahub/exports/` (owner-only, gitignored). To support this, each delegation now also stores the (redacted, capped) host context.

## 0.6.1 — 2026-08-13

- **Terminal-native interaction redesign**: the control center now renders a live status dashboard (agents, provider readiness, active model) above every action, and adding a model is a **one-pass wizard** — pick the provider (catalog / custom / registered providers listed inline with ●/○ connection state / host CLI), fill the key if needed, name the model, then optionally set it active and assign an agent. Replaces the old six-level menu drill-down.

## 0.6.0 — 2026-08-13

- **Provider catalog**: adding a provider is now pick-a-provider instead of type-a-provider. Well-known OpenAI-compatible providers (OpenAI, Anthropic, Moonshot Kimi, Zhipu GLM, Qwen/DashScope, SiliconFlow, Groq, Mistral, OpenRouter, xAI, Together, Fireworks, Novita, Ollama) ship with their default base URL and response format pre-filled — `ahub provider add openai` registers one and only the API key is needed afterwards (`ahub provider catalog` lists them; the menu offers the same picker with an immediate connect prompt). Custom endpoints still work via `ahub provider add <name> <baseUrl>`.
- Docs: complete zh-CN README (full mirror of the English README).

## 0.5.0 — 2026-08-13

A major product upgrade: any model actually works, delegation is resilient and multi-turn, and the terminal menu survives real use.

### Any provider, not just DeepSeek
- Added a **provider registry** — DeepSeek is built in; register any OpenAI-compatible endpoint with `ahub provider add`, or from the menu (**Model library → Provider connections → Add**).
- The `@ahub` MCP `delegate` now routes through the provider registry instead of hard-rejecting non-DeepSeek models. Every provider-backed model in the library can be delegated.
- New MCP **`connect`** tool + `ahub auth set <provider> --key-file <path>`: connect a provider from a local key file — the key never enters the conversation.
- `ahub auth status/set/remove` now work per-provider; `ahub model set --provider` accepts any registered provider.

### Active model & cleaner selection
- **Active model** (`defaults.activeModel`, legacy `externalModel` kept in sync): the sticky model `@ahub /ds` and bare `@ahub` delegate to. Set it from the model library or with `ahub model default`.
- Picker shows provider label, cost ($/M), and tags inline; searchable by alias.
- Hiding/removing the active model automatically reassigns it to another delegatable model.

### Streaming, resilience, transparency
- Delegation **streams token-by-token** (SSE) with MCP progress notifications where the host supports them; graceful JSON fallback.
- Hard timeout + idle timeout, one retry on 408/425/429/5xx, partial-output recovery with a `streamInterrupted` flag.
- Context over 60k characters is truncated **and the model is told** (`contextTruncated`); surrogate-safe slicing; UTF-8-safe streaming decode.
- Every result reports `tokens`, `estimatedCostUsd`, and `elapsedMs`.

### Multi-turn delegation memory
- Delegations are logged to `.ahub/delegations.jsonl` (owner-only, gitignored; `delegationLog: false` to disable; auto-compacted).
- **Threads**: `delegate({ threadId })` or `continue: true` resumes a thread, replaying the model's own prior turns (capped, with elision markers) — it continues across turns without ever claiming to see the host transcript.
- New **`recall`** tool: retrieve prior delegations (all, or per-thread) with cumulative token/cost totals.
- New **`forget`** tool: clear delegation history (all, or one thread).

### Security & robustness
- Atomic, owner-only credential writes (temp-file + rename, 0o700 dir, serialized) — a crash can no longer corrupt the credential store.
- Redaction now covers JSON-formatted secrets, AWS/Google/Slack/GitHub tokens, JWTs, Bearer tokens — without corrupting legitimate prose like `api-endpoint-implementation`.
- Hardened stdio handler: malformed `null` lines ignored, requests without ids rejected, line-size cap.
- `connect` refuses symlinks, sensitive paths, and files over 8KB.
- Config schema versioning: newer-than-supported configs are refused instead of silently mis-merged; non-object configs no longer crash loading.

### Interaction fixes
- The control center now recovers from failed actions (warning + loop) instead of dying with a stack trace.
- Invalid model/shortcut/provider names re-prompt instead of discarding your input.
- Onboarding points to the model library for adding more providers.
- Removed 21 dead i18n keys; fixed stale menu paths; bilingual strings for new flows.

## 0.4.0 — 2026-08-12

- Host-context delegation for Codex; composable shortcuts; bilingual control center.
