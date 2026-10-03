# Code review: tap to talk when noise holds the live turn open

You are reviewing commit `815f9dc3a` in this worktree (`git show 815f9dc3a`). It builds
docs/plans/261003d-tap-to-talk-when-noise-holds-the-live-turn-open.md, which you reviewed twice
(docs/plans/261003d-tap-to-talk-plan-review-sol.md, then
docs/plans/261003d-tap-to-talk-plan-rereview-sol.md). The plan's § The spike has the results of
`scripts/spike-live-push-to-talk.ts` against OpenAI's real server: the partial session.update is
accepted and keeps the rest of the session, `error.event_id` is our event_id, a hand-made commit comes
back as a normal turn, and background voices reproduce the held-open turn.

The code: src/web/live/useLiveConversation.ts (TalkMode, sendTap, detectorOff, enterTapToTalk, talk,
doneTalking, the `error` handler, the `committed` and `response.created` handlers, start's reset, the
seeding barrier's detectorOff, reconnect's keepTalkMode, the speech_stopped tally),
src/web/live/LiveStatus.tsx, and the tests in tests/live-session-flow.test.tsx and
tests/chat-live-handoff.test.tsx.

**You may fix what you find**, inside this change: edit the files, add or tighten tests, and run
`npx vitest run tests/live-session-flow.test.tsx tests/chat-live-handoff.test.tsx tests/live-stall.test.ts`
and `npm run typecheck`. Do not commit. Do not run the full suite. Anything wider than this change,
report rather than fix.

Look hardest at:
1. Every path that changes `micTrack.current.enabled` — can tap mode ever leave the track enabled
   while Ready or Sending, or disabled while hands-free (seeding barrier, hang-up grace window,
   reconnect, pickers, an entry `session.update` refused after a reconnect)?
2. The error handler: is any tap error mis-recovered (e.g. an error against the reconnect's
   re-sent session.update, a stale event_id from a previous session — tapSeq is never reset), and is
   any non-tap error now swallowed?
3. `tap-sending`: can it get stuck (commit refused, committed lost, response.create refused, hang-up,
   reconnect), and does every exit leave Talk usable or the no-reply stall honest?
4. The ledger: a tap turn has no speech_started, so `ledger.interrupt()`, `toolResponses.interrupt()`
   and `responseStartedDuringTurn` are never touched. Does the stored exchange come out right,
   including a tap turn whose reply is a tool call followed by a continuation?
5. React: state updaters stay pure, refs are the synchronous authority, dependency lists are right.
6. The copy and the UI states in LiveStatus.

Write your findings, P0–P3, each with what you changed or why you did not, and a verdict.
