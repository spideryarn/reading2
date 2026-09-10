/**
 * GRADUAL RECOVERY'S RESUME PASS — one interrupted Claude session at a time,
 * gated, revalidated, launched, verified.
 *
 * docs/plans/260910f-gradual-recovery-resume-selected-interrupted-work-one-at-a-time.md
 * is the design, and its "Review dispositions: Sol, plan round 1" section
 * overrides §1–§7 wherever they differ. This module holds:
 *
 *  - **the launch port** (`ResumeLaunchPort`), the thin seam Stage 3 adapts
 *    `composeLaunchProtocol`'s `launchOccurrence`, `inspect` and `inFlight` to.
 *    Until then the daemon composes it `unwired`: requests queue, nothing
 *    launches, nothing is refused for it;
 *  - **the account port** (Sol's G4): a resumed conversation runs under the
 *    account whose config directory holds its transcript, pinned by name,
 *    never `auto`, and gated on THAT account's own quota;
 *  - **`decideResume`**, pure: the occurrence table (G1), pace (G2, G8), the
 *    gate, and revalidation, in that order;
 *  - **`verificationOf`** (G2): all four facts, not the inventory's `resumed`
 *    alone;
 *  - **the nudge and the preview** (§2, §3): quotations, bounded, cached;
 *  - **`runResumePass`**, whose ORDER IS LOAD-BEARING (G5): every await first,
 *    then one synchronous stretch that recaptures the daemon's state, repeats
 *    every check, launches and moves the request files;
 *  - **the projection**, written beside `view` in `recovery.json` (G9).
 *
 * **Nothing resumes on its own.** A request file is the only thing that starts
 * this, and a request file is only ever written by a person's tap or command.
 */
import { closeSync, constants, fstatSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type {
  ProducerCapability,
  RecoveryResumeAccount,
  RecoveryResumeAccountUnknown,
  RecoveryResumeGateWire,
  RecoveryResumeLaunchState,
  RecoveryResumeLaunchWire,
  RecoveryResumePreview,
  RecoveryResumeProjection,
  RecoveryResumeQuote,
  RecoveryResumeRequestState,
  RecoveryResumeVerification,
} from "../fleet/wire.js";
import { readAccountRegistry, resolveAccount } from "./accounts.js";
import { accountQuotaGate, bothGates, healthGate, type LaunchGate, type StoredAccountUsage } from "./launch-gate.js";
import { liveExecutionOf, verifiedConversationOf, type RecoveryCandidateId, type RecoveryIndex, type RecoveryRecord } from "./recovery.js";
import {
  candidateOfName,
  listPendingResumeRequests,
  moveToDone,
  moveToRefused,
  readResumeAttempts,
  readSettledResumes,
  writeResumeAttempt,
  type MoveResult,
  type PendingResume,
  type ResumeAttempt,
  type ResumeRequest,
} from "./recovery-resume-request.js";
import {
  classifyRecord,
  transcriptLocator,
  type EvidenceDeps,
  type InventoryTrust,
  type LocatedTranscript,
  type RecoveryView,
  type RecoveryViewItem,
} from "./recovery-view.js";

/** After the last verification, the next launch waits this long, so each session's startup load lands first. */
export const RESUME_SPACING_MS = 120_000;
/** A per-account usage reading older than this is unknown: three missed five-minute usage passes. */
export const RESUME_USAGE_STALE_AFTER_MS = 15 * 60_000;
/**
 * WHERE UNKNOWN EVIDENCE GOES, for every gate the resume pass asks: HOLD.
 * Resuming onto an unreadable box or an unknown quota is the load spike the
 * roadmap's acceptance forbids (plan § 2.5, and the question for Greg there).
 * One constant, so the three gates cannot disagree.
 */
export const RESUME_ON_UNKNOWN: "hold" | "clear" = "hold";
/** The preview's bounded reads: from the head for the brief, from the tail for where it got to. */
export const PREVIEW_HEAD_BYTES = 256 * 1024;
export const PREVIEW_TAIL_BYTES = 256 * 1024;
/** A quotation is capped at this many characters (code points). */
export const QUOTE_MAX_CHARS = 600;
/** The verification's bounded tail (G2). */
export const VERIFY_TAIL_BYTES = 64 * 1024;
/** Refused requests shown on the page: the newest per candidate, and the newest this many overall. */
export const REFUSED_SHOWN = 50;
/** How much of `reservations.ndjson` the account port reads, from the end. */
export const RESERVATIONS_TAIL_BYTES = 4 * 1024 * 1024;
/** Previews kept in memory, keyed by `(path, size, mtimeMs)`. */
const PREVIEW_CACHE_ENTRIES = 256;

// ═══ The ports ════════════════════════════════════════════════════════════════

/** The launch protocol's summary of a recovery occurrence (G6), with the candidate it is for. */
export type ResumeOccurrence = { candidateId: RecoveryCandidateId } & RecoveryResumeLaunchWire;

export type ResumeLaunchRequest = {
  candidateId: RecoveryCandidateId;
  conversationId: string;
  dir: string;
  account: { name: string; configDir: string };
  /** The fixed text typed first. It grants nothing. */
  nudge: string;
};

/**
 * Mirrors the launch protocol's `LaunchOutcome` (worktree-launch-protocol:
 * tools/overseer/launch-protocol.ts ~1155), including `failed-before-launch`'s
 * `reservation`, which its Stage 1b fix round adds (G1).
 */
export type ResumeLaunchOutcome =
  | { kind: "refused"; why: string }
  | { kind: "conflict"; occurrenceId: string; why: string }
  | { kind: "not-launchable"; occurrenceId: string; state: RecoveryResumeLaunchState; why: string }
  | { kind: "waiting"; occurrenceId: string; why: string }
  | { kind: "failed-before-launch"; occurrenceId: string; proof: string; why: string; reservation: { kind: "released" } | { kind: "held"; why: string } }
  /** A write before the invocation did not land. Nothing was invoked; the protocol's reconciliation settles it. */
  | { kind: "not-launched"; occurrenceId: string; why: string }
  | { kind: "invoked"; occurrenceId: string; correlationId: string; launcher: "started" | "threw"; detail: string };

/** Stage 3 adapts `composeLaunchProtocol` to this. Keep it that thin. */
export type ResumeLaunchPort =
  | { kind: "unwired"; why: string }
  | {
      kind: "wired";
      inspect(candidateId: RecoveryCandidateId): ResumeOccurrence | null;
      /** planned, waiting-admission, reserved, launching, observed-running, outcome-unknown, or any with its reservation held. */
      inFlight(): readonly ResumeOccurrence[];
      /** Synchronous, like the protocol's `launchOccurrence`. */
      launch(request: ResumeLaunchRequest): ResumeLaunchOutcome;
      /**
       * G13: continue a STORED occurrence, synchronously — the protocol's
       * `resumeOccurrence` (Stage 3b maps it). No replan: the stored plan's
       * material and launcher are the ones used. It drives only a `planned` or
       * `waiting-admission` occurrence; anything else answers `not-launchable`
       * and nothing is invoked; an unknown occurrence or a lost history answers
       * `refused`. The pass calls it only for `planned` or `waiting-admission`,
       * after the gates and revalidation, in the synchronous stretch.
       */
      drive(candidateId: RecoveryCandidateId): ResumeLaunchOutcome;
    };

export const UNWIRED_LAUNCH_PORT: ResumeLaunchPort = {
  kind: "unwired",
  why: "the launch protocol is not composed into this daemon yet, so resume requests wait in the queue and nothing is started",
};

/**
 * Which account a conversation belongs to (G4), asked with the transcript's
 * path and the projects root it was found under. The account's quota is not
 * this port's: see `quotaGateFor`.
 */
export type ResumeAccountPort = {
  resolve(input: { conversationId: string; transcriptPath: string; transcriptRoot: string }): Promise<ResolvedAccount>;
};

/** Whether what a resolution rested on is still as it was (G11). */
export type AccountRecheck = { kind: "same" } | { kind: "changed"; why: string };

/**
 * G11: AN ACCOUNT, AND WHAT IT RESTED ON. The resolution is async (the
 * registry read, a `realpath`), so it happens before the synchronous stretch;
 * `recheck` is a BOUNDED SYNCHRONOUS test (a few `stat`s and one `realpath`)
 * that the stretch runs, so a ledger append or a registry change during the
 * awaits defers the launch and the next pass resolves again — the launch never
 * runs on an account the ledger has since moved.
 */
export type ResolvedAccount = { account: RecoveryResumeAccount; recheck(): AccountRecheck };

/** A resolution that rests on nothing that can move: no head, or no transcript to find an account from. */
function unresolvedAccount(account: RecoveryResumeAccount): ResolvedAccount {
  return { account, recheck: () => ({ kind: "same" }) };
}

/**
 * THE PINNED ACCOUNT'S QUOTA, from the daemon's own per-account usage reading
 * (`accountUsage`, one live reading per account each usage pass): the section
 * whose registry name is the pinned account's, judged by `accountQuotaGate`.
 * No reading, a `none`, any `problems` entry (the list may be short), or no
 * section of that name are all unknown, and go to `onUnknown`.
 */
export function quotaGateFor(stored: StoredAccountUsage | null, accountName: string, nowMs: number, onUnknown: "hold" | "clear" = RESUME_ON_UNKNOWN): LaunchGate {
  const unknown = (why: string): LaunchGate => (onUnknown === "hold" ? { kind: "held", why, until: null } : { kind: "clear", notes: [why] });
  if (stored === null) return unknown("no per-account usage reading has been taken yet");
  if (stored.kind === "none") return unknown(`there is no per-account usage reading: ${stored.why}`);
  if (stored.problems.length > 0) return unknown(`the per-account usage reading may be incomplete: ${stored.problems.join("; ")}`);
  const section = stored.accounts.find((candidate) => candidate.name === accountName) ?? null;
  if (section === null) return unknown(`the per-account usage reading has no section for ${accountName}`);
  return accountQuotaGate(section, nowMs, onUnknown, RESUME_USAGE_STALE_AFTER_MS);
}

function errText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function isObject(u: unknown): u is Record<string, unknown> {
  return typeof u === "object" && u !== null && !Array.isArray(u);
}

/**
 * The projects roots a transcript may be under (G4): `$CLAUDE_CONFIG_DIR/projects`
 * when set, `~/.claude/projects`, and every registered Claude account's
 * `<stateDir>/projects`. The locator resolves each with `realpath` and drops
 * duplicates. No `~/.claude-*` glob: a directory name is not an account.
 */
export function defaultProjectsRoots(options: { registryPath?: string; home?: string; env?: NodeJS.ProcessEnv } = {}): () => Promise<readonly string[]> {
  return async () => {
    const env = options.env ?? process.env;
    const home = options.home ?? homedir();
    const roots: string[] = [];
    const configDir = env["CLAUDE_CONFIG_DIR"];
    if (configDir !== undefined && configDir !== "") roots.push(join(configDir, "projects"));
    roots.push(join(home, ".claude", "projects"));
    const registry = await readAccountRegistry(options.registryPath);
    if (registry.kind === "value") {
      for (const account of registry.accounts) if (account.family === "claude") roots.push(join(account.stateDir, "projects"));
    }
    return roots;
  };
}

/**
 * One row of `reservations.ndjson`: the ledger's own `LaunchRecord`.
 *
 * A FAITHFUL LOCAL COPY of `readLaunches`' validator in
 * scripts/claude-accounts.ts (~1099–1141, `LaunchRecord`), which is not
 * exported and is not importable here without pulling the scripts tree and
 * `smol-toml` into tools/. Keep the two in step. One deliberate strictness
 * beyond it (Sol's G15): `createdAt`, and `activeUntil` when present, must be
 * readable instants — a row whose time cannot be read is not trusted to name
 * the account a launch runs under.
 */
function ledgerRowOf(u: unknown): { sessionUuid: string; accountName: string } | { why: string } {
  if (!isObject(u)) return { why: "it is not a JSON object" };
  if (u["schema"] !== 1) return { why: "its schema is not 1" };
  if (typeof u["accountName"] !== "string") return { why: "it has no accountName" };
  if (!(typeof u["providerAccountId"] === "string" || u["providerAccountId"] === null)) return { why: "its providerAccountId is neither text nor null" };
  if (typeof u["sessionUuid"] !== "string") return { why: "it has no sessionUuid" };
  if (typeof u["launchName"] !== "string") return { why: "it has no launchName" };
  if (typeof u["createdAt"] !== "string" || !Number.isFinite(Date.parse(u["createdAt"]))) return { why: "its createdAt is not a readable time" };
  if (!(u["activeUntil"] === undefined || (typeof u["activeUntil"] === "string" && Number.isFinite(Date.parse(u["activeUntil"]))))) {
    return { why: "its activeUntil is not a readable time" };
  }
  if (!(u["outcome"] === "reserved" || u["outcome"] === "started" || u["outcome"] === "completed" || u["outcome"] === "failed")) {
    return { why: `its outcome ${JSON.stringify(u["outcome"])} is not one the ledger writes` };
  }
  return { sessionUuid: u["sessionUuid"], accountName: u["accountName"] };
}

/** Uuid-shaped text in a line the validator refused: the conversations that line may have been about. */
const UUID_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * What the ledger's NEWEST line about a conversation says (G15): a whole launch
 * record naming its account, or a line that mentions the conversation and is
 * not one — in which case the account is unknown, never the one an OLDER row
 * named, because the newer line may have been the one that moved it.
 */
type LedgerNewest = { kind: "row"; accountName: string } | { kind: "doubtful"; why: string };

/**
 * The account ledger's rows for session ids, read BACKWARDS by a bound: the
 * last `RESERVATIONS_TAIL_BYTES` of `reservations.ndjson`, synchronously, with
 * `O_NOFOLLOW`. Cached on the file's `(size, mtimeMs)`, so an unchanged ledger
 * costs one `stat`.
 *
 * `noBoundary`: the window began mid-file and holds no newline, so all of it is
 * the end of ONE line longer than the window, which cannot be read whole —
 * nothing in it is a row, and nothing can be said about any conversation.
 */
type LedgerReading =
  | { kind: "read"; newest: Map<string, LedgerNewest>; truncated: boolean; noBoundary: boolean }
  | { kind: "absent" }
  | { kind: "unreadable"; why: string };

function readLedgerTail(path: string): LedgerReading {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    return code === "ENOENT" ? { kind: "absent" } : { kind: "unreadable", why: errText(cause) };
  }
  try {
    const size = fstatSync(fd).size;
    const length = Math.min(size, RESERVATIONS_TAIL_BYTES);
    const start = size - length;
    const bytes = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const n = readSync(fd, bytes, read, length - read, start + read);
      if (n === 0) break;
      read += n;
    }
    let text = bytes.subarray(0, read).toString("utf8");
    const newest = new Map<string, LedgerNewest>();
    const doubt = (line: string, why: string): void => {
      for (const id of line.match(UUID_TEXT) ?? []) newest.set(id.toLowerCase(), { kind: "doubtful", why });
    };
    const mib = RESERVATIONS_TAIL_BYTES / (1024 * 1024);
    if (start > 0) {
      // A read that began mid-file began mid-line: that first fragment is not
      // a row. With NO newline at all, the whole window is that fragment.
      const boundary = text.indexOf("\n");
      if (boundary === -1) return { kind: "read", newest, truncated: true, noBoundary: true };
      // The fragment is the OLDEST text in the window, so any later line about
      // the same conversation still decides; if none does, the conversation's
      // newest line is one we could not read whole.
      doubt(text.slice(0, boundary), `the newest account-ledger line naming this conversation is longer than the ${mib} MiB the port reads, so it cannot be read whole`);
      text = text.slice(boundary + 1);
    }
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line) as unknown;
      } catch {
        doubt(line, "the newest account-ledger line naming this conversation is not a valid launch record (it is not JSON)");
        continue;
      }
      const row = ledgerRowOf(parsed);
      if ("why" in row) {
        const why = `the newest account-ledger line naming this conversation is not a valid launch record (${row.why})`;
        doubt(line, why);
        if (isObject(parsed) && typeof parsed["sessionUuid"] === "string") newest.set(parsed["sessionUuid"].toLowerCase(), { kind: "doubtful", why });
        continue;
      }
      newest.set(row.sessionUuid.toLowerCase(), { kind: "row", accountName: row.accountName });
    }
    return { kind: "read", newest, truncated: start > 0, noBoundary: false };
  } catch (cause) {
    return { kind: "unreadable", why: errText(cause) };
  } finally {
    closeSync(fd);
  }
}

/**
 * THE PRODUCTION ACCOUNT PORT (the G4 disposition's recipe).
 *
 *  - The conversation's LAST row in `~/.claude-accounts/reservations.ndjson`
 *    names its account (every `gjd-remote new-claude` writes one). No row: it
 *    started on the default login, which gjd-remote cannot relaunch by name,
 *    so it is `unknown` and gets manual instructions.
 *  - That account's `stateDir` comes from the registry, through
 *    tools/overseer/accounts.ts.
 *  - **And its `projects/` must be the root the transcript was found under**,
 *    after `realpath`: `claude --resume` finds only its own config directory's
 *    conversations. On this box every account's `projects` is a symlink to
 *    `~/.claude/projects`, so this holds today by layout; it is checked, not
 *    assumed.
 *  - The quota is not read here: the daemon's usage pass already keeps one
 *    live reading per account, and the pass judges the pinned account's
 *    section of it (`quotaGateFor`). Nothing in this port makes a network call.
 */
export function productionAccountPort(options: { accountsDir?: string; registryPath?: string } = {}): ResumeAccountPort {
  const accountsDir = options.accountsDir ?? join(homedir(), ".claude-accounts");
  const ledgerPath = join(accountsDir, "reservations.ndjson");
  const registryPath = options.registryPath ?? join(accountsDir, "registry.json");
  let ledger: { size: number; mtimeMs: number; reading: LedgerReading } | null = null;
  const ledgerNow = (): LedgerReading => {
    let info: { size: number; mtimeMs: number };
    try {
      info = statSync(ledgerPath);
    } catch (cause) {
      return (cause as NodeJS.ErrnoException).code === "ENOENT" ? { kind: "absent" } : { kind: "unreadable", why: errText(cause) };
    }
    if (ledger !== null && ledger.size === info.size && ledger.mtimeMs === info.mtimeMs) return ledger.reading;
    const reading = readLedgerTail(ledgerPath);
    ledger = { size: info.size, mtimeMs: info.mtimeMs, reading };
    return reading;
  };
  /**
   * G11: A FILE'S IDENTITY, as a synchronous `stat` sees it — device, inode,
   * size, mtime and ctime, or that it could not be stat'd. Taken BEFORE the
   * ledger and the registry are read, so a write during the read is caught too.
   */
  const identity = (path: string): string => {
    try {
      const s = statSync(path);
      return `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
    } catch (cause) {
      return `unstattable:${(cause as NodeJS.ErrnoException).code ?? errText(cause)}`;
    }
  };
  type Judged = { account: RecoveryResumeAccount; projects: { link: string; real: string } | null };
  const unknown = (reason: RecoveryResumeAccountUnknown, why: string, projects: Judged["projects"] = null): Judged => ({ account: { kind: "unknown", reason, why }, projects });
  const judge = async (conversationId: string, transcriptRoot: string): Promise<Judged> => {
    const read = ledgerNow();
    if (read.kind === "unreadable") return unknown("ledger-unreadable", `the account ledger could not be read (${read.why})`);
    if (read.kind === "read" && read.noBoundary) {
      return unknown(
        "ledger-ambiguous",
        `the last ${RESERVATIONS_TAIL_BYTES / (1024 * 1024)} MiB of the account ledger is one line longer than that window (unfinished, or not the ledger's), so no row in it can be read`,
      );
    }
    const newest = read.kind === "read" ? read.newest.get(conversationId.toLowerCase()) : undefined;
    if (newest?.kind === "doubtful") return unknown("ledger-ambiguous", newest.why);
    const name = newest?.accountName;
    if (name === undefined) {
      // THE ONE PROVEN DEFAULT LOGIN (G17): a ledger read WHOLE, or absent,
      // with no row for the conversation. A ledger longer than the window
      // proves nothing about a row that may be older than it.
      return read.kind === "read" && read.truncated
        ? unknown(
            "ledger-ambiguous",
            `no account row for this conversation in the last ${RESERVATIONS_TAIL_BYTES / (1024 * 1024)} MiB of the account ledger, which is longer than that: its row may be older, or in a line cut off at the window's start, or it started on the default login, so the account it ran under is not established`,
          )
        : unknown("default-login", "started on the default login, which gjd-remote cannot relaunch by name");
    }
    const registry = await readAccountRegistry(registryPath);
    const resolved = resolveAccount(registry, name);
    if (resolved.kind !== "value") return unknown("account-unusable", `the account ${name} is not usable: ${resolved.why}`);
    if (resolved.account.family !== "claude") return unknown("account-unusable", `the account ${name} is not a Claude account`);
    const link = join(resolved.account.stateDir, "projects");
    let accountRoot: string;
    try {
      accountRoot = await realpath(link);
    } catch (cause) {
      return unknown("account-unusable", `the account ${name}'s projects directory could not be resolved: ${errText(cause)}`);
    }
    if (accountRoot !== transcriptRoot) {
      return unknown(
        "transcript-elsewhere",
        `the transcript is under ${transcriptRoot}, not under the account ${name}'s own projects directory (${accountRoot}), so a resume under that account would not find it`,
        { link, real: accountRoot },
      );
    }
    return { account: { kind: "pinned", name, configDir: resolved.account.stateDir }, projects: { link, real: accountRoot } };
  };
  return {
    async resolve({ conversationId, transcriptRoot }) {
      const before = { ledger: identity(ledgerPath), registry: identity(registryPath) };
      const { account, projects } = await judge(conversationId, transcriptRoot);
      return {
        account,
        recheck: (): AccountRecheck => {
          if (identity(ledgerPath) !== before.ledger) return { kind: "changed", why: "the account ledger changed" };
          if (identity(registryPath) !== before.registry) return { kind: "changed", why: "the account registry changed" };
          if (projects !== null) {
            let real: string;
            try {
              real = realpathSync(projects.link);
            } catch (cause) {
              return { kind: "changed", why: `the account's projects directory no longer resolves (${errText(cause)})` };
            }
            if (real !== projects.real) return { kind: "changed", why: "the account's projects directory now resolves elsewhere" };
          }
          return { kind: "same" };
        },
      };
    },
  };
}

// ═══ The nudge, the preview, the uncertainty ══════════════════════════════════

/**
 * The fixed text typed first (plan § 2). Two values: what ended it, and when.
 * It grants nothing: the agent's permissions are what its settings say.
 */
export function nudgeFor(record: RecoveryRecord): string {
  const cause = !record.oversize && record.disappearance.bootChanged ? "the machine restarted" : "its session was cut off";
  return (
    `This session was interrupted (${cause} at ${record.at}). Re-read your plan and your last messages, ` +
    "check `git status` in your worktree, and carry on from where you stopped. " +
    "If you cannot tell what you were doing, say so and stop."
  );
}

/** Reads `length` bytes at `position`. Injected so a test can count what a preview reads. */
export type ReadRange = (path: string, position: number, length: number) => Promise<Buffer>;

export const readRange: ReadRange = async (path, position, length) => {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const bytes = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const part = await handle.read(bytes, read, length - read, position + read);
      if (part.bytesRead === 0) break;
      read += part.bytesRead;
    }
    return bytes.subarray(0, read);
  } finally {
    await handle.close();
  }
};

function capQuote(text: string): RecoveryResumeQuote {
  const points = Array.from(text.trim());
  return points.length <= QUOTE_MAX_CHARS
    ? { kind: "quoted", text: points.join(""), truncated: false }
    : { kind: "quoted", text: points.slice(0, QUOTE_MAX_CHARS).join(""), truncated: true };
}

/** The text of a user or assistant line: a string, or the `text` parts of an array. Null when there is none. */
function messageText(line: Record<string, unknown>): string | null {
  const message = line["message"];
  if (!isObject(message)) return null;
  const content = message["content"];
  if (typeof content === "string") return content.trim() === "" ? null : content;
  if (!Array.isArray(content)) return null;
  const parts = content.filter((part): part is { type: "text"; text: string } => isObject(part) && part["type"] === "text" && typeof part["text"] === "string");
  const text = parts.map((part) => part.text).join("\n");
  return text.trim() === "" ? null : text;
}

/** The complete JSON lines in a window of a file. `fromStart`: the window began at byte 0; `toEnd`: it reached the end. */
function jsonLines(bytes: Buffer, fromStart: boolean, toEnd: boolean): Record<string, unknown>[] {
  const lines = bytes.toString("utf8").split("\n");
  if (!fromStart) lines.shift();
  if (!toEnd) lines.pop();
  const out: Record<string, unknown>[] = [];
  for (const line of lines) {
    if (line.trim() === "") continue;
    try {
      const value = JSON.parse(line) as unknown;
      if (isObject(value)) out.push(value);
    } catch {
      /* A torn or foreign line is not quoted. */
    }
  }
  return out;
}

function titleIn(lines: readonly Record<string, unknown>[]): string | null {
  let custom: string | null = null;
  let ai: string | null = null;
  for (const line of lines) {
    if (line["type"] === "custom-title" && typeof line["customTitle"] === "string") custom = line["customTitle"];
    if (line["type"] === "ai-title" && typeof line["aiTitle"] === "string") ai = line["aiTitle"];
  }
  return custom ?? ai;
}

export type TranscriptQuotes = { brief: RecoveryResumeQuote; lastWords: RecoveryResumeQuote; title: string | null };

export type PreviewCache = Map<string, TranscriptQuotes>;

export function newPreviewCache(): PreviewCache {
  return new Map();
}

/**
 * THE BRIEF, WHERE IT GOT TO, AND ITS TITLE — quotations from the verified
 * transcript, read from a bounded head (256 KiB) and a bounded tail (256 KiB),
 * so a 10 MiB transcript costs at most 512 KiB. Cached on `(path, size,
 * mtimeMs)`: an unchanged transcript costs a `stat`.
 *
 * The brief is the first user message that has text (tool results and meta
 * lines are skipped); where it got to is the last assistant text. Each is
 * capped at 600 characters. They are shown as quotations, never as commands.
 */
export async function transcriptQuotes(path: string, deps: { readRange?: ReadRange; cache?: PreviewCache } = {}): Promise<TranscriptQuotes> {
  const read = deps.readRange ?? readRange;
  let info: { size: number; mtimeMs: number };
  try {
    info = await stat(path);
  } catch (cause) {
    const why = `the transcript could not be read: ${errText(cause)}`;
    return { brief: { kind: "unavailable", why }, lastWords: { kind: "unavailable", why }, title: null };
  }
  const key = `${path}\0${info.size}\0${info.mtimeMs}`;
  const held = deps.cache?.get(key);
  if (held !== undefined) return held;
  let quotes: TranscriptQuotes;
  try {
    const headLength = Math.min(info.size, PREVIEW_HEAD_BYTES);
    const head = await read(path, 0, headLength);
    const headReachesEnd = headLength === info.size;
    const tailStart = Math.max(0, info.size - PREVIEW_TAIL_BYTES);
    // A file the head already covered is not read twice.
    const tail = headReachesEnd ? head : await read(path, tailStart, info.size - tailStart);
    const headLines = jsonLines(head, true, headReachesEnd);
    const tailLines = headReachesEnd ? headLines : jsonLines(tail, tailStart === 0, true);
    let brief: RecoveryResumeQuote = { kind: "unavailable", why: `no user message with text in the first ${PREVIEW_HEAD_BYTES / 1024} KiB` };
    for (const line of headLines) {
      if (line["type"] !== "user" || line["isMeta"] === true) continue;
      const text = messageText(line);
      if (text !== null) {
        brief = capQuote(text);
        break;
      }
    }
    let lastWords: RecoveryResumeQuote = { kind: "unavailable", why: `no assistant text in the last ${PREVIEW_TAIL_BYTES / 1024} KiB` };
    for (let i = tailLines.length - 1; i >= 0; i -= 1) {
      const line = tailLines[i] as Record<string, unknown>;
      if (line["type"] !== "assistant") continue;
      const text = messageText(line);
      if (text !== null) {
        lastWords = capQuote(text);
        break;
      }
    }
    quotes = { brief, lastWords, title: titleIn(tailLines) ?? titleIn(headLines) };
  } catch (cause) {
    const why = `the transcript could not be read: ${errText(cause)}`;
    quotes = { brief: { kind: "unavailable", why }, lastWords: { kind: "unavailable", why }, title: null };
  }
  if (deps.cache !== undefined) {
    if (deps.cache.size >= PREVIEW_CACHE_ENTRIES) {
      const oldest = deps.cache.keys().next();
      if (!oldest.done) deps.cache.delete(oldest.value);
    }
    deps.cache.set(key, quotes);
  }
  return quotes;
}

/**
 * THE UNCERTAINTY — sentences derived from the record and its evidence, never
 * from transcript prose (plan § 3), plus the fixed caveat that a resume is not
 * proof the work will finish.
 */
export function uncertaintyOf(item: RecoveryViewItem, record: RecoveryRecord, account: RecoveryResumeAccount): string[] {
  const out: string[] = [];
  const evidence = item.evidence;
  if (evidence?.kind === "checked") {
    if (evidence.lastActivity.source === "register-floor") out.push("The last activity time is only a floor: the session was alive at least this recently.");
    if (evidence.transcript.kind === "found" && evidence.transcript.via === "scan") {
      out.push("The transcript was found by scanning, not at the path its directory predicts.");
    }
    if (evidence.worktree.kind === "not-recorded") out.push("The worktree name is display text, not a checked path.");
  }
  if (!record.oversize && record.disappearance.producerRun === "cannot-tell") out.push("The dashboard run could not be compared across the interruption.");
  if (account.kind === "unknown") out.push(`The account it ran under is not established (${account.why}), so it can only be resumed by hand.`);
  out.push("Resuming continues a conversation whose last turn may have been cut off mid-action: it may redo or half-redo that step.");
  out.push("A resume is not proof the work will finish.");
  return out;
}

function dirOfRecord(record: RecoveryRecord): string | null {
  if (record.oversize || record.entry === null) return null;
  return record.entry.meta.version === 1 ? record.entry.meta.dir : null;
}

// ═══ Verification (G2) ════════════════════════════════════════════════════════

/**
 * The transcript as the async phase read it, AGAINST ONE ATTEMPT'S BYTE OFFSET
 * (G12): its size and mtime, the offset it was read after, and the complete
 * JSON lines that BEGIN AFTER that offset — never a line that was already in
 * the file, or had already begun, when the attempt was written.
 */
export type TranscriptReading = { size: number; mtimeMs: number; afterOffset: number; newLines: readonly Record<string, unknown>[] };

/**
 * "VERIFIED" IS ALL FOUR (Sol's G2): the inventory's `resumed` disposition for
 * the candidate; the launch protocol's `observed-running`; the transcript's
 * size and mtime past what revalidation recorded at launch; and a line with
 * that `sessionId` that BEGINS AFTER the byte offset `attempts/<id>.json`
 * recorded BEFORE the launch was invoked (G12). No clock is compared: a line's
 * timestamp is the transcript writer's clock, and a line written before the
 * launch can carry any date. `resumed` alone proves a process and a
 * conversation, never which transcript is written.
 */
export function verificationOf(
  occurrence: ResumeOccurrence,
  record: RecoveryRecord | undefined,
  transcript: TranscriptReading | null,
  atLaunch: ResumeAttempt | undefined,
): RecoveryResumeVerification {
  const resolution = record?.resolution;
  const inventoryResumed =
    resolution?.disposition === "resumed" && (atLaunch === undefined || resolution.evidence.conversationId === atLaunch.conversationId);
  const observedRunning = occurrence.state === "observed-running";
  const transcriptGrew =
    transcript !== null &&
    atLaunch !== undefined &&
    transcript.size > atLaunch.transcriptSizeAtLaunch &&
    transcript.mtimeMs > atLaunch.transcriptMtimeAtLaunch;
  // A reading taken against another attempt's offset is not this attempt's evidence.
  const sessionLineSeen =
    transcript !== null &&
    atLaunch !== undefined &&
    transcript.afterOffset === atLaunch.transcriptSizeAtLaunch &&
    transcript.newLines.some((line) => line["sessionId"] === atLaunch.conversationId);
  return { inventoryResumed, observedRunning, transcriptGrew, sessionLineSeen };
}

export function isVerified(v: RecoveryResumeVerification): boolean {
  return v.inventoryResumed && v.observedRunning && v.transcriptGrew && v.sessionLineSeen;
}

function waitingForOf(v: RecoveryResumeVerification): string {
  const missing: string[] = [];
  if (!v.observedRunning) missing.push("the launch protocol to see it running");
  if (!v.inventoryResumed) missing.push("the inventory to see the conversation live under a new run");
  if (!v.transcriptGrew) missing.push("the transcript to grow");
  if (!v.sessionLineSeen) missing.push("a new line from this conversation in the transcript");
  return missing.length === 0 ? "nothing" : missing.join("; ");
}

/** The complete JSON objects among `pieces` (a window split on newlines, already trimmed of partial ends). */
function objectsOf(pieces: readonly string[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const piece of pieces) {
    if (piece.trim() === "") continue;
    try {
      const value = JSON.parse(piece) as unknown;
      if (isObject(value)) out.push(value);
    } catch {
      /* A torn or foreign line is no evidence. */
    }
  }
  return out;
}

/**
 * THE LINES THAT BEGIN AFTER `offset` (G12) — the byte offset
 * `attempts/<id>.json` recorded before the launch was invoked. Bounded: at most
 * `VERIFY_TAIL_BYTES` from the offset, plus, when the file has grown past that,
 * the last `VERIFY_TAIL_BYTES` (every line in it begins after the offset too).
 *
 * A line counts only if it begins at a line boundary at or after the offset:
 * the read starts one byte early, so a line that begins exactly at the offset
 * is kept, and the rest of a line that had already begun (a file that ended
 * mid-line when the attempt was written) is dropped.
 */
export async function transcriptAfter(path: string, offset: number, read: ReadRange = readRange): Promise<TranscriptReading | null> {
  try {
    const info = await stat(path);
    const reading = (newLines: Record<string, unknown>[]): TranscriptReading => ({ size: info.size, mtimeMs: info.mtimeMs, afterOffset: offset, newLines });
    if (info.size <= offset) return reading([]);
    const from = offset === 0 ? 0 : offset - 1;
    // G20: growth that fits in two windows is read as ONE contiguous piece.
    // Reading a first window and a separate tail only when the tail starts past
    // it left a seam for growth between one and two windows: the first window
    // dropped its cut-off last line and the tail was skipped, so a session line
    // just past a long unrelated line was never read. Beyond two windows the
    // tail necessarily starts after the first window, and the last
    // `VERIFY_TAIL_BYTES` suffices: every line of a resumed conversation
    // carries its sessionId. Either way at most 2 * VERIFY_TAIL_BYTES + 1 bytes.
    const contiguous = info.size - from <= 2 * VERIFY_TAIL_BYTES + 1;
    const end = contiguous ? info.size : Math.min(info.size, from + VERIFY_TAIL_BYTES + 1);
    const first = (await read(path, from, end - from)).toString("utf8").split("\n");
    // Up to and including the first newline began before the offset.
    if (offset > 0) first.shift();
    // A window that stops short of the end may stop mid-line.
    if (end < info.size) first.pop();
    const lines = objectsOf(first);
    const tailStart = info.size - VERIFY_TAIL_BYTES;
    if (tailStart > end) {
      const tail = (await read(path, tailStart, info.size - tailStart)).toString("utf8").split("\n");
      // The tail begins mid-line; everything after its first newline begins after the offset.
      tail.shift();
      lines.push(...objectsOf(tail));
    }
    return reading(lines);
  } catch {
    return null;
  }
}

// ═══ The decision ═════════════════════════════════════════════════════════════

/**
 * The exact command that ends an occurrence only Greg can end — the launch
 * protocol's D8 CLI (`scripts/overseer-launches.ts dispose <id> --as
 * <not-running|ended> --why "…"`, on its branch, not yet on `dev`). Display
 * text, never run.
 */
export function disposeCommandFor(occurrenceId: string): string {
  return `npx tsx scripts/overseer-launches.ts dispose ${occurrenceId} --as not-running --why "<what you checked>"`;
}

/**
 * G1: what an existing occurrence means for a request, as an exhaustive
 * `switch`. `continue` goes on through pace, the gate and revalidation.
 */
export type OccurrenceStep =
  | { kind: "continue"; attempt: number }
  /**
   * G13: a stored occurrence the protocol will continue (`planned`,
   * `waiting-admission`). It goes through pace, the gates and revalidation like
   * a new attempt, and is then DRIVEN, never replanned.
   */
  | { kind: "drive"; occurrence: ResumeOccurrence }
  | { kind: "defer"; why: string }
  | { kind: "settled"; occurrence: ResumeOccurrence };

/**
 * A failed attempt whose slot the protocol could not release (G1, G14): the
 * request stays pending and waits, and says how Greg ends it if the protocol
 * never manages to.
 */
function heldSlotWhy(occurrenceId: string): string {
  return `the last attempt failed before it started and its slot has not been released yet; the launch protocol may still release it, or end it with: ${disposeCommandFor(occurrenceId)}`;
}

/**
 * G19: AN OCCURRENCE'S STANDING, decided over ALL THREE things the protocol
 * reports — its state, whether its reservation is still held, and whether
 * Greg disposed it — so that no combination falls through a switch that is
 * exhaustive over the state alone. Every reader (the occurrence table, pace,
 * the page state) switches on this, never on `state`.
 *
 *  - disposed, whatever else: Greg ended it;
 *  - **stuck**: `outcome-unknown`, or a TERMINAL state (`completed`,
 *    `failed-before-launch`) whose reservation is still held. Nothing the
 *    daemon does moves it, and a held slot blocks every other resume at the
 *    protocol's admission, so it needs Greg's `dispose`;
 *  - not launched yet (`planned`, `waiting-admission`, `reserved`);
 *  - launched (`launching`, `observed-running`);
 *  - ended (`completed`, released);
 *  - failed with its slot released: free to try the next attempt.
 */
export type OccurrenceStanding =
  | { kind: "disposed" }
  | { kind: "stuck"; state: "outcome-unknown" | "completed" | "failed-before-launch"; why: string; disposeCommand: string }
  | { kind: "not-launched-yet"; state: "planned" | "waiting-admission" | "reserved" }
  | { kind: "launched"; state: "launching" | "observed-running" }
  | { kind: "ended" }
  | { kind: "failed-released" };

export function standingOf(occurrence: ResumeOccurrence): OccurrenceStanding {
  if (occurrence.disposed) return { kind: "disposed" };
  const stuck = (state: "outcome-unknown" | "completed" | "failed-before-launch", why: string): OccurrenceStanding => ({
    kind: "stuck",
    state,
    why,
    disposeCommand: disposeCommandFor(occurrence.occurrenceId),
  });
  switch (occurrence.state) {
    case "planned":
    case "waiting-admission":
    case "reserved":
      return { kind: "not-launched-yet", state: occurrence.state };
    case "launching":
    case "observed-running":
      return { kind: "launched", state: occurrence.state };
    case "outcome-unknown":
      return stuck("outcome-unknown", "the launch protocol cannot tell whether this resume started");
    case "completed":
      return occurrence.reservationHeld
        ? stuck("completed", "it has ended, but its launch slot has not been released, so no other resume can be admitted")
        : { kind: "ended" };
    case "failed-before-launch":
      return occurrence.reservationHeld ? stuck("failed-before-launch", "the launch failed before it started, and its slot has not been released") : { kind: "failed-released" };
    default: {
      const never: never = occurrence.state;
      throw new Error(`no standing for launch state ${String(never)}`);
    }
  }
}

export function occurrenceStep(occurrence: ResumeOccurrence | null): OccurrenceStep {
  if (occurrence === null) return { kind: "continue", attempt: 1 };
  const standing = standingOf(occurrence);
  switch (standing.kind) {
    // DISPOSED IS SETTLED WHATEVER THE STATE: Greg ended it, and nothing is launched again under it.
    case "disposed":
      return { kind: "settled", occurrence };
    case "stuck":
      // G14: a failed attempt still holding its slot keeps the request pending,
      // waiting for the release; any other stuck occurrence is the protocol's,
      // and the page shows it as needing Greg.
      return standing.state === "failed-before-launch" ? { kind: "defer", why: heldSlotWhy(occurrence.occurrenceId) } : { kind: "settled", occurrence };
    case "failed-released":
      return { kind: "continue", attempt: (occurrence.attempt ?? 0) + 1 };
    case "not-launched-yet":
      // G13: the protocol's reconciler never moves planned or waiting-admission
      // on its own, so a permanent defer would wait for ever: drive it. Reserved
      // IS the reconciler's (released as failed-before-launch after a restart),
      // and the next pass follows G14's released or held path.
      return standing.state === "reserved"
        ? { kind: "defer", why: "the launch protocol holds this resume as reserved; its own reconciliation settles it, and the next pass follows that" }
        : { kind: "drive", occurrence };
    case "launched":
    case "ended":
      return { kind: "settled", occurrence };
    default: {
      const never: never = standing;
      throw new Error(`no request step for standing ${JSON.stringify(never)}`);
    }
  }
}

/**
 * PACE (G2, G8): any UNDISPOSED in-flight recovery occurrence that is not
 * VERIFIED defers everything, with no timeout. Only the protocol's `dispose`
 * waives it — dismissing the candidate does not, because its session may
 * still be running. After the last verification, `RESUME_SPACING_MS`.
 */
export type Pace =
  | { kind: "free" }
  | { kind: "blocked"; blocker: ResumeOccurrence; why: string }
  /**
   * G19: a blocker only Greg's `dispose` moves (`standingOf`'s `stuck`). It
   * blocks whether or not it was ever verified: a held slot blocks the
   * protocol's admission either way. `reason` is the standing's own sentence.
   */
  | { kind: "stuck"; blocker: ResumeOccurrence; why: string; reason: string; disposeCommand: string }
  | { kind: "spacing"; untilMs: number };

export function paceOf(input: {
  /** The request being decided, whose own occurrence is not its own blocker; null for the page's reading. */
  candidateId: RecoveryCandidateId | null;
  inFlight: readonly ResumeOccurrence[];
  verified: (occurrence: ResumeOccurrence) => boolean;
  lastVerifiedAtMs: number | null;
  nowMs: number;
  nameOf: (candidateId: RecoveryCandidateId) => string;
}): Pace {
  for (const occurrence of input.inFlight) {
    if (occurrence.candidateId === input.candidateId) continue;
    const standing = standingOf(occurrence);
    const name = input.nameOf(occurrence.candidateId);
    switch (standing.kind) {
      case "disposed":
      case "ended":
      case "failed-released":
        continue;
      case "stuck":
        return {
          kind: "stuck",
          blocker: occurrence,
          reason: standing.why,
          disposeCommand: standing.disposeCommand,
          why: `waiting for ${name}: its launch needs Greg (${occurrence.state}: ${standing.why}); end it with: ${standing.disposeCommand}`,
        };
      case "not-launched-yet":
      case "launched":
        if (input.verified(occurrence)) continue;
        return { kind: "blocked", blocker: occurrence, why: `waiting for ${name} to be verified running (its launch is ${occurrence.state})` };
      default: {
        const never: never = standing;
        throw new Error(`no pace for standing ${JSON.stringify(never)}`);
      }
    }
  }
  if (input.lastVerifiedAtMs !== null && input.nowMs < input.lastVerifiedAtMs + RESUME_SPACING_MS) {
    return { kind: "spacing", untilMs: input.lastVerifiedAtMs + RESUME_SPACING_MS };
  }
  return { kind: "free" };
}

/** The request's facts against the current state, measured in the synchronous stretch. */
export type RevalidationFacts = {
  request: ResumeRequest;
  record: RecoveryRecord | undefined;
  inventory: InventoryTrust;
  /** The fresh locate, or null when the record has no verified conversation to look for. */
  located: LocatedTranscript | null;
  dir: { kind: "directory" } | { kind: "missing"; why: string };
  transcript: { kind: "file"; size: number; mtimeMs: number } | { kind: "missing"; why: string };
  account: RecoveryResumeAccount;
  /** G11: whether what the account resolution rested on is unchanged, checked in the synchronous stretch. */
  accountRecheck: AccountRecheck;
  producerCanVerify: boolean;
};

export type Revalidation =
  | { kind: "ok"; conversationId: string; dir: string; transcriptPath: string; size: number; mtimeMs: number; account: { name: string; configDir: string }; record: RecoveryRecord }
  | { kind: "refuse"; why: string }
  | { kind: "defer"; why: string };

/** What the collecting dashboard must declare before a resume may launch (G3). wire.ts § `ProducerCapability`. */
const VERIFY_RESUME_CAPABILITY: ProducerCapability = "argv-resume-uuid";

/**
 * G3's gate: whether the dashboard collecting this box can verify a resumed
 * session — it declares `argv-resume-uuid` on the latest ACCEPTED snapshot.
 *
 * A dashboard that does not (an older build, or a malformed list, which the
 * parser turns into none) would read `claude --resume <uuid>` as unreadable, so
 * the session would stay `claimed-only`, `resumed` would never be derived, and
 * the pace rule would wait for ever behind a session that is really running.
 * So revalidation DEFERS, never refuses: restarting the dashboard is the fix,
 * and the request should still be there when it is done.
 */
export function producerCanVerifyResume(observation: ResumeObservation): boolean {
  return observation.capabilities.includes(VERIFY_RESUME_CAPABILITY);
}

/**
 * REVALIDATION, all of plan § 2.6 plus the dispositions: against the current
 * state, never the view the person saw. First failure decides. Pure.
 */
export function revalidate(facts: RevalidationFacts): Revalidation {
  const { record, inventory, request } = facts;
  if (record === undefined) {
    return { kind: "refuse", why: "the record is no longer in the recovery index: resolved over 30 days ago, or past the index's capacity" };
  }
  if (record.resolution.disposition !== "unresolved") {
    return { kind: "refuse", why: `the record is already resolved as ${record.resolution.disposition} (at ${record.resolution.at})` };
  }
  // A failed collection is not evidence either way: wait for one we can trust, never refuse on it.
  if (inventory.kind === "untrusted") return { kind: "defer", why: `waiting for a trusted inventory: ${inventory.why}` };
  if (record.oversize || record.entry === null) return { kind: "refuse", why: "the record carries no register entry to resume from" };
  const conversation = verifiedConversationOf(record.lastSeen);
  if (conversation !== null) {
    const holder = inventory.rows.find((row) => liveExecutionOf(row)?.conversationId === conversation);
    if (holder !== undefined) return { kind: "refuse", why: `already resumed elsewhere: the live session ${holder.name} holds this conversation` };
  }
  const classification = classifyRecord(record, inventory);
  if (classification.kind !== "interrupted") return { kind: "refuse", why: `the record is ${classification.kind}, not interrupted: ${classification.why}` };
  if (record.lastSeen?.harness !== "claude-code") return { kind: "refuse", why: "only an interactive Claude Code session can be resumed here" };
  if (conversation === null) return { kind: "refuse", why: "there is no verified conversation to resume (a claim alone does not count)" };
  const dir = dirOfRecord(record);
  if (dir === null) return { kind: "refuse", why: "the launcher recorded no directory for this session" };
  if (request.seen.conversationId !== conversation || request.seen.dir !== dir) {
    return {
      kind: "refuse",
      why: `changed since you looked: the request saw ${request.seen.conversationId} in ${request.seen.dir}, and the record now says ${conversation} in ${dir}`,
    };
  }
  if (facts.dir.kind !== "directory") return { kind: "refuse", why: `the directory is missing: ${facts.dir.why}` };
  // THE TRANSCRIPT BEFORE THE ACCOUNT: the account is found FROM the
  // transcript, so a transcript that has gone is the reason, and "manual only"
  // would only be its symptom.
  if (facts.located === null || facts.located.kind !== "found" || facts.transcript.kind !== "file") {
    const why = facts.transcript.kind === "missing" ? facts.transcript.why : facts.located?.kind === "found" ? "" : (facts.located?.why ?? "");
    return { kind: "refuse", why: `the transcript is gone since the preview${why === "" ? "" : `: ${why}`}` };
  }
  // G11: AN ACCOUNT RESOLVED BEFORE AN AWAIT IS ONLY USED IF NOTHING IT RESTED
  // ON HAS MOVED. Defer, never refuse (the manual-only verdict could be stale
  // too): the next pass resolves again.
  if (facts.accountRecheck.kind === "changed") {
    return { kind: "defer", why: `the account this conversation runs under may have changed since it was resolved (${facts.accountRecheck.why}); it is resolved again on the next pass` };
  }
  if (facts.account.kind !== "pinned") return { kind: "refuse", why: `manual only: ${facts.account.why}` };
  if (!facts.producerCanVerify) {
    return { kind: "defer", why: "the dashboard collecting this box cannot yet verify a resumed session; it needs a restart" };
  }
  return {
    kind: "ok",
    conversationId: conversation,
    dir,
    transcriptPath: facts.located.path,
    size: facts.transcript.size,
    mtimeMs: facts.transcript.mtimeMs,
    account: { name: facts.account.name, configDir: facts.account.configDir },
    record,
  };
}

export type DecideInput = {
  nowMs: number;
  launcher: { kind: "wired" } | { kind: "unwired"; why: string };
  occurrence: ResumeOccurrence | null;
  pace: Pace;
  /** `healthGate` over the latest accepted snapshot's health, `RESUME_ON_UNKNOWN`. */
  health: LaunchGate;
  /** `quotaGateFor` the pinned account; null when no account is pinned, which revalidation then refuses. */
  quota: LaunchGate | null;
  revalidation: Revalidation;
};

export type ResumeDecision =
  | { kind: "defer"; why: string; until: string | null; gate: LaunchGate | null }
  | { kind: "refuse"; why: string }
  | { kind: "launch"; attempt: number; revalidation: Extract<Revalidation, { kind: "ok" }>; gate: LaunchGate }
  /** G13: continue the stored occurrence through the port's `drive`, after the same pace, gates and revalidation. */
  | { kind: "drive"; occurrence: ResumeOccurrence; revalidation: Extract<Revalidation, { kind: "ok" }>; gate: LaunchGate }
  | { kind: "settled"; occurrence: ResumeOccurrence };

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * THE DECISION, pure, first failure decides, in this order: the launcher is
 * wired; the occurrence table (G1); pace (G2, G8); the box's health; the
 * pinned account's quota; revalidation (§ 2.6).
 *
 * The gate comes before revalidation, as the plan orders it: a held gate
 * defers, and a deferred request is never refused. With no pinned account
 * there is no quota to judge, and revalidation refuses the request as manual
 * only.
 */
export function decideResume(input: DecideInput): ResumeDecision {
  const defer = (why: string, until: string | null = null, gate: LaunchGate | null = null): ResumeDecision => ({ kind: "defer", why, until, gate });
  if (input.launcher.kind === "unwired") return defer(input.launcher.why);
  const step = occurrenceStep(input.occurrence);
  switch (step.kind) {
    case "settled":
      return { kind: "settled", occurrence: step.occurrence };
    case "defer":
      return defer(step.why);
    case "continue":
    case "drive":
      break;
    default: {
      const never: never = step;
      throw new Error(`no step ${JSON.stringify(never)}`);
    }
  }
  switch (input.pace.kind) {
    case "blocked":
    case "stuck":
      return defer(input.pace.why);
    case "spacing":
      return defer("spacing the launches: the last resumed session is given two minutes to start before the next", iso(input.pace.untilMs));
    case "free":
      break;
    default: {
      const never: never = input.pace;
      throw new Error(`no pace ${JSON.stringify(never)}`);
    }
  }
  const gate = input.quota === null ? input.health : bothGates(input.health, input.quota);
  if (gate.kind === "held") return defer(gate.why, gate.until, gate);
  if (input.revalidation.kind === "refuse") return input.revalidation;
  if (input.revalidation.kind === "defer") return defer(input.revalidation.why, null, gate);
  return step.kind === "drive"
    ? { kind: "drive", occurrence: step.occurrence, revalidation: input.revalidation, gate }
    : { kind: "launch", attempt: step.attempt, revalidation: input.revalidation, gate };
}

// ═══ The pass ═════════════════════════════════════════════════════════════════

/** The daemon's state at one instant: what the pass recaptures in its synchronous stretch. */
export type ResumeObservation = {
  inventory: InventoryTrust;
  /** The latest accepted snapshot's opaque `health`, or null. */
  health: unknown;
  /**
   * The latest accepted snapshot's declared producer capabilities, `[]` before
   * one is accepted (tools/overseer/observation.ts). Read from the observation,
   * never held by the daemon: the Overseer's ruling on G3, 2026-09-10.
   */
  capabilities: readonly string[];
  /** A COPY of the index's records, so a snapshot taken before an await stays the snapshot it was. */
  index: RecoveryIndex;
};

export type ResumePassDeps = {
  root: string;
  now: () => Date;
  log: (line: string) => void;
  port: ResumeLaunchPort;
  accounts: ResumeAccountPort;
  evidence: EvidenceDeps;
  /** THE RECAPTURE. Called at the start of the pass, and again at the start of the synchronous stretch. */
  observe: () => ResumeObservation;
  /** The daemon's latest view, for the previews. */
  view: () => RecoveryView | null;
  /**
   * The daemon's per-account usage reading (`accountUsage` in its checkpoint,
   * on dev since 74634fd3), or null when it has none. Read in the synchronous
   * stretch, like everything else the gate decides on.
   */
  accountUsage: () => StoredAccountUsage | null;
  previewCache: PreviewCache;
  readRange?: ReadRange;
  /** Test seam: awaited at the end of the async phase, immediately before the synchronous stretch. */
  beforeRecapture?: () => Promise<void>;
};

export type ResumePassResult = {
  projection: RecoveryResumeProjection;
  /** What the pass did with the head of the queue, for the log and the tests. */
  head: { candidateId: string; decision: ResumeDecision["kind"]; outcome: ResumeLaunchOutcome["kind"] | null; why: string } | null;
};

type Group = { candidateId: RecoveryCandidateId; files: PendingResume[] };

function groupsOf(requests: readonly PendingResume[]): Group[] {
  const groups: Group[] = [];
  const byId = new Map<string, Group>();
  for (const pending of requests) {
    const id = pending.request.candidateId as RecoveryCandidateId;
    let group = byId.get(id);
    if (group === undefined) {
      group = { candidateId: id, files: [] };
      byId.set(id, group);
      groups.push(group);
    }
    group.files.push(pending);
  }
  return groups;
}

function statDir(path: string): RevalidationFacts["dir"] {
  try {
    return statSync(path).isDirectory() ? { kind: "directory" } : { kind: "missing", why: `${path} is not a directory` };
  } catch (cause) {
    return { kind: "missing", why: `${path}: ${errText(cause)}` };
  }
}

function statTranscript(located: LocatedTranscript | null): RevalidationFacts["transcript"] {
  if (located === null || located.kind !== "found") return { kind: "missing", why: located === null ? "no conversation to look for" : located.why };
  try {
    const info = statSync(located.path);
    return info.isFile() ? { kind: "file", size: info.size, mtimeMs: info.mtimeMs } : { kind: "missing", why: `${located.path} is not a file` };
  } catch (cause) {
    return { kind: "missing", why: `${located.path}: ${errText(cause)}` };
  }
}

/**
 * ONE PASS. **The order is load-bearing (Sol's G5)**:
 *
 *  1. list pending requests (bounded), coalesced by candidate; the head is the
 *     oldest `requestedAt`, then the candidate id;
 *  2. every await: locate the head's transcript, resolve its account, read the
 *     in-flight transcripts' tails, build the previews, and fetch the quota
 *     when everything cheaper has passed;
 *  3. then ONE SYNCHRONOUS STRETCH, with no await in it: recapture the
 *     daemon's state, recompute the classification and resolution, check no
 *     live row holds the conversation and that `seen` still matches, `statSync`
 *     the directory and the transcript, run the gate, pace and the occurrence
 *     table, decide, launch, and move the request files.
 *
 * A synchronous turn freezes the daemon's own state and nothing else: a person
 * typing `claude --resume` in a shell in that window is not prevented. That is
 * what gjd-remote's on-box check (Stage 3) and the verification are for.
 *
 * A crash between `launch` and the move leaves the requests pending; the next
 * pass finds the occurrence through `inspect`, and the table settles it.
 */
export async function runResumePass(deps: ResumePassDeps): Promise<ResumePassResult> {
  const startMs = deps.now().getTime();
  const readBytes = deps.readRange ?? readRange;
  const listing = await listPendingResumeRequests(deps.root, { nowMs: startMs, log: deps.log });
  const groups = groupsOf(listing.requests);
  const head = groups[0] ?? null;
  const before = deps.observe();
  const port = deps.port;

  // ── 2. The async phase ─────────────────────────────────────────────────────
  const locate = transcriptLocator(deps.evidence);
  let headLocated: LocatedTranscript | null = null;
  // G11: the account AND what it rested on; the synchronous stretch rechecks the latter.
  let headAccount: ResolvedAccount = unresolvedAccount({ kind: "unknown", reason: "not-resolved", why: "not resolved: nothing is at the head of the queue" });
  if (head !== null) {
    const record = before.index.records.get(head.candidateId);
    const conversation = record === undefined ? null : verifiedConversationOf(record.oversize ? null : record.lastSeen);
    if (record !== undefined && conversation !== null) {
      headLocated = await locate(conversation, dirOfRecord(record));
      headAccount =
        headLocated.kind === "found"
          ? await deps.accounts.resolve({ conversationId: conversation, transcriptPath: headLocated.path, transcriptRoot: headLocated.root })
          : unresolvedAccount({ kind: "unknown", reason: "no-transcript", why: "the transcript was not found, so its account cannot be established" });
    }
  }
  // The in-flight occurrences' transcripts, for verification (G2).
  const attemptsBefore = readResumeAttempts(deps.root);
  const inFlightBefore = port.kind === "wired" ? port.inFlight() : [];
  const readings = new Map<string, TranscriptReading | null>();
  for (const occurrence of inFlightBefore) {
    const attempt = attemptsBefore.get(occurrence.candidateId);
    if (attempt !== undefined && !readings.has(occurrence.candidateId)) {
      readings.set(occurrence.candidateId, await transcriptAfter(attempt.transcriptPath, attempt.transcriptSizeAtLaunch, readBytes));
    }
  }
  const previews = await buildPreviews(deps, before);
  if (head !== null) await deps.beforeRecapture?.();

  // ── 3. THE SYNCHRONOUS STRETCH — no await from here to the end ────────────
  const nowMs = deps.now().getTime();
  const observed = deps.observe();
  const attempts = readResumeAttempts(deps.root);
  const nameOf = (id: string): string => observed.index.records.get(id as RecoveryCandidateId)?.name ?? id;
  let result: ResumePassResult["head"] = null;
  let headGate: LaunchGate | null = null;
  let headDecision: ResumeDecision | null = null;
  let headMoved = false;
  if (head !== null) {
    const { decision } = decisionFor(deps, head, observed, headLocated, headAccount, readings, attempts, nowMs);
    headDecision = decision;
    headGate = decision.kind === "defer" || decision.kind === "launch" || decision.kind === "drive" ? decision.gate : null;
    const at = iso(nowMs);
    // G16: THE HEAD HAS MOVED ONLY WHEN EVERY FILE OF ITS GROUP MOVED. A file
    // that could not be moved is still pending on disk, so it stays pending on
    // the page, with the error, and the next pass settles it again (the
    // occurrence, not the file, is what stops a second launch).
    let moveError: string | null = null;
    const moved = (results: readonly MoveResult[], where: "done/" | "refused/"): void => {
      const failed = results.flatMap((r) => (r.ok ? [] : [r.why]));
      if (failed.length === 0) {
        headMoved = true;
        return;
      }
      moveError = `${failed.length} of ${results.length} of its request files could not be moved out of pending/ into ${where} (${failed[0]}); it is still pending, and the next pass tries again`;
      deps.log(`recovery resume: ${head.candidateId}: ${moveError}`);
    };
    const settleAll = (occurrenceId: string, outcome: string): void => {
      const attempt = attempts.get(head.candidateId);
      const results = head.files.map((file) =>
        moveToDone(deps.root, file.path, file.name, {
          settledAt: at,
          occurrenceId,
          outcome,
          launchedAt: attempt?.launchedAt ?? null,
          transcriptSizeAtLaunch: attempt?.transcriptSizeAtLaunch ?? null,
          transcriptMtimeAtLaunch: attempt?.transcriptMtimeAtLaunch ?? null,
          request: file.request,
        }),
      );
      moved(results, "done/");
    };
    const refuseAll = (why: string): void => {
      moved(
        head.files.map((file) => moveToRefused(deps.root, file.path, file.name, { refusedAt: at, why, request: file.request })),
        "refused/",
      );
    };
    let outcome: ResumeLaunchOutcome | null = null;
    let why = "";
    switch (decision.kind) {
      case "defer":
        why = decision.why;
        break;
      case "refuse":
        why = decision.why;
        refuseAll(decision.why);
        break;
      case "settled":
        why = `settled against ${decision.occurrence.occurrenceId} (${decision.occurrence.state})`;
        settleAll(decision.occurrence.occurrenceId, "settled");
        break;
      // G13: A DRIVE IS A LAUNCH OF A STORED OCCURRENCE. Same attempt file first
      // (its byte offset is G12's boundary), same outcome table after.
      case "launch":
      case "drive": {
        if (port.kind !== "wired") throw new Error(`a ${decision.kind} was decided with no wired port`);
        const r = decision.revalidation;
        // WHAT REVALIDATION MEASURED, ON DISK BEFORE THE LAUNCH, so a crash
        // between the launch and the move still leaves growth judgeable (G2).
        const recorded = writeResumeAttempt(deps.root, {
          v: 1,
          candidateId: head.candidateId,
          conversationId: r.conversationId,
          transcriptPath: r.transcriptPath,
          transcriptSizeAtLaunch: r.size,
          transcriptMtimeAtLaunch: r.mtimeMs,
          launchedAt: at,
          verifiedAt: null,
        });
        if (!recorded) {
          why = "the launch measurement could not be written, so nothing was launched";
          break;
        }
        attempts.set(head.candidateId, {
          v: 1,
          candidateId: head.candidateId,
          conversationId: r.conversationId,
          transcriptPath: r.transcriptPath,
          transcriptSizeAtLaunch: r.size,
          transcriptMtimeAtLaunch: r.mtimeMs,
          launchedAt: at,
          verifiedAt: null,
        });
        try {
          outcome =
            decision.kind === "drive"
              ? port.drive(head.candidateId)
              : port.launch({ candidateId: head.candidateId, conversationId: r.conversationId, dir: r.dir, account: r.account, nudge: nudgeFor(r.record) });
        } catch (cause) {
          // A THROW IS NOT AN ANSWER: whether it launched is for `inspect` to
          // say on the next pass. The requests stay pending.
          why = `the launch threw (${errText(cause)}); the next pass asks the launch protocol what happened`;
          break;
        }
        switch (outcome.kind) {
          case "invoked":
          case "not-launchable":
            why = `${outcome.kind}: ${outcome.occurrenceId}`;
            settleAll(outcome.occurrenceId, outcome.kind);
            break;
          case "failed-before-launch":
            // G1, G14: NOT A REFUSAL. The request stays pending. Released: the
            // next pass tries the next attempt through the gates and
            // revalidation again. Held: it waits for the release, and the
            // occurrence table says so with the dispose command.
            why =
              outcome.reservation.kind === "released"
                ? `the launch failed before it started (${outcome.why}); its slot was released, so the next pass tries again through the gates and revalidation`
                : `the launch failed before it started (${outcome.why}), and its slot was not released (${outcome.reservation.why}): ${heldSlotWhy(outcome.occurrenceId)}`;
            break;
          case "refused":
          case "conflict":
            why = `the launch protocol answered ${outcome.kind}: ${outcome.why}`;
            refuseAll(why);
            break;
          case "waiting":
          case "not-launched":
            why = `the launch protocol answered ${outcome.kind}: ${outcome.why}`;
            break;
          default: {
            const never: never = outcome;
            throw new Error(`no request step for launch outcome ${JSON.stringify(never)}`);
          }
        }
        break;
      }
      default: {
        const never: never = decision;
        throw new Error(`no request step for decision ${JSON.stringify(never)}`);
      }
    }
    result = { candidateId: head.candidateId, decision: decision.kind, outcome: outcome?.kind ?? null, why: moveError === null ? why : `${why}; but ${moveError}` };
  }
  // Verification, recorded ONCE per attempt, the first time all four hold.
  const inFlight = port.kind === "wired" ? port.inFlight() : [];
  for (const occurrence of inFlight) {
    const attempt = attempts.get(occurrence.candidateId);
    if (attempt === undefined || attempt.verifiedAt !== null) continue;
    const v = verificationOf(occurrence, observed.index.records.get(occurrence.candidateId), readings.get(occurrence.candidateId) ?? null, attempt);
    if (isVerified(v)) {
      const verified = { ...attempt, verifiedAt: iso(nowMs) };
      if (writeResumeAttempt(deps.root, verified)) attempts.set(occurrence.candidateId, verified);
    }
  }
  const projection = projectionOf({
    deps,
    nowMs,
    groups,
    head,
    headMoved,
    headDecision,
    headWhy: result?.why ?? null,
    headGate,
    overflow: listing.overflow,
    observed,
    attempts,
    readings,
    previews,
    nameOf,
  });
  return { projection, head: result };
}

/** The decision for the head against one observation. Synchronous: every fact it needs is in hand or `statSync`. */
function decisionFor(
  deps: ResumePassDeps,
  head: Group,
  observation: ResumeObservation,
  located: LocatedTranscript | null,
  resolved: ResolvedAccount,
  readings: ReadonlyMap<string, TranscriptReading | null>,
  attempts: ReadonlyMap<string, ResumeAttempt>,
  nowMs: number,
): { decision: ResumeDecision } {
  const port = deps.port;
  const account = resolved.account;
  const record = observation.index.records.get(head.candidateId);
  const request = (head.files[0] as PendingResume).request;
  const dir = record === undefined ? null : dirOfRecord(record);
  const revalidation = revalidate({
    request,
    record,
    inventory: observation.inventory,
    located,
    dir: dir === null ? { kind: "missing", why: "no directory recorded" } : statDir(dir),
    transcript: statTranscript(located),
    account,
    // G11: IN THE SYNCHRONOUS STRETCH, bounded: a few `stat`s and one `realpath`.
    accountRecheck: resolved.recheck(),
    producerCanVerify: producerCanVerifyResume(observation),
  });
  const inFlight = port.kind === "wired" ? port.inFlight() : [];
  const verified = (occurrence: ResumeOccurrence): boolean => {
    const attempt = attempts.get(occurrence.candidateId);
    if (attempt?.verifiedAt !== null && attempt?.verifiedAt !== undefined) return true;
    return isVerified(verificationOf(occurrence, observation.index.records.get(occurrence.candidateId), readings.get(occurrence.candidateId) ?? null, attempt));
  };
  let lastVerifiedAtMs: number | null = null;
  for (const attempt of attempts.values()) {
    if (attempt.verifiedAt === null) continue;
    const ms = Date.parse(attempt.verifiedAt);
    if (lastVerifiedAtMs === null || ms > lastVerifiedAtMs) lastVerifiedAtMs = ms;
  }
  for (const occurrence of inFlight) {
    const attempt = attempts.get(occurrence.candidateId);
    if ((attempt?.verifiedAt ?? null) === null && verified(occurrence)) lastVerifiedAtMs = Math.max(lastVerifiedAtMs ?? 0, nowMs);
  }
  const decision = decideResume({
    nowMs,
    launcher: port.kind === "wired" ? { kind: "wired" } : { kind: "unwired", why: port.why },
    occurrence: port.kind === "wired" ? port.inspect(head.candidateId) : null,
    pace: paceOf({
      candidateId: head.candidateId,
      inFlight,
      verified,
      lastVerifiedAtMs,
      nowMs,
      nameOf: (id) => observation.index.records.get(id)?.name ?? id,
    }),
    health: healthGate(observation.health, RESUME_ON_UNKNOWN),
    quota: account.kind === "pinned" ? quotaGateFor(deps.accountUsage(), account.name, nowMs) : null,
    revalidation,
  });
  return { decision };
}

/** Previews for the first page's unresolved records whose resume evidence is `supported`. */
async function buildPreviews(deps: ResumePassDeps, observation: ResumeObservation): Promise<RecoveryResumePreview[]> {
  const view = deps.view();
  if (view === null) return [];
  const out: RecoveryResumePreview[] = [];
  for (const item of view.page) {
    if (item.resolution.disposition !== "unresolved" || item.evidence?.kind !== "checked" || item.evidence.resume.kind !== "supported") continue;
    const record = observation.index.records.get(item.id);
    if (record === undefined) continue;
    const dir = dirOfRecord(record);
    if (dir === null) continue;
    const { conversationId, transcriptPath } = item.evidence.resume;
    // The transcript lives at <root>/<slug>/<uuid>.jsonl, so its root is two up.
    let account: RecoveryResumeAccount;
    try {
      const transcriptRoot = await realpath(dirname(dirname(transcriptPath)));
      account = (await deps.accounts.resolve({ conversationId, transcriptPath, transcriptRoot })).account;
    } catch (cause) {
      account = { kind: "unknown", reason: "no-transcript", why: `the transcript's projects directory could not be resolved: ${errText(cause)}` };
    }
    const quotes = await transcriptQuotes(transcriptPath, { cache: deps.previewCache, ...(deps.readRange === undefined ? {} : { readRange: deps.readRange }) });
    out.push({
      candidateId: item.id,
      conversationId,
      dir,
      title: quotes.title ?? (record.oversize ? null : (record.lastSeen?.title ?? null)),
      brief: quotes.brief,
      lastWords: quotes.lastWords,
      uncertainty: uncertaintyOf(item, record, account),
      nudge: nudgeFor(record),
      account,
    });
  }
  return out;
}

// ═══ The projection ═══════════════════════════════════════════════════════════

function launchWire(occurrence: ResumeOccurrence): RecoveryResumeLaunchWire {
  return {
    occurrenceId: occurrence.occurrenceId,
    state: occurrence.state,
    attempt: occurrence.attempt,
    reservationHeld: occurrence.reservationHeld,
    disposed: occurrence.disposed,
    endedAt: occurrence.endedAt,
    completion: occurrence.completion,
  };
}

function howItEnded(occurrence: ResumeOccurrence): string {
  const completion = occurrence.completion;
  if (completion === null) return "it ended before it was seen running";
  if (completion.kind === "rebooted") return "the machine rebooted before it was seen running";
  return `it exited${completion.code === null ? "" : ` with code ${completion.code}`} before it was seen running`;
}

/**
 * The state of a request whose launch is in the protocol's hands (a done/
 * record), from the occurrence as the protocol reports it now. Exhaustive over
 * the eight states (G1's page states).
 */
export function settledStateOf(input: {
  requestedAt: string;
  settledAt: string;
  occurrence: ResumeOccurrence;
  verification: RecoveryResumeVerification;
  verifiedAt: string | null;
}): RecoveryResumeRequestState {
  const { occurrence, requestedAt } = input;
  const launch = launchWire(occurrence);
  const standing = standingOf(occurrence);
  // STUCK BEFORE RESUMED (G19): a held slot blocks every other resume even
  // after this one was verified, and only Greg's dispose releases it.
  if (standing.kind === "stuck") return { kind: "needs-greg", requestedAt, launch, why: standing.why, disposeCommand: standing.disposeCommand };
  if (standing.kind !== "disposed" && input.verifiedAt !== null) return { kind: "resumed", requestedAt, launch, verifiedAt: input.verifiedAt };
  switch (standing.kind) {
    case "disposed":
      return { kind: "disposed", requestedAt, launch };
    case "not-launched-yet":
    case "launched":
      return { kind: "launched", requestedAt, launch, verification: input.verification, waitingFor: waitingForOf(input.verification) };
    case "ended":
      return { kind: "ended-unverified", requestedAt, launch, how: howItEnded(occurrence) };
    case "failed-released":
      return { kind: "refused", requestedAt, refusedAt: input.settledAt, why: "the launch failed before it started; Resume may be tapped again" };
    default: {
      const never: never = standing;
      throw new Error(`no page state for standing ${JSON.stringify(never)}`);
    }
  }
}

function projectionOf(input: {
  deps: ResumePassDeps;
  nowMs: number;
  groups: readonly Group[];
  head: Group | null;
  headMoved: boolean;
  headDecision: ResumeDecision | null;
  /** What the pass concluded for a head that stays pending (a launch answered `waiting`, a failed attempt, a failed move). */
  headWhy: string | null;
  headGate: LaunchGate | null;
  overflow: number;
  observed: ResumeObservation;
  attempts: ReadonlyMap<string, ResumeAttempt>;
  readings: ReadonlyMap<string, TranscriptReading | null>;
  previews: RecoveryResumePreview[];
  nameOf: (id: string) => string;
}): RecoveryResumeProjection {
  const { deps, nameOf } = input;
  const port = deps.port;
  const requests: RecoveryResumeProjection["requests"] = [];
  const shown = new Set<string>();
  // Pending, in queue order. A head that moved this pass is shown from its settled record below.
  const pendingGroups = input.headMoved ? input.groups.slice(1) : input.groups;
  pendingGroups.forEach((group, i) => {
    const oldest = group.files[0] as PendingResume;
    const isHead = !input.headMoved && i === 0 && input.headDecision !== null;
    const decision = isHead ? input.headDecision : null;
    requests.push({
      candidateId: group.candidateId,
      name: nameOf(group.candidateId),
      state: {
        kind: "pending",
        position: i + 1,
        requestedAt: oldest.request.requestedAt,
        actor: oldest.request.actor,
        why:
          decision !== null && decision.kind === "defer"
            ? decision.why
            : isHead
              ? input.headWhy !== null && input.headWhy !== ""
                ? input.headWhy
                : "being handled"
              : input.headMoved && i === 0
                ? "next: it is looked at on the next pass"
                : `waiting behind ${nameOf((pendingGroups[0] as Group).candidateId)}`,
        until: decision !== null && decision.kind === "defer" ? decision.until : null,
      },
    });
    shown.add(group.candidateId);
  });
  // Settled: the newest done/ or refused/ record per candidate not pending.
  const settled = readSettledResumes(deps.root);
  const newest = new Map<string, (typeof settled)[number]>();
  const atOf = (s: (typeof settled)[number]): number => Date.parse(s.kind === "done" ? s.body.settledAt : s.body.refusedAt);
  for (const s of settled) {
    const id = s.kind === "done" ? s.body.request.candidateId : (s.body.request?.candidateId ?? candidateOfName(s.name));
    if (id === null || shown.has(id)) continue;
    const held = newest.get(id);
    if (held === undefined || atOf(s) > atOf(held)) newest.set(id, s);
  }
  const refusedShown = [...newest.entries()]
    .filter(([, s]) => s.kind === "refused")
    .sort(([, a], [, b]) => atOf(b) - atOf(a))
    .slice(0, REFUSED_SHOWN)
    .map(([id]) => id);
  for (const [id, s] of newest) {
    if (s.kind === "refused") {
      if (!refusedShown.includes(id)) continue;
      requests.push({
        candidateId: id,
        name: nameOf(id),
        state: { kind: "refused", requestedAt: s.body.request?.requestedAt ?? s.body.refusedAt, refusedAt: s.body.refusedAt, why: s.body.why },
      });
      continue;
    }
    const occurrence = port.kind === "wired" ? port.inspect(id as RecoveryCandidateId) : null;
    if (occurrence === null) continue;
    const attempt = input.attempts.get(id);
    const verification = verificationOf(occurrence, input.observed.index.records.get(id as RecoveryCandidateId), input.readings.get(id) ?? null, attempt);
    requests.push({
      candidateId: id,
      name: nameOf(id),
      state: settledStateOf({
        requestedAt: s.body.request.requestedAt,
        settledAt: s.body.settledAt,
        occurrence,
        verification,
        verifiedAt: attempt?.verifiedAt ?? null,
      }),
    });
  }
  // Pace, as the page reads it: THE SAME `paceOf` the decision uses, with no request excluded.
  let pace: RecoveryResumeProjection["pace"] = { kind: "free" };
  if (port.kind === "wired") {
    let last: number | null = null;
    for (const attempt of input.attempts.values()) {
      if (attempt.verifiedAt !== null) last = Math.max(last ?? 0, Date.parse(attempt.verifiedAt));
    }
    const reading = paceOf({
      candidateId: null,
      inFlight: port.inFlight(),
      verified: (occurrence) => {
        const attempt = input.attempts.get(occurrence.candidateId);
        if (attempt?.verifiedAt !== null && attempt?.verifiedAt !== undefined) return true;
        return isVerified(verificationOf(occurrence, input.observed.index.records.get(occurrence.candidateId), input.readings.get(occurrence.candidateId) ?? null, attempt));
      },
      lastVerifiedAtMs: last,
      nowMs: input.nowMs,
      nameOf,
    });
    switch (reading.kind) {
      case "free":
        break;
      case "stuck":
        pace = {
          kind: "stuck",
          candidateId: reading.blocker.candidateId,
          name: nameOf(reading.blocker.candidateId),
          state: reading.blocker.state,
          why: reading.reason,
          disposeCommand: reading.disposeCommand,
        };
        break;
      case "blocked":
        pace = {
          kind: "waiting-for-verification",
          candidateId: reading.blocker.candidateId,
          name: nameOf(reading.blocker.candidateId),
          since: input.attempts.get(reading.blocker.candidateId)?.launchedAt ?? iso(input.nowMs),
        };
        break;
      case "spacing":
        pace = { kind: "spacing", until: iso(reading.untilMs) };
        break;
      default: {
        const never: never = reading;
        throw new Error(`no page pace for ${JSON.stringify(never)}`);
      }
    }
  }
  const gate: RecoveryResumeGateWire | null = input.headGate === null ? null : input.headGate;
  return {
    schema: 1,
    writtenAt: iso(input.nowMs),
    launcher: port.kind === "wired" ? { kind: "wired" } : { kind: "unwired", why: port.why },
    gate,
    pace,
    requests,
    previews: input.previews,
    // The pass does not know which records the file will hold; the store's write point fills this (G18).
    orphans: [],
    pendingOverflow: input.overflow,
  };
}
