/**
 * **`armedAt`: when this box's scheduler was armed, recorded once and believed
 * afterwards.**
 *
 * ## The thing this exists instead of
 *
 * Neither standing job has ever run, so both read as `never` and both would fire
 * about thirty seconds after arming — two Claude sessions at once, as the first
 * act of a mechanism nobody has watched work. The obvious fix is to write a
 * synthetic `finished` occurrence at arming time so the jobs look recently run.
 *
 * **That must not be done, and the reason is the whole value of the ledger.** A
 * person has to be able to read `events.jsonl` and believe it. A fabricated run
 * in it is worse than an early dispatch, because everything downstream — the
 * status page, a postmortem, Greg at 8am — treats an occurrence as evidence that
 * something happened.
 *
 * So the deferral is a **scheduler-control fact**, stored somewhere that is not
 * the occurrence ledger, saying exactly what it is: *this daemon was armed at
 * this instant*. `lastRunOf` still says `never`; `due` reads
 * `armedAt + initialDelayMs` and reports `never run; first eligible at …`.
 *
 * ## Why it is on disk rather than in the process
 *
 * GPT Sol's S8-6: an offset relative to process startup postpones the first run
 * again on every restart, so a service that restarts every few minutes stays
 * "armed" for ever without ever dispatching. The anchor has to survive the
 * restart, so it is a file.
 *
 * **Recorded once and kept.** A daemon that comes up armed and finds a record
 * leaves it exactly as it is — that is what makes a restart cost nothing. A
 * daemon that comes up DISARMED removes it, so that arming again later starts a
 * fresh delay rather than inheriting a stale one; "armed since March" on a box
 * that has been off since March is the kind of quietly wrong fact this whole
 * area is arranged against.
 *
 * ## Missing or unreadable fails closed, and visibly
 *
 * Every failure here — a directory that will not take a write, JSON that will not
 * parse, an instant that is not one — becomes `{kind: "unknown"}` carrying the
 * sentence. `due` holds every job on that arm and the daemon logs it. The
 * alternative, treating an unreadable record as "armed just now", would defer
 * every job for ever; treating it as "armed long ago" would dispatch everything
 * at once. Neither is a guess worth making.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Arming } from "./jobs.js";

/**
 * The file, inside the store directory.
 *
 * In the store dir rather than beside the unit, because it is a fact about a
 * particular store's scheduler and follows it: two stores on one box (a test's
 * `OVERSEER_STORE_DIR`, and the real one) must not share an arming instant.
 *
 * **It is NOT the arming switch.** `OVERSEER_JOBS_ENABLED`, out of
 * `/etc/overseer.env`, is what decides whether anything is armed at all; this
 * only records when that first became true.
 */
export const ARMING_FILE = "armed.json";

/**
 * Bring the arming record into line with whether this daemon is armed, and
 * return what the scheduler should believe.
 *
 * One function rather than a read and a write, because the invariant is a
 * relationship between two facts — *the daemon is armed* and *there is a record*
 * — and splitting it would let a caller do half of it.
 */
export function reconcileArming(input: { storeDir: string; armed: boolean; now: () => Date }): Arming {
  const path = join(input.storeDir, ARMING_FILE);
  if (!input.armed) {
    // DISARMED CLEARS IT. Not an error if it is already gone, and not fatal if
    // it cannot be removed: a disarmed daemon dispatches nothing whatever this
    // file says, so a failure here has no consequence until somebody arms, at
    // which point the stale instant is read and the delay is simply already
    // spent. Named rather than silent for that reason.
    try {
      if (existsSync(path)) unlinkSync(path);
    } catch {
      /* See above: a disarmed daemon has nothing to dispatch, so this cannot cause a run. */
    }
    return { kind: "unknown", why: "this daemon is not armed, so there is no arming instant to measure a first run from" };
  }
  const existing = readArming(input.storeDir);
  if (existing.kind === "armed") return existing;
  if (existing.kind === "unusable") return { kind: "unknown", why: existing.why };
  return writeArming(path, input.now().toISOString());
}

/** What is on disk right now, without changing it. Three arms, because *absent* and *unreadable* lead to different actions. */
export function readArming(storeDir: string): Arming | { kind: "absent" } | { kind: "unusable"; why: string } {
  const path = join(storeDir, ARMING_FILE);
  if (!existsSync(path)) return { kind: "absent" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    return { kind: "unusable", why: `${ARMING_FILE} could not be read (${cause instanceof Error ? cause.message : String(cause)}), so nothing can say when this scheduler was armed` };
  }
  if (parsed === null || typeof parsed !== "object") return { kind: "unusable", why: `${ARMING_FILE} is not an object, so nothing can say when this scheduler was armed` };
  const at = (parsed as Record<string, unknown>)["armedAt"];
  if (typeof at !== "string" || Number.isNaN(Date.parse(at))) {
    return { kind: "unusable", why: `${ARMING_FILE} has no readable armedAt instant, so nothing can say when this scheduler was armed` };
  }
  return { kind: "armed", at };
}

/**
 * Write the record, atomically.
 *
 * `mkdir` first: the daemon opens its store before it reconciles arming, but a
 * test or a CLI may not have, and a first arming that failed because a directory
 * did not exist would fail closed on something that is not a fault.
 */
function writeArming(path: string, at: string): Arming {
  const temporary = `${path}.tmp`;
  try {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(temporary, `${JSON.stringify({ armedAt: at }, null, 2)}\n`, "utf8");
    renameSync(temporary, path);
  } catch (cause) {
    return {
      kind: "unknown",
      why: `this daemon is armed and ${ARMING_FILE} could not be written (${cause instanceof Error ? cause.message : String(cause)}), so no job can be told when it first became eligible`,
    };
  }
  return { kind: "armed", at };
}
