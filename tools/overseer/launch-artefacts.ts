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
import { createHash } from "node:crypto";
import { closeSync, fstatSync, lstatSync, openSync, readFileSync, readSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import { readBootIdentity, readProcessStart, type BootIdentity, type ReadTextFile } from "../fleet/execution-identity.js";
import { writeAtomically } from "./jsonl.js";
import { isProcessAlive } from "./lock.js";
import {
  EXIT_FACT_FIELDS,
  MAX_ATTEMPTS,
  isCorrelationId,
  isIsoTimestamp,
  isLaunchOccurrenceId,
  isLauncherKind,
  isNonNegativeInteger,
  isPositiveInteger,
  isRecord,
  isText,
  parseExitFacts,
  parseMaterialPin,
  runFor,
  unexpectedField,
  type CorrelationId,
  type ExitAnswer,
  type ExitFacts,
  type LaunchOccurrenceId,
  type LauncherKind,
  type MaterialPin,
  type Parsed,
  type RunSpec,
} from "./launch-protocol.js";

/*
 * Re-exported for the launched side (Stage 2's `scripts/launch-dir.ts` and
 * `scripts/gjd-remote-launch.ts`), which imports this module and nothing else
 * of the protocol — so nothing on that side can reach `launchOccurrence`, and
 * `tests/overseer-launch-protocol.test.ts` checks that it does not.
 */
export { isCorrelationId } from "./launch-protocol.js";
export { NOT_RUN_CAUSES } from "./launch-protocol.js";
export type { CorrelationId, ExitAnswer, ExitFacts, FailureCause, LauncherKind, RunSpec, WrapperVerdict } from "./launch-protocol.js";

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
  /** The pinned run spec: `null` for `tmux`, required for a wrapper launch (Stage 2). */
  readonly run: RunSpec | null;
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

/**
 * How the child ended and what the supervisor made of it ({@link ExitFacts}).
 * A job shell writes the ending and nulls; a wrapper writes all six.
 */
export type ExitRecord = { readonly v: 1; readonly kind: "exit"; readonly correlationId: CorrelationId; readonly at: string } & ExitFacts;

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
  const extra = unexpectedField(u, ["v", "kind", "correlationId", "occurrenceId", "attempt", "launcherKind", "material", "run", "bootId", "at"]);
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
  const run = runFor(launcherKind, u["run"]);
  if (!run.ok) return run;
  if (bootId !== null && !isText(bootId)) return { ok: false, why: "bootId is not a boot id or null" };
  if (!isIsoTimestamp(at)) return { ok: false, why: "at is not an ISO timestamp" };
  return { ok: true, value: { v: 1, kind: "intent", correlationId: expected, occurrenceId, attempt, launcherKind, material: material.value, run: run.value, bootId, at } };
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
  const extra = unexpectedField(u, ["v", "kind", "correlationId", ...EXIT_FACT_FIELDS, "at"]);
  if (extra !== null) return { ok: false, why: extra };
  if (u["v"] !== 1 || u["kind"] !== "exit") return { ok: false, why: "not a version-1 exit record" };
  const binding = bound(expected, u["correlationId"]);
  if (binding !== null) return { ok: false, why: binding };
  const facts = parseExitFacts(u);
  if (!facts.ok) return facts;
  const at = u["at"];
  if (!isIsoTimestamp(at)) return { ok: false, why: "at is not an ISO timestamp" };
  return { ok: true, value: { v: 1, kind: "exit", correlationId: expected, at, ...facts.value } };
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

/** `intent.json`, durably: temp, fsync, rename, fsync the directory. The protocol's own writer; the launched side's are below. */
export function writeIntentFile(dir: string, intent: LaunchIntent): void {
  writeAtomically(join(dir, INTENT_FILE), dir, artefactText(intent));
}

/* ------------------------------------------------------------------ *
 * Stage 2: the launched side's writers.
 *
 * Two writers, one reader. The TypeScript writer is the wrappers'
 * (`run-claude`, `run-codex` via `scripts/launch-dir.ts`); the shell writer is
 * a generated line a job script runs (gjd-remote's, and the drill's). Both are
 * checked against the reader above, so neither can spell a field another way.
 * ------------------------------------------------------------------ */

/** What a launched session or child carries in its environment. Named once, so a writer and the tmux probe cannot spell them two ways. */
export const LAUNCH_ID_VAR = "SPIDERYARN_LAUNCH_ID";
export const LAUNCH_DIR_VAR = "SPIDERYARN_LAUNCH_DIR";

/**
 * Single-quote for a POSIX shell — the same idiom as gjd-remote's `shq`.
 * **Validation is not quoting (F13):** every path that reaches a shell goes
 * through this or `shq`, however clean the validation says it is.
 */
export function shellQuote(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

function hasControlCharacter(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

/** Why a path cannot be an artefact directory on a command line, in an env var or in a tmux value, or null. */
export function launchDirProblem(dir: string): string | null {
  if (!isAbsolute(dir)) return `${JSON.stringify(dir)} is not an absolute path`;
  // A NEWLINE ABOVE ALL: tmux prints a multi-line value as several lines, and
  // gjd-remote's admission script refuses a command that is not one line.
  if (hasControlCharacter(dir)) return `${JSON.stringify(dir)} contains a control character`;
  return null;
}

function writeChecked<T extends StartRecord | ExitRecord>(dir: string, file: string, record: T, parse: (u: unknown, expected: CorrelationId) => Parsed<T>): void {
  const text = artefactText(record);
  // THE WRITER ASKS ITS OWN READER FIRST. A record the reader would reject is
  // not evidence, and writing it would turn a writer's bug into an
  // `unreadable` that holds the reservation for ever.
  const again = parse(JSON.parse(text), record.correlationId);
  if (!again.ok) throw new Error(`refusing to write a ${file} its own reader would reject: ${again.why}`);
  writeAtomically(join(dir, file), dir, text);
}

/** `start.json`, durably — only if the reader would accept it. */
export function writeStartFile(dir: string, record: StartRecord): void {
  writeChecked(dir, START_FILE, record, parseStart);
}

/** `exit.json`, durably — only if the reader would accept it. */
export function writeExitFile(dir: string, record: ExitRecord): void {
  writeChecked(dir, EXIT_FILE, record, parseExit);
}

/** This process as a start record: its pid, its kernel start tick and the boot. A process that cannot say who it is gets a reason instead. */
export function selfStartRecord(correlationId: CorrelationId, at: Date, options: { readonly pid?: number; readonly read?: ReadTextFile } = {}): Parsed<StartRecord> {
  const pid = options.pid ?? process.pid;
  const read = options.read ?? readText;
  const boot = readBootIdentity(read);
  if (!boot.read) return { ok: false, why: boot.why };
  const start = readProcessStart(pid, read);
  if (!start.read) return { ok: false, why: start.why };
  return parseStart({ v: 1, kind: "start", correlationId, pid, startTicks: start.ticks, bootId: boot.id, tmuxPane: null, at: at.toISOString() }, correlationId);
}

/** An answer file's path, size and sha256, read in bounded chunks; null when there is no regular file there. */
export function answerFacts(path: string): Omit<ExitAnswer, "usable"> | null {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return null;
  }
  try {
    if (!fstatSync(fd).isFile()) return null;
    const hash = createHash("sha256");
    const chunk = Buffer.alloc(64 * 1024);
    let bytes = 0;
    for (;;) {
      const got = readSync(fd, chunk, 0, chunk.length, null);
      if (got === 0) break;
      hash.update(chunk.subarray(0, got));
      bytes += got;
    }
    return { path, bytes, sha256: hash.digest("hex") };
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

export type LaunchDirCheck = { readonly ok: true; readonly intent: LaunchIntent } | { readonly ok: false; readonly why: string };

/**
 * **THE WRAPPER'S GATE: is this an attempt directory the protocol made, for a
 * launch of my kind, that nobody has run yet?** Refused, not guessed: missing,
 * a symlink, not ours, not 0700, no valid intent, an intent that is not this
 * directory's, an intent for another launcher, or a `start.json`/`exit.json`
 * already there — the last because a second run under one correlation id is
 * exactly the double launch the protocol exists to prevent.
 *
 * The correlation id comes from `intent.json` and nowhere else, so a flag and
 * the file cannot disagree.
 */
export function checkLaunchDir(dir: string, options: { readonly uid: number; readonly launcherKinds: readonly LauncherKind[] }): LaunchDirCheck {
  const problem = launchDirProblem(dir);
  if (problem !== null) return { ok: false, why: `the launch directory ${problem}` };
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(dir);
  } catch (cause) {
    return { ok: false, why: errnoOf(cause) === "ENOENT" ? `${dir} does not exist` : `${dir} could not be examined: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
  if (stat.isSymbolicLink()) return { ok: false, why: `${dir} is a symlink, not a directory` };
  if (!stat.isDirectory()) return { ok: false, why: `${dir} is not a directory` };
  if (stat.uid !== options.uid) return { ok: false, why: `${dir} is owned by uid ${stat.uid}, not this process's ${options.uid}` };
  const mode = stat.mode & 0o777;
  if (mode !== 0o700) return { ok: false, why: `${dir} is mode ${mode.toString(8).padStart(4, "0")}, not 0700` };

  let text: string;
  try {
    text = readFileSync(join(dir, INTENT_FILE), "utf8");
  } catch (cause) {
    return { ok: false, why: `${dir} has no readable ${INTENT_FILE}: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
  if (Buffer.byteLength(text, "utf8") > MAX_ARTEFACT_BYTES) return { ok: false, why: `${INTENT_FILE} is larger than any intent` };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, why: `${INTENT_FILE} is not JSON` };
  }
  const claimed = isRecord(json) ? json["correlationId"] : undefined;
  if (!isCorrelationId(claimed)) return { ok: false, why: `${INTENT_FILE} names no correlation id` };
  const parsed = parseIntent(json, claimed);
  if (!parsed.ok) return { ok: false, why: `${INTENT_FILE} is not a valid intent: ${parsed.why}` };
  const intent = parsed.value;
  if (!dir.endsWith(`/o/${intent.occurrenceId}/a${intent.attempt}`)) return { ok: false, why: `${INTENT_FILE} belongs to ${intent.correlationId}, not this directory` };
  if (!options.launcherKinds.includes(intent.launcherKind)) return { ok: false, why: `the intent is for a ${intent.launcherKind} launch, not ${options.launcherKinds.join(" or ")}` };
  for (const file of [START_FILE, EXIT_FILE]) {
    try {
      lstatSync(join(dir, file));
      return { ok: false, why: `${dir} already has a ${file}: this attempt has been run, and is not run twice` };
    } catch (cause) {
      if (errnoOf(cause) !== "ENOENT") return { ok: false, why: `could not check for ${file}: ${cause instanceof Error ? cause.message : String(cause)}` };
    }
  }
  return { ok: true, intent };
}

/* ------------------------------------------------------------------ *
 * The shell writer: one generated line per record (F3).
 *
 *   exclusive temp (`set -C` in a subshell) → write → `sync` the file
 *   → `mv` over the target → `sync` the directory
 *
 * Every step's failure is the line's failure, and the line's failure runs the
 * caller's `onFailure` — gjd-remote's `failTo`, so **Claude is never started
 * without a durable `start.json`**. The temp name carries `$$` and `$RANDOM`,
 * and a left-over temp is ignored by the reader, which reads only the target.
 *
 * Every field is validated before it is written — the pid and tick are digits,
 * the boot id hex-and-dashes, the pane `%<digits>` or null, the time exactly
 * `toISOString()`'s shape — so no JSON escaping is needed, and a value that
 * fails its check fails the line rather than being written as best it can.
 *
 * `exit.json` from a job shell records the exit status the shell saw. A child
 * killed by a signal is `128+n` to bash, indistinguishable from a program that
 * exited `128+n` itself, so it is recorded as `exited` with that code — the
 * shell makes no judgement (`verdict: null`).
 * ------------------------------------------------------------------ */

const SHELL_TIMESTAMP = "date -u +%Y-%m-%dT%H:%M:%S.%3NZ";
const TIMESTAMP_SHAPE = "[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z";
const SHELL_VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type ShellArtefactInput = {
  readonly correlationId: CorrelationId;
  /** The attempt directory, absolute. Quoted, never trusted. */
  readonly dir: string;
  /** One line of shell run when the write fails. */
  readonly onFailure: string;
  /** The caller's own quoting (gjd-remote passes its `shq`); {@link shellQuote} otherwise. */
  readonly quote?: (text: string) => string;
};

/** The two things every generated line starts with: where, and the one checked way to publish a file there. */
function shellPrelude(input: ShellArtefactInput): string {
  if (!isCorrelationId(input.correlationId)) throw new Error(`${JSON.stringify(input.correlationId)} is not a correlation id`);
  const problem = launchDirProblem(input.dir);
  if (problem !== null) throw new Error(`the artefact directory ${problem}`);
  if (input.onFailure.includes("\n")) throw new Error("onFailure must be one line of shell");
  const quote = input.quote ?? shellQuote;
  const publish =
    `_spya_publish() { local final="$1" tmp="$1.tmp.$$.$RANDOM"; ` +
    `( set -C; printf '%s\\n' "$2" > "$tmp" ) && sync -- "$tmp" && mv -f -- "$tmp" "$final" && sync -- "$_spya_d"; }`;
  return `_spya_d=${quote(input.dir)}; ${publish}`;
}

const shellTimestamp = `a=$(${SHELL_TIMESTAMP}) || return 1; case $a in ${TIMESTAMP_SHAPE}) ;; *) return 1;; esac`;

/**
 * The line that writes `start.json`: the job shell's own pid (`$$`), its kernel
 * start tick (`/proc/$$/stat` field 22, parsed after the last `)` exactly as
 * `parseProcStat` does), the boot id, `$TMUX_PANE`, and the time.
 */
export function startArtefactLine(input: ShellArtefactInput): string {
  const prelude = shellPrelude(input);
  const json = `{\\"v\\":1,\\"kind\\":\\"start\\",\\"correlationId\\":\\"${input.correlationId}\\",\\"pid\\":$$,\\"startTicks\\":$t,\\"bootId\\":\\"$b\\",\\"tmuxPane\\":$p,\\"at\\":\\"$a\\"}`;
  const start = [
    "_spya_start() { local s t b p a",
    "s=$(cat /proc/$$/stat) || return 1",
    "set -- ${s##*) }",
    "t=${20-}",
    "case $t in ''|*[!0-9]*) return 1;; esac",
    "read -r b < /proc/sys/kernel/random/boot_id || return 1",
    "case $b in ''|*[!0-9a-f-]*) return 1;; esac",
    "p=null",
    `case \${TMUX_PANE-} in %*) case \${TMUX_PANE#%} in ''|*[!0-9]*) ;; *) p="\\"$TMUX_PANE\\"";; esac;; esac`,
    shellTimestamp,
    `_spya_publish "$_spya_d/${START_FILE}" "${json}"; }`,
  ].join("; ");
  return `${prelude}; ${start}; _spya_start || ${input.onFailure}`;
}

/**
 * The line that writes `exit.json` from a status the caller has ALREADY saved
 * in `statusVar` — so nothing between the child and this line can change it.
 */
export function exitArtefactLine(input: ShellArtefactInput & { readonly statusVar: string }): string {
  if (!SHELL_VARIABLE.test(input.statusVar)) throw new Error(`${JSON.stringify(input.statusVar)} is not a shell variable name`);
  const prelude = shellPrelude(input);
  const json =
    `{\\"v\\":1,\\"kind\\":\\"exit\\",\\"correlationId\\":\\"${input.correlationId}\\",\\"ending\\":{\\"kind\\":\\"exited\\",\\"code\\":$c},` +
    `\\"verdict\\":null,\\"usageLimit\\":null,\\"permissionDenials\\":null,\\"answer\\":null,\\"transcript\\":null,\\"at\\":\\"$a\\"}`;
  const exit = ['_spya_exit() { local c="$1" a', "case $c in ''|*[!0-9]*) return 1;; esac", shellTimestamp, `_spya_publish "$_spya_d/${EXIT_FILE}" "${json}"; }`].join("; ");
  return `${prelude}; ${exit}; _spya_exit "$${input.statusVar}" || ${input.onFailure}`;
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
