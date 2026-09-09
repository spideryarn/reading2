Verdict: **reframed**. The current-reading tab is sound, but the proposed history writer and persisted format are not ready to build. Several choices would erase or misdate historical facts.

## Findings

1. **F1 — P0 — D8 / Stage 4: render-time expiry erases valid history.**  
   [Plan D8](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits-tab/docs/plans/260909b-usage-limits-tab-fleet-dashboard-24h-history.md:160), [usage.ts](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits-tab/tools/overseer/usage.ts:255)

   At 10:00 the cache says 70%, resetting at 12:00. `parseUsageWindow` correctly records a `value`, because it was valid at 10:00. Greg opens the 24-hour chart at 18:00. D8 tells the renderer to re-evaluate expiry against 18:00, so the valid 10:00 observation becomes expired/unknown and disappears.

   Current state and history need different clocks:

   - The current card should evaluate expiry at view time.
   - A historical point should preserve what was valid at its `collectedAt`. It must not be re-adjudicated by today’s clock.

2. **F2 — P0 — D2/D5 / stored projection: the proposed projection cannot yet place or deduplicate rejection events.**  
   [Plan D2](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits-tab/docs/plans/260909b-usage-limits-tab-fleet-dashboard-24h-history.md:99), [RateLimitHit](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits-tab/tools/fleet/wire.ts:338)

   One 429 at 09:03 remains in every five-minute scan until it expires or leaves the eight-day scan. If each projected summary carries the same cluster, Stage 4 can either:

   - draw a rejection at every sample, falsely showing repeated rejections; or
   - deduplicate by window/reset, but then place it only at “first observed by history,” not at 09:03.

   Two hits sharing the same window/reset make this worse: grouping them loses the individual event times needed by the stated goal, “every rate-limit incident in the period.” D2 therefore gives up more than IDs and paths: unless the pending projection explicitly retains them, it also gives up individual `hitAtMs`, status, conversation identity, message, and event distribution.

   Before Stage 1, define whether the product shows individual incidents or window clusters. The persisted V1 needs a stable cross-sample key plus the event timestamp(s) and count required by that decision. This is a real unpinned dependency on the in-progress `groupUsageIncidents`.

3. **F3 — P0 — D4 / Stage 1 line shape: `collectedAt` is not a key for every source arm.**  
   [Plan D4](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits-tab/docs/plans/260909b-usage-limits-tab-fleet-dashboard-24h-history.md:119), [StoredUsage](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits-tab/tools/fleet/wire.ts:509), [daemon failure arm](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits-tab/tools/overseer/daemon.ts:720)

   A thrown scan publishes `{kind:"none", at:t1}`; it has no `collectedAt`. The proposed stored union nevertheless requires `collectedAt` for `collector-failed`.

   Concrete outcomes depending on implementation:

   - Deduping `undefined` causes every later failure to collapse into the first.
   - Skipping records without `collectedAt` silently loses all thrown failures.
   - Falling back to checkpoint `writtenAt` writes the same failure every 30 seconds.

   Define a discriminator-specific source identity, for example report `collectedAt` versus failure `at`, and specify how `sample-omitted` retains that identity. Advance the dedupe watermark only after the record or omission marker is successfully written.

4. **F4 — P1 — D4 and writer choice: an unchanged `collectedAt` does not mean “no new reading was taken.”**  
   [Plan claim](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits-tab/docs/plans/260909b-usage-limits-tab-fleet-dashboard-24h-history.md:125), [chooseUsage test](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits-tab/tests/overseer-usage-carry.test.ts:112), [daemon integration test](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits-tab/tests/overseer-store-usage.test.ts:178)

   Stored report: 10:00, complete, utilisation 60%. Fresh report: 10:05, utilisation 80%, but one transcript was unreadable. `chooseUsage` deliberately keeps the 10:00 report. A new reading was taken; it was merely not published.

   The dashboard sees only the held report. It cannot record the fresh cache observation, the incomplete scan, or `chooseUsage`’s reason, which exists only in the daemon log. The history becomes a generic gap and permanently loses the 80% observation.

   This is the strongest argument to reconsider the writer. The daemon has the fresh report, the carry decision, failure reason, actual cadence, and account transition at the moment they exist.

5. **F5 — P1 — “The seam” / writer conclusion: the repository evidence does not support the stated module-seam argument.**  
   [Plan seam argument](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits-tab/docs/plans/260909b-usage-limits-tab-fleet-dashboard-24h-history.md:188), [health-history imports](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits-tab/tools/fleet/health-history.ts:78), [attention’s actual warning](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits-tab/tools/fleet/attention.ts:13)

   `tools/fleet/health-history.ts` already imports `tools/overseer/jsonl.ts` and `tools/overseer/lock.ts`. Therefore “nothing under fleet imports overseer” is factually false.

   `attention.ts` makes a narrower argument: fleet must not import the Overseer’s checkpoint parser and its transitive store graph. It does not establish that the daemon may not import a pure projection leaf.

   Nor does the health precedent support request-path writing: health writes once per collection turn through `refreshOnce`; its request path only reads.

   Extracting a typed persisted projection into a neutral leaf, then appending in the daemon immediately after the usage outcome, is consistent with the actual graph. A temporary concurrent edit to `daemon.ts` is not a durable architectural reason.

6. **F6 — P0 — Stage 2 / request-path writer: retention failure is absent from the proposed wire and UI.**  
   [Stage 2 route](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits-tab/docs/plans/260909b-usage-limits-tab-fleet-dashboard-24h-history.md:327), [health retention payload](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits-tab/tools/fleet/routes-health-history.ts:58), [refresh publish path](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits-tab/tools/fleet/refresh.ts:134)

   Make the history file unwritable or fill the disk. If append failures are caught, the existing samples remain readable and the chart grows an unexplained right-edge hole: silent data loss. If they escape from `statePayload`, an `/api/state` request fails and the background `publish()` rejection can terminate `refreshLoop`, because publishing sits outside the collection catch.

   D9 mentions `status().lockedOutBy`, but Stages 2–4 never require `retention` in the route, validate it in the client, or render it. Health does all three and tracks `lastAttemptAt`, `lastSuccessAt`, `failure`, `poisoned`, and `lockedOutBy`.

   In-process concurrent requests do not race if append remains synchronous; Node serialises them. They still block the event loop. Cross-process concurrency is the lock’s job. Dedupe makes the common path cheap only if it occurs before filesystem I/O, is seeded from the retained tail after restart, and retries after failure—none is pinned.

7. **F7 — P0 — rotation sizing: 8 MiB does not satisfy the plan’s own maximum-record contract.**  
   [Stage 1 rotation](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits-tab/docs/plans/260909b-usage-limits-tab-fleet-dashboard-24h-history.md:302), [health sizing invariant](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits-tab/tools/fleet/health-history.ts:110)

   At a five-minute cadence there are 288 readings/day. With the copied 64 KiB legal line limit, one day may occupy:

   `288 × 65,536 = 18,874,368 bytes` — 18 MiB before margin.

   With an 8 MiB live cap, rotation can occur in under eleven hours. Immediately after the next rotation, `prev` contains less than eleven hours and `live` contains one new point; more than half the requested day has been silently discarded.

   Measure the actual V1 projection, set an explicit worst-case bound, and test that one live file can hold at least 24 hours at the maximum accepted record size and cadence. Two files do not remove that invariant.

8. **F8 — P1 — D3: `checkpointSchema` is the wrong provenance for a projected payload.**  
   [Plan D3](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits-tab/docs/plans/260909b-usage-limits-tab-fleet-dashboard-24h-history.md:110), [health writer/read boundary](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits-tab/tools/fleet/health-history.ts:137)

   `projectUsage` can rename or reinterpret a summary field without changing the Overseer checkpoint schema. After such a deployment, old and new summaries can both say `checkpointSchema: 2` while having incompatible shapes. The reader cannot distinguish them, migrate them, or explain why half the day became unreadable.

   Health’s precedent is also being misread: the writer accepts a typed `HealthReport`; only bytes read back from disk become `Record<string, unknown>`. The usage writer likewise needs a concrete, versioned `UsageHistorySummaryV1`, with a separate `summarySchema`. The read side can remain loose.

9. **F9 — P1 — Stage 1: important health-history concurrency guarantees are missing from the checklist.**  
   [Proposed tests](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits-tab/docs/plans/260909b-usage-limits-tab-fleet-dashboard-24h-history.md:307), [health ownership recheck](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits-tab/tools/fleet/health-history.ts:621), [rotation-read retry](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits-tab/tools/fleet/health-history.ts:776)

   The plan tests ordinary lockout and stale-lock stealing, but not the stale-lock race where two processes both prove the old PID dead. Without `stillOurs` before every repair and append, the loser continues writing. When both later rotate, one rename can overwrite/drop a whole retained file.

   Also missing from the plan:

   - lock ownership before repair;
   - releasing the lock after post-claim open/repair failure;
   - poisoning after a partial write so the next line is not welded onto corrupt bytes;
   - retrying a read if `prev` changes during rotation;
   - directory/file modes equivalent to `0700`/`0600`, since the summary may contain account identity.

   “Mirror closely” is not enough for invariants the tests do not name.

10. **F10 — P0 — D6 / Stage 4: scan absence and recorder absence are conflated.**  
    [Plan D6](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits-tab/docs/plans/260909b-usage-limits-tab-fleet-dashboard-24h-history.md:144), [producer absenceGap](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits-tab/tools/overseer/usage.ts:552)

    `absenceGap`/the pending `absenceGapReason` can judge whether a completed transcript scan’s lack of 429s is believable. It cannot judge why the next history record never arrived.

    Sequence: a complete scan at 10:00 establishes “no 429 found”; the dashboard or daemon records nothing until 11:00. The 10:00 sample’s scan-absence predicate returns no gap, but it provides no evidence for the missing hour. Applying it to the interval can join the utilisation line across an unobserved hour or label the silence as “no incidents.”

    Preserve two independent layers:

    - within a recorded sample: value, unknown/unattributed cache, conclusive or inconclusive no-hit result;
    - between samples: generic “nothing recorded,” derived only from source timestamps and expected cadence.

    The proposed line shape also omits the cadence field that the following bullet says is stored, so Stage 4 would already have to reach back into Stage 1.

11. **F11 — P2 — D4: `collectedAt` is neither guaranteed monotonic nor guaranteed unique.**  
    [collectUsage clock](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits-tab/tools/overseer/usage.ts:1336)

    It is `new Date(Date.now()).toISOString()`. Wall clocks can step backwards, and tests or two calls can supply the same `nowMs`. After a clock correction, append order can be 10:05 followed by 10:00. A reader copied from health promises “oldest first” by file order, so its polyline can reverse and its predecessor calculation can select the wrong point. Two different reports with an equal millisecond would dedupe incorrectly.

    Use a content/source-kind fingerprint alongside the source timestamp, and define how clock regressions are surfaced. Do not silently sort them into plausibility without reporting the regression.

12. **F12 — P2 — empty-history state: “since” has no defined source.**  
    [Stage 2 empty arm](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits-tab/docs/plans/260909b-usage-limits-tab-fleet-dashboard-24h-history.md:332)

    An empty file has no first-line timestamp. If “since” means process start, restarting every hour continually moves the claim forward and hides the earlier empty interval. If it means the checkpoint report’s `collectedAt`, it may predate the history recorder by days. If it means first retained line, the empty state cannot supply it.

    Either persist store creation metadata, or use the narrower wording health uses: “Nothing recorded in the last 24 hours; this fills in as the recorder runs.” Once nonempty, distinguish “collecting since” from “retained data begins” after rotation.

13. **F13 — P2 — stage cut and multi-account appendix.**  
    [Stages 1–3](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits-tab/docs/plans/260909b-usage-limits-tab-fleet-dashboard-24h-history.md:302), [multi-account claim](/home/greg/code/spideryarn2/.claude/worktrees/usage-limits-tab/docs/plans/260909b-usage-limits-tab-fleet-dashboard-24h-history.md:401)

    The claimed frontloading is backwards: Stages 1–2 provide no visible value and are unnecessary for Stage 3. The current-only tab can be the first stage.

    “Nothing in the store” for multiple accounts is also too strong. After switching from account A to B, a future picker needs a durable label for A; the current checkpoint can describe only B. If history retains only `accountUuid`, A becomes an opaque UUID. Null UUIDs must also never be combined into one apparent account series.

    Store a stable, non-secret display descriptor or explicitly accept UUID-only labels. Only positively attributed, non-null UUIDs may form utilisation series.

## Decision audit

| Decision | Assessment |
|---|---|
| D1 | Sound for the current card, but the pending upstream contract must guarantee the component can be mounted twice from the same feed. |
| D2 | Not sound as written; use a purpose-built, event-sufficient persisted projection, not an unspecified UI projection. |
| D3 | Not sound; checkpoint schema does not version the projection, and loose typing belongs on the read side only. |
| D4 | `writtenAt` is definitely wrong, but `collectedAt` alone is incomplete and not monotonic. |
| D5 | The attribution conclusion is sound; event identity and event-time handling are missing. |
| D6 | “Never zero” is sound; sample-level uncertainty and missing-history gaps must be separate. |
| D7 | Sound. |
| D8 | Sound for current-state rendering, wrong for historical playback. |
| D9 | The read-while-locked conclusion is sound; the proposed stages omit the status and lifecycle machinery that makes it honest. |
| D10 | Sound. |

The simpler options section is mostly right: on-demand rescanning, a database, and a charting library are correctly rejected. Rejecting the whole raw checkpoint is also right. What is not established is the leap from “not raw” to “store the current UI projection”; the simpler durable choice is a small, explicitly versioned history record designed around the chart’s claims.

I would build the current-only tab first, then redesign the history around:

1. a typed persisted V1 with explicit source/event clocks;
2. daemon- or producer-loop ownership of appends;
3. separate event, sample-uncertainty, and recorder-gap semantics;
4. a measured rotation invariant and full retention-status path.

I attempted the focused existing test suite, but the execution sandbox refused creation of Vite’s `node_modules/.vite-temp`; no tests actually ran. The `chooseUsage` behavior above is nevertheless pinned directly by the committed unit and daemon-integration test sources.