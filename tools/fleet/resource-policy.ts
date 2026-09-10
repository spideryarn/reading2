/**
 * **THE CUTOFFS, ONCE.** What counts as strained, what counts as critical, and
 * what counts as a job worth naming — in one module that both the collector and
 * the browser import.
 *
 * ## Why this file exists, and what it is not overturning
 *
 * The numbers below lived in two places until 2026-09-10: as literals inside
 * `computeVerdict`'s `if` statements in `health.ts`, and again as `THRESHOLDS`
 * in `web/src/health-view.ts`. **That duplication was deliberate and argued
 * for**, and the argument was good:
 *
 * > Every cutoff below is `computeVerdict`'s in tools/fleet/health.ts, restated
 * > rather than imported — that file opens with `node:child_process`, so a
 * > type-only import still makes TypeScript walk a module this browser project
 * > has no node types for. […] The failure it buys is specific and worth
 * > naming: a tile coloured amber beside a badge that says `ok`, because one of
 * > the two moved.
 * >
 * > — `health-view.ts`, 2026-09-08
 *
 * Its premise is what changed, not its reasoning. **A leaf with no imports at
 * all costs the browser nothing**, which is how `zones.ts`, `attempt-clock.ts`,
 * `overseer-claim.ts` and `execution-token.ts` are already reached from
 * `web/src/`. So the cost that decision was paying is removed rather than the
 * decision reversed.
 *
 * The header also said *"tests/fleet-web.test.tsx pins each boundary. If
 * health.ts's cutoffs change, that test is what should go red."* **It would
 * not have.** That test pins the tile at the literal `0.15` and never calls
 * `computeVerdict` — the name appears in it only in comments — so moving
 * health.ts's literal left the suite green with the badge and the tile
 * disagreeing. `tests/fleet-resource-policy.test.ts` is the check that
 * actually relates them: it drives `computeVerdict` at boundaries **computed
 * from the constants below**, so the two can no longer come apart.
 *
 * ## THIS FILE MUST STAY A LEAF WITH NO IMPORTS
 *
 * Not a style preference: the moment it imports anything that reaches
 * `node:*`, the browser bundle is walking node types again and the duplication
 * comes back as the cheaper option. There is nothing here but numbers and the
 * evidence for them, and that is the whole design.
 *
 * ## AN UNAVAILABLE READING IS NOT A NUMBER, AND THERE IS NO DEFAULT HERE
 *
 * The roadmap stage this was extracted for asks for thresholds "in one policy
 * module with evidence", and adds: *unavailable memory is not zero load or
 * unlimited capacity.* So **nothing in this file is a fallback**. There is no
 * "assume 16 cores", no "treat a missing available fraction as 1.0", no
 * default headroom. Every consumer of these numbers already has an explicit
 * "I could not tell" arm to reach for instead (`health.ts`'s readings, the
 * chart's `unknown`, `PaneWork`'s `cannot-tell`), and a default here would be
 * the one place able to quietly turn one of those into good news.
 *
 * If you are about to add a `?? SOMETHING` beside one of these constants, the
 * thing you want is a stated absence in the caller, not a number here.
 */

/**
 * The box-health cutoffs.
 *
 * Each metric's note below says whether its boundary is inclusive. Most are
 * **at or above**, but load is strictly greater and `memoryAvailable` runs the
 * other way, where less is worse. Those distinctions are exactly the kind of
 * thing a shared table hides, so consumers state their comparisons out loud
 * rather than looping over this object. See `MEMORY_USED_PERCENT` for what
 * happens when somebody tries to flatten the inversion instead.
 *
 * The provenance differs per line and is recorded per line, because "the doc
 * says so" and "we picked it" are different kinds of number and only one of
 * them is worth arguing with.
 */
export const RESOURCE_POLICY = {
  /**
   * `load1 / cores`.
   *
   * The doc's wording is *"equal to the cores is busy; several times the cores
   * is oversubscribed"*, and it names no exact multiplier — `> 2` and `> 4` are
   * this project's reading of "several times". **Strictly greater than**, which
   * is how `computeVerdict` compares them: a load ratio of exactly 2.0 is not
   * strained.
   */
  loadRatio: { strained: 2, critical: 4 },
  /**
   * `availableBytes / totalBytes` — **available, not free**, and the difference
   * is the whole reason this reading is trustworthy. Linux spends idle RAM on
   * cache and hands it back on demand, so `free` near zero is normal.
   *
   * The doc says only "available near zero"; 15% and 5% are this project's own
   * cutoffs. **Strictly less than**, and the comparison is made on the
   * collector's own available fraction rather than on `100 - used`.
   */
  memoryAvailable: { strained: 0.15, critical: 0.05 },
  /**
   * `usedBytes / totalBytes`.
   *
   * > Swap is a cliff, not a slope. Some swap used is normal. ALL of it used
   * > means the next allocation fails and the OOM killer picks a victim.
   *
   * So this is a step function, not a ramp: nothing below 90% raises the level
   * on swap fill alone, and **fullness is a different fact from movement** —
   * `swapActivity.activelySwapping` is its own signal and 100% full and quiet
   * is not the same state as 60% and thrashing. **At or above**.
   */
  swapUsed: { strained: 0.9, critical: 0.98 },
  /**
   * `df` use percent on `/`, as a whole-number percent.
   *
   * Ordinary sysadmin defaults rather than anything measured about this box or
   * named by the doc — the least evidenced numbers in this file, and the ones
   * to change first if they turn out to be wrong. **At or above.**
   */
  diskUsed: { strained: 90, critical: 97 },
  /**
   * Percent of CPU time waiting on IO, from `vmstat`'s `wa`.
   *
   * **One cutoff, not two, and it is not a level on its own.** High IO wait
   * *with* active swapping is thrashing and is critical; high IO wait *without*
   * it means the box is disk-bound rather than CPU-bound, which is strained.
   * The chart therefore draws amber at this number and has no red at all — a
   * disk-bound, non-swapping sample painted red once, and the fix was to stop
   * the chart computing a verdict the collector never reached. **At or above.**
   */
  ioWait: { thrashing: 50 },
} as const;

/**
 * The same cutoffs as `memoryAvailable`, said the other way round, in percent —
 * **for drawing and for words, never for deciding a colour.**
 *
 * > always show X% used rather than 100-X% free
 * >
 * > — Greg, 2026-09-09
 *
 * The obvious way to honour that is to compare `used > 85` instead of
 * `available < 0.15`, on the grounds that they are the same statement. They are
 * not, once a double has been through a subtraction:
 *
 *     availableFraction = 0.14999999999999997
 *     0.14999999999999997 < 0.15          → true   (the collector: strained)
 *     100 - 0.14999999999999997 * 100     → 85     (exactly)
 *     85 > 85                             → false  (the tile: ok)
 *
 * An amber badge over a green tile, on one value in ten thousand billion, found
 * by GPT Sol reading a plan rather than by any test. So **the tone is decided on
 * the collector's own number in the collector's own direction**, and this exists
 * for the tooltip, the chart's bands and the label — none of which is a
 * judgement about a particular reading.
 *
 * `Math.round` because `(1 - 0.15) * 100` is 85.00000000000001, and a number
 * that goes on a page as a threshold should not carry that.
 */
export const MEMORY_USED_PERCENT = {
  strained: Math.round((1 - RESOURCE_POLICY.memoryAvailable.strained) * 100),
  critical: Math.round((1 - RESOURCE_POLICY.memoryAvailable.critical) * 100),
} as const;

/**
 * How far a load bar runs before it clips: twice the critical multiple.
 *
 * **Shared by the tile's bar and the chart's y axis**, so the two agree about
 * what "half way along" means. Twice critical puts amber at a quarter of the
 * track and red at half.
 *
 * The axis is FIXED rather than fitted to the data, and that came from looking
 * at the real page: on a day containing the 2026-09-08 spike — load 391 on 16
 * cores — a fitted ceiling of 430 put every ordinary hour at 4% of the height,
 * compressed both bands into sub-pixel slivers, and painted the entire chart
 * red. One outlier decided what every other hour looked like.
 */
export const LOAD_BAR_CEILING = RESOURCE_POLICY.loadRatio.critical * 2;

/**
 * **EVERY RECOGNISED JOB IS EXPENSIVE. THERE IS NO SECOND LIST.**
 *
 * The roadmap stage asks the page to "surface current expensive work", and the
 * obvious implementation is a set of recogniser ids to call expensive. That set
 * would be `{"codex-exec", "claude-headless", "vitest"}` — which is
 * `WorkRecogniserId` in full, i.e. every id the classifier can produce.
 *
 * A list identical to a union is not a policy, it is a second hand-written copy
 * of that union with nothing keeping the two in step — which is the twin this
 * repo has already paid for. So the rule is stated instead of listed: the
 * classifier in `tools/overseer/work.ts` recognises only long-running paid or
 * heavy work, and anything it declines is `no-child-work`. If a cheap
 * recogniser is ever added there, **that** is the moment to introduce a set
 * here, and the comment on `RECOGNISERS` should say so.
 */
export const EVERY_RECOGNISED_JOB_IS_EXPENSIVE = true;

/**
 * How long a job has to have been running before the page calls it out.
 *
 * Fifteen minutes, and the number is a judgement rather than a measurement: a
 * `codex exec` review with `--timeout-minutes 45` routinely runs for twenty to
 * forty, a `vitest` full suite on this box takes about twenty-five, and a
 * headless `claude` dispatch is usually under ten. So this sits below the
 * ordinary length of the two long jobs and above the ordinary length of the
 * short one — it marks *"this one is in the long tail"*, not *"this one is
 * stuck"*.
 *
 * **It is compared against a job's `ranForMs`, which is frozen at the instant
 * the process table was read** — never against `now - startedAt`. The two come
 * apart by however stale the reading is, and on a daemon that stopped accepting
 * inventories an hour ago the second turns eighteen observed minutes into
 * seventy-eight claimed ones. `PaneJob.ranForMs` in `wire.ts` is where that rule
 * is written down.
 */
export const LONG_RUN_MS = 15 * 60_000;
