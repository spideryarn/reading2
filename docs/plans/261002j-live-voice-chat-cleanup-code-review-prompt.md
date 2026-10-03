# Code review: plan 261002j Stage 1 (live voice chat UI), uncommitted in this worktree

Review AND FIX. You may edit files in this worktree to fix real defects you find, inside the scope
below; report anything wider for me to decide. Do not commit, and run no git command that discards
work (this repo bans them — see CLAUDE.md).

Context: `docs/plans/261002j-live-voice-chat-cleanup.md` (Stage 1 plus "After the plan review"),
your own plan review `docs/plans/261002j-live-voice-chat-cleanup-plan-review-sol.md`, and
`docs/project/live-conversation.md` (the three orderings and lifecycle table are load-bearing).

The diff: `git diff HEAD -- src/web tests docs/project/live-conversation.md` plus the new files
`src/web/live/LiveTail.tsx`, `src/web/live/tail.ts`, `tests/live-tail-handoff.test.tsx`. (Stage 0
and 1a — `src/live.ts`, the spike — are already committed at HEAD and are context only.)

Look hardest at:
1. The handoff in `src/web/live/useLiveConversation.ts`: `speak()` first, then removing the live copy
   in a `flushSync` commit. Is "exactly one visible copy" really guaranteed — normal save, slow
   save, 409 repair (stored / missing), failed save restoring lines, interruption, hang-up during a
   pending save, reconnect? Is `flushSync` safe where it is called (not inside a render or effect
   that React will warn about)?
2. Grouping by exchange (`tail.ts`, `ownerOf` in exchanges.ts): late R1 after U2, a typed turn
   placed on its ack, lines with no owner yet, retried sessions.
3. The meter clone: stopped on every teardown path, including abandon on a stale epoch, a failure
   before the barrier lifts, unmount mid-connect; never sent to the peer connection; no leak of a
   live microphone (the browser's recording indicator staying on is the symptom).
4. Cancel reconnect, Try again, Advanced (noise reduction change mid-call reconnects), the
   follow-scroll and empty-thread changes in ChatPanel.tsx.
5. Tests: do the new tests fail for the right reason if the guarantee breaks? Any test that cannot
   go red?

Then run `npx vitest run tests/live-tail-handoff.test.tsx tests/chat-live-handoff.test.tsx tests/live-session-flow.test.tsx tests/chat-live-dictation.test.tsx tests/conversation-band-live.test.tsx` and `npm run typecheck` (both must be green after your fixes).

Write your findings first: P0/P1/P2, file:line, failure scenario, what you changed (or why not).
