# Review: a plan to stop the owner's reading view polling `/api/jobs` every 8s at rest

Repo: /home/greg/code/spideryarn2/.claude/worktrees/fb36-ipad-battery-drain, branch
worktree-fb36-ipad-battery-drain. TypeScript + ESM, React 19 client under `src/web/`, vitest tests
under `tests/`.

## The candidate

Live pre-commit: base 6b738efd; no code changed yet. Untracked: the plan,
`docs/plans/260912a-ipad-battery-drain-the-reading-view-polls-the-job-queue-every-eight-seconds-at-rest.md`.
(Not durable — I will record the resulting commit SHA here once it lands.)

Start with the plan, then `src/web/jobEngine.ts` (the `schedule` rule, `subscribe`, the header),
`src/web/useJobs.ts`, `src/web/useStepJob.ts`, `src/web/useArc.ts`, and
`src/web/article/ArticlePage.tsx` (`OwnedReader`). Where to begin, not the limit.

## What it is meant to do

A reader reported fast battery drain on an iPad. The plan's diagnosis: every owner's reading view
mounts `useArc` → `useStepJob` → `useJobs`, which counts as a subscriber to the job engine and holds
it on its 8-second idle poll for as long as the article is open and visible. The plan adds a "quiet"
subscription that receives snapshots but does not buy the idle cadence, uses it for the arc only,
and adds a whole-`App` owner test that fails if anything at the top of the reading view ever holds
the engine on its idle cadence again.

Invariants it must not break: a job the arc starts on arrival is still polled, driven and announced
as done; mode bands keep their idle cadence while open; the signed-out guarantee (no polling at all)
and the hidden-tab guarantee (no status polls, driving continues) in `tests/idle-work.test.ts` and
`tests/public-network-trace.test.tsx`.

## What you can and cannot run

The tree is read-only. You can run one test file (`npx vitest run tests/<one>.test.ts`) and build a
throwaway harness under /tmp. No network, not even loopback.

## Attack it

Independently, before you read my questions below.

1. Is the diagnosis right — is `useArc` really the only subscriber mounted at rest in an owner's
   reading view (Plain and Summary modes), or is there another one the plan would leave polling?
2. Does the quiet subscription lose anything the arc depends on: its completion announcement
   (`drainCompletions` cursor, the `useJobs` effect), `working`, a failure after a job it started,
   the auto-start on `absent`, a session change (`start`/`stop`/`teardown`, `awake()`,
   `unlisten`)? Trace the paths rather than the comments.
3. Is the whole-`App` class guard feasible as described, and would it actually have failed on
   2026-08-29? If not, what is the strongest guard that is.
4. Is the simpler option (slow the idle poll) or the component-split option actually better than
   what the plan chose?
5. Is anything in "What was found" or "Ruled out" stated more strongly than the evidence shown there
   supports?

For each finding give an ID (F1, F2, …), a severity (P0/P1/P2/P3 — P0 data loss, security,
incorrect charging or broadly unusable; P1 user-visible wrong behaviour or an authoritative contract
violated; P2 design risk with no wrong behaviour today; P3 prose), whether it is established or
reasoned, (a) the concrete scenario it does not handle or the contract it contradicts, and (b) the
smallest change that closes it — exact replacement wording or a code block. A finding with no (a)
goes last. Refuse only on an established P0 or P1, and name what established it.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

- `schedule` is also called after an error with `IDLE_MS`; with only a quiet subscriber and nothing
  busy, does a failed poll now stop the engine for good, and does that matter?
- `wake()` in `subscribe` polls on mount; should a quiet subscription wake the engine at all?

Do not change any file.
