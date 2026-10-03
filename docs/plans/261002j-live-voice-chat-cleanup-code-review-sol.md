## Findings

- P0 — None.

- P1 — [LiveStatus.tsx:117](/home/greg/code/spideryarn2/.claude/worktrees/fbf4eq7p-live-voice-chat-cleanup/src/web/live/LiveStatus.tsx:117): changing the microphone or noise reduction used `stop().then(restart)`, bypassing reconnect cancellation and its “don’t restart after a failed save” guard. A failed save or changed mind could therefore reopen the microphone. Both controls now use `live.reconnect()` and are disabled during connection startup.

- P1 — [useLiveConversation.ts:1384](/home/greg/code/spideryarn2/.claude/worktrees/fbf4eq7p-live-voice-chat-cleanup/src/web/live/useLiveConversation.ts:1384): a visible typed line whose provider acknowledgement never arrived had no ledger owner, so hang-up could not save it and the next Live retry silently cleared it. Remaining non-empty lines are now marked uncertain and retained across retries.

- P2 — [LiveTail.tsx:51](/home/greg/code/spideryarn2/.claude/worktrees/fbf4eq7p-live-voice-chat-cleanup/src/web/live/LiveTail.tsx:51): settled words retained from a failed session were labelled “still arriving” during a retry. That marker now appears only when the exchange actually has unfinished lines.

- P2 — [LiveStatus.tsx:90](/home/greg/code/spideryarn2/.claude/worktrees/fbf4eq7p-live-voice-chat-cleanup/src/web/live/LiveStatus.tsx:90): the documented Stopped state was unreachable when ownerless words remained after hang-up. The status now remains beside those words.

The core handoff is sound: `speak()` installs controller rows synchronously, then `flushSync` removes the live copy. Its call sites run from asynchronous write-queue continuations, not render or effects. Removing `flushSync` made the DOM test fail with a zero-copy frame during missing-exchange 409 repair.

Grouping correctly follows ledger ownership for late R1/U2, typed acknowledgements and retried sessions. The meter clone remains local-only and is stopped on hang-up, reconnect, failure, pre-barrier failure, cancel and mid-connect unmount.

Added coverage for failed-save restoration, pending-save hang-up, ownerless-line retry, clone transport isolation and teardown, and live-tail follow-scroll. The key regression tests were mutation-checked and turned red for the intended reasons.

## Verification

- Requested focused suites: **145 tests passed**.
- Typechecking: all four projects passed; all 2,758 TypeScript sources are covered.
- `git diff --check`: passed.
- Scoped lint: no errors; eight existing complexity advisories.
- Full `npm test` was attempted but could not start its database lane because this sandbox cannot reach Docker/Postgres.
- The literal `npm run typecheck` wrapper cannot create `tsx`’s Unix socket in this sandbox (`EPERM`); running the same checker via `node --import tsx scripts/typecheck.ts` passed completely.

No wider product decision is needed. Nothing was committed.