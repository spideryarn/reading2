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
 * ## The answer: exactly the answer the shown result was judged on
 *
 * This is the one route on the dashboard that serves a file a request names, so
 * what it refuses is the point (Sol's F7 on plan 260910f):
 *
 * - **Only an occurrence the projection lists.** The id must match
 *   `lo-<20 hex>`, checked on the raw path segment, undecoded, so `%2e%2e` is
 *   refused as a bad id rather than decoded into one. Then `occurrences.json`,
 *   read by the list's own bounded reader and the one parser, must list it as a
 *   readable occurrence with a present answer. An id it does not list — another
 *   launch origin's — is a 404 whatever is on disk; so is an occurrence whose
 *   row is unreadable, and so is every id while the file is absent or
 *   unreadable. A genuinely absent file is the same 404; a file that exists but
 *   cannot be read or is too large is 503, because failing to look is not
 *   finding nothing.
 * - **The path is `<store>/launches/o/<id>/a<attempt>/answer.md`**, the launch
 *   protocol's fixed layout, built ONLY from the validated id and the
 *   projection's `answer.attempt` (1 to 999). Never from a path in the file —
 *   `transcriptPath` is for a person to read, and nothing here reads it — never
 *   from a directory listing, and never the newest attempt, which need not be
 *   the one the result was judged on.
 * - **No symlink is followed at any level it opens.** `launches`, `o`, the id's
 *   directory and the attempt's are each `lstat`ed and must be real directories
 *   (403). `answer.md` is opened `O_NOFOLLOW | O_NONBLOCK`, as the schedule
 *   route opens its file, so a FIFO cannot block the open, and `fstat`ed
 *   through that descriptor: anything but a regular file is 403. The store root
 *   itself is taken as configured, as the schedule route takes it.
 * - **The bytes are the judged ones.** Past 256 KB is 413, refused on the
 *   descriptor's size before reading. A size that is not the projection's
 *   `bytes`, or bytes read from that same descriptor whose sha256 is not its
 *   `sha256`, is 409: the file was replaced or edited after the result was
 *   judged, and serving it would put a different answer under that result.
 *   (`lstat` then `open` is not atomic, but whatever a race swaps in, the bytes
 *   served are the judged bytes or nothing.)
 * - Served `text/plain; charset=utf-8` with `nosniff` and `no-store`, so a
 *   model's answer can never be run as a page on this origin.
 *
 * There is no transcript route: a transcript holds every file the job read.
 */
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";

import { LAUNCH_OCCURRENCE_ID, OCCURRENCES_FILE, OCCURRENCES_SCHEMA, parseOccurrencesFile } from "./occurrences-parse.js";
import type { ScheduledAnswer } from "./wire.js";

export const OCCURRENCES_PATH = "/api/overseer/occurrences";

/** The payload's own version — not the file's, which is `OCCURRENCES_SCHEMA`. */
export const OCCURRENCES_PAYLOAD_SCHEMA = 1;

/** The daemon writes a few KB for a handful of jobs. Past this, the file is not read at all. */
export const MAX_OCCURRENCES_FILE_BYTES = 256 * 1024;

/** An answer is a few paragraphs. Past this, it is not read, and the transcript path is the way in. */
export const MAX_ANSWER_BYTES = 256 * 1024;

const ANSWER_FILE = "answer.md";
/** The protocol's attempt directories run `a1`..`a999`. */
const MAX_ATTEMPT = 999;

/** What reading the store's file found, before the parser has seen it. */
export type OccurrencesFileRead = { kind: "absent" } | { kind: "too-large"; bytes: number } | { kind: "unreadable"; why: string } | { kind: "read"; json: unknown };

/** What looking for an occurrence's answer found. Each arm is a different response. */
export type AnswerRead =
  | { kind: "read"; attempt: number; body: Buffer }
  /** It is not an occurrence the projection lists with an answer, or it is and the file is not there: 404. */
  | { kind: "absent"; why: string }
  /** There is something, and it is a symlink or not a regular file, so it was not followed: 403. */
  | { kind: "refused"; why: string }
  /** 413, refused on its size before it was read. */
  | { kind: "too-large"; attempt: number; bytes: number }
  /** The file's size or sha256 is not the projection's: not the answer the result was judged on. 409. */
  | { kind: "not-judged"; attempt: number; why: string }
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

type PresentAnswer = Extract<ScheduledAnswer, { kind: "present" }>;

/**
 * The answer `occurrences.json` lists for this id, or why there is none a page
 * shows. Read through the list's own bounded reader and the one parser, so the
 * route serves an answer only for a row the page could have drawn.
 */
function listedAnswer(
  storeDir: string,
  launchOccurrenceId: string,
): { kind: "listed"; answer: PresentAnswer } | { kind: "absent"; why: string } | { kind: "unreadable"; why: string } {
  const notShown = (why: string) => ({ kind: "absent", why: `${launchOccurrenceId} is not a scheduled occurrence with an answer that this page shows: ${why}` }) as const;
  const couldNotLook = (why: string) => ({ kind: "unreadable", why: `the answer authority in ${OCCURRENCES_FILE} could not be read: ${why}` }) as const;
  const read = readOccurrencesFile(storeDir);
  switch (read.kind) {
    case "absent":
      return notShown(`there is no ${OCCURRENCES_FILE} in the Overseer store`);
    case "too-large":
      return couldNotLook(`${OCCURRENCES_FILE} is ${read.bytes} bytes, more than the ${MAX_OCCURRENCES_FILE_BYTES} this route will read`);
    case "unreadable":
      return couldNotLook(read.why);
    case "read":
      break;
    default: {
      const never: never = read;
      throw new Error(`no listing for ${JSON.stringify(never)}`);
    }
  }
  const parsed = parseOccurrencesFile(read.json);
  if (parsed.kind !== "parsed") return couldNotLook(parsed.why);
  const rawCount = rawOccurrenceIdCount(read.json, launchOccurrenceId);
  if (rawCount > 1) return notShown(`${OCCURRENCES_FILE} lists it ${rawCount} times, so which answer was judged cannot be told`);
  const rows = parsed.file.jobs
    .flatMap((job) => (job.kind === "job" ? job.job.occurrences : []))
    .filter((row) => (row.kind === "occurrence" ? row.occurrence.launchOccurrenceId : row.launchOccurrenceId) === launchOccurrenceId);
  const [row] = rows;
  if (row === undefined) return notShown(`${OCCURRENCES_FILE} does not list it`);
  if (rows.length > 1) return notShown(`${OCCURRENCES_FILE} lists it ${rows.length} times, so which answer was judged cannot be told`);
  if (row.kind === "unreadable") return notShown(`its row in ${OCCURRENCES_FILE} is unreadable (${row.why})`);
  if (row.occurrence.answer.kind === "absent") return notShown(`${OCCURRENCES_FILE} records no answer for it`);
  return { kind: "listed", answer: row.occurrence.answer };
}

/** Count ids at the file's structural job/occurrence seam, including rows hidden by an unreadable job field. */
function rawOccurrenceIdCount(json: unknown, launchOccurrenceId: string): number {
  if (json === null || typeof json !== "object" || Array.isArray(json)) return 0;
  const jobs = (json as Record<string, unknown>)["jobs"];
  if (!Array.isArray(jobs)) return 0;
  let count = 0;
  for (const job of jobs) {
    if (job === null || typeof job !== "object" || Array.isArray(job)) continue;
    const occurrences = (job as Record<string, unknown>)["occurrences"];
    if (!Array.isArray(occurrences)) continue;
    for (const occurrence of occurrences) {
      if (occurrence !== null && typeof occurrence === "object" && !Array.isArray(occurrence)) {
        if ((occurrence as Record<string, unknown>)["launchOccurrenceId"] === launchOccurrenceId) count += 1;
      }
    }
  }
  return count;
}

type JudgedRead =
  | { kind: "absent" }
  | { kind: "not-regular" }
  | { kind: "too-large"; bytes: number }
  | { kind: "not-judged"; why: string }
  | { kind: "read"; body: Buffer }
  | { kind: "failed"; why: string };

/**
 * One answer file, opened as `readScheduleFile` opens its file — no final
 * symlink followed, no FIFO blocking — then measured and read through that one
 * descriptor, and served only if its size and sha256 are the judged ones.
 */
function readJudgedFile(path: string, maxBytes: number, judged: PresentAnswer): JudgedRead {
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
    if (stat.size !== judged.bytes) return { kind: "not-judged", why: `it is ${stat.size} bytes, and the answer judged was ${judged.bytes}` };
    const body = readFileSync(fd);
    /* It changed between the fstat and the read. Still refused. */
    if (body.length > maxBytes) return { kind: "too-large", bytes: body.length };
    if (body.length !== judged.bytes) return { kind: "not-judged", why: `it read as ${body.length} bytes, and the answer judged was ${judged.bytes}` };
    const sha256 = createHash("sha256").update(body).digest("hex");
    if (sha256 !== judged.sha256) return { kind: "not-judged", why: `its sha256 is ${sha256}, and the answer judged has ${judged.sha256}` };
    return { kind: "read", body };
  } catch (cause) {
    return { kind: "failed", why: `could not be read (${message(cause)})` };
  } finally {
    closeSync(fd);
  }
}

/**
 * The `answer.md` the result was judged on, for an occurrence the projection
 * lists. The path is built from `launchOccurrenceId` — checked again here, so
 * no caller can hand it anything else — and the projection's attempt, and
 * nothing else.
 */
export function readAnswerFile(storeDir: string, launchOccurrenceId: string, maxBytes = MAX_ANSWER_BYTES): AnswerRead {
  if (!LAUNCH_OCCURRENCE_ID.test(launchOccurrenceId)) return { kind: "refused", why: "that is not a launch occurrence id (lo- and twenty hex)" };
  const listed = listedAnswer(storeDir, launchOccurrenceId);
  if (listed.kind !== "listed") return listed;
  const { attempt } = listed.answer;
  /* The parser already refuses any other; checked again because it builds a path. */
  if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > MAX_ATTEMPT) {
    return { kind: "absent", why: `${launchOccurrenceId} names attempt ${attempt}, which is not one of the protocol's a1 to a${MAX_ATTEMPT}` };
  }
  const attemptName = `attempt a${attempt} of ${launchOccurrenceId}`;
  const nothing = (why: string): AnswerRead => ({ kind: "absent", why: `there is no answer on disk for ${attemptName}, which ${OCCURRENCES_FILE} lists: ${why}` });

  let dir = storeDir;
  for (const [segment, name] of [
    ["launches", "the launches directory"],
    ["o", "the launches/o directory"],
    [launchOccurrenceId, `the directory of ${launchOccurrenceId}`],
    [`a${attempt}`, `the directory of ${attemptName}`],
  ] as const) {
    dir = join(dir, segment);
    const standing = directoryStanding(dir, name);
    if (standing.kind === "absent") return nothing(`${name} does not exist`);
    if (standing.kind !== "directory") return standing;
  }

  const read = readJudgedFile(join(dir, ANSWER_FILE), maxBytes, listed.answer);
  switch (read.kind) {
    case "read":
      return { kind: "read", attempt, body: read.body };
    case "absent":
      return nothing(`it wrote no ${ANSWER_FILE}`);
    case "not-regular":
      return { kind: "refused", why: `the ${ANSWER_FILE} of ${attemptName} is a symlink or not a regular file, so it was not followed` };
    case "too-large":
      return { kind: "too-large", attempt, bytes: read.bytes };
    case "not-judged":
      return { kind: "not-judged", attempt, why: read.why };
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
    case "not-judged":
      text(
        res,
        req,
        409,
        `Not served: the answer on disk for attempt a${read.attempt} of ${launchOccurrenceId} is not the one the result was judged on — ${read.why}.\n`,
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
