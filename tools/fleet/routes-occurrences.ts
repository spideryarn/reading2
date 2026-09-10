/**
 * `GET /api/overseer/occurrences` — **what the Overseer's scheduler has
 * launched, and what came of it, as the daemon last wrote it** — and
 * `GET /api/overseer/occurrences/<lo-id>/answer`, the durable link to one
 * occurrence's answer. Plan 260910f-scheduled-dispatch § D7.
 *
 * ## The list: the schedule route's shape, for its reasons
 *
 * One bounded read of `<store>/occurrences.json`, refused on its size before
 * it is read, forwarded as **the file's own JSON** with the one parser's arm,
 * so the browser runs the same parser (`occurrences-parse.ts`) over the same
 * bytes — `routes-schedule.ts` § It forwards the file's own JSON. Every failure
 * to read is its own arm with a sentence; the 500 is kept for a bug here.
 *
 * ## The answer: a path built from nothing but the validated id
 *
 * This is the one route on the dashboard that serves a file a request names, so
 * what it refuses is the point:
 *
 * - **The path is `<store>/launches/o/<id>/a<n>/answer.md`**, the launch
 *   protocol's fixed layout, built ONLY from an id matching `lo-<20 hex>` and
 *   an `a<n>` (1 to 999) this route found by listing the id's directory. Never
 *   from a path in `occurrences.json` — the file says `transcriptPath` for a
 *   person to read, and nothing here reads it — and never from the request
 *   beyond the id. An id is checked on the raw path segment, undecoded, so
 *   `%2e%2e` is refused as a bad id rather than decoded into one.
 * - **The newest attempt**, by number, not by name: `a10` is after `a9`.
 * - **No symlink is followed at any level it opens.** `launches`, `o`, the id's
 *   directory and the attempt's are each `lstat`ed and must be real
 *   directories; `answer.md` is opened `O_NOFOLLOW`. A refused newest attempt
 *   is refused — it never falls back to the one before, which would serve an
 *   older answer as the current one. (`lstat` then `readdir` is not atomic;
 *   the store belongs to the same user as this process, and the check is
 *   against a store damaged or mis-set-up, not against a racing local
 *   attacker, who could as well edit the answer.) The store root itself is
 *   taken as configured, as the schedule route takes it.
 * - **At most 256 KB** (413 past it, refused on the descriptor's size before
 *   reading), served `text/plain; charset=utf-8` with `nosniff` and
 *   `no-store`, so a model's answer can never be run as a page on this origin.
 *
 * There is no transcript route: a transcript holds every file the job read.
 */
import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";

import { LAUNCH_OCCURRENCE_ID, OCCURRENCES_FILE, OCCURRENCES_SCHEMA, parseOccurrencesFile } from "./occurrences-parse.js";

export const OCCURRENCES_PATH = "/api/overseer/occurrences";

/** The payload's own version — not the file's, which is `OCCURRENCES_SCHEMA`. */
export const OCCURRENCES_PAYLOAD_SCHEMA = 1;

/** The daemon writes a few KB for a handful of jobs. Past this, the file is not read at all. */
export const MAX_OCCURRENCES_FILE_BYTES = 256 * 1024;

/** An answer is a few paragraphs. Past this, it is not read, and the transcript path is the way in. */
export const MAX_ANSWER_BYTES = 256 * 1024;

const ANSWER_FILE = "answer.md";
/** `a1`..`a999`, with no leading zero, so one attempt has exactly one name. */
const ATTEMPT_DIR = /^a([1-9][0-9]{0,2})$/;

/** What reading the store's file found, before the parser has seen it. */
export type OccurrencesFileRead = { kind: "absent" } | { kind: "too-large"; bytes: number } | { kind: "unreadable"; why: string } | { kind: "read"; json: unknown };

/** What looking for an occurrence's answer found. Each arm is a different response. */
export type AnswerRead =
  | { kind: "read"; attempt: number; body: Buffer }
  /** Looked, and there is no answer: 404. */
  | { kind: "absent"; why: string }
  /** There is something, and it is a symlink or not a regular file, so it was not followed: 403. */
  | { kind: "refused"; why: string }
  /** 413, refused on its size before it was read. */
  | { kind: "too-large"; attempt: number; bytes: number }
  /** Could not look: 503. Never 404, because "we could not look" is not "we found nothing". */
  | { kind: "unreadable"; why: string };

export type OccurrencesRouteDeps = {
  readFile(): OccurrencesFileRead;
  /** Called only with an id that matched `LAUNCH_OCCURRENCE_ID`. */
  readAnswer(launchOccurrenceId: string): AnswerRead;
  nowMs(): number;
};

export type OccurrencesPayload = {
  schema: typeof OCCURRENCES_PAYLOAD_SCHEMA;
  /** When this server read the file, by its own clock — the box's, like the file's `writtenAt`. */
  servedAt: string;
  file:
    | { kind: "absent"; why: string }
    | { kind: "unreadable"; why: string }
    | { kind: "unsupported-schema"; schema: number; known: number }
    /** The file's own JSON, which the one parser accepted. The browser parses it again. */
    | { kind: "occurrences"; occurrences: unknown };
};

const ABSENT =
  `there is no ${OCCURRENCES_FILE} in the Overseer store this dashboard reads: the running daemon predates this build and writes no record of ` +
  "what it launched, or has not finished a checkpoint since it started, or is failing to write the file";

function message(cause: unknown): string {
  return cause instanceof Error && cause.message.trim() !== "" ? cause.message : String(cause);
}

function errno(cause: unknown): string | null {
  const code = (cause as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
}

/* ------------------------------------------------------------------ *
 * Reading, bounded and without following links.
 * ------------------------------------------------------------------ */

type RegularRead = { kind: "absent" } | { kind: "not-regular" } | { kind: "too-large"; bytes: number } | { kind: "read"; body: Buffer } | { kind: "failed"; why: string };

/**
 * One file, opened without following a final symlink and without letting a FIFO
 * block, measured through the descriptor so the size checked is the size of
 * the file read — the daemon replaces its files by rename.
 */
function readRegularFile(path: string, maxBytes: number): RegularRead {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (cause) {
    const code = errno(cause);
    if (code === "ENOENT") return { kind: "absent" };
    if (code === "ELOOP") return { kind: "not-regular" };
    return { kind: "failed", why: `could not be opened (${message(cause)})` };
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) return { kind: "not-regular" };
    if (stat.size > maxBytes) return { kind: "too-large", bytes: stat.size };
    const body = readFileSync(fd);
    /* It grew between the fstat and the read. Still refused. */
    if (body.length > maxBytes) return { kind: "too-large", bytes: body.length };
    return { kind: "read", body };
  } catch (cause) {
    return { kind: "failed", why: `could not be read (${message(cause)})` };
  } finally {
    closeSync(fd);
  }
}

/** The default list reader: the store's file, refused on its size before it is read. */
export function readOccurrencesFile(storeDir: string, maxBytes = MAX_OCCURRENCES_FILE_BYTES): OccurrencesFileRead {
  const read = readRegularFile(join(storeDir, OCCURRENCES_FILE), maxBytes);
  switch (read.kind) {
    case "absent":
      return { kind: "absent" };
    case "not-regular":
      return { kind: "unreadable", why: `${OCCURRENCES_FILE} is not a regular file in the Overseer store, so it was not read` };
    case "too-large":
      return { kind: "too-large", bytes: read.bytes };
    case "failed":
      return { kind: "unreadable", why: `${OCCURRENCES_FILE} ${read.why}` };
    case "read":
      try {
        return { kind: "read", json: JSON.parse(read.body.toString("utf8")) as unknown };
      } catch (cause) {
        return { kind: "unreadable", why: `${OCCURRENCES_FILE} is not JSON (${message(cause)})` };
      }
    default: {
      const never: never = read;
      throw new Error(`no read for ${JSON.stringify(never)}`);
    }
  }
}

type DirectoryStanding = { kind: "directory" } | { kind: "absent" } | { kind: "refused"; why: string } | { kind: "unreadable"; why: string };

/** A directory this route may enter: there, a real directory, and not a symlink to one. */
function directoryStanding(path: string, name: string): DirectoryStanding {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return { kind: "refused", why: `${name} is a symlink in the Overseer store, so it was not followed` };
    if (!stat.isDirectory()) return { kind: "refused", why: `${name} is not a directory in the Overseer store, so it was not read` };
    return { kind: "directory" };
  } catch (cause) {
    if (errno(cause) === "ENOENT") return { kind: "absent" };
    return { kind: "unreadable", why: `${name} could not be examined (${message(cause)})` };
  }
}

/**
 * The newest attempt's `answer.md` for one occurrence. The path is built from
 * `launchOccurrenceId` — checked again here, so no caller can hand it anything
 * else — and from an `a<n>` this function found and parsed itself.
 */
export function readAnswerFile(storeDir: string, launchOccurrenceId: string, maxBytes = MAX_ANSWER_BYTES): AnswerRead {
  if (!LAUNCH_OCCURRENCE_ID.test(launchOccurrenceId)) return { kind: "refused", why: "that is not a launch occurrence id (lo- and twenty hex)" };
  const nothing = (why: string): AnswerRead => ({ kind: "absent", why: `there is no answer for ${launchOccurrenceId}: ${why}` });

  let dir = storeDir;
  for (const [segment, name] of [
    ["launches", "the launches directory"],
    ["o", "the launches/o directory"],
    [launchOccurrenceId, `the directory of ${launchOccurrenceId}`],
  ] as const) {
    dir = join(dir, segment);
    const standing = directoryStanding(dir, name);
    if (standing.kind === "absent") return nothing(`${name} does not exist, so this store has never launched it`);
    if (standing.kind !== "directory") return standing;
  }

  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (cause) {
    return { kind: "unreadable", why: `the directory of ${launchOccurrenceId} could not be listed (${message(cause)})` };
  }
  let newest = 0;
  for (const name of names) {
    const match = ATTEMPT_DIR.exec(name);
    if (match !== null) newest = Math.max(newest, Number(match[1]));
  }
  if (newest === 0) return nothing("it has no attempt yet");

  const attemptName = `attempt a${newest} of ${launchOccurrenceId}`;
  const attemptDir = join(dir, `a${newest}`);
  const standing = directoryStanding(attemptDir, attemptName);
  if (standing.kind === "absent") return nothing(`${attemptName} went away while it was being read`);
  if (standing.kind !== "directory") return standing;

  const read = readRegularFile(join(attemptDir, ANSWER_FILE), maxBytes);
  switch (read.kind) {
    case "read":
      return { kind: "read", attempt: newest, body: read.body };
    case "absent":
      return nothing(`${attemptName} wrote no ${ANSWER_FILE}`);
    case "not-regular":
      return { kind: "refused", why: `the ${ANSWER_FILE} of ${attemptName} is a symlink or not a regular file, so it was not followed` };
    case "too-large":
      return { kind: "too-large", attempt: newest, bytes: read.bytes };
    case "failed":
      return { kind: "unreadable", why: `the ${ANSWER_FILE} of ${attemptName} ${read.why}` };
    default: {
      const never: never = read;
      throw new Error(`no answer for ${JSON.stringify(never)}`);
    }
  }
}

/* ------------------------------------------------------------------ *
 * The answers.
 * ------------------------------------------------------------------ */

/** The whole list answer, pure given its reader and clock. Never throws for anything the reader does. */
export function occurrencesPayload(deps: OccurrencesRouteDeps): OccurrencesPayload {
  const servedAt = new Date(deps.nowMs()).toISOString();
  let read: OccurrencesFileRead;
  try {
    read = deps.readFile();
  } catch (cause) {
    read = { kind: "unreadable", why: `reading ${OCCURRENCES_FILE} threw: ${message(cause)}` };
  }
  const answer = (file: OccurrencesPayload["file"]): OccurrencesPayload => ({ schema: OCCURRENCES_PAYLOAD_SCHEMA, servedAt, file });
  switch (read.kind) {
    case "absent":
      return answer({ kind: "absent", why: ABSENT });
    case "too-large":
      return answer({
        kind: "unreadable",
        why: `${OCCURRENCES_FILE} is ${read.bytes} bytes, more than the ${MAX_OCCURRENCES_FILE_BYTES} this route will read, so it was not read — the daemon writes a few kilobytes`,
      });
    case "unreadable":
      return answer({ kind: "unreadable", why: read.why });
    case "read": {
      const parsed = parseOccurrencesFile(read.json);
      switch (parsed.kind) {
        case "parsed":
          return answer({ kind: "occurrences", occurrences: read.json });
        case "unsupported-schema":
          return answer({ kind: "unsupported-schema", schema: parsed.saw, known: OCCURRENCES_SCHEMA });
        case "unreadable":
          return answer({ kind: "unreadable", why: parsed.why });
        default: {
          const never: never = parsed;
          throw new Error(`no occurrences payload for ${JSON.stringify(never)}`);
        }
      }
    }
    default: {
      const never: never = read;
      throw new Error(`no occurrences payload for ${JSON.stringify(never)}`);
    }
  }
}

function json(res: ServerResponse, req: IncomingMessage, status: number, value: unknown, extra: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...extra });
  res.end(req.method === "HEAD" ? undefined : JSON.stringify(value));
}

/** Every answer-route response, the refusals included: plain text, never sniffed, never cached. */
function text(res: ServerResponse, req: IncomingMessage, status: number, body: string | Buffer, extra: Record<string, string> = {}): void {
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "x-content-type-options": "nosniff",
    "cache-control": "no-store",
    ...extra,
  });
  res.end(req.method === "HEAD" ? undefined : body);
}

function serveAnswer(deps: OccurrencesRouteDeps, launchOccurrenceId: string, req: IncomingMessage, res: ServerResponse): void {
  let read: AnswerRead;
  try {
    read = deps.readAnswer(launchOccurrenceId);
  } catch (cause) {
    text(res, req, 500, `Looking for the answer of ${launchOccurrenceId} threw: ${message(cause)}\n`);
    return;
  }
  switch (read.kind) {
    case "read":
      text(res, req, 200, read.body);
      return;
    case "absent":
      text(res, req, 404, `No answer: ${read.why}.\n`);
      return;
    case "refused":
      text(res, req, 403, `Not served: ${read.why}.\n`);
      return;
    case "too-large":
      text(
        res,
        req,
        413,
        `Not served: the answer of attempt a${read.attempt} of ${launchOccurrenceId} is ${read.bytes} bytes, more than the ${MAX_ANSWER_BYTES} this route will read. Read it on the box.\n`,
      );
      return;
    case "unreadable":
      text(res, req, 503, `Could not look for the answer of ${launchOccurrenceId}: ${read.why}.\n`);
      return;
    default: {
      const never: never = read;
      text(res, req, 500, `no answer for ${JSON.stringify(never)}\n`);
    }
  }
}

/**
 * The list path exactly (a query string is the same route), and
 * `<list>/<id>/answer`. Anything else beneath the list path is a 404, and a
 * sibling such as `/api/overseer/occurrencesx` is not this route's to claim.
 */
export function occurrencesRoute(deps: OccurrencesRouteDeps): { handle(req: IncomingMessage, res: ServerResponse): boolean } {
  return {
    handle(req, res): boolean {
      const path = (req.url ?? "/").split("?")[0] ?? "";
      if (path !== OCCURRENCES_PATH && !path.startsWith(`${OCCURRENCES_PATH}/`)) return false;
      const readOnly = req.method === "GET" || req.method === "HEAD";

      if (path === OCCURRENCES_PATH) {
        if (!readOnly) {
          json(res, req, 405, { error: "method-not-allowed", why: "the scheduler's occurrences are read-only; use GET or HEAD" }, { allow: "GET, HEAD" });
          return true;
        }
        let payload: OccurrencesPayload;
        try {
          payload = occurrencesPayload(deps);
        } catch (cause) {
          json(res, req, 500, { error: "internal-error", why: `building the occurrences answer threw: ${message(cause)}` });
          return true;
        }
        json(res, req, 200, payload);
        return true;
      }

      /* THE RAW SEGMENTS, UNDECODED. `%2e%2e` stays four characters that fail
         the id's pattern, rather than becoming a `..` after the check. */
      const segments = path.slice(OCCURRENCES_PATH.length + 1).split("/");
      const [id, leaf] = segments;
      if (segments.length !== 2 || id === undefined || leaf !== "answer") {
        json(res, req, 404, { error: "route-not-found", why: `no such route: ${path}` });
        return true;
      }
      if (!readOnly) {
        text(res, req, 405, "An answer is read-only; use GET or HEAD.\n", { allow: "GET, HEAD" });
        return true;
      }
      if (!LAUNCH_OCCURRENCE_ID.test(id)) {
        text(res, req, 400, "Not a launch occurrence id: an id is lo- followed by twenty lower-case hex characters.\n");
        return true;
      }
      serveAnswer(deps, id, req, res);
      return true;
    },
  };
}
