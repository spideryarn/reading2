# Code review — 261020a

Verdict: **fixed before commit**. I found four in-scope issues, including two ways the new
About-you save coordination could make the Open controls say more than they had earned. The fixes
are in this worktree.

## Findings

1. **P1 — Retrying a refused About-you save could open the article before the retry answered.**
   `profile.commit()` changes the hook's internal request state synchronously but React does not
   replace the render snapshot synchronously. The built handler tested only `dirty`, `saving`, and
   `inFlight` in that old snapshot, so an old `error` meant “not waiting”: a second press started
   the PATCH and immediately called `leave`. The corrected decision includes every unsaved state at
   [`src/web/AddPage.tsx:1479`](../../src/web/AddPage.tsx#L1479), and the regression holds the retry
   unanswered at [`tests/add-page-purpose.test.tsx:1723`](../../tests/add-page-purpose.test.tsx#L1723).

2. **P1 — One refused save exposed “Open without saving” while the other box's PATCH was still in
   flight.** The built waiting effect stopped on either refusal without first draining the other
   request, and the button was keyed only to refusal. `abandon()` prevents a future/unmount write;
   it cannot recall a PATCH already sent. Pressing the button could therefore save one of the two
   drafts behind a control that promised not to save either. The relevant coordination is at
   [`src/web/AddPage.tsx:1495`](../../src/web/AddPage.tsx#L1495) and the button gate at
   [`src/web/AddPage.tsx:1594`](../../src/web/AddPage.tsx#L1594); the mixed-outcome regression is at
   [`tests/add-page-purpose.test.tsx:1745`](../../tests/add-page-purpose.test.tsx#L1745).

3. **P2 — An untouched repeat paste still showed the completion action only once, at the bottom.**
   The new shared `ReadyBar` was rendered twice only for `phase.kind === "ready"`; the existing
   `repeat` branch kept its single old block. That contradicted plan A4's explicit “`ready`, and
   `repeat`” scope and left the long-page repeat path without the top action. Both waiting phases
   now share the same two bars at [`src/web/AddPage.tsx:1582`](../../src/web/AddPage.tsx#L1582),
   rendered at [`src/web/AddPage.tsx:1630`](../../src/web/AddPage.tsx#L1630) and
   [`src/web/AddPage.tsx:1964`](../../src/web/AddPage.tsx#L1964). StrictMode coverage is at
   [`tests/add-page-purpose.test.tsx:1439`](../../tests/add-page-purpose.test.tsx#L1439).

4. **P3 — A failed counted-progress write was logged as a failed “preview” write.** The refactor
   made previews and progress reports share one queue but left the old diagnostic text, so the only
   debug evidence for a progress-write failure named the wrong feature. It now says “step note not
   written” at [`src/jobs.ts:1290`](../../src/jobs.ts#L1290); the settlement test's names/comments
   now likewise call both `preview` and `progress` transient at
   [`tests/store-jobs-parity.test.ts:1900`](../../tests/store-jobs-parity.test.ts#L1900).

## What I changed

1. Treated an offered About-you box's `error` as pending when Open retries it, and derived the
   first successful empty-profile answer in the same render as well as latching it. This closes the
   passive-effect race where the answer existed but the latch's state update had not rendered.
2. Kept the Open transition waiting until every already-sent purpose/profile request settles, and
   hid “Open without saving” while either request is in flight. Once both settle, a refusal still
   leaves both drafts visible and offers the escape; that escape abandons both drafts.
3. Replaced the separate repeat block with the same `ReadyBar` used by an ordinary ready import, at
   both page positions and with the existing repeat-specific sentence and once-guarded handler.
4. Corrected the shared transient-write diagnostic and the stale settlement-test wording. I also
   changed the new type-only `SaveState` import to an `import type` after the scoped lint identified
   it.

## Reviewed without another finding

- `stepNotes` writes only counted reports, saves the first and then at most once per five seconds,
  serializes reports with previews, ignores reports after `settle()` starts, and swallows transient
  write failures including `StaleAttemptError`. Both the success path and catch path await
  `settle()` before the authoritative commit/settlement; a new run deletes old `progress`.
- `settledSteps` removes `preview` and `progress` on every settlement arm, and removes `detail` only
  from a step that was running. Its interrupted branch supplies `step.error`, which is what the UI
  renders; completed product detail remains untouched. I found no consumer that needs a running
  report's detail after pause, requeue, expiry, or Stop.
- The focused tests cover the new visible bar, write throttling, late-snapshot ordering, success and
  failure cleanup, and all six external settlement doors. The two AddPage gaps above were not
  covered until the regressions added in this review; each was watched red before the fix.

## Verification

- `npx vitest run tests/add-page-purpose.test.tsx` — **107 passed**.
- `npx vitest run tests/job-card-progress.test.tsx` — **18 passed**.
- The requested four-file Vitest command could not collect tests because this sandbox was refused
  access to local Postgres: `connect EPERM 127.0.0.1:54362`. Therefore
  `tests/jobs-walk.test.ts` and `tests/store-jobs-parity.test.ts` are **not claimed as run** here.
- `npm run typecheck` itself could not create tsx's IPC socket (`listen EPERM
  /tmp/tsx-1000/93.pipe`). Running the same script without the tsx CLI IPC layer,
  `node --import tsx scripts/typecheck.ts`, passed all four projects and reported all **3,848**
  source files covered.
- `npm run lint:hook-deps` — passed, 4,529 files checked.
- Scoped Biome lint — no warnings after the type-only import fix; only the repository's existing
  advisory complexity notices in `AddPage`, `runStep`, `walkClaim`, and `enqueue`.
- `git diff --check` — passed.
