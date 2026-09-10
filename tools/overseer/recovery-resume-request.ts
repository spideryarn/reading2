/**
 * A RESUME REQUEST, AS A FILE — the one definition of its format, shared by
 * the dashboard's POST route (tools/fleet/), the CLI's `resume <id>` and the
 * daemon's resume pass. docs/plans/260910f-gradual-recovery-resume-selected-interrupted-work-one-at-a-time.md
 * § 1, as revised by Sol's G10.
 *
 * **A LEAF: node builtins only.** `tools/fleet/` imports this, and the fleet may
 * not reach the Overseer store's graph (tests/fleet-attention.test.ts, "imports
 * only the Overseer modules that were argued for"). So the candidate id is a
 * plain string here, checked against `CANDIDATE_ID_PATTERN`, and the daemon
 * brands it on its own side.
 *
 * ## The directory
 *
 *     recovery-resume/
 *       pending/<candidateId>--<nonce>.json   one per tap; never overwritten
 *       done/<candidateId>--<nonce>.json      the launch protocol had an answer
 *       refused/<candidateId>--<nonce>.json   revalidation or the protocol refused, with why
 *       attempts/<candidateId>.json           what revalidation measured, written just before a launch
 *       junk/                                 anything in pending/ that is positively not a request
 *
 * **The file name guarantees nothing about duplicates** (Sol's G10). Two taps
 * are two files; the daemon coalesces them by candidate, and the LAUNCH
 * OCCURRENCE — one per candidate, in the launch protocol — is the only
 * duplicate-launch guarantee. `pendingFor` exists for the route's courtesy
 * answer ("already requested"), which is a courtesy and not a lock.
 *
 * ## Why no processing/ directory, unlike recovery-inbox.ts
 *
 * The inbox claims a request before an asynchronous append. The resume pass
 * decides, launches and moves in ONE SYNCHRONOUS STRETCH, so there is no await
 * during which a claim would protect anything. A crash between the launch and
 * the move leaves the request in pending/, and the next pass finds the
 * occurrence through the launch protocol's `inspect` and settles it.
 */
import { randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  opendirSync,
  readSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { lstat, mkdir, open, opendir, rename } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

export const RECOVERY_RESUME_DIR = "recovery-resume";
export const RESUME_PENDING_DIR = "pending";
export const RESUME_DONE_DIR = "done";
export const RESUME_REFUSED_DIR = "refused";
export const RESUME_ATTEMPTS_DIR = "attempts";
export const RESUME_JUNK_DIR = "junk";

/**
 * A recovery candidate id: `rc-` or `rl-` and 20 hex digits (recovery.ts §
 * `recoveryCandidateId`). The ONE copy of the pattern — recovery-inbox.ts's
 * `isCandidateId` uses this, so the two request kinds cannot disagree about
 * what an id is.
 */
export const CANDIDATE_ID_PATTERN = /^r[cl]-[0-9a-f]{20}$/;
/** 16 random bytes in hex. A nonce, not a secret: it only keeps two taps' files apart. */
const NONCE_PATTERN = /^[0-9a-f]{32}$/;
/** A Claude conversation id: a lowercase uuid, as `claude` writes it. */
const CONVERSATION_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REQUEST_NAME = /^(r[cl]-[0-9a-f]{20})--([0-9a-f]{32})\.json$/;
const ATTEMPT_NAME = /^(r[cl]-[0-9a-f]{20})\.json$/;

/** Past this a request file is refused unread: a real one is about 400 bytes. */
export const RESUME_REQUEST_MAX_BYTES = 16 * 1024;
/** A directory path we will carry. Linux's PATH_MAX. */
const DIR_MAX_CHARS = 4096;
/** Entries examined per pending scan, junk included, so a flood costs a bounded pass (the inbox's F22 lesson). */
export const RESUME_SCAN_LIMIT = 200;
/** Names counted past the scan limit, for the overflow figure. Past this the count is a floor. */
const RESUME_OVERFLOW_COUNT_LIMIT = 5000;
/** Entries read per settled-directory listing (done/, refused/, attempts/). */
export const RESUME_SETTLED_SCAN_LIMIT = 1000;
/** A `.tmp-` sibling younger than this may be a writer still writing; older, its writer is gone. */
const TEMP_GRACE_MS = 60_000;

export function isCandidateIdText(value: unknown): value is string {
  return typeof value === "string" && CANDIDATE_ID_PATTERN.test(value);
}

export type ResumeRequestActor = "dashboard" | "cli";

/** What the person was looking at when they tapped. Revalidation refuses when it no longer matches. */
export type ResumeSeen = { checkedAt: string; conversationId: string; dir: string };

export type ResumeRequest = {
  v: 1;
  candidateId: string;
  requestedAt: string;
  actor: ResumeRequestActor;
  nonce: string;
  seen: ResumeSeen;
};

function isObject(u: unknown): u is Record<string, unknown> {
  return typeof u === "object" && u !== null && !Array.isArray(u);
}

function isIso(u: unknown): u is string {
  if (typeof u !== "string") return false;
  const ms = Date.parse(u);
  return Number.isFinite(ms) && new Date(ms).toISOString() === u;
}

function errText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function isAbsence(cause: unknown): boolean {
  const code = (cause as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/** What is wrong with `seen`, or null. Shared by the writer and the parser, so they cannot disagree. */
function seenProblem(u: unknown): string | null {
  if (!isObject(u)) return "seen is not an object";
  if (!isIso(u["checkedAt"])) return "seen.checkedAt is not an ISO timestamp";
  if (typeof u["conversationId"] !== "string" || !CONVERSATION_PATTERN.test(u["conversationId"])) {
    return "seen.conversationId is not a Claude conversation id";
  }
  const dir = u["dir"];
  if (typeof dir !== "string" || !isAbsolute(dir) || dir.length > DIR_MAX_CHARS || dir.includes("\0")) {
    return "seen.dir is not an absolute directory path";
  }
  return null;
}

/**
 * The request in a file's bytes. **Strict, and it never throws**: anything it
 * cannot read is `{ ok: false }` with a sentence. When `fileName` is given, the
 * candidate id and the nonce must agree with it.
 */
export function parseResumeRequest(text: string, fileName?: string): { ok: true; value: ResumeRequest } | { ok: false; why: string } {
  let u: unknown;
  try {
    u = JSON.parse(text);
  } catch (cause) {
    return { ok: false, why: `the request is not JSON: ${errText(cause)}` };
  }
  if (!isObject(u)) return { ok: false, why: "the request is not an object" };
  if (u["v"] !== 1) return { ok: false, why: `v ${JSON.stringify(u["v"])} is not 1` };
  const { candidateId, requestedAt, actor, nonce, seen } = u;
  if (!isCandidateIdText(candidateId)) return { ok: false, why: "candidateId is not a recovery candidate id" };
  if (!isIso(requestedAt)) return { ok: false, why: "requestedAt is not an ISO timestamp" };
  if (actor !== "dashboard" && actor !== "cli") return { ok: false, why: "actor is neither dashboard nor cli" };
  if (typeof nonce !== "string" || !NONCE_PATTERN.test(nonce)) return { ok: false, why: "nonce is not 32 hex digits" };
  const problem = seenProblem(seen);
  if (problem !== null) return { ok: false, why: problem };
  if (fileName !== undefined) {
    const match = REQUEST_NAME.exec(fileName);
    if (match === null || match[1] !== candidateId || match[2] !== nonce) {
      return { ok: false, why: "the file's name does not match the request's candidate id and nonce" };
    }
  }
  const s = seen as Record<string, string>;
  return {
    ok: true,
    value: {
      v: 1,
      candidateId,
      requestedAt,
      actor,
      nonce,
      seen: { checkedAt: s["checkedAt"] as string, conversationId: s["conversationId"] as string, dir: s["dir"] as string },
    },
  };
}

export function resumeRequestName(candidateId: string, nonce: string): string {
  return `${candidateId}--${nonce}.json`;
}

function fsyncDirectory(directory: string): void {
  try {
    const fd = openSync(directory, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    /* Not every platform lets a directory be opened and synced. */
  }
}

/**
 * `text` at `path`, all or nothing: a temp sibling written with `O_EXCL`,
 * fsynced, then LINKED to the final name (which fails if that name exists, so
 * nothing is ever overwritten), the temp unlinked, and the directory fsynced.
 * A reader never sees a torn file under the final name.
 */
function createExclusively(directory: string, name: string, text: string): { ok: true; path: string } | { ok: false; why: string } {
  const path = join(directory, name);
  const temp = join(directory, `.tmp-${process.pid}-${randomBytes(8).toString("hex")}`);
  try {
    const fd = openSync(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try {
      const bytes = Buffer.from(text, "utf8");
      let written = 0;
      while (written < bytes.length) written += writeSync(fd, bytes, written, bytes.length - written);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    linkSync(temp, path);
  } catch (cause) {
    try {
      unlinkSync(temp);
    } catch {
      /* The temp may never have been created. */
    }
    return { ok: false, why: `could not write ${name}: ${errText(cause)}` };
  }
  try {
    unlinkSync(temp);
  } catch {
    /* A stale temp is quarantined by the next scan. */
  }
  fsyncDirectory(directory);
  return { ok: true, path };
}

/**
 * `text` at `path`, replacing what was there: temp, fsync, rename, fsync the
 * directory. For the daemon's own files (done/, refused/, attempts/), where
 * the daemon is the only writer.
 */
function replaceAtomically(directory: string, name: string, text: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temp = join(directory, `.tmp-${process.pid}-${randomBytes(8).toString("hex")}`);
  const fd = openSync(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try {
    const bytes = Buffer.from(text, "utf8");
    let written = 0;
    while (written < bytes.length) written += writeSync(fd, bytes, written, bytes.length - written);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, join(directory, name));
  fsyncDirectory(directory);
}

/**
 * One request, written atomically under a fresh nonce. Refuses bad input
 * before creating anything. Two calls for one candidate are two files, and
 * that is correct: see the module comment.
 */
export function writeResumeRequest(
  root: string,
  input: { candidateId: string; actor: ResumeRequestActor; seen: ResumeSeen; now?: Date },
): { kind: "written"; path: string; request: ResumeRequest } | { kind: "refused"; why: string } {
  if (!isCandidateIdText(input.candidateId)) return { kind: "refused", why: "the id is not a recovery candidate id (rc-… or rl-… with 20 hex digits)" };
  if (input.actor !== "dashboard" && input.actor !== "cli") return { kind: "refused", why: "the actor is neither dashboard nor cli" };
  const problem = seenProblem(input.seen);
  if (problem !== null) return { kind: "refused", why: problem };
  const request: ResumeRequest = {
    v: 1,
    candidateId: input.candidateId,
    requestedAt: (input.now ?? new Date()).toISOString(),
    actor: input.actor,
    nonce: randomBytes(16).toString("hex"),
    seen: { checkedAt: input.seen.checkedAt, conversationId: input.seen.conversationId, dir: input.seen.dir },
  };
  const pending = join(root, RECOVERY_RESUME_DIR, RESUME_PENDING_DIR);
  try {
    mkdirSync(pending, { recursive: true, mode: 0o700 });
  } catch (cause) {
    return { kind: "refused", why: `could not create ${pending}: ${errText(cause)}` };
  }
  const written = createExclusively(pending, resumeRequestName(request.candidateId, request.nonce), `${JSON.stringify(request, null, 2)}\n`);
  return written.ok ? { kind: "written", path: written.path, request } : { kind: "refused", why: written.why };
}

/**
 * Whether a pending request for this candidate exists — the route's courtesy
 * answer, **never a duplicate guard**. Synchronous and bounded: names only,
 * `RESUME_SCAN_LIMIT` of them. `cannot-tell` when the directory could not be
 * read or the scan stopped at its bound without finding one.
 */
export function pendingFor(root: string, candidateId: string): { kind: "pending" } | { kind: "none" } | { kind: "cannot-tell"; why: string } {
  if (!isCandidateIdText(candidateId)) return { kind: "none" };
  const pending = join(root, RECOVERY_RESUME_DIR, RESUME_PENDING_DIR);
  let dir: ReturnType<typeof opendirSync>;
  try {
    dir = opendirSync(pending);
  } catch (cause) {
    return isAbsence(cause) ? { kind: "none" } : { kind: "cannot-tell", why: errText(cause) };
  }
  try {
    let examined = 0;
    for (let entry = dir.readSync(); entry !== null; entry = dir.readSync()) {
      if (examined >= RESUME_SCAN_LIMIT) return { kind: "cannot-tell", why: `the pending scan stopped at its limit of ${RESUME_SCAN_LIMIT}` };
      examined += 1;
      const match = REQUEST_NAME.exec(entry.name);
      if (match !== null && match[1] === candidateId && entry.isFile()) return { kind: "pending" };
    }
    return { kind: "none" };
  } finally {
    dir.closeSync();
  }
}

/** A pending request the lister read and parsed. `path` is its file. */
export type PendingResume = { path: string; name: string; request: ResumeRequest };

export type PendingListing = {
  requests: PendingResume[];
  /** Entries past the scan limit: on disk, not examined this pass. A floor when `overflowCapped`. */
  overflow: number;
  overflowCapped: boolean;
};

/** Settle-time body for a file moved to refused/: the request, when, and why. */
export type RefusedResume = { refusedAt: string; why: string; request: ResumeRequest | null; raw?: string };

/**
 * The pending requests, bounded, oldest first (`requestedAt`, then candidate
 * id, then nonce). The lessons of recovery-inbox.ts's F18 and F22:
 *
 *  - `O_NOFOLLOW` and a bounded read, so a symlink or a huge file costs nothing;
 *  - the scan limit COUNTS junk, and junk is moved to `junk/` as it is counted,
 *    so the next pass examines entries this one did not;
 *  - **quarantine only what is positively identified as junk**: a name that is
 *    not a request's, a symlink or anything that is not a regular file (by
 *    `lstat`), a stale temp. A regular file under a request's name that cannot
 *    be opened this time stays where it is. One that opens and does not parse
 *    is a REQUEST that is wrong, not junk: it goes to `refused/` with why, so a
 *    person can see what was refused.
 */
export async function listPendingResumeRequests(
  root: string,
  options: { nowMs: number; log: (line: string) => void; scanLimit?: number },
): Promise<PendingListing> {
  const base = join(root, RECOVERY_RESUME_DIR);
  const pending = join(base, RESUME_PENDING_DIR);
  const scanLimit = options.scanLimit ?? RESUME_SCAN_LIMIT;
  const out: PendingListing = { requests: [], overflow: 0, overflowCapped: false };
  let handle: Awaited<ReturnType<typeof opendir>>;
  try {
    handle = await opendir(pending);
  } catch (cause) {
    if (!isAbsence(cause)) options.log(`recovery resume: ${pending} could not be listed: ${errText(cause)}`);
    return out;
  }
  const quarantine = async (name: string): Promise<void> => {
    try {
      const junk = join(base, RESUME_JUNK_DIR);
      await mkdir(junk, { recursive: true, mode: 0o700 });
      await rename(join(pending, name), join(junk, `${randomBytes(8).toString("hex")}-${name.slice(0, 180)}`));
    } catch (cause) {
      if (!isAbsence(cause)) options.log(`recovery resume: ${JSON.stringify(name.slice(0, 180))} could not be moved to ${RESUME_JUNK_DIR}/: ${errText(cause)}`);
    }
  };
  let examined = 0;
  for await (const item of handle) {
    if (examined >= scanLimit) {
      // COUNT, DO NOT READ: names past the bound cost a directory entry each,
      // up to a second, larger bound past which the figure is a floor.
      if (out.overflow >= RESUME_OVERFLOW_COUNT_LIMIT) {
        out.overflowCapped = true;
        break;
      }
      if (REQUEST_NAME.test(item.name)) out.overflow += 1;
      continue;
    }
    examined += 1;
    const name = item.name;
    const path = join(pending, name);
    if (name.startsWith(".tmp-")) {
      let young = true;
      try {
        young = options.nowMs - (await lstat(path)).mtimeMs < TEMP_GRACE_MS;
      } catch {
        /* Gone already: nothing to move. */
      }
      if (!young) await quarantine(name);
      continue;
    }
    if (!REQUEST_NAME.test(name)) {
      await quarantine(name);
      continue;
    }
    let file: Awaited<ReturnType<typeof open>> | null = null;
    let text: string | null = null;
    let tooBig = false;
    try {
      file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const info = await file.stat();
      if (!info.isFile()) {
        await file.close().catch(() => {});
        file = null;
        await quarantine(name);
        continue;
      }
      const bytes = Buffer.alloc(RESUME_REQUEST_MAX_BYTES + 1);
      let read = 0;
      while (read < bytes.length) {
        const part = await file.read(bytes, read, bytes.length - read, read);
        if (part.bytesRead === 0) break;
        read += part.bytesRead;
      }
      if (read > RESUME_REQUEST_MAX_BYTES) tooBig = true;
      else text = bytes.subarray(0, read).toString("utf8");
    } catch (cause) {
      if (isAbsence(cause)) continue;
      // A failed open says nothing about WHAT the entry is (the inbox's F22 fix
      // check): `lstat` decides. A symlink is junk; a regular file is a request
      // we could not open this time, and it stays.
      let regular = true;
      try {
        regular = (await lstat(path)).isFile();
      } catch {
        regular = true;
      }
      if (regular) options.log(`recovery resume: ${name} could not be opened (${errText(cause)}); left in place for a later pass`);
      else await quarantine(name);
      continue;
    } finally {
      if (file !== null) await file.close().catch(() => {});
    }
    if (tooBig) {
      moveToRefused(root, path, name, { refusedAt: new Date(options.nowMs).toISOString(), why: `the request is over ${RESUME_REQUEST_MAX_BYTES} bytes`, request: null });
      continue;
    }
    const parsed = parseResumeRequest(text ?? "", name);
    if (!parsed.ok) {
      moveToRefused(root, path, name, { refusedAt: new Date(options.nowMs).toISOString(), why: parsed.why, request: null, raw: (text ?? "").slice(0, 2000) });
      continue;
    }
    out.requests.push({ path, name, request: parsed.value });
  }
  if (examined >= scanLimit && out.overflow > 0) {
    options.log(`recovery resume: the pending scan stopped at its limit of ${scanLimit}; ${out.overflow}${out.overflowCapped ? "+" : ""} more wait for a later pass`);
  }
  out.requests.sort(
    (a, b) =>
      Date.parse(a.request.requestedAt) - Date.parse(b.request.requestedAt) ||
      (a.request.candidateId < b.request.candidateId ? -1 : a.request.candidateId > b.request.candidateId ? 1 : 0) ||
      (a.request.nonce < b.request.nonce ? -1 : 1),
  );
  return out;
}

/**
 * Move one pending file to refused/, with its reason. **Synchronous**: the pass
 * calls it inside its no-await stretch. The body is written first and the
 * pending file unlinked after, so a crash between them leaves the request
 * pending (and it is refused again, under the same name, which replaces).
 */
export function moveToRefused(root: string, pendingPath: string, name: string, body: RefusedResume): MoveResult {
  try {
    replaceAtomically(join(root, RECOVERY_RESUME_DIR, RESUME_REFUSED_DIR), name, `${JSON.stringify(body, null, 2)}\n`);
    unlinkSync(pendingPath);
    return { ok: true };
  } catch (cause) {
    return { ok: false, why: errText(cause) };
  }
}

/**
 * Whether a pending file left pending/ (Sol's G16). A failure is an answer the
 * caller must act on: the file is still pending, and the page must say so.
 */
export type MoveResult = { ok: true } | { ok: false; why: string };

/** What the launch protocol answered, written into done/ beside the request. */
export type DoneResume = {
  settledAt: string;
  occurrenceId: string;
  /** The protocol's outcome kind, or `settled` when an earlier pass's launch was found through `inspect`. */
  outcome: string;
  launchedAt: string | null;
  transcriptSizeAtLaunch: number | null;
  transcriptMtimeAtLaunch: number | null;
  request: ResumeRequest;
};

/** Move one pending file to done/, with the protocol's answer. Synchronous, like `moveToRefused`. */
export function moveToDone(root: string, pendingPath: string, name: string, body: DoneResume): MoveResult {
  try {
    replaceAtomically(join(root, RECOVERY_RESUME_DIR, RESUME_DONE_DIR), name, `${JSON.stringify(body, null, 2)}\n`);
    unlinkSync(pendingPath);
    return { ok: true };
  } catch (cause) {
    return { ok: false, why: errText(cause) };
  }
}

/**
 * WHAT REVALIDATION MEASURED, written SYNCHRONOUSLY IMMEDIATELY BEFORE A LAUNCH
 * — so a crash between the launch and the move to done/ still leaves the
 * transcript's size and mtime at launch on disk, and the next pass can judge
 * growth (Sol's G2). One file per candidate: attempt 2 replaces attempt 1's
 * measurement, which is right, because the newer launch is the newer baseline.
 * `verifiedAt` is set once, the first time a pass finds all four facts, and is
 * what the spacing rule and the page read after the session has ended.
 */
export type ResumeAttempt = {
  v: 1;
  candidateId: string;
  conversationId: string;
  transcriptPath: string;
  transcriptSizeAtLaunch: number;
  transcriptMtimeAtLaunch: number;
  launchedAt: string;
  verifiedAt: string | null;
};

export function writeResumeAttempt(root: string, attempt: ResumeAttempt): boolean {
  try {
    replaceAtomically(join(root, RECOVERY_RESUME_DIR, RESUME_ATTEMPTS_DIR), `${attempt.candidateId}.json`, `${JSON.stringify(attempt, null, 2)}\n`);
    return true;
  } catch {
    return false;
  }
}

function parseAttempt(u: unknown): ResumeAttempt | null {
  if (!isObject(u) || u["v"] !== 1) return null;
  const { candidateId, conversationId, transcriptPath, transcriptSizeAtLaunch, transcriptMtimeAtLaunch, launchedAt, verifiedAt } = u;
  if (!isCandidateIdText(candidateId) || typeof conversationId !== "string" || typeof transcriptPath !== "string") return null;
  if (typeof transcriptSizeAtLaunch !== "number" || typeof transcriptMtimeAtLaunch !== "number" || !isIso(launchedAt)) return null;
  if (verifiedAt !== null && !isIso(verifiedAt)) return null;
  return { v: 1, candidateId, conversationId, transcriptPath, transcriptSizeAtLaunch, transcriptMtimeAtLaunch, launchedAt, verifiedAt };
}

/** A small JSON file, read with `O_NOFOLLOW` and a bound, synchronously. Null when absent, too big or unreadable. */
function readSmallJson(path: string): unknown {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    return null;
  }
  try {
    const bytes = Buffer.alloc(64 * 1024 + 1);
    let read = 0;
    while (read < bytes.length) {
      const n = readSync(fd, bytes, read, bytes.length - read, read);
      if (n === 0) break;
      read += n;
    }
    if (read > 64 * 1024) return null;
    return JSON.parse(bytes.subarray(0, read).toString("utf8"));
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

/** Every candidate's attempt, bounded. Synchronous: small files, read in the pass's no-await stretch too. */
export function readResumeAttempts(root: string): Map<string, ResumeAttempt> {
  const out = new Map<string, ResumeAttempt>();
  const directory = join(root, RECOVERY_RESUME_DIR, RESUME_ATTEMPTS_DIR);
  for (const name of boundedNames(directory)) {
    const match = ATTEMPT_NAME.exec(name);
    if (match === null) continue;
    const attempt = parseAttempt(readSmallJson(join(directory, name)));
    if (attempt !== null && attempt.candidateId === match[1]) out.set(attempt.candidateId, attempt);
  }
  return out;
}

function boundedNames(directory: string): string[] {
  const names: string[] = [];
  let dir: ReturnType<typeof opendirSync>;
  try {
    dir = opendirSync(directory);
  } catch {
    return names;
  }
  try {
    for (let entry = dir.readSync(); entry !== null && names.length < RESUME_SETTLED_SCAN_LIMIT; entry = dir.readSync()) {
      if (!entry.name.startsWith(".tmp-")) names.push(entry.name);
    }
  } finally {
    dir.closeSync();
  }
  return names;
}

export type SettledResume =
  | { kind: "done"; name: string; body: DoneResume }
  | { kind: "refused"; name: string; body: RefusedResume };

/**
 * The settled requests in done/ and refused/, for the projection. Bounded by
 * `RESUME_SETTLED_SCAN_LIMIT` per directory — directory order is not age
 * order, so past the bound the newest may be missed; that is the named cost of
 * a bounded read, and a thousand settled requests is years of reboots.
 */
export function readSettledResumes(root: string): SettledResume[] {
  const out: SettledResume[] = [];
  const base = join(root, RECOVERY_RESUME_DIR);
  for (const kind of ["done", "refused"] as const) {
    const directory = join(base, kind === "done" ? RESUME_DONE_DIR : RESUME_REFUSED_DIR);
    for (const name of boundedNames(directory)) {
      if (!REQUEST_NAME.test(name)) continue;
      const path = join(directory, name);
      try {
        if (!lstatSync(path).isFile()) continue;
      } catch {
        continue;
      }
      const body = readSmallJson(path);
      if (!isObject(body)) continue;
      if (kind === "done") {
        const request = parseResumeRequest(JSON.stringify(body["request"] ?? null), name);
        if (!request.ok || typeof body["occurrenceId"] !== "string" || !isIso(body["settledAt"])) continue;
        out.push({
          kind,
          name,
          body: {
            settledAt: body["settledAt"],
            occurrenceId: body["occurrenceId"],
            outcome: typeof body["outcome"] === "string" ? body["outcome"] : "unknown",
            launchedAt: isIso(body["launchedAt"]) ? body["launchedAt"] : null,
            transcriptSizeAtLaunch: typeof body["transcriptSizeAtLaunch"] === "number" ? body["transcriptSizeAtLaunch"] : null,
            transcriptMtimeAtLaunch: typeof body["transcriptMtimeAtLaunch"] === "number" ? body["transcriptMtimeAtLaunch"] : null,
            request: request.value,
          },
        });
      } else {
        if (!isIso(body["refusedAt"]) || typeof body["why"] !== "string") continue;
        const request = body["request"] === null ? null : parseResumeRequest(JSON.stringify(body["request"]), name);
        out.push({
          kind,
          name,
          body: { refusedAt: body["refusedAt"], why: body["why"], request: request !== null && request.ok ? request.value : null },
        });
      }
    }
  }
  return out;
}

/** The candidate id a settled or pending file's NAME carries, for a refused body whose request could not be parsed. */
export function candidateOfName(name: string): string | null {
  return REQUEST_NAME.exec(name)?.[1] ?? null;
}
