# Recognised live process roots: the admission census, on an end-chained task

Up: [260910a-admission-visibility-explaining-why-heavy-work-should-wait.md](260910a-admission-visibility-explaining-why-heavy-work-should-wait.md)
§4 and §7, which are this stage's contract, and
[260910a-stage4-census-task.md](260910a-stage4-census-task.md), the task brief the previous session
wrote before it stopped. Queue item `qi-5e9beszv`, final stage, dispatched by the Overseer on
2026-09-10 to session `admission-census`.

**One sentence:** the Box health admission section gets a third block, headed **"Recognised live
process roots"**, which says how many vitest runners, Codex batch jobs and browsers were observed during its
last pass over the process table, as an observation with a start and an end, a finite recogniser scope and its own uncertain and unreadable
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
   `cmdline`, then `stat` again. If the two start ticks differ, the `cmdline` may belong to a
   different process than the `stat`; if only the ppid changed, the process was reparented. Either way
   the row did not give one stable identity-and-parent observation, so it is **changed-under-read**
   (F46). Argv keeps its boundaries: whitespace inside one element becomes `␣` before any recogniser
   sees it (F42).
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
   `ppid === 0` is the kernel and ends the walk successfully (F43). Unsettled means: the walk reaches
   a positive ppid that is not in the table, or an ancestor that is
   unreadable or changed-under-read, or a cycle, or a **parent whose start tick is later than its
   child's**, which cannot be a real parent relation and is a reused pid.
5. **Counts.** Per class, `roots` and `uncertain`. Across the table, `changedUnderRead` and
   `unreadable`, which belong to no class, because a row whose identity moved under the read cannot
   honestly be attributed to one. Plus `processesSeen`. The block states all of them.
6. **The cache is a three-state union**: `not-yet-computed` (with the instant the task started),
   `value` (a census, the instants its pass started and completed, and the cadence — the counts mean
   *observed during that pass*, F44), `failed`
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

**Settled: (a), authorised by the Overseer on 2026-09-10**, on four conditions: behaviour-preserving
(no new names in the browser set), a test that drives `isBrowserProgram` alone, `origin/dev` merged
first, and `actions.ts` named in the commit message. The Overseer also confirmed that reusing
`recogniseHarnessCommand` supersedes the task file's "write one new recogniser for `codex-batch`":
one tested recogniser for `codex exec` already exists, and a second copy is what the task file's own
reasoning forbids.

**Widened once, for F61, also authorised by the Overseer on 2026-09-10.** Round 1 found that
`isVitestRunner` matched the vitest path in *any* argument, so `vim /repo/node_modules/.bin/vitest`
was a "runner". The census would over-count it, and **the Kill "test suites" action would kill that
editor**. The fix matches the executable position only: argv0 itself, or the first non-option
argument after a `node`, skipping the values of `--require`, `--import`, `--conditions` and
`--loader`. The Overseer's conditions: red-first with vim, grep, cat and unrelated-node negatives;
the two real captured shapes kept green; and a comment at the function saying why position matters.
**Its consequence for Kill, stated because it changes what Kill does: the `test-suites` policy now
refuses more processes than before, and never kills one it previously refused.**

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
**Measured on the box, 2026-09-10 07:58 UTC, load 6**, 20 passes each of `stat` + `cmdline` + `stat`
per pid, reads only, with no fold: **880 processes** (twice the 425 the earlier measurement saw).
Synchronous: **49.1 ms median, 82.8 ms worst**, every millisecond of it blocking the event loop.
Async: **338 ms median, 484 ms worst** wall time per pass, and a longest event-loop stall of **2.4 ms
median, 6.2 ms worst**, measured with a 1 ms interval running beside it. So async trades about seven
times the wall time for a stall roughly thirteen times shorter, and on a 30-second cadence the wall
time costs nothing anybody waits on. The fold is pure arithmetic over the rows and is not in these
numbers.

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

- [x] `tools/fleet/admission-census.ts`: the pure fold, the `/proc` adapter, and the task with its
      three-state cache.
- [x] `admission-wiring.ts` composes and starts it; `routes-admission.ts` serves the cache.
- [x] `wire.ts` types, `admission-client.ts` parser, `AdmissionSection.tsx` block.
- [x] The `actions.ts` extraction (Decision 1 (a)): `isBrowserProgram` exported,
      `isVitestRunner` narrowed to `Pick<ProcRecord, "args">`.
- [x] The nine tests from the task file, red first, plus the stale parent link, the kernel root,
      the composition, and a census the browser cannot parse leaving the forecast intact.
- [x] Measure the pass on the box, wall time and event-loop stall.
- [x] Sol code review, two rounds.

**Status:** implemented by **Codex (GPT Sol, `workspace-write`)** in one run; this session read the
diff, ran the gates (six focused files, 603 tests, typecheck green) and measured it on the box.
Codex's own report included a "final GPT Sol review: PASS", which was Codex reviewing its own work
inside the same run. It does not count as the cross-family review, which follows.

**Measured on the box, 2026-09-10 08:41 UTC, load 8**, the real `readProcRows` + `foldCensus`, 20
passes over 876 processes: **345 ms median, 407 ms worst wall time per pass; longest event-loop
stall 2.4 ms median, 15.4 ms worst; the fold alone 3.5 ms median, 6.6 ms worst.** It found 2 vitest
roots, 2 Codex batch roots and 4 browser roots — and **387 "unreadable"**, which was the finding.

**F47, found by that measurement, not by any test or reader.** 387 of 876 rows were
"unreadable", because the adapter treats an empty `cmdline` as a failed read. Counted by hand
straight afterwards: of 862 processes, **396 had an empty `cmdline` — 228 kernel threads, 159
zombies, and 9 that vanished mid-count.** An empty argv is a readable fact, not a failed read. As
built, the block would permanently say that about 390 rows could not be read, and would qualify
every zero as unclean. Codex's sandbox saw a three-process pid namespace with none of these, so no
fixture it wrote had a kernel thread in it. Handed to the round-1 reviewer to fix red-first.

---

## The simpler option this passed over

**Reuse `routes-actions.ts`'s `listProcesses()`**, which already turns two `ps` calls into
`ProcRecord`s for the Kill buttons. It cannot give a start tick, so nothing in it can tell a reused
pid from the one it replaced, and the join between its two `ps` calls is exactly the "two reads are
not one observation" defect §4 names. It is fine for a kill confirmation that re-reads immediately
before acting; it is not fine for a count on a page that claims to be an observation.

---

## Review dispositions — the plan check

Sol, 2026-09-10, `--sandbox review`, on my reading of the task file. Verdict **REFUSE as written**,
F42–F44 established P1s. IDs continue from the parent plan's F1–F41. Each was checked against the
code before being taken.

| ID | Finding | Disposition |
|---|---|---|
| F42 | `recogniseHarnessCommand` reads flattened `ps args`; joining `/proc` cmdline with spaces throws away the argument boundaries, so an interactive `codex 'review this diff'` becomes `codex review this diff` and counts as `codex-batch` (`work.ts` documents exactly this, and a test pins it) | **Taken, and the reuse is kept.** The adapter encodes argv faithfully *into* the `ps`-shaped string: whitespace inside one argv element becomes `␣` (U+2423, which `\s` does not match), so one argument stays one token for every token-splitting recogniser — `recogniseHarnessCommand`, `isVitestRunner` and the `--type=` helper test alike. Test: argv `["codex", "review this diff"]` is not `codex-batch`; `["codex", "exec", "…"]` is |
| F43 | The missing-parent rule has no kernel-root exception: every chain ends at pid 1, whose ppid is 0, and there is no `/proc/0` | **Taken.** `ppid === 0` ends the walk successfully; only a missing *positive* ppid is unsettled. Fixture added |
| F44 | Rows are bracketed one at a time over an async pass, so a process read early may be gone by completion; the counts mean *observed during the pass*, not *alive at completion* | **Taken.** The `value` state carries `startedAtMs` as well as `completedAtMs`, and the block says *observed during a pass that ran from … to …*. "Alive right now" is gone from this plan and from the block |
| F45 | Fallback (b) misreads `stat` field 24 (pages, not KiB) and misuses `cwd: null` | **Moot** — (a) was authorised; the fallback is not built |
| F46 | A changed ppid with equal start ticks is reparenting, not a different process | **Taken**: such a row "did not give one stable identity-and-parent observation", and is counted in `changedUnderRead` either way |

Sol also confirmed: the later-parent test holds on Linux with strict `>`; with F43 fixed the fold stops
both workers and helpers being roots; Decision 1's narrowing is sound; Decisions 2–4 have no
established P0/P1; and all three existing composition tests must stop the task they start.

## Review dispositions — code review round 1

Sol, 2026-09-10, `--sandbox workspace-write`, on `08920a5b`. It fixed what it found, red-first; this
session read its diff as a proposal, reran the gates (six focused files, 615 tests; typecheck;
`build:fleet`) and remeasured on the box. Verdict **REFUSE** on one established P1, F61, which it was
not allowed to fix.

| ID | Finding | Disposition |
|---|---|---|
| F47 | An empty `cmdline` counted as unreadable: 387 of 876 rows on the box were kernel threads and zombies | **Fixed.** A readable row with empty argv, and no recogniser matches empty argv, so a zombie Chrome is not a live browser. **Remeasured on the box: `unreadable` 5 of 913** (09:18 UTC, load 15; 3 vitest, 3 Codex batch and 4 browser roots, no uncertain; 649 ms median wall, 18.5 ms worst stall) |
| F48 | A stale last-good kept only its end instant | **Fixed.** It carries both bounds, and the block says the stale pass "ran from … to …" |
| F49 | Treating ppid 1 as terminal made a recognised pid 1 and its same-class child two roots, and a hidden pid 1 a certain root | **Fixed.** Only ppid 0 ends the walk. This narrows the code back to F43 as written |
| F50 | An empty argv element (`["codex", "", "exec"]`) joined to `codex  exec` and moved `exec` into the subcommand position | **Fixed.** Empty elements encode as `␀` (U+2400) |
| F51 | `comm` changing between the two `stat` reads (an `exec`) left a stable-looking row that never existed | **Fixed.** A changed `comm` is changed-under-read |
| F52 | An orphaned vitest worker (reparented to pid 1) was a test root | **Fixed** by excluding known worker entry points before ancestry, as Chrome helpers are. **Noted:** that exclusion is a new argv test (`/node_modules/vitest/dist/workers/`). It only removes candidates, so it can under-count, never over-count, and it is accepted on that basis |
| F53 | A child read while nested, plus a zombie parent read afterwards, could certify a root that never was one | **Fixed.** An empty-argv ancestor makes ancestry uncertain |
| F54 | The section fetched once, so a first `not-yet-computed` stayed on screen for good | **Fixed.** It re-reads end-chained every 30 s, after the previous request completes |
| F55 | Under unknown skew, a fresh value could be called "older than twice its cadence" | **Fixed.** Oldness is said only when skew is known |
| F56 | An unreadable forecast discarded a valid census | **Fixed.** The census survives the forecast's `no-answer` arm |
| F57 | The parser accepted counts that cannot fit in `processesSeen` | **Fixed** |
| F58 | A backwards clock produced a pass that ended before it began | **Fixed**, in the producer (a failed pass) and in the client |
| F59 | A read resolving after `stop()` still folded and wrote the cache; unrelated composition tests started real `/proc` reads | **Fixed** |
| F60 | The cadence was written twice, and a throwing `readCensus` was stamped with the route's copy | **Fixed.** `admission-constants.ts` owns it, and the chosen cadence reaches the route |
| F61 | `isVitestRunner` matches the vitest path in *any* argument, so `vim /repo/node_modules/.bin/vitest` is a runner. The census over-counts, and **the Kill "test suites" action would kill that editor** | **Fixed** after the Overseer widened the authorisation (Decision 1). Implemented by Codex in its own run so round 2 reviews it as someone else's code: argv0 itself, or the first non-option argument after `node`/`nodejs`, skipping the values of `--require`/`-r`, `--import`, `--conditions`/`-C`, `--loader`/`--experimental-loader`; `node -` is not a runner. Red first: vim, grep, cat and an unrelated node script each returned `true`; the vim row through `killVerdict` returned `kill: true`; the census counted it as a test root. No existing test changed. **The test-suites kill policy now refuses more, never kills more** |

## Review dispositions — code review round 2

Codex, 2026-09-10, on `1652260d`. It spent the review on round 1's fixes and F61, fixed every
in-scope finding red-first, then gave the final P1 fix a narrow independent recheck. Verdict
**ACCEPT after fixes**: no established P0 or P1 remains. Discovery closes with this round.

| ID | Severity and evidence | Disposition |
|---|---|---|
| F62 | **P1, established.** `node --title /repo/node_modules/.bin/vitest -e setInterval(()=>{},1000)` is a non-Vitest Node program whose title value merely looks like a runner, but F61 still returned `true` and Kill returned `kill: true`. The first attempted fix exposed the inverse arity trap: with `node --abort-on-uncaught-exception <typescript>/tsc.js /repo/node_modules/.bin/vitest`, guessing that an unknown boolean option consumed the next token skipped the real TypeScript script and again killed the process as Vitest. Both shapes were run through real Node as well as the predicate | **Fixed.** Known value-taking options skip their values, known valueless options continue, and an unknown bare Node option refuses classification rather than guessing. Eval, print, package-run, Node-test and stdin modes cannot promote a later argument into the ordinary script position. Tests went red on both unsafe Kill verdicts; required real shapes cover `node`, `nodejs`, `--inspect`, `--`, separate and inline preload options and a U+2423 path. The final narrow recheck passed 16 adversarial shapes. New ⇒ old remains structural, so Kill only ever refuses more |
| F63 | **P2, established.** `node <repo>/node_modules/vitest/dist/../../typescript/lib/tsc.js --version` ran TypeScript but the lexical `vitest/dist/.*.js` pattern called it Vitest | **Fixed.** A path must match both before and after POSIX normalisation. The test went red on traversal and keeps a real `vitest/dist/cli.js` positive. The conjunctive check cannot add a Kill match |
| F64 | **P2, established.** `isVitestWorker` searched every argument, so a real CLI runner whose later test path was `vitest/dist/workers/example.test.js` disappeared from the census | **Fixed.** The worker exclusion reuses `isVitestRunner` over prefixes to locate the executable position, then tests that token only. The later-argument fixture went red first; the captured `forks.js` worker remains excluded |
| F65 | **P2, established.** `stop()` suppressed a late successful census read but a late rejection still replaced the stopped cache with `failed` and logged it | **Fixed.** The catch has the same stopped guard as success. A deferred rejection test went red on both the cache mutation and log |
| F66 | **P2, established.** A rejected browser request scheduled no successor, while a never-settling request permanently arrested the loop and poisoned later mounts through `pendingForecasts` | **Fixed.** Requests now have a 20-second bound and AbortSignal; success, rejection and timeout all end-chain the next 30-second read. Last-consumer teardown aborts and evicts an abandoned request, while consumer counting preserves StrictMode's one shared GET. Rejection, timeout and remount fixtures went red first; signal forwarding and cleanup assertions pin the finished lifecycle |
| F67 | **P2, established.** The 30-second timer fetched while `document.visibilityState` was `hidden`, and becoming visible had no catch-up | **Fixed.** Hidden ticks retain the cadence without fetching; `visibilitychange` clears that timer and asks once on return. The hidden fixture went red at two requests instead of one, and the finished test was mutation-checked by disabling the guard |

Round 2 also checked and found no defect in the census carried by `no-answer`, the
`processesSeen` inequality (every producer bucket is disjoint and unrecognised/helper rows are
allowed slack), the empty-argv ancestor rule, or importing the pure constants leaf into the browser
bundle. Final evidence: seven focused files, **778 tests green**; all four typecheck projects green;
`build:fleet` green. A whole `npm test` attempt could not start its database lanes because this
sandbox cannot connect to the local Postgres port; it did not report a test failure.
