You are reviewing code in this worktree, and you may fix what you find.

The work: docs/plans/261024z-dictation-asks-for-the-microphone-inside-the-press.md (the plan, revised
after your own plan review, which is docs/plans/261024z-plan-review-sol.md). The diff is
docs/plans/261024z-code-review.diff; read the changed files themselves too:
src/web/useDictation.ts (earlyRequest, discardEarly, adoptEarly, start()'s claim/early ordering,
Session.early, finish's `free`), src/web/mic-lock.ts (microphoneFree), src/web/mic-devices.ts
(idealConstraint), tests/dictation-phases.test.ts (§ "the request inside the press", the fixture's
getUserMedia and fakeTrack changes, one older test's holdEnumerationAt), tests/mic-devices.test.ts.

Goal: on non-Chromium browsers, when no other holder has the microphone, call getUserMedia
synchronously inside the press so WebKit counts it as gesture-privileged (a grant then lasts 10
minutes after capture rather than 1 on iOS/iPadOS). Chromium must be unchanged.

Check especially:
1. Ownership: every way a session can end or be superseded while the early request is pending —
   Stop, a second press in the same box, unmount (finish quiet), another box claiming
   (claim.stop), chooseDevice restarting, beginCapture failing — stops the early track and releases
   the claim exactly once, and only after the track is stopped. No path leaves a live track or a
   claim held forever. Look for double-release or a release before stop.
2. The order: microphoneFree() read, then claimMicrophone (sync install), then getUserMedia. Is
   microphoneFree correct given `outstanding` is cleared when released resolves (a microtask later),
   and given Live's claims (src/web/live/*)? Can a just-finished session's claim still be
   outstanding when a fast second press arrives, and is the old path then still correct?
3. adoptEarly: honoured semantics (`preferred === null || openedId(track) === preferred`) and the
   caller's judgeFallback branch, failureCause/chosenMic values, micError on rejection,
   "no-track". Anything the ordinary path did after capture that the early path now skips?
4. Tests: does each new test fail without the code it guards? The fixture change (one track per
   stream; stop counted once) — does it weaken any existing test?

Fix real defects in place (keep the house style: comments explain why, quote reports, no new
dependencies), run `npx vitest run tests/dictation-phases.test.ts tests/mic-devices.test.ts` and
`npm run typecheck`, and write your findings to the output file as a numbered list, most severe
first, each saying what you changed (or why you did not) with file:line. Report anything wider
than this stage for me to decide rather than doing it.
