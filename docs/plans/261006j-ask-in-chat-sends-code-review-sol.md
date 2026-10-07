## Findings

- **CR-1 — P1 — fixed** — [Reader.tsx](/var/tmp/spideryarn-worktrees/qi-av4qxhpb-ask-in-chat-sends/src/web/reader/Reader.tsx:982): a follow-up asked while Chat or Learn was already open was placed in a suppressed floating dialog, so it did not send and could send unexpectedly after a later mode change. Passage questions now use the mounted Chat handoff path while preserving their anchor and `sourceCommentId`.
  - Red test: `sends the follow-up at the press instead of hiding it until a later mode change`.

- **CR-2 — P1 — fixed** — [ConversationModes.tsx](/var/tmp/spideryarn-worktrees/qi-av4qxhpb-ask-in-chat-sends/src/web/modes/conversation/ConversationModes.tsx:867): StrictMode’s synthetic cleanup detached `onThreadId` after an effect-triggered send. If the server corrected the guessed thread ID, the URL and comment’s local link retained the wrong ID. The send is now queued past StrictMode cleanup and still runs once.
  - Red test: `reports both the guessed and corrected id for a saved-comment handoff`.

- **CR-3 — P1 — fixed** — [help-modes.tsx](/var/tmp/spideryarn-worktrees/qi-av4qxhpb-ask-in-chat-sends/src/web/help/help-modes.tsx:730) and adjacent docs/comments still said several paid presses waited for Send. Corrected Debate claim help, Glossary/Debate/Summary docs, Ask AI comments, and command-bar wiring documentation.
  - Red test: none; textual consistency finding.

Ask AI’s whole-app test confirms the comment POST happens before the chat POST and `sourceCommentId` reaches the server. Summary and the command-bar suggestion still wait. I found no stale-target failure caused by `sendToRef`; the reproducible StrictMode defect was the callback teardown above.

Checks:

- Requested suites plus added regressions: 11 files, 202 tests passed.
- Documentation links: 17 passed.
- Typecheck: all four projects passed, covering 3,334 source files.
- Lint: no errors; existing complexity/optional-chain advisories remain.
- `npm test` could not start the database lanes because local Postgres/Docker is inaccessible in this sandbox.
- The literal `npm run typecheck` hit the sandbox’s `tsx` IPC restriction; the same script passed via `node --import tsx scripts/typecheck.ts`.

Files edited:

- `docs/project/comments.md`
- `docs/project/debate.md`
- `docs/project/glossary.md`
- `docs/project/summaries.md`
- `src/web/AnnotateDialog.tsx`
- `src/web/DebatePanel.tsx`
- `src/web/OriginChat.tsx`
- `src/web/command-proposal.ts`
- `src/web/help/help-modes.tsx`
- `src/web/modes/conversation/ConversationModes.tsx`
- `src/web/reader/Reader.tsx`
- `tests/conversation-band-handoff.test.tsx`
- `tests/conversation-band-origin.test.tsx`
- `tests/help-sends-once.test.tsx`
- `tests/selecting-applies-the-highlight.test.tsx`

No commit was made.

VERDICT: ship with my fixes