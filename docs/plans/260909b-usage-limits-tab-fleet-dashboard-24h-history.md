# Usage limits: a fourth fleet-dashboard tab, with the last 24 hours

**Status as of 2026-09-09 05:30 UTC: BUILT and on `dev`, all six stages.** Evidence: the tab is in
`MODES`; `~/.overseer/usage.jsonl` has been filling since the daemon was relaunched at 03:51 UTC
(one record per 5-minute pass, 3,777 bytes each, verified against the live file); and
`GET /api/usage/history` was run against that store and returned four samples with the recorder not
overdue.

**GPT Sol's code review (`260909b-usage-limits-code-review-sol-r1.md`) found 13 P0s, twelve of which
are fixed in `f7b40f88`** — the thirteenth (the double merge) was already closed in `2022c12e` before
the review landed. One residue is recorded rather than hidden: H12's daemon-lock predicate is now
re-asked on every append, but the production predicate is still `() => true`, so the check is
structural until the daemon exposes real lock ownership.

**Two things are outstanding and neither is code**: the browser check of the *chart* (the tab itself
was browser-checked at Stage 1), and two `overseer-direction.md` edits that need Greg, prepared as a
before/after in [260909b-seam-table-edit-for-greg.md](260909b-seam-table-edit-for-greg.md).

Two GPT Sol rounds, 26 findings, eleven P0, **nothing overruled**. Discovery is closed. The dead ends
and both rulings tables are in
[260909a-usage-history-the-dead-ends](../research/260909a-usage-history-the-dead-ends-and-how-the-plan-was-wrong-twice.md) —
this doc is the specification, and deliberately does not retell how it was reached.

## Goal

A fourth tab in the fleet dashboard — **Usage limits** — beside Sessions, Box health and Overseer.

1. **Where are we right now?** The current reading, shown exactly as the usage card on the Overseer
   tab shows it: the same component, the same projection, the same UTC/London/Athens times.
2. **What happened over the last 24 hours?** How utilisation moved per window, plus every rate-limit
   incident in the period, drawn the way `HealthHistory.tsx` draws load.

Greg, 2026-09-08 (verbatim):

> Do we have an agent working on a tab showing "Usage limits" (alongside Sessions, Box health, etc)
> - if not, please let's new-claude one (and ask it to start with Sonnet research on previous
> conversations, docs, research, scripts, etc). Ideally also show them over time for the last 24h,
> and in future we'll want to support multiple accounts on the same box, but perhaps not today..

**There is no history today.** `~/.overseer/current.json` holds only the latest `StoredUsage`,
overwritten in place; `events.jsonl` has no usage arm. The cache is a point-in-time hint that gets
overwritten, so **history cannot be reconstructed after the fact** — the store is not an
optimisation, it is the only way to have the data at all. Most of this plan is that store.

## Context: what is knowable

Source: `docs/project/overseer-direction.md` §§ "What is actually observable about usage limits" /
"Can we call an API instead?". Every rule was paid for by somebody.

- `~/.claude.json` → `.cachedUsageUtilization` is **a cache, and a hint** — observed 48 minutes stale
  describing a window that had reset 27 minutes earlier. `resets_at` is the validity check;
  **expired means unknown, never a percentage** (`tools/overseer/usage.ts`, `parseUsageWindow`).
- A **transcript 429 is ground truth** — exact, greppable, cannot go stale.
- **There is no `claude usage` subcommand**, and no pre-warning anywhere. Everything is post-hoc.
- **Do not propose calling an API.** The Admin API and the documented rate-limit headers measure
  Console API-key spend — a different billing system from a Max subscription. Greg offered an admin
  key on 2026-09-08; the research that day concluded it would not help. **Do not ask again.**
- **One collector.** `collectUsage` on the daemon's 300 s timer is the only thing that scans
  (30–45 s over ~1,770 transcripts / ~2.9 GB). This plan adds **no second caller**.
- **The scan window is 8 days; the display window is 24 hours.** Do not conflate them: an unexpired
  `seven_day` 429 can sit in a transcript older than a day.

### Multiple accounts

Greg, 2026-09-08:

> Right now, I have a couple of Claude Max subscriptions, and I run /login every couple of days to
> switch when I hit limits. In future I expect to have more. But let's say that multiple Claude Max
> subscriptions is MEDIUM-TERM, i.e. out of scope for the next day or two.

**Record, do not build.** See the appendix for what a second account needs, and for the one product
decision this forces today.

## Decisions

**D1 — One projection, never two.** The tab's "now" half mounts the *same* `UsageCard` component
(`tools/fleet/web/src/UsagePanel.tsx`) fed by the *same* `projectUsage`, second-mounted rather than
copied. If the tab and the Overseer card can disagree, that is a bug.

**D2 — The persisted record is purpose-built, not the UI's projection.** Not the raw checkpoint
(measured: the `usage` blob is 61,122 bytes, 96% of it `rateLimits`; 140 hits collapse to 9 clusters,
a 14× reduction — and raw would copy `transcriptPath` and API error prose into a long-lived file
nothing prunes, which is a privacy cost, not just a size one). But **not the card's type either**: a
UI type is not a durable format. The record is specified below and versioned independently.

**D3 — The daemon writes it, through a callback composed in `scripts/overseer.ts`.**
`DaemonOptions.usage` gains `onPass?`; `daemon.ts` imports nothing from `tools/fleet/`. The coupling
lives in the composition root. File: `~/.overseer/usage.jsonl`, so
`overseer-direction.md`'s *"the daemon is the only writer of any of them"* stays true.

**D4 — Hook the pass, never the tick.** `checkpointUpdate()` re-spreads the same `usage` object every
30 s. A writer hooked to the checkpoint *write* would emit ~2,880 lines/day for ~288 readings and
blur the collector failures the series exists to show. There is no dedupe key: the daemon knows.

**D5 — A publication decision is not an observation.** `chooseUsage` keeping a complete 10:00 report
over an incomplete 10:05 one says nothing about the 10:05 *cache* reading, which is independent of
the transcript scan. So each pass records its cache observation, its scan result, and its publication
decision **as three separate facts**. A fresh 80% is a point on the chart even when that pass's scan
was inconclusive and its report was not published.

**D6 — Two series, drawn differently, because they carry different claims.**
Utilisation comes from the cache's attributed arm and **is** per-account. Rejections carry **no
account id at all** — a transcript 429 has none, and the 8-day scan may span a `/login` swap (live
proof: 27 unexpired `seven_day` rejections on this box with verdict `unknown`). Rejections are drawn
as observed window clusters, labelled as unattributed, and **never split by account**.

**D7 — Three absences, kept apart.**
1. *Within a window*: value / expired / unknown — the producer's arm.
2. *Within a scan*: was this scan's failure to find a 429 believable? — `absenceGapReason`'s
   question, and the only one it can answer.
3. *Between records*: nothing was recorded — derived **only** from source instants and the recorded
   cadence. `absenceGapReason` cannot know why the next record never arrived.
Absence is never a zero, and a `nimbus_quill`-style unknown window is a named row, never dropped and
never plotted from its unvalidated `utilizationPercent: 0`.

**D8 — Validity is adjudicated at the collection instant and never re-adjudicated.** The live card
re-derives expiry against the viewer's clock, correctly. A historical point must not: a 70% reading
valid at 10:00 and resetting at 12:00 would vanish when the chart is opened at 18:00, which on a
five-hour window erases most of the day. **Not "write time" — collection time**: a 40-second scan can
start at 11:59:50 and append at 12:00:30, and append-time adjudication would expire a valid
observation. Store the producer's arm as adjudicated at `collectedAt`, alongside the raw ingredients,
and label the points *as observed*. A historical point still visible after its reset is **correct** —
it is an observation at 11:59:50, not a claim that the window is still current.

**D9 — No second writer election.** The Overseer's existing daemon lock already guarantees one
writer. An independent `writer.lock` could elect a different winner: process A takes the history
lock, B takes the daemon lock, A exits, and B runs with a permanently read-only history handle until
someone restarts it. The write handle is opened **only after `runOverseer` has acquired the main
lock**; the dashboard uses a separate read-only opener that takes no lock and can never claim one.

**D10 — Nothing here makes a paid request, enforces anything, defers a launch, or exports anything
from `~/.claude.json` beyond the utilisation fields already read.**

### Simpler options passed over

- **Rescan the transcripts on demand, no store.** The 30–45 s scan on every page load, a second
  `collectUsage` caller, and it *still* cannot produce utilisation-over-time.
- **A database table.** The dashboard has no database dependency; the read is bounded and
  append-only; `~/.fleet-health/health.jsonl` already works.
- **A charting library.** `HealthHistory.tsx` hand-rolls inline `<svg>`. A dependency for one chart,
  in the tool you reach for when everything else is broken, is a poor trade.
- **Skip the tab; put a chart on the Overseer card.** Greg asked for a tab, and the card must stay
  glanceable. Noted honestly: if the tab turns out thin, saying so beats padding it.

## The record

One JSON object per line in `~/.overseer/usage.jsonl`. **Typed on the write side, loose on the read
side** — the health precedent, which types its writer and only loosens bytes coming back from disk.

```ts
type UsageHistoryLine = {
  lineSchema: 1;        // the envelope
  summarySchema: 1;     // the payload, versioned INDEPENDENTLY of the checkpoint
  recordedAt: string;   // ISO — when this line was appended
  nextDueMs: number;    // expected ms to the next pass; finite and > 0, on EVERY arm
  pass: UsagePass;
};

type UsagePass =
  | {
      kind: "pass";
      collectedAt: string;              // the reading's own clock
      account: AccountObservation;      // uuid or an explicit unknown
      cache: CacheObservation;          // D5: independent of the scan
      scan: ScanObservation;            // D5: may be inconclusive
      publication: { decision: "take-fresh" | "keep-stored"; why: string };
    }
  | { kind: "collector-failed"; at: string; why: string };  // the throw arm has NO collectedAt
```

- **`checkpointSchema` is deliberately absent.** The record is built from an in-memory `UsageReport`;
  any checkpoint envelope constructed in `scripts/overseer.ts` is synthetic, so it would be fake
  provenance. `summarySchema` is the real one.
- **`nextDueMs` on every arm, failures included.** Without it a reader assuming 300 s marks every
  interval of an injected or changed cadence as a recorder failure — and adding it later is a
  persisted-format change.
- **Each window carries the producer's arm as adjudicated at `collectedAt`** (D8), plus the raw
  ingredients (`utilizationPercent`, `resetsAt`, `resetsAtMs`, `fetchedAt`). No second `valid`
  boolean, and expiry is never re-run at append time.
- **Every persisted string and list is bounded**, and an over-long record becomes a positional
  omission marker rather than being dropped.

### The historical incident, and its merge contract

Narrower than the UI's `UsageIncident` — the chart does not need every conversation UUID repeated
every five minutes:

```ts
type HistoryIncident = {
  id: string;                    // `${window}@${resetsAt}` — derived, stable across passes
  window: string;
  resetsAt: string;
  firstHitAt: string | null;     // real hit instants, not scan time
  lastHitAt: string | null;
  rejections: number;
  unidentifiedRejections: number;
  conversations: number;         // a COUNT, not the uuid list
};
```

**A stable id is not a merge contract.** The same incident is *richer* on later passes — the
committed test in the card's own suite constructs exactly that: one rejection on the first pass, two
rejections and another conversation on the second, same id. Keeping the first occurrence permanently
under-reports; keeping the last lets an incomplete scan replace richer evidence with poorer. So, for
one id across the window:

- `firstHitAt` — the **earliest non-null** ever observed; `lastHitAt` — the **latest**.
- `rejections` — the **largest count seen in a conclusive scan**. Counts from disjoint incomplete
  scans cannot be unioned exactly without raw hit ids, which we do not store. **This is only
  acceptable because the UI says what the number means**: "most seen in one complete scan", never
  "rejections in these 24 hours".
- `window` and `resetsAt` must agree across occurrences; if they do not, the incident is
  **unreadable** and says so.
- An incident with `firstHitAt: null` is **listed but unplaced** — never dropped, never pinned to
  scan time. One beginning before the window reads as *began before this window*, never clipped to
  the left edge as though it started there.

### Reading a record this build does not understand

An unknown `summarySchema` must **survive positionally** as an unsupported sample or a bounded hole,
break every affected series, and be counted explicitly. It must not merely disappear: if twelve
schema-2 samples are silently skipped by a rolled-back schema-1 reader, the chart connects the point
before them to the point after and claims continuous observation across an hour it could not read.

## Stages

Frontloaded properly: if the job stops after Stage 1, Greg has the tab.

**Standing constraint — the usage hold.** The Overseer suspended full suites at ~00:05 UTC on
2026-09-09 (`five_hour` at 40%, Greg asleep). **Focused suites only**; no `npm test`, no
`npm run check` until cleared. `npm run typecheck` is unaffected and is the gate that catches a
dropped `Record<Mode, …>` entry. The irony is worth stating: this plan cannot verify itself tonight
for exactly the reason it exists — rationing against a single reading shows the level but not the
slope.

### Stage 0 — plan and review ✅

- ✅ Sonnet research over transcripts, docs and code
- ✅ GPT Sol round 1 — *reframed*; 13 findings, six P0, none overruled
- ✅ GPT Sol round 2 — *reframed again*; 13 findings, five P0, none overruled
- ✅ Forensics split into the research note (G13, which two live contradictions justified)
- ✅ Discovery closed. Any further finding is settled or escalated, not re-reviewed.

### Stage 1 — the tab, current reading only

**Status: ✅ done and on `dev` at `970ef508`** (stage commit `f5092ae1`). 386 fleet-web tests green;
all three registration points mutation-checked. **One item deferred, not skipped: the browser
check** — see the bottom of this stage.

No store. The first thing anybody can see, and a safe stopping point by Sol's own assessment.

- [ ] Merge `origin/dev`; confirm the usage card has landed (it was at `d2e37fe4` on
      `origin/worktree-260908f-usage-visibility` — cite `dev` once it is there, since that branch is
      a safety copy its author will delete)
- [ ] Extend `tests/fleet-web.test.tsx`:
  - [ ] **`expect(MODES).toContain("usage")` — and this is the only assertion that matters.**
        `Mode` is *derived from* `MODES`, so a merge that drops a whole mode **and** its three map
        entries typechecks perfectly clean and the tab is simply gone. Typecheck catches a
        *half*-added mode, not a *removed* one. Four sessions were adding tabs on 2026-09-09 and I
        told two of them typecheck had them covered; it does not. Corrected rule:
        `docs/project/fleet-dashboard-modes.md` at `396aeeab`.
  - [ ] the mode is labelled and mounts the panel
  - [ ] **`UsageCard` survives being mounted twice off one feed** — no module-level state, no id
        collisions. Test it; do not assume it.
- [ ] `mode.ts` — `"usage"` into `MODES` and `MODE_LABELS`
- [ ] `Dock.tsx` — `MODE_ICONS.usage` and `MODE_TIPS.usage`
  - **The tip never opens on a phone**: `Dock.tsx` passes `mouseOnly`, so a tap switches the tab and
    the card never appears, surviving only as `aria-describedby`. The label and icon must stand
    alone. Pick an icon that reads as a *limit*, not a chart, so it is not confused with Box health.
  - Register is the artefact, not the gesture. Do not touch `MODE_TIPS.overseer`.
- [ ] `App.tsx` — one additive `{mode === "usage" ? … : null}` block
- [ ] Mount `UsageCard` unchanged (D1). The Overseer tab keeps its card; this is a second mount.
- ✅ **Browser check — done 2026-09-09 ~03:55, once the Overseer lifted the usage hold.** Deferred
      for about ninety minutes and then run as the first thing, per its ruling. Playwright against
      system Chrome, its own server on 8791, killed by its own pid; 8787 untouched.
  - The tab opens from the dock and from `#usage`; keyboard-reachable by both Enter and Space.
  - **It matches the Overseer tab's card verbatim** — `main.innerText` captured on both and
    compared line by line. The only differences are the live "reading taken Xm Ys ago" clocks, which
    is what two reads moments apart should differ by. That is D1 demonstrated rather than asserted.
  - **All three unknown windows render as named rows with their `why`**, never dropped and never as
    `0%` — `nimbus_quill`, `spend`, and `member_dashboard_available` ("window entry was not an
    object: false").
  - 📔 **What the live box actually showed**, which no fixture would have: verdict `UNKNOWN`,
    `five_hour` **expired with no number printed** (the reading rules working — an expired window is
    unknown, never a percentage), `seven_day` at 58%, and *"137 rate-limit rejections found, none of
    them confirmed in force for this account (110 already reset, 27 unattributable)"*. The 27
    unattributable are the `/login`-swap case this plan's D6 is written around, sitting in the live
    data.
  - At 390×844 the dock keeps the full "Usage limits" label and nothing overflows horizontally.
  - No visual defects. The hourglass reads as distinct from Box health's gauge at dock size.
- ✅ Focused suites (386 fleet-web), `npm run typecheck`, committed, merged, pushed
- 📔 Also corrected `Dock.tsx`'s header, which claimed a new mode needs no change there. True of the
      bar's layout and fit, false of the two `Record<Mode, …>` maps immediately below it — and this
      stage is the counter-example.

### Stage 2 — the codec

**A codec, not a type.** A TypeScript type is erased at runtime and cannot round-trip bytes or reject
a malformed record; a "type and tests only" stage would either write compile-time fixtures that
prove nothing about disk, or smuggle in a parser while claiming to contain no behaviour. Given how
expensive a wrong V1 is to migrate, this earns its own stage.

**Status: ✅ done, `ca286ac2`.** Built out of order because Stage 1 is blocked on the usage card
reaching `dev` and this depends on nothing. `tools/fleet/usage-history-record.ts` +
`tests/fleet-usage-history-record.test.ts`; 19 tests, typecheck and biome clean, nothing wired to
anything so the tree is unchanged for everyone else.

- ✅ Tests first, red: every arm round-trips; a record missing its arm-specific source instant is
      rejected at encode time; an unknown `summarySchema` decodes to an unsupported marker that
      keeps its position (G7); `nextDueMs` validated finite and positive on every arm; `why` prose
      truncated visibly; an over-ceiling line throws so the store can write an omission marker
- ✅ Tests for the merge contract: earliest/latest instants, max-from-a-conclusive-scan count,
      disagreeing invariants → unreadable, null `firstHitAt` → listed but unplaced, no
      account identity anywhere on a merged incident
- ✅ The typed encoder and the loose decoder, in a leaf importing nothing
- ✅ `npm run typecheck` (exit 0), `npx biome check` clean
- ✅ **Mutation testing, which found a real hole** — 📔 eight mutations, seven caught, one survived:
      every merge test happened to put the **conclusive scan first**, and every rule gets that
      ordering right by accident. Reversed, `Math.max` keeps the stale count from the incomplete
      scan while `fromConclusiveScan` still flips true — so the UI would label a number from an
      incomplete scan as "most seen in one complete scan". Exactly the
      case-you-would-have-picked-by-hand trap; only a mutation found it. Test added, all eight now
      caught.
- 📔 `biome` flagged `mergeIncidents` at cognitive complexity 36. Extracting `mergeCounts` fixed it
      and reads better: the rule is **not "the larger number wins"** — counts are not comparable
      across scans of different completeness, because a scan that stopped early saw *fewer*
      rejections rather than a corrected number.

### Stage 3 — the store

**Status: ✅ done and on `dev` at `977279f8`** (stage commit `3138327e`). `tools/fleet/usage-history.ts`
+ `tests/fleet-usage-history.test.ts`; 39 tests across the two usage-history suites, typecheck exit
0, no lint errors. Wired to nothing — Stage 4 is the daemon hook and the route.

📔 **What this stage cost that the plan did not predict:**

- **Mutation testing found a second real hole.** Ten mutations, nine caught; swapping the read order
  to `[live, prev]` passed everything, because the rotation test counted samples and never looked at
  their order. A renderer walking that array draws the newer half first and the older after it — a
  sawtooth, from a store that recorded the truth perfectly. *"Oldest first" is in the type's own doc
  comment and nothing checked it.* That is now two stages running where the mutation found something
  no amount of re-reading would have.
- **Two of my own tests had gone green against something that could not fail.** The unreadable-store
  test pointed at an empty directory, so the injected error was never called; and a span assertion
  was off by one, replaced with the thing it actually meant (`read.files === 2`).
- **`read` hit cognitive complexity 44**, split into `decodeAll`. The extracted function is where the
  "place the damage, don't just count it" rule now lives, which is a better home for it than a branch
  inside a reader.
- The **`omitted` arm was added to the record here**, not in Stage 2 — a record too large to write
  needs somewhere to stand, and that was not obvious until the store existed.

- ✅ Tests first, red:
  - [ ] one line per pass; the three arms; a `collector-failed` line keyed on the daemon's `at`
  - [ ] **a `keep-stored` pass still contributes its cache observation** (D5) while its scan reads
        inconclusive — the failure this design exists to avoid
  - [ ] **rotation holds ≥24 h at the maximum legal record size and the minimum pass interval.** Not
        a tautological `MAX_FILE_BYTES >= 288 * MAX_LINE_BYTES`: append maximum-sized valid lines
        through **more than two rotations** and query immediately before and after each. Keep the
        64 KiB line ceiling, narrow the incident payload, and raise the file cap to **32 MiB** —
        disk is cheap here and making today's measured 6.8 KB the legal ceiling is not.
  - [ ] an oversized record produces a positional omission marker, not a silent drop
  - [ ] a corrupt/partial trailing line is counted, not thrown; a partial write **poisons** so the
        next line is not welded onto corrupt bytes
  - [ ] a read retries if `prev` changes underneath it during rotation
  - [ ] directory `0700`, file `0600` — the record carries account identity
  - [ ] **no lock is taken by the read-only opener, ever** (D9), and the write handle refuses to open
        before the main daemon lock is held
  - [ ] `OVERSEER_STORE_DIR` redirects the whole store, so no test touches the real `~/.overseer/`
- [ ] Write `tools/fleet/usage-history.ts` — reuse `../overseer/jsonl.js`; **do not** copy health's
      independent writer-lock election (D9). Keep poisoning, repair, rotation safety, modes, retry.
- [ ] Green, then **mutate the finished code and check the suite notices**
- [ ] `npm run typecheck`, lint, commit

### Stage 4 — the writer hook and the read route

**Status: 4a ✅ (`8fbbd686`) — `onPass` is in `daemon.ts`, importing nothing from `tools/fleet/`, with
`safeOnPass` containment. Seven tests, five mutations all caught. 4b (the composition in
`scripts/overseer.ts`) and 4c (the read route) are still to do.**

📔 The mutation that mattered here: *the hook fires on every tick as well as every pass*. It was
caught — which is what makes the "does not fire on a tick" test meaningful. Before the hook existed
that test passed **vacuously**, because nothing could fire; a test that has only ever been green
against an absent feature proves nothing about the present one.

- ✅ Tests first — the **join test**, which must fail if `onPass` is never called:
  - ✅ fires once per pass, right arm for each outcome
  - [ ] **does not fire on a tick** — drive several `checkpointUpdate()`s with no pass, assert zero
        calls (D4's trap, relocated; this is the test that catches it coming back)
  - [ ] **a throwing callback cannot become a false collector failure** (this is a P0): a throw
        inside `.then()` would otherwise be caught by the collector's `.catch()`, rewrite the live
        checkpoint to `{kind:"none"}` though collection succeeded, throw again on the retry, and
        surface as an unhandled rejection that **terminates the daemon**. Wrap in `safeOnPass`:
        callback errors update retention state and log, and never enter the collector's `.catch()`,
        change the usage result, or prevent the next pass. Test a throwing callback on **all three**
        outcomes and prove the next pass still fires.
- [ ] `tools/overseer/daemon.ts`: `onPass?` on `DaemonOptions.usage`, called at the three sites round
      the usage timer. ~5 lines, no new imports. **Re-read first** — `260908f-roadmap-exec-identity`
      has changed the `diff()` call site and its import list, so line numbers have moved. They have
      agreed I make this edit once they land, and will ping.
- [ ] `scripts/overseer.ts`: compose opener + projection + append beside the existing
      `usage: { run: … }`. The only place the coupling lives. `projectUsage` takes a parsed checkpoint
      and is Node-only via `attention.ts`, so wrap an envelope here or call `groupUsageIncidents`
      plus the smaller pieces — write down which and why.
- [ ] **Recorder health crosses a process boundary, so it is derived, not carried.** Health exposes
      `status()` because its writer and route share a process; ours do not, so `failure`,
      `poisoned` and `lastAttemptAt` live in the daemon's memory where the route cannot see them.
      Taking the weakest honest option: the route reports **"the recorder is overdue"** computed from
      the records themselves — the last `recordedAt` plus its `nextDueMs` against now. A richer
      status sidecar is named here as the later option, not built. An unexplained right-edge hole is
      silent data loss, and this is what prevents it.
- [ ] **Pin the whole route envelope now**, so Stage 5 never reaches back: `schema`, `fromMs`,
      `toMs`, `samples`, `predecessor`, `earliestAt`, `rotated`, `holes`, `unsupportedLines`,
      `unreadableLines`, `recorderOverdue`, `refreshMs`. Stage 5 needs `fromMs`/`toMs` for a
      server-clock axis — computing the window from the browser clock misplaces history under skew.
- [ ] Route tests: `hours` clamped `[24, 168]` and junk falls back; an empty store returns the
      "nothing recorded" arm and **claims no "since" it cannot know** (an empty file has no first
      line; process start moves the claim on every restart) — use health's wording, *"Nothing
      recorded in the last 24 hours; this fills in as the recorder runs"*; once non-empty,
      "collecting since" and "retained data begins" differ after a rotation; unreadable store returns
      `{kind:"unreadable", why}`; the read takes no lock and works mid-append
- [ ] `tools/fleet/routes-usage-history.ts`, mounted in `server.ts` — one additive line, announced
- [ ] **Add the `~/.overseer/usage.jsonl` row to the seam table in this stage, not Stage 6** — once
      the writer is live, deferring it leaves the architecture documentation false. That file's
      wording is a rule, so it goes to Greg as a before/after via the Overseer.
- [ ] Focused suites, `npm run typecheck`, commit

**Sequencing.** The write side needs another session's file; the read side does not. If `daemon.ts`
is not free, build the read side first against a fixture store — the format is frozen in Stage 2.

### Stage 5 — the last 24 hours

- [ ] Tests first, where the honesty rules live or die:
  - [ ] a historical point is **not** re-expired against the viewing clock (D8), and a point still
        visible after its reset is correct and labelled *as observed*
  - [ ] the three absences stay apart (D7); a recorder gap is derived from `nextDueMs`, never from
        `absenceGapReason`
  - [ ] an `unattributed` cache arm (no windows at all) breaks the line; it never becomes 0
  - [ ] an unsupported-schema record breaks the series and is counted — the chart never connects
        across it (G7)
  - [ ] **non-increasing source or append times are detected** — an NTP step backwards moves
        `collectedAt` and `recordedAt` together, so neither alone catches it. Preserve file order,
        break the affected series, report a clock regression; never sort it into plausibility.
  - [ ] an incident appears **once**, merged by the Stage 2 contract, spanning its real instants
  - [ ] rejections carry no `accountUuid` and are not split by account; utilisation is grouped by
        account, and **only positively attributed non-null uuids form a series** — nulls never merge
        into one apparent account
  - [ ] an unrecognised window is a named row in the unknown state
- [ ] `usage-history-client.ts` (parse + poll, validating the envelope) and `usage-history-series.ts`
      (pure absence classification)
- [ ] `UsageHistory.tsx` — hand-rolled inline `<svg>`, labels in HTML beside it. Times via
      `zonedReadings` from `zones.ts`; never format an instant by hand.
- [ ] Browser check in a Sonnet subagent, **including the empty-history state**, which is what this
      box actually shows on the first run
- [ ] Focused suites, `npm run typecheck`, commit

### Stage 6 — docs

**Status: ✅ done.** `docs/project/usage-history.md` written and signposted; the two
`overseer-direction.md` edits prepared as a before/after for Greg in
`260909b-seam-table-edit-for-greg.md` rather than landed, because that file's wording is a rule.

- [ ] Propose to Greg, via the Overseer, a sentence in `overseer-direction.md` saying what the
      `tools/fleet` ↔ `tools/overseer` rule actually is. Use
      `260908f-roadmap-exec-identity`'s wording, which is better than mine and is already the test
      comment's:
      > `tools/fleet/` may import a module from `tools/overseer/` only if that module cannot reach
      > `tools/overseer/store.ts` — directly or transitively — and closes no cycle; the allowlist in
      > `tests/fleet-attention.test.ts` is the enforcement, and its length is a consequence of that
      > rule rather than a limit of its own.
  - Say **the rule is about the store, not the count** — that is the half two sessions inferred
    oppositely on 2026-09-09, reading a short allowlist as a quota.
  - Say it **is enforced**, by an equality assertion over a transitive closure. Both of us argued
    about a rule that had a test behind it the whole time, which is worth one clause of warning to
    the next reader.
  - And carry the general lesson, which is not about this seam: *name the scope you actually searched
    inside the sentence that reports the result.* "Nothing in `tools/overseer/` imports X" is a claim
    a reader can size; "the seam is one-way" is one they cannot.
  - If the doc's wording ends up differing from the test comment, `260908f-roadmap-exec-identity`
    will make the comment cite the doc rather than restate it — one home per fact.
- [ ] A line for the tab under the entry point that owns the dashboard docs (signposting needs no
      approval). **Cite by symbol, never `path:NNN`** in `docs/project/`. Link to
      `docs/project/fleet-dashboard-modes.md` rather than duplicating it.
- [ ] Write the appendix below into whichever `docs/project/` doc owns usage
- [ ] `npm run check` — **only once the Overseer clears the usage hold**

## Appendix: multiple accounts

**The product decision this forces today, which needs Greg** (a stored field outlives the branch):

> **Historical accounts are labelled by UUID only.** When Greg switches from account A to B, the
> current checkpoint can describe only B, so A survives in history as `acct-eddd4c75…` and nothing
> can give it a friendlier name without a record migration or an external mapping.

The alternative is storing a display descriptor at collection time. I have **not** taken it, on
privacy grounds: the record already carries an account UUID and lives in a long-lived file, and an
email or org name is materially more identifying than an opaque id for no benefit the chart needs
today. A future picker can resolve the *current* account's uuid to a label at view time from
`~/.claude.json`, and show truncated uuids for the others. If Greg would rather have real labels in
history, that is a format change and better made before V1 ships than after.

Otherwise, what a second account needs:

1. **Nothing in the store's shape.** Every line carries `accountUuid` and the reader groups by it, so
   a second account produces a second series with no format change. That is why it is recorded now.
   (Note this is narrower than the claim made in an earlier draft: the *shape* needs nothing; the
   *labels* are the gap above.)
2. **A collector that can see both.** `collectUsage` reads one `~/.claude.json`. `CLAUDE_CONFIG_DIR`
   isolation is mechanically plausible and **untested** — it needs a spike before it is designed.
3. **An account picker**, defaulting to the one currently logged in.
4. **Nothing for rejections.** They stay unattributed however many accounts exist — D6, and more
   accounts make it more true, not less.

## References

- [The dead ends](../research/260909a-usage-history-the-dead-ends-and-how-the-plan-was-wrong-twice.md)
  — the four abandoned designs, both rulings tables, and what the reviews cost and bought.
- `260909b-usage-limits-tab-plan-review-sol-r1.md` / `-r2.md` — the reviews themselves.
- `docs/project/overseer-direction.md` — the reading rules and the `~/.overseer/` seam table.
- `docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md` — the umbrella; "Usage visibility"
  is this work's parent.
- `docs/plans/260908f-stageb-usage-limits-code-review-sol-r1.md` / `-r2.md` — the constraints the
  reading itself was built under: invalid `utilization` outside 0–100 rejected not trusted; malformed
  auth JSON is `unknown`, not `logged-out`; cache-vs-hit tolerance ~1 second; OAuth linkage adopted
  only when both org ids are present *and equal*.
- `tools/overseer/usage.ts`, `usage-carry.ts` — the reading and the carry decision.
- `tools/fleet/usage-feed.ts`, `usage-absence.ts`, `zones.ts`, `web/src/UsagePanel.tsx` — the card.
- `tools/fleet/health-history.ts`, `health-wiring.ts`, `routes-health-history.ts`,
  `web/src/HealthHistory.tsx`, `history-series.ts`, `health-history-client.ts` — the precedent, with
  the two divergences this plan makes deliberately: **no second lock** (D9) and **derived recorder
  health** rather than an in-process `status()`.

## Traps

- **Strict ISO parsing of `resets_at` rejected every real cached window** — Anthropic writes
  `2026-09-09T02:50:00.313670+00:00`. Parse permissively, emit canonically, pin with a fixture.
- **A row asserted "IN FORCE" while the verdict itself was UNKNOWN.** Row-level text must never
  out-claim the verdict; the chart's labels included.
- **Timing is not evidence on this box** — the identical scan measured 1.8 s and 9.7 s two hours
  apart from ambient load alone.
- **A NUL-byte corruption in `usage.ts` passed every test and every `grep` silently.**
- **`git diff` against a base after merging `dev` shows other agents' files as yours.** Scope every
  review diff by explicit path.
