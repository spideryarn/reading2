## Verdict

Do not build this plan as written. The architecture is worth building—one dashboard collector, an event log, an atomic current-state checkpoint, and systemd are the right pieces—but the present plan cannot meet its reboot-recovery goal and can corrupt its history after ordinary restart failures.

### Findings

**F1 — P0 — Plan § Goal / store contract; [`tools/fleet/collect.ts`](/home/greg/code/spideryarn2/.claude/worktrees/overseer-o1-store/tools/fleet/collect.ts:28)**

The source does not expose the identity the store promises to preserve. `FleetRow` omits `claudeId`, `GJD_KIND`, the full `GJD_REMOTE_DIR`, and metadata version, even though the standing direction requires them in the session register.

Sequence: Overseer persists the HTTP rows → box reboots and tmux environment disappears → O4 asks which Claude conversation and directory to resume → the only durable record contains a tmux handle, display fields, repo/worktree names, and start time, but not the Claude ID or full directory. Reboot recovery is impossible.

Tmux handles are also reusable after the tmux server restarts, so keying events by `$1643` can conflate an old session with an unrelated new one.

Before O1 begins, agree a versioned source DTO with the dashboard agent containing:

- runtime-instance identity, including a boot/source generation;
- `claudeId`;
- the complete discriminated `meta` union;
- name, tmux handle, and start time.

Conversation identity and tmux runtime identity should be separate fields.

---

**F2 — P0 — Plan § O1d / per-day files, lines 96 and 199**

Replaying only today’s file cannot reconstruct the fold.

Sequence: session A is seen at 23:58 → daemon restarts at 00:01 → today’s file is empty → fold starts empty → next snapshot emits a second `session-seen` for A. A daemon down across midnight does the same. Deleting an older daily file can also delete the only event establishing a still-live session.

Use either:

- one unrotated `events.jsonl` for O1 and replay it entirely; or
- `current.json` as a real checkpoint containing the complete register, last accepted observation ID, and event cursor, then replay events after that cursor.

Daily rotation and pruning need an explicit checkpoint/continuation record first.

---

**F3 — P0 — Plan § JSONL and O1a store**

“Discard a torn final line” is not sufficient repair.

Sequence: a crash leaves `{"kind":"session-` without a newline → restart ignores that suffix → the next append writes a valid JSON object immediately after it → the valid event is now concatenated onto corrupt bytes → after another append, the malformed record is no longer merely a discardable final line, and reads either fail or lose the first post-restart event.

Before reopening for append, truncate to the last complete newline under the daemon lock. Test the full sequence: torn write → restart → append valid event → append another → read all valid events. If the checkpoint may advance past the log, append and flush the event batch before renaming the checkpoint.

---

**F4 — P0 — Plan § O1c/O1d; concurrent daemons**

`O_APPEND` protects the append position, not the fold or exactly-once semantics.

Sequence: two daemons start from the same fold → both receive the same new snapshot → both append the same transitions → both overwrite `current.json`; depending on timing, the event log contains duplicates while the checkpoint reflects whichever writer renamed last. Shared temporary filenames can additionally make one rename fail.

Acquire a store-wide exclusive lock before reading any state and hold it for the daemon’s lifetime. Refuse a second instance loudly. The common launcher should enforce the lock so systemd and worktree/manual starts follow the same rule. Put `pid` and a random daemon `instanceId` in `current.json` for diagnosis, but do not treat them as the lock.

---

**F5 — P1 — Plan § “A snapshot is only evidence…”**

The three predicates neither express completeness correctly nor validate the wire contract.

`error === null` is right. At this revision, a changed `collectedAt` also really does mean collection ran: [`collect()` stamps it only after collection](/home/greg/code/spideryarn2/.claude/worktrees/overseer-o1-store/tools/fleet/collect.ts:244), while [`statePayload()` reserializes the cached object unchanged](/home/greg/code/spideryarn2/.claude/worktrees/overseer-o1-store/tools/fleet/server.ts:99). That contract should be pinned by a test or replaced later by a producer-issued sequence number.

`rows.length > 0` is not evidence of completeness:

- A successful empty observation is valid evidence that the fleet is empty, but the Overseer would retain stale live sessions.
- A malformed or regressed response containing 35 of 36 rows is non-empty and would emit a false `session-gone`.

Remove the non-empty rule. Reject the initial server placeholder through `collectedAt === null`. Parse HTTP JSON from `unknown`, failing the whole snapshot on any malformed row, duplicate identity, invalid timestamp, or unknown schema—never filtering individual bad rows and diffing the remainder. Ideally the producer should expose an explicit schema version and completeness contract.

---

**F6 — P1 — Plan § admissibility, source transitions, and two clocks**

A repeated `collectedAt` is a normal duplicate, not degradation.

Sequence: SSE reconnects and immediately sends its cached snapshot, or polling occurs before the next 60-second refresh → timestamp equals the last accepted one → the plan emits `source-degraded` even though both processes are healthy. With SSE and polling active together, this can happen continuously.

Make observation handling a discriminated result:

```ts
accept | duplicate | reject
```

A duplicate is a no-op for fleet events. A rejected payload or a freshness deadline expiring transitions the source to degraded once. Recovery needs an explicit event as well; the current union has `source-degraded` but no way to record restoration.

The two main clocks are adequate if defined precisely:

- `writtenAt`: daemon heartbeat;
- `lastGoodSnapshotAt`: the producer’s `collectedAt` from the last accepted observation, not merely when an HTTP response arrived.

Also store current source mode/status/reason. If distinguishing “HTTP reachable but collector wedged” from “HTTP unreachable” matters, add `lastSourceContactAt`. A freshness watchdog is required because the SSE heartbeat can continue while no new snapshot arrives.

---

**F7 — P0 — Plan § O1d / `infra/hetzner/provision.sh`**

A systemd user unit is not guaranteed to start at boot without user lingering, and the repository contains no lingering setup. `Restart=always` only operates after the user manager and unit have started.

Sequence: box reboots while Greg is away → no login starts the user manager → Overseer remains down → observations are lost until the next login. The proposed `kill -9` test passes without testing this failure.

There is a second deployment hazard: if `ExecStart` points into this worktree, normal worktree removal deletes the executable path and the next restart fails.

The simpler deployment is a system service with `User=greg`, installed by provisioning and pointing at a stable deployed checkout or launcher. Otherwise explicitly enable lingering. O1d’s done condition must include:

- enabled and active checks;
- `kill -9` recovery;
- an actual reboot with no intervening login;
- verification that the executable path survives worktree removal.

---

**F8 — P2 — Plan § `SessionState.unknown` cause migration**

Adding a structural cause is the right fix, but the proposed union and consumer scope are incomplete.

[`sessionState()` has five unknown paths](/home/greg/code/spideryarn2/.claude/worktrees/overseer-o1-store/scripts/gjd-remote-tmux.ts:857), not three:

- invalid session ID;
- agents call unavailable;
- unrecognised agent status;
- live Claude omitted from the agents list;
- process probe unavailable.

[`collect.ts` also constructs its own fallback unknown](/home/greg/code/spideryarn2/.claude/worktrees/overseer-o1-store/tools/fleet/collect.ts:134). Prefer making that impossible join failure throw rather than adding another ordinary session cause. Tests constructing exact unknown objects will need migration. The browser has a separate wire union and parser that currently discards `cause`; decide explicitly whether it should preserve it.

`gjd-remote.ts` only consumes `kind` and `why`, so its display logic should continue working.

Once `cause` exists, `statusOf` can simply enrich only `cause === "agents-unavailable"`; the second `sessionState(..., emptyMap)` call is no longer needed. Comparing all unknowns as merely `kind: "unknown"` would be simpler, but would hide real changes between unknown causes, so the shared structural field is justified.

---

**F9 — P1 — Plan § local `collect()` fallback**

The fallback contradicts “one collector” under the failure where the HTTP surface is unavailable but the dashboard refresh loop is still running. The ten-minute interval lowers average work but does not prevent the two expensive collections from overlapping at the worst moment.

It also does not return the same contract: direct [`collect()` returns only `FleetSnapshot`](/home/greg/code/spideryarn2/.claude/worktrees/overseer-o1-store/tools/fleet/collect.ts:209), without dashboard `error` or `health`. Treating missing health as a change would create false history.

For O1, I would omit local collection and record a visible source gap. If the fallback remains, normalize sources through a discriminated observation type, never interpret unavailable health as a health transition, and introduce a shared collection lease before claiming there is only one collector.

---

**F10 — P2 — Plan § event equality**

“Structural equality” needs a per-arm definition, not generic deep equality.

- `waiting.secondsLeft` changes every collection, producing a `session-status` event each minute although the semantic state remains waiting.
- [`HealthReport`](/home/greg/code/spideryarn2/.claude/worktrees/overseer-o1-store/tools/fleet/health.ts:127) contains `collectedAt`, `tookMs`, and fluctuating numeric readings, so a structural `health-change` occurs virtually every tick.

Define a canonical transition key per status: `kind`, plus `shell.busy`, plus `unknown.cause`; do not include countdown/display prose. Keep volatile details in `current.json`.

For health, choose explicitly between fixed-cadence observations and verdict-level transitions. Given that O1 exists to unblock attention triage, deferring health history is the smaller coherent version.

---

**F11 — P2 — Plan § Stages**

The stopping points are not quite honest as written:

- O1a is not “pure”: `store.ts` performs filesystem I/O, and it bundles a shared `gjd-remote` API migration with new Overseer domain code.
- O1b says it records source transitions, which couples it to O1a’s event model despite the claim that the stages are disjoint.
- O1c’s manual live run does not test checkpoint ordering, duplicate delivery, or recovery.
- O1d is called “restart and reboot” but only tests `kill -9`.

I would re-slice it as:

1. `SessionState.cause` migration alone, with every consumer and test green.
2. Versioned observation/identity contract plus pure admissibility and diff logic.
3. Single-writer JSONL store, checkpoint, and crash/restart tests—including midnight and torn-tail recovery.
4. SSE/poll source and daemon, initially without health or local collection fallback.
5. Stable systemd deployment, `kill -9`, worktree-removal, and no-login reboot proof.

## Overall design calls

JSONL with events is the right first store. SQLite is not needed now. Its trigger should be broader than “a page load scans history”: indexed historical queries, transactional multi-record state, concurrent writers, or retention/compaction that becomes difficult are also legitimate triggers. Refusing concurrent writers is preferable to adopting SQLite merely to tolerate them.

`session-gone` does not currently flatten Claude exit and tmux death: Claude exiting leaves the tmux row and becomes `no-claude`; removing the tmux session removes the row. I would rename the event `tmux-session-gone` and key it by runtime generation to make that meaning explicit.

The HTTP/SSE coupling is the correct trade given collection cost. The smaller O1—SSE/poll, session transitions, durable checkpoint, singleton, and systemd—is worth building. Health history, daily rotation, and local collection fallback can wait until the core history survives restart honestly.

No files were changed.