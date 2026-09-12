# Review: a quiet job subscription for the arc, so an owner's reading view stops polling at rest

Repo: /home/greg/code/spideryarn2/.claude/worktrees/fb36-ipad-battery-drain, branch
worktree-fb36-ipad-battery-drain. TypeScript + ESM, React 19 client under `src/web/`, vitest.

## The candidate

Committed: the stage-1 commit on this branch, the one after base 6b738efd — see
`git log --oneline 6b738efd..HEAD` (it is a single commit; I will name its SHA in the plan's log).
`git diff 6b738efd..HEAD` — changed paths: `git diff --name-only 6b738efd..HEAD`.

Start with: `src/web/jobEngine.ts` (`schedule`, `poll`, `join`/`subscribeQuietly`, the
reconciliation counters, `teardown`), `src/web/useJobs.ts`, `src/web/useArc.ts`, and the two tests:
`tests/arc-idle-poll.test.ts` and the `describe("an owner's reading view, left alone")` at the foot
of `tests/public-network-trace.test.tsx`. Where to begin, not the limit.

**One existing test's expectations were changed, and that deserves the most suspicion.**
`tests/the-ideas-extraction-changed-no-requests.test.tsx` records each mode's exact request trace.
Its `ARRIVAL` fixture lost a `GET /api/jobs` between the article and the record-open POST (the arc's
mount poll), and its `IDEAS` fixture gained a `GET /api/jobs` after `/api/reader` (the Ideas band's
own subscription, which the arc's used to hide). I believe both are the intended effect of the fix
and not a regression being papered over — check that claim against the code, and say if either
edit hides something a reader would miss.

The full suite was otherwise green bar four files I judged environmental — the plan's Log says which
and why; you can re-run any of them.

## What it is meant to do

The plan is `docs/plans/260912a-ipad-battery-drain-the-reading-view-polls-the-job-queue-every-eight-seconds-at-rest.md`,
and your plan review is `docs/plans/260912a-ipad-battery-drain-review-sol.md` — the ledger of what
was done with F1–F7 is in the plan under "Plan review". In short: `useArc` subscribes through
`subscribeQuietly`, which is notified of everything but does not keep the eight-second idle poll
going and does not poll on arrival; an action (`actionSucceeded`, non-401 `actionFailed`) now leaves
a versioned obligation that only a successful poll discharges (your F1).

Invariants: an owner's Plain or Summary reading view at rest asks `/api/jobs` once at session start
and then nothing; a mode band (e.g. Glossary) still polls every eight seconds while open; the arc
still finds, drives and announces the job it starts, including past a failed first poll; hidden tabs
make no status polls but keep driving; a signed-out visitor polls nothing.

Measured on a production build (`npm run build` + `vite preview`), 60 s at rest, with
`scripts/measure-cpu.ts --local-sign-in … --settle 20 --seconds 60` and `?perf=1` (its `fetches:`
line reads `window.__perf.report()`, `src/web/perf.ts`): before, Summary `fetches: 8/min —
/api/jobs=8`; after, Summary and Plain `0/min — none`, and Glossary open (the positive control)
still `8/min`. The full before/after table and the method, including what these runs cannot show
about an iPad, are in the plan — § "What can and cannot be measured from here" and the Log. Read the
conclusion there as well as the diff: **the claim I would least like to be wrong about is that a
quiet subscription can never leave a job this tab created undiscovered.**

## What you may change

You may edit this worktree. Fix what is inside this stage — each finding red-first, with the test
that reproduces it — and leave everything wider as a finding for me to decide. Do not commit. List
every file you changed at the end.

You can run test files (`npx vitest run tests/<one>.test.ts`) and scripts; you have no network, not
even loopback. The two test files above and `tests/idle-work.test.ts`, `tests/job-engine-*.test.ts*`,
`tests/step-job-*.test.ts*` need nothing outside the tree.

## Attack it

Independently, before you read my questions below. Try to find a sequence in which the engine stops
polling while something is still owed — a job exists on the server that this tab created or should
drive, and no timer, poke, visibility change or driver will ever find it — or in which it polls at
rest when it should not. Trace the paths through `poll`'s `finally`/`again`, `schedule`'s early
returns (hidden tab, `authFailed`, `awake()`), session change in the middle of an owed poll, and
`useJobs.act`'s ordering of `actionSucceeded` against the POST.

For each finding give an ID continuing from your plan review (F8, F9, …), a severity
(P0/P1/P2/P3 — P0 data loss, security, incorrect charging or broadly unusable; P1 user-visible
wrong behaviour or an authoritative contract violated; P2 design risk, no wrong behaviour today; P3
prose), established or reasoned, (a) the input or mutation I can run, (b) the smallest change that
closes it. A finding with no (a) goes last. Refuse only on an established P0 or P1.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

- `schedule` returns early while the tab is hidden, before looking at `reconciliationOwed`. An
  action's poll that fails while hidden then waits for `visibilitychange`. I believe that is fine
  (the visibility handler polls), but check the handler actually runs `poll` when an obligation is
  owed and nothing is busy.
- The postmortem (`docs/postmortems/260912a-…`) recommends, as the long-term fix, inverting the
  default so a subscription is quiet unless it asks for the idle cadence, and defers it "until a
  third quiet caller appears". The house rule is to do a postmortem's prevention in the same run.
  Is deferring it right, or is the owner-at-rest guard test enough to hold the class? Answer as a
  finding either way.
