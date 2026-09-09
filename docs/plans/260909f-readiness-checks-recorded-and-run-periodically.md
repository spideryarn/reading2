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
- **No singleton, unless we build one.** Two loops would advance the same worktree and put two
  26-minute suites on the same box. `tools/overseer/lock.ts`, held for the process's life.
- **Its code is frozen at process start.** So the loop is launched from
  `.claude/worktrees/readiness-checks` — the worktree it keeps at `origin/dev` — which persists after
  the worktree this work was built in is removed, and which a restart brings up to date for free. It
  is not launched from the primary, whose `HEAD` is nobody's in particular, and not from a
  task worktree that is about to be deleted.
- **An unbounded log.** The check's own output is megabytes, several times a day. The child's output
  goes to its own file per run under `logs/readiness-runs/`, a bounded number kept; the loop's own
  log gets one line a tick.

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
  `void` is retried after a cooldown and a bounded number of times.
- **F3, second half — a pass has a shelf life.** The loop was going to read seven days of records
  while the tab renders a 24-hour window, so a pass that aged out would leave the tab saying
  `unknown` while the loop said *already answered*. The loop now asks over **the same window the tab
  does**, so evidence going stale is evidence the loop will refresh.
- **F4 — the "started record lease" was not mutual exclusion** (P1). `readiness-store.ts` says in as
  many words that it has no lock, and `PENDING_TRUST_MS` is a liveness horizon, not a lease: two
  loops both read "nothing running", both pass admission — which `vitest-admission.ts` explicitly
  documents a simultaneous cohort doing — and both spawn a suite. Exclusivity now comes from
  `tools/overseer/lock.ts`, whose claim is one `O_CREAT|O_EXCL` syscall, held for the loop's life.
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

**Status: not started.**

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
      [silent-success.md](silent-success.md) wearing this feature's clothes. The doc carries the
      command that waits for `EXIT=`, and says what the two ways of failing look like.
- [ ] Re-pin `AUTHORISED_HASHES["get-ready-to-deploy"]` with the new digest, in the same commit, with
      a dated comment saying what changed and that the job itself did not.
- [ ] `tests/overseer-standing-jobs.test.ts` (whichever guards the pin) goes green — and is watched
      going **red** first against the edited doc with the old pin, because a pin test that was never
      red proves nothing.

Doing this myself: it is a paragraph and a hex string.

## Stage 2 — the periodic runner

**Status: not started.**

`scripts/readiness-loop.ts`, plus `tools/fleet/readiness-loop.ts` for the pure decisions so they can
be tested without a box. Implemented by Codex (`gpt-5.6-sol`), reviewed and gated by me.

### 2a — the decision, pure

One function, `decideTick`, taking the readings and returning a discriminated union: `run` (with the
sha), or `skip` with the reason in a sentence. Every clause below is a way the runner would otherwise
burn 26 minutes of a shared box, or record something untrue:

- **`origin/dev` could not be read** → skip. Never guess at a sha.
- **A settled `pass` or `fail` record already exists for this sha, inside the tab's window** → skip.
  This is what makes a *failure sticky*: we do not re-run a red commit hoping for a different answer.
  Two corrections from Sol are in that sentence and neither was in the first draft. **`void` is not
  settled** (F3) — a run the box killed is not an answer, so it is retried after a cooldown and a
  bounded number of times, or a single OOM would make that commit permanently unanswerable. And
  **the window is the tab's, not the store's retention** (F3 again): asking over seven days while the
  tab renders twenty-four hours would leave the loop calling a commit answered while the page says
  `unknown`.
- **A `started` record for this sha is still trusted** → skip; something is already running it,
  possibly a person. **This is an observation, not a lease** (F4). `readiness-store.ts` has no lock
  and `PENDING_TRUST_MS` is a liveness horizon; exclusivity between loops comes from the lock in
  Stage 2b and from nothing else.
- **`decideAdmission` does not say `admit`** → skip. Same function `vitest.config.ts` calls, so there
  is exactly one home for the memory arithmetic and no threshold to drift.
- **`computeVerdict` is not `ok`** → skip. `tools/fleet/health.ts`'s own verdict, not a number
  invented here.

Deliberately **not** a count of running suites. `parseAttribution` counts vitest *processes*, and a
suite is roughly five of them, so a "three suites" gate written on that number reads five times
busier than the box is. The two readings above are the box's own opinion of whether a suite fits, and
they are the ones that were actually load-bearing on 2026-09-08.

- [ ] `tests/readiness-loop.test.ts`: one case per skip clause, red first, plus the one that runs.
- [ ] A test that a `fail` record for the sha means skip, not retry.

### 2b — the loop, and its worktree

- [ ] `.claude/worktrees/readiness-checks`, on a branch that only ever fast-forwards, created by the
      runner if absent (`git worktree add` then `scripts/worktree-setup.ts` — reuse, not a second
      recipe). **Never `checkout --`, `reset --hard`, `clean` or a branch switch**, per AGENTS.md:
      the tree is advanced with `git merge --ff-only origin/dev` and nothing else.
- [ ] If that merge does not fast-forward, or the tree is not clean, the loop **skips and says so**
      rather than forcing it. A dirty runner worktree is a thing to look at, not to erase.
- [ ] `git fetch origin dev` each tick, in that worktree. Additive, and it is what makes "on dev"
      about something newer than the last time somebody happened to fetch.
- [ ] Tick every 10 minutes; a run takes ~26, so the loop is idle most of the time and this only
      decides how soon a new dev head is noticed.
- [ ] One line per tick to stdout — the sha, the decision, the reason — so the tmux log is a legible
      record of why nothing ran, which is the state it will be in most of the time.
- [ ] The check is run by spawning `scripts/readiness-run.ts check` **in the runner worktree**, which
      is what makes the record about that tree: `readiness-run.ts` stamps the checkout it belongs to,
      not `cwd`.

### 2c — a box refusal is not a red tree

**This is a bug found while designing, and it would have made deliverable 3 lie.**
`vitest-admission.ts` refuses under memory pressure by throwing, so `npm run check` exits non-zero,
so `outcomeFromExit` records **`fail`** — and the tab would then say dev is red because the box was
busy. The refusal even prints `NO TESTS RAN AND NOTHING WAS VERIFIED`, which is the sentence
`readiness-run.ts` most needs to read and currently does not.

- [ ] `readiness-parse.ts` learns that banner; a run carrying it is recorded `void` with the box's own
      words as `why`, whatever its exit code. Red first, against a captured fixture of the real
      refusal text.
- [ ] Named as the one change outside "what a record needs" that this work makes, because a record
      that says *the tests failed* when no test ran is the same lie the whole feature exists to
      refuse.

The pre-gate in 2a means the runner should never produce one; this is for the person who runs the
command by hand on a busy box, and for the herd case the admission valve explicitly does not bound.

## Stage 3 — start it, and say what the tab shows

**Status: in progress.** The runner's worktree was built by hand first, as the design's own
rehearsal: `.claude/worktrees/readiness-checks` on branch `readiness-checks`, created with
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

- [ ] Start the loop under `tmux-job.ts` and watch one full cycle land a record.
- [ ] Read `/api/readiness` and report the verdict on the current dev head: green, or `unknown` with
      the failing clause named. Either is a success for this stage; what is not is not knowing.
- [ ] The systemd unit text goes in the debrief, unwritten, for Greg.

## Gates

`npm test` and `npm run typecheck` at the end of each stage; `npm run lint` on the touched files as
advice. GPT Sol reviews this plan before Stage 1 and each stage's diff after it.
