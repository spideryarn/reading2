# Readiness: a tab that says whether the tree is green, and has said so for a day

**Status:** Stage 1 not started. Written 2026-09-09.

> add a tab for "Readiness" that shows information about the latest tests and type-checking (on dev,
> when last run, able to trigger/refresh) and anything else you can think of. Ideally shows graphs of
> 24h history
>
> — Greg, 2026-09-08

Parent: [dev-and-deployment-overview.md](../project/dev-and-deployment-overview.md) once it lands;
this plan is the working document until then. Sibling of
[260908f-box-health-history-24h-graphs-and-swap-retention.md](260908f-box-health-history-24h-graphs-and-swap-retention.md),
which is the feature this one is modelled on and, in two places, deliberately not modelled on.

---

## The problem, stated as a fact about today

**No suite result on this box is written down anywhere.** `npm test`, `npm run typecheck` and
`npm run check` print to a terminal and the terminal goes away. `scripts/tmux-job.ts` keeps a log
per run under `logs/tmux-jobs/`, which is the only durable trace that exists, and that log does not
record **which commit was tested** — the one fact the question "is dev green?" is actually about.

So the tab cannot be built by querying something. The record has to be created, and the first design
question is what a *reading* is and who is honest enough to take one.

### The four states, which are the whole design

Copied deliberately from `health-history.ts`, because the failure it exists to prevent is exactly
the failure available here — a page that renders *nothing was recorded* as *everything is fine*.

1. **Pass.** A check ran to completion and exited 0.
2. **Fail.** A check ran to completion and exited non-zero.
3. **Void.** A check started and we do not know how it ended: the process was killed, the box OOMed,
   the tmux log has no `EXIT=` line. **This is not a fail and it is certainly not a pass.** It is the
   state [silent-success.md](../reusable/silent-success.md) is about. The specimen is a run that
   ends `EXIT=143` with a log full of green ticks, because something else on the box killed it. A
   void reading must never contribute a green pixel.
4. **No reading.** Nobody ran the check. Cannot be written down, only inferred from the absence of a
   line, and rendered as its own thing: "nothing has run since 03:41", not a gap in a green bar.

### And the fifth, which is this feature's own

5. **A reading about a different tree.** Nine worktrees run suites on nine branches tonight. A green
   `npm test` in `worktree-260909a-dashboard-descriptions` is a true fact about that branch and says
   *nothing* about dev. Pooling those is the specific lie this tab must not tell, and it is the one
   `health.jsonl` never had to think about because there is only one box.

---

## What gets built

### Stage 1 — the record (the writer, the store, the backfill)

Server-side and headless. Nothing visual.

**Reordered from the brief, which put the read-only tab first.** A tab whose only possible content
is "no reading" is not a stage anybody can evaluate — it looks identical whether it works or not,
which is the shape of bug this repo keeps writing postmortems about. So the data comes first and the
tab in Stage 2 has something real to draw on its first render.

- `tools/fleet/readiness-history.ts` — the store. Append-only jsonl at `~/.fleet-readiness/readiness.jsonl`,
  `FLEET_READINESS_DIR` overriding it absolutely or not at all (the same argument
  `health-history.ts` makes: a relative override resolves differently per worktree, which is two
  plausible histories and nothing to say so).
- `scripts/readiness-run.ts` — **a new file, so no shared file is edited.** Runs one named check,
  times it, records the sha, parses the counts out of its own captured output, appends one line.

      npx tsx scripts/tmux-job.ts npx tsx scripts/readiness-run.ts test

  This is the honest source: it knows the argv it ran, the cwd it ran in, and the sha at the moment
  it started, none of which can be recovered from a log afterwards.
- `tools/fleet/readiness-backfill.ts` — a bounded scan of `logs/tmux-jobs/` (the primary's, and each
  worktree's) for runs inside the window, so the tab is not empty on day one.
- `tools/fleet/readiness-git.ts` — the sha questions, answered locally and never over the network.

### Stage 2 — the tab

- `tools/fleet/routes-readiness.ts` + `tools/fleet/readiness-wiring.ts` (the composition, so a test
  drives the same function `server.ts` does — `health-wiring.ts` exists because the first version of
  that test would have stayed green over a route mounted against a different store).
- `tools/fleet/web/src/readiness-client.ts`, `readiness-series.ts`, `ReadinessPanel.tsx`.
- `Dock.tsx` / `mode.ts`: the `readiness` mode's own four entries, added in the same commit as the
  panel. Per the Overseer's correction of 2026-09-09, nobody owns the list; the rule is *never edit
  another mode's entries*, and count the entries after every merge — a merge can drop one with no
  conflict marker, and the `Record<Mode, …>` types are what catch it.
- One mount line in `server.ts`; one block at the END of `wire.ts` if a shared type is needed.

### Stage 3 — trigger/refresh: design only

Greg asked for it and it is not built in this plan. Written up, agreed with `claude-agents-dashboard`
(which owns every write path), and started only on Greg's word — running the suite from a phone tap
is a box-load decision, not a UI decision.

---

## The design decisions worth arguing about

### 1. Where the reading comes from, and why not a flag on `tmux-job.ts`

The brief offered a flag on `scripts/tmux-job.ts` as an alternative. Rejected, for two reasons and
neither is ownership:

- **`tmux-job.ts` does not know what it is running.** It takes an argv and forks a subshell. To
  record "this was the test suite, and 371 tests passed" it would have to parse output it
  deliberately never reads — the whole point of that file is that the log is opened before the
  command runs and the command's stdout goes straight to it. Teaching it to tee and parse would put
  a parser inside the one file whose correctness argument is that it does nothing but redirect.
- **Not every check goes through tmux.** A typecheck takes 40 seconds and is run directly a dozen
  times a night. A wrapper script is invocable both ways; a tmux flag is not.

The wrapper is a separate binary that *runs* the check, so it knows the argv, the cwd, the sha, the
start and end instants, and holds the output to parse. It composes with `tmux-job.ts` rather than
competing with it.

**The cost, named:** an agent has to type `readiness-run.ts test` instead of `npm test`, and one
that types `npm test` leaves no reading. That is exactly why the backfill exists, and why the tab
distinguishes a wrapper reading from a scanned one rather than merging them.

### 2. Many writers, one file — and why the health store's lock is the wrong model

`health.jsonl` has one writer (the dashboard) and takes an exclusive lock. This file has **many**:
every worktree, every agent, several at once, each appending one line and exiting. A writer lock
here would mean a check whose reading is silently dropped because a peer held the file for the
0.017 ms it takes to append — a lost reading, which is state (4), which the page will draw as *this
never ran*.

So: **`O_APPEND` and one `writeSync` per line, with the line bounded below 4096 bytes.** A single
write of at most `PIPE_BUF` to an `O_APPEND` fd is not interleaved on Linux; that is the standard
multi-process append guarantee and it is why syslog and every logger works. The bound is therefore
load-bearing, not tidiness: a line over it may tear, so a record that would exceed it is written as
a `record-omitted` arm carrying only the fields that fit, in its own arm rather than as a silently
truncated reading.

Rotation is the one operation that is not a single append. It runs under
`tools/overseer/lock.ts` and **skips rather than waits** when the lock is held — the next writer
rotates, the file overshoots by a few kilobytes, and nothing blocks. At a measured ~500 bytes a
reading and perhaps a hundred readings on a busy night, the 8 MiB cap is about six months, so this
path will run approximately never and must therefore be correct by construction rather than by
observation.

### 3. "On dev" is a sha, and the answer has an age

The writer records `sha`, `branch` and `dirty` (uncommitted changes present when the check started —
a green suite on a dirty tree is a reading about no commit at all, and says so).

The reader answers *was this dev's head?* by comparing against `origin/dev` **as the primary
checkout already knows it**. It does not fetch: a dashboard poll that hits the network every ten
seconds is a new failure mode for a page whose job is to be up when things are down. Instead it
reads the ref and **reports how stale the ref itself is** (the mtime of `refs/remotes/origin/dev`,
or of `packed-refs`), so the page can say "dev as this box last fetched it, 6 minutes ago" rather
than implying a freshness it does not have.

Per distinct sha, cached, bounded:

| verdict | how | what the page says |
|---|---|---|
| `dev-head` | `sha === origin/dev` | on dev |
| `behind-dev` | `git rev-list --count sha..origin/dev` | dev has moved N commits since |
| `not-on-dev` | not an ancestor | a branch — names it |
| `unknown` | sha not in this repo, or git failed | says which, never guesses |

A backfilled reading has **no sha at all** and gets its own verdict, `sha-unknown`. It is drawn
differently from every other state. This is the asymmetry the whole tab rests on and it must be
visible without reading a tooltip.

### 4. What the backfill can and cannot claim

From a `logs/tmux-jobs/*.log` the scanner can honestly recover:

- **when it finished** — the file's mtime, and only when the log ends `EXIT=<n>`;
- **how it ended** — that `EXIT=` line, or *void* when there is none;
- **what it probably was** — the npm banner `> spideryarn@1.0.0 <script>` in the first lines, which
  is emitted by npm itself and is reliable; failing that, vitest's `RUN v4.x` banner, which says
  *a test run* without saying which script;
- **the counts** — vitest's `Test Files  1 failed (1)` / `Tests  1 failed | 4 passed (5)` block, and
  `npm run check`'s summary table (`✓ typecheck    clean` / `✗ test  FAILED` / `! dupes  308 finding(s)`).

It cannot recover the sha, and it must not attempt to infer one from the log's timestamp against the
reflog. That is a plausible join with no way to be checked, and a join that cannot contradict
anything is not a measurement. Unclassifiable logs are **skipped,
not guessed**: an overseer daemon log and a codex run are not readiness readings.

Bounds, because this reads a directory other agents write to continuously: files filtered by mtime
into the window first; at most 200 files; the first 2 KiB and the last 8 KiB of each, never the
middle (a full-suite log is megabytes and the two ends carry everything above).

### 5. The graphs

Three per check, over 24 h, drawn the way `HealthHistory.tsx` draws its bands:

- **outcome** — a band per reading, green/red/violet(void), with **no interpolation between
  readings**. A gap is a gap: `mergeSpans`/`complementSpans`/`subtractSpans` in `history-series.ts`
  are generic and get reused rather than rewritten.
- **duration** — points, not a line, for the same reason. A suite that took 26 minutes and one that
  took 4 are two facts, not a trend.
- **failing count** — where the check reports one.

Time formatting reuses `shiftMsToBrowserClock` from `web/src/types.ts` — a phone with a drifted
clock drawing its own "24h ago" produces missing hours that look exactly like an outage. `zones.ts`
has not landed; when it does, this adopts it rather than keeping a second formatter.

### 6. What else goes on the tab ("anything else you can think of")

Built, because each is one cheap local read:

- **the trunk gap** `dev` → `main`: how many commits are on dev that production does not have
  (`scripts/deploy-checks.ts` `trunkGap` already computes it).
- **is the primary checkout behind `origin/dev`**, with the same ref-staleness caveat as above.
- **per-step verdicts from the last `npm run check`** — the gate/advisory split is the interesting
  half of that command and the summary table parses cleanly.
- **the lint baseline count**, labelled as advice and not a gate, because
  `docs/project/linting.md` says the baseline is deliberately not clean.

Considered and **not** built now, with the reason:

- **Coverage.** Nothing produces it today; adding a coverage run is a new expensive job, not a read.
- **Which tests failed, by name.** Recoverable from a vitest log and genuinely useful, but it is a
  second parser with its own fixtures and it can be added to the store later without a schema break
  (the counts arm is already per-check-kind).
- **Anything from CI.** There is no CI; a push to `dev` builds nothing.

---

## Stages

### Stage 1 — the record

- [ ] `readiness-history.ts`: the arms, `parseReadingLine`, `openReadiness`, `append`, `read`,
      `status`, rotation-under-lock-or-skip, the 4 KiB line bound and its `record-omitted` arm.
- [ ] `readiness-git.ts`: sha, branch, dirty, `origin/dev` and its ref age, ancestry with a cache.
- [ ] `scripts/readiness-run.ts`: the wrapper. Records *void* when its child is killed by a signal.
- [ ] `readiness-backfill.ts`: the bounded scan and the three parsers, with fixtures **cut from real
      logs** and copied into `tests/fixtures/` (`logs/` is gitignored, so a fixture that points at
      one is a test that passes only on this box tonight).
- [ ] Red-first test: a tmux log with no `EXIT=` line records `void`, never `pass`. Watch it fail.
- [ ] Red-first test: two concurrent writers each land a whole line.
- [ ] `npm test`, `npm run typecheck`, lint the touched files. GPT Sol review.

### Stage 2 — the tab

- [ ] Route + wiring + the wiring test that drives the same function `server.ts` calls.
- [ ] Client parser (validated per arm, never cast — these bytes crossed a version boundary).
- [ ] `ReadinessPanel.tsx` and the graphs; the "no reading" state written first, not last.
- [ ] Dock entries for `readiness` only; entry count checked after the pre-push merge.
- [ ] GPT Sol review on the diff, weighted higher than Stage 1's.

### Stage 3 — trigger/refresh

- [ ] The design: which command, in which checkout, what it costs the box, how the result becomes a
      reading, and what stops two taps starting two suites.
- [ ] Agreed with `claude-agents-dashboard` as a catalogue entry on its action path. **No second way
      to run a command from the page.**
- [ ] Blocked on Greg.

## The simpler option this passed over

**A file with the last result in it, no history, no graphs.** `~/.fleet-readiness/latest.json`,
overwritten by the wrapper, read by the route. It is a tenth of the code and it answers "is dev
green right now", which is most of the question.

It was rejected because the 24 h graph is the half Greg asked for explicitly, and because a
single-slot file cannot express state (5) at all: the last writer wins, so one green run in a
worktree erases the red one on dev and the page says *green* with total confidence. The append-only
file is not a richer version of that design — it is the one that can be honest.
