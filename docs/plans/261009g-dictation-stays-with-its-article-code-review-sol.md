F1 — P1 — [chat.md](/var/tmp/spideryarn-worktrees/fbvzj8fc-dictation-cross-article/src/web/help/pages/modes/chat.md:73), [dictation.md](/var/tmp/spideryarn-worktrees/fbvzj8fc-dictation-cross-article/docs/project/dictation.md:358): documentation still said Annotate’s double press “sends.” Changed it to distinguish send, save, and Enter, matching the code.

F2 — P2 — [dictation-button-card.test.tsx](/var/tmp/spideryarn-worktrees/fbvzj8fc-dictation-cross-article/tests/dictation-button-card.test.tsx:81): tooltip tests did not cover the `aria-describedby` merge, the live `again` click window, or Annotate’s strip copy. Added non-vacuous assertions for all three.

F3 — P2 — [chat-dictation-keeper-per-conversation.test.tsx](/var/tmp/spideryarn-worktrees/fbvzj8fc-dictation-cross-article/tests/chat-dictation-keeper-per-conversation.test.tsx:154): the test only proved `Composer` accepted an arbitrary `keepAs`; both real callers could regress. Added coverage of ChatPanel’s open-thread and new-conversation callers and ChatDialog’s passage-draft caller. Updated the plan’s previously declined F6 disposition accordingly.

F4 — P2 — [dictation.md](/var/tmp/spideryarn-worktrees/fbvzj8fc-dictation-cross-article/docs/project/dictation.md:435), [dictation-keep.ts](/var/tmp/spideryarn-worktrees/fbvzj8fc-dictation-cross-article/src/web/dictation-keep.ts:385), [transcriber.ts](/var/tmp/spideryarn-worktrees/fbvzj8fc-dictation-cross-article/src/web/transcriber.ts:104): examples still advertised the unsafe article-wide `chat:<slug>` keeper. Updated them to scoped examples.

The keeper audit otherwise checks out: production article/kind/thread transitions remount or key their components appropriately; ChatDialog target changes correctly refuse delivery to a different passage; CommandBar always receives an article in production; Annotate is remounted by article and anchor. The tooltip preserves both descriptions, disables while recording/transcribing/disabled/offline, and leaves the second press to `again`.

Checks: 101 tests passed across 10 files; full typecheck passed all projects; focused lint passed; `git diff --check` passed. The `npm run typecheck` wrapper itself hit sandbox IPC `EPERM`, so I ran the same repository typecheck script directly with Node.

Verdict: approved after fixes; no remaining P0/P1/P2 findings.