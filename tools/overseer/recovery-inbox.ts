/**
 * THE RECOVERY INBOX — how an operator asks the single writer to dismiss a
 * record, without becoming a second writer.
 *
 * docs/plans/260910e-recovery-inventory-show-interrupted-work-without-resuming-it.md
 * § 5. `scripts/overseer-recovery.ts dismiss` writes ONE request file here,
 * named by a fresh request id, atomically. On each tick the daemon reads the
 * directory, checks each request against the index, appends a
 * `recovery-disposition` for a valid one and then deletes the file. The daemon
 * stays the only thing that appends events; the CLI never touches
 * `events.jsonl` or `recovery.json`.
 *
 * **The shape is the one `work-reports` describes for `report-inbox/`** —
 * `<uuid>.json` files, oldest first, symlinks and `.tmp-` files skipped, and a
 * `refused/` directory — so "somebody asks the single writer to write" has one
 * shape and not two. That session had not landed a generic helper when this was
 * written (2026-09-10), so this is a small one of its own; if a shared one
 * lands, this file is what it replaces.
 *
 * **A crash between the append and the delete brings the same request round
 * again.** The fold keeps the request ids it has applied, so the replay is
 * refused as already applied and moved to `refused/` with that reason — it is
 * never applied twice, and the file does not come round a third time.
 */
import { randomUUID } from "node:crypto";
import { constants, mkdirSync } from "node:fs";
import { mkdir, open, opendir, rename, rmdir, unlink } from "node:fs/promises";
import { join } from "node:path";

import type { OverseerEvent } from "./diff.js";
import { writeAtomically } from "./jsonl.js";
import type { RecoveryCandidateId, RecoveryIndex } from "./recovery.js";

export const RECOVERY_INBOX_DIR = "recovery-inbox";
export const REFUSED_DIR = "refused";

/** Past this a request file is refused unread: a request is a hundred bytes. */
const REQUEST_MAX_BYTES = 16 * 1024;
/** The operator's sentence. Long enough for a reason, short enough to stay one. */
export const DISMISS_WHY_MAX_CHARS = 1000;
/** Requests handled per drain, so a flooded inbox costs a bounded tick. */
const DRAIN_LIMIT = 50;
/** Directory entries examined per pass, including junk names: the scan itself is bounded too. */
export const RECOVERY_INBOX_SCAN_LIMIT = 200;
const PROCESSING_DIR = "processing";

const REQUEST_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/;
const CANDIDATE_ID = /^r[cl]-[0-9a-f]{20}$/;

export type DismissRequest = {
  schema: 1;
  kind: "dismiss";
  /** Equal to the file's name. What the fold remembers, so a replay is applied once. */
  requestId: string;
  id: RecoveryCandidateId;
  why: string;
  requestedAt: string;
};

export function isCandidateId(value: string): value is RecoveryCandidateId {
  return CANDIDATE_ID.test(value);
}

/** What is wrong with an operator's input, or null. Shared by the writer and the reader, so they cannot disagree. */
function requestProblem(id: unknown, why: unknown): string | null {
  if (typeof id !== "string" || !isCandidateId(id)) return "the id is not a recovery candidate id (rc-… or rl-… with 20 hex digits)";
  if (typeof why !== "string" || why.trim() === "") return "there is no sentence saying why";
  if (why.length > DISMISS_WHY_MAX_CHARS) return `the sentence is over ${DISMISS_WHY_MAX_CHARS} characters`;
  return null;
}

/**
 * One request file, written atomically (a sibling, then a rename) under a fresh
 * request id. Refuses bad input before creating anything.
 */
export function writeDismissRequest(
  root: string,
  input: { id: string; why: string; now?: Date },
): { ok: true; requestId: string; path: string } | { ok: false; why: string } {
  const problem = requestProblem(input.id, input.why);
  if (problem !== null) return { ok: false, why: problem };
  const inbox = join(root, RECOVERY_INBOX_DIR);
  mkdirSync(inbox, { recursive: true, mode: 0o700 });
  const requestId = randomUUID();
  const request: DismissRequest = {
    schema: 1,
    kind: "dismiss",
    requestId,
    id: input.id as RecoveryCandidateId,
    why: input.why.trim(),
    requestedAt: (input.now ?? new Date()).toISOString(),
  };
  const path = join(inbox, `${requestId}.json`);
  // `writeAtomically` names its sibling `<path>.tmp-…`, which the drain skips.
  writeAtomically(path, inbox, `${JSON.stringify(request, null, 2)}\n`);
  return { ok: true, requestId, path };
}

function parseRequest(text: string, fileRequestId: string): { ok: true; value: DismissRequest } | { ok: false; why: string } {
  let u: unknown;
  try {
    u = JSON.parse(text);
  } catch (cause) {
    return { ok: false, why: `the request is not JSON: ${String(cause)}` };
  }
  if (typeof u !== "object" || u === null || Array.isArray(u)) return { ok: false, why: "the request is not an object" };
  const r = u as Record<string, unknown>;
  if (r["schema"] !== 1) return { ok: false, why: `schema ${JSON.stringify(r["schema"])} is not 1` };
  if (r["kind"] !== "dismiss") return { ok: false, why: `kind ${JSON.stringify(r["kind"])} is not dismiss` };
  if (r["requestId"] !== fileRequestId) return { ok: false, why: "the request id does not match the file's name" };
  const problem = requestProblem(r["id"], r["why"]);
  if (problem !== null) return { ok: false, why: problem };
  const requestedAt = r["requestedAt"];
  const requestedAtMs = typeof requestedAt === "string" ? Date.parse(requestedAt) : Number.NaN;
  if (
    typeof requestedAt !== "string" ||
    !Number.isFinite(requestedAtMs) ||
    new Date(requestedAtMs).toISOString() !== requestedAt
  ) {
    return { ok: false, why: "requestedAt is not an ISO timestamp" };
  }
  return {
    ok: true,
    value: { schema: 1, kind: "dismiss", requestId: fileRequestId, id: r["id"] as RecoveryCandidateId, why: (r["why"] as string).trim(), requestedAt },
  };
}

type PendingRequest = { file: string; requestId: string; mtimeMs: number; claimed: boolean };

/**
 * The oldest requests among a bounded scan. `processing/` comes first so a
 * crash after a request was claimed cannot strand it. The entry bound counts
 * junk too: hostile names may delay work, but cannot monopolise a daemon tick.
 */
async function pendingRequests(inbox: string, scanLimit: number): Promise<PendingRequest[]> {
  const found: PendingRequest[] = [];
  let examined = 0;
  for (const [directory, claimed] of [
    [join(inbox, PROCESSING_DIR), true],
    [inbox, false],
  ] as const) {
    let handle: Awaited<ReturnType<typeof opendir>> | null = null;
    try {
      handle = await opendir(directory);
    } catch {
      continue;
    }
    for await (const item of handle) {
      if (examined >= scanLimit) break;
      examined += 1;
      const match = REQUEST_FILE.exec(item.name);
      if (match === null || item.name.includes(".tmp-")) continue;
      const file = join(directory, item.name);
      let info: Awaited<ReturnType<typeof open>> | null = null;
      try {
        info = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        const stat = await info.stat();
        if (!stat.isFile()) continue;
        found.push({ file, requestId: match[1] as string, mtimeMs: stat.mtimeMs, claimed });
      } catch {
        // A symlink, a disappearing entry, or something that cannot be opened
        // is not a request and costs only one bounded slot.
      } finally {
        if (info !== null) await info.close().catch(() => {});
      }
    }
    if (examined >= scanLimit) break;
  }
  // A crash-left claim wins over a duplicate still in the public inbox. POSIX
  // rename replaces its destination, so letting the inbox copy go first could
  // overwrite the very request the processing directory exists to preserve.
  found.sort((a, b) => Number(b.claimed) - Number(a.claimed) || a.mtimeMs - b.mtimeMs || (a.file < b.file ? -1 : 1));
  return found.slice(0, DRAIN_LIMIT);
}

export type DrainResult = { applied: number; refused: number; halted: boolean };

/**
 * One pass over the inbox. `append` is the store's, behind the daemon's lock
 * guard: false means the lock is gone and the drain stops with the file left
 * where it is.
 *
 * Every refusal is kept, in `refused/<same name>`, with its reason and what
 * the request said — a request that vanished with only a console line behind
 * it would be an operator's decision nobody can show was refused.
 */
export async function drainRecoveryInbox(input: {
  root: string;
  index: () => RecoveryIndex;
  append: (events: OverseerEvent[]) => boolean;
  now: () => Date;
  log: (line: string) => void;
  /** Test seams for the two filesystem boundaries; production uses neither. */
  scanLimit?: number;
  afterClaim?: (path: string) => void | Promise<void>;
}): Promise<DrainResult> {
  const inbox = join(input.root, RECOVERY_INBOX_DIR);
  const result: DrainResult = { applied: 0, refused: 0, halted: false };
  // A refused all-or-nothing recovery replay leaves records and request ids
  // deliberately stale. It can authorize nothing; leave every file pending
  // until a later daemon start can read the missing journal tail.
  if (input.index().replay.kind === "not-run") return result;
  let requests: PendingRequest[];
  try {
    requests = await pendingRequests(inbox, input.scanLimit ?? RECOVERY_INBOX_SCAN_LIMIT);
  } catch (cause) {
    input.log(`recovery inbox could not be listed: ${String(cause)}`);
    return result;
  }

  const refuse = async (file: string, requestId: string, why: string, request: unknown): Promise<void> => {
    const refusedDir = join(inbox, REFUSED_DIR);
    try {
      await mkdir(refusedDir, { recursive: true, mode: 0o700 });
      const target = join(refusedDir, `${requestId}.json`);
      const temp = `${target}.tmp-${process.pid}-${randomUUID()}`;
      const output = await open(temp, "wx", 0o600);
      try {
        await output.writeFile(`${JSON.stringify({ refusedAt: input.now().toISOString(), why, request }, null, 2)}\n`, "utf8");
        await output.sync();
      } finally {
        await output.close();
      }
      await rename(temp, target);
      try {
        const directory = await open(refusedDir, "r");
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
      } catch {
        /* Not every platform lets a directory be opened and synced. */
      }
      await unlink(file);
      result.refused += 1;
      input.log(`recovery request ${requestId} REFUSED: ${why}`);
    } catch (cause) {
      input.log(`recovery request ${requestId} could not be moved to refused/ (${why}): ${String(cause)}`);
    }
  };

  const processing = join(inbox, PROCESSING_DIR);
  for (const pending of requests) {
    const { requestId } = pending;
    let file = pending.file;
    if (!pending.claimed) {
      try {
        await mkdir(processing, { recursive: true, mode: 0o700 });
        const claimed = join(processing, `${requestId}.json`);
        await rename(file, claimed);
        file = claimed;
        await input.afterClaim?.(file);
      } catch (cause) {
        input.log(`recovery request ${requestId} could not be claimed: ${String(cause)}`);
        continue;
      }
    }
    let text: string;
    let requestFile: Awaited<ReturnType<typeof open>> | null = null;
    try {
      requestFile = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const info = await requestFile.stat();
      if (!info.isFile()) {
        await refuse(file, requestId, "the request is not a regular file", null);
        continue;
      }
      const bytes = Buffer.alloc(REQUEST_MAX_BYTES + 1);
      let read = 0;
      while (read < bytes.length) {
        const part = await requestFile.read(bytes, read, bytes.length - read, read);
        if (part.bytesRead === 0) break;
        read += part.bytesRead;
      }
      if (read > REQUEST_MAX_BYTES) {
        await refuse(file, requestId, `the request is over ${REQUEST_MAX_BYTES} bytes`, null);
        continue;
      }
      text = bytes.subarray(0, read).toString("utf8");
    } catch (cause) {
      input.log(`recovery request ${requestId} could not be read: ${String(cause)}`);
      continue;
    } finally {
      if (requestFile !== null) await requestFile.close().catch(() => {});
    }
    const parsed = parseRequest(text, requestId);
    if (!parsed.ok) {
      await refuse(file, requestId, parsed.why, text.slice(0, 2000));
      continue;
    }
    const request = parsed.value;
    // Read the index afresh for every request: an earlier one in this drain
    // may have just resolved the record this one names.
    const index = input.index();
    if (index.appliedRequests.has(requestId)) {
      await refuse(file, requestId, "this request was already applied — a replay after a crash between the append and the delete, or a copy", request);
      continue;
    }
    const record = index.records.get(request.id);
    if (record === undefined) {
      await refuse(
        file,
        requestId,
        `${request.id} is not in the recovery index: it never existed, it was resolved over 30 days ago, or it is past the index's capacity and survives only in events.jsonl`,
        request,
      );
      continue;
    }
    if (record.resolution.disposition !== "unresolved") {
      await refuse(file, requestId, `${request.id} is already resolved as ${record.resolution.disposition} (at ${record.resolution.at})`, request);
      continue;
    }
    const appended = input.append([
      {
        kind: "recovery-disposition",
        at: input.now().toISOString(),
        id: request.id,
        disposition: "dismissed",
        evidence: { requestId, why: request.why },
      },
    ]);
    if (!appended) {
      result.halted = true;
      return result;
    }
    result.applied += 1;
    input.log(`recovery request ${requestId}: dismissed ${request.id}`);
    try {
      await unlink(file);
    } catch (cause) {
      // The disposition is on disk. The file comes round again and is refused
      // as already applied, which is the crash case above.
      input.log(`recovery request ${requestId} was applied and could not be deleted: ${String(cause)}`);
    }
  }
  await rmdir(processing).catch(() => {});
  return result;
}
