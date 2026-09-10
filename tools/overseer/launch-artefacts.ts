/**
 * **THE EVIDENCE A LAUNCH LEAVES BEHIND, AND THE ONE READER FOR IT.**
 *
 * Plan 260910f § D1/D6/D7. Each attempt gets a directory, and three files in it
 * are what a restarted daemon can go and find when tmux has forgotten a session
 * and nothing else was written down:
 *
 *     intent.json   written by the protocol, before the launcher is invoked
 *     start.json    written by the launched side (job shell or wrapper) as its first act
 *     exit.json     written by the launched side when its child ends
 *
 * This file owns their shapes. The reader here is the contract: Stage 2's shell
 * snippets and TS writer must round-trip through it, so a writer and a reader
 * cannot spell a field two ways.
 *
 * ## What the reader guarantees
 *
 *  - **Exact.** A field this version does not know, a missing one, or a value of
 *    the wrong type is `unreadable` with the reason — never a best guess.
 *  - **Correlation-bound.** A record naming a different launch's id is
 *    `unreadable`, not evidence about this one (F1: `completed` needs a
 *    correlation-bound `exit.json`).
 *  - **Absent is not unreadable.** A file that is not there is a fact the
 *    reconciler can reason from; a file it could not read is not.
 *
 * ## What the identity check can and cannot say
 *
 * `start.json` names the SUPERVISOR's pid and its kernel start tick, and the
 * boot. `alive` means that exact process is still running; `other-boot` means
 * the machine rebooted, so nothing from that boot is running; `gone` means the
 * supervisor is gone on this boot — **which says nothing about its children**,
 * so the protocol never reads `gone` as completion (F1). `cannot-tell` is every
 * way of failing to look, and it is never promoted to `gone`.
 *
 * The `/proc` reading is `tools/fleet/execution-identity.ts`'s — the boot id
 * reader and the start-tick reader, which parses with `parseProcStat` — imported
 * rather than written a second time (F11).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { readBootIdentity, readProcessStart, type BootIdentity, type ReadTextFile } from "../fleet/execution-identity.js";
import { writeAtomically } from "./jsonl.js";
import { isProcessAlive } from "./lock.js";
import {
  MAX_ATTEMPTS,
  isCorrelationId,
  isIsoTimestamp,
  isLaunchOccurrenceId,
  isLauncherKind,
  isNonNegativeInteger,
  isPositiveInteger,
  isRecord,
  isText,
  parseExitAnswer,
  parseExitEnding,
  parseMaterialPin,
  unexpectedField,
  type CorrelationId,
  type ExitAnswer,
  type ExitEnding,
  type LaunchOccurrenceId,
  type LauncherKind,
  type MaterialPin,
  type Parsed,
} from "./launch-protocol.js";

export const INTENT_FILE = "intent.json";
export const START_FILE = "start.json";
export const EXIT_FILE = "exit.json";

/** Larger than any record here could honestly be; a file over it is not one of ours. */
export const MAX_ARTEFACT_BYTES = 64 * 1024;

export type LaunchIntent = {
  readonly v: 1;
  readonly kind: "intent";
  readonly correlationId: CorrelationId;
  readonly occurrenceId: LaunchOccurrenceId;
  readonly attempt: number;
  readonly launcherKind: LauncherKind;
  readonly material: MaterialPin;
  /** The boot the protocol launched on, so a reboot is provable even when no `start.json` was written. Null when it could not be read. */
  readonly bootId: string | null;
  readonly at: string;
};

export type StartRecord = {
  readonly v: 1;
  readonly kind: "start";
  readonly correlationId: CorrelationId;
  /** The supervisor: the job shell or the wrapper, never the child. */
  readonly pid: number;
  /** `/proc/<pid>/stat` field 22, which is what makes the pid an identity. */
  readonly startTicks: number;
  readonly bootId: string;
  /** `$TMUX_PANE` for a tmux launch; null for a headless one. */
  readonly tmuxPane: string | null;
  readonly at: string;
};

export type ExitRecord = {
  readonly v: 1;
  readonly kind: "exit";
  readonly correlationId: CorrelationId;
  readonly ending: ExitEnding;
  readonly timedOut: boolean;
  /** The answer file, for a headless launch. Null for tmux, which has none. */
  readonly answer: ExitAnswer | null;
  readonly at: string;
};

export type ArtefactRead<T> = { readonly kind: "present"; readonly record: T } | { readonly kind: "absent" } | { readonly kind: "unreadable"; readonly why: string };

export type ArtefactReadings = {
  readonly intent: ArtefactRead<LaunchIntent>;
  readonly start: ArtefactRead<StartRecord>;
  readonly exit: ArtefactRead<ExitRecord>;
};

/* ------------------------------------------------------------------ *
 * The exact parsers.
 * ------------------------------------------------------------------ */

function bound(expected: CorrelationId, u: unknown): string | null {
  if (!isCorrelationId(u)) return "correlationId is not a correlation id";
  if (u !== expected) return `names launch ${u}, not ${expected}`;
  return null;
}

export function parseIntent(u: unknown, expected: CorrelationId): Parsed<LaunchIntent> {
  if (!isRecord(u)) return { ok: false, why: "not an object" };
  const extra = unexpectedField(u, ["v", "kind", "correlationId", "occurrenceId", "attempt", "launcherKind", "material", "bootId", "at"]);
  if (extra !== null) return { ok: false, why: extra };
  if (u["v"] !== 1 || u["kind"] !== "intent") return { ok: false, why: "not a version-1 intent record" };
  const binding = bound(expected, u["correlationId"]);
  if (binding !== null) return { ok: false, why: binding };
  const { occurrenceId, attempt, launcherKind, bootId, at } = u;
  if (!isLaunchOccurrenceId(occurrenceId)) return { ok: false, why: "occurrenceId is not an occurrence id" };
  if (!isPositiveInteger(attempt) || attempt > MAX_ATTEMPTS) return { ok: false, why: "attempt is not an attempt number" };
  if (expected !== `${occurrenceId}-a${attempt}`) return { ok: false, why: "the correlation id is not this occurrence's attempt" };
  if (!isLauncherKind(launcherKind)) return { ok: false, why: "launcherKind is not a launcher" };
  const material = parseMaterialPin(u["material"]);
  if (!material.ok) return material;
  if (bootId !== null && !isText(bootId)) return { ok: false, why: "bootId is not a boot id or null" };
  if (!isIsoTimestamp(at)) return { ok: false, why: "at is not an ISO timestamp" };
  return { ok: true, value: { v: 1, kind: "intent", correlationId: expected, occurrenceId, attempt, launcherKind, material: material.value, bootId, at } };
}

export function parseStart(u: unknown, expected: CorrelationId): Parsed<StartRecord> {
  if (!isRecord(u)) return { ok: false, why: "not an object" };
  const extra = unexpectedField(u, ["v", "kind", "correlationId", "pid", "startTicks", "bootId", "tmuxPane", "at"]);
  if (extra !== null) return { ok: false, why: extra };
  if (u["v"] !== 1 || u["kind"] !== "start") return { ok: false, why: "not a version-1 start record" };
  const binding = bound(expected, u["correlationId"]);
  if (binding !== null) return { ok: false, why: binding };
  const { pid, startTicks, bootId, tmuxPane, at } = u;
  if (!isPositiveInteger(pid)) return { ok: false, why: "pid is not a pid" };
  if (!isNonNegativeInteger(startTicks)) return { ok: false, why: "startTicks is not a tick count" };
  if (!isText(bootId)) return { ok: false, why: "bootId is not a boot id" };
  if (tmuxPane !== null && !isText(tmuxPane)) return { ok: false, why: "tmuxPane is not a pane id or null" };
  if (!isIsoTimestamp(at)) return { ok: false, why: "at is not an ISO timestamp" };
  return { ok: true, value: { v: 1, kind: "start", correlationId: expected, pid, startTicks, bootId, tmuxPane, at } };
}

export function parseExit(u: unknown, expected: CorrelationId): Parsed<ExitRecord> {
  if (!isRecord(u)) return { ok: false, why: "not an object" };
  const extra = unexpectedField(u, ["v", "kind", "correlationId", "ending", "timedOut", "answer", "at"]);
  if (extra !== null) return { ok: false, why: extra };
  if (u["v"] !== 1 || u["kind"] !== "exit") return { ok: false, why: "not a version-1 exit record" };
  const binding = bound(expected, u["correlationId"]);
  if (binding !== null) return { ok: false, why: binding };
  const ending = parseExitEnding(u["ending"]);
  if (!ending.ok) return ending;
  const answer = parseExitAnswer(u["answer"]);
  if (!answer.ok) return answer;
  const { timedOut, at } = u;
  if (typeof timedOut !== "boolean") return { ok: false, why: "timedOut is not a boolean" };
  if (!isIsoTimestamp(at)) return { ok: false, why: "at is not an ISO timestamp" };
  return { ok: true, value: { v: 1, kind: "exit", correlationId: expected, ending: ending.value, timedOut, answer: answer.value, at } };
}

/* ------------------------------------------------------------------ *
 * Reading and writing the files.
 * ------------------------------------------------------------------ */

const readText: ReadTextFile = (path) => readFileSync(path, "utf8");

function errnoOf(cause: unknown): string | undefined {
  return typeof cause === "object" && cause !== null && "code" in cause ? String((cause as { code: unknown }).code) : undefined;
}

function readOne<T>(path: string, parse: (u: unknown, expected: CorrelationId) => Parsed<T>, expected: CorrelationId, read: ReadTextFile): ArtefactRead<T> {
  let text: string;
  try {
    text = read(path);
  } catch (cause) {
    if (errnoOf(cause) === "ENOENT") return { kind: "absent" };
    return { kind: "unreadable", why: `${path} could not be read: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
  if (Buffer.byteLength(text, "utf8") > MAX_ARTEFACT_BYTES) return { kind: "unreadable", why: `${path} is larger than any launch record` };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (cause) {
    return { kind: "unreadable", why: `${path} is not JSON: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
  const parsed = parse(json, expected);
  return parsed.ok ? { kind: "present", record: parsed.value } : { kind: "unreadable", why: `${path}: ${parsed.why}` };
}

/** The evidence port's real implementation: all three files of one attempt, each present, absent or unreadable. */
export function readArtefacts(dir: string, correlationId: CorrelationId, read: ReadTextFile = readText): ArtefactReadings {
  return {
    intent: readOne(join(dir, INTENT_FILE), parseIntent, correlationId, read),
    start: readOne(join(dir, START_FILE), parseStart, correlationId, read),
    exit: readOne(join(dir, EXIT_FILE), parseExit, correlationId, read),
  };
}

/** One record as the bytes its file holds. Shared by every writer so the spelling has one source. */
export function artefactText(record: LaunchIntent | StartRecord | ExitRecord): string {
  return `${JSON.stringify(record)}\n`;
}

/** `intent.json`, durably: temp, fsync, rename, fsync the directory. The protocol's own writer; the other two arrive with the launchers. */
export function writeIntentFile(dir: string, intent: LaunchIntent): void {
  writeAtomically(join(dir, INTENT_FILE), dir, artefactText(intent));
}

/* ------------------------------------------------------------------ *
 * The identity check.
 * ------------------------------------------------------------------ */

export type IdentityReading =
  | { readonly kind: "alive" }
  | { readonly kind: "gone"; readonly why: string }
  | { readonly kind: "other-boot"; readonly recorded: string; readonly current: string }
  | { readonly kind: "cannot-tell"; readonly why: string };

/** One pid's start tick, or proof it does not exist, or why neither could be established. */
export type ProcessProbe = { readonly kind: "ticks"; readonly ticks: number } | { readonly kind: "no-such-process" } | { readonly kind: "unreadable"; readonly why: string };

export type IdentityPorts = {
  readonly boot: () => BootIdentity;
  readonly probe: (pid: number) => ProcessProbe;
};

/**
 * One process's start tick off `/proc`, with ENOENT told apart from every
 * other failure — `readProcessStart`'s answer is a sentence, so the reader it is
 * handed notes the errno on the way through.
 *
 * **ENOENT IS ONLY PROOF WHEN THE KERNEL AGREES.** A `/proc` mounted with
 * `hidepid` hides other users' processes, so a missing directory for a live pid
 * is possible; `kill(pid, 0)` answering EPERM says it exists. Only both —
 * no stat file and no such process — is `no-such-process`.
 */
export function probeProcess(pid: number, read: ReadTextFile = readText, alive: (pid: number) => boolean = isProcessAlive): ProcessProbe {
  let missing = false;
  const reading = readProcessStart(pid, (path) => {
    try {
      return read(path);
    } catch (cause) {
      if (errnoOf(cause) === "ENOENT" || errnoOf(cause) === "ESRCH") missing = true;
      throw cause;
    }
  });
  if (reading.read) return { kind: "ticks", ticks: reading.ticks };
  if (missing && !alive(pid)) return { kind: "no-such-process" };
  return { kind: "unreadable", why: reading.why };
}

/**
 * Is the recorded supervisor still the process it was?
 *
 * The boot is checked first because a pid and a tick mean nothing across a
 * reboot — both restart from small numbers. Then the tick, which is what makes
 * a reused pid a different process.
 */
export function identityOf(start: Pick<StartRecord, "pid" | "startTicks" | "bootId">, ports: IdentityPorts): IdentityReading {
  const boot = ports.boot();
  if (!boot.read) return { kind: "cannot-tell", why: `the current boot cannot be read: ${boot.why}` };
  if (boot.id !== start.bootId) return { kind: "other-boot", recorded: start.bootId, current: boot.id };
  const probe = ports.probe(start.pid);
  switch (probe.kind) {
    case "ticks":
      return probe.ticks === start.startTicks
        ? { kind: "alive" }
        : { kind: "gone", why: `pid ${start.pid} now started at tick ${probe.ticks}, not ${start.startTicks}, so it is a different process` };
    case "no-such-process":
      return { kind: "gone", why: `pid ${start.pid} does not exist` };
    case "unreadable":
      return { kind: "cannot-tell", why: probe.why };
    default: {
      const never: never = probe;
      throw new Error(`no identity for probe ${JSON.stringify(never)}`);
    }
  }
}

/** The machine's own ports, for the daemon's composition. */
export const machineIdentity: IdentityPorts = { boot: () => readBootIdentity(), probe: (pid) => probeProcess(pid) };
