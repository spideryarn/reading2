Refuse the plan as committed. There are established P1 gaps in the work-state model, retention bound, timestamp claims, and “current work” wiring. No P0 found.

## Findings

### F1 — P1 — established: optional `work` collapses distinct states

(a) The plan says absent `work` means “not a work turn,” but also:

- puts `work` only on the successful `reading` arm;
- requires old samples without the field to remain readable;
- says an oversized work summary is “dropped without dropping the health reading.”

These all produce the same stored shape:

1. legacy sample from before work history;
2. new sample where work was not due;
3. due work turn where health collection failed;
4. due work turn whose work summary exceeded its bound.

`WORK_EVERY_MS` cannot recover the distinction before the first work sample, across restart phase changes, or at a failed due turn. This contradicts the four-state contract in [health-history.ts](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tools/fleet/health-history.ts:17).

(b) Replace the optional reading-only field with a common envelope on every sample arm:

```ts
type StoredWorkTurn =
  | { kind: "not-due" }
  | { kind: "due"; result: StoredWork };

type HealthSample = HealthSampleArm & {
  /**
   * Absent only on records written before work tracking existed.
   * Every new producer writes either `not-due` or `due`.
   */
  workTurn?: StoredWorkTurn;
};
```

Read work independently of whether `HealthTurn` is `reading` or `collector-failed`. An oversized work value must become a bounded `due`/`unavailable` result, never absent `work`. Add tests for all four sequences above.

### F2 — P1 — established: unavailable work loses its event clock, allowing one old failure to look repeatedly measured

(a) The daemon distinguishes:

- `not-yet-run.at`;
- `probe-failed.attemptedAt`;
- `scan.scannedAt`.

See [wire.ts](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tools/fleet/wire.ts:1456). The proposed `StoredWork` collapses the first two into `{ kind: "unavailable"; why }`, discarding their timestamps.

Concrete sequence: the work probe fails at 10:00, then the daemon stops producing fresh scans while its checkpoint retains that failure. Health retention reads it at 10:05, 10:10, and 10:15. The store now has three unavailable work-bearing samples but no way to say they all came from one 10:00 attempt. Using carrier timestamps invents three attempts; merging them invents continuous measurement.

Successful stale scans retain `scannedAt`, but the plan does not require duplicate `scannedAt` values to count as one observation.

(b) Preserve the source arms and clocks:

```ts
type StoredWork =
  | { kind: "not-yet-run"; asOf: string; why: string }
  | { kind: "probe-failed"; attemptedAt: string; sourceCollectedAt: string; why: string }
  | { kind: "checkpoint-unavailable"; checkedAt: string; why: string }
  | {
      kind: "scan";
      scannedAt: string;
      groups: StoredWorkGroup[];
      groupsDropped: number;
      panes: { work: number; none: number; cannotTell: number };
    };
```

Add: “The renderer keys events by their source discriminant and source timestamp. Repeated copies of one `scannedAt` or `attemptedAt` are one observation, never several.”

### F3 — P1 — established: the peak sentence joins different clocks as “that moment”

(a) The plan correctly says the work scan and health turn can be minutes apart, but later promises “the groups observed on” the worst-load sample and the attribution breakdown “at that moment.”

Neither is supported:

- Work has its independent `scannedAt`.
- Health collection runs `uptime`, `free`, `swapon`, `df`, `vmstat`, then `ps` sequentially; only one `collectedAt` is stamped at the end. On a loaded box, each command can take up to five seconds. See [health.ts](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tools/fleet/health.ts:515) and [health.ts](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tools/fleet/health.ts:552).

Thus load, attribution, work, and the carrier sample are related survey readings, not one instant.

(b) Replace the peak bullet with:

> The peak line names the load sample’s timestamp. Beside it, show the nearest work scan as “observed at X — Δ before/after the load reading”; never say the groups were observed “on” the peak. If no work scan is within the chosen nearby-window, say that no nearby work reading exists. Attribution is labelled “collected in the same health survey turn,” not “at that moment”; its command has no separate timestamp.

### F4 — P1 — established: the proposed size bound does not prove the rotation invariant

(a) The arithmetic is materially low. Serialising one representative group using the exact proposed fields is about 173 bytes, not 70; 30 groups make the work object about 5.35 KB, or roughly 1.54 MB/day rather than 620 KB/day. The ordinary conclusion still holds, but the stated proof does not.

More importantly, neither `session` nor `why` receives a byte bound. Existing parsing accepts arbitrary non-empty strings. `MAX_LINE_BYTES` therefore becomes the effective bound: just-under-64-KiB work records every five minutes produce about 18 MiB/day. An 8 MiB file then covers only about 10.7 hours immediately after rotation, violating [health-history.ts](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tools/fleet/health-history.ts:111).

A larger number of sessions alone is safe because the group count is capped; unbounded bytes within a retained group are the pathological case.

(b) Add a separate serialized work budget, enforced in bytes:

```ts
export const MAX_STORED_WORK_BYTES = 4 * 1024;
```

Drop lowest-ranked groups until the encoded work value fits, incrementing `groupsDropped`; visibly bound `why` and identifier strings. If no useful bounded projection fits, store bounded `unavailable`. Replace the arithmetic with a test proving that 288 maximum-sized work records plus the pessimistic ordinary health rate remain comfortably below `MAX_FILE_BYTES`.

### F5 — P1 — established: there is no complete data path for “current expensive work”

(a) The persistence path reads work only every five minutes. Deriving the current section from history therefore makes “current” up to five minutes stale and requires a history scan.

The existing live state does read the checkpoint afresh, but its work projection is the bounded eight-row register; `projectRegister` caps it at [overseer-status.ts](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tools/fleet/overseer-status.ts:647). The plan itself correctly says that projection cannot stand in for the whole scan. Yet its stages name no required whole-scan field through `CheckpointFeeds → FleetState → App → HealthPanel`; current `HealthPanel` receives only health, rows, actions, and the history API.

(b) Add this explicit stage work:

> Project `currentWork` from the same single checkpoint read already used by `readCheckpointFeeds`, carry it as a required `FleetState` field, parse it at the client boundary, and pass it to `HealthPanel`. It is never derived from the five-minute history or by scanning the history file. The five-minute cadence controls persistence only.

### F6 — P1 — reasoned: exporting `parsePaneWork` is safe but insufficient validation

(a) `parsePaneWork` has no bounded/ranked-context assumption, so exporting it is safe in that narrow sense. But it parses only the inner union. The existing surrounding logic separately checks:

- scan/source/checkpoint clock ordering;
- duplicate pane keys;
- pane start not after the scan;
- job depth and PID uniqueness;
- consistency of `startedAt`, `ranForMs`, and `scannedAt`.

See [overseer-status.ts](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tools/fleet/overseer-status.ts:433) and [overseer-status.ts](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tools/fleet/overseer-status.ts:526).

Following the plan literally would require a second outer parser or would accept an impossible stored duration such as a job starting after `scannedAt`.

(b) Change Stage 2 to export/reuse a whole validated work projection, or export the inner parser together with the invariant checker. Add tests for duplicate keys, scan after checkpoint, pane start after scan, and inconsistent job duration.

### F7 — P1 — reasoned: mixed-known timing within one group has no honest aggregate

(a) Two jobs can share one `(session, recogniser)` group while one has known timing and the other has `startedAt: null`. Taking the minimum/maximum of only known jobs makes `oldestStartedAt` and `longestRanForMs` look exhaustive; nulling only the unknown job is impossible after aggregation.

(b) Add:

> `oldestStartedAt` and `longestRanForMs` are non-null only when every job in the group has known timing. If any constituent timing is unavailable, both aggregates are null and the row says timing was incomplete.

Test one known plus one unknown job in the same group.

### F8 — P3 — established: “attribution … nothing has ever drawn” is literally false

`HealthPanel` renders the entire health payload through `RawValue`, including attribution, under “Everything the server sent”; see [HealthPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tools/fleet/web/src/HealthPanel.tsx:222).

Replace it with:

> Attribution has been stored and exposed only in the generic raw disclosure; it has never had a dedicated summary or chart.

## The requested floor

The proposed statement is too strong.

“Every” fails because due-but-unrecordable work currently becomes indistinguishable from not-due or legacy data. “At these sampled instants” fails because the plan discards unavailable-event timestamps and does not require repeated stale scans to be deduplicated. The peak wording additionally treats separate health, attribution, and work clocks as one moment.

The strongest accurate wording before those fixes is:

> Health values preserve the collector’s readings and explicit non-readings. A successful work record can say that its listed groups were observed at its own `scannedAt`; the health sample carrying it does not establish that they were running at the health reading’s instant or during the interval between samples. As written, the design does not yet guarantee a distinct timestamped state for every missing work turn or one displayed observation per distinct work scan.

After F1–F3 are closed, your original floor becomes defensible if “number” is narrowed to “displayed measurement or exact count derived from a reading.”

## Checks on the named claims

- `classifyPaneWork` really does stop descending at a recognised job: established at [work.ts](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tools/overseer/work.ts:745).
- `projectRegister` really does cap the displayed list at eight: established at [overseer-status.ts](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tools/fleet/overseer-status.ts:664).
- At commit `0d3398e1`, collector and browser thresholds were genuinely duplicated with no shared runtime source. Extraction can preserve behaviour, provided equality semantics remain exact: load/memory are strict, while swap/disk/IO are inclusive.
- Disk is collected and already has a current tile, but no history series. Attribution is collected and visible only in the raw disclosure.

I ran the permitted `tests/overseer-work.test.ts`: all 54 pure tests passed, including the classifier controls; eight live-probe tests failed because this sandbox rejects `spawnSync ps/echo/true/false` with `EPERM`, not because of classifier behaviour. No files were changed.