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
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
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
  const requestedAt = typeof r["requestedAt"] === "string" ? r["requestedAt"] : "";
  return {
    ok: true,
    value: { schema: 1, kind: "dismiss", requestId: fileRequestId, id: r["id"] as RecoveryCandidateId, why: (r["why"] as string).trim(), requestedAt },
  };
}

/** The request files, oldest first. Symlinks, directories, `.tmp-` siblings and anything not named `<uuid>.json` are skipped. */
function pendingRequests(inbox: string): { file: string; requestId: string }[] {
  const found: { file: string; requestId: string; mtimeMs: number }[] = [];
  for (const name of readdirSync(inbox)) {
    const match = REQUEST_FILE.exec(name);
    if (match === null || name.includes(".tmp-")) continue;
    const path = join(inbox, name);
    let info: ReturnType<typeof lstatSync>;
    try {
      info = lstatSync(path);
    } catch {
      continue;
    }
    if (!info.isFile()) continue;
    found.push({ file: path, requestId: match[1] as string, mtimeMs: info.mtimeMs });
  }
  found.sort((a, b) => a.mtimeMs - b.mtimeMs || (a.file < b.file ? -1 : 1));
  return found.slice(0, DRAIN_LIMIT).map(({ file, requestId }) => ({ file, requestId }));
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
export function drainRecoveryInbox(input: {
  root: string;
  index: () => RecoveryIndex;
  append: (events: OverseerEvent[]) => boolean;
  now: () => Date;
  log: (line: string) => void;
}): DrainResult {
  const inbox = join(input.root, RECOVERY_INBOX_DIR);
  const result: DrainResult = { applied: 0, refused: 0, halted: false };
  if (!existsSync(inbox)) return result;
  let requests: { file: string; requestId: string }[];
  try {
    requests = pendingRequests(inbox);
  } catch (cause) {
    input.log(`recovery inbox could not be listed: ${String(cause)}`);
    return result;
  }

  const refuse = (file: string, requestId: string, why: string, request: unknown): void => {
    const refusedDir = join(inbox, REFUSED_DIR);
    try {
      mkdirSync(refusedDir, { recursive: true, mode: 0o700 });
      writeAtomically(
        join(refusedDir, `${requestId}.json`),
        refusedDir,
        `${JSON.stringify({ refusedAt: input.now().toISOString(), why, request }, null, 2)}\n`,
      );
      unlinkSync(file);
      result.refused += 1;
      input.log(`recovery request ${requestId} REFUSED: ${why}`);
    } catch (cause) {
      input.log(`recovery request ${requestId} could not be moved to refused/ (${why}): ${String(cause)}`);
    }
  };

  for (const { file, requestId } of requests) {
    let text: string;
    try {
      if (lstatSync(file).size > REQUEST_MAX_BYTES) {
        refuse(file, requestId, `the request is over ${REQUEST_MAX_BYTES} bytes`, null);
        continue;
      }
      text = readFileSync(file, "utf8");
    } catch (cause) {
      input.log(`recovery request ${requestId} could not be read: ${String(cause)}`);
      continue;
    }
    const parsed = parseRequest(text, requestId);
    if (!parsed.ok) {
      refuse(file, requestId, parsed.why, text.slice(0, 2000));
      continue;
    }
    const request = parsed.value;
    // Read the index afresh for every request: an earlier one in this drain
    // may have just resolved the record this one names.
    const index = input.index();
    if (index.appliedRequests.has(requestId)) {
      refuse(file, requestId, "this request was already applied — a replay after a crash between the append and the delete, or a copy", request);
      continue;
    }
    const record = index.records.get(request.id);
    if (record === undefined) {
      refuse(
        file,
        requestId,
        `${request.id} is not in the recovery index: it never existed, it was resolved over 30 days ago, or it is past the index's capacity and survives only in events.jsonl`,
        request,
      );
      continue;
    }
    if (record.resolution.disposition !== "unresolved") {
      refuse(file, requestId, `${request.id} is already resolved as ${record.resolution.disposition} (at ${record.resolution.at})`, request);
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
      unlinkSync(file);
    } catch (cause) {
      // The disposition is on disk. The file comes round again and is refused
      // as already applied, which is the crash case above.
      input.log(`recovery request ${requestId} was applied and could not be deleted: ${String(cause)}`);
    }
  }
  return result;
}
