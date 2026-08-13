# Changelog

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
