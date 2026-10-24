# Code review: dictation asks inside the press

1. **P1 — Stop and unmount gave the pending early request two cleanup owners. Fixed.**
   `finish()` captured `Session.early` and called `discardEarly`, while the already-suspended
   `adoptEarly` continuation stopped the same returned track again; the earlier stale-after-claim
   branch also had its own release path. The original fake made the second `stop()` invisible by
   counting only the transition to `ended`. I reproduced both Stop and unmount at two raw stop calls,
   then made the early request hold one memoized discard promise, routed stale sessions through
   `finish()`, and made `finish`'s `free` once-only. The claim is now released by one owner, after
   the shared discard has stopped every stream track. The `no-track` result also discards the whole
   stream before returning instead of assuming it contains nothing else
   (`src/web/useDictation.ts:1002`, `src/web/useDictation.ts:1717`,
   `src/web/useDictation.ts:2455`, `src/web/useDictation.ts:2514`,
   `src/web/useDictation.ts:2544`). The red-first assertions and the added pending-unmount,
   pending-`chooseDevice`, and no-audio-track cases are at
   `tests/dictation-phases.test.ts:1892`, `tests/dictation-phases.test.ts:1910`,
   `tests/dictation-phases.test.ts:1953`, and `tests/dictation-phases.test.ts:1992`.

2. **P2 — One older ownership test was green without reaching the await it claimed to test. Fixed.**
   The early path removed both pre-capture enumerations, but “keeps the fallback track inside the mic
   claim” still held enumeration 3. No third call existed, `releaseEnumeration` stayed null, and the
   test passed without exercising a stop during the post-capture device check. A positive-control
   assertion failed first; the test now holds call 1 and asserts the held check actually began
   (`tests/dictation-phases.test.ts:1764`). The one-track-per-stream fixture is an improvement, not a
   weakening, but its realistic idempotent `stop()` did conceal duplicate cleanup. I kept the
   once-only state-transition count and added a separate raw-call count so both properties are
   observable (`tests/dictation-phases.test.ts:203`).

3. **No further defect in lock ordering or adoption semantics. No change.** `start()` reads
   `microphoneFree()`, installs its claim synchronously, then calls `getUserMedia`; Live's two claim
   implementations enter the same `outstanding` set and resolve only after stopping their tracks
   (`src/web/mic-lock.ts:78`). A released claim remains in the set until its promise reaction runs,
   so a same-task restart conservatively takes the ordinary waiting path. That is correct for
   `chooseDevice`, and a separate physical press cannot arrive before the event's microtask
   checkpoint. `adoptEarly` preserves `preferred === null || openedId(track) === preferred`, reports
   rejection names and `no-track`, and leaves the existing caller to set `failureCause`,
   `chosenMic`, and run `judgeFallback` (`src/web/useDictation.ts:2544`). The post-capture meter,
   recording, label, fallback-name check, and error paths remain shared with ordinary capture.

4. **The new suite has both feature tests and unchanged-path regression tests. No change needed.**
   The synchronous Safari/Firefox, repeated-press, pending-owner, and picked-device cases fail when
   the early path is removed. The Chromium-order test intentionally passes the old implementation,
   because its contract is that Chromium does not change; the refusal and claim-before-request cases
   also protect pre-existing semantics rather than prove the new call position. The fixture now
   makes those distinctions explicit instead of treating every green regression check as evidence
   for the feature. The known Chat handoff from active/connecting Live remains outside this stage,
   as the revised plan says; I found no new wider-stage issue.

Checks: `npx vitest run tests/dictation-phases.test.ts tests/mic-devices.test.ts` passed, 98 tests.
The repository-wide `npm test` gate could not collect tests because this sandbox cannot reach the
local Postgres/Docker service (`connect EPERM 127.0.0.1:54362`); it failed explicitly rather than
skipping the database suites.
The requested `npm run typecheck` could not start under this review sandbox because the `tsx` CLI's
local IPC socket was denied (`listen EPERM /tmp/tsx-1000/14.pipe`); running the same driver as
`node --import tsx scripts/typecheck.ts` passed all five projects and confirmed all 4,001 source
files are covered. Touched-file Biome checking reported only the file's existing advisory
complexity findings.

Handoff: the reviewed changes remain uncommitted because this sandbox mounts the worktree's Git
metadata read-only; `check:staged-revert` could not create `.git/worktrees/.../index.lock`, so a
commit and push were not possible here.
