## Findings

- **CR2-1 — P2 — fixed** — [ConversationModes.tsx](/var/tmp/spideryarn-worktrees/qi-av4qxhpb-ask-in-chat-sends/src/web/modes/conversation/ConversationModes.tsx:1121): corrected saved-comment thread IDs were delivered through the navigation callback, which is intentionally discarded when the band unmounts. Leaving Chat before the server’s `begin` frame left the comment linked locally to the guessed ID until reload. The durable update now uses `onConfirmed`; URL navigation remains in `onThreadId`.
  - Red regression: [conversation-band-origin.test.tsx](/var/tmp/spideryarn-worktrees/qi-av4qxhpb-ask-in-chat-sends/tests/conversation-band-origin.test.tsx:204).

No other findings:

- Chat and Learn each send once. A temporary full-app Learn probe confirmed the hand-off survives switching to Chat.
- The surrounding `setThread(null)` updates precede the hand-off microtask; the fresh thread ID wins.
- The message uses the same `askAboutBlock` construction as the floating dialog, including wordless Ask AI.
- `anchor` and `sourceCommentId` reach the POST.
- The microtask is not exposed to the arrival rule: `started` is set synchronously. StrictMode cancels the first setup and the replay takes once; production’s single setup remains live.

Checks:

- Requested suites: **4 files, 111 tests passed**.
- Typecheck: **3,334 files covered, passed** via `node --import tsx scripts/typecheck.ts`; the npm wrapper hit the sandbox’s `tsx` IPC restriction.
- Touched-file lint: no errors; one existing complexity advisory.
- Doc links plus origin suite: **38 tests passed**.
- Full `npm test` could not start because Postgres/Docker is inaccessible in the sandbox.

Files edited:

- `src/web/modes/conversation/ConversationModes.tsx`
- `tests/conversation-band-origin.test.tsx`
- `docs/postmortems/261006o-a-shorter-lived-navigation-callback-cannot-own-durable-data.md`

No commit made.

**VERDICT: ship with my fixes**