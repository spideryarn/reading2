Stage 2 passes with reviewer fixes. The original candidate had two P1 command-recognition flaws; both are fixed and covered by tests that failed before the fixes.

- **F15 — P1 — fixed.** A complete token at the open end of a streaming answer became pressable before the next delta established whether it stood alone. A hostile quotation could therefore briefly expose an action button. The renderer now holds complete token-only final lines until newline or end-of-stream. Evidence: [Cited.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/src/web/Cited.tsx:565), [command-token.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/src/command-token.ts:101). Red tests: “holds back a half-arrived token…” and “does not briefly offer a completed token…”, [chat-command-chips.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/tests/chat-command-chips.test.tsx:168).

- **F16 — P1 — fixed.** An own-line token inside a Markdown blockquote became a button, allowing quoted hostile article or fetched-page text to cross the proposal boundary. Blockquotes now render without the command executor while retaining links and citations. Evidence: [Cited.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/src/web/Cited.tsx:350). Red test: “is text inside … a blockquote”, [chat-command-chips.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/tests/chat-command-chips.test.tsx:80).

- **F17 — P3 — fixed.** The investigation’s `$1.86` was not reproducible from its checked-in results. The five JSON files total `$1.7892`; `$1.86` includes an unretained smoke run. The scoring description also overstated how closely the line-by-line evaluator mirrors list-item rendering. Evidence: [261003b-chat-proposes-commands-as-chips.md](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/docs/investigations/261003b-chat-proposes-commands-as-chips.md:47). No red test; verified from the saved result files and scoring code.

- **F18 — P1 — not fixed in Stage 2.** “Copy answer” still copies the raw token because it receives and writes `message.text` unchanged: [ChatPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/src/web/ChatPanel.tsx:1558), [ChatPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbwh2xys-commands-with-arguments/src/web/ChatPanel.tsx:1775). This cannot execute anything, but it exposes implementation syntax to the reader. The plan explicitly assigns it to Stage 3; a regex fix here would incorrectly rewrite tokens in code, links, or quotations. It should remain release-blocking for Stage 3.

Mutation checks proved the new tests detect both fixes: disabling the streaming holdback failed two tests; restoring command context inside blockquotes failed the blockquote test.

Checks passed:

- 6 focused test files, 130 tests
- Typecheck: all four projects; all 2,826 source files covered
- Biome lint on the five changed source/test files
- `git diff --check`

No paid eval, network, loopback, commit, or deployment was performed. Concurrent Stage 3 help/docs edits appeared during review; I left them untouched except for aligning their new command-button documentation with the blockquote fix.

**Verdict:** Stage 2 approved with the F15–F17 fixes currently in the worktree. The overall feature is not release-complete until Stage 3 resolves F18.