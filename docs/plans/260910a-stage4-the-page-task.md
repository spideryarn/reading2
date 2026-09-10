# Stage 4 task: draw the work beside the load, and say what the drawing does not know

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/resource-history` (a linked git worktree),
branch `worktree-resource-history`. TypeScript + ESM, React 18, Tailwind v4 with a `tw:` prefix,
tested with vitest + testing-library (`npx vitest run tests/<file>.test.tsx`).

**Read first, in this order:**

1. `docs/plans/260910a-resource-history-what-was-running-when-load-rose.md` — the plan. § "What is
   drawn" and § "Attribution uncertainty, in the page's own words" are this stage's spec, and the
   five sentences in the second are **requirements, not suggestions**.
2. `tools/fleet/web/src/HealthHistory.tsx` — the whole file, header included. Another session
   reworked its layout at `73e90e0f`; **extend it, do not restructure it.** Your change to this file
   should be one import and one element inside `HistoryBody`, after the series and the verdict strip.
3. `tools/fleet/web/src/history-series.ts` — `SERIES`, `SeriesSpec`, `plotHistory`, `HistoryPlot`.
   Read `SeriesSpec.max`'s comment before adding a series; the axis is fixed, never fitted, and the
   reason is a real day when a fitted axis painted the whole chart red.
4. `tools/fleet/web/src/health-view.ts` and `tools/fleet/resource-policy.ts` — where the cutoffs come
   from. **Never restate a threshold in a component.**
5. `tools/fleet/health-history.ts` and `tools/fleet/work-groups.ts` — the stored shapes, as they
   actually are on disk after Stages 2, 2b and 3, which may differ in detail from the plan.
6. `tools/fleet/web/src/HealthPanel.tsx`, `App.tsx`, `types.ts`, and `tools/fleet/state.ts` — for the
   `currentWork` thread.

## What to build

### 1. Disk, as the fifth series

One entry in `SERIES`. The reading is `disk.usePercent` (a whole-number percent from `df -k`), the
axis is 0–100, and the bands are `THRESHOLDS.diskUsed`. It has no `mark`.

Note what it is **not**: `health-view.ts` already draws a disk *tile*, so this is a second rendering
of a reading that is already collected and already on the page — the chart line is what was missing.
Do not change the tile.

### 2. `web/src/work-series.ts` — the pure projection

A leaf that turns the window's samples into rows, with no React in it, so it can be tested without a
DOM. It is the counterpart to `history-series.ts` and should read like it.

**The rule that lives here and nowhere else, because nothing downstream can enforce it:**

> An event is keyed by its **source discriminant and its source timestamp**. Repeated copies of one
> `scannedAt`, or one `attemptedAt`, are **one observation, never several**.

That matters because a daemon that has stopped producing fresh scans leaves the same reading on every
sample the retention writes, and a row that counted those as separate sightings would turn one
observation into an hour of apparent activity. Put it in the file's header with that reasoning, and
implement it — deduplication by source key, not by carrier sample.

What it produces, per job group seen anywhere in the window:

- the session and the recogniser's label;
- the distinct observations, each at its own source timestamp, so the strip marks where the group was
  actually *seen* rather than where a sample happened to be written;
- the longest measured run, from the group's `timing` union — and a `partial` or `unknown` arm must
  survive into the row rather than being flattened into a number;
- a rank: **most observed time first**. Say in a comment that this ranks by *observed duration*, not
  by cost, because the box does not measure per-job CPU or memory at all.

### 3. `WorkHistory.tsx` — the rows, on the existing x scale

Mounted from `HistoryBody`. It shares `HistoryPlot`'s window and geometry rather than computing its
own, so a row's marks line up with the load line above them. Follow `SeriesChart`'s approach to the
SVG: fixed `viewBox` units with `preserveAspectRatio="none"`, `vector-effect="non-scaling-stroke"` on
every stroke, and **no text inside the SVG** — labels are HTML beside it.

Four states, kept apart, in the register the rest of this card uses:

- **no work records in the window at all** — say so, and say whether that is because work retention is
  newer than the window rather than because nothing ran;
- **records that are all unavailable** — the daemon's own reasons, grouped, not one line per sample;
- **records with groups** — the rows;
- **a scan that found nothing running** — a real answer, and it must not read like the first case.

Carry the five sentences from the plan's § "Attribution uncertainty". Three of them are conditional
(`panes.cannotTell > 0`; consecutive records sharing one `scannedAt`; a `partial` timing arm) and must
appear only when true — a permanent disclaimer is one nobody reads.

### 4. The peak line

The worst load sample in the window, and **the wording is the whole finding here**, so use it:

> The peak line names the **load sample's** timestamp. Beside it, the nearest work scan is shown as
> *"observed at X — Δ before/after the load reading"*, never as having been observed *on* the peak. If
> no work scan falls within the nearby-window, it says that no nearby work reading exists rather than
> reaching further. Attribution is labelled *"collected in the same health survey turn"*, not *"at
> that moment"*.

Why, so you can carry the reasoning rather than the sentence: `collectHealth` runs `uptime`, `free`,
`swapon`, `df`, `vmstat` and `ps` **sequentially**, each with a five-second timeout, and stamps one
`collectedAt` at the end. So load and attribution are related survey readings, not one instant — and
the work scan is a third clock. Pick the nearby-window yourself, justify it in a comment, and make it
a named constant.

`attribution` (memory by process kind, `{kind, procs, rssKiB}`) is in every stored sample and has
never had a rendering of its own — only the generic raw disclosure. This is that rendering: the
biggest few groups at the peak, in the sample's own units.

### 5. `currentWork` — a live field, never derived from the history

**Authorised explicitly by the Overseer, 2026-09-10.** "Current expensive work" cannot come from the
history: that is a five-minute cadence, so "current" would be up to five minutes stale and would need
a history scan per browser. It also cannot come from the live `overseer` feed, whose register is
capped at eight rows by `projectRegister`.

> Project `currentWork` from the same single checkpoint read `readCheckpointFeeds` already does,
> carry it as a field on `FleetState`, parse it at the client boundary, and pass it to `HealthPanel`.
> **The five-minute cadence governs persistence only, never what the page shows as now.**

That threads `tools/fleet/state.ts`, `tools/fleet/wire.ts`, `tools/fleet/web/src/types.ts` and
`App.tsx`. **Small, additive, and re-read each file immediately before editing it** — another session
(`admission-visibility`) is editing `wire.ts` and `HealthPanel.tsx` at the same time.

On `HealthPanel`, below the tiles: what is running now, how long each has been running **as measured**
(the frozen `ranForMs`, plus how old the reading is — never `now - startedAt`), and how many panes had
no usable reading. `LONG_RUN_MS` in `resource-policy.ts` is what marks the long tail; do not invent a
second threshold.

## The tests to write, and to see red first

`tests/fleet-work-series.test.ts` for the projection and `tests/fleet-work-history.test.tsx` for the
component; extend `tests/fleet-web.test.tsx` for the panel and the client-boundary parse. Each red
first, for the right reason — `docs/reusable/silent-success.md`.

1. **Stale vitals**: a work record whose `scannedAt` is much older than the sample carrying it renders
   as *"observed at X — N minutes before this point"*, never as simultaneous.
2. **One observation, not three**: three consecutive samples carrying one `scannedAt` produce **one**
   sighting, and the row says the reading did not change.
3. **Normal swap residency with no current swapping** colours nothing as an event — swap 70% full and
   `activelySwapping: false` is an ordinary state, and the `mark` is about movement.
4. **Expired history**: a group whose only records fall outside the window does not appear; and a
   window shorter than 24 hours says how much was actually observed rather than implying a day.
5. **A scan that found nothing** renders as *nothing recognised was running*, distinguishably from
   *no work records in this window*.
6. **A `partial` timing arm** renders with its "N of M jobs' timing was unavailable" sentence and does
   not print the aggregate as though it covered every job.
7. **`panes.cannotTell > 0`** produces the uncertainty sentence; zero produces none.
8. **The disk series** draws its bands at `THRESHOLDS.diskUsed` and clips rather than rescaling above
   its ceiling.
9. **`currentWork` reaches `HealthPanel`** through the real composition — `App` with a payload, not a
   hand-built prop — because a test that passed the prop directly would stay green with the thread
   unwired. `tests/fleet-health-wiring.test.ts`'s header is about exactly this failure.
10. **`currentWork` is not the history**: a payload with live work and an empty history still shows
    current work, and vice versa.

## Constraints

- **Do not change anything under `tools/overseer/`**; do not restart or kill anything (the dashboard
  on 8787 and the daemon are live); **do not commit**.
- **Do not touch** `tools/fleet/refresh.ts`, `routes-actions.ts`, `routes-new.ts`, `scripts/`, or any
  readiness file.
- **Never pass `--formatter-enabled=true` to biome**; the formatter is off deliberately in this repo.
- Two Tailwind utilities setting the same CSS property is a bug a screenshot cannot see — do not rely
  on class-string order to decide a winner.
- The page must be readable on a phone; that is what it is for. Rows wrap, columns are given up.
- `npm run check` and `npm test` take ~25 minutes here — **do not run them.** Run the focused suites.
- Match the house style: explanatory headers that say *why*, discriminated unions, an explicit "could
  not tell" arm rather than a null that reads as a zero, no silent fallbacks, and colour never the
  only carrier of meaning.

## When you are done

List every file you changed, the tests you wrote, the command that runs them and its summary lines,
and say which of the ten tests you watched fail first. Name anything you could not do without editing
a file outside the set above.
