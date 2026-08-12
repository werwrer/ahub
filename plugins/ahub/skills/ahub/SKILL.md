---
name: ahub
description: Use when the user invokes @ahub or asks to continue the current conversation with DeepSeek or another ahub model, delegate analysis with host context, choose a context scope, use an ahub shortcut, or create a reusable routing shortcut.
---

# ahub

Keep the user in the current host conversation. Use ahub's MCP tools directly; do not launch `ahub ask`, Codex CLI, or Claude Code merely to talk to DeepSeek.

## Natural-language workflow

1. Infer the requested model, context scope, and working role from the user's words. Natural language is primary; shortcuts are optional.
2. Call `status` when provider readiness or a custom shortcut is uncertain.
3. Build `context` only from information currently visible to the host. Never read internal transcript files such as `~/.codex/sessions`.
4. Remove secrets, credentials, private keys, environment values, and irrelevant history. The MCP server also redacts common secret patterns as defense in depth.
5. Call `delegate` with the user's task and the smallest sufficient context.
6. Return the delegated answer in the same conversation. Label the model and context scope briefly; do not expose tool plumbing.

If DeepSeek is not connected, tell the user to run `ahub` and choose **Models & API keys → DeepSeek → Connect**. Never request an API key in chat.

## Context policy

- `brief`: current request plus essential facts or snippets. Use for calculations, rewrites, and focused questions.
- `related`: current request plus a concise summary of relevant prior discussion, named files, and important tool results. This is the default.
- `full`: the broad host-visible context. Explain what will be shared and obtain explicit confirmation before calling with `confirmed: true`.
- `fresh`: current request only, for an independent second opinion.

Do not imply that DeepSeek receives the host's hidden state or entire transcript. The host selects and supplies context explicitly.

## Working roles

- `architect`: analyze, compare approaches, and recommend; do not claim edits.
- `coder`: produce implementation-ready guidance; the host remains responsible for applying and verifying changes.
- `reviewer`: independently identify concrete risks and missing evidence.
- `general`: direct conversation or questions without a specialized role.

## Shortcuts

Parse leading shortcuts, remove them from the task, and pass them in `shortcuts`. Shortcuts compose across dimensions; later explicit natural-language instructions win.

- Model: `/ds`, `/native`
- Context: `/brief`, `/related`, `/full`, `/fresh`
- Role: `/analyze`, `/code`, `/review`

Examples:

- `@ahub /ds 继续分析刚才的方案` → DeepSeek, related context, general role.
- `@ahub /ds /fresh /review 审查这个结论` → DeepSeek, no prior context, reviewer.
- `@ahub 用便宜模型完整阅读当前讨论后给实现方案` → DeepSeek, full context after confirmation, coder.

Custom shortcuts live in `.ahub/config.json` and appear in `status`. Treat each as a named preset over model, context, and role. Use `ahub shortcut set` only when the user asks to save a persistent shortcut; do not teach its syntax unless requested.
