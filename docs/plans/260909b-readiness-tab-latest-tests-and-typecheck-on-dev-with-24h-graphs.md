# Readiness: a tab that says whether the tree is green, and has said so for a day

**Status:** Stage 1 in progress. Written 2026-09-09; **Sections 2–5 rewritten the same day after GPT
Sol's plan review**, which returned *"do not build Stage 1 roughly as written"* and was right. What
that review changed is recorded in [§ What the first draft got wrong](#what-the-first-draft-got-wrong)
rather than quietly edited away, because the discarded design is the one somebody will otherwise
propose again.

> add a tab for "Readiness" that shows information about the latest tests and type-checking (on dev,
> when last run, able to trigger/refresh) and anything else you can think of. Ideally shows graphs of
> 24h history
>
> — Greg, 2026-09-08

Parent: [dev-and-deployment-overview.md](../project/dev-and-deployment-overview.md) once it lands;
this plan is the working document until then. Sibling of
[260908f-box-health-history-24h-graphs-and-swap-retention.md](260908f-box-health-history-24h-graphs-and-swap-retention.md),
whose store this one deliberately does **not** copy — see § 2. The tab itself follows
[fleet-dashboard-modes.md](../project/fleet-dashboard-modes.md).

---

## The problem, stated as a fact about today

**No suite result on this box is written down anywhere.** `npm test`, `npm run typecheck` and
`npm run check` print to a terminal and the terminal goes away. `scripts/tmux-job.ts` keeps a log
per run under `logs/tmux-jobs/`, which is the only durable trace that exists, and that log does not
record **which commit was tested** — the one fact the question "is dev green?" is actually about.

So the tab cannot be built by querying something. The record has to be created, and the first design
question is what a *reading* is and who is honest enough to take one.

### The states, which are the whole design

Copied deliberately from `health-history.ts`, because the failure it exists to prevent is exactly
the failure available here — a page that renders *nothing was recorded* as *everything is fine*.

1. **Pass.** A check ran to completion and exited 0.
2. **Fail.** It ran to completion and exited non-zero.
3. **Void.** It started and we do not know how it ended. Four ways in, and they are not the same:
   the log has no `EXIT=` line; the exit is a shell's 128+signal, which is a kill and not a verdict;
   **the wrapper itself died before it could record anything**; or the tree changed under the run.
4. **Running.** It started and has not finished. Its own state, because "no terminal record yet" and
   "no terminal record ever" are different, and only the first resolves itself.
5. **No reading.** Nobody ran the check. Cannot be written down — the thing that would write it is
   the thing that was not there — so it is only ever an *absence*, drawn as its own state.
6. **A reading about a different tree.** A dozen worktrees run suites on a dozen branches on this
   box. A green `npm test` in someone else's worktree is a true fact about their branch and says
   nothing whatever about `dev`. Pooling those is the specific lie this tab exists not to tell.

---

## 1. Where a reading comes from

Two sources, and **they are not equally good**, so they are never merged.

**`wrapper` — `scripts/readiness-run.ts` runs the check itself.** It knows the argv, the cwd, both
instants, and the sha at each end. This is the source the feature is built on.

    npx tsx scripts/tmux-job.ts npx tsx scripts/readiness-run.ts test

A new file, so no shared file is edited. The alternative the brief offered — a flag on
`scripts/tmux-job.ts` — is rejected on design rather than ownership: that file takes an argv and
forks a subshell, and its whole correctness argument is that it does nothing but redirect. Teaching
it to tee and parse would put a parser inside the one file that must not have one. And not every
check goes through tmux; a typecheck is run directly a dozen times a night.

**`tmux-log` — reconstructed afterwards from `logs/tmux-jobs/*.log`.** It can say when a run
finished and how it ended. **It cannot say which commit it ran on**, because nothing writes that
into the log, and it cannot reliably say what scope it ran at. So it is **historical context only**:
it draws on the 24 h graph, and it can never satisfy the readiness verdict in § 5. That rule is
absolute and is the reason the two sources stay apart.

**The cost, named:** an agent who types plain `npm test` leaves no wrapper reading. That is exactly
why the backfill exists, and exactly why the backfill may not vote.

---

## 2. The store: one atomic file per run

`~/.fleet-readiness/runs/<startedAtEpochMs>-<runId>.json`, written with
`writeAtomically` from [`tools/overseer/jsonl.ts`](../../tools/overseer/jsonl.ts) — write a sibling
temp file, `fsync` it, `rename` it into place, `fsync` the directory. No lock. No rotation. No
append. `FLEET_READINESS_DIR` overrides the root absolutely or not at all, the same argument
`health-history.ts` makes: a relative override resolves differently per worktree, which is two
plausible histories and nothing to say so.

**The first draft used a shared append-only jsonl and it was wrong.** Its argument was that a single
`writeSync` under 4096 bytes to an `O_APPEND` fd cannot interleave. Sol showed that `PIPE_BUF` is a
pipe guarantee and says nothing about regular files, and — decisively — that
[`writeAll`](../../tools/overseer/jsonl.ts) *loops* over `writeSync` because a short write is
possible, so a record is several syscalls and record-level atomicity is gone anyway:

> writer A writes the first 100 bytes of JSON and gets a short result → writer B appends its
> complete line → A appends its remainder. The file contains `A-prefix + B-line`, followed by
> `A-suffix`; both readings are corrupt.
>
> — GPT Sol, 2026-09-09

A waiting lock around append-plus-repair-plus-rotation would also be correct. Per-file is chosen
over it because it is **smaller**: it removes the torn-line repair, the rotation race, the
double-rotation overwrite, the reader-mid-rotation race, the orphaned-lock deadlock and the
open-fd-through-a-rename hazard *as a class*, rather than defending against each. Fewer parts
touching each other — [vision.md § Principles](../project/vision.md#principles).

Its costs, weighed:

- **A directory of files instead of one file.** At ~100 runs a day and 7 days' retention that is
  ~700 files of ~600 bytes. The 24 h window is selected **from the filenames**, before anything is
  opened, so a read touches only what it will use.
- **Two writes per run instead of one** (see § 3). Both are renames; neither blocks anyone.
- **Retention is deletion, not rotation.** A writer opportunistically unlinks records older than the
  retention age, at most a bounded number per run. `unlink` is idempotent, so two writers racing is
  not an event.

### The record

    { schema: 1, runId, state: "started",  startedAt, pid, host, cwd, check, scope, commandLine, treeAtStart }
    { schema: 1, runId, state: "finished", …the same fields…, at, durationMs, outcome, exit, counts, treeAtEnd, logPath, why }

Same path both times: the terminal record **replaces** the pending one. So there is no pair to join,
no ordering to get wrong, and no window in which both exist.

---

## 3. Pending before spawn, or the box's own failure is invisible

The wrapper writes its `started` record **before** it spawns the child, and replaces it after.

This is Sol's P0.2 and it is the finding that matters most, because the case it describes is the
exact one the whole feature exists to expose:

> dev's previous run passed → a new run starts → the wrapper is selected by the OOM killer before
> append → the store contains no evidence of the attempt → the dashboard continues displaying the
> old pass as the latest readiness result.

A `started` record with no terminal record is resolved **at read time**, never by a writer:

- the pid is alive → **running**;
- the pid is gone → **void**, "the wrapper died before it could record an outcome".

Pid reuse could in principle make a dead run look alive. Bounded by refusing to believe a `started`
record older than six hours whatever the pid says, and stated on the page rather than hidden. The
alternative — a heartbeat — is a second mechanism to keep alive for a case that has not happened.

**The wrapper's exit contract**, also Sol's:

- a child killed by a signal must **not** become `process.exit(status ?? 0)`;
- **a failure to record is a failure.** Disk full, directory unwritable: the wrapper exits non-zero
  and says so, even when the child passed. Otherwise the suite passes, nothing is written, and the
  dashboard keeps showing yesterday's green — a silent success inside the tool built to catch them.

---

## 4. The sha, and the honest sentence about `origin/dev`

The wrapper records `treeAtStart` **and** `treeAtEnd` — sha, branch, dirty — because a 26-minute
suite on a tree somebody edited at minute three is a reading about no commit that ever existed:

> the wrapper records clean SHA A → an agent edits a source file during the 26-minute suite → the
> suite reads the uncommitted fix and passes → the record says clean SHA A passed, although that
> tree was never tested.

If either end differs, or either is dirty, the run is `tree-changed` and **cannot** satisfy § 5. It
still draws on the graph. This does not catch edit-and-revert-within-the-run; proving that needs a
dedicated immutable checkout, which is not worth it and is written down here so nobody thinks it is
covered.

### What "on dev" may claim

The reader compares against `origin/dev` **as the box's git already knows it**, and the first draft
proposed reporting the ref's mtime as "last fetched N minutes ago". That is false, in both
directions:

> `git pack-refs` rewrites `packed-refs` because of an unrelated ref → another machine pushes a new
> `dev` → the box's old `origin/dev` value remains, but `packed-refs` has a recent mtime → an old
> recorded SHA is reported as "on dev" against an apparently fresh ref.

And a fetch in which `dev` did not move refreshes no mtime at all. So the page says only what is
true: **"matches this box's cached `origin/dev` — when that was last checked against the remote is
not knowable from the ref."** A green verdict never implies the remote.

Two more things this got wrong and now does not:

- **The cache key.** Caching an ancestry answer per reading-sha alone freezes it: sha `A` is cached
  as `dev-head`, dev advances to `B`, and `A` stays "on dev" for ever. The key is
  `(readingSha, observedDevSha)`.
- **Which checkout.** The dashboard's own `HEAD` is not the primary's. The primary is resolved
  deliberately through `git rev-parse --git-common-dir`; remote-tracking refs are shared through it.

### Git stays out of the request path

`spawnSync("git", …)` in a request handler blocks the single-threaded fleet server, and under the
load this box actually reaches that makes the whole diagnostic dashboard unresponsive at the moment
somebody needs it. So the git snapshot is computed **on a timer**, with a subprocess timeout, cached
by observed dev sha, and has an explicit `unknown` arm when git fails. Same discipline as
`health.ts`: a reading nobody could take is not a zero.

---

## 5. What "ready" actually means

The first draft never said, and Sol found the hole that leaves:

> tests pass on SHA A → dev advances to B → typecheck passes on B → both latest tiles are green →
> the tab says ready even though no commit has passed both checks.

So readiness is **a conjunction keyed to one sha**, computed by one pure function, and every clause
is required:

1. there is an observed dev sha;
2. for each required check, a **wrapper** record, `state: finished`, `outcome: pass`,
   `scope: full`;
3. `treeAtStart.sha === treeAtEnd.sha === devSha`, and neither end dirty;
4. all required checks on **that same sha** — or one full `npm run check` pass, which contains them;
5. no later `started`, `running` or `void` attempt on that sha, which would make the state unknown
   rather than green.

Anything short of all five is **not** "not ready" — it is `unknown`, with the clause that failed
named in a sentence. A tab that says *unknown, because typecheck has no reading on this commit* is
useful; one that says *not ready* is wrong.

Backfilled evidence is displayed and never counted. Neither is a `narrowed` run: `npm test -- one-file.test.ts`
is not "the tests passed", and it is the easiest lie available here.

---

## 6. The backfill, and what it may claim

**Computed at read time, never persisted.** This is a change from the first draft and it removes
three problems at once: a persisted backfill would duplicate the wrapper record for the *normal*
path (the wrapper runs inside `tmux-job`, so its own run has a log), would write yesterday's records
after today's and break any "last line wins" reader, and would freeze a provisional reading of a
still-growing log for ever. Computed fresh, a provisional answer simply corrects itself on the next
poll.

Deduplication against wrapper records: the wrapper prints `readiness-run <runId>` as its first line,
which lands in its own tmux log; the scan skips any log naming a runId the store already holds.

What the scan may recover, and nothing else:

- **when it finished** — the file's mtime, and only for a log that has terminated;
- **how it ended** — the `EXIT=` line; **a signal-like status (129–159) is void, not fail**, because
  `sh` writes 128+signal and `EXIT=137` under a page of green ticks is the OOM killer;
- **what it was** — npm's own two banner lines. The second carries the arguments, so
  `> vitest run tests/one.test.ts` and `> tsx scripts/check.ts --fast` are recorded as `narrowed`
  with the command shown, not flattened into the plain check;
- **the counts** — vitest's `Test Files` / `Tests` block, and `npm run check`'s summary table.

And two refusals:

- **`EXIT=0` alone is not a pass** for `test` or `check`. A coherent terminal footer must be there
  too; a nested process can die while an outer wrapper exits 0. Without the footer it is `void`.
- **No `EXIT=` line means "not complete when I looked"**, not "killed". A log whose mtime is inside
  a grace window is `running`; only a log that has been quiet past it, with no live session, is
  `void`. The file is `stat`ed again after reading, so head and tail cannot come from two states.

Bounds, because this reads a directory a dozen agents write to continuously: filter by mtime first,
newest first, at most 200 files, the first 2 KiB and last 8 KiB of each. **How many files and
directories were skipped is reported**, because a truncated scan that says nothing is a scan that
turns into "no reading". Likewise a log that looks like a check but would not parse is **counted and
shown with its reason** — otherwise a format change silently deletes history.

---

## 7. The graphs, and what they must not paint

Three per check over 24 h, drawn the way `HealthHistory.tsx` draws its bands:

- **outcome** — a mark per reading. **Events, not coverage**: extending a pass rightwards until the
  next run paints eight unobserved hours green. `mergeSpans` / `subtractSpans` / `complementSpans`
  in `history-series.ts` are genuinely generic and get reused; health's cadence and gap inference
  are health-specific and do not.
- **duration** — points. A suite that took 26 minutes and one that took 4 are two facts, not a trend.
  Measured on a monotonic clock, displayed on the wall clock, so an NTP step cannot produce a
  negative duration.
- **failing count**, where the check reports one.

**The graph must segregate the three provenances visually** — current-dev wrapper runs, other-tree
runs, and sha-unknown backfill. Otherwise:

> a branch run passes between two dev failures → the 24-hour band contains a prominent green mark
> that visually reads as dev recovery.

Times go through `tools/fleet/zones.ts` (landed 2026-09-09) and `shiftMsToBrowserClock` in
`web/src/types.ts`; a phone computing its own "24 h ago" on a drifted clock draws missing hours that
look exactly like an outage.

---

## 8. What else goes on the tab

Built — each is one cheap local read:

- the trunk gap `dev` → `main` (`scripts/deploy-checks.ts` `trunkGap` already computes it);
- whether the primary checkout is behind `origin/dev`, with § 4's caveat attached;
- the per-step gate/advisory table from the last full `npm run check`;
- the lint baseline count, labelled advice and not a gate ([linting.md](../project/linting.md)).

Considered and not built, with the reason: **coverage** (nothing produces it; a new expensive job,
not a read); **which tests failed by name** (a second parser and its fixtures — and the counts arm
takes it later without a schema break); **anything from CI** (there is no CI; a push to `dev` builds
nothing).

---

## Stages

### Stage 1 — the record

- [x] `readiness.ts` — the reading type, its per-field parser, signalled-exit handling, `scope`.
- [ ] `readiness-store.ts` — per-run atomic files, the `started`/`finished` states, read-time
      resolution of a pending record, retention by age.
- [ ] `readiness-git.ts` — the tree stamp, the observed dev sha, ancestry keyed on both shas, the
      timer-driven snapshot with its `unknown` arm.
- [ ] `readiness-parse.ts` — the banner, vitest, typecheck and check-table parsers.
- [ ] `readiness-backfill.ts` — the bounded read-time scan, its dedup, its skip counters.
- [ ] `readiness-verdict.ts` — § 5's conjunction, pure.
- [ ] `scripts/readiness-run.ts` — the wrapper: pending-before-spawn, bounded head/tail capture
      (**not** `spawnSync`'s buffered output, which under OOM conditions kills the run it measures),
      the exit contract.
- [ ] Red-first: a log with no `EXIT=` records `void`/`running`, never `pass`. Watch it fail.
- [ ] Red-first: a `started` record whose pid is gone reads as `void`, not as absence.
- [ ] Red-first: the § 5 conjunction refuses tests-on-A + typecheck-on-B.
- [ ] `npm test`, `npm run typecheck`, lint the touched files. GPT Sol review of the code.

### Stage 2 — the tab

- [ ] `routes-readiness.ts` + `readiness-wiring.ts` (the composition, so a test drives the same
      function `server.ts` calls — `health-wiring.ts` exists because the first version of that test
      would have stayed green over a route mounted against a different store).
- [ ] Client parser, panel, graphs; the "no reading" and "unknown" states written first, not last.
- [ ] The four registrations for `readiness` **and only** `readiness`, plus the `App.tsx` mount, per
      [fleet-dashboard-modes.md](../project/fleet-dashboard-modes.md) — and
      `expect(MODES).toContain("readiness")` in my own test, because a merge that removes all five
      registrations at once typechecks clean.
- [ ] GPT Sol review on the diff, weighted higher than Stage 1's.

### Stage 3 — trigger/refresh

- [ ] The design: which command, in which checkout, what it costs the box, how the result becomes a
      record, what stops two taps starting two suites.
- [ ] Agreed with `claude-agents-dashboard`, which owns every write path. **No second way to run a
      command from the page.**
- [ ] Blocked on Greg.

---

## What the first draft got wrong

Kept because the discarded design is the one somebody will propose again. All five were GPT Sol's,
2026-09-09; all five were right and are fixed above.

| The claim | Why it was wrong |
|---|---|
| A sub-4 KiB `O_APPEND` write cannot interleave | `PIPE_BUF` is a pipe guarantee. And `writeAll` loops, so a record is several syscalls |
| The wrapper records the outcome when the child ends | It cannot record its own death, which is the box failure the tab is *for* |
| The `origin/dev` ref's mtime is when we last fetched | `pack-refs` touches it without fetching; a fetch that changes nothing does not touch it |
| Wrapper and scanned readings are distinguished, so they are safe | The normal path produces both for the same run, and the weaker one is later |
| The tab shows the latest reading per check | Two green tiles on two different commits is not a green tree, and nothing said so |

## The simpler option this passed over

**A file with the last result in it, no history, no graphs** — `latest.json`, overwritten by the
wrapper, read by the route. A tenth of the code, and it answers "is dev green right now", which is
most of the question.

Rejected because the 24 h graph is the half Greg asked for explicitly, and because a single slot
cannot express state (6) at all: the last writer wins, so one green run in a worktree erases the red
one on dev and the page says *green* with total confidence.
