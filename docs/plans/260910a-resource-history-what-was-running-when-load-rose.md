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

`HealthSample`'s `reading` arm gains **one optional field**, `work`:

```ts
export type StoredWorkGroup = {
  session: string;           // the Overseer's session key — a session, never a command line
  recogniser: string;        // "codex-exec", "vitest", … the Overseer's vocabulary, kept as a string
  jobs: number;              // job processes with that recogniser under that pane, at that instant
  oldestStartedAt: string | null;   // null when the kernel could not say
  longestRanForMs: number | null;   // as at `scannedAt`, NOT as at now
};

export type StoredWork =
  | { kind: "unavailable"; why: string }
  | { kind: "scan"; scannedAt: string; groups: StoredWorkGroup[]; groupsDropped: number;
      panes: { work: number; none: number; cannotTell: number } };
```

Four things this shape is doing on purpose:

- **`scannedAt` is separate from the sample's `at`.** The daemon's scan and the dashboard's health
  turn are different reads, seconds to minutes apart, and a renderer that used one clock for both
  would be claiming a simultaneity nobody measured. It is the same rule `PaneJob.ranForMs` already
  follows: *frozen at the read, not extrapolated to now*.
- **`groupsDropped` exists so a truncated list never reads as a complete one.** A cap with no
  counter is the shape of `a-truncated-grep-becomes-an-exhaustive-list`.
- **`panes` is the uncertainty, stated as numbers.** "Three groups running" beside "eleven panes we
  could not read" is a different sentence from "three groups running" alone, and the second is the
  one this whole area exists not to print.
- **`unavailable` carries the daemon's own `why`.** Never an empty `groups: []`, which would draw as
  *nothing was running* — the exact collapse `health.ts`'s header is about.

### The cadence, and its arithmetic

```ts
export const WORK_EVERY_MS = 5 * 60_000;
```

The roadmap says *"store changes/events at a deliberate cadence"* and the brief's recorded product
default is five minutes. The arithmetic that makes this safe, written down because
`MAX_FILE_BYTES`'s comment is the reason this file rotates correctly:

- a group line is about 70 bytes; the cap is 30 groups, so a work-carrying sample adds ≤ ~2.2 KB;
- at one work sample per five minutes that is 288/day ≈ 620 KB/day, on top of the measured
  ~1 MB/day, so the live file still rotates at 8 MiB after about five days — comfortably more than
  the one-day window the invariant requires;
- `MAX_LINE_BYTES` (64 KiB) is untouched and a work-carrying sample is nowhere near it.

**Absent `work` on a sample is not a gap.** It means *this was not a work turn*, and the browser
knows the expected spacing because `WORK_EVERY_MS` is imported rather than restated. A work turn
that produced `unavailable` is a different fact and is written down as one.

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
- **The peak line**: the worst load sample in the window, named with its clock time, the groups
  observed on it, and — from `attribution`, which every sample has already carried since 2026-09-08
  and which nothing has ever drawn — the memory breakdown by process kind at that moment. This is
  the acceptance sentence, rendered.
- **Current expensive work** on the Box Health panel: what is running now, how long it has been
  running as measured, and how many panes had no usable reading.

### Attribution uncertainty, in the page's own words

Three sentences the UI must carry, because each of them is a claim the data cannot support and a
reader would otherwise assume:

1. *Ranked by how long each job was observed running, not by how much CPU or memory it used — the
   box does not measure per-job cost.*
2. *Sampled every five minutes: a job that started and finished between two samples is not here at
   all.*
3. *N panes could not be read at this sample* — whenever `panes.cannotTell` is non-zero.

## Stages

Each stage ends with `npm test`-scoped suites plus `npm run typecheck`, and a GPT Sol review
(`--sandbox workspace-write`, fixing inside the stage) before its commit.

### Stage 1 — one policy module for the cutoffs (mine, small)

**Status 2026-09-10: built, green, not yet committed** — waiting on the plan review, which asks
directly whether this extraction can change behaviour rather than relocate it. Done myself because
it is an import and five comparisons; the tests and the mutation check are the substance.
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

- [ ] New `tools/fleet/work-groups.ts` with `projectStoredWork`, plus `export` on
      `parsePaneWork`.
- [ ] Types in `wire.ts` (types only, appended).
- [ ] Tests: one job with several descendants → one group; two jobs same recogniser under one pane →
      one group with `jobs: 2`; a `probe-failed` checkpoint → `unavailable` with the daemon's `why`;
      a checkpoint written before work scans existed → `unavailable`, not an empty scan; a
      `cannot-tell` pane counted in `panes.cannotTell` and absent from `groups`; the cap dropping
      groups and saying how many.

### Stage 3 — writing it down (Codex, gpt-5.6-sol)

- [ ] `health-history.ts`: `work` on the sample, parsed back, bounded, with the cadence constant and
      its arithmetic.
- [ ] `health-wiring.ts`: the `readWork` dep and the due check.
- [ ] Tests: a work turn and a non-work turn; a sample from an older build with no `work` field
      parses (this is a version boundary, and `StoredReport`'s comment is the precedent); an
      oversized work summary is dropped without dropping the health reading; expired history — a
      work group whose only samples have rotated out of the window.

### Stage 4 — the page (Codex, gpt-5.6-sol)

- [ ] Disk as the fifth series.
- [ ] `web/src/work-series.ts` (pure projection, testable without a DOM) and `WorkHistory.tsx`.
- [ ] The peak line, including the memory attribution that has been stored and undrawn since
      2026-09-08.
- [ ] Current expensive work on `HealthPanel.tsx`.
- [ ] Tests: stale vitals (a scan much older than the sample carrying it must render as *the reading
      is N minutes older than this point*, never as simultaneous); normal swap residency with no
      current swapping must not colour anything as an event; a window with no work samples at all
      says so rather than drawing an empty list.

### Stage 5 — gates, browser, land (mine)

- [ ] `npm test` and `npm run typecheck` in full, via `scripts/tmux-job.ts`.
- [ ] Browser-check the trends at a small size, in a subagent, per `browser-control.md`. **Sonnet
      subagents are 429ing on this account until 2026-09-12**, so this runs on the default model.
- [ ] Final Sol review over the whole diff; merge `origin/dev`; push to `dev`; debrief.

## Things found while planning that the brief did not know

- **`ListAgents` cannot see the Overseer from a pool account.** This session runs on the `mindstone`
  Claude config directory; the Overseer runs on Greg's. `ListAgents` lists three peers and the
  Overseer is not among them, so `SendMessage({to: "Overseer"})` fails with *no agent named
  'Overseer' is reachable* — the agent bus appears not to cross config directories. The documented
  fallback, `POST /api/steer/message` at the dashboard, is **refused by the auto-mode classifier**
  from this session. So a pool-account session currently has no working channel back to the
  Overseer, which affects every session it dispatches this way, not just this one. Recorded here and
  raised in the debrief.
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
