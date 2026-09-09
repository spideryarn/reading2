# Readiness: whether dev is green, and how we know

Up: [dev-and-deployment-overview.md](dev-and-deployment-overview.md).

> add a tab for "Readiness" that shows information about the latest tests and type-checking (on dev,
> when last run, able to trigger/refresh) and anything else you can think of. Ideally shows graphs of
> 24h history
>
> — Greg, 2026-09-08

The **Readiness** tab on the fleet dashboard ([fleet-dashboard-modes.md](fleet-dashboard-modes.md))
answers one question — *is the commit `origin/dev` is on known to pass its checks?* — and spends most
of its effort refusing to answer it wrongly.

The design and the five review rounds behind it are in
[260909b](../plans/260909b-readiness-tab-latest-tests-and-typecheck-on-dev-with-24h-graphs.md). This
page is the short version: what an agent has to do, and what the tab will and will not claim.

## The one command

    npx tsx scripts/tmux-job.ts npx tsx scripts/readiness-run.ts test

`scripts/readiness-run.ts` runs one check (`test`, `typecheck`, `check`, `lint`, `build`) and writes
a record to `~/.fleet-readiness/runs/` carrying the commit it ran on, the tree state at **both** ends
of the run, how it ended and what it counted. Wrapping it in `tmux-job.ts` is the usual reason —
the run survives a disconnect and its output is kept.

**A plain `npm test` leaves no record.** It will still appear in the tab's 24-hour history,
reconstructed from its tmux log, drawn faded — and it can never make the answer green, because
nothing writes the commit into a log and a run about no commit cannot be evidence about `dev`.

## What "green" is allowed to mean

Every clause is required, and each one is a way the tab could otherwise have lied:

1. a **wrapper** record — not a log reconstruction;
2. **full scope** — `npm test -- one-file.test.ts` is not "the tests passed";
3. the same commit at the **start and end** of the run, clean at both — including untracked files,
   because a source file imported but never committed makes the working tree compile and the commit
   not;
4. **every required check** (`test`, `typecheck`) on that same commit, or one passing `npm run check`;
5. **no later unfinished attempt** on it — though a known failure is sticky and a rerun does not
   erase it.

Short of all five the answer is **`unknown`, with the failing clause named** — not "not ready".
*Unknown because typecheck has no reading on this commit* is useful; *not ready* for the same
evidence is wrong. On this box, unknown is the common and correct answer.

And "on dev" means **this box's cached `origin/dev`**. When that was last checked against the remote
is not knowable from the ref — `git pack-refs` touches it without fetching, and a fetch that changes
nothing does not touch it — so a green verdict is never a claim about what is on GitHub now.

## What the graphs show

A mark per run, at the instant it finished. **Not spans**: extending a pass rightwards to the next
run would paint hours nobody observed. Full-height ringed marks are runs that count; half-height ones
are history. Marks closer together than their own width merge, and the **worst** state in the group
is the one drawn — a failure is never hidden behind a pass.

## Where it lives

| | |
|---|---|
| `scripts/readiness-run.ts` | the wrapper: records before it spawns, so its own death is visible |
| `tools/fleet/readiness.ts` | the record's shape and its parser |
| `tools/fleet/readiness-store.ts` | one atomic file per run; no lock, no rotation |
| `tools/fleet/readiness-git.ts` | the tree stamps and the dev snapshot, bounded and off the request path |
| `tools/fleet/readiness-parse.ts` | reading a check's own output back |
| `tools/fleet/readiness-backfill.ts` | the tmux-log scan, recomputed per collection and never stored |
| `tools/fleet/readiness-verdict.ts` | the conjunction above, as one pure function |
| `tools/fleet/readiness-wiring.ts` | the composition, and the timer that does the expensive work |
| `tools/fleet/routes-readiness.ts` | `GET /api/readiness`, which serves a snapshot and computes nothing |

## Not built

**Triggering a run from the page.** Greg asked for it; it needs a catalogue entry on the dashboard's
action path (`claude-agents-dashboard` owns that) and Greg's go, because starting a suite from a
phone tap is a box-load decision. Whatever builds it should call `readiness-run.ts` rather than
reinvent it — a tap that spawns a suite without writing a `started` record first loses the one
failure this tab is best placed to report, which is the box killing the run.
