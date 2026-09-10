/**
 * **THE LAUNCH JOURNAL: ONE WRITER, APPEND AND FSYNC, REPLAYED WHOLE OR NOT AT ALL.**
 *
 * Plan 260910f § D1. Under the store root, so `OVERSEER_STORE_DIR` moves it
 * with everything else:
 *
 *     launches/
 *       launches.jsonl    one line per boundary crossed
 *       writer.lock       lock.ts's O_CREAT|O_EXCL claim
 *       o/<occurrenceId>/ 0700
 *         material.txt    the exact prompt, pinned before `planned`
 *         a<n>/           0700, one per attempt: intent.json, start.json, exit.json
 *
 * A separate file from `events.jsonl` because the launch history has a
 * different failure rule, and because another stage is adding arms to that
 * union and to `store.ts` right now. It reuses `jsonl.ts` (torn-tail repair,
 * `writeAll`, `writeAtomically`) and `lock.ts` rather than copying them.
 *
 * ## The failure rule is the opposite of store.ts's, on purpose
 *
 * `store.ts` may start cold, because a cold register costs history. **A cold
 * launch journal would read as "nothing is in flight"**, which is a licence to
 * launch everything again. So a journal that cannot be replayed whole — an
 * interior line that does not parse, or parses and is not legal — opens in
 * `history-lost`: the fold up to the hole is kept for reading, every append is
 * refused, and the protocol's `plan()` refuses with the reason. The way out is
 * {@link LaunchStore.resetHistory}, driven by Greg's attributed request (F2).
 *
 * A torn LAST line is not a hole: it is an append that died mid-write, and it
 * is truncated on open, on disk, before anything appends after it.
 *
 * ## An append is checked before it is written
 *
 * `append` runs the same transition relation replay does, and refuses an
 * illegal event without writing a byte. Otherwise a bug in a caller would write
 * a line that turns the journal into `history-lost` on the next start — a
 * one-line mistake that disables every future launch.
 *
 * ## What it cannot do
 *
 * It cannot tell a journal that was deleted from one that never existed: an
 * absent file is an empty history. That hazard is the store root's, and
 * store.ts's header says why the root lives outside every worktree.
 */
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import { writeAll, writeAtomically, truncateToLastLine, type JsonlRepair } from "./jsonl.js";
import { journalRecords, preserveThenReplace } from "./launch-admission.js";
import { writeIntentFile } from "./launch-artefacts.js";
import {
  HIDDEN_LAUNCH_ACKNOWLEDGEMENT,
  isLaunchOccurrenceId,
  occurrenceIdOf,
  parseJournalLine,
  replayJournal,
  stepLine,
  type CarriedEntry,
  type FoldBuilder,
  type HistoryResetEvent,
  type JournalStatus,
  type LaunchEvent,
  type LaunchOccurrenceId,
  type LaunchOrigin,
  type ResettableJournal,
  type Written,
} from "./launch-protocol.js";
import { releaseLock, stillOurs, takeLock, type HeldLock, type LockRefusal } from "./lock.js";

export const LAUNCHES_DIR = "launches";
export const LAUNCH_JOURNAL = "launches.jsonl";
export const LAUNCH_LOCK = "writer.lock";
export const OCCURRENCES_DIR = "o";
export const MATERIAL_FILE = "material.txt";

export type LaunchStoreRefusal = LockRefusal | { reason: "relative-root"; path: string } | { reason: "unusable-journal"; path: string; detail: string };

export type LaunchStore = ResettableJournal & {
  /** `<root>/launches`. */
  readonly dir: string;
  /** What the open found at the end of the journal. */
  readonly repair: JsonlRepair;
  close(): void;
};

/** A directory that is ours and nobody else's: created 0700, and chmodded in case it already existed wider. */
function privateDir(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function openLaunchStore(options: { readonly root: string; readonly now: () => Date }): { ok: true; store: LaunchStore } | { ok: false; refusal: LaunchStoreRefusal } {
  if (!isAbsolute(options.root)) return { ok: false, refusal: { reason: "relative-root", path: options.root } };
  const dir = join(options.root, LAUNCHES_DIR);
  const occurrencesDir = join(dir, OCCURRENCES_DIR);
  const journalPath = join(dir, LAUNCH_JOURNAL);
  const lockPath = join(dir, LAUNCH_LOCK);
  try {
    privateDir(dir);
    privateDir(occurrencesDir);
  } catch (cause) {
    return { ok: false, refusal: { reason: "unusable-directory", detail: String(cause) } };
  }
  const taken = takeLock(lockPath, options.now);
  if (!taken.ok) return { ok: false, refusal: taken.refusal };
  const lock: HeldLock = taken.lock;

  let repair: JsonlRepair;
  let texts: string[];
  let fd: number;
  try {
    repair = truncateToLastLine(journalPath);
    texts = existsSync(journalPath) ? journalRecords(readFileSync(journalPath, "utf8")) : [];
    fd = openSync(journalPath, "a", 0o600);
  } catch (cause) {
    releaseLock(lock, lockPath);
    return { ok: false, refusal: { reason: "unusable-journal", path: journalPath, detail: String(cause) } };
  }

  let fold: FoldBuilder;
  let status: JournalStatus;
  // WHAT A LOST HISTORY CAN STILL SHOW: the last kind any parseable line said
  // for each occurrence, legal or not, and its origin and plan time from a
  // `planned` line whose id is the hash of its origin (so the line vouches for
  // itself, wherever it stands) or from an earlier reset. Only a history reset reads it.
  type Salvaged = { readonly lastSeen: LaunchEvent["kind"] | null; readonly origin: LaunchOrigin | null; readonly plannedAt: string | null };
  const salvage = new Map<LaunchOccurrenceId, Salvaged>();
  const load = (lines: readonly string[]): void => {
    const replayed = replayJournal(lines);
    fold = replayed.fold;
    status = replayed.status;
    salvage.clear();
    for (const text of lines) {
      const parsed = parseJournalLine(text);
      if (!parsed.ok) continue;
      const line = parsed.value;
      if (line.kind === "history-reset") {
        for (const entry of line.carried) salvage.set(entry.occurrenceId, { lastSeen: entry.lastSeen, origin: entry.origin, plannedAt: entry.plannedAt });
        continue;
      }
      const prior = salvage.get(line.occurrenceId);
      const plannedHere = line.kind === "planned" && (prior?.origin ?? null) === null && occurrenceIdOf(line.origin) === line.occurrenceId;
      salvage.set(line.occurrenceId, {
        lastSeen: line.kind,
        origin: plannedHere ? line.origin : (prior?.origin ?? null),
        plannedAt: plannedHere ? line.at : (prior?.plannedAt ?? null),
      });
    }
  };
  load(texts);

  const occurrenceDir = (id: LaunchOccurrenceId): string => {
    if (!isLaunchOccurrenceId(id)) throw new Error(`${JSON.stringify(id)} is not an occurrence id`);
    return join(occurrencesDir, id);
  };
  const attemptDir = (id: LaunchOccurrenceId, attempt: number): string => join(occurrenceDir(id), `a${attempt}`);

  const store: LaunchStore = {
    dir,
    repair,
    status: () => status,
    fold: () => fold,
    append(event) {
      if (status.kind === "history-lost") return { ok: false, why: `the launch journal lost its history at line ${status.atLine}: ${status.why}` };
      if (!stillOurs(lock, lockPath)) return { ok: false, why: `${lockPath} is no longer held by this writer` };
      const step = stepLine(fold, event);
      if (!step.ok) return { ok: false, why: `refused an illegal ${event.kind}: ${step.why}` };
      try {
        writeAll(fd, `${JSON.stringify(event)}\n`);
        fsyncSync(fd);
      } catch (cause) {
        return { ok: false, why: `the append failed: ${messageOf(cause)}` };
      }
      step.commit(fold);
      return { ok: true };
    },
    writeMaterial(id, bytes): Written {
      try {
        const where = occurrenceDir(id);
        privateDir(where);
        // THE BYTES CAME FROM `Buffer.from(string, "utf8")`, so they are valid
        // UTF-8 and survive the round trip `writeAtomically`'s string takes. The
        // protocol re-hashes what it reads back before launching regardless.
        writeAtomically(join(where, MATERIAL_FILE), where, bytes.toString("utf8"));
        return { ok: true };
      } catch (cause) {
        return { ok: false, why: messageOf(cause) };
      }
    },
    readMaterial(id) {
      try {
        return { ok: true, bytes: readFileSync(join(occurrenceDir(id), MATERIAL_FILE)) };
      } catch (cause) {
        return { ok: false, why: messageOf(cause) };
      }
    },
    attemptDir,
    writeIntent(id, attempt, intent): Written {
      try {
        privateDir(occurrenceDir(id));
        const where = attemptDir(id, attempt);
        privateDir(where);
        writeIntentFile(where, intent);
        return { ok: true };
      } catch (cause) {
        return { ok: false, why: messageOf(cause) };
      }
    },
    resetHistory({ request, at, ownerReservations }) {
      if (status.kind !== "history-lost") return { ok: false, why: "the launch journal's history is whole; there is nothing to resolve" };
      // EVERYTHING STILL VISIBLE IS CARRIED: every occurrence a parseable line
      // names, every reservation the owner holds, and every occurrence with a
      // directory under `o/`. The last is not a diagnostic (review F15): an
      // occurrence whose lines are behind the hole and whose slot is already
      // released is known ONLY by its directory, and left uncarried it could be
      // planned again, restart at `a1`, and have its old `exit.json` release the
      // new slot. Over-carrying costs Greg a `dispose`; under-carrying costs a
      // second session.
      let artefactIds: string[];
      try {
        artefactIds = readdirSync(occurrencesDir);
      } catch (cause) {
        return { ok: false, why: `the artefact directories could not be listed: ${messageOf(cause)}` };
      }
      const held = new Map<string, string>(ownerReservations.map((one) => [one.key, one.slot]));
      const ids = new Set<LaunchOccurrenceId>(salvage.keys());
      for (const key of [...held.keys(), ...artefactIds]) if (isLaunchOccurrenceId(key)) ids.add(key);
      const carried: CarriedEntry[] = [...ids].sort().map((occurrenceId) => {
        const slot = held.get(occurrenceId);
        const seen = salvage.get(occurrenceId);
        return {
          occurrenceId,
          lastSeen: seen?.lastSeen ?? null,
          ownerHeld: slot === undefined ? null : { slot },
          origin: seen?.origin ?? null,
          plannedAt: seen?.plannedAt ?? null,
        };
      });
      const reset: HistoryResetEvent = {
        v: 1,
        kind: "history-reset",
        at,
        actor: request.actor,
        requestId: request.requestId,
        why: request.why,
        preservedAs: `${LAUNCH_JOURNAL}.lost-${at.replace(/[^0-9]/g, "")}-${request.requestId}`,
        lostAt: { line: status.atLine, why: status.why },
        acknowledgement: HIDDEN_LAUNCH_ACKNOWLEDGEMENT,
        carried,
      };
      const text = JSON.stringify(reset);
      // THE LINE MUST REPLAY, or the fresh journal is born lost.
      const reparsed = parseJournalLine(text);
      if (!reparsed.ok) return { ok: false, why: `the reset record would not replay: ${reparsed.why}` };
      const preserved = preserveThenReplace(dir, journalPath, reset.preservedAs, `${text}\n`);
      if (!preserved.ok) return preserved;
      try {
        closeSync(fd);
        fd = openSync(journalPath, "a", 0o600);
      } catch (cause) {
        return { ok: false, why: `the fresh journal was written and could not be reopened: ${messageOf(cause)}` };
      }
      load([text]);
      return { ok: true, reset };
    },
    close() {
      try {
        closeSync(fd);
      } finally {
        releaseLock(lock, lockPath);
      }
    },
  };
  return { ok: true, store };
}
