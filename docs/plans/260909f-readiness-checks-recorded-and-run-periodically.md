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

**The cost, named rather than discovered later:** it dies with the box, with a `tmux kill-server`, and
with anybody who tidies up tmux sessions. Nothing alarms about that. What makes it survivable is that
its absence is not silent *in the thing it feeds* — the tab goes `unknown` on every commit after the
last recorded run and says which clause is missing, which is exactly the sentence a reader needs. The
systemd unit in the debrief is the real fix, and it is one file for Greg.

## Stage 1 — § 4 of the sweep records what it runs

**Status: not started.**

`docs/reusable/get-ready-to-deploy.md` is a pinned document
(`AUTHORISED_HASHES["get-ready-to-deploy"]` in `tools/overseer/standing-jobs.ts`), so the digest is
re-pinned in the same commit or the standing job refuses to dispatch. That refusal is the mechanism
working; skipping the re-pin would leave a job that quietly stopped running, which is the failure the
pin exists to make loud.

- [ ] § 4's first command becomes `npx tsx scripts/tmux-job.ts npx tsx scripts/readiness-run.ts check`,
      with one short paragraph on why the wrapper (a bare `npm run check` leaves no record and the tab
      can never go green on it) and how to read the verdict back (`EXIT=` on the log's last line).
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
- **A wrapper `check` record already exists for this sha**, in any terminal state → skip. This is
  what makes a *failure sticky*: we do not re-run a red commit in a loop hoping for a different
  answer, and the tab keeps saying red until dev moves.
- **A `started` record for this sha is still within its lease** → skip; something is already running
  it, possibly a person.
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

**Status: not started.**

- [ ] Start the loop under `tmux-job.ts` and watch one full cycle land a record.
- [ ] Read `/api/readiness` and report the verdict on the current dev head: green, or `unknown` with
      the failing clause named. Either is a success for this stage; what is not is not knowing.
- [ ] The systemd unit text goes in the debrief, unwritten, for Greg.

## Gates

`npm test` and `npm run typecheck` at the end of each stage; `npm run lint` on the touched files as
advice. GPT Sol reviews this plan before Stage 1 and each stage's diff after it.
