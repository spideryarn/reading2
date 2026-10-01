Found and fixed two issues; no commit made.

| ID | Severity | Finding | Status | Proving test |
|---|---|---|---|---|
| N-1 | P1 | `settled` captured rendered `state`, so an operation registered before React’s next render could still be followed by DELETE. | Fixed by reading `controller.state` at invocation in [useChat.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb-remember-own-thread/src/web/useChat.ts:934). | [remember-own-thread.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb-remember-own-thread/tests/remember-own-thread.test.tsx:336), observed failing before the fix. |
| N-2 | P3 | The cap lacked an exact test, and one source comment still said “about half the band.” | Fixed comment and added a 390px × 30% = 117px assertion. | [remember-panel.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb-remember-own-thread/tests/remember-panel.test.tsx:303). |

The corrected gate closes C1/R2-1 across the named paths:

- F3 coalescing moves the operation to the canonical ID, keeping it unsettled until completion; the provisional ID cannot authorize deletion. Proved at [chat-server-id-coalesces.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb-remember-own-thread/tests/chat-server-id-coalesces.test.ts:99).
- A server-loaded `pending` row is already server-named. Its status alone does not block deletion; once this tab registers recovery, that operation blocks it. Either state avoids provisional-ID deletion. Proved at [chat-server-id-coalesces.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb-remember-own-thread/tests/chat-server-id-coalesces.test.ts:135).
- Live’s stop drains and awaits its spoken-write queue before resolving; DELETE begins afterward. Component ordering remains covered at [remember-own-thread.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb-remember-own-thread/tests/remember-own-thread.test.tsx:359).

No active test or documentation still claims a 45% cap. The remaining “45%” mentions explicitly record the discarded value.

Validation: 10 client Vitest files, 275 tests passed. Biome lint exited successfully with one pre-existing `ChatPanel` complexity advisory.