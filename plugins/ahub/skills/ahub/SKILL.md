---
name: ahub
description: Use when the user invokes @ahub or asks to continue the current conversation with an external model (DeepSeek or any other connected ahub provider), delegate analysis with host context, choose a context scope, use an ahub shortcut, or create a reusable routing shortcut.
---

# ahub

Keep the user in the current host conversation. Use ahub's MCP tools directly; do not launch `ahub ask`, Codex CLI, or Claude Code merely to talk to an external model. Any connected provider works — DeepSeek is the built-in default, and users can register more (for example OpenAI-compatible gateways) with `ahub provider add`.

## Natural-language workflow

1. Infer the requested model, context scope, and working role from the user's words. Natural language is primary; shortcuts are optional.
2. Call `status` when provider readiness, the active model, or a custom shortcut is uncertain. `status` lists every configured provider and whether it is connected, plus the active (current) model.
3. Build `context` only from information currently visible to the host. Never read internal transcript files such as `~/.codex/sessions`.
4. Remove secrets, credentials, private keys, environment values, and irrelevant history. The MCP server also redacts common secret patterns (API keys, AWS/Google/Slack/GitHub tokens, JWTs, Bearer tokens) as defense in depth — but still select context carefully.
5. Call `delegate` with the user's task and the smallest sufficient context. The response streams token-by-token where the host renders progress notifications; you still return the full assembled answer.
6. Return the delegated answer in the same conversation. Label it briefly with the model/provider and context scope. The result also carries `tokens`, `estimatedCostUsd`, `elapsedMs`, `contextTruncated`, and `streamInterrupted` — mention cost/tokens when useful; if `contextTruncated` is true, tell the user the shared context was shortened; if `streamInterrupted` is true, warn that the answer may be incomplete and offer to retry. Do not expose tool plumbing.

If the needed provider is not connected, call `status` to confirm, then connect it one of two ways — **never ask the user to paste an API key into the conversation**:
- If the user has the key in a local file, call `connect` with `{ provider, keyFile }`. It reads the key from disk, validates it against the provider, and stores it in ahub's private credential store; the key never enters the conversation and is never echoed back.
- Otherwise tell the user to run `ahub auth set <provider>` (interactive, hidden input) or `ahub auth set <provider> --key-file <path>` in a terminal, then re-check with `status`.

## Context policy

- `brief`: current request plus essential facts or snippets. Use for calculations, rewrites, and focused questions.
- `related`: current request plus a concise summary of relevant prior discussion, named files, and important tool results. This is the default.
- `full`: the broad host-visible context. Explain what will be shared and obtain explicit confirmation before calling with `confirmed: true`.
- `fresh`: current request only, for an independent second opinion.

Do not imply that the delegated model receives the host's hidden state or entire transcript. The host selects and supplies context explicitly. ahub caps host context at 60,000 characters; when the slice is shorter than what you supplied, the result's `contextTruncated` flag is true and the model is told it received a partial view — prefer `related` over `full` to avoid truncation.

## Working roles

- `architect`: analyze, compare approaches, and recommend; do not claim edits.
- `coder`: produce implementation-ready guidance; the host remains responsible for applying and verifying changes.
- `reviewer`: independently identify concrete risks and missing evidence.
- `general`: direct conversation or questions without a specialized role.

## Models and the active model

- Every model in the library that has a connected provider can be delegated — not only DeepSeek.
- The **active model** is the sticky default that `@ahub /ds` and a bare `@ahub` request delegate to. Switch it with "use <alias>", "切到 <alias>", or "make <alias> the default".
- "this time / 这次" overrides the model for one request; "from now on / 以后 / default" persists the active model (handled via `@ahub-config`).

## Delegation memory and threads (multi-turn collaboration)

By default each `delegate` is stateless. To make a delegated model **continue across turns** (so you can proactively re-invoke it to keep solving a problem), use threads and recall:

- **Continue a thread**: pass `threadId` (any stable name, e.g. `"auth-design"`), or `continue: true` to resume the most recent thread. ahub replays that thread's prior task→answer turns as the model's own earlier messages, so it remembers what it said — using only its own prior delegations, never the host's full transcript.
- **Recall what it said**: call `recall` (optionally with a `threadId`) to retrieve prior delegations from ahub's local memory — the host's way to obtain the sub-agent's context. Use it before re-invoking, or when the user asks "what did DeepSeek say earlier".
- **Proactively re-invoke**: when a later step needs the same model to refine/extend earlier work, call `delegate` again with the same `threadId` (or `continue: true`) plus the new task. Don't re-summarize the whole history yourself — the thread already carries it.

Delegations are stored locally in `.ahub/delegations.jsonl` (gitignored, owner-only; task/output/context are already redacted and context is capped). Users can disable logging with `delegationLog: false` in config. Use the `forget` tool only when the user explicitly asks to clear delegation history or delete a thread. When you continue a thread, tell the user briefly that the model is resuming prior context.

To migrate a conversation to another AI client, call the `export` tool (optionally with a `threadId`): it writes a self-contained Markdown document — tasks, the shared host context, and answers — under `.ahub/exports/` and returns the path. Tell the user where the file is and that they can feed it to ChatGPT, Cursor, or another agent as context. The export covers only what ahub recorded (its own delegations), never the host's full transcript.

## Shortcuts

Parse leading shortcuts, remove them from the task, and pass them in `shortcuts`. Shortcuts compose across dimensions; later explicit natural-language instructions win.

- Model: `/ds`, `/native`. `/ds` means the active (current) model — any connected provider, not a hard-coded model ID.
- Context: `/brief`, `/related`, `/full`, `/fresh`
- Role: `/analyze`, `/code`, `/review`

Examples:

- `@ahub /ds 继续分析刚才的方案` → active model, related context, general role.
- `@ahub /ds /fresh /review 审查这个结论` → active model, no prior context, reviewer.
- `@ahub 用 fast 完整阅读当前讨论后给实现方案` → the `fast` alias, full context after confirmation, coder.

Custom shortcuts live in `.ahub/config.json` and appear in `status`. A shortcut may select any enabled, provider-backed model-library alias plus context and role. Treat it as a preference; explicit natural language wins. Use `ahub shortcut set` only when the user asks to save a persistent shortcut; do not teach its syntax unless requested.
