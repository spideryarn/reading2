/**
 * THE RECOVERY VIEW — each record held up against the current verified
 * inventory, and the facts a person needs beside it.
 *
 * docs/plans/260910e-recovery-inventory-show-interrupted-work-without-resuming-it.md
 * § 4 is the design. The daemon runs this, **never a request**: after a change
 * to the fold, after each accepted inventory, and at most once a minute in any
 * case. The classification is pure; the evidence pass is async and bounded to
 * the first page.
 *
 * ## What this does not do
 *
 * **Nothing here starts, resumes or offers to resume anything, and no command
 * is synthesised** — from a title or from anything else. `resume: supported` is
 * a fact about what the next roadmap stage could do, not an instruction. The
 * `manual` arm gives a host and a directory, which the page and the CLI render
 * as a place to go and look.
 *
 * **No filesystem read is evidence that work was completed.** A missing
 * directory is a missing directory: it never resolves a record, and
 * `worktree:check` is not called.
 */
import { opendir, stat as fsStat } from "node:fs/promises";
import { homedir, hostname as osHostname } from "node:os";
import { join } from "node:path";

import { isClaudeSessionId, slugifyDir, type NotFoundReason } from "../fleet/transcript.js";
import { statusKey } from "./diff.js";
import type { ObservedRow } from "./observation.js";
import {
  isRetained,
  liveExecutionOf,
  verifiedConversationOf,
  type RecoveryCandidateId,
  type RecoveryIndex,
  type RecoveryRecord,
  type RecoveryResolution,
} from "./recovery.js";
import type { RegisterEntry } from "./store.js";

type FullRecord = Extract<RecoveryRecord, { oversize: false }>;

/**
 * Whether the daemon's latest inventory may be classified against.
 *
 * **`untrusted` is the first rule, and nothing in it looks at rows.** No
 * inventory accepted in this daemon's life; or the latest payload refused,
 * failed or held since the last accept. *An empty list from a failed collection
 * is not evidence of interruption*, and neither is the stale list before it.
 */
export type InventoryTrust =
  | { kind: "trusted"; rows: readonly ObservedRow[]; collectedAt: string; observation: string }
  | { kind: "untrusted"; why: string };

/** A live row's facts, shown beside a record that it may or may not be. */
export type LiveRowFacts = {
  tmuxId: string;
  name: string;
  dir: string | null;
  claimedConversationId: string | null;
  statusKey: string;
  executionToken: string | null;
  /** The conversation the row VERIFIABLY holds, or null. Never its claim. */
  conversationId: string | null;
};

/** The classification, first match wins — the plan's § 4 list, in its order. */
export type RecoveryClass =
  | { kind: "unknown"; why: string }
  /** `sameRun` false is a resumption, true is a run that was never gone, and null means the candidate recorded no token to compare. */
  | { kind: "already-live"; why: string; sameRun: boolean | null; row: LiveRowFacts }
  | { kind: "present-but-unmatched"; why: string; row: LiveRowFacts }
  | { kind: "ended-before-reboot"; why: string; statusKey: string; observedAt: string }
  | { kind: "interrupted"; why: string };

export type DirEvidence =
  | { kind: "exists"; path: string }
  | { kind: "missing"; path: string; why: string }
  /** Legacy launcher metadata, which carries no directory. */
  | { kind: "not-recorded"; why: string }
  /** The stat failed for a reason that is not absence — a permission, an I/O error. Not called missing. */
  | { kind: "cannot-tell"; path: string; why: string };

/**
 * `entry.worktree` is display text and never something to stat (Sol's F8). It is
 * `recorded` only when `meta.dir` itself is under `.claude/worktrees/<name>`,
 * and then `dir` already covers its existence.
 */
export type WorktreeEvidence =
  | { kind: "none" }
  | { kind: "recorded"; name: string; dir: string }
  | { kind: "not-recorded"; name: string; why: string };

export type TranscriptEvidence =
  | { kind: "found"; conversationId: string; path: string; via: "slug-guess" | "scan"; mtime: string | null }
  /** Found under the CLAIM, which outlives its conversation: shown, never trusted, never a resume. */
  | { kind: "found-under-claim"; claimedConversationId: string; path: string; mtime: string | null; why: string }
  | { kind: "not-found"; under: "verified" | "claim"; conversationId: string; reason: NotFoundReason; why: string }
  | { kind: "cannot-tell"; under: "verified" | "claim"; conversationId: string; why: string }
  | { kind: "no-conversation"; why: string };

export type ResumeEvidence =
  | { kind: "supported"; conversationId: string; transcriptPath: string }
  | { kind: "not-supported"; why: string }
  /** A shell or a manual job: a host and a directory to go and look at, and no resume claim. */
  | { kind: "manual"; host: string; dir: string | null; why: string };

export type RecoveryEvidence =
  | {
      kind: "checked";
      dir: DirEvidence;
      worktree: WorktreeEvidence;
      transcript: TranscriptEvidence;
      /** The later of the register's floor and a VERIFIED transcript's mtime. `register-floor` is a floor, and is drawn as one. */
      lastActivity: { at: string; source: "transcript" | "register-floor" };
      resume: ResumeEvidence;
    }
  /** An oversize stub or a legacy stub with no entry: there is nothing to check against. */
  | { kind: "unavailable"; why: string };

export type RecoveryViewItem = {
  id: RecoveryCandidateId;
  key: string;
  name: string;
  at: string;
  resolution: RecoveryResolution;
  /** Null for a resolved record: only unresolved records are classified. */
  classification: RecoveryClass | null;
  /** Null for a resolved record. */
  evidence: RecoveryEvidence | null;
};

/**
 * What goes into `recovery.json` beside the fold.
 *
 * **One clock for the whole pass**: `checkedAt` is when this pass began, and
 * every stat and every classification in it belongs to that instant.
 */
export type RecoveryView = {
  checkedAt: string;
  inventory: { kind: "trusted"; collectedAt: string; observation: string; rows: number } | { kind: "untrusted"; why: string };
  /** Unresolved first, newest disappearance first; then resolved. At most `RECOVERY_PAGE_SIZE`. */
  page: RecoveryViewItem[];
  /** Records the index holds past the first page. The CLI lists them; the page does not. */
  olderCount: number;
};

export const RECOVERY_PAGE_SIZE = 100;
/**
 * A hostile or accidental projects tree cannot turn one view pass into an
 * unbounded directory walk — and the bound must sit far above an ordinary box.
 * `~/.claude/projects` on the Hetzner box held 63 directories on 2026-09-10,
 * and every worktree adds one that is never removed, so the first bound (100)
 * would have reported `cannot-tell` within weeks. 2000 is thirty times today's
 * count, and the listing reads names only: nothing is opened, so a full
 * listing costs a few milliseconds.
 */
export const RECOVERY_TRANSCRIPT_PROJECT_DIR_LIMIT = 2000;

export type StatLike = { isDirectory(): boolean; isFile(): boolean; mtimeMs: number };

/** Injected so tests need no fake home: the projects directory, the stat, and the host name. */
export type EvidenceDeps = {
  projectsDir: string;
  stat: (path: string) => Promise<StatLike>;
  hostname: () => string;
};

/** The real ones, with any of them replaced. Resolved inside the call, never at module scope. */
export function evidenceDeps(overrides: { projectsDir?: string; stat?: EvidenceDeps["stat"]; hostname?: () => string } = {}): EvidenceDeps {
  return {
    projectsDir: overrides.projectsDir ?? join(homedir(), ".claude", "projects"),
    stat: overrides.stat ?? ((path: string) => fsStat(path)),
    hostname: overrides.hostname ?? osHostname,
  };
}

function dirOf(meta: RegisterEntry["meta"] | ObservedRow["meta"]): string | null {
  return meta.version === 1 ? meta.dir : null;
}

function factsOf(row: ObservedRow): LiveRowFacts {
  const execution = liveExecutionOf(row);
  return {
    tmuxId: row.id,
    name: row.name,
    dir: dirOf(row.meta),
    claimedConversationId: row.claimedConversationId,
    statusKey: statusKey(row.status),
    executionToken: row.execution.kind === "verified" ? (liveExecutionOf(row)?.token ?? null) : null,
    conversationId: execution?.conversationId ?? null,
  };
}

/**
 * One record against the inventory, first match wins. Pure.
 *
 * The order is the plan's, and the order is load-bearing: trust before any row
 * is looked at; proof of the same conversation before a mere resemblance; and
 * only a WATCHED last observation before any claim about what the world change
 * interrupted (Sol's F4), and only a world change that is actually established
 * as one (Sol's F1).
 */
export function classifyRecord(record: RecoveryRecord, inventory: InventoryTrust): RecoveryClass {
  if (inventory.kind === "untrusted") {
    return { kind: "unknown", why: `the current inventory cannot be trusted: ${inventory.why}` };
  }
  if (record.oversize) {
    return { kind: "unknown", why: "the record was too large for the index; the full candidate is in events.jsonl" };
  }
  const entry = record.entry;
  if (entry === null) {
    return { kind: "unknown", why: "no register entry survives for this session: the log never showed it being seen" };
  }

  const conversation = verifiedConversationOf(record.lastSeen);
  if (conversation !== null) {
    const matching: { row: ObservedRow; token: string }[] = [];
    for (const row of inventory.rows) {
      const live = liveExecutionOf(row);
      if (live === null || live.conversationId !== conversation) continue;
      matching.push({ row, token: live.token });
    }
    if (matching.length > 0) {
      const previousToken = record.lastSeen?.executionToken ?? null;
      const same = previousToken === null ? undefined : matching.find((item) => item.token === previousToken);
      const chosen = same ?? matching[0];
      if (chosen === undefined) throw new Error("a non-empty live match set had no first row");
      const sameRun = previousToken === null ? null : same !== undefined;
      return {
        kind: "already-live",
        sameRun,
        row: factsOf(chosen.row),
        why:
          sameRun === null
            ? "the same conversation is live, but the candidate recorded no execution token, so its run cannot be compared"
            : sameRun
              ? "the same conversation is live under the same run: it was never gone"
              : "the same conversation is live under a different run: it was resumed",
      };
    }
  }

  const dir = dirOf(entry.meta);
  for (const row of inventory.rows) {
    const sameClaim = entry.claimedConversationId !== null && row.claimedConversationId === entry.claimedConversationId;
    const sameNameAndDir = row.name === entry.name && dir !== null && dirOf(row.meta) === dir;
    if (sameClaim || sameNameAndDir) {
      return {
        kind: "present-but-unmatched",
        row: factsOf(row),
        why: sameClaim
          ? "a live row carries the same conversation claim, and nothing proves it is the same conversation"
          : "a live row has the same name and directory, and nothing proves it is the same conversation",
      };
    }
  }

  const d = record.disappearance;
  const last = record.lastSeen;
  if (d.watched && last !== null && (last.statusKey === "no-claude" || last.statusKey === "shell:false")) {
    return {
      kind: "ended-before-reboot",
      statusKey: last.statusKey,
      observedAt: last.collectedAt,
      why: `last observed stopped (${last.statusKey}) before the world change, at ${last.collectedAt}`,
    };
  }
  if (d.watched && (d.generation === "changed" || (d.generation === "unverifiable" && d.producerRun === "changed"))) {
    return {
      kind: "interrupted",
      why:
        d.generation === "changed"
          ? d.bootChanged
            ? "the host rebooted while this session was running"
            : "the tmux server was replaced while this session was running"
          : "the tmux server could not be read and the dashboard run changed: the first collection after a reboot",
    };
  }
  if (!d.watched) {
    return {
      kind: "unknown",
      why: "nobody watched it go: the daemon had no baseline, so nothing shows what it was doing at the world change",
    };
  }
  if (d.generation === "unverifiable") {
    return {
      kind: "unknown",
      why: "the tmux server could not be read and the dashboard run did not change, which cannot be told apart from the last session closing normally",
    };
  }
  return {
    kind: "unknown",
    why: "the dashboard restarted while this session ended, under an unchanged tmux server: nothing shows a world change",
  };
}

function isAbsence(cause: unknown): boolean {
  const code = (cause as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function errText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

async function dirEvidence(dir: string | null, deps: EvidenceDeps): Promise<DirEvidence> {
  if (dir === null) return { kind: "not-recorded", why: "the launcher's metadata is legacy and recorded no directory" };
  try {
    const info = await deps.stat(dir);
    return info.isDirectory() ? { kind: "exists", path: dir } : { kind: "missing", path: dir, why: "the path exists and is not a directory" };
  } catch (cause) {
    return isAbsence(cause) ? { kind: "missing", path: dir, why: "no such directory" } : { kind: "cannot-tell", path: dir, why: errText(cause) };
  }
}

function worktreeEvidence(entry: RegisterEntry, dir: string | null): WorktreeEvidence {
  if (entry.worktree === null) return { kind: "none" };
  const marker = `/.claude/worktrees/${entry.worktree}`;
  if (dir !== null && (dir.endsWith(marker) || dir.includes(`${marker}/`))) return { kind: "recorded", name: entry.worktree, dir };
  return {
    kind: "not-recorded",
    name: entry.worktree,
    why: "the worktree name is display text, and the recorded directory is not under .claude/worktrees/<name>, so no path is reconstructed",
  };
}

async function mtimeOf(path: string, deps: EvidenceDeps): Promise<string | null> {
  try {
    return new Date((await deps.stat(path)).mtimeMs).toISOString();
  } catch {
    return null;
  }
}

type LocatedTranscript =
  | { kind: "found"; path: string; via: "slug-guess" | "scan" }
  | { kind: "not-found"; reason: NotFoundReason; why: string }
  | { kind: "cannot-tell"; why: string };

/**
 * One bounded project-directory listing, shared by every record in a view pass.
 *
 * **A departure from the plan's § 4, which says to reuse `findTranscript`**
 * (tools/fleet/transcript.ts). That function lists the whole projects
 * directory with no bound, and this runs inside the daemon's view pass, so
 * reusing it as it stands would let one hostile or overgrown tree stall the
 * process everything else relies on (Sol's F20). The uuid check and
 * `slugifyDir` are imported from it rather than copied; the slug guess, the
 * newest-copy scan and the wording are repeated here, with the bound added.
 * The right end state is one BOUNDED locator in tools/fleet/transcript.ts that
 * both callers use, the dashboard with no cap and this with
 * `RECOVERY_TRANSCRIPT_PROJECT_DIR_LIMIT` (Sol's F26). That is a named
 * follow-up, because tools/fleet/ is outside this stage. Until it lands, a fix
 * to slugging, relocation or duplicate selection in `findTranscript` must be
 * made here too.
 */
function transcriptLookup(deps: EvidenceDeps): (conversationId: string, dir: string | null) => Promise<LocatedTranscript> {
  let projects:
    | Promise<{ kind: "listed"; names: string[]; complete: boolean } | { kind: "unavailable"; why: string }>
    | null = null;
  const listProjects = (): Promise<{ kind: "listed"; names: string[]; complete: boolean } | { kind: "unavailable"; why: string }> => {
    projects ??= (async () => {
      const names: string[] = [];
      try {
        const directory = await opendir(deps.projectsDir);
        let complete = true;
        for await (const item of directory) {
          if (names.length >= RECOVERY_TRANSCRIPT_PROJECT_DIR_LIMIT) {
            complete = false;
            break;
          }
          names.push(item.name);
        }
        return { kind: "listed" as const, names, complete };
      } catch (cause) {
        return { kind: "unavailable" as const, why: `could not list ${deps.projectsDir}: ${errText(cause)}` };
      }
    })();
    return projects;
  };
  const fileInfo = async (path: string): Promise<{ mtimeMs: number } | null> => {
    try {
      const info = await deps.stat(path);
      return info.isFile() ? { mtimeMs: info.mtimeMs } : null;
    } catch {
      return null;
    }
  };
  return async (conversationId, dir) => {
    if (!isClaudeSessionId(conversationId)) {
      return {
        kind: "not-found",
        reason: "malformed-claude-session-id",
        why: "the session's conversation id is not a uuid, so there is no transcript path to look at",
      };
    }
    const filename = `${conversationId}.jsonl`;
    if (dir !== null && dir !== "") {
      const guess = join(deps.projectsDir, slugifyDir(dir), filename);
      if ((await fileInfo(guess)) !== null) return { kind: "found", path: guess, via: "slug-guess" };
    }
    const listed = await listProjects();
    if (listed.kind === "unavailable") return { kind: "not-found", reason: "no-projects-directory", why: listed.why };
    let best: { path: string; mtimeMs: number } | null = null;
    for (const name of listed.names) {
      const path = join(deps.projectsDir, name, filename);
      const info = await fileInfo(path);
      if (info !== null && (best === null || info.mtimeMs > best.mtimeMs)) best = { path, mtimeMs: info.mtimeMs };
    }
    // A transcript the bounded listing already found EXISTS, and that is all
    // `found` and `resume: supported` claim. An unlisted directory could hold a
    // newer copy, but a uuid was under exactly one slug for all 244 transcripts
    // on this box (transcript.ts § `findTranscript`), so reporting `cannot-tell`
    // over a real file would hide the common case to guard the rare one.
    if (best !== null) return { kind: "found", path: best.path, via: "scan" };
    if (!listed.complete) {
      return {
        kind: "cannot-tell",
        why: `the transcript search stopped after ${RECOVERY_TRANSCRIPT_PROJECT_DIR_LIMIT} project directories without finding it, so it cannot say whether one of the rest holds it`,
      };
    }
    return {
      kind: "not-found",
      reason: "no-transcript-file",
      why: `no transcript for this conversation in ${deps.projectsDir} (looked in all ${listed.names.length} project directories)`,
    };
  };
}

async function transcriptEvidence(
  record: FullRecord,
  entry: RegisterEntry,
  dir: string | null,
  deps: EvidenceDeps,
  locate: (conversationId: string, dir: string | null) => Promise<LocatedTranscript>,
): Promise<TranscriptEvidence> {
  const verified = verifiedConversationOf(record.lastSeen);
  if (verified !== null) {
    const found = await locate(verified, dir);
    if (found.kind === "not-found") return { kind: "not-found", under: "verified", conversationId: verified, reason: found.reason, why: found.why };
    if (found.kind === "cannot-tell") return { kind: "cannot-tell", under: "verified", conversationId: verified, why: found.why };
    return { kind: "found", conversationId: verified, path: found.path, via: found.via, mtime: await mtimeOf(found.path, deps) };
  }
  const claim = entry.claimedConversationId;
  if (claim === null) return { kind: "no-conversation", why: "the session carried neither a verified conversation nor a claim" };
  const found = await locate(claim, dir);
  if (found.kind === "not-found") return { kind: "not-found", under: "claim", conversationId: claim, reason: found.reason, why: found.why };
  if (found.kind === "cannot-tell") return { kind: "cannot-tell", under: "claim", conversationId: claim, why: found.why };
  return {
    kind: "found-under-claim",
    claimedConversationId: claim,
    path: found.path,
    mtime: await mtimeOf(found.path, deps),
    why: "unverified: found under the tmux environment's claim, which outlives its conversation",
  };
}

function isManual(record: FullRecord, entry: RegisterEntry): boolean {
  if (record.lastSeen?.harness === "shell") return true;
  if (entry.lastStatusKey.startsWith("shell:")) return true;
  return entry.meta.version === 1 && entry.meta.kind !== null && entry.meta.kind !== "claude";
}

function resumeEvidence(record: FullRecord, entry: RegisterEntry, dir: string | null, transcript: TranscriptEvidence, deps: EvidenceDeps): ResumeEvidence {
  if (isManual(record, entry)) {
    return { kind: "manual", host: deps.hostname(), dir, why: "a shell or a manual job: there is nothing to resume, only a place to go and look" };
  }
  const harness = record.lastSeen?.harness ?? null;
  switch (harness) {
    case null:
      return { kind: "not-supported", why: "no verified execution was seen, so the harness is not known" };
    case "codex-batch":
    case "codex-interactive":
      return { kind: "not-supported", why: "resume is not wired for Codex in v1" };
    case "claude-headless":
      return { kind: "not-supported", why: "a headless Claude run is not resumed interactively" };
    case "unknown":
      return { kind: "not-supported", why: "the harness could not be named" };
    case "shell":
      return { kind: "not-supported", why: "a shell has nothing to resume" };
    case "claude-code":
      break;
    default: {
      const never: never = harness;
      throw new Error(`no resume rule for harness ${String(never)}`);
    }
  }
  if (transcript.kind === "found") {
    return { kind: "supported", conversationId: transcript.conversationId, transcriptPath: transcript.path };
  }
  if (transcript.kind === "not-found" && transcript.under === "verified") {
    return { kind: "not-supported", why: `the transcript of its verified conversation was not found: ${transcript.why}` };
  }
  if (transcript.kind === "cannot-tell" && transcript.under === "verified") {
    return { kind: "not-supported", why: `the transcript of its verified conversation could not be checked safely: ${transcript.why}` };
  }
  return { kind: "not-supported", why: "there is no verified conversation to resume (a claim alone does not count)" };
}

/** The facts for one record. Async: a stat of the directory, and a transcript lookup with one stat of what it found. */
export async function recoveryEvidence(
  record: RecoveryRecord,
  deps: EvidenceDeps,
  locate = transcriptLookup(deps),
): Promise<RecoveryEvidence> {
  if (record.oversize) return { kind: "unavailable", why: "the record was too large for the index; the full candidate is in events.jsonl" };
  const entry = record.entry;
  if (entry === null) return { kind: "unavailable", why: "no register entry survives for this session" };
  const dir = dirOf(entry.meta);
  const transcript = await transcriptEvidence(record, entry, dir, deps, locate);
  const floor = entry.lastSeenAlive;
  const lastActivity =
    transcript.kind === "found" && transcript.mtime !== null && Date.parse(transcript.mtime) > Date.parse(floor)
      ? { at: transcript.mtime, source: "transcript" as const }
      : { at: floor, source: "register-floor" as const };
  return {
    kind: "checked",
    dir: await dirEvidence(dir, deps),
    worktree: worktreeEvidence(entry, dir),
    transcript,
    lastActivity,
    resume: resumeEvidence(record, entry, dir, transcript, deps),
  };
}

/** The index's order: unresolved first, newest disappearance first, then resolved the same way. */
export function recoveryOrder(a: RecoveryRecord, b: RecoveryRecord): number {
  const ua = a.resolution.disposition === "unresolved" ? 0 : 1;
  const ub = b.resolution.disposition === "unresolved" ? 0 : 1;
  if (ua !== ub) return ua - ub;
  const byAt = Date.parse(b.at) - Date.parse(a.at);
  if (byAt !== 0) return byAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The whole pass: the first page, classified and evidenced, under one clock.
 *
 * **The records are copied before the first await.** The index is the store's
 * live fold, and a disposition folded mid-pass would otherwise move a record
 * between two of its own checks. A record is replaced, never mutated, when it
 * is resolved, so the copy is a consistent snapshot.
 *
 * Sequential rather than `Promise.all`: a hundred records is a few hundred
 * stats, and the daemon is the process you want responsive when everything
 * else is busy.
 *
 * **Retention is applied here too, with the same predicate** (recovery.ts §
 * `isRetained`). The store prunes the fold inside the `checkpoint()` that
 * publishes this view, after the view was built, so a record past its 30 days
 * would otherwise be on the page of a file whose `records` no longer hold it
 * (Sol's F24). One narrow window remains: a record that crosses the line
 * between `checkedAt` and that checkpoint's clock, which the next pass removes.
 */
export async function buildRecoveryView(
  index: RecoveryIndex,
  inventory: InventoryTrust,
  deps: EvidenceDeps & { now: () => Date },
): Promise<RecoveryView> {
  const checkedAtMs = deps.now().getTime();
  const checkedAt = new Date(checkedAtMs).toISOString();
  const records = [...index.records.values()].filter((record) => isRetained(record, checkedAtMs)).sort(recoveryOrder);
  const first = records.slice(0, RECOVERY_PAGE_SIZE);
  const page: RecoveryViewItem[] = [];
  const locate = transcriptLookup(deps);
  for (const record of first) {
    const unresolved = record.resolution.disposition === "unresolved";
    page.push({
      id: record.id,
      key: record.key,
      name: record.name,
      at: record.at,
      resolution: record.resolution,
      classification: unresolved ? classifyRecord(record, inventory) : null,
      evidence: unresolved ? await recoveryEvidence(record, deps, locate) : null,
    });
  }
  return {
    checkedAt,
    inventory:
      inventory.kind === "trusted"
        ? { kind: "trusted", collectedAt: inventory.collectedAt, observation: inventory.observation, rows: inventory.rows.length }
        : { kind: "untrusted", why: inventory.why },
    page,
    olderCount: records.length - first.length,
  };
}
