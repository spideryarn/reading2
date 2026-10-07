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
of the run, how it ended, what it counted and — for a failure — which test files failed. Wrapping it in `tmux-job.ts` is the usual reason —
the run survives a disconnect and its output is kept.

**How long a run took is already recorded and already drawn.** Every record carries `durationMs`
([`scripts/readiness-run.ts`](../../scripts/readiness-run.ts) writes it; parsed in
[`readiness.ts`](../../tools/fleet/readiness.ts) and
[`readiness-client.ts`](../../tools/fleet/web/src/readiness-client.ts)), and
[`ReadinessPanel.tsx`](../../tools/fleet/web/src/ReadinessPanel.tsx) shows it on each check's row
beside its latest reading (` · 6.2m`, from `describeDuration`) and in each mark's hover title — so a change to *how* it is shown is a panel edit, not a new datum.

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

## The deploy reads it too

Since 2026-10-07 `npm run deploy` takes its `test` gate from this store when a record proves the
exact commit, and `--ready` deploys the newest commit that has one —
[deployment.md § Deploying a commit already known green](deployment.md#deploying-a-commit-already-known-green),
design in [261007k](../plans/261007k-deploy-a-commit-the-readiness-loop-already-saw-green.md). That
is a stricter reader than the tab, and it changed three things here:

- **The runner's `.env.local` is a symlink to the primary's**, re-made every tick. It was a copy
  from 2026-09-09 and had fallen two keys behind the file the deploy links.
- **`data/` and `output/` are deleted and copied fresh from the commit's corpus immediately before
  each check**, as the deploy's empty worktree has them. They were copied once, when the runner was
  created.
- **A loop run carries a preparation stamp** (`preparation` in the record: `by`, `version`, `sha`,
  and the sha256 of the `.env.local` it read), handed to the wrapper in
  `SPIDERYARN_READINESS_PREPARATION`. The wrapper keeps it only when it names the commit the run is
  on and the `.env.local` hash still matches, checks both again at the end, and only then marks the
  finished record `envLocalVerified`; it never passes the variable on to its own children. A
  hand-run wrapper has none, and neither does any record from before the change; the deploy reuses
  only stamped runs, at the current `PREPARATION_VERSION` in
  [`tools/fleet/readiness.ts`](../../tools/fleet/readiness.ts). **Bump that number** whenever what
  the loop does before a run changes in a way a reader of the result would care about. The tab
  ignores the stamp.

**The loop has to be restarted to pick this up**: it loads its code once, at start, from the runner
checkout. Restart it between checks, when the runner's log says it is idle.

## Which test files failed

A failed run's record names the test files that failed, and the tab has a **Failing test files**
card: each file, how many failed runs with recorded names listed it, and when it was first and last listed. That
is the difference between a test that has been red since this morning and one that failed once.
The wrapper also prints the names as its last line, and the loop puts them on its `outcome:` line.
The design is [261006m](../plans/261006m-seventh-sweep-readiness-records-name-the-failing-test-files.md).

Three things it will not say:

- **That no file failed.** The field is a non-empty list or it is absent. Absent means *not known* —
  a record from before 2026-10-06, a failure that was not a test's (typecheck, a killed run), or a
  failure summary the scanner would not vouch for. The card counts those runs rather than dropping
  them.
- **That it is about dev.** The card pools every failed wrapper run in the window, on any commit.
  The headline's five clauses do not apply to it, and it never feeds the headline.
- **More than it kept.** A record lists at most twenty files, sorted, with the true total beside
  them; when a list was cut, the card's counts read "at least".

The names come from vitest's own failure summary — the ` FAIL  <project>  tests/x.test.ts > …`
lines under its `Failed Suites` / `Failed Tests` headings — read as the output streams past, because
in a full `npm run check` that summary is in the middle of a 14 MB log and in neither end the
wrapper keeps. The scanner requires a completed summary and agreement with the streamed file tally,
counting a path run under two projects as two executions. Ambiguous summaries, including a
`FAIL` line quoted inside diagnostic text, leave the names unknown. A run reconstructed from a tmux log never has names: it holds two ends of the log
and could not tell how many failures it had missed.

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
| `tools/fleet/readiness-parse.ts` | reading a check's own output back, and the two things caught as it streams past: an admission refusal and the failing test files |
| `tools/fleet/readiness-backfill.ts` | the tmux-log scan, recomputed per collection and never stored |
| `tools/fleet/build-files.ts` | the fleet bundle's manifest, and the check that the bundle on disk is the one a build wrote |
| `tools/fleet/readiness-verdict.ts` | the conjunction above, as one pure function |
| `tools/fleet/readiness-wiring.ts` | the composition, and the timer that does the expensive work |
| `tools/fleet/routes-readiness.ts` | `GET /api/readiness`, which serves a snapshot and computes nothing |
| `tools/fleet/web/src/readiness-client.ts` | the browser's parser of `/api/readiness`, and its types (the `durationMs` the panel draws) |
| `scripts/deploy-evidence.ts` | the deploy's reader: whether a run proves a commit's `test` gate, and which green commit `--ready` picks |
| `tools/fleet/web/src/ReadinessPanel.tsx` | the dashboard tab: `useReadinessView` fetches on mount and on Refresh, then polls in a second effect at the server's own `refreshMs` (clamped 15s–10min) |

Tests, in `tests/`: [`fleet-readiness.test.ts`](../../tests/fleet-readiness.test.ts) (records, verdict,
parsing), [`fleet-readiness-route.test.ts`](../../tests/fleet-readiness-route.test.ts),
[`fleet-readiness-async.test.ts`](../../tests/fleet-readiness-async.test.ts),
[`fleet-readiness-panel.test.ts`](../../tests/fleet-readiness-panel.test.ts),
[`fleet-readiness-poll.test.tsx`](../../tests/fleet-readiness-poll.test.tsx),
[`fleet-readiness-failing-files.test.tsx`](../../tests/fleet-readiness-failing-files.test.tsx),
[`readiness-failed-files-review.test.ts`](../../tests/readiness-failed-files-review.test.ts) and
[`readiness-loop.test.ts`](../../tests/readiness-loop.test.ts) (the periodic runner,
[`scripts/readiness-loop.ts`](../../scripts/readiness-loop.ts)),
[`readiness-preparation.test.ts`](../../tests/readiness-preparation.test.ts) (the link, the corpus
refresh and the stamp) and [`deploy-ready.test.ts`](../../tests/deploy-ready.test.ts) (the deploy's
reading of all this).

## Three ways it nearly lied, caught in review

The periodic runner (`scripts/readiness-loop.ts`, which keeps dev's checks fresh without anyone
asking) was reviewed three times on 2026-09-09 before it ran, and each review found it could
report a state it had not established. Each is a class worth recognising in anything that keeps
derived state up to date:

- **Recovery keyed to a change, not to the state.** Reinstalling only when a merge touched the
  lockfile meant a failed `npm ci` was never retried, because the next tick saw no new diff.
  [260909a](../postmortems/260909a-a-recovery-loop-remembered-the-transition-not-the-state.md).
- **A printed sentence treated as proof.** Output beginning `NO TESTS RAN…` was taken to mean "the
  suite refused to start" and overrode the exit code, but any test or log could print those words.
  [260909b](../postmortems/260909b-an-unauthenticated-diagnostic-sentence-became-control-flow.md).
- **Exit 0 treated as "the artefact is fresh".** An inherited `npm_config_dry_run=true` made `npm ci`
  succeed without installing, and a stale `dist/index.html` was accepted because it existed.
  [260909c](../postmortems/260909c-artifact-provenance-after-successful-commands.md).

A fourth review, of the fix for that last one, found the fix had the same shape, and the answer was
to stop guessing (2026-10-06,
[261006h](../plans/261006h-readiness-runner-round-3-fleet-bundle-provenance-and-npm-ignore-scripts.md)):

- **A list of inputs stood in for the artefact.** The fleet client was rebuilt only when a diff
  touched a hand-kept list of paths, and the list had already missed one. The runner now builds it
  once per commit itself, remembers that build's manifest, never reuses a bundle it found on disk,
  and checks the result against `build-files.json` — every file the build wrote, with its hash —
  and the stamp's sha.
- **One environment variable pinned at a time.** `--dry-run=false` answered one inherited npm
  setting; `ignore_scripts` and `script_shell` did the same damage. The runner's children now start
  with every `npm_config_*` variable removed. A setting in a user-level npmrc is still not covered,
  beyond `dry-run` and `ignore-scripts`.

## Not built

**Triggering a run from the page.** Greg asked for it; it needs a catalogue entry on the dashboard's
action path (`claude-agents-dashboard` owns that) and Greg's go, because starting a suite from a
phone tap is a box-load decision. Whatever builds it should call `readiness-run.ts` rather than
reinvent it — a tap that spawns a suite without writing a `started` record first loses the one
failure this tab is best placed to report, which is the box killing the run.
