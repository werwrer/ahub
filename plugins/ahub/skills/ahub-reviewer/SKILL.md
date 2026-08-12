---
name: ahub-reviewer
description: Use when the user selects @ahub-reviewer or asks for an independent review, risk assessment, regression check, or security inspection through ahub without modifying files.
---

# ahub reviewer

Delegate the complete review request to the read-only reviewer role.

1. If `.ahub` is not initialized, run `ahub setup`.
2. Translate natural one-request choices into `--cli` and `--model`. “用 Claude Code 自带模型” becomes `--cli claude --model inherit`; “用便宜模型” becomes `--model ds4f`. Do not persist these choices.
3. Preserve explicit leading commands such as `/ds4f`, `/cc`, and `/cx` for power users.
4. Run `ahub ask reviewer [--cli ...] [--model ...] -- "<complete task>"`. Always include the separator.
5. Return findings ordered by severity with file references. Do not modify files.

The reviewer starts with fresh result context for independence. Model and CLI commands never grant write access.
