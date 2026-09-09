# Readiness checks actually recorded, and run periodically

> I see in Readiness that typecheck, lint etc haven't been run. Don't these get run as part of
> @docs/reusable/get-ready-to-deploy.md? If not, add them to that. And then check that that is
> getting run periodically.
>
> — Greg, 2026-09-09

Queue item `qi-h6mw7v2y`, dispatched by the Overseer as `readiness-runner`.

The Readiness tab ([readiness.md](../project/readiness.md)) answers *is the commit `origin/dev` is on
known to pass its checks?* On 2026-09-09 it could not answer it at all, for three reasons that
compound:

1. `~/.fleet-readiness/runs/` holds **zero** records. Only `scripts/readiness-run.ts` writes one;
   everything the tab shows today is faded tmux-log reconstruction, which by clause 1 of the verdict
   can never vote.
2. `docs/reusable/get-ready-to-deploy.md` § 4 — the sweep that is supposed to be the routine source
   of check results — runs a bare `npm run check`, which writes no record. So even when the sweep
   runs, the tab learns nothing.
3. Nothing runs the sweep periodically. The standing job is built and switched off
   (`OVERSEER_JOBS_ENABLED` is Greg's switch, because it starts paid Claude sessions), and the
   earlier session-hosted `/loop` died with its session.

And a fourth, which is why "just run it in the primary" is not the fix: the primary checkout is never
clean — untracked eval results, other agents' half-finished edits — and clause 3 requires a clean
tree at **both** ends of the run. A run there can never be green, however green the suite is.

## What this is not

**Not a new verdict, a new record shape, or a new tab.** `readiness-run.ts` already records honestly
and `readiness-verdict.ts` already refuses to lie; the whole of this work is *making them be called*.
The one exception is § Stage 2c, where a box-pressure refusal is currently recorded as a **failing
tree**, which is the same class of lie pointing the other way.

**Not arming `OVERSEER_JOBS_ENABLED`, and not writing anything under `infra/`.** Both are Greg's. The
systemd unit that would make the runner outlive a reboot is written out verbatim in the debrief for
him to place.

## The simpler option this passed over

**Adding a second command to § 4 for `lint`.** The brief asked for `check` plus "`lint` as the
advisory it is", and that turned out to be one command too many: `scripts/check.ts` already runs
`lint` as an advisory step, and `rowsOfCheck` in `readiness-verdict.ts` puts every row of a check's
summary table — `lint` included — onto that check's own timeline. So one recorded `npm run check`
already carries the lint reading Greg is missing, and a second invocation would be a second way to do
the same thing, costing another few minutes of a shared box for a row we already have.

**What that simplification does *not* fix, traced rather than assumed.** `ReadinessPanel.tsx` groups
readings with `byCheck.get(reading.check)`, where `check` is the record's own kind — so a recorded
`npm run check` lands on the `check` row and **only** that row. The verdict goes green (it decomposes
a check into per-check timelines, in `rowsOfCheck`), but the `test`, `typecheck`, `lint` and `build`
rows go on saying *nothing ran*, which is the sentence Greg was reading when he asked the question.
Running `lint` separately would fill one of those four and leave three, so it is not the answer
either. **The answer is in the panel**, which decomposes nothing and which this work does not own —
written up for the Overseer in the debrief rather than fixed here.

**A registry / lease file for "is the box busy".** Rejected for the reason
[`vitest-admission.ts`](../../vitest-admission.ts) already rejected it: it is write-after-read, so in
the herd it exists to handle, every starter reads zero. We ask the same kernel number that file asks,
through the same function, so there is no second threshold to disagree with the first.

## Where the periodic runner lives, and why not the daemon

Two candidates were named in the brief. The answer is **a plain `tsx` loop under
`scripts/tmux-job.ts`**, and the argument is mostly about which one *runs*.

|  | tmux-job loop | a job in the Overseer daemon's scheduler |
|---|---|---|
| runs today | yes, once started | **no** — the scheduler is disarmed by `OVERSEER_JOBS_ENABLED`, which only Greg flips |
| model-free | yes | `work: session` dispatches a paid Claude session; a deterministic job would need a new work kind |
| survives a reboot | **no** — a systemd unit fixes it, and that is Greg's to write | yes, the daemon has a unit |
| whose files | `scripts/` — mine | `tools/overseer/`, where two other agents are live right now |

Building it into the scheduler would mean shipping the fix for "nothing runs periodically" into the
one place that is *switched off*, and editing files the brief explicitly fences off. The tmux-job loop
is also the mechanism the Overseer already uses for its hourly dashboard refresh, so it is the boring
choice rather than a new one.

**The costs, named rather than discovered later** — Sol's F8, which found the first draft's single
"it dies with the box" to be about a quarter of the list:

- **No supervision.** It dies with the box, with a `tmux kill-server`, and with anybody tidying up
  tmux sessions, and nothing alarms. What makes that survivable is that its absence is not silent
  *in the thing it feeds*: the tab goes `unknown` on every commit after the last recorded run and
  names the missing clause, which is the sentence a reader needs anyway.
- **A singleton has to stay proved.** Two loops would advance the same worktree and put two
  26-minute suites on the same box. `tools/overseer/lock.ts` makes the atomic claim, and the loop
  rechecks the inode and record before each tick and immediately before spawning a check.
- **Its code is frozen at process start.** So the loop is launched from
  `.claude/worktrees/readiness-checks` — the worktree it keeps at `origin/dev` — which persists after
  the worktree this work was built in is removed, and which a restart brings up to date for free. It
  is not launched from the primary, whose `HEAD` is nobody's in particular, and not from a
  task worktree that is about to be deleted.
- **An unbounded tmux log.** The check's own output is megabytes, several times a day. The child's
  output goes to its own file per run under `logs/readiness-runs/`; after a run completes, pruning
  keeps the latest twenty. The loop's tmux log gets at least one decision line per tick, plus outcomes
  and errors.
- **A red full suite is what this shared box observed, not proof of causation.** A contention flake
  and a deterministic regression both exit 1, and a generic immediate rerun only fishes for a
  different answer; there is no cheap honest classifier between them. A nested command killed by a
  signal is different and cheaply knowable, but `check.ts` currently collapses that status into its
  own exit 1. Preserving the per-step signal is wider than this runner and remains follow-up work.

**And the systemd follow-up is not one file.** This repo keeps a unit, its `provision.sh` heredoc, an
activation self-check and a drift test in step, so "hand Greg a unit" was wrong in the first draft —
[hetzner-remote-server-box.md § A change to the box is a change to a file](../project/hetzner-remote-server-box.md#a-change-to-the-box-is-a-change-to-a-file).
The debrief names all of them rather than pretending it is a paste.

## What the plan review changed

GPT Sol reviewed this plan at commit `3add23fc` and **refused** it, on eight findings. Six were
right and are folded in below; the other two are outside this work's remit and go to the Overseer
rather than being quietly dropped. Both of Sol's load-bearing premises were checked against the code
before anything moved, because a finding arrives already framed as a defect and a wrong premise is
harder to see than wrong code.

- **F2 — the runner's worktree could not have produced a passing check** (P1, and confirmed twice
  over: by reading `scripts/worktree-setup.ts`, whose `.env.local` branch calls `bad()` rather than
  `refuse()` and so **prints a failure and exits 0**, and by hitting it in practice — see Stage 3).
  The loop materialises `.env.local` and then requires setup's own `ok` line before it will run
  anything.
- **F3 — `void` was going to be sticky forever** (P1). Stage 2c deliberately mints a terminal `void`
  record for a box refusal, and Stage 2a's "any terminal state → skip" then guaranteed that commit
  could never be answered. The skip is now **outcome-aware**: a settled `pass` or `fail` is sticky, a
  `void` is retried after spacing attempts, with at most three void outcomes in the rolling 24-hour
  window. That is a rate bound (the initial attempt plus two retries), not a lifetime retry budget.
- **F3, second half — a pass has a shelf life.** The loop was going to read seven days of records
  while the tab renders a 24-hour window, so a pass that aged out would leave the tab saying
  `unknown` while the loop said *already answered*. The loop now asks over **the same window the tab
  does**, so evidence going stale is evidence the loop will refresh.
- **F4 — the "started record lease" was not mutual exclusion** (P1). `readiness-store.ts` says in as
  many words that it has no lock, and `PENDING_TRUST_MS` is a liveness horizon, not a lease: two
  loops both read "nothing running", both pass admission — which `vitest-admission.ts` explicitly
  documents a simultaneous cohort doing — and both spawn a suite. Exclusivity now comes from
  `tools/overseer/lock.ts`, whose claim is one `O_CREAT|O_EXCL` syscall and whose inode and record
  are rechecked before work and before spawn.
  The running-record check stays, demoted to what it always was: an observation about *manual* runs.
- **F5 — Stage 1 turned a synchronous gate into a detached command** (P1, reasoned, and right).
  `tmux-job.ts` returns when tmux has *started*, so a sweep that reads its exit status learns only
  that the job launched, and would go on to fix, commit and push having verified nothing. § 4 now
  says in as many words that the step is not finished until the log's last line reads `EXIT=`, and
  carries the command that waits.
- **F7 — the setup recipe can break the fast-forward-only invariant** (P2, confirmed):
  `worktree-setup.ts` calls `freshenFromTrunk`, whose merge is a plain `merge --no-edit`, not
  `--ff-only`. It is a no-op when the worktree starts exactly at a freshly fetched `origin/dev`, but
  the loop now **validates** rather than assumes: `HEAD === origin/dev` and clean, after setup and
  before every run, fail-stop and loud.
- **F8 — the tmux cost was understated** (P2). Named in § "Where the periodic runner lives" below:
  no supervision, no singleton (F4 fixes that), an unbounded log, and code frozen at process start.
  And the systemd follow-up is **not** "one file" — this repo pins a unit, its `provision.sh`
  heredoc, an activation self-check and a drift test, per
  [hetzner-remote-server-box.md § A change to the box is a change to a file](../project/hetzner-remote-server-box.md#a-change-to-the-box-is-a-change-to-a-file).

**The two that are not this work's to fix**, carried to the Overseer in the debrief:

- **F1 — a recorded `check` does not fill the rows Greg was looking at** (P1). Traced independently
  before the review and written up under § "The simpler option this passed over"; the repair is in
  `ReadinessPanel.tsx`, which this stage does not own.
- **F6 — "periodic" may mean the whole sweep, not just its checks** (P1, a contract gap rather than
  a defect). Greg asked whether *`get-ready-to-deploy.md`* runs periodically; the Overseer's brief
  narrowed that to the deterministic checks, because the full sweep commits, merges and pushes, and
  therefore needs a paid Claude session behind Greg's own switch. That narrowing is defensible and it
  is **not mine to make** — it goes to Greg as a decision, not into this plan as an assumption.

## Stage 1 — § 4 of the sweep records what it runs

**Status: complete in `ebf64db4`.**

`docs/reusable/get-ready-to-deploy.md` is a pinned document
(`AUTHORISED_HASHES["get-ready-to-deploy"]` in `tools/overseer/standing-jobs.ts`), so the digest is
re-pinned in the same commit or the standing job refuses to dispatch. That refusal is the mechanism
working; skipping the re-pin would leave a job that quietly stopped running, which is the failure the
pin exists to make loud.

- [ ] § 4's first command becomes `npx tsx scripts/tmux-job.ts npx tsx scripts/readiness-run.ts check`,
      with one short paragraph on why the wrapper (a bare `npm run check` leaves no record and the tab
      can never go green on it) and how to read the verdict back.
- [ ] **And that the step is not over until it is read** (Sol's F5). `tmux-job.ts` returns when tmux
      has *started*, so its exit status says the job launched and nothing about the checks. A sweep
      that took it for a gate would go on to fix, commit and push having verified nothing — which is
      [silent-success.md](../reusable/silent-success.md) wearing this feature's clothes. The doc carries the
      command that waits for `EXIT=`, and says what the two ways of failing look like.
- [ ] Re-pin `AUTHORISED_HASHES["get-ready-to-deploy"]` with the new digest, in the same commit, with
      a dated comment saying what changed and that the job itself did not.
- [ ] `tests/overseer-standing-jobs.test.ts` (whichever guards the pin) goes green — and is watched
      going **red** first against the edited doc with the old pin, because a pin test that was never
      red proves nothing.

Doing this myself: it is a paragraph and a hex string.

## Stage 2 — the periodic runner

**Status: committed in `0dc023fb`; the code review fixes remain uncommitted for Greg's review.**
Codex implemented the pure decision, the locked tmux-hosted loop and the eventually-pruned per-run
logs on 2026-09-09. The focused tests were written
first: the file went red with exit 1 before the decision module existed, and the 2c outcome assertion
went red again with exit 1 while exit 1 still had no refusal override. The required focused test and
project typecheck now pass. The Stage 2c trace held with one wording correction: `decideAdmission`
returns the refusal and `vitest.config.ts` throws it; from there `check.ts` exits 1 and the wrapper did
record `fail`. The repair latches the refusal while output streams past, because a full check can push
that sentence out of the wrapper's bounded head and tail.

`scripts/readiness-loop.ts`, plus `tools/fleet/readiness-loop.ts` for the pure decisions so they can
be tested without a box. Implemented by Codex (`gpt-5.6-sol`), reviewed and gated by me.

**Two things I changed on review, both found by running it rather than reading it.**

**`npm run check` has an undeclared prerequisite, and without it the runner records a permanent false
red.** `tests/fleet-decisions-route.test.ts` reads `tools/fleet/web/dist`; `check`'s build step is
`build:client && build:api`, and `build:fleet` is in neither. So it fails in any checkout where
nobody ran that by hand — which a machine-made worktree never does. Measured: it failed in the
runner's first recorded check and passed immediately after `npm run build:fleet`. The loop now builds
it when absent (the output is gitignored, so the tree stays clean — checked, not assumed). **The real
repair is a step in `check.ts`**, which every checkout would get; that is not this work's file, and it
is the same class `check.ts`'s own header says it fixed once for `api-dist`.

**One bad tick used to end the loop for good.** `tick` throws on a failed `npm ci` or an unreadable
diff, and that reached the outer `catch`, which returns — so one transient failure stopped the runner
for every later commit, leaving the tab ageing into `unknown` with nothing to say why. A periodic
runner that stops on its first hiccup is worse than none, because its output is indistinguishable
from one that is merely idle. A throw is now logged and the loop waits for the next tick; the lock and
the worktree setup stay fatal, because those say the box cannot host a runner at all.

**And one thing I checked and did *not* change.** The health gate skips unless `computeVerdict` is
`ok`, and its `activelySwapping` arm fires on `si > 0 || so > 0` — *any* page movement — which looked
like it would block the runner permanently on a box this busy. Sampled eight times over a minute:
seven `ok`, one `strained` at `si 4 KB/s`. So it costs an occasional tick and the next one ten minutes
later runs. Left alone, and the number written down so the next reader does not have to re-measure it.

### 2a — the decision, pure

One function, `decideTick`, taking the readings and returning a discriminated union: `run` (with the
sha), or `skip` with the reason in a sentence. Every clause below is a way the runner would otherwise
burn 26 minutes of a shared box, or record something untrue:

- **`origin/dev` could not be read** → skip. Never guess at a sha.
- **A settled `pass` or `fail` record already exists for this sha, inside the tab's window** → skip.
  This is what makes a *failure sticky*: we do not re-run a red commit hoping for a different answer.
  Two corrections from Sol are in that sentence and neither was in the first draft. **`void` is not
  settled** (F3) — a run that reached no verdict is not an answer. Attempts are spaced, with at most
  three void outcomes per rolling tab window (the initial attempt plus two retries); the budget
  replenishes when an old void ages out, so this is not a lifetime cap. And
  **the window is the tab's, not the store's retention** (F3 again): asking over seven days while the
  tab renders twenty-four hours would leave the loop calling a commit answered while the page says
  `unknown`.
- **A `started` record for this sha is still trusted** → skip; something is already running it,
  possibly a person. **This is an observation, not a lease** (F4). `readiness-store.ts` has no lock
  and `PENDING_TRUST_MS` is a liveness horizon; exclusivity between loops comes from the lock in
  Stage 2b and from nothing else.
- **`decideAdmission` says `refuse`** → skip. `not-applicable` remains permission on a machine that
  has not opted into the Linux policy. This is the same function `vitest.config.ts` calls, so there
  is exactly one home for the memory arithmetic and no threshold to drift.
- **`computeVerdict` is not `ok`** → skip. `tools/fleet/health.ts`'s own verdict, not a number
  invented here.

Deliberately **not** a count of running suites. `parseAttribution` counts vitest *processes*, and a
suite is roughly five of them, so a "three suites" gate written on that number reads five times
busier than the box is. The two readings above are the box's own opinion of whether a suite fits, and
they are the ones that were actually load-bearing on 2026-09-08.

- [x] `tests/readiness-loop.test.ts`: one case per skip clause, red first, plus the one that runs.
- [x] A test that a `fail` record for the sha means skip, not retry.

### 2b — the loop, and its worktree

- [x] `.claude/worktrees/readiness-checks`, on a branch that only ever fast-forwards, created by the
      runner if absent (`git worktree add` then `scripts/worktree-setup.ts` — reuse, not a second
      recipe). **Never `checkout --`, `reset --hard`, `clean` or a branch switch**, per AGENTS.md:
      the tree is advanced with `git merge --ff-only origin/dev` and nothing else.
- [x] If that merge does not fast-forward, or the tree is not clean, the loop **skips and says so**
      rather than forcing it. A dirty runner worktree is a thing to look at, not to erase.
- [x] `git fetch origin dev` each tick, in that worktree. Additive, and it is what makes "on dev"
      about something newer than the last time somebody happened to fetch.
- [x] Tick every 10 minutes; a run takes ~26, so the loop is idle most of the time and this only
      decides how soon a new dev head is noticed.
- [x] At least one decision line per tick to stdout — the sha, the decision, the reason — plus an
      outcome after a run and any preparation error, so the tmux log is a legible record of why
      nothing ran, which is the state it will be in most of the time.
- [x] The check is run by spawning `scripts/readiness-run.ts check` **in the runner worktree**, which
      is what makes the record about that tree: `readiness-run.ts` stamps the checkout it belongs to,
      not `cwd`.

### 2c — a box refusal is not a red tree

**This is a bug found while designing, and it would have made deliverable 3 lie.**
`vitest-admission.ts` refuses under memory pressure by throwing, so `npm run check` exits non-zero,
so `outcomeFromExit` records **`fail`** — and the tab would then say dev is red because the box was
busy. The refusal even prints `NO TESTS RAN AND NOTHING WAS VERIFIED`, which is the sentence
`readiness-run.ts` most needs to read and currently does not.

- [x] `readiness-parse.ts` learns an authenticated form of that banner: a random per-run token is
      consumed by `vitest.config.ts` before workers inherit it, so an ordinary test or fixture cannot
      turn its own failure into `void` by printing the sentence. For a full `check`, only the test row
      becomes `did-not-run`; a real earlier gate failure remains `fail`. Red first against both paths.
- [x] Named as the one change outside "what a record needs" that this work makes, because a record
      that says *the tests failed* when no test ran is the same lie the whole feature exists to
      refuse.

The pre-gate in 2a means the runner should never produce one; this is for the person who runs the
command by hand on a busy box, and for the herd case the admission valve explicitly does not bound.

## Stage 3 — start it, and say what the tab shows

**Status: complete.** The loop is running under tmux as `readiness-loop-1826-3793769`, holding
`~/.fleet-readiness/readiness-loop.lock`, and the Readiness tab says **ready** for `7ea2cf54` on real
wrapper evidence. What is *not* done, and is Greg's: the systemd unit that would make it survive a
reboot — four places, written out in the debrief.

The runner's worktree was built by hand first, as the design's own rehearsal: `.claude/worktrees/readiness-checks` on branch `readiness-checks`, created with
`worktree add … origin/dev` and set up with `scripts/worktree-setup.ts`. Two things came out of it
that the plan did not know.

**`worktree-setup.ts` fails on a hand-made worktree until `.env.local` is copied in.**
`.worktreeinclude` names the file, but only the harness's own worktree creation acts on it, so a
`worktree add` leaves it out and setup says so loudly. Without it the client tests cannot collect and
the `check` would be red about nothing. The loop has to copy it, and Stage 2's brief now says so.

**Clean at `origin/dev`, verified with the same function that will vote on it** — `stampTree` reports
`{kind: "known", sha: 6a680a6c…, dirty: false}`, which is clause 3 of the verdict satisfied for the
first time on this box. The first-ever record was written at 16:03 by
`readiness-run.ts check` in that worktree.

- [x] Start the loop under `tmux-job.ts` and watch one full cycle land a record.
- [x] Read the verdict on the current dev head: green, or `unknown` with the failing clause named.
- [x] The systemd unit text goes in the debrief, unwritten, for Greg.

### What actually happened, which is the evidence for the whole plan

**The loop ran itself end to end, unattended, and the chain fired in order.** From its own log:

    2026-09-09T16:51:36Z 7ea2cf54644a run: Readiness is unknown for this clean dev tree,
                                        and the box gates permit a full check.
    2026-09-09T17:24:02Z 7ea2cf54644a outcome: pass; duration 31m 58s; log …

It fetched, fast-forwarded the runner worktree from `6a680a6c` to `7ea2cf54`, stamped it clean at
exactly dev's head, found no record for that commit, passed the memory and health gates, wrote its
pending record *before* spawning so its own death would be visible, and recorded a pass.

**The verdict is `READY`**, computed through `readinessVerdict` over the real store:

    check full wrapper state=fail start=[6a680a6c clean] end=[6a680a6c clean]   test:failed
    check full wrapper state=pass start=[7ea2cf54 clean] end=[7ea2cf54 clean]   test:clean

    VERDICT: READY
      test:      pass — a full `npm run check` passed on this commit, and its gates include this one
      typecheck: pass — a full `npm run check` passed on this commit, and its gates include this one

Two records, and between them they are the feature's argument: the same full check, on two commits,
disagreeing. `unreadable: 0`.

**The first run found dev genuinely red, and that was the point.** On `6a680a6c` the check failed on
four tests, re-run individually rather than believed as a batch: `fixture-ids` and `fleet-attention`
were real reds nobody knew about; `fleet-decisions-route` was the missing `build:fleet`; and
`load-article-serialisation` passed alone and was contention. **That last one is a standing limit,
not a bug**: a full suite on a shared box can fail for reasons that are not the commit's, and this
loop records those as a red dev. Nothing cheap distinguishes them, so it is written down here rather
than papered over.

**The first tick after a start is slow and silent for a couple of minutes**, because preparation is
state convergence rather than merge-triggered: a fresh process runs `npm ci`, migrations and
`build:fleet` before it decides anything. That is deliberate — it is what lets a loop restarted after
a kill repair itself — but it means a person watching the log sees nothing at first.

## Gates

`npm test` and `npm run typecheck` at the end of each stage; `npm run lint` on the touched files as
advice. GPT Sol reviews this plan before Stage 1 and each stage's diff after it.
