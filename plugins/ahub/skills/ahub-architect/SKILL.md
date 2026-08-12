---
name: ahub-architect
description: Use when the user selects @ahub-architect or asks an architecture, planning, decomposition, tradeoff, or technical direction question through ahub without modifying files.
---

# ahub architect

Delegate the complete request to the read-only architect role.

1. If `.ahub` is not initialized, run `ahub setup`.
2. Translate natural one-request choices into `--cli` and `--model`. “用 Claude Code 自带模型” becomes `--cli claude --model inherit`; “用便宜模型” becomes `--model ds4f`. Do not persist these choices.
3. Preserve explicit leading commands such as `/ds4f`, `/cc`, and `/cx` for power users.
4. Run `ahub ask architect [--cli ...] [--model ...] -- "<complete task>"`. Always include the separator.
5. Return the result directly. Do not modify files yourself.

If a runtime reports missing credentials, explain which environment variable or login is required. Do not silently change providers.
