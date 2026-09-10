# Recognised live process roots: the admission census, on an end-chained task

Up: [260910a-admission-visibility-explaining-why-heavy-work-should-wait.md](260910a-admission-visibility-explaining-why-heavy-work-should-wait.md)
§4 and §7, which are this stage's contract, and
[260910a-stage4-census-task.md](260910a-stage4-census-task.md), the task brief the previous session
wrote before it stopped. Queue item `qi-5e9beszv`, final stage, dispatched by the Overseer on
2026-09-10 to session `admission-census`.

**One sentence:** the Box health admission section gets a third block, headed **"Recognised live
process roots"**, which says how many vitest runners, Codex batch jobs and browsers are alive right
now, as an observation with an age, a finite recogniser scope and its own uncertain and unreadable
counts, computed on a timer and served from a cache that is a state and not a value.

**What it must not claim.** Presence, and nothing more. A Chrome root may be parked and idle, a
`codex exec` is a generic batch job rather than a review, and anything this cannot recognise is not
counted at all. The words *heavy*, *active* and *review* never label an observed process; the parent
plan's F8, F9 and F14 are why.

---

## My reading of the task file, stated as sentences to check

1. **The census is pure over rows**, and the adapter that reads `/proc` is separate from it, so
   every case below is a fixture rather than a machine.
2. **One row per pid, read in three steps and bracketed:** `stat` (ppid, comm, start tick), then
   `cmdline`, then `stat` again. If the two start ticks differ, or the ppid changed, the `cmdline`
   may belong to a different process than the `stat`, so the row is **changed-under-read**.
   Anything that vanished (ENOENT/ESRCH, or an empty `stat`) at any of the three reads is
   **unreadable**. This is `execution-identity.ts`'s before/after bracket, applied per row rather
   than per table, and it reuses that file's `parseProcStat` for the ppid and start tick rather than a
   second parser. `parseProcStat` does not return `comm`; that is the text between the first `(` and
   the last `)`, the same boundary `parseProcStat` already relies on.
3. **Recognisers are reused, not written.**
   - `test` — `isVitestRunner` from `actions.ts`, which matches executable paths. It also matches
     vitest *workers* (`/node_modules/vitest/dist/…`), so workers are removed by the fold, not by
     the recogniser.
   - `browser` — the `comm` rule inside `isOrphanedDebugPipeBrowser` (`chrome` / `chromium` /
     `google-chrome`, exact). **It is not exported**, and `actions.ts` is not in my file set — see
     *Decision 1*.
   - `codex-batch` — the task file says to write one new recogniser. **One already exists and is
     tested**: `recogniseHarnessCommand` in `tools/overseer/harness.ts` returns `codex-batch` for
     `codex exec` / `codex e` / `codex review`, on the resolved executable basename via `work.ts`'s
     `resolveExecutable`, which never peels a shell and never treats anything under `/tmp` as an
     installed tool (`bash /tmp/fake-codex-…/codex` is a real command line on this box). I reuse
     it, import-only, and write no new recogniser. This follows the task file's reasoning ("you do
     not write new ones") over its letter. `harness.ts` is under `tools/overseer/` and stays
     unedited; `execution-identity.ts` already imports from it.
4. **The fold.** A recognised row is a *root* when no ancestor carries the same class. A Chrome
   helper (a `--type=` token in argv) is never a root and is not counted at all. A recognised row
   whose ancestry cannot be settled is **uncertain** for its class rather than guessed either way.
   Unsettled means: the walk reaches a ppid that is not in the table, or an ancestor that is
   unreadable or changed-under-read, or a cycle, or a **parent whose start tick is later than its
   child's**, which cannot be a real parent relation and is a reused pid.
5. **Counts.** Per class, `roots` and `uncertain`. Across the table, `changedUnderRead` and
   `unreadable`, which belong to no class, because a row whose identity moved under the read cannot
   honestly be attributed to one. Plus `processesSeen`. The block states all of them.
6. **The cache is a three-state union**: `not-yet-computed` (with the instant the task started),
   `value` (a census, the instant its pass completed, how long it took, and the cadence), `failed`
   (the cause, the instant, and the last good value marked stale, or null). A `/proc` that cannot be
   enumerated at all is `failed`, never an empty census.
7. **The task is end-chained**: pass, then wait the cadence, then pass — `server.ts`'s
   `refreshLoop` rule. The first pass runs at start. **It never throws into the server**: every
   pass is caught, and so is the loop itself.
8. **The route serves the cache**, never walks `/proc` in a handler; the forecast stays uncached.
9. **The block** sits under the forecast and the journal in `AdmissionSection.tsx`. It states its
   own age, names the recogniser scope, states the uncertain and unreadable counts, and renders
   `not-yet-computed` as its own sentence, never as "nothing is running".

## Decisions

### Decision 1 — the browser rule, which is not exported

The rule lives inline in `isOrphanedDebugPipeBrowser`. Three ways to reuse it:

- **(a) A small export in `actions.ts`**, outside my file set: extract
  `isBrowserProgram(proc: Pick<ProcRecord, "comm">)` from `isOrphanedDebugPipeBrowser`, which then
  calls it, and narrow `isVitestRunner`'s parameter to `Pick<ProcRecord, "args">`. Behaviour
  unchanged, with every existing caller still compiling. The narrowing is the valuable half: the
  compiler then *proves* the census can hand these rules a row without `cwd`, `rssKiB` or
  `etimeSeconds`, and would refuse the census if either rule ever started reading one. **Asked of
  the Overseer**, because the brief says to stop and ask rather than edit outside the set.
- **(b) The fallback, if (a) is refused:** the census keeps `ProcRecord`-typed rows by filling the
  three fields it does not read (`cwd: null`, which the type already defines as "not read"; the
  two numbers from the `stat` it has already read — `rss` is field 24 and elapsed time comes from
  the start tick and one `/proc/uptime` read), so it calls `isVitestRunner` unchanged. For the
  browser rule it holds a one-line copy of the three names, with a test that pins it to
  `isOrphanedDebugPipeBrowser` over a list of real `comm`s (`chrome`, `chrome_crashpad`, `chromium`,
  `google-chrome`, `node`, …) by feeding each through the orphan rule's other two conditions. A
  copy pinned by a test that fails when the copies differ.
- **(c) Rejected:** calling `isOrphanedDebugPipeBrowser` with a synthetic `ppid: 1` and a
  synthetic `--remote-debugging-pipe`. It is "reuse", but the census would lose every browser the
  day somebody adds a fourth condition to the orphan rule, and nothing would go red.

### Decision 2 — async reads, so the blocking is removed and not moved

The previous session measured the walk synchronously at 37.7 ms median, 56.0 ms worst over 425
processes. A timer moves that stall off the request path but still blocks the one event loop every
cadence, which is round 2's F13 in a smaller form. The adapter reads with `fs/promises`, so a pass
yields between files. The pass takes longer in wall time, and a longer window means more
changed-under-read rows, which the bracket already turns into an honest count rather than a guess.
To be measured on the box both ways: wall time per pass and the longest event-loop stall.

### Decision 3 — the cadence, and where the task starts

**30 seconds**, injectable. `makeAdmission` starts the task, because `server.ts` holds only a call to
`makeAdmission()` and is not in my file set. It returns a `stop()`, and every test that builds a real
composition stops it. That keeps `server.ts` unedited, and the existing wiring test ("server.ts
builds the composition exactly once") becomes proof that production runs the census.

### Decision 4 — the payload

`AdmissionPayload` gains `census: AdmissionCensusState`, on both label arms, because the census is
not about the requested kind. Appended types in `wire.ts`. The client parses it independently of the
forecast, so a census it cannot read is a census-only arm in the browser's voice and never blanks
the forecast. That is the journal's precedent.

---

## Stages

Codex (GPT Sol, `workspace-write`) implements; this session writes the prompt, runs the gates,
reviews and commits.

### Stage A — census, task, route, block

- [ ] `tools/fleet/admission-census.ts`: the pure fold, the `/proc` adapter, and the task with its
      three-state cache.
- [ ] `admission-wiring.ts` composes and starts it; `routes-admission.ts` serves the cache.
- [ ] `wire.ts` types, `admission-client.ts` parser, `AdmissionSection.tsx` block.
- [ ] The nine tests from the task file, red first, plus: the stale parent link (start tick later
      than the child's) is uncertain; the composition test drives a census through the real
      `makeAdmission`; a census the browser cannot parse leaves the forecast intact.
- [ ] Measure the pass on the box, wall time and event-loop stall.

**Status:** not started.

---

## The simpler option this passed over

**Reuse `routes-actions.ts`'s `listProcesses()`**, which already turns two `ps` calls into
`ProcRecord`s for the Kill buttons. It cannot give a start tick, so nothing in it can tell a reused
pid from the one it replaced, and the join between its two `ps` calls is exactly the "two reads are
not one observation" defect §4 names. It is fine for a kill confirmation that re-reads immediately
before acting; it is not fine for a count on a page that claims to be an observation.
