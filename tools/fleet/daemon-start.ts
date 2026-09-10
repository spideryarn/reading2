/**
 * **Which revision did the running daemon start from?** The dashboard's own
 * reader of the answer, for `GET /api/diagnostics` (plan 260910f, Sol's F2).
 *
 * The daemon writes a `daemon-started` note to `daemon.jsonl` at every start,
 * carrying the revision it read once (`revision.ts`). The note that answers
 * for the RUNNING daemon is the last one whose `instanceId` is the one the
 * checkpoint's heartbeat names — never the last start note in the file, which
 * can be another instance's (one that started, failed to take the lock, and
 * stopped). The same rule `overseer diagnose` applies, with its own reader:
 * `tools/fleet/` may not import the Overseer's `notes.ts`.
 *
 * ## Tolerant, bounded, and never a guess
 *
 *  - Only the last {@link DAEMON_START_TAIL_BYTES} are read (`store-probe.ts`'s
 *    `readStoreTail`: allow-listed, never through a symlink), because this runs
 *    per request and the log only grows. A start older than that window is
 *    `unknown`, and says it looked only at the tail.
 *  - A torn final line (no newline yet) is not a note; the window's first line
 *    is the back half of a record and is dropped; a line that is not JSON, or
 *    not a start note of this instance, is skipped rather than costing the
 *    answer.
 *  - A note with no `revision` is `not-stamped` (it predates stamps). A
 *    `revision` that is present and malformed is an `unknown` revision on a
 *    stamped note — "not stamped" and "stamp unreadable" are different facts,
 *    the distinction `notes.ts` § `withReadableRevision` draws.
 */
import { parseStartRevision } from "./revision.js";
import { readStoreTail } from "./store-probe.js";
import type { DiagnosticsDaemonStart, OverseerStatusFeed } from "./wire.js";

/** The daemon's note log. The Overseer's `NOTES_FILE`, named here because it cannot be imported. */
export const DAEMON_NOTES_FILE = "daemon.jsonl";

/** How much of the end of the note log is read. The whole log is ~50 KB on the box (2026-09-10). */
export const DAEMON_START_TAIL_BYTES = 256 * 1024;

/** The instance the checkpoint names as running, or why it names none. */
export type CheckpointInstance = { kind: "named"; instanceId: string } | { kind: "unknown"; why: string };

export function checkpointInstance(feed: OverseerStatusFeed): CheckpointInstance {
  switch (feed.kind) {
    case "published": {
      const heartbeat = feed.status.heartbeat;
      return heartbeat.kind === "reading"
        ? { kind: "named", instanceId: heartbeat.instanceId }
        : { kind: "unknown", why: `the checkpoint's heartbeat cannot be read (${heartbeat.why}), so it names no running instance` };
    }
    case "checkpoint-absent":
      return { kind: "unknown", why: "there is no checkpoint, so no running instance is named" };
    case "checkpoint-unreadable":
      return { kind: "unknown", why: `the checkpoint cannot be read (${feed.why}), so it names no running instance` };
    case "unsupported-schema":
      return { kind: "unknown", why: `the checkpoint declares schema ${feed.saw} and this dashboard reads ${feed.known}, so it names no instance this dashboard can trust` };
    case "not-asked":
      return { kind: "unknown", why: "the checkpoint was not read" };
    default: {
      const never: never = feed;
      return { kind: "unknown", why: `the checkpoint reader returned ${JSON.stringify(never)}` };
    }
  }
}

export function readDaemonStart(root: string, instance: CheckpointInstance): DiagnosticsDaemonStart {
  if (instance.kind === "unknown") return { kind: "unknown", why: instance.why };
  const { instanceId } = instance;
  const read = readStoreTail(root, DAEMON_NOTES_FILE, DAEMON_START_TAIL_BYTES);
  if (read.kind === "absent") return { kind: "unknown", why: `there is no ${DAEMON_NOTES_FILE}, so there is no start note for the running instance ${instanceId}` };
  if (read.kind === "unreadable") return { kind: "unknown", why: `${DAEMON_NOTES_FILE} cannot be read: ${read.why}` };

  const { tail, windowed } = read;
  const end = tail.lastIndexOf(0x0a);
  const floor = windowed ? tail.indexOf(0x0a) : -1;
  const lines = end === -1 || floor >= end ? [] : tail.subarray(floor + 1, end).toString("utf8").split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const note = startNoteOf(lines[i], instanceId);
    if (note !== null) return note;
  }
  return {
    kind: "unknown",
    why: windowed
      ? `no start note for the running instance ${instanceId} in the last ${DAEMON_START_TAIL_BYTES / 1024} KB of ${DAEMON_NOTES_FILE}; it may be older than that window`
      : `no start note for the running instance ${instanceId} in ${DAEMON_NOTES_FILE}`,
  };
}

/** The line as this instance's start note, or null for anything else. */
function startNoteOf(line: string | undefined, instanceId: string): DiagnosticsDaemonStart | null {
  if (line === undefined || line.trim() === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const at = record["at"];
  if (record["kind"] !== "daemon-started" || record["instanceId"] !== instanceId || typeof at !== "string") return null;
  if (!Object.hasOwn(record, "revision")) return { kind: "not-stamped", instanceId, at };
  const revision = parseStartRevision(record["revision"]) ?? { kind: "unknown", why: "the start note's revision field could not be read", readAt: at };
  return { kind: "stamped", instanceId, at, revision };
}
