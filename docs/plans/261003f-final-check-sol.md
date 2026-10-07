Verdict: **land with these fixes**.

- **F19 — P1 — fixed.** F18’s helper disagreed with the renderer for list items and invalid tokens, normalized CRLF, and could drop visible text on mixed-token lines. Copying now follows Markdown structure plus the renderer’s contextual `chipFor` decision. Streaming answers expose no Copy button. [citable.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/src/citable.ts:136), [ChatPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/src/web/ChatPanel.tsx:1559), [tests](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/tests/copy-answer-leaves-out-command-tokens.test.ts:15).

- **F20 — P2 — fixed.** Help and the feedback closure promised every requested chat action would produce a button, while the committed eval records 15/17. They now say Chat “can offer” one. [help-modes.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/src/web/help/help-modes.tsx:170), [feedback note](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/docs/user-feedback/260929_1748-commands-with-arguments-and-the-same-actions-in-chat.md:51).

- **F21 — P3 — fixed.** The feedback note incorrectly claimed one shared command list, despite chat’s explicit `CHAT_PROPOSABLE` allowlist. Help also promised any existing glossary entry would open, while matching is against the visible list. Both are corrected. [feedback note](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/docs/user-feedback/260929_1748-commands-with-arguments-and-the-same-actions-in-chat.md:44), [help-topics.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/src/web/help/help-topics.tsx:359).

All other listed documentation matches HEAD. No wider product finding.

Checks:

- 7 focused files, 169 tests passed.
- Full repository typecheck passed; all 2,843 source files covered.
- Biome passed with one pre-existing `ChatPanel` complexity info.
- Mutation correctly failed the prose-preservation test.
- `git diff --check` passed.
- No network, loopback, commit, or deployment.
- The pre-existing untracked final-check prompt remains untouched.