/**
 * **The `overseer` CLI's own small memory** — `~/.overseer/cli-state.json`.
 *
 * Two lists live here and nothing else:
 *
 * - **`mine`** — the session names this Overseer is looking after. `overseer
 *   tick` reads it to decide whose last turn to print, `dispatch` adds to it and
 *   `closeout` removes from it. In the bash specimen this was a `grep -E`
 *   alternation typed into the script, which meant a session dispatched at 3am
 *   was invisible to the next tick unless somebody remembered to edit a file.
 * - **`paused`** — who was told to pause, when, and by which door. `overseer.md`
 *   § The tick asks for exactly this and says why: *"Log who is paused, and
 *   check they woke up."* A pause nobody verifies is indistinguishable from an
 *   agent that died, and the Overseer auto-compacts, so its own memory of a
 *   pause it issued forty minutes ago is the first thing to go.
 *
 * ## Why this is not in the checkpoint
 *
 * `~/.overseer/` is the store and **the daemon is its single writer**
 * (`store.ts`). This file is beside it, not in it: the daemon never reads or
 * writes `cli-state.json`, and this module is its only writer. That is the whole
 * of the concurrency story — one writer, one file — plus the two details below.
 *
 * ## An unreadable file is NOT an empty one
 *
 * `readCliState` has three arms, and the difference between `absent` and
 * `unusable` is the whole reason it does. Absent is ordinary: no tick has run
 * here yet, and an empty state is the right answer. Unusable means the bytes are
 * there and this build cannot understand them — and answering *empty* to that
 * would hand `closeout` a list with nothing in it, which reads as *nobody is
 * mine* rather than *I cannot tell you*, and the write that followed would
 * overwrite the list it could not read. So every writer refuses on `unusable`
 * and says so. docs/reusable/silent-success.md is the general form.
 *
 * ## Every write takes a lock, and the first draft's reasoning was wrong
 *
 * `arming.ts` writes `${path}.tmp` and renames it, which is atomic for one
 * writer and a shared clobber target for two — so the temp name here carries
 * this process's pid. **That is not enough, and the first draft of this file
 * said it was.** GPT Sol's P1-1 on the plan: two processes read `{mine:["a"]}`,
 * one adds `b` and one adds `c`, both rename atomically, and the survivor holds
 * `a,b` or `a,c`. Neither file is torn and one valid update has silently
 * vanished — which is the exact shape (`silent-success.md`) this module's other
 * half is built to refuse.
 *
 * That draft rejected a lock on the grounds that "a lock in the Overseer's own
 * tooling is a thing that can wedge the Overseer". The answer is that
 * `lock.ts` already clears a lock whose holder is dead, refuses in a named way
 * rather than hanging, and is the machinery the daemon itself runs on. A
 * **separate** `cli-state.lock` is used, never the daemon's `overseer.lock`: the
 * daemon holds a long-lived lock on its own file and does not lock the
 * directory, so a second lock beside it contends with nothing.
 *
 * ## And the file carries a schema
 *
 * A future incompatible shape must be `unusable`, not partially defaulted — the
 * same rule the store's own `STORE_SCHEMA` follows, and for the same reason.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { NAME_RULE } from "../fleet/routes-rename.js";
import { describeLockRefusal, releaseLock, stillOurs, takeLock } from "./lock.js";

/** The file, inside whatever `storeRoot()` resolved to. */
export const CLI_STATE_FILE = "cli-state.json";

/**
 * The lock every write takes — **beside** the daemon's `overseer.lock`, never it.
 *
 * The daemon's lock is long-lived and belongs to a process that runs for days;
 * taking it would mean this CLI could never write while the fleet was being
 * watched, which is all of the time. It locks its own file rather than the
 * directory, so a second lock file here contends with nothing.
 */
export const CLI_STATE_LOCK_FILE = "cli-state.lock";

/**
 * The shape this build writes and the only one it will read.
 *
 * A file from a future incompatible build must be `unusable`, not partially
 * defaulted into something that looks like a list — the same rule, for the same
 * reason, as `STORE_SCHEMA` in `store.ts`. A file with no `schema` at all is the
 * one written before this field existed and is read as 1, because that is what
 * it was.
 */
export const CLI_STATE_SCHEMA = 1;

/**
 * Which door the pause sentence went through.
 *
 * `steer` is this CLI posting to `/api/steer/message`; `elsewhere` is the
 * Overseer having sent it itself with `SendMessage`, which it prefers for a
 * Claude session and which no CLI can do. The record is the same either way —
 * that is the point of `--record-only` — but a later "did it wake up?" wants to
 * know whether a delivery receipt exists to go and look at.
 */
export type PauseDoor = "steer" | "elsewhere";

/** One session, told to pause, at one instant. */
export type PauseRecord = {
  readonly session: string;
  /** UTC ISO 8601, always — the BST log lines of 2026-09-09 are why this comment exists. */
  readonly at: string;
  readonly door: PauseDoor;
  /** Whatever the Overseer said the reason was, for the log line and for the resume order. */
  readonly why: string;
};

export type CliState = {
  readonly mine: readonly string[];
  readonly paused: readonly PauseRecord[];
};

export const EMPTY_CLI_STATE: CliState = { mine: [], paused: [] };

export type CliStateRead =
  | { kind: "read"; state: CliState }
  | { kind: "absent" }
  | { kind: "unusable"; why: string };

export function cliStatePath(storeRoot: string): string {
  return join(storeRoot, CLI_STATE_FILE);
}

/** A session name this CLI will accept, or why not. `null` when it is fine. */
export function whyNotASessionName(name: string): string | null {
  if (name.length === 0) return "a session name cannot be empty";
  if (!NAME_RULE.test(name)) {
    return (
      `${JSON.stringify(name)} is not a session name here: lower-case letters, digits and dashes, ` +
      "starting with a letter or digit, at most 41 characters (tools/fleet/routes-rename.ts § NAME_RULE)"
    );
  }
  return null;
}

function parsePauseRecord(raw: unknown): PauseRecord | string {
  if (raw === null || typeof raw !== "object") return "a paused entry is not an object";
  const o = raw as Record<string, unknown>;
  const session = o["session"];
  if (typeof session !== "string" || whyNotASessionName(session) !== null) {
    return `a paused entry has no usable session name: ${JSON.stringify(session)}`;
  }
  const at = o["at"];
  if (typeof at !== "string" || Number.isNaN(Date.parse(at))) {
    return `paused entry for ${session} has no readable instant: ${JSON.stringify(at)}`;
  }
  const door = o["door"];
  if (door !== "steer" && door !== "elsewhere") {
    return `paused entry for ${session} has no known door: ${JSON.stringify(door)}`;
  }
  const why = o["why"];
  if (typeof why !== "string") return `paused entry for ${session} has no reason string`;
  return { session, at, door, why };
}

/**
 * Read it, or say which of the three things is true.
 *
 * Strict on purpose. A field this cannot parse is `unusable` rather than a
 * dropped entry, because a dropped `paused` entry is a session that stays
 * stopped all day and a dropped `mine` entry is a session nobody closes out.
 */
export function parseCliState(raw: unknown): { kind: "read"; state: CliState } | { kind: "unusable"; why: string } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { kind: "unusable", why: `${CLI_STATE_FILE} is not a JSON object` };
  }
  const o = raw as Record<string, unknown>;
  const schema = o["schema"] ?? CLI_STATE_SCHEMA;
  if (schema !== CLI_STATE_SCHEMA) {
    return {
      kind: "unusable",
      why:
        `${CLI_STATE_FILE} is schema ${JSON.stringify(schema)} and this build reads ${CLI_STATE_SCHEMA} — ` +
        "a newer Overseer wrote it, so read it with that build rather than letting this one guess",
    };
  }
  const rawMine = o["mine"] ?? [];
  if (!Array.isArray(rawMine)) return { kind: "unusable", why: `${CLI_STATE_FILE}: "mine" is not an array` };
  const mine: string[] = [];
  for (const entry of rawMine) {
    if (typeof entry !== "string") return { kind: "unusable", why: `${CLI_STATE_FILE}: "mine" holds ${JSON.stringify(entry)}, which is not a name` };
    const why = whyNotASessionName(entry);
    if (why !== null) return { kind: "unusable", why: `${CLI_STATE_FILE}: ${why}` };
    if (!mine.includes(entry)) mine.push(entry);
  }
  const rawPaused = o["paused"] ?? [];
  if (!Array.isArray(rawPaused)) return { kind: "unusable", why: `${CLI_STATE_FILE}: "paused" is not an array` };
  const paused: PauseRecord[] = [];
  for (const entry of rawPaused) {
    const parsed = parsePauseRecord(entry);
    if (typeof parsed === "string") return { kind: "unusable", why: `${CLI_STATE_FILE}: ${parsed}` };
    paused.push(parsed);
  }
  return { kind: "read", state: { mine, paused } };
}

export function readCliState(storeRoot: string): CliStateRead {
  const path = cliStatePath(storeRoot);
  if (!existsSync(path)) return { kind: "absent" };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    return {
      kind: "unusable",
      why: `${CLI_STATE_FILE} could not be read (${cause instanceof Error ? cause.message : String(cause)})`,
    };
  }
  return parseCliState(raw);
}

/**
 * The state to act on, or a refusal — the shape every writing subcommand wants.
 *
 * Folded here rather than at each call site so that no caller can spell
 * `absent` and `unusable` the same way by accident, which is the substitution
 * this module exists to prevent.
 */
export function cliStateForWriting(storeRoot: string): { ok: true; state: CliState } | { ok: false; why: string } {
  const read = readCliState(storeRoot);
  if (read.kind === "absent") return { ok: true, state: EMPTY_CLI_STATE };
  if (read.kind === "unusable") {
    return {
      ok: false,
      why: `${read.why} — refusing to write over a state file this build cannot read; ${cliStatePath(storeRoot)}`,
    };
  }
  return { ok: true, state: read.state };
}

export function writeCliState(storeRoot: string, state: CliState): { ok: true } | { ok: false; why: string } {
  const path = cliStatePath(storeRoot);
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(temporary, `${JSON.stringify({ schema: CLI_STATE_SCHEMA, ...state }, null, 2)}\n`, "utf8");
    renameSync(temporary, path);
    return { ok: true };
  } catch (cause) {
    try {
      if (existsSync(temporary)) unlinkSync(temporary);
    } catch {
      /* the rename is what matters; a stray temp file is not worth a second failure */
    }
    return { ok: false, why: `${CLI_STATE_FILE} could not be written (${cause instanceof Error ? cause.message : String(cause)})` };
  }
}

/**
 * **Read, decide, write — under a lock, so no update is lost.**
 *
 * The whole read-modify-write is inside the lock. `writeCliState` on its own is
 * atomic against a *torn* file and does nothing about the lost update GPT Sol's
 * P1-1 describes: two readers of `{mine:["a"]}` both rename, and one of `b` or
 * `c` is simply gone.
 *
 * `edit` returns the new state, or a string to refuse with. It runs holding the
 * lock, so it must not be slow and must not take another lock.
 *
 * **`stillOurs` is rechecked after the write** for the reason `releaseLock` has
 * it: if a stale-lock sweep handed the file to somebody else while we were
 * writing, we have just written beside a second writer and the honest answer is
 * to say so rather than report success.
 */
export function updateCliState(
  storeRoot: string,
  edit: (state: CliState) => CliState | { refuse: string },
  now: () => Date = () => new Date(),
): { ok: true; state: CliState } | { ok: false; why: string } {
  const lockPath = join(storeRoot, CLI_STATE_LOCK_FILE);
  try {
    mkdirSync(storeRoot, { recursive: true });
  } catch (cause) {
    return { ok: false, why: `could not open ${storeRoot} (${cause instanceof Error ? cause.message : String(cause)})` };
  }
  const taken = takeLock(lockPath, now);
  if (!taken.ok) return { ok: false, why: describeLockRefusal(taken.refusal, lockPath) };
  try {
    const forWriting = cliStateForWriting(storeRoot);
    if (!forWriting.ok) return { ok: false, why: forWriting.why };
    const next = edit(forWriting.state);
    if ("refuse" in next) return { ok: false, why: next.refuse };
    const written = writeCliState(storeRoot, next);
    if (!written.ok) return { ok: false, why: written.why };
    if (!stillOurs(taken.lock, lockPath)) {
      return {
        ok: false,
        why:
          `${CLI_STATE_FILE} was written, but ${CLI_STATE_LOCK_FILE} is no longer ours — ` +
          "another writer may have been running beside us, so read the file before trusting it",
      };
    }
    return { ok: true, state: next };
  } finally {
    releaseLock(taken.lock, lockPath);
  }
}

/* ------------------------------------------------------------- pure edits -- */

/** Add a name, keeping the list sorted and unique. Returns the same state when it was already there. */
export function addMine(state: CliState, name: string): { state: CliState; changed: boolean } {
  if (state.mine.includes(name)) return { state, changed: false };
  return { state: { ...state, mine: [...state.mine, name].sort() }, changed: true };
}

export function removeMine(state: CliState, name: string): { state: CliState; changed: boolean } {
  if (!state.mine.includes(name)) return { state, changed: false };
  return { state: { ...state, mine: state.mine.filter((n) => n !== name) }, changed: true };
}

/**
 * Record a pause. A second pause of the same session **replaces** the first.
 *
 * Replacing rather than appending because the question this list answers is
 * *who is paused right now, and since when* — a history of pauses is what the
 * event log is for, and two entries for one session would make
 * `resume --check` report it twice.
 */
export function recordPause(state: CliState, record: PauseRecord): CliState {
  const paused = state.paused.filter((p) => p.session !== record.session);
  return { ...state, paused: [...paused, record].sort((a, b) => a.at.localeCompare(b.at)) };
}

export function recordResume(state: CliState, session: string): { state: CliState; was: PauseRecord | undefined } {
  const was = state.paused.find((p) => p.session === session);
  if (was === undefined) return { state, was: undefined };
  return { state: { ...state, paused: state.paused.filter((p) => p.session !== session) }, was };
}
