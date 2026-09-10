/**
 * **`overseer diagnose`** — one page that answers, for the two services that
 * carry the Overseer: which revision is each running, which checkpoint schema,
 * how old is each clock, which boot, what does every store file look like, and
 * does the daemon hold the job list this checkout builds.
 * docs/plans/260910f § Stage 2.
 *
 * ## A report, not a gate
 *
 * Mismatches and unknowns are lines, never exit codes (plan § D4). The command
 * exits non-zero only when it cannot read the store root at all;
 * `scripts/fleet-restart.ts` is the gate.
 *
 * ## The one inference it refuses
 *
 * A running process's revision is what it RECORDED when it started — the
 * `revision` on its `daemon-started` note (`tools/fleet/revision.ts`). It is
 * never read off this checkout's HEAD: on the box the primary moves under a
 * running service several times an hour. So a note without a stamp is
 * **not stamped**, a note from another instance does not stand in for the
 * running one's, a HEAD that cannot be read makes the comparison unknown, and
 * a start that was dirty is never "same" even when its sha is HEAD — the sha
 * does not name code nobody committed.
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
import { readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { DESCRIPTIONS_FILE, DESCRIPTIONS_SCHEMA } from "../fleet/describe-store.js";
import { GIT_TIMEOUT_MS, gitEnv } from "../fleet/readiness-git.js";
import { SCHEDULE_PREVIEW_FILE, SCHEDULE_PREVIEW_SCHEMA } from "../fleet/schedule-parse.js";
import { probeStoreFiles, type ProbeTarget, type StoreFileProbe } from "../fleet/store-probe.js";
import { LINE_SCHEMA as USAGE_LINE_SCHEMA } from "../fleet/usage-history-record.js";
import { LIVE_FILE as USAGE_FILE } from "../fleet/usage-history.js";
import type { StartRevision } from "../fleet/wire.js";
import { ATTENTION_MEMORY_FILE, ATTENTION_MEMORY_SCHEMA } from "./attention-memory.js";
import { CLI_STATE_FILE, CLI_STATE_SCHEMA } from "./cli-state.js";
import { BASELINE_FILE, readHostBootId } from "./daemon.js";
import { DECISIONS_FILE, DECISIONS_SCHEMA, LEGACY_DECISIONS_SCHEMA } from "./decisions.js";
import { describeAge } from "./format-age.js";
import { IDEA_QUEUE_SCHEMA, QUEUE_FILE } from "./idea-queue.js";
import { NOTES_FILE, readNotes, type ReadNotes } from "./notes.js";
import { REPORTS_FILE, REPORTS_SCHEMA } from "./reports.js";
import { ruleJobs } from "./rule-jobs.js";
import { listRevision, readSchedulePreviewFile, schedulePreviewLines, type SchedulePreviewRead } from "./schedule-preview.js";
import { standingJobs } from "./standing-jobs.js";
import { standingFromReads, type DaemonStanding } from "./status-cli.js";
import {
  CHECKPOINT_FILE,
  EVENTS_FILE,
  LOCK_FILE,
  RECOVERY_FILE,
  RECOVERY_SCHEMA,
  STORE_SCHEMA,
  isProcessAlive,
  readCheckpoint,
  readRecoveryIndexFile,
  type CheckpointRead,
  type RecoveryFileReading,
} from "./store.js";

/* ------------------------------------------------------------------ *
 * The store's files, and the schema this build reads for each.
 * ------------------------------------------------------------------ */

/**
 * Every file the Overseer's store holds, with the schema(s) this build reads
 * where the file's owner exports one. `null` is "this build names no schema for
 * it" — the event log, the notes, the lock and the baseline carry none as a
 * constant — and is rendered as such rather than as a match.
 */
const STORE_FILES: readonly { target: ProbeTarget; known: readonly number[] | null }[] = [
  { target: CHECKPOINT_FILE, known: [STORE_SCHEMA] },
  { target: RECOVERY_FILE, known: [RECOVERY_SCHEMA] },
  { target: EVENTS_FILE, known: null },
  { target: NOTES_FILE, known: null },
  { target: SCHEDULE_PREVIEW_FILE, known: [SCHEDULE_PREVIEW_SCHEMA] },
  { target: ATTENTION_MEMORY_FILE, known: [ATTENTION_MEMORY_SCHEMA] },
  // Its envelope field is `lineSchema`, not `schema` (usage-history-record.ts).
  { target: { name: USAGE_FILE, schemaField: "lineSchema" }, known: [USAGE_LINE_SCHEMA] },
  { target: REPORTS_FILE, known: [REPORTS_SCHEMA] },
  // Schema 1 lines are still read exactly as written (decisions.ts).
  { target: DECISIONS_FILE, known: [DECISIONS_SCHEMA, LEGACY_DECISIONS_SCHEMA] },
  { target: QUEUE_FILE, known: [IDEA_QUEUE_SCHEMA] },
  { target: CLI_STATE_FILE, known: [CLI_STATE_SCHEMA] },
  { target: DESCRIPTIONS_FILE, known: [DESCRIPTIONS_SCHEMA] },
  { target: BASELINE_FILE, known: null },
  { target: LOCK_FILE, known: null },
];

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
 * The dashboard's own start stamp, from its `/api/diagnostics` (Stage 3). Until
 * that route exists nobody asks, and the page says so rather than guessing.
 */
export type DashboardReading =
  | { kind: "not-asked"; why: string }
  | { kind: "unreachable"; why: string }
  | { kind: "answered"; revision: StartRevision };

/**
 * A service's revision against this checkout. `compared` carries `dirty`
 * beside the relation, and the renderer never says "same" for a dirty start.
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
  /** The host has rebooted since the daemon last recorded its boot: the daemon has not run since. */
  | { kind: "different"; recorded: string; host: string }
  | { kind: "unknown"; why: string };

export type FileRow = {
  probe: StoreFileProbe;
  /** The schema(s) this build reads for the file, or null when it names none. */
  known: readonly number[] | null;
  match: "matches" | "mismatch" | "no-known-schema" | "cannot-tell" | "not-applicable";
};

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
  };
  dashboard: { reading: DashboardReading; verdict: RevisionVerdict | null };
  checkpoint: CheckpointSection;
  boot: BootSection;
  files: FileRow[];
  /** `overseer status`'s schedule block, as data: what the daemon previews, and the list this checkout builds. */
  jobs: { builds: string; runningInstanceId: string | null; preview: SchedulePreviewRead };
};

export type DiagnoseInput = {
  root: string;
  nowMs: number;
  checkoutPath: string;
  head: CheckoutHead;
  relate: GitReads["relate"];
  checkpoint: CheckpointRead;
  notes: ReadNotes;
  alive: (pid: number) => boolean;
  recovery: RecoveryFileReading;
  hostBootId: string | null;
  files: StoreFileProbe[];
  schedule: SchedulePreviewRead;
  builtListRevision: string;
  dashboard: DashboardReading;
};

/* ------------------------------------------------------------------ *
 * The pure half
 * ------------------------------------------------------------------ */

export function diagnose(input: DiagnoseInput): DiagnoseReport {
  const { checkpoint: read, nowMs } = input;
  const checkpoint = read.kind === "checkpoint" ? read.checkpoint : null;
  const start = startNoteOf(read, input.notes);
  const files = input.files.map(fileRow);
  const probeOfCheckpoint = files.find((row) => row.probe.name === CHECKPOINT_FILE)?.probe;
  const ageOf = (iso: string | null): number | null => (iso === null ? null : nowMs - Date.parse(iso));

  return {
    root: input.root,
    generatedAt: new Date(nowMs).toISOString(),
    checkout: { path: input.checkoutPath, head: input.head },
    daemon: {
      standing: standingFromReads(read, input.notes, nowMs, input.alive),
      instanceId: checkpoint?.heartbeat.instanceId ?? null,
      pid: checkpoint?.heartbeat.pid ?? null,
      startedAt: checkpoint?.heartbeat.startedAt ?? null,
      start,
      verdict: daemonVerdict(start, input),
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
    jobs: { builds: input.builtListRevision, runningInstanceId: checkpoint?.heartbeat.instanceId ?? null, preview: input.schedule },
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

function fileRow(probe: StoreFileProbe): FileRow {
  const known = STORE_FILES.find((file) => nameOf(file.target) === probe.name)?.known ?? null;
  if (probe.state !== "present") return { probe, known, match: "not-applicable" };
  if (known === null) return { probe, known, match: "no-known-schema" };
  if (probe.schema === null) return { probe, known, match: "cannot-tell" };
  if (probe.schema === "none-declared") return { probe, known, match: "mismatch" };
  return { probe, known, match: known.includes(probe.schema) ? "matches" : "mismatch" };
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

const LABEL = 12;
const INDENT = " ".repeat(LABEL);
const labelled = (label: string, text: string): string => `${label.padEnd(LABEL)}${text}`;
const DIRTY = ", dirty at start — the sha does not name the running code";

export function verdictText(verdict: RevisionVerdict): string {
  switch (verdict.kind) {
    case "not-stamped":
      return `not stamped (${verdict.why})`;
    case "unknown":
      return `unknown: ${verdict.why}`;
    case "compared": {
      const sha = verdict.sha.slice(0, 12);
      const dirty = verdict.dirty ? DIRTY : "";
      const relation = verdict.relation;
      switch (relation.kind) {
        case "same":
          // Never "same" for a dirty start: its sha is HEAD's, and its code was not.
          return verdict.dirty ? `${sha}, this checkout's HEAD sha${dirty}` : `${sha}, same as this checkout's HEAD`;
        case "behind":
          return `${sha}, ${relation.commits} ${relation.commits === 1 ? "commit" : "commits"} behind HEAD${dirty}`;
        case "not-ancestor":
          return `${sha}, not an ancestor of HEAD${dirty}`;
        case "unknown":
          return `${sha}, its relation to HEAD is unknown: ${relation.why}${dirty}`;
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
    case "answered":
      return dashboard.verdict === null ? "answered, and not compared" : verdictText(dashboard.verdict);
    default: {
      const never: never = dashboard.reading;
      throw new Error(`no text for ${JSON.stringify(never)}`);
    }
  }
}

const at = (iso: string, ageMs: number): string => `${iso} (${describeAge(ageMs)} ago)`;

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
            : `last good snapshot ${section.lastGoodSnapshotAt} (${describeAge(section.lastGoodAgeMs)} old)`
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
      return `same boot as the daemon last recorded (${boot.bootId})`;
    case "different":
      return `DIFFERENT — the daemon last recorded boot ${boot.recorded} and this host is on ${boot.host}: the host has rebooted, and the daemon has not run since the reboot`;
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

function fileLine(row: FileRow, width: number): string {
  const name = `  ${row.probe.name.padEnd(width)}  `;
  const probe = row.probe;
  if (probe.state === "absent") return `${name}absent`;
  if (probe.state === "unreadable") return `${name}UNREADABLE — ${probe.why}`;
  const reads = row.known === null ? "" : row.known.join(" or ");
  const declared = probe.schema === null ? "schema unreadable" : probe.schema === "none-declared" ? "no schema declared" : `schema ${probe.schema}`;
  let schema: string;
  switch (row.match) {
    case "matches":
      schema = declared;
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
  return `${name}${size(probe.bytes).padStart(9)}  ${describeAge(probe.mtimeAgeMs).padStart(4)} old  ${schema}${last}${torn}`;
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
      daemon.instanceId === null ? "none named — there is no readable checkpoint" : `${daemon.instanceId}, pid ${daemon.pid ?? "?"}, started ${daemon.startedAt ?? "?"}`,
    ),
  );
  lines.push(labelled("revision", `daemon: ${verdictText(daemon.verdict)}`));
  lines.push(`${INDENT}dashboard: ${dashboardText(report.dashboard)}`);
  lines.push(`${INDENT}(a revision is what the process recorded when it started, never this checkout's HEAD)`);
  lines.push("");

  lines.push(...checkpointLines(report.checkpoint));
  lines.push(labelled("boot", bootText(report.boot)));
  lines.push("");

  lines.push("store files");
  const width = Math.max(...report.files.map((row) => row.probe.name.length));
  for (const row of report.files) lines.push(fileLine(row, width));
  lines.push("");

  lines.push(...schedulePreviewLines(report.jobs.preview, { listRevision: report.jobs.builds, runningInstanceId: report.jobs.runningInstanceId }, nowMs));
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
  alive?: (pid: number) => boolean;
  hostBootId?: () => string | null;
  /** The checkout whose HEAD and job list are compared. Defaults to the one this module sits in. */
  checkout?: string;
  git?: GitReads;
  /** The job list this checkout builds, as `overseer status` computes it. Injected in tests. */
  builtListRevision?: () => string;
  dashboard?: DashboardReading;
};

/**
 * Every read the report needs, lock-free and read-only. `ok: false` only when
 * the store root itself cannot be read — the one case the command exits 1.
 */
export function readDiagnoseInput(root: string, deps: DiagnoseDeps = {}): { ok: true; input: DiagnoseInput } | { ok: false; why: string } {
  try {
    if (!statSync(root).isDirectory()) return { ok: false, why: `the store root ${root} is not a directory` };
    readdirSync(root);
  } catch (cause) {
    return { ok: false, why: `the store root ${root} cannot be read: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
  const now = (deps.now ?? (() => new Date()))();
  const checkoutPath = deps.checkout ?? fileURLToPath(new URL("../..", import.meta.url));
  const git = deps.git ?? checkoutGit(checkoutPath);
  const built =
    deps.builtListRevision ??
    // The expression `overseer status` uses (scripts/overseer.ts), so an unchanged checkout reads as the same list.
    (() => listRevision([...standingJobs(checkoutPath).jobs, ...ruleJobs(checkoutPath).jobs]));
  let builtListRevision: string;
  try {
    builtListRevision = built();
  } catch (cause) {
    builtListRevision = `(which this checkout could not build: ${cause instanceof Error ? cause.message : String(cause)})`;
  }
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
      alive: deps.alive ?? isProcessAlive,
      recovery: readRecoveryIndexFile(root),
      hostBootId: (deps.hostBootId ?? readHostBootId)(),
      files: probeStoreFiles(
        root,
        STORE_FILES.map((file) => file.target),
        now,
      ),
      schedule: readSchedulePreviewFile(root),
      builtListRevision,
      dashboard: deps.dashboard ?? { kind: "not-asked", why: "no diagnostics route yet" },
    },
  };
}
