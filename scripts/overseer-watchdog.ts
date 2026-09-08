#!/usr/bin/env -S npx tsx
/**
 * `overseer-watchdog` — a LOCAL check that the Overseer daemon is doing its
 * job, meant to be run by `overseer-watchdog.timer` (infra/hetzner/systemd/)
 * on a plain interval.
 *
 * Direction: docs/project/overseer-direction.md § "The seam is a file, not a
 * function" (the shape of `current.json`, and why it carries TWO clocks) and
 * § "A higher bar for robustness here than elsewhere".
 *
 * **WHAT THIS PROVES, PLAINLY, AND WHAT IT DOES NOT.** It catches two
 * different failures a daemon can be in — stopped ticking (crashed, wedged,
 * never started) and ticking but deaf (up, writing checkpoints on schedule,
 * hearing nothing from the fleet dashboard) — because it reads BOTH clocks
 * `current.json` carries rather than only `heartbeat.lastTickAt`. **It still
 * does not catch the host disappearing.** If the box loses power or the
 * kernel, this timer disappears with the thing it is watching and nobody is
 * told — that is "A27" in overseer-direction.md and it remains OPEN. This is
 * a LOCAL watchdog, not the off-box dead-man check; closing A27 needs
 * something that survives the box being gone, which nothing here is.
 *
 * **Reuses `readCheckpoint` rather than re-parsing `current.json`.** That
 * function already does the two things a checkpoint reader must: fail WHOLE
 * on a bad entry rather than quietly dropping one, and check `schema` against
 * a number this build knows (`STORE_SCHEMA`) rather than merely "is present" —
 * so an unusable checkpoint from a future schema renders as *cannot tell*,
 * never as a silently-missing field. Re-implementing that check here would be
 * exactly the second copy of a fact that `overseer-direction.md` keeps
 * warning goes stale.
 *
 * **Four failure states, kept distinct on purpose** — collapsing them is the
 * bug this whole area of the codebase is about (silent-success.md), and two
 * of the four exist for exactly the reason overseer-direction.md gives for
 * the two clocks themselves: *"`writtenAt` against `lastGoodSnapshotAt`
 * distinguishes deaf from dead ... a single number would hide the case where
 * the Overseer is alive but not listening."* `stale` and `deaf` mean OPPOSITE
 * things about the daemon process (dead vs. alive) and the SAME thing about
 * whether the fleet register can be trusted (it cannot) — which is exactly
 * why they must not be folded into one state:
 *
 *   (a) `no-checkpoint` — no `current.json` at all: the daemon has never run
 *       against this store (or `OVERSEER_STORE_DIR` now points somewhere new).
 *   (b) `stale`         — a checkpoint parses fine, but `heartbeat.lastTickAt`
 *       is older than its threshold (or still `null`, i.e. it has never
 *       ticked): the daemon ran and has stopped, or has not gotten going.
 *       Checked FIRST — a dead process's snapshot clock is trivially old too,
 *       and `stale` is the more useful thing to say about it than `deaf`.
 *   (c) `deaf`          — the heartbeat is fresh (the process is alive and
 *       ticking) but `lastGoodSnapshotAt` is older than ITS OWN threshold, or
 *       still `null` (never once heard from the dashboard). The daemon is up
 *       and writing checkpoints on schedule while its register goes stale
 *       underneath it — GPT Sol's S10, verified: `provision.sh` enables
 *       `overseer.service` and nothing enables `fleet-dashboard.service`, so a
 *       box rebuilt from that file comes up in exactly this state, ticking
 *       happily forever with nothing to report.
 *   (d) `unreadable`    — a checkpoint is present and this build cannot parse
 *       it (bad JSON, missing field, or — the one worth naming — a `schema`
 *       this build does not know). The daemon may well be alive; this cannot
 *       tell, and must never be reported as (a), (b) or (c), all of which
 *       claim to know something this state does not.
 *
 * `node:util`'s `parseArgs`, no new dependency — the convention documented at
 * the top of scripts/gjd-remote.ts.
 *
 * `console.log`/`console.error` rather than src/log.ts: this is a CLI run by
 * systemd, not a request path — docs/project/logging.md.
 *
 * **The verdict currently reaches nobody but the journal.** A non-zero exit
 * from a systemd oneshot lands in `systemctl is-failed` / `journalctl -u
 * overseer-watchdog` and nowhere a person looks day to day. Writing it into
 * the store so the dashboard can render it is the fix, and it is deliberately
 * NOT built in this pass — it would touch `tools/overseer/store.ts`, which
 * another agent in this worktree is mid-edit on. This script's job here is
 * only to get the verdict right; where it goes is a separate piece of work.
 */
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import { MEASURED_CADENCE_MS, TICK_MS, staleAfterMs } from "../tools/overseer/daemon.js";
import { STORE_SCHEMA, readCheckpoint, storeRoot, type CheckpointRead } from "../tools/overseer/store.js";

/**
 * How long `heartbeat.lastTickAt` may go without moving before the daemon
 * counts as stale, by default.
 *
 * Five ticks rather than the three `scripts/overseer.ts` uses for its
 * human-facing `stalled` status: that command is read on demand by a person
 * who can use judgement about a single missed tick, and this one fires a
 * timer unattended and turns a positive result into a non-zero systemd exit
 * (visible in `systemctl is-failed` / the journal) — so it is tuned to avoid
 * flagging one unlucky tick, not to catch one as early as possible.
 */
export const DEFAULT_MAX_TICK_AGE_MS = 5 * TICK_MS;

/**
 * How long `lastGoodSnapshotAt` may go without moving before the daemon
 * counts as deaf, by default.
 *
 * **Deliberately its own threshold, not the tick one** — a snapshot is not a
 * tick. The dashboard's collector chains from the END of each run at a
 * measured ~65s cadence (`MEASURED_CADENCE_MS`) rather than firing on a fixed
 * clock, so "five ticks" (150s) would be tuned to the wrong process entirely
 * and would fire on a single ordinary collection or two.
 *
 * **THE DAEMON'S OWN DEADLINE IS READ OUT OF THE CHECKPOINT, and this constant
 * is only the fallback.** Both sides used to call `staleAfterMs` and that was
 * not enough: sharing a function prevents FORMULA drift and does nothing about
 * INPUT drift. The daemon calls it with the snapshot's advertised `refreshMs`
 * (60s → 300,000ms) and this file called it with the historical measured
 * constant (65s → 325,000ms), so the two already disagreed under the documented
 * normal values, and a change to the collector's cadence would have moved one
 * and not the other. GPT Sol's C6.
 *
 * So `Checkpoint.snapshotStaleAfterMs` carries the number the daemon is
 * actually using, and this is what a watchdog falls back to when the checkpoint
 * predates that field or does not carry one: `max(STALE_FLOOR_MS,
 * STALE_MULTIPLE * MEASURED_CADENCE_MS)` = `max(300_000, 5 * 65_000)` =
 * 325_000ms — five collections' worth of tolerance, floored at five minutes so
 * a couple of ordinary misses on a busy box never fire it.
 */
export const DEFAULT_MAX_SNAPSHOT_AGE_MS = staleAfterMs(MEASURED_CADENCE_MS);

export type WatchdogVerdict =
  | { healthy: true; detail: string }
  | { healthy: false; state: "no-checkpoint" | "stale" | "deaf" | "unreadable"; detail: string };

/**
 * Judge a checkpoint read, already taken — kept pure and separate from
 * `main()` so a test can hand it every `CheckpointRead` arm directly, without
 * a real clock or a real file.
 */
export function assessWatchdog(
  read: CheckpointRead,
  nowMs: number,
  maxTickAgeMs: number,
  /**
   * An operator's `--max-snapshot-age-ms`, or **`null` to use the daemon's own
   * deadline** out of the checkpoint (falling back to
   * `DEFAULT_MAX_SNAPSHOT_AGE_MS` when it carries none).
   *
   * `null` is what `main()` passes, so the ordinary run takes the daemon's
   * number. An explicit value still wins, because somebody typing a flag is
   * asking a different question on purpose.
   */
  maxSnapshotAgeMs: number | null = null,
): WatchdogVerdict {
  if (read.kind === "absent") {
    return {
      healthy: false,
      state: "no-checkpoint",
      detail:
        "no current.json at all -- the Overseer daemon has never written a checkpoint to this store " +
        "(or OVERSEER_STORE_DIR points somewhere new). Start it with `systemctl start overseer`.",
    };
  }
  if (read.kind === "unusable") {
    return {
      healthy: false,
      state: "unreadable",
      detail:
        `current.json is present but this build cannot parse it (${read.why}: ${read.detail}); ` +
        `this build reads schema ${STORE_SCHEMA}. The daemon may well be running -- nothing here can tell. ` +
        "Do not treat this the same as no-checkpoint, stale or deaf, all of which claim to know something this does not.",
    };
  }
  const { checkpoint } = read;
  const { pid, lastTickAt, ticks } = checkpoint.heartbeat;
  // THE DAEMON'S NUMBER, not one derived here. An override beats it; nothing
  // else does.
  const snapshotDeadlineMs = maxSnapshotAgeMs ?? checkpoint.snapshotStaleAfterMs ?? DEFAULT_MAX_SNAPSHOT_AGE_MS;

  // Checked FIRST, before the snapshot clock: a dead process's snapshot is
  // trivially old too, and `stale` is the more useful thing to say about a
  // process that is not running than `deaf`, which claims the process IS up.
  if (lastTickAt === null) {
    return {
      healthy: false,
      state: "stale",
      detail: `heartbeat.lastTickAt is null -- pid ${pid} has started but has not completed a single tick yet`,
    };
  }
  const tickAgeMs = nowMs - Date.parse(lastTickAt);
  if (tickAgeMs > maxTickAgeMs) {
    return {
      healthy: false,
      state: "stale",
      detail:
        `last heartbeat tick was ${Math.round(tickAgeMs / 1000)}s ago, over the ${Math.round(maxTickAgeMs / 1000)}s threshold ` +
        `(a tick is normally ${Math.round(TICK_MS / 1000)}s) -- pid ${pid}, ${ticks} ticks recorded before it stopped`,
    };
  }

  // The heartbeat is fresh -- the process is up and ticking. Now ask the
  // question the heartbeat alone cannot answer: has it heard anything?
  const { lastGoodSnapshotAt } = checkpoint;
  if (lastGoodSnapshotAt === null) {
    return {
      healthy: false,
      state: "deaf",
      detail:
        `pid ${pid} is alive and ticking (${ticks} ticks) but lastGoodSnapshotAt is null -- it has never once ` +
        "heard from the fleet dashboard. Check `systemctl is-active fleet-dashboard`: provision.sh enables " +
        "overseer.service but does not enable fleet-dashboard.service, so a freshly provisioned box lands here.",
    };
  }
  const snapshotAgeMs = nowMs - Date.parse(lastGoodSnapshotAt);
  if (snapshotAgeMs > snapshotDeadlineMs) {
    return {
      healthy: false,
      state: "deaf",
      detail:
        `pid ${pid} is alive and ticking (${ticks} ticks) but the last good snapshot was ${Math.round(snapshotAgeMs / 1000)}s ago, ` +
        `over the ${Math.round(snapshotDeadlineMs / 1000)}s threshold (${checkpoint.snapshotStaleAfterMs === null ? "this watchdog's fallback: the checkpoint carries no deadline" : "the daemon's own deadline, read from the checkpoint"}) -- the daemon is up and writing checkpoints while its ` +
        "register goes stale underneath it. Check `systemctl is-active fleet-dashboard` and the dashboard's own logs.",
    };
  }

  return {
    healthy: true,
    detail:
      `pid ${pid}, last heartbeat tick ${Math.round(tickAgeMs / 1000)}s ago, last good snapshot ${Math.round(snapshotAgeMs / 1000)}s ago, ${ticks} ticks`,
  };
}

/** One line, for a person reading the journal or a terminal. */
export function formatVerdict(verdict: WatchdogVerdict): string {
  if (verdict.healthy) return `✓ overseer healthy -- ${verdict.detail}`;
  return `✗ overseer ${verdict.state} -- ${verdict.detail}`;
}

const HELP = `overseer-watchdog -- checks the Overseer daemon's heartbeat AND its snapshot clock, and exits 0 (healthy) or 1 (not)

  npx tsx scripts/overseer-watchdog.ts [--max-tick-age-ms N] [--max-snapshot-age-ms N]

  --max-tick-age-ms N       how old heartbeat.lastTickAt may be before this
                            reports stale (default ${DEFAULT_MAX_TICK_AGE_MS}, i.e. ${DEFAULT_MAX_TICK_AGE_MS / TICK_MS} ticks)
  --max-snapshot-age-ms N  how old lastGoodSnapshotAt may be before this
                            reports deaf. WITHOUT IT, the daemon's own deadline
                            is read out of the checkpoint, so the two cannot
                            drift apart; a checkpoint carrying none falls back to
                            ${DEFAULT_MAX_SNAPSHOT_AGE_MS}

The store root is $OVERSEER_STORE_DIR, or ~/.overseer -- the same override
tools/overseer/store.ts honours everywhere else, per storeRoot().
`;

function parsePositiveMs(raw: string | undefined, flagName: string): { ok: true; value: undefined } | { ok: true; value: number } | { ok: false; message: string } {
  if (raw === undefined) return { ok: true, value: undefined };
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { ok: false, message: `✗ ${flagName} must be a positive number; got ${JSON.stringify(raw)}` };
  }
  return { ok: true, value: parsed };
}

export function main(argv: readonly string[]): number {
  const { values } = parseArgs({
    args: [...argv],
    allowPositionals: false,
    options: {
      "max-tick-age-ms": { type: "string" },
      "max-snapshot-age-ms": { type: "string" },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  const tick = parsePositiveMs(values["max-tick-age-ms"], "--max-tick-age-ms");
  if (!tick.ok) {
    console.error(tick.message);
    return 2;
  }
  const snapshot = parsePositiveMs(values["max-snapshot-age-ms"], "--max-snapshot-age-ms");
  if (!snapshot.ok) {
    console.error(snapshot.message);
    return 2;
  }
  const root = storeRoot();
  const read = readCheckpoint(root);
  // `null` rather than the constant, so the DAEMON'S deadline is used unless a
  // person overrode it: two components tuning the same threshold independently
  // is the drift C6 was about.
  const verdict = assessWatchdog(read, Date.now(), tick.value ?? DEFAULT_MAX_TICK_AGE_MS, snapshot.value ?? null);
  console.log(formatVerdict(verdict));
  return verdict.healthy ? 0 : 1;
}

/** Imported by a test, or run directly. Same guard as scripts/overseer.ts. */
function isMain(): boolean {
  const invoked = process.argv[1];
  return invoked !== undefined && invoked === fileURLToPath(import.meta.url);
}

if (isMain()) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (cause) {
    console.error(`✗ ${cause instanceof Error ? cause.message : String(cause)}`);
    process.exitCode = 1;
  }
}
