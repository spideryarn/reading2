/**
 * **`overseer diagnose`** — one page that answers, for the two services that
 * carry the Overseer: what HEAD each recorded for its checkout when it started,
 * which checkpoint schema, how old is each clock, which boot, what does every
 * store file look like, and does the daemon hold the job list this checkout
 * builds. docs/plans/260910f § Stage 2.
 *
 * ## A report, not a gate
 *
 * Mismatches and unknowns are lines, never exit codes (plan § D4). The command
 * exits non-zero only when it cannot read the store root at all;
 * `scripts/fleet-restart.ts` is the gate.
 *
 * ## The one inference it refuses
 *
 * What a process is compared on is what it RECORDED when it started — the
 * `revision` on its `daemon-started` note (`tools/fleet/revision.ts`). It is
 * never read off this checkout's HEAD: on the box the primary moves under a
 * running service several times an hour. So a note without a stamp is
 * **not stamped**, a note from another instance does not stand in for the
 * running one's, a HEAD that cannot be read makes the comparison unknown.
 *
 * And even a stamp is a checkout observation, not a code identity (Sol's F1
 * on plan 260910f): no line here says the running code "is", "matches" or
 * "runs" a revision. A clean stamp is compared as *recorded start HEAD … matches
 * / is N commits behind / is not an ancestor of this checkout's HEAD*; a dirty
 * one is *code revision unknown*, with the sha only as a base.
 *
 * ## Reused, not re-derived
 *
 * The standing is `status-cli.ts`'s (`standingFromReads`), the job-list block
 * is `overseer status`'s (`schedulePreviewLines` with the list this checkout
 * builds, computed the way `status` computes it), file names and schemas come
 * from the constants their owners export, and the file probe is the fleet's
 * generic one, so the dashboard's diagnostics route can show the same rows.
 *
 * `diagnose` is pure over its input; `readDiagnoseInput` is the only I/O. Git is
 * injected, so the verdicts can be tested without a repository.
 */
import { spawnSync } from "node:child_process";
import { lstatSync, opendirSync, statSync, type Stats } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { DESCRIPTIONS_FILE, DESCRIPTIONS_SCHEMA } from "../fleet/describe-store.js";
import { GIT_TIMEOUT_MS, gitEnv } from "../fleet/readiness-git.js";
import { SCHEDULE_PREVIEW_FILE, SCHEDULE_PREVIEW_SCHEMA } from "../fleet/schedule-parse.js";
import { parseDiagnosticsSummary } from "../fleet/diagnostics-parse.js";
import { probeStoreFiles, type ProbeTarget, type StoreFileProbe } from "../fleet/store-probe.js";
import { LINE_SCHEMA as USAGE_LINE_SCHEMA } from "../fleet/usage-history-record.js";
import { PREV_FILE as USAGE_PREV_FILE, LIVE_FILE as USAGE_FILE } from "../fleet/usage-history.js";
import type { StartRevision } from "../fleet/wire.js";
import { ARMING_FILE } from "./arming.js";
import { ATTENTION_MEMORY_FILE, ATTENTION_MEMORY_SCHEMA } from "./attention-memory.js";
import { CLI_STATE_FILE, CLI_STATE_LOCK_FILE, CLI_STATE_SCHEMA } from "./cli-state.js";
import { BASELINE_FILE, readHostBootId } from "./daemon.js";
import { DECISIONS_FILE, DECISIONS_INIT_FILE, DECISIONS_LOCK_FILE, DECISIONS_SCHEMA, LEGACY_DECISIONS_SCHEMA } from "./decisions.js";
import { describeSince } from "./format-age.js";
import { IDEA_QUEUE_SCHEMA, QUEUE_FILE, QUEUE_INIT_FILE, QUEUE_LOCK_FILE } from "./idea-queue.js";
import { NOTES_FILE, readNotes, type ReadNotes } from "./notes.js";
import { RECOVERY_INBOX_DIR } from "./recovery-inbox.js";
import { INBOX_DIR, PROCESSING_DIR, QUARANTINE_DIR, REFUSED_DIR, REPORTS_FILE, REPORTS_INIT_FILE, REPORTS_SCHEMA } from "./reports.js";
import { ruleJobs } from "./rule-jobs.js";
import { listRevision, readSchedulePreviewFile, schedulePreviewLines, type BuiltList, type SchedulePreviewRead } from "./schedule-preview.js";
import { standingJobs } from "./standing-jobs.js";
import { newerStartThanCheckpoint, readPidIdentity, standingFromReads, type DaemonStanding, type PidReader } from "./status-cli.js";
import {
  CHECKPOINT_FILE,
  EVENTS_FILE,
  LOCK_FILE,
  RECONCILE_FILE,
  RECOVERY_FILE,
  RECOVERY_SCHEMA,
  STORE_SCHEMA,
  readCheckpoint,
  readRecoveryIndexFile,
  type CheckpointRead,
  type RecoveryFileReading,
} from "./store.js";

/* ------------------------------------------------------------------ *
 * The store's files, and the schema this build reads for each.
 * ------------------------------------------------------------------ */

/**
 * One name this build knows the store to hold: what it is, and how it is read.
 * `probe` names are opened under the fleet probe's contract — whose allow-list
 * must carry them — and their declared schema compared; `stat` names are only
 * `lstat`ed, never opened: the locks, the loss markers, the directories, and
 * the files the probe's allow-list does not carry. `known: null` is "this build
 * names no schema for it", rendered as such rather than as a match.
 */
type CatalogueEntry = {
  readonly target: ProbeTarget;
  readonly meaning: string;
  readonly read: "probe" | "stat";
  readonly known: readonly number[] | null;
  /**
   * A file that declares no schema and that its reader still accepts, as this
   * schema (Sol's F41). Per file, from the reader's own rule: an undeclared
   * schema is never a match anywhere else.
   */
  readonly legacyUndeclared?: number;
};

const lockFor = (file: string): string => `the writers' lock around ${file}`;
const markerFor = (file: string): string => `says ${file} once existed, so its loss is noticed rather than read as empty`;

/**
 * **The catalogue.** It is not the census: the census is the union of this and
 * what the directory actually holds (Sol's F42), so a name nobody catalogued
 * still gets a row. Of every reader of these files, only `cli-state.ts`
 * accepts a record with no schema (as schema 1); the others refuse one.
 */
const CATALOGUE: readonly CatalogueEntry[] = [
  { target: CHECKPOINT_FILE, meaning: "the daemon's checkpoint", read: "probe", known: [STORE_SCHEMA] },
  { target: RECOVERY_FILE, meaning: "the recovery index, and the boot it last recorded", read: "probe", known: [RECOVERY_SCHEMA] },
  { target: EVENTS_FILE, meaning: "the event log", read: "probe", known: null },
  { target: NOTES_FILE, meaning: "the daemon's notes", read: "probe", known: null },
  { target: SCHEDULE_PREVIEW_FILE, meaning: "the scheduler's preview", read: "probe", known: [SCHEDULE_PREVIEW_SCHEMA] },
  { target: ATTENTION_MEMORY_FILE, meaning: "the attention pass's memory", read: "probe", known: [ATTENTION_MEMORY_SCHEMA] },
  // Its envelope field is `lineSchema`, not `schema` (usage-history-record.ts).
  { target: { name: USAGE_FILE, schemaField: "lineSchema" }, meaning: "the usage history", read: "probe", known: [USAGE_LINE_SCHEMA] },
  { target: REPORTS_FILE, meaning: "the work reports", read: "probe", known: [REPORTS_SCHEMA] },
  // Schema 1 lines are still read exactly as written (decisions.ts).
  { target: DECISIONS_FILE, meaning: "the decision log", read: "probe", known: [DECISIONS_SCHEMA, LEGACY_DECISIONS_SCHEMA] },
  { target: QUEUE_FILE, meaning: "the idea queue", read: "probe", known: [IDEA_QUEUE_SCHEMA] },
  // `parseCliState` reads `schema ?? CLI_STATE_SCHEMA`: a file with none is the legacy format.
  { target: CLI_STATE_FILE, meaning: "the CLI's mine and paused lists", read: "probe", known: [CLI_STATE_SCHEMA], legacyUndeclared: CLI_STATE_SCHEMA },
  { target: DESCRIPTIONS_FILE, meaning: "the session descriptions", read: "probe", known: [DESCRIPTIONS_SCHEMA] },
  { target: BASELINE_FILE, meaning: "the last collection, the next start's baseline", read: "probe", known: null },
  { target: LOCK_FILE, meaning: "the daemon's lock", read: "probe", known: null },
  // Not on the fleet probe's allow-list, so listed and never opened.
  { target: ARMING_FILE, meaning: "when the scheduler was first armed", read: "stat", known: null },
  { target: RECONCILE_FILE, meaning: "a one-off reconcile of a lost occurrence ledger, consumed by the next start", read: "stat", known: null },
  { target: USAGE_PREV_FILE, meaning: "the previous usage history, rotated out", read: "stat", known: null },
  { target: CLI_STATE_LOCK_FILE, meaning: lockFor(CLI_STATE_FILE), read: "stat", known: null },
  { target: DECISIONS_LOCK_FILE, meaning: lockFor(DECISIONS_FILE), read: "stat", known: null },
  { target: QUEUE_LOCK_FILE, meaning: lockFor(QUEUE_FILE), read: "stat", known: null },
  { target: DECISIONS_INIT_FILE, meaning: markerFor(DECISIONS_FILE), read: "stat", known: null },
  { target: QUEUE_INIT_FILE, meaning: markerFor(QUEUE_FILE), read: "stat", known: null },
  { target: REPORTS_INIT_FILE, meaning: markerFor(REPORTS_FILE), read: "stat", known: null },
  { target: INBOX_DIR, meaning: "work reports waiting to be read", read: "stat", known: null },
  { target: PROCESSING_DIR, meaning: "work reports being read", read: "stat", known: null },
  { target: REFUSED_DIR, meaning: "work reports refused", read: "stat", known: null },
  { target: QUARANTINE_DIR, meaning: "inbox entries moved aside unread", read: "stat", known: null },
  { target: RECOVERY_INBOX_DIR, meaning: "recovery requests", read: "stat", known: null },
];

/** How many directory entries one reading lists before it stops and says so (Sol's F42). */
export const DIRECTORY_LISTING_CAP = 200;

const nameOf = (target: ProbeTarget): string => (typeof target === "string" ? target : target.name);

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

export type CheckoutHead = { kind: "known"; sha: string } | { kind: "unknown"; why: string };

/** How a recorded start sha relates to this checkout's HEAD. */
export type RevisionRelation =
  | { kind: "same" }
  /** The start sha is an ancestor of HEAD, and HEAD is `commits` ahead of it. */
  | { kind: "behind"; commits: number }
  | { kind: "not-ancestor" }
  | { kind: "unknown"; why: string };

/** The git this report may ask. Injected in tests; `checkoutGit` is the real one. */
export type GitReads = {
  head(): CheckoutHead;
  relate(startSha: string, headSha: string): RevisionRelation;
};

/**
 * The dashboard's own start stamp, from its `GET /api/diagnostics` (Stage 3).
 * `unreachable` is a connection that failed; `unusable` is a dashboard that was
 * reached and whose answer cannot be used — too slow, too large, non-2xx, or a
 * shape the fleet's parser refuses (Sol's F4). Each is one line of the report;
 * none stops the rest of it rendering.
 */
export type DashboardReading =
  | { kind: "not-asked"; why: string }
  | { kind: "unreachable"; why: string }
  | { kind: "unusable"; why: string }
  | { kind: "answered"; revision: StartRevision };

/** How long `diagnose` waits for the dashboard. A report waits on nobody for long. */
export const DASHBOARD_DIAGNOSTICS_TIMEOUT_MS = 5_000;
/** The largest answer read. The real one is a few KB; anything near this is not it. */
export const DASHBOARD_DIAGNOSTICS_MAX_BYTES = 256 * 1024;
/** A reason from the wire is bounded before it reaches a terminal. */
const DASHBOARD_REASON_MAX = 300;

const boundedReason = (why: string): string => (why.length <= DASHBOARD_REASON_MAX ? why : `${why.slice(0, DASHBOARD_REASON_MAX - 1)}…`);

class AnswerTooLarge extends Error {}

/** The body, read as a stream and abandoned the moment it passes `maxBytes` — never buffered whole first. */
async function boundedBody(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw new AnswerTooLarge();
  }
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new AnswerTooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function fetchFailure(cause: unknown): string {
  if (!(cause instanceof Error)) return String(cause);
  const inner = cause.cause instanceof Error ? `: ${cause.cause.message}` : "";
  return `${cause.message}${inner}`;
}

/**
 * Ask the dashboard for its diagnostics: one `GET`, a deadline, a body bound,
 * and the fleet's own parser (`tools/fleet/diagnostics-parse.ts`, the one the
 * page uses). **Never throws**: every failure is a reading with its reason.
 */
export async function readDashboardDiagnostics(
  fleetUrl: string,
  deps: { fetch?: typeof fetch; timeoutMs?: number; maxBytes?: number } = {},
): Promise<DashboardReading> {
  const fetchImpl = deps.fetch ?? fetch;
  const timeoutMs = deps.timeoutMs ?? DASHBOARD_DIAGNOSTICS_TIMEOUT_MS;
  const maxBytes = deps.maxBytes ?? DASHBOARD_DIAGNOSTICS_MAX_BYTES;
  const unusable = (why: string): DashboardReading => ({ kind: "unusable", why: boundedReason(why) });
  let url: URL;
  try {
    url = new URL("/api/diagnostics", fleetUrl);
  } catch {
    return unusable(`${fleetUrl} is not a URL`);
  }
  const signal = AbortSignal.timeout(timeoutMs);
  const late = (): DashboardReading => unusable(`no answer within ${timeoutMs / 1000}s from ${url.origin}`);
  let response: Response;
  try {
    response = await fetchImpl(url, { signal, headers: { accept: "application/json" } });
  } catch (cause) {
    if (signal.aborted) return late();
    return { kind: "unreachable", why: boundedReason(`${url.origin}: ${fetchFailure(cause)}`) };
  }
  let text: string;
  try {
    text = await boundedBody(response, maxBytes);
  } catch (cause) {
    if (cause instanceof AnswerTooLarge) return unusable(`the answer is larger than ${maxBytes / 1024} KB`);
    if (signal.aborted) return late();
    return unusable(`the answer could not be read: ${fetchFailure(cause)}`);
  }
  let body: unknown;
  let json = true;
  try {
    body = JSON.parse(text);
  } catch {
    json = false;
  }
  const parsed = json ? parseDiagnosticsSummary(body) : null;
  if (!response.ok) {
    return unusable(`the dashboard answered ${response.status}${parsed?.kind === "unreadable" ? ` — ${parsed.why}` : ""}`);
  }
  if (parsed === null) return unusable("the answer is not JSON");
  if (parsed.kind === "unreadable") return unusable(parsed.why);
  return { kind: "answered", revision: parsed.summary.dashboard.start };
}

/**
 * A service's recorded start HEAD against this checkout's. `compared` carries
 * `dirty` beside the relation, and the renderer turns a dirty start into
 * "code revision unknown" whatever the relation.
 */
export type RevisionVerdict =
  | { kind: "compared"; sha: string; dirty: boolean; relation: RevisionRelation }
  | { kind: "not-stamped"; why: string }
  | { kind: "unknown"; why: string };

/** The `daemon-started` note of the instance the checkpoint names, or why there is none. */
export type StartNote =
  | { kind: "no-running-instance"; why: string }
  | { kind: "notes-unreadable"; why: string }
  | { kind: "no-start-note"; instanceId: string }
  | { kind: "not-stamped"; instanceId: string; at: string }
  | { kind: "stamped"; instanceId: string; at: string; revision: StartRevision };

export type CheckpointSection =
  | { kind: "absent" }
  | {
      kind: "unusable";
      why: string;
      detail: string;
      /** What the file itself declares, from the probe — so "schema 99" is not lost inside "malformed". */
      declaredSchema: number | null | "none-declared" | "not-probed";
    }
  | {
      kind: "checkpoint";
      schema: number;
      writtenAt: string;
      writtenAgeMs: number;
      lastGoodSnapshotAt: string | null;
      lastGoodAgeMs: number | null;
      lastTickAt: string | null;
      lastTickAgeMs: number | null;
    };

export type BootSection =
  | { kind: "same"; bootId: string }
  /**
   * `recovery.json` names another boot than the host's. It is advanced only
   * after an accepted collection, so this says nothing about whether the daemon
   * has run since the reboot (Sol's F44).
   */
  | { kind: "different"; recorded: string; host: string }
  | { kind: "unknown"; why: string };

export type EntryType = "file" | "directory" | "symbolic link" | "FIFO" | "socket" | "device" | "other";

/** An `lstat` of one directory entry: never opened, never followed. */
export type EntryStat =
  | { state: "absent" }
  | { state: "unreadable"; why: string }
  | { state: "present"; type: EntryType; bytes: number; mtimeAgeMs: number };

export type FileMatch = "matches" | "legacy" | "mismatch" | "no-known-schema" | "cannot-tell" | "not-applicable";

export type FileRow =
  | {
      kind: "probed";
      name: string;
      meaning: string;
      probe: StoreFileProbe;
      /** The schema(s) this build reads for the file, or null when it names none. */
      known: readonly number[] | null;
      /** The schema an undeclared file is accepted as, where its reader accepts one; else null. */
      legacySchema: number | null;
      match: FileMatch;
    }
  /** Only `lstat`ed. `meaning: null` is a name this build's catalogue does not hold. */
  | { kind: "stat"; name: string; meaning: string | null; stat: EntryStat };

/** The store directory's own entries, as far as one bounded listing went. */
export type StoreListing = { names: readonly string[]; truncated: boolean };

export type DiagnoseReport = {
  root: string;
  generatedAt: string;
  checkout: { path: string; head: CheckoutHead };
  daemon: {
    standing: DaemonStanding;
    instanceId: string | null;
    pid: number | null;
    startedAt: string | null;
    start: StartNote;
    verdict: RevisionVerdict;
    /**
     * A start newer than the checkpoint's instance, which wrote no checkpoint
     * (`newerStartThanCheckpoint`). Shown on its own line with its own start
     * HEAD, so the checkpoint's instance never stands in for it.
     */
    newerStart: { instanceId: string; at: string; verdict: RevisionVerdict } | null;
  };
  dashboard: { reading: DashboardReading; verdict: RevisionVerdict | null };
  checkpoint: CheckpointSection;
  boot: BootSection;
  files: FileRow[];
  /** Whether the directory listing stopped at the cap, so some entries have no row. */
  listing: { truncated: boolean; cap: number };
  /** `overseer status`'s schedule block, as data: what the daemon previews, and the list this checkout builds. */
  jobs: { built: BuiltList; runningInstanceId: string | null; preview: SchedulePreviewRead };
};

export type DiagnoseInput = {
  root: string;
  nowMs: number;
  checkoutPath: string;
  head: CheckoutHead;
  relate: GitReads["relate"];
  checkpoint: CheckpointRead;
  notes: ReadNotes;
  identify: PidReader;
  recovery: RecoveryFileReading;
  hostBootId: string | null;
  /** The catalogue's `probe` names, opened under the fleet probe's contract. */
  probes: StoreFileProbe[];
  /** The catalogue's `stat` names and every listed name the catalogue does not hold. */
  stats: readonly { name: string; stat: EntryStat }[];
  listing: StoreListing;
  schedule: SchedulePreviewRead;
  builtList: BuiltList;
  dashboard: DashboardReading;
};

/* ------------------------------------------------------------------ *
 * The pure half
 * ------------------------------------------------------------------ */

export function diagnose(input: DiagnoseInput): DiagnoseReport {
  const { checkpoint: read, nowMs } = input;
  const checkpoint = read.kind === "checkpoint" ? read.checkpoint : null;
  const start = startNoteOf(read, input.notes);
  const files = fileRows(input);
  const probeOfCheckpoint = input.probes.find((probe) => probe.name === CHECKPOINT_FILE);
  const ageOf = (iso: string | null): number | null => (iso === null ? null : nowMs - Date.parse(iso));
  const newer = input.notes.kind === "read" ? newerStartThanCheckpoint(checkpoint, input.notes.notes) : null;

  return {
    root: input.root,
    generatedAt: new Date(nowMs).toISOString(),
    checkout: { path: input.checkoutPath, head: input.head },
    daemon: {
      standing: standingFromReads(read, input.notes, nowMs, input.identify),
      instanceId: checkpoint?.heartbeat.instanceId ?? null,
      pid: checkpoint?.heartbeat.pid ?? null,
      startedAt: checkpoint?.heartbeat.startedAt ?? null,
      start,
      verdict: daemonVerdict(start, input),
      newerStart:
        newer === null
          ? null
          : {
              instanceId: newer.instanceId,
              at: newer.at,
              verdict:
                newer.revision === undefined ? { kind: "not-stamped", why: "started before revision stamps existed" } : revisionVerdict(newer.revision, input),
            },
    },
    dashboard: {
      reading: input.dashboard,
      verdict: input.dashboard.kind === "answered" ? revisionVerdict(input.dashboard.revision, input) : null,
    },
    checkpoint:
      read.kind === "absent"
        ? { kind: "absent" }
        : read.kind === "unusable"
          ? {
              kind: "unusable",
              why: read.why,
              detail: read.detail,
              declaredSchema: probeOfCheckpoint?.state === "present" ? probeOfCheckpoint.schema : "not-probed",
            }
          : {
              kind: "checkpoint",
              schema: read.checkpoint.schema,
              writtenAt: read.checkpoint.writtenAt,
              writtenAgeMs: nowMs - Date.parse(read.checkpoint.writtenAt),
              lastGoodSnapshotAt: read.checkpoint.lastGoodSnapshotAt,
              lastGoodAgeMs: ageOf(read.checkpoint.lastGoodSnapshotAt),
              lastTickAt: read.checkpoint.heartbeat.lastTickAt,
              lastTickAgeMs: ageOf(read.checkpoint.heartbeat.lastTickAt),
            },
    boot: bootOf(input.recovery, input.hostBootId),
    files,
    listing: { truncated: input.listing.truncated, cap: DIRECTORY_LISTING_CAP },
    jobs: { built: input.builtList, runningInstanceId: checkpoint?.heartbeat.instanceId ?? null, preview: input.schedule },
  };
}

/** The LAST `daemon-started` whose instance is the one the checkpoint names — never any other instance's. */
function startNoteOf(read: CheckpointRead, notes: ReadNotes): StartNote {
  if (read.kind !== "checkpoint") {
    return {
      kind: "no-running-instance",
      why: read.kind === "absent" ? "there is no checkpoint, so no instance is named" : "the checkpoint cannot be parsed, so it names no instance",
    };
  }
  const instanceId = read.checkpoint.heartbeat.instanceId;
  if (notes.kind === "unreadable") return { kind: "notes-unreadable", why: notes.cause };
  for (let i = notes.notes.length - 1; i >= 0; i -= 1) {
    const note = notes.notes[i];
    if (note?.kind !== "daemon-started" || note.instanceId !== instanceId) continue;
    return note.revision === undefined
      ? { kind: "not-stamped", instanceId, at: note.at }
      : { kind: "stamped", instanceId, at: note.at, revision: note.revision };
  }
  return { kind: "no-start-note", instanceId };
}

function daemonVerdict(start: StartNote, input: DiagnoseInput): RevisionVerdict {
  switch (start.kind) {
    case "stamped":
      return revisionVerdict(start.revision, input);
    case "not-stamped":
      return { kind: "not-stamped", why: "started before revision stamps existed" };
    case "no-start-note":
      return { kind: "unknown", why: `no start note for the running instance ${start.instanceId}` };
    case "notes-unreadable":
      return { kind: "unknown", why: `the daemon's notes could not be read (${start.why})` };
    case "no-running-instance":
      return { kind: "unknown", why: start.why };
    default: {
      const never: never = start;
      throw new Error(`no verdict for ${JSON.stringify(never)}`);
    }
  }
}

function revisionVerdict(revision: StartRevision, input: DiagnoseInput): RevisionVerdict {
  if (revision.kind === "unknown") return { kind: "unknown", why: revision.why };
  const relation: RevisionRelation =
    input.head.kind === "unknown" ? { kind: "unknown", why: `this checkout's HEAD cannot be read: ${input.head.why}` } : input.relate(revision.sha, input.head.sha);
  return { kind: "compared", sha: revision.sha, dirty: revision.dirty, relation };
}

function bootOf(recovery: RecoveryFileReading, host: string | null): BootSection {
  let recorded: string;
  switch (recovery.kind) {
    case "absent":
      return { kind: "unknown", why: `there is no ${RECOVERY_FILE}, so no boot has been recorded` };
    case "unusable":
      return { kind: "unknown", why: `${RECOVERY_FILE} cannot be read by this build (${recovery.why})` };
    case "file":
      if (recovery.index.bootId === null) return { kind: "unknown", why: `${RECOVERY_FILE} records no boot yet` };
      recorded = recovery.index.bootId;
      break;
    default: {
      const never: never = recovery;
      throw new Error(`no boot for ${JSON.stringify(never)}`);
    }
  }
  if (host === null) return { kind: "unknown", why: "this host's boot id cannot be read" };
  return recorded === host ? { kind: "same", bootId: host } : { kind: "different", recorded, host };
}

/** The catalogue's rows in its order, then a row for every listed name it does not hold. */
function fileRows(input: DiagnoseInput): FileRow[] {
  const probes = new Map(input.probes.map((probe) => [probe.name, probe]));
  const stats = new Map(input.stats.map((entry) => [entry.name, entry.stat]));
  const statOf = (name: string): EntryStat => stats.get(name) ?? { state: "unreadable", why: "this reading did not look at it" };
  const rows: FileRow[] = CATALOGUE.map((entry): FileRow => {
    const name = nameOf(entry.target);
    if (entry.read === "stat") return { kind: "stat", name, meaning: entry.meaning, stat: statOf(name) };
    const probe: StoreFileProbe = probes.get(name) ?? { name, state: "unreadable", why: "this reading did not probe it" };
    return { kind: "probed", name, meaning: entry.meaning, probe, known: entry.known, legacySchema: entry.legacyUndeclared ?? null, match: matchOf(probe, entry) };
  });
  const catalogued = new Set(CATALOGUE.map((entry) => nameOf(entry.target)));
  for (const name of input.listing.names) if (!catalogued.has(name)) rows.push({ kind: "stat", name, meaning: null, stat: statOf(name) });
  return rows;
}

function matchOf(probe: StoreFileProbe, entry: CatalogueEntry): FileMatch {
  if (probe.state !== "present") return "not-applicable";
  if (entry.known === null) return "no-known-schema";
  if (probe.schema === null) return "cannot-tell";
  // Undeclared matches only where that file's reader accepts it (Sol's F41) — never globally.
  if (probe.schema === "none-declared") return entry.legacyUndeclared === undefined ? "mismatch" : "legacy";
  return entry.known.includes(probe.schema) ? "matches" : "mismatch";
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

const LABEL = 12;
const INDENT = " ".repeat(LABEL);
const labelled = (label: string, text: string): string => `${label.padEnd(LABEL)}${text}`;

/**
 * A verdict in words that claim only what was recorded: a checkout's HEAD at
 * start, never the code the process loaded (Sol's F1 on plan 260910f).
 */
export function verdictText(verdict: RevisionVerdict): string {
  switch (verdict.kind) {
    case "not-stamped":
      return `not stamped (${verdict.why})`;
    case "unknown":
      return `unknown: ${verdict.why}`;
    case "compared": {
      const sha = verdict.sha.slice(0, 8);
      // A dirty start held edits no commit has, so its sha is only a base, whatever it relates to.
      if (verdict.dirty) return `code revision unknown — base HEAD ${sha}, checkout dirty at start`;
      const recorded = `recorded start HEAD ${sha}`;
      const relation = verdict.relation;
      switch (relation.kind) {
        case "same":
          return `${recorded} matches this checkout's HEAD`;
        case "behind":
          return `${recorded} is ${relation.commits} ${relation.commits === 1 ? "commit" : "commits"} behind this checkout's HEAD`;
        case "not-ancestor":
          return `${recorded} is not an ancestor of this checkout's HEAD`;
        case "unknown":
          return `${recorded}; its relation to this checkout's HEAD is unknown: ${relation.why}`;
        default: {
          const never: never = relation;
          throw new Error(`no text for ${JSON.stringify(never)}`);
        }
      }
    }
    default: {
      const never: never = verdict;
      throw new Error(`no text for ${JSON.stringify(never)}`);
    }
  }
}

function dashboardText(dashboard: DiagnoseReport["dashboard"]): string {
  switch (dashboard.reading.kind) {
    case "not-asked":
      return `not asked (${dashboard.reading.why})`;
    case "unreachable":
      return `unreachable: ${dashboard.reading.why}`;
    case "unusable":
      return `dashboard diagnostics unusable — ${dashboard.reading.why}`;
    case "answered":
      return dashboard.verdict === null ? "answered, and not compared" : verdictText(dashboard.verdict);
    default: {
      const never: never = dashboard.reading;
      throw new Error(`no text for ${JSON.stringify(never)}`);
    }
  }
}

const at = (iso: string, ageMs: number): string => `${iso} (${describeSince(ageMs, "ago")})`;

function checkpointLines(section: CheckpointSection): string[] {
  switch (section.kind) {
    case "absent":
      return [labelled("checkpoint", `absent — no daemon has written ${CHECKPOINT_FILE} to this store`)];
    case "unusable": {
      const declared =
        typeof section.declaredSchema === "number"
          ? `the file declares schema ${section.declaredSchema}`
          : section.declaredSchema === "none-declared"
            ? "the file declares no schema"
            : "what schema the file declares could not be read";
      return [
        labelled("checkpoint", `UNUSABLE — there IS a ${CHECKPOINT_FILE} and this build, which reads schema ${STORE_SCHEMA}, cannot parse it (${section.why}: ${section.detail})`),
        `${INDENT}${declared}; its clocks are inside it, so none is shown`,
      ];
    }
    case "checkpoint":
      return [
        labelled("checkpoint", `schema ${section.schema} (this build reads ${STORE_SCHEMA}), written ${at(section.writtenAt, section.writtenAgeMs)}`),
        `${INDENT}${
          section.lastGoodSnapshotAt === null || section.lastGoodAgeMs === null
            ? "last good snapshot: never — the dashboard has not given this daemon a collection"
            : `last good snapshot ${section.lastGoodSnapshotAt} (${describeSince(section.lastGoodAgeMs, "old")})`
        }`,
        `${INDENT}${
          section.lastTickAt === null || section.lastTickAgeMs === null ? "last tick: none yet" : `last tick ${at(section.lastTickAt, section.lastTickAgeMs)}`
        }`,
      ];
    default: {
      const never: never = section;
      throw new Error(`no lines for ${JSON.stringify(never)}`);
    }
  }
}

function bootText(boot: BootSection): string {
  switch (boot.kind) {
    case "same":
      return `same boot as ${RECOVERY_FILE} records (${boot.bootId})`;
    case "different":
      return (
        `DIFFERENT — ${RECOVERY_FILE} records boot ${boot.recorded}, the host is on ${boot.host}: ` +
        `${RECOVERY_FILE} has not yet recorded the current boot (it updates only after an accepted collection)`
      );
    case "unknown":
      return `unknown — ${boot.why}`;
    default: {
      const never: never = boot;
      throw new Error(`no text for ${JSON.stringify(never)}`);
    }
  }
}

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const ageColumn = (ageMs: number): string => describeSince(ageMs, "old").padStart(8);

function fileLine(row: FileRow, width: number): string {
  const name = `  ${row.name.padEnd(width)}  `;
  return `${name}${row.kind === "probed" ? probedText(row) : statText(row)}`;
}

/** A row that was only `lstat`ed: its type, size and age, and what it is — or that nothing here knows. */
function statText(row: Extract<FileRow, { kind: "stat" }>): string {
  const stat = row.stat;
  if (stat.state === "absent") return "absent";
  if (stat.state === "unreadable") return `UNREADABLE — ${stat.why}`;
  const column = stat.type === "file" ? size(stat.bytes) : stat.type;
  const what = row.meaning === null ? "not in this build's catalogue: no known schema" : row.meaning;
  return `${column.padStart(9)}  ${ageColumn(stat.mtimeAgeMs)}  ${what} — listed, never opened`;
}

function probedText(row: Extract<FileRow, { kind: "probed" }>): string {
  const probe = row.probe;
  if (probe.state === "absent") return "absent";
  if (probe.state === "unreadable") return `UNREADABLE — ${probe.why}`;
  const reads = row.known === null ? "" : row.known.join(" or ");
  const declared = probe.schema === null ? "schema unreadable" : probe.schema === "none-declared" ? "no schema declared" : `schema ${probe.schema}`;
  let schema: string;
  switch (row.match) {
    case "matches":
      schema = declared;
      break;
    case "legacy":
      schema = `${declared}; accepted as legacy schema ${row.legacySchema ?? "?"}`;
      break;
    case "mismatch":
      schema = `${declared} ✗ MISMATCH — this build reads ${reads}`;
      break;
    case "cannot-tell":
      schema = `${declared} (this build reads ${reads})`;
      break;
    case "no-known-schema":
      schema = probe.format === "other" ? "not a record file" : `${declared} (no known schema)`;
      break;
    case "not-applicable":
      schema = declared;
      break;
    default: {
      const never: never = row.match;
      throw new Error(`no text for ${JSON.stringify(never)}`);
    }
  }
  const torn = probe.tornTail === true ? "  TORN TAIL — the last line has no newline (a write in progress, or one that died)" : "";
  const last = probe.lastLineAt === undefined ? "" : `, last line ${probe.lastLineAt}`;
  return `${size(probe.bytes).padStart(9)}  ${ageColumn(probe.mtimeAgeMs)}  ${schema}${last}${torn}`;
}

export function diagnoseLines(report: DiagnoseReport): string[] {
  const nowMs = Date.parse(report.generatedAt);
  const head = report.checkout.head.kind === "known" ? `HEAD ${report.checkout.head.sha}` : `HEAD unknown — ${report.checkout.head.why}`;
  const daemon = report.daemon;
  const lines: string[] = [`Overseer store: ${report.root}`, `This checkout: ${report.checkout.path}, ${head}`, ""];

  lines.push(labelled("daemon", `${daemon.standing.state.toUpperCase().replaceAll("-", " ")} — ${daemon.standing.detail}`));
  lines.push(
    labelled(
      "instance",
      daemon.instanceId === null
        ? "none named — there is no readable checkpoint"
        : `${daemon.instanceId}, pid ${daemon.pid ?? "?"}, started ${daemon.startedAt ?? "?"}${daemon.newerStart === null ? "" : " — the checkpoint's instance, not the newest"}`,
    ),
  );
  if (daemon.newerStart !== null) {
    lines.push(`${INDENT}newest start: ${daemon.newerStart.instanceId} at ${daemon.newerStart.at}, which wrote no checkpoint; ${verdictText(daemon.newerStart.verdict)}`);
  }
  lines.push(labelled("revision", `daemon${daemon.newerStart === null ? "" : " (the checkpoint's instance)"}: ${verdictText(daemon.verdict)}`));
  lines.push(`${INDENT}dashboard: ${dashboardText(report.dashboard)}`);
  lines.push(`${INDENT}(a start HEAD is what the process's checkout was at when it started — never read off this checkout now, and not proof of the code it loaded)`);
  lines.push("");

  lines.push(...checkpointLines(report.checkpoint));
  lines.push(labelled("boot", bootText(report.boot)));
  lines.push("");

  lines.push("store files — this build's catalogue, and every other entry in the directory");
  if (report.listing.truncated) {
    lines.push(`  (only the first ${report.listing.cap} directory entries were listed; the directory holds more, and any past them that the catalogue does not name has no row)`);
  }
  const width = Math.max(...report.files.map((row) => row.name.length));
  for (const row of report.files) lines.push(fileLine(row, width));
  lines.push("");

  lines.push(...schedulePreviewLines(report.jobs.preview, { built: report.jobs.built, runningInstanceId: report.jobs.runningInstanceId }, nowMs));
  return lines;
}

/* ------------------------------------------------------------------ *
 * The I/O half
 * ------------------------------------------------------------------ */

const SHA = /^[0-9a-f]{40}$/;

/** The real git, over `checkout`: bounded, never prompts, `GIT_DIR`-style redirects removed. */
export function checkoutGit(checkout: string): GitReads {
  const git = (args: string[]): { ok: true; out: string } | { ok: false; status: number | null; why: string } => {
    const result = spawnSync("git", ["-C", checkout, ...args], { encoding: "utf8", timeout: GIT_TIMEOUT_MS, maxBuffer: 1024 * 1024, env: gitEnv() });
    if (result.error) return { ok: false, status: null, why: `git ${args[0]} could not run: ${result.error.message}` };
    if (result.status !== 0) {
      const stderr = (result.stderr ?? "").trim().split("\n")[0] ?? "";
      return { ok: false, status: result.status, why: `git ${args[0]} exited ${result.status}${stderr === "" ? "" : `: ${stderr}`}` };
    }
    return { ok: true, out: (result.stdout ?? "").trim() };
  };
  return {
    head() {
      const read = git(["rev-parse", "HEAD"]);
      if (!read.ok) return { kind: "unknown", why: read.why };
      return SHA.test(read.out) ? { kind: "known", sha: read.out } : { kind: "unknown", why: `git rev-parse HEAD printed something that is not a sha` };
    },
    relate(startSha, headSha) {
      if (!SHA.test(startSha) || !SHA.test(headSha)) return { kind: "unknown", why: "a recorded revision is not a full sha" };
      if (startSha === headSha) return { kind: "same" };
      const ancestor = git(["merge-base", "--is-ancestor", startSha, headSha]);
      // Exit 1 is an ANSWER here; anything else (128: no such commit) is not.
      if (!ancestor.ok && ancestor.status === 1) return { kind: "not-ancestor" };
      if (!ancestor.ok) return { kind: "unknown", why: `${ancestor.why} (the start sha may not be in this checkout)` };
      const count = git(["rev-list", "--count", `${startSha}..${headSha}`]);
      const commits = count.ok ? Number(count.out) : Number.NaN;
      return Number.isInteger(commits) ? { kind: "behind", commits } : { kind: "unknown", why: count.ok ? "git rev-list printed no count" : count.why };
    },
  };
}

export type DiagnoseDeps = {
  now?: () => Date;
  /** Who holds a pid, and when it started. `readPidIdentity`, off `/proc`, by default. */
  identify?: PidReader;
  hostBootId?: () => string | null;
  /** The checkout whose HEAD and job list are compared. Defaults to the one this module sits in. */
  checkout?: string;
  git?: GitReads;
  /** The job list this checkout builds, as `overseer status` computes it (`checkoutJobList`). Injected in tests. */
  builtList?: () => BuiltList;
  dashboard?: DashboardReading;
};

/**
 * Every read the report needs, lock-free and read-only. `ok: false` only when
 * the store root itself cannot be read — the one case the command exits 1.
 */
/**
 * The job list `checkout` builds, as the daemon's `schedulerWiring` builds it —
 * or, when either builder reports a problem, no revision at all (Sol's F40).
 * `overseer status` and `overseer diagnose` both come through here.
 */
export function checkoutJobList(checkout: string): BuiltList {
  try {
    const standing = standingJobs(checkout);
    const rules = ruleJobs(checkout);
    const problems = [...standing.problems, ...rules.problems];
    if (problems.length > 0) return { kind: "unbuildable", problems };
    return { kind: "built", listRevision: listRevision([...standing.jobs, ...rules.jobs]) };
  } catch (cause) {
    return { kind: "unbuildable", problems: [`building it threw: ${describeCause(cause)}`] };
  }
}

const describeCause = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

/** At most {@link DIRECTORY_LISTING_CAP} names of the store directory, and whether there were more. */
function listStore(root: string): { ok: true; listing: StoreListing } | { ok: false; why: string } {
  let dir: ReturnType<typeof opendirSync>;
  try {
    dir = opendirSync(root);
  } catch (cause) {
    return { ok: false, why: describeCause(cause) };
  }
  const names: string[] = [];
  let truncated = false;
  try {
    for (let entry = dir.readSync(); entry !== null; entry = dir.readSync()) {
      if (names.length === DIRECTORY_LISTING_CAP) {
        truncated = true;
        break;
      }
      names.push(entry.name);
    }
  } catch (cause) {
    return { ok: false, why: describeCause(cause) };
  } finally {
    dir.closeSync();
  }
  return { ok: true, listing: { names: names.sort(), truncated } };
}

function entryType(stat: Stats): EntryType {
  if (stat.isFile()) return "file";
  if (stat.isDirectory()) return "directory";
  if (stat.isSymbolicLink()) return "symbolic link";
  if (stat.isFIFO()) return "FIFO";
  if (stat.isSocket()) return "socket";
  if (stat.isCharacterDevice() || stat.isBlockDevice()) return "device";
  return "other";
}

/** One entry's `lstat`: nothing is opened, and a symbolic link is described, not followed. */
function statEntry(root: string, name: string, nowMs: number): EntryStat {
  let stat: Stats;
  try {
    stat = lstatSync(join(root, name));
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return { state: "absent" };
    return { state: "unreadable", why: describeCause(cause) };
  }
  return { state: "present", type: entryType(stat), bytes: stat.size, mtimeAgeMs: nowMs - Math.round(stat.mtimeMs) };
}

export function readDiagnoseInput(root: string, deps: DiagnoseDeps = {}): { ok: true; input: DiagnoseInput } | { ok: false; why: string } {
  try {
    if (!statSync(root).isDirectory()) return { ok: false, why: `the store root ${root} is not a directory` };
  } catch (cause) {
    return { ok: false, why: `the store root ${root} cannot be read: ${describeCause(cause)}` };
  }
  const listed = listStore(root);
  if (!listed.ok) return { ok: false, why: `the store root ${root} cannot be read: ${listed.why}` };
  const now = (deps.now ?? (() => new Date()))();
  const checkoutPath = deps.checkout ?? fileURLToPath(new URL("../..", import.meta.url));
  const git = deps.git ?? checkoutGit(checkoutPath);
  let builtList: BuiltList;
  try {
    builtList = (deps.builtList ?? (() => checkoutJobList(checkoutPath)))();
  } catch (cause) {
    builtList = { kind: "unbuildable", problems: [`building it threw: ${describeCause(cause)}`] };
  }
  const catalogued = new Set(CATALOGUE.map((entry) => nameOf(entry.target)));
  const statNames = [
    ...CATALOGUE.filter((entry) => entry.read === "stat").map((entry) => nameOf(entry.target)),
    ...listed.listing.names.filter((name) => !catalogued.has(name)),
  ];
  return {
    ok: true,
    input: {
      root,
      nowMs: now.getTime(),
      checkoutPath,
      head: git.head(),
      relate: (start, head) => git.relate(start, head),
      checkpoint: readCheckpoint(root),
      notes: readNotes(root),
      identify: deps.identify ?? ((pid) => readPidIdentity(pid)),
      recovery: readRecoveryIndexFile(root),
      hostBootId: (deps.hostBootId ?? readHostBootId)(),
      probes: probeStoreFiles(
        root,
        CATALOGUE.filter((entry) => entry.read === "probe").map((entry) => entry.target),
        now,
      ),
      stats: statNames.map((name) => ({ name, stat: statEntry(root, name, now.getTime()) })),
      listing: listed.listing,
      schedule: readSchedulePreviewFile(root),
      builtList,
      dashboard: deps.dashboard ?? { kind: "not-asked", why: "this caller did not ask the dashboard" },
    },
  };
}
