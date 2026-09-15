# Code review: the Tweets page starts writing when it is opened

## Findings before changes

1. **P1 — The plan still claims that the owner's slots bound automatic Tweets reruns.**
   [docs/plans/260915e-tweets-page-starts-writing-when-opened.md:79](260915e-tweets-page-starts-writing-when-opened.md#what-it-costs-said-out-loud)

   Concrete failure: an owner at their ingest limit, or with no active paid slot, can repeatedly
   reload an empty Tweets page and start a fresh rerun. `POST /api/jobs` reruns deliberately bypass
   `withIngestSlot`; the queue authenticates and owner-scopes the request, but the owner's slots do
   not cap this spend. A future reader relying on this sentence could approve passive generation on
   a defence that does not exist. This is the exact P1 the plan review asked the plan to correct,
   and the plan contradicts its own corrected account at lines 51–55.

   Fix: replace “one per article per tab session, the owner's own article only, the owner's slots”
   with the bounds that actually exist: one automatic attempt per article per page load, only after
   the private owner read succeeds; state again that reruns have no per-owner spend cap.

2. **P2 — The accepted-job-later-fails lifecycle is described but not tested.**
   [tests/tweets-press-starts-it.test.tsx:277](../../tests/tweets-press-starts-it.test.tsx)

   Concrete failure: a later edit could make a `tweets` job reaching `status: "error"` perturb the
   artefact status or remount the arrival hook, causing a second automatic POST after the first
   accepted job fails. The existing refusal case covers a POST that returns no job, not an accepted
   job that later appears in `useJobs().jobs` as failed, so that regression would remain green.

   Fix: let the posed jobs list change identity, accept the first POST, then publish a failed Tweets
   `Job`, rerender, and assert both that the failure is visible and that the POST count remains one.

3. **P2 — Current source and test prose still says the Tweets link or command row arms a run, and
   one test header says arrival does not run at all.**
   [src/web/CommandBar.tsx:37](../../src/web/CommandBar.tsx),
   [src/web/CommandBar.tsx:387](../../src/web/CommandBar.tsx),
   [src/web/command-match.ts:47](../../src/web/command-match.ts),
   [src/web/auto-run-targets.ts:1](../../src/web/auto-run-targets.ts),
   [tests/command-bar.test.tsx:59](../../tests/command-bar.test.tsx),
   [tests/command-bar.test.tsx:672](../../tests/command-bar.test.tsx), and
   [tests/tweets-press-starts-it.test.tsx:3](../../tests/tweets-press-starts-it.test.tsx)

   Concrete failure: an engineer following these live docblocks can reintroduce
   `armActivationForTweets` or preserve activation-specific test setup because the documented
   contract says the row still arms. The test file's headline states the precise opposite of the
   behavior its cases enforce. `AutoRunTarget` also now includes one arrival-triggered target, so
   calling it only the vocabulary of controls that run “on being pressed” is false.

   Fix: describe Tweets as plain navigation to an owner-only page that starts on arrival, retain
   the `generates` marker explanation, correct the command-bar test's activation-reset comment to
   refer to the mode activations it still resets, and describe `AutoRunTarget` as the targets
   eligible for one automatic attempt rather than only press-triggered controls.

**Verdict: PASS WITH FIXES — no P0; one in-scope P1 documentation error and two cheap P2 evidence/prose gaps should be fixed before handoff.**

## What I changed

- **Finding 1:** corrected the plan's remaining slot-bound claim. It now names the real client
  bound — one automatic attempt per article per page load after a successful private owner read —
  and says explicitly that reruns have no per-owner spend cap.
- **Finding 2:** added the accepted-job-later-fails case to
  `tests/tweets-press-starts-it.test.tsx`. The posed job list can now publish a fresh snapshot; the
  test accepts `job1`, publishes it as a failed Tweets job, proves the failure reached the surface,
  and proves the automatic POST count stays at one.
- **Finding 3:** corrected the current docblocks in `CommandBar.tsx`, `command-match.ts`,
  `auto-run-targets.ts`, and the two affected test files. Tweets is now consistently described as
  plain navigation to an owner-only page that starts on arrival; `AutoRunTarget` is the vocabulary
  guarded by `beginAutoAttempt`, not solely controls that arm on a press.

I did not change `Link.tsx`: removing `onNavigate` removed only the callback invocation. Its
`onClick` still runs first; `defaultPrevented`, non-left buttons, modifier keys, and non-`_self`
targets still return before `preventDefault()` and `navigate()`. Repository-wide grep found no
other `Link.onNavigate`, `DockLink.onNavigate`, command `onNavigate`, or
`armActivationForTweets` caller left. The historical mentions that remain are explicitly dated
accounts of the old behavior; the live claims now say that Tweets arms nothing.

The spend/ownership audit also found no code defect: `useAutoRunOnArrival` records the attempt
synchronously before starting work, so StrictMode cannot double-submit; an accepted job failure
does not change the artefact status or re-run the effect; a successful job refreshes to `ready`;
the failed-read path re-reads once and only a resulting `none` can start work; and `Tweets` remains
reachable only from the keyed owner arm of `ArticlePage`, while `VisitorTweetsPage` mounts neither
the private read nor the job hook.

Checks run:

- `npx vitest run tests/tweets-press-starts-it.test.tsx tests/command-bar.test.tsx tests/pressing-a-chip-arms-it.test.tsx`
  — 3 files, 69 tests passed.
- `npx vitest run tests/tweets-press-starts-it.test.tsx tests/pressing-a-chip-arms-it.test.tsx tests/command-bar.test.tsx tests/modes-that-start-themselves.test.tsx tests/public-network-trace.test.tsx tests/tooltip-on-link.test.tsx tests/dock-mode-tooltips.test.tsx tests/dock-corner-controls.test.tsx tests/every-mode-draws-its-surface.test.tsx tests/step-job-force.test.tsx tests/refused-job-reason-survives.test.tsx tests/artefact-read-race.test.tsx`
  — 12 files, 290 tests passed.
- `npx biome lint --max-diagnostics=none src/web/CommandBar.tsx src/web/command-match.ts src/web/auto-run-targets.ts tests/command-bar.test.tsx tests/tweets-press-starts-it.test.tsx`
  — 5 files checked, no findings.
- `npm run typecheck` — the `tsx` launcher was blocked before compilation by this sandbox's Unix
  socket policy (`listen EPERM /tmp/tsx-1000/14.pipe`).
- `node --import tsx scripts/typecheck.ts` — the same repository typecheck script without the
  blocked launcher IPC; all four projects passed and all 2,185 TypeScript source files were covered.

**Post-fix verdict: PASS.**
