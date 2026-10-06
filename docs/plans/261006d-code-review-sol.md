**Approve with changes.** Three P1 findings fixed in the worktree, without committing.

- **P1 — Unsaved drafts could disappear** at [reduce.ts:1115](/var/tmp/spideryarn-worktrees/qi-wymmkx8q-chat-pre-stream-500/src/web/chat/reduce.ts:1115). A failed initial Send leaves rows that can be retried or edited. Their subsequent failure started a repair that could erase the typed question. **Fixed:** the two new withdrawal paths require a confirmed conversation. Four Retry/Edit × failure/disconnect cases were red first in [chat-reduce.test.ts:973](/var/tmp/spideryarn-worktrees/qi-wymmkx8q-chat-pre-stream-500/tests/chat-reduce.test.ts:973).

- **P1 — `discardedBy` protected persisted rows** at [reduce.ts:978](/var/tmp/spideryarn-worktrees/qi-wymmkx8q-chat-pre-stream-500/src/web/chat/reduce.ts:978). Another Retry or begun Send could keep rows the edit had deleted beneath its replacement answer. **Fixed:** only unbegun Send rows receive protection. Both cases reproduced red in [chat-reduce.test.ts:848](/var/tmp/spideryarn-worktrees/qi-wymmkx8q-chat-pre-stream-500/tests/chat-reduce.test.ts:848) and line 946.

- **P1 — Replacement or failed repairs forgot an edit’s discard** at [reduce.ts:903](/var/tmp/spideryarn-worktrees/qi-wymmkx8q-chat-pre-stream-500/src/web/chat/reduce.ts:903). Later repairs and spoken writes could restore the deleted answer. **Fixed:** unresolved exclusions survive independently of the read and clear after reconciliation. Six cases reproduced red in [chat-reduce.test.ts:881](/var/tmp/spideryarn-worktrees/qi-wymmkx8q-chat-pre-stream-500/tests/chat-reduce.test.ts:881) and line 918.

The original behavioral regressions turn red when withdrawal is removed; the Send and post-`begin` tests correctly remain green as controls. The fake-server assertions are not vacuous. Added controller tests verify one `onSettled` call after successful or failed repair, for both failure and disconnect, including after detach. Corrected affected comments; found no contradictory claim in `chat-tools.md` or `comments.md`.

Wider findings left unchanged:

- **P1 F3:** held Stop is forgotten before `begin` — [reduce.ts:807](/var/tmp/spideryarn-worktrees/qi-wymmkx8q-chat-pre-stream-500/src/web/chat/reduce.ts:807).
- **P1 F4:** ordinary repair reads remain unbounded — [controller.ts:661](/var/tmp/spideryarn-worktrees/qi-wymmkx8q-chat-pre-stream-500/src/web/chat/controller.ts:661).
- **P3 F5:** the optimistic edited title survives repair — [reduce.ts:1215](/var/tmp/spideryarn-worktrees/qi-wymmkx8q-chat-pre-stream-500/src/web/chat/reduce.ts:1215).
- **P2:** Retry/Edit cannot resubmit provisional message IDs; the older 409 path still permits unnamed-draft removal — [reduce.ts:1165](/var/tmp/spideryarn-worktrees/qi-wymmkx8q-chat-pre-stream-500/src/web/chat/reduce.ts:1165).

Validation: final chat unit/doc-link run **1,013 passed**, with nine failures caused by blocked `tsx` IPC. The requested full chat command was blocked by database access restrictions. `npm run typecheck` hit the same IPC restriction; its unchanged script passed via `node --import tsx`. Lint reported only the existing complexity advisory.