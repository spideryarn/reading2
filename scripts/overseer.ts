#!/usr/bin/env -S npx tsx
/**
 * **The Overseer: run it, and look at what it has seen.**
 *
 *     npx tsx scripts/overseer.ts run                 # the daemon
 *     npx tsx scripts/overseer.ts status              # is it alive, and what does it know
 *     npx tsx scripts/overseer.ts events --limit 40   # what the fleet did
 *     npx tsx scripts/overseer.ts notes  --limit 20   # what the Overseer's own day was like
 *
 * Direction: docs/project/orchestrator-direction.md. Stage S4 of
 * docs/plans/260908b-overseer-store-and-clock.md.
 *
 * **`status` is not a nicety on top of the daemon; it is the half that makes
 * the daemon worth having.** Greg's NOW goal is *"staying up-to-date on
 * progress automatically"*, and a daemon recording events with nothing to read
 * them fails that while every stage passes. The dashboard owns the page and
 * this stage does not build one, so the honest simplest version is a command.
 *
 * **Every read here is lock-free**, deliberately: `readCheckpoint` was built
 * that way so a reader cannot disturb the writer, and the event log and the
 * note log are read the same way — open, read, close. Running this against a
 * live daemon costs it nothing and can block nothing.
 *
 * `console.log` rather than src/log.ts: this is a CLI, and that is the rule —
 * docs/project/logging.md.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runOverseer, TICK_MS } from "../tools/overseer/daemon.js";
import type { OverseerEvent } from "../tools/overseer/diff.js";
import { describeNote, openConditions, readNotes, type DaemonNote } from "../tools/overseer/notes.js";
import {
  EVENTS_FILE,
  describeRefusal,
  isProcessAlive,
  readCheckpoint,
  storeRoot,
  type Checkpoint,
  type RegisterEntry,
} from "../tools/overseer/store.js";

/** Where the daemon looks for the dashboard unless told otherwise. */
export const DEFAULT_FLEET_URL = "http://127.0.0.1:8787";

/**
 * How long a live process may go without writing before it is *stalled* rather
 * than *running*: three ticks.
 *
 * One missed tick is a busy box; three is a process that is up and not doing
 * its job — which is the failure this whole tool exists to make visible, since
 * a stalled daemon renders a perfectly plausible register that stopped being
 * true some time ago.
 */
export const STALL_AFTER_MS = 3 * TICK_MS;

/**
 * The store root, refusing a relative one.
 *
 * **A relative `OVERSEER_STORE_DIR` resolves differently per working
 * directory**, so a systemd start and a manual start from a worktree would take
 * two different locks and write two separate, individually plausible histories
 * — GPT Sol's S3-07. Refusing is the only reading of a relative path that
 * cannot be silently wrong; resolving it against `process.cwd()` is what
 * produces the two stores.
 */
export function requireAbsoluteRoot(root: string): string {
  if (!isAbsolute(root)) {
    throw new Error(
      `the Overseer store must be an absolute path; got ${JSON.stringify(root)}. ` +
        "A relative OVERSEER_STORE_DIR means one store per working directory, and two daemons that cannot see each other.",
    );
  }
  return root;
}

export type DaemonStanding = {
  state: "never-run" | "running" | "stalled" | "stopped" | "killed";
  detail: string;
};

export type StandingInput = {
  checkpoint: Checkpoint | null;
  /** The last line of the daemon's own log. Its own last word beats anything inferred. */
  lastNote: DaemonNote | null;
  nowMs: number;
  alive: (pid: number) => boolean;
};

/**
 * Is an Overseer running against this store?
 *
 * **Five arms, and four of them are "no" for different reasons**, which is the
 * point: *stopped on purpose*, *killed*, *up but not writing* and *never run*
 * call for four different things from a person, and a boolean would collapse
 * them into the one word that suggests none of them.
 *
 * The daemon's own `daemon-stopped` note is the strongest evidence available
 * and is read first. A pid is a weak signal — pids are reused, and a fresh
 * process wearing a dead daemon's number is exactly the kind of coincidence
 * this codebase keeps meeting — so it is only ever used to CONFIRM a
 * checkpoint that is already recent.
 */
export function daemonStanding(input: StandingInput): DaemonStanding {
  const { checkpoint, lastNote, nowMs } = input;
  if (checkpoint === null) {
    return {
      state: "never-run",
      detail:
        lastNote === null
          ? "no checkpoint and no notes: the Overseer has never run against this store"
          : "notes but no checkpoint: the Overseer started and never got as far as a first collection",
    };
  }
  const ageMs = nowMs - Date.parse(checkpoint.writtenAt);
  const age = describeAge(ageMs);
  const pid = checkpoint.heartbeat.pid;

  if (lastNote?.kind === "daemon-stopped") {
    return { state: "stopped", detail: `stopped on purpose at ${lastNote.at} (${lastNote.why}); the last checkpoint is ${age} old` };
  }
  if (!input.alive(pid)) {
    return { state: "killed", detail: `pid ${pid} is gone and it never wrote a stopping note, so it was killed; the last checkpoint is ${age} old` };
  }
  if (ageMs > STALL_AFTER_MS) {
    return { state: "stalled", detail: `pid ${pid} is alive and has not written for ${age} (a tick is ${Math.round(TICK_MS / 1000)}s)` };
  }
  return {
    state: "running",
    detail: `pid ${pid}, instance ${checkpoint.heartbeat.instanceId}, ${checkpoint.heartbeat.ticks} ticks, last written ${age} ago`,
  };
}

export type EventTail = { events: OverseerEvent[]; unreadable: number; total: number };

/** Every event kind, as a total map, so a new arm in diff.ts fails to compile here rather than reading as junk. */
const EVENT_KINDS: Record<OverseerEvent["kind"], true> = {
  "session-seen": true,
  "session-status": true,
  "tmux-session-gone": true,
  "session-replaced": true,
  "session-wait-restarted": true,
};

/**
 * The last `limit` events, read without taking the store's lock.
 *
 * A duplicate of `store.ts`'s own reader, which is not exported and is reachable
 * only through `openStore` — and `openStore` takes the exclusive lock, so a
 * reader using it would either refuse to run while the daemon is up or, worse,
 * take the lock from it. Reported as a finding; the fix is a lock-free
 * `readEventsAt(root, fromByte)` in that module.
 *
 * The whole file is read, which is fine for a person typing a command and would
 * not be for anything on a tick — see Sol's S3-06.
 */
export function readEventTail(root: string, limit: number): EventTail {
  const path = join(root, EVENTS_FILE);
  if (!existsSync(path)) return { events: [], unreadable: 0, total: 0 };
  const events: OverseerEvent[] = [];
  let unreadable = 0;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      unreadable += 1;
      continue;
    }
    if (isEvent(parsed)) events.push(parsed);
    else unreadable += 1;
  }
  return { events: events.slice(-limit), unreadable, total: events.length };
}

function isEvent(u: unknown): u is OverseerEvent {
  if (typeof u !== "object" || u === null || Array.isArray(u)) return false;
  const record = u as Record<string, unknown>;
  return typeof record["kind"] === "string" && Object.hasOwn(EVENT_KINDS, record["kind"]) && typeof record["at"] === "string";
}

/** One event as a line a person reads, naming the session rather than only its handle. */
export function describeEvent(event: OverseerEvent): string {
  const when = event.at.slice(11, 19);
  switch (event.kind) {
    case "session-seen":
      return `${when}  seen       ${event.row.name} (${event.identity.tmuxId}) — ${event.row.status.kind}`;
    case "session-status":
      return `${when}  status     ${event.identity.tmuxId} — ${event.from} → ${event.to}`;
    case "tmux-session-gone":
      return `${when}  gone       ${event.name} (${event.identity.tmuxId}) — ${event.why}`;
    case "session-replaced":
      return `${when}  replaced   ${event.row.name} (${event.identity.tmuxId}) — a different conversation is in the pane`;
    case "session-wait-restarted":
      return `${when}  wait again ${event.identity.tmuxId} — now until ${event.deadline}`;
    default: {
      const never: never = event;
      throw new Error(String(never));
    }
  }
}

/**
 * The status page, as lines.
 *
 * Ordered by what a person wants first: is it alive, is it hearing anything, is
 * anything wrong, and only then the fleet — because the register is the part
 * that looks fine when everything above it is broken.
 */
export function statusLines(root: string, nowMs: number = Date.now()): string[] {
  requireAbsoluteRoot(root);
  const read = readCheckpoint(root);
  const checkpoint = read.kind === "checkpoint" ? read.checkpoint : null;
  const notes = readNotes(root);
  const lastNote = notes.notes.at(-1) ?? null;
  const standing = daemonStanding({ checkpoint, lastNote, nowMs, alive: isProcessAlive });
  const lines: string[] = [`Overseer store: ${root}`, ""];

  lines.push(`daemon      ${standing.state.toUpperCase().replace("-", " ")} — ${standing.detail}`);
  if (read.kind === "unusable") lines.push(`            the checkpoint is unusable (${read.why}): ${read.detail}`);

  if (checkpoint === null) {
    lines.push("source      nothing has been collected yet");
  } else if (checkpoint.lastGoodSnapshotAt === null) {
    // ALIVE BUT DEAF, and it is a different sentence from a quiet fleet.
    lines.push("source      the Overseer has never been given a collection by the dashboard");
  } else {
    lines.push(
      `source      last collection ${checkpoint.lastGoodSnapshotAt} (${describeAge(nowMs - Date.parse(checkpoint.lastGoodSnapshotAt))} old)`,
    );
  }

  const open = openConditions(notes.notes);
  if (open.length === 0) lines.push("conditions  all clear");
  for (const condition of open) {
    lines.push(`conditions  DEGRADED ${condition.condition} since ${condition.since} (${describeAge(nowMs - Date.parse(condition.since))}) — ${condition.why}`);
  }

  if (checkpoint !== null) {
    lines.push("", registerSummary(checkpoint.register), ...attentionLines(checkpoint.register, nowMs));
  }

  const tail = readEventTail(root, 5);
  const size = existsSync(join(root, EVENTS_FILE)) ? statSync(join(root, EVENTS_FILE)).size : 0;
  lines.push("", `events      ${tail.total} in the log (${Math.round(size / 1024)} KB)${tail.unreadable > 0 ? `, ${tail.unreadable} unreadable lines` : ""}`);
  for (const event of tail.events) lines.push(`            ${describeEvent(event)}`);

  const recent = notes.notes.slice(-4);
  if (recent.length > 0) {
    lines.push("", "overseer   ");
    for (const note of recent) lines.push(`            ${note.at.slice(11, 19)}  ${describeNote(note)}`);
  }
  return lines;
}

function registerSummary(register: readonly RegisterEntry[]): string {
  const counts = new Map<string, number>();
  for (const entry of register) counts.set(entry.lastStatusKey, (counts.get(entry.lastStatusKey) ?? 0) + 1);
  const parts = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => `${count} ${key}`);
  return `sessions    ${register.length} in the register${parts.length > 0 ? `: ${parts.join(", ")}` : ""}`;
}

/**
 * Who has been waiting longest, which is the whole reason the store exists.
 *
 * `statusSince` is the duration attention triage ranks by — the thing the
 * dashboard cannot know, because it has no yesterday. `idle` is left out
 * deliberately: an idle session that has been idle for six hours wants nothing.
 */
function attentionLines(register: readonly RegisterEntry[], nowMs: number): string[] {
  const waiting = register
    .filter((entry) => entry.lastStatusKey !== "idle")
    .sort((a, b) => Date.parse(a.statusSince) - Date.parse(b.statusSince))
    .slice(0, 6);
  return waiting.map(
    (entry) =>
      `            ${entry.lastStatusKey.padEnd(10)} ${describeAge(nowMs - Date.parse(entry.statusSince)).padStart(6)}  ${entry.name} (${entry.tmuxId})`,
  );
}

function describeAge(ms: number): string {
  if (ms < 0) return "in the future";
  const seconds = Math.round(ms / 1000);
  if (seconds < 90) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}

const HELP = [
  "overseer — the fleet's history, and the daemon that records it",
  "",
  "  npx tsx scripts/overseer.ts run [--url URL] [--tick-ms N]",
  "  npx tsx scripts/overseer.ts status",
  "  npx tsx scripts/overseer.ts events [--limit N]",
  "  npx tsx scripts/overseer.ts notes [--limit N]",
  "",
  `The store is $OVERSEER_STORE_DIR, or ~/.overseer. The dashboard is ${DEFAULT_FLEET_URL} unless --url says otherwise.`,
].join("\n");

function flag(argv: readonly string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
}

async function main(argv: readonly string[]): Promise<number> {
  const command = argv[0] ?? "status";
  if (command === "--help" || command === "-h" || command === "help") {
    console.log(HELP);
    return 0;
  }
  const root = requireAbsoluteRoot(storeRoot());

  switch (command) {
    case "status":
      console.log(statusLines(root).join("\n"));
      return 0;
    case "events": {
      const tail = readEventTail(root, Number(flag(argv, "--limit") ?? 40));
      // "0 events" and "no store" are not the same sentence, and printing
      // nothing at all would be a third thing that looks like both.
      if (tail.total === 0) console.log(`no events in ${join(root, EVENTS_FILE)}`);
      for (const event of tail.events) console.log(describeEvent(event));
      if (tail.unreadable > 0) console.log(`(${tail.unreadable} unreadable lines)`);
      return 0;
    }
    case "notes": {
      const read = readNotes(root, Number(flag(argv, "--limit") ?? 40));
      if (read.notes.length === 0) console.log("the Overseer has written nothing about itself yet");
      for (const note of read.notes) console.log(`${note.at}  ${describeNote(note)}`);
      return 0;
    }
    case "run": {
      const controller = new AbortController();
      // SIGTERM is what systemd sends and SIGINT is what a person sends; both
      // must stop it the same way, so the stopping note is written and the lock
      // is released rather than left for the next start to puzzle over.
      for (const signal of ["SIGINT", "SIGTERM"] as const) {
        process.on(signal, () => {
          console.log(`${signal} — stopping`);
          controller.abort();
        });
      }
      const tickMs = flag(argv, "--tick-ms");
      const outcome = await runOverseer({
        root,
        baseUrl: flag(argv, "--url") ?? process.env["OVERSEER_FLEET_URL"] ?? DEFAULT_FLEET_URL,
        signal: controller.signal,
        // Absent rather than undefined: `exactOptionalPropertyTypes` tells those
        // apart, and absent is what "take the default" means.
        ...(tickMs === undefined ? {} : { tickMs: Number(tickMs) }),
      });
      switch (outcome.kind) {
        case "refused":
          console.error(`✗ ${describeRefusal(outcome.refusal)}`);
          return 1;
        case "lock-lost":
          console.error(`✗ another Overseer took the lock${outcome.holder === null ? "" : ` (pid ${outcome.holder.pid})`} — stopping rather than writing beside it`);
          return 1;
        case "stopped":
          console.log(`stopped: ${outcome.why}`);
          return 0;
        default: {
          const never: never = outcome;
          throw new Error(String(never));
        }
      }
    }
    default:
      console.error(`unknown command ${JSON.stringify(command)}\n\n${HELP}`);
      return 1;
  }
}

/** Imported by a test, or run. `gjd-remote.ts` calls main at import time and is untestable for it. */
function isMain(): boolean {
  const invoked = process.argv[1];
  return invoked !== undefined && invoked === fileURLToPath(import.meta.url);
}

if (isMain()) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((cause: unknown) => {
      console.error(`✗ ${cause instanceof Error ? cause.message : String(cause)}`);
      process.exitCode = 1;
    });
}
