1. **P1 — microphone claim could be released while the fallback track remained live.** [src/web/useDictation.ts:1473](/home/greg/code/spideryarn2/.claude/worktrees/fb-autosave-mic/src/web/useDictation.ts:1473)  
   `listInputs()` introduced an await before `s.track` was assigned. Stopping during that await made `finish()` release the page-wide mic claim without stopping the track, allowing another capture alongside it. Fixed by assigning ownership before the await; added a red-then-green lifecycle regression at [tests/dictation-phases.test.ts:1448](/home/greg/code/spideryarn2/.claude/worktrees/fb-autosave-mic/tests/dictation-phases.test.ts:1448).

2. **P2 — a failed autosave could leave a false, permanent error and leave warning.** [src/web/useAutosavedText.ts:117](/home/greg/code/spideryarn2/.claude/worktrees/fb-autosave-mic/src/web/useAutosavedText.ts:117)  
   After a refusal, changing the draft back to the stored value left the old error active. `commit()` then correctly did nothing, but the UI continued saying “Not saved” and `beforeunload` continued warning. Fixed by clearing the attempt-specific error when the draft changes; regression at [tests/autosaved-text.test.tsx:87](/home/greg/code/spideryarn2/.claude/worktrees/fb-autosave-mic/tests/autosaved-text.test.tsx:87).

3. **P3 — synchronous `save()` failure had no direct regression test.** [tests/autosaved-text.test.tsx:131](/home/greg/code/spideryarn2/.claude/worktrees/fb-autosave-mic/tests/autosaved-text.test.tsx:131)  
   The implementation already converts a synchronous throw into the promise chain, reaches `finally`, clears `inFlight`, and permits a later save. Added a test proving the queue does not become stuck; no source fix was needed.

I found no further issues in the serial queue, epoch handling, conditional write-back, page lifecycle listeners, ProfileBox timer/busy gating, Metadata PATCH body, fallback identity rules, or legacy preference handling. Nothing remains for you inside the reviewed scope.

Test results:

- Requested Vitest command: **passed** — 6 files, 110 tests.
- `npm run typecheck`: the `tsx` launcher was blocked by the sandbox from creating `/tmp/tsx-1000/*.pipe` (`EPERM`), before the typecheck script ran.
- Equivalent direct invocation, `node --import tsx scripts/typecheck.ts`: **passed** — all four TypeScript projects and all 2,543 source files covered.