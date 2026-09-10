# Resource history — show what was running when load rose

**Status: planning.** Queue item `qi-bvpyeaqw`, dispatched by the Overseer on 2026-09-10. The
roadmap stage is
[260908f-overseer-and-fleet-improvement-roadmap.md](260908f-overseer-and-fleet-improvement-roadmap.md)
§ *Stage: Resource history — show what was happening when load rose*; its four checkboxes and its
acceptance paragraph are the spec, and this doc is the how.

> the page can relate a resource spike to the observed concurrent work, with its timestamp and its
> uncertainty
>
> — the roadmap's acceptance sentence

## What is already built, and what this is therefore not

**Half the stage shipped on 2026-09-08–09 and nothing in this plan rebuilds it.** Reading the code
before writing the plan changed what the work is:

- `tools/fleet/health-history.ts` (943 lines) keeps 24 hours of health on disk at
  `~/.fleet-health/`, one JSONL line per collection turn, with a single-writer lock, rotation, torn-
  line repair, a `nextDueMs` on every sample so a break can be told from a backoff, and four
  carefully separated kinds of nothing.
- `tools/fleet/web/src/history-series.ts` + `HealthHistory.tsx` draw four series — load per core,
  memory used, swap used, IO wait — on one x scale, with gaps hatched, unknowns in violet, absent
  readings in grey, a "before the record begins" region, and a verdict strip underneath.
- `tools/overseer/work.ts` + `work-reading.ts` classify what is running under each pane, and the
  daemon writes the result to `checkpoint.work` on every checkpoint (plan
  [260909h-wire-the-work-classifier-into-the-overseer-daemon.md](260909h-wire-the-work-classifier-into-the-overseer-daemon.md),
  on `dev` at 99dbefaa).

So four things are missing, and they are this plan:

1. **Disk is not plotted.** The roadmap names load, memory, swap *and disk*; `SERIES` has
   `load | memory | swap | io`. The reading is already in every stored sample — `parseDisk` runs on
   every turn and `DiskReading` is on `HealthReport` — so nothing new is collected. It is a fifth
   entry in a list.
2. **Work is not written down.** `checkpoint.work` is the *present tense only*: the daemon
   overwrites it every checkpoint. Nothing anywhere remembers what was running twenty minutes ago,
   so the acceptance sentence — *relate a spike to the concurrent work* — cannot be answered at all
   today, however good the health chart is.
3. **There is no read side over `checkpoint.work` that keeps the whole scan.**
   `projectOverseerStatus` reads it, but `projectRegister` then keeps only a *bounded, ranked*
   subset of sessions for the Overseer card. Ranking for a card and recording for a history are
   different jobs.
4. **The cutoffs are declared twice, deliberately, and the reason has expired.** `computeVerdict` in
   `tools/fleet/health.ts` hardcodes `> 4` and `> 2` times cores, `< 0.05` and `< 0.15` available
   memory, `>= 0.9` and `>= 0.98` swap, `>= 90` and `>= 97` disk and `>= 50` IO wait, as literals in
   `if` statements. `tools/fleet/web/src/health-view.ts` declares `THRESHOLDS` with the same
   numbers. **This is not an oversight — the duplication is argued for in that file's header**:

   > Every cutoff below is `computeVerdict`'s in tools/fleet/health.ts, restated rather than
   > imported — that file opens with `node:child_process`, so a type-only import still makes
   > TypeScript walk a module this browser project has no node types for. […] The failure it buys is
   > specific and worth naming: a tile coloured amber beside a badge that says `ok`, because one of
   > the two moved. So the numbers are all in `THRESHOLDS` below rather than scattered through the
   > readers, and tests/fleet-web.test.tsx pins each boundary. If health.ts's cutoffs change, that
   > test is what should go red.

   **The argument is sound and its premise is avoidable, and the last sentence is not true.**
   `tests/fleet-web.test.tsx` pins the *tile's* boundary at the literal `0.15`; it never calls
   `computeVerdict` — the name appears in that file only in comments. So moving health.ts's literal
   to `0.20` leaves the whole suite green with the badge and the tile disagreeing, which is exactly
   the failure the header names. And the premise — *importing health.ts drags node in* — is dissolved
   by a **pure leaf with no imports at all**, which is how the browser already reaches `zones.ts`,
   `attempt-clock.ts`, `overseer-claim.ts` and `execution-token.ts`. So this stage does not overturn
   a decision; it removes the cost that decision was paying.

## The simpler option this passed over

**A second history file, `~/.fleet-health/work.jsonl`, with its own writer, rotation and reader.**
That is the obvious shape and it is rejected. It would need a second copy of the lock discipline,
the rotation invariant, the torn-tail repair and the positional-hole reporting that
`health-history.ts` spent a day getting right — four mechanisms whose failure modes all *look like
data*. It would also put the work reading and the health reading on two clocks, so every join in the
browser would be a nearest-neighbour match with its own error, and "what was running when load rose"
would be answered by arithmetic rather than by reading one line.

**Instead the work summary rides on the health sample it belongs to.** One file, one writer, one
lock, one rotation, one reader, one clock, and the join is that the two facts are on the same line.
The cost is sample size, and it is bounded deliberately: see `WORK_EVERY_MS` below.

**The other thing not built: per-job CPU or memory.** `ps -eo pid=,ppid=,etimes=,args=` is what the
Overseer's probe reads, and it carries no `%cpu` and no `rss`. Adding them means changing what the
daemon writes, which this stage is explicitly not allowed to do, and it would be a second measuring
apparatus besides `parseAttribution`. So **"top contributing" here means observed concurrently, for
this long — never "used this much CPU"**, and the page has to say so in words. See § Attribution
uncertainty.

## Design

### The stored shape

**This is the second version of this section.** The first put one optional `work` field on the
`reading` arm, and GPT Sol refused it: four different situations produced the identical stored shape
(*a legacy sample*, *a turn that was not due*, *a due turn on which health collection itself failed*,
*a due turn whose summary was too big*), which is precisely the four-state contract this store's
header exists to protect. The envelope below is its fix, and it is on **every** sample arm, not only
the successful one.

```ts
/** Was work looked at on this turn, and what came back. On EVERY arm of HealthSample. */
export type StoredWorkTurn =
  | { kind: "not-due" }
  | { kind: "due"; result: StoredWork };

/**
 * What the daemon's scan said — **the producer's own arms, with the producer's own clocks.**
 * Never collapsed into one `unavailable`: see below.
 */
export type StoredWork =
  | { kind: "not-yet-run"; asOf: string; why: string }
  | { kind: "probe-failed"; attemptedAt: string; sourceCollectedAt: string; why: string }
  /** We could not read the checkpoint at all — ours, not the daemon's. `checkedAt` is our clock. */
  | { kind: "checkpoint-unavailable"; checkedAt: string; why: string }
  | {
      kind: "scan";
      scannedAt: string;
      groups: StoredWorkGroup[];
      groupsDropped: number;
      panes: { work: number; none: number; cannotTell: number };
    };

export type StoredWorkGroup = {
  session: string;      // the Overseer's session key — a session, never a command line
  recogniser: string;   // "codex-exec", "vitest", … the Overseer's vocabulary, kept as a string
  jobs: number;         // job processes with that recogniser under that pane, at that instant
  /** The group's timing, which is a THREE-way answer and not a nullable pair. See below. */
  timing:
    | { kind: "known"; oldestStartedAt: string; longestRanForMs: number }
    | { kind: "partial"; knownJobs: number; oldestStartedAt: string; longestRanForMs: number }
    | { kind: "unknown" };
};
```

Six things this shape is doing on purpose:

- **`workTurn` is on every arm, and `not-due` is written explicitly.** *Absent* now means one thing
  only — a record written before work tracking existed. A turn that was due and could not produce a
  summary writes a `due` result saying why; it never writes nothing. This is what makes
  `WORK_EVERY_MS` a description of intent rather than the only way to reconstruct what happened,
  which it could not do across a restart's phase change or before the first work sample.
- **The producer's arms survive, each with its own clock.** Collapsing `not-yet-run` and
  `probe-failed` into one `unavailable` loses the timestamp of the *event*, and Sol's sequence is
  real: a probe fails at 10:00, the daemon then stops producing fresh scans while its checkpoint
  keeps that failure, and the store reads it at 10:05, 10:10 and 10:15. Three records of one
  attempt. With the attempt's own clock kept, they are recognisably one.
- **The same rule applies to a stale SUCCESS**, and it is the half nobody would think of: three
  samples carrying the same `scannedAt` are **one observation**, not three. So the renderer's rule
  is: *key an event by its source discriminant and its source timestamp; repeated copies of one
  `scannedAt` or `attemptedAt` are one observation, never several.* That sentence has to be in the
  browser projection's header, because nothing else can enforce it.
- **`scannedAt` is separate from the sample's `at`.** The daemon's scan and the dashboard's health
  turn are different reads, seconds to minutes apart, and a renderer that used one clock for both
  would be claiming a simultaneity nobody measured. Same rule `PaneJob.ranForMs` already follows:
  *frozen at the read, not extrapolated to now*.
- **`groupsDropped` exists so a truncated list never reads as a complete one.** A cap with no
  counter is a truncation that reads as an exhaustive list.
- **`panes` is the uncertainty, stated as numbers.** "Three groups running" beside "eleven panes we
  could not read" is a different sentence from "three groups running" alone, and the second is the
  one this whole area exists not to print.

**On `timing`, where Sol's finding is taken and its repair is not.** F7 is right that a group can mix
a job with a known start and a job without one, and that a min/max over only the known ones reads as
exhaustive. Sol's fix is to null both aggregates unless every job's timing is known. That is safe and
it throws away a real reading: one unknown job in six should not erase the other five. The
discriminated union above keeps the information and makes the dishonest rendering **impossible to
write** rather than merely discouraged — a renderer cannot print a `partial` as though it were a
`known` without naming the arm, which is this repo's own "let the types catch it" rule. `knownJobs`
is on the `partial` arm so the row can say *"2 of 5 jobs' timing was unavailable"*.

### The cadence, and its arithmetic

```ts
export const WORK_EVERY_MS = 5 * 60_000;
```

The roadmap says *"store changes/events at a deliberate cadence"* and the brief's recorded product
default is five minutes.

**The first draft's arithmetic was wrong twice, and the second error was the one that mattered.** It
said a group is about 70 bytes; serialising one with the fields actually proposed is about 173, so
30 groups is ~5.35 KB and ~1.54 MB/day rather than the claimed 620 KB. The ordinary conclusion
survived that — but the proof did not, and the proof was the point.

The real hole was underneath it. **Capping the number of groups does not cap the number of bytes.**
`session` and `why` are arbitrary non-empty strings as far as every parser in this repo is concerned,
so the only bound in force would have been `MAX_LINE_BYTES` — and just-under-64-KiB work records
every five minutes is about **18 MiB/day**, which rotates an 8 MiB file in **under eleven hours** and
breaks the invariant `MAX_FILE_BYTES`'s comment states: *the cap must comfortably exceed a window's
worth of samples*. A blank chart at the moment somebody is trying to find out what went wrong is the
exact failure this whole feature exists to prevent. GPT Sol's F4, and it is the best finding of the
review.

So the bound is **in bytes, on the encoded value**:

```ts
export const MAX_STORED_WORK_BYTES = 4 * 1024;
```

- Drop the lowest-ranked group and re-encode until it fits, incrementing `groupsDropped` — so the
  bound is enforced on the thing that is actually written, not on a proxy for it.
- Bound `why` and every identifier string visibly, the way `boundWhy` already does, so a truncation
  says it happened.
- If no useful bounded projection fits at all, store a bounded `checkpoint-unavailable` saying so.
- 288 × 4 KiB is ~1.15 MB/day on top of ~1 MB/day, so an 8 MiB file still covers about four days.

**And the arithmetic is a test rather than a paragraph.** A comment claiming a rate is a comment;
the check is a test that builds 288 maximum-sized work records plus a pessimistic day of ordinary
health samples and asserts the total stays comfortably under `MAX_FILE_BYTES`. That is the only form
of this argument that cannot go stale — which is the lesson of the 40,000,420-byte file that broke
the same invariant in this same module in August.

**Absent `workTurn` on a sample means one thing only: a record written before work tracking
existed.** Everything else is written down — `not-due` when the cadence did not call for one, and a
`due` result with its own arm and clock when it did.

**THE WORK SUMMARY MUST NEVER COST US THE HEALTH READING.** Reading `append` closely turned up the
sharp edge in this design. A line over `MAX_LINE_BYTES` is not written; a `sample-omitted` record
goes down in its place and *the whole health reading for that turn is lost* — which is right when the
reading itself is the thing that is too big, and completely wrong when a decoration pushed it over.
So the order is: **bound the work summary so it cannot plausibly do that** (30 groups ≈ 2.2 KB
against a 64 KiB limit and an 869-byte typical sample), and then, if a line is oversized anyway,
**retry once without `work`** and record that the work summary was dropped, before the existing
`sample-omitted` path is allowed to run. A reader must be able to tell "we dropped the work summary
to keep the reading" from "we could not keep the reading", so that is a stated fact and not a
silence.

**Where the cadence state lives:** in the wiring, not the store — the store has no business holding
an opinion about how often work is interesting. It starts `null`, so **the first turn after every
restart carries a work summary**, which is deliberate: a restart is exactly the moment somebody wants
to know what was running. A dashboard restarting faster than the cadence would write one every turn;
that is a much louder problem than a slightly dense history, and it is written down here rather than
guarded against.

### Where the reading comes from

**Reading the plan's first draft against the code changed this.** The draft was going to export
`parsePaneWork` and walk the `panes` array again. It does not need to: `resolveWork` in
`overseer-status.ts` already parses the whole scan into a `Map<string, PaneWork>` — **uncapped**,
because the capping happens later, in `projectRegister`, when it picks which sessions to *show*. It
also already enforces the producer invariants a history would otherwise have to re-derive: that the
scan belongs to the register's accepted inventory, that `scannedAt` is not after the checkpoint that
reports it, that a pane's start is not after the scan, that a job's `ranForMs` agrees with its
`startedAt`, and that no pid appears twice.

So the read side is **a fourth projection out of the one `loadCheckpoint` read**, beside `attention`,
`overseer` and `usage`. That file's header already argues for exactly this and has been extended once
before, for `usage`:

> The sharing is a correctness property, not a saving. […] One read, three projections, each with
> its own compatibility policy.

**The `work` feed must come from the same `resolveWork` call the register uses**, not a second one,
or the page could show a scan the register rejected. That is the one thing a reviewer should check in
Stage 2.

`tools/fleet/work-groups.ts` is then a pure leaf with one job: `Map<string, PaneWork>` → `StoredWork`,
grouping, ranking, capping and counting. No I/O, no clock, no checkpoint knowledge.

The grouping rule, and why it does not double-count:

- one group per **(session key, recogniser)**, never per command line — the brief's recorded product
  default, and `safeCommand` has already dropped everything but the executable anyway;
- **a wrapper and its leaf cannot both appear**, because `classifyPaneWork` stops the walk at a
  recognised job and never descends past one. That is a property of the existing classifier, not
  something this module enforces, so Stage 2's first test is a pane with several descendants under
  one recognised job, asserting exactly one group with `jobs: 1`.

### Where it is written

`makeHealthRetention` in `health-wiring.ts` gains an injected `readWork` dep defaulting to the
checkpoint read. `retainHealth` decides, from the last work-carrying sample it wrote, whether this
turn is due. **`refresh.ts` is not touched**: the loop should not grow an opinion about work, and the
composition root is where the wiring argument already lives.

### What is drawn

- **Disk** becomes the fifth `SERIES` entry, cutoffs from the policy module.
- A new `WorkHistory` section, mounted from `HealthHistory.tsx` with one import and one element, so
  the `admission-visibility` and box-health sessions' work in that file is barely touched. It shares
  the existing x scale: one row per job group, a strip marking the samples it was observed on,
  ranked by observed duration, with the sentence about what that ranking is and is not.
- **The peak line**, and its wording is the whole finding. The first draft said "the groups observed
  on" the worst-load sample and the memory breakdown "at that moment". **Neither is true, and the
  second is false even within one health turn**: `collectHealth` runs `uptime`, `free`, `swapon`,
  `df`, `vmstat` and `ps` one after another, each with a five-second timeout, and stamps a single
  `collectedAt` at the end. So load and attribution are *related survey readings*, not one instant —
  and the work scan is a third clock again. GPT Sol's F3. The rule, therefore:

  > The peak line names the **load sample's** timestamp. Beside it, the nearest work scan is shown as
  > *"observed at X — Δ before/after the load reading"*, never as having been observed *on* the peak.
  > If no work scan falls within the nearby-window, it says that no nearby work reading exists rather
  > than reaching further. Attribution is labelled *"collected in the same health survey turn"*, not
  > *"at that moment"* — its command carries no timestamp of its own.

- **Current expensive work** on the Box Health panel: what is running now, how long it has been
  running as measured, and how many panes had no usable reading. **This needs a data path that does
  not exist**, which the first draft never noticed (Sol's F5). It cannot come from the history —
  that is a five-minute cadence, so "current" would be up to five minutes stale and would need a
  history scan per browser, which the roadmap explicitly rules out. And it cannot come from the live
  `overseer` feed either, because that carries `projectRegister`'s **eight-row capped** list. So:

  > `currentWork` is projected from the same single checkpoint read `readCheckpointFeeds` already
  > does, carried as a field on `FleetState`, parsed at the client boundary and passed to
  > `HealthPanel`. It is never derived from the history file. **The five-minute cadence governs
  > persistence only, never what the page shows as now.**

  That threads `state.ts`, `wire.ts`, `web/src/types.ts` and `App.tsx` — files outside the brief's
  named set, though not on its "not yours" list. **The Overseer authorised it explicitly on
  2026-09-10**, on the conditions that the additions stay small and additive, that each file is
  re-read immediately before it is edited, and that `origin/dev` is merged before every push —
  because the `admission-visibility` session is editing `wire.ts` and `HealthPanel.tsx` at the same
  time. It also confirmed the stage ordering above, and asked for Stage 4 to be attempted rather than
  stopped short of, the weekly budget being at 3%.

### Attribution uncertainty, in the page's own words

Five sentences the UI must carry, because each is a claim the data cannot support and a reader would
otherwise assume:

1. *Ranked by how long each job was observed running, not by how much CPU or memory it used — the
   box does not measure per-job cost.*
2. *Sampled every five minutes: a job that started and finished between two samples is not here at
   all.*
3. *N panes could not be read at this sample* — whenever `panes.cannotTell` is non-zero.
4. *This reading is the same one as the previous sample's* — whenever consecutive records carry one
   `scannedAt`, because the daemon has stopped producing fresh scans and the alternative is drawing
   one observation as several.
5. *Timing was unavailable for N of these jobs* — the `partial` arm of a group's `timing`.

## Stages

Each stage ends with `npm test`-scoped suites plus `npm run typecheck`, and a GPT Sol review
(`--sandbox workspace-write`, fixing inside the stage) before its commit.

**The stages are ordered so that the irrecoverable half lands first, and that is deliberate.**
Stages 1–3 are the *record*; Stage 4 is the *drawing*. The asymmetry between them is total: a night
that was not written down cannot be drawn tomorrow, but a night that was written down can be drawn
next week. The queue sized this stage at "about half an agent-day" and it is visibly larger than
that, so if it has to stop somewhere, **the honest stopping point is the end of Stage 3** — at which
the box has started remembering what was running, `/api/health/history` serves it, and nothing on
the page has changed yet. Stopping at the end of Stage 2 is worth much less: the projection exists
and nothing calls it, which is a feature that has not shipped rather than a feature that is quiet.

### Stage 1 — one policy module for the cutoffs (mine, small)

**Status 2026-09-10: built, green, committed.** Done myself because it is an import and five
comparisons; the tests and the mutation check are the substance. The plan review reached it and
found nothing wrong with the extraction, adding one caution now written into the tests: **the
equality semantics are not uniform** — load and memory are strict, swap, disk and IO wait inclusive
— so each direction is asserted separately.
`npx vitest run tests/fleet-resource-policy.test.ts tests/fleet-health.test.ts tests/fleet-web.test.tsx`
→ 467 passed; `npm run typecheck` → exit 0 over all four projects.

**The mutation check, run rather than reasoned about** (`docs/reusable/silent-success.md`): the new
test is green against the code as written, so on its own it proves nothing — a boundary test whose
subject and whose definition of the boundary both come from the same constant would stay green
however the comparison moved. So `computeVerdict`'s load comparison was changed from `>` to `>=` and
the suite re-run: *`load is STRICTLY greater than, so exactly the cutoff is not yet strained` — expected
'strained' to be 'ok'*. Reverted, green again. The identity assertion was likewise red before the
extraction, with vitest reporting *"serializes to the same string / Compared values have no visual
difference"* — which is exactly what a silent duplicate looks like.

- [x] New `tools/fleet/resource-policy.ts`: a pure leaf with no imports, holding `RESOURCE_POLICY`
      (load ratio, memory available, swap used, disk used, IO wait) with the evidence for each
      number moved from wherever it currently lives, plus `LOAD_BAR_CEILING` and
      `MEMORY_USED_PERCENT` derived from it, plus the work policy (which recogniser ids are
      expensive, and what counts as a long run).
- [x] `health.ts`'s `computeVerdict` uses it instead of literals; `health-view.ts`'s `THRESHOLDS`
      becomes the policy rather than a copy of it. All five groups moved: load, memory, swap, disk
      and IO wait.
- [x] **The header states the rule the roadmap asks for**: an unavailable reading is not zero load
      and not unlimited capacity, so the policy contains no fallback value for a reading that was
      never taken, and says why one must not be added.
- [x] Red first: `tests/fleet-resource-policy.test.ts` drives `computeVerdict` at each cutoff
      *computed from the policy constant*, and asserts `THRESHOLDS` is the policy by **identity**
      rather than by deep equality — a `toEqual` would pass against a second object holding the same
      numbers, which is the state this file exists to make impossible.
- [x] One pre-existing prose defect fixed on the way past: `computeVerdict`'s swap comment said
      "nothing below 95%" beside code that has compared 90% since it was written. A number in prose
      beside the number it describes, drifting where nothing could see it — which is the same
      argument as the rest of this stage.

### Stage 2 — the read side over `checkpoint.work` (Codex, gpt-5.6-sol)

**Status 2026-09-10: landed in two rounds, `509f29d4` and `0af436e6`.** The first was dispatched
before the plan review returned and built the collapsed shape; the second applied F2, F4 and F7.
Recorded because the second round's diff otherwise reads as churn.

- [ ] New `tools/fleet/work-groups.ts`; a fourth `work` projection out of the one `loadCheckpoint`
      read, sharing `projectRegister`'s `resolveWork` call rather than making a second one.
- [ ] Types in `wire.ts` (types only, appended).
- [ ] `StoredWork` keeps the producer's four arms and their clocks (F2), and `StoredWorkGroup.timing`
      is the three-armed union (F7) — **both of these arrived after the first Codex pass was
      dispatched**, so Stage 2 lands in two rounds: the first against the collapsed shape, the second
      correcting it. Recorded because the second round's diff will otherwise look like churn.
- [ ] `MAX_STORED_WORK_BYTES` enforced on the encoded value, dropping the lowest-ranked group until
      it fits, with bounded `why` and identifier strings (F4).
- [ ] Tests: one job with several descendants → one group; two jobs same recogniser under one pane →
      one group with `jobs: 2`; a `probe-failed` checkpoint keeps `attemptedAt`; a checkpoint written
      before work scans existed → `not-yet-run`/unavailable, not an empty scan; a `cannot-tell` pane
      counted in `panes.cannotTell` and absent from `groups`; the byte cap dropping groups and saying
      how many; a group with one known and one unknown start → `timing.kind === "partial"` with
      `knownJobs: 1`.

### Stage 3 — writing it down (Codex, gpt-5.6-sol)

**Status 2026-09-10: landed at `3f49da1c`.** One defect the scoped tests could not see:
`StoredWorkTurn` was used in three files and never declared, so every vitest run passed — **vitest
does not type-check** — while `npm run typecheck` failed in two projects. Written here because it is
the second time on this branch that a green scoped run was not the gate.

- [ ] `health-history.ts`: `workTurn` on **every** sample arm, parsed back, byte-bounded, with the
      cadence constant. `not-due` is written explicitly; absent means "before work tracking existed"
      and nothing else (F1).
- [ ] Work is read **independently of whether the health turn succeeded** — a `collector-failed` turn
      that was due still records what work said (F1).
- [ ] `health-wiring.ts`: the `readWork` dep, the clock, and the due check, with the cadence state
      in the wiring rather than the store.
- [ ] The oversize retry: a work summary must never cost us the health reading, and a dropped
      summary must say it was dropped rather than look like a turn that was not due.
- [ ] **The rotation arithmetic as a test**, not a paragraph: 288 maximum-sized work records plus a
      pessimistic day of ordinary samples, asserted comfortably under `MAX_FILE_BYTES` (F4).
- [ ] Tests: all four of F1's sequences; a sample from an older build with no `workTurn` field
      parses (a version boundary — `StoredReport`'s comment is the precedent); `{kind:"scan",
      groups:[]}` round-trips and is not normalised into an absence; expired history — a work record
      whose sample has rotated out of the window; a refused append does not advance the cadence.

### Stage 4 — the page (Codex, gpt-5.6-sol)

**Status 2026-09-10: landed at `15ab391f`.** The run reported honestly that **seven of its ten named
tests were green on their first run** rather than seen red, so they describe the code rather than
reproduce a defect. The composition one was the one worth checking and was verified here by
mutation: replacing `App`'s `currentWork={feed.state?.currentWork ?? …}` with the constant reds both
end-to-end tests, which is the property that matters — a test passing the prop directly would have
stayed green. The rest were handed to the code review as explicitly unverified.

- [ ] Disk as the fifth series.
- [ ] `web/src/work-series.ts` (pure projection, testable without a DOM) and `WorkHistory.tsx`,
      mounted from `HealthHistory.tsx`'s `HistoryBody` with one import and one element, after the
      series and the verdict strip.
- [ ] **The dedupe rule lives in `work-series.ts`'s header and in its code**: an event is keyed by
      its source discriminant and source timestamp, so repeated copies of one `scannedAt` or
      `attemptedAt` are one observation (F2). Nothing downstream can enforce this.
- [ ] The peak line, with F3's wording: the load sample's own timestamp, the nearest work scan given
      as a delta rather than as simultaneity, and attribution labelled "collected in the same health
      survey turn".
- [ ] `currentWork` threaded `readCheckpointFeeds → FleetState → App → HealthPanel`, never derived
      from the history (F5).
- [ ] Tests: stale vitals (a scan much older than the sample carrying it must render as *the reading
      is N minutes older than this point*, never as simultaneous); normal swap residency with no
      current swapping must not colour anything as an event; a window with no work samples at all
      says so rather than drawing an empty list.

### Stage 5 — gates, browser, land (mine)

- [x] **The cross-family code review**, at `264c9a8d`, scoped `0d3398e1^..15ab391f` so the merge did
      not put three other sessions' work in front of it. It **refused the branch**: five established
      P1s (F9–F13) and a P3 (F14), all fixed inside the stage and landed at `c30e9ce2`. The
      dispositions are below, under "The code review".
- [x] `npm run typecheck` — exit 0 across all four projects at every stage.
- [ ] `npm test` in full, via `scripts/tmux-job.ts`.
- [x] Merged `origin/dev` twice — `264c9a8d` (one conflict, both branches having appended to
      `wire.ts`) and `112fb9b7` (three, including `HealthPanel.tsx`'s two return branches becoming
      one on `dev` at `8eb04544`). See "The two merges" below.
- [ ] Browser-check the trends at a small size, per `browser-control.md`. **Sonnet subagents are
      429ing on this account until 2026-09-12**, so this runs on the default model.
- [ ] Push to `dev`; debrief. **A dashboard restart is needed** for any of this to be live; the
      Overseer is batching it with `admission-visibility`'s.

### The two merges

Recorded because a merge here is a proposal before it is an edit, and because the second one changed
a decision rather than only resolving text.

**`264c9a8d`** — one conflict in `tools/fleet/wire.ts`, both branches having appended a new section
to the end of the file: mine `WORK HISTORY`, `admission-visibility`'s `ADMISSION FORECAST`. No shared
symbol, no shared line but the decorative banner git aligned on. Both kept in sequence, nothing
rewritten. Approved by the Overseer before pushing.

**`112fb9b7`** — three conflicts, and the third was structural. `dev` at `8eb04544` merged
`HealthPanel.tsx`'s two return branches into one, because its own review found that with
`health: null` the panel returned **before reaching the admission mount**, so that section was absent
exactly when it was wanted. My `CurrentWork` had the same shape of exposure and had avoided it the
crude way, by being mounted in both branches. The resolution takes `dev`'s single-branch structure
and mounts it **once, outside the health conditional**, beside the forecast — which is better than
what either side had, and for a reason worth keeping: *what the fleet is running is not a fact about
whether the box's health could be collected.*

Two smaller things went with it. `nowMs={now}` is kept over `dev`'s `Date.now()`, because this panel
now holds the page's one ticking clock for the work reading's age and two clocks on one card is how
an age freezes while the chart beside it keeps moving. And `tests/fleet-admission-panel.test.tsx`,
which arrived from `dev`, needed `currentWork` stated in its `FleetState` fixture — **found by
`npm run typecheck` and not by any test**, since a missing required field is invisible to vitest.

**The duplicate check after each merge** was `grep -oE '^export (type|const|interface|function)
[A-Za-z0-9_]+' tools/fleet/wire.ts | sort | uniq -d` (empty) and a component-mount count over
`HealthPanel.tsx` (`CurrentWork`, `AdmissionSection`, `HealthHistory`, `Verdict`, `StatTile`,
`BoxActionsCard` all exactly one). A merge of two branches that both appended to one list can keep
both copies silently, and only the marked hunks are ever commented — so the grep is the check, not
the absence of conflict markers. Note that a naive `grep -c '======='` over `wire.ts` returns 16
false hits, because the file's banner comments are made of `=` characters.

## The plan review, and what was done with it

GPT Sol reviewed commit `0d3398e1` read-only on 2026-09-10 and **refused the plan**: seven P1s, no
P0. The full text is
[260910a-resource-history-plan-review-sol.md](260910a-resource-history-plan-review-sol.md); the
prompt is [260910a-resource-history-plan-review-prompt.md](260910a-resource-history-plan-review-prompt.md).
Nothing below is a paraphrase of a finding I did not act on.

| ID | Finding | Disposition |
|----|---------|-------------|
| F1 | An optional `work` on the `reading` arm collapses four different situations into one stored shape — legacy, not-due, due-but-health-failed, due-but-oversized. | **Taken in full.** The `StoredWorkTurn` envelope, on every sample arm, with `not-due` written explicitly. |
| F2 | Collapsing `not-yet-run` and `probe-failed` into one `unavailable` discards the *event's* clock, so one stale failure read three times looks like three attempts. | **Taken in full**, including the half I would not have thought of: three samples carrying one `scannedAt` are one observation too. |
| F3 | The peak line joins three clocks and calls them "that moment" — and `collectHealth` runs six commands sequentially under one `collectedAt`, so even load and attribution are not simultaneous. | **Taken in full**, wording adopted. |
| F4 | The size arithmetic was materially low (173 bytes a group, not 70), and — the real hole — capping the *number* of groups caps no bytes, so `MAX_LINE_BYTES` becomes the effective bound at ~18 MiB/day, rotating an 8 MiB file in under eleven hours and breaking the coverage invariant. | **Taken in full.** `MAX_STORED_WORK_BYTES`, enforced on the encoded value, and the arithmetic replaced by a test. |
| F5 | There is no data path for "current expensive work": not the history (five minutes stale), not the live `overseer` feed (capped at eight rows). | **Taken in full**, including the wording. |
| F6 | Exporting `parsePaneWork` alone would leave the outer invariants — clock ordering, duplicate keys, pane start against scan, `ranForMs` consistency — unchecked or re-derived. | **Already closed before the review landed**: the plan had moved to reusing `resolveWork`, the whole validated projection, which is Sol's own (b). Verify Stage 2's output actually does that. |
| F7 | A group mixing a job with known timing and a job without has no honest min/max. | **Gap taken, repair refused.** Sol nulls both aggregates unless every job is known; that erases five good readings because of a sixth. A three-armed `timing` union keeps them and makes the dishonest rendering a compile error instead. |
| F8 | "Attribution … nothing has ever drawn it" is literally false — `HealthPanel`'s raw disclosure renders it. | **Already corrected** before the review landed, in the same pass that narrowed the disk claim. |

**The floor, restated.** Sol judged my proposed guarantee too strong, and it was: *"every"* failed
while a due-but-unrecordable turn was indistinguishable from a not-due one, and *"at these sampled
instants"* failed while an event's own clock was being discarded. With F1–F4 closed, the accurate
statement — and the one the code must be checkable against — is:

> Every **displayed measurement, and every exact count derived from a reading**, is either something
> somebody measured or a stated absence naming why no reading exists. A work record says its listed
> groups were observed at **its own `scannedAt`**, and never that they were running at the health
> reading's instant or throughout the interval between samples. Repeated copies of one source
> timestamp are one observation.

**Sol also independently confirmed three claims this plan rests on** — that `classifyPaneWork` stops
descending at a recognised job, that `projectRegister` caps at eight, and that the thresholds were
genuinely duplicated at `0d3398e1` with no shared runtime source — and added one caution for Stage 1
worth repeating: **the equality semantics are not uniform.** Load and memory are strict comparisons;
swap, disk and IO wait are inclusive. The extracted policy preserves that, and
`tests/fleet-resource-policy.test.ts` asserts each direction separately for exactly this reason.

**One caveat about that run:** the sandbox refused `spawnSync` for `ps`/`echo`/`true`/`false`, so
eight live-probe tests in `tests/overseer-work.test.ts` failed on `EPERM` rather than on behaviour.
Its 54 pure tests, including the classifier controls, passed. That is a property of the review
sandbox, not a result about the tree.

## The code review, and what was done with it

GPT Sol reviewed the built branch at `264c9a8d` and **refused it**: five established P1s, no P0, all
fixed inside the stage and landed at `c30e9ce2`. The full text is
[260910a-code-review-sol.md](260910a-code-review-sol.md).

| ID | Finding | Disposition |
|----|---------|-------------|
| F9 | `groupsDropped` survived storage and projection and was then never **rendered**, so a capped list read as an exhaustive one. | **Taken.** I insisted on this property at the storage layer and did not check it at the drawing layer. |
| F10 | **`sample-omitted` records bypassed rotation.** The file ceiling was enforced in the ordinary-sample branch while the omission path went through the shared `writeLine`, which had no size check — so repeated oversized reports could grow `health.jsonl` without bound. Reproduced at **8,388,721 bytes** against an 8,388,608-byte cap. | **Taken.** Both bounds now sit at the single write boundary. **This bug predates the branch**; stage 3 only brought it into view by touching the call site. |
| F11 | The page claimed an exact five-minute cadence when startup sampling and process-local state make it approximate. | **Taken** — my plan wrote that sentence. |
| F12 | An oversized health reading **discarded a work reading that still fitted**: the code degraded `workTurn` before establishing which half of the composite overflowed. | **Taken.** The omission record is serialised with the original work first and degraded only if still too long. My stage-3 brief specified the wrong order. |
| F13 | Disk goes amber and red **at** 90 and 97, and the chart's prose said "past 90". | **Taken.** Boundary semantics are carried in `SeriesSpec` rather than one generic word applied to every metric. |
| F14 | Three source claims contradicted the code: my own policy header said every non-memory boundary was inclusive when **load is strictly greater**; `HealthHistory` still described four plots; and the seeding script called an unwritten interval "nothing was running". | **Taken.** The seed now calls it a gap and says the record cannot tell a box that was down from collection that was down from work that was running — which is the store header's own rule, and I had contradicted it in a file I wrote. |

It also confirmed the two things closed by argument rather than measurement. **F4:** the 4 KiB budget
does measure exact UTF-8 bytes, with the envelope covered separately by the line limit, and the
rotation test builds 1,440 real `sampleLine` records. **F7:** the three-arm timing union is the
better design — *"known among 5 of 6 jobs preserves measured evidence, where nulling both aggregates
would erase valid measurements without making the result more truthful."* That is the review
overruling its own earlier recommendation, which is the strongest form of agreement available.

**F10 verified by mutation rather than by reading**, because a fix I did not write is unreviewed code:
removing the two rotation lines from `writeLine` reds the new test at exactly 8,388,721 **and** reds
three pre-existing rotation tests — the second half being the proof that `writeLine` is now genuinely
the one boundary rather than a second copy of one.

**The floor moved again.** "No reading exists" was too strong: F12 discarded a reading that did
exist, and F9 dropped groups without saying so. The accurate statement now:

> Every displayed scalar and exact count comes from a **retained** reading. When a reading is missing
> or was discarded, the display states that fact or leaves a gap. A successful work scan says its
> retained groups were observed at its own `scannedAt`, and if lower-ranked groups were dropped it
> says how many. It makes no claim about the health sample's instant or the interval between
> samples. Repeated carriers of one source timestamp count as one observation.

Scoped to live-produced history: seeded data is a demo fixture, not measurement evidence.

## Things found while planning that the brief did not know

- **A pool-account session was mute for the first hour, and then was not.** This session runs on the
  `mindstone` Claude config directory and the Overseer runs on Greg's. For the first hour
  `ListAgents` showed three peers and the Overseer was not among them, so
  `SendMessage({to: "Overseer"})` failed with *no agent named 'Overseer' is reachable*. The
  documented fallback did not work either: `POST /api/steer/message` is **refused by the auto-mode
  classifier** from this session. So there was no channel back at all.

  It fixed itself at about 02:50: `ListAgents` went from three peers to thirteen, including the
  Overseer. The cause is `caf42a29` on `dev` — *"Share sessions/ too, so a pool session is listed and
  can message its peers"* — and **the interesting part is that it reached an already-running session**
  rather than needing a restart. Two things worth keeping: any pool session dispatched before that
  commit stays mute unless it re-checks `ListAgents`, and the steer route is not a usable fallback
  from a session under the auto-mode classifier, so "SendMessage fails" is a hard stop rather than a
  degraded path.
- **Both "undrawn" claims needed narrowing after checking them.** `disk` *is* drawn — as a tile, by
  `readHealthStats` — it is only the 24-hour *chart* that has no disk line, which is what the roadmap
  asks for. And `attribution` is not invisible either: `HealthPanel`'s generic disclosure renders
  whatever arrives, so it is already on the page as a raw nested object, just not as anything a
  person would read. So Stage 4 adds a series and a rendering, not a reading; neither is a discovery
  that something was being thrown away.
- **The no-double-counting guarantee is real and is one line.** `classifyPaneWork` in
  `tools/overseer/work.ts` ends its walk at a recognised job — `// Stop here: everything below a
  recognised job belongs to that job.` — so a wrapper and its leaf cannot both be reported. The
  grouping in Stage 2 relies on this and does not re-derive it.
- **`projectRegister` really does cap.** `.slice(0, MAX_HISTORY)` after filtering out idle sessions
  with no work, so a history built from the register's `sessions` would silently omit both the tail
  and every quiet pane. The uncapped `Map` inside `resolveWork` is the right source, and this is why.
