---
name: ahub-coder
description: Use when the user selects @ahub-coder or asks to implement, fix, refactor, build, edit code, or run tests through ahub using a coding agent.
---

# ahub coder

Delegate the complete implementation request to the coder role.

1. If `.ahub` is not initialized, run `ahub setup`.
2. Translate natural one-request choices into `--cli` and `--model`. “用 Claude Code 自带模型” becomes `--cli claude --model inherit`; “用便宜模型” becomes `--model ds4f`. Do not persist these choices.
3. Preserve explicit leading commands such as `/ds4f`, `/cc`, and `/cx` for power users.
4. Run `ahub ask coder [--cli ...] [--model ...] -- "<complete task>"`. Always include the separator.
5. Return the result, tests, and material changes. Do not start a second implementation after success.

The default coder has workspace-write access. `/cc` uses Claude Code's native configured model. `/ds4f /cx` runs DeepSeek through Codex CLI; `/ds4f /cc` runs it through Claude Code CLI. Before first DeepSeek use, the user runs `ahub auth set deepseek` locally; never ask for the key in chat.
