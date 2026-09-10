/**
 * `GET /api/overseer/schedule` — **what the Overseer's scheduler would run
 * next, as the daemon last wrote it.** Plan 260910e § D6, D7.
 *
 * The daemon writes `schedule.json` into its store on every checkpoint tick
 * (`tools/overseer/schedule-preview.ts`). This route reads that one file,
 * bounded, and forwards it. It computes nothing: a reader holds its own prompts,
 * pins and schedule constants rather than the daemon's, which is why the daemon
 * writes the file rather than a reader computing it (Sol's P1-4).
 *
 * ## It forwards the file's own JSON, and the browser re-parses it
 *
 * The one parser (`schedule-parse.ts`) reads the file here to decide which
 * answer this is, and the `preview` arm carries **the file's own JSON**, not
 * the parsed shape. The browser runs the same parser over the same bytes, so
 * what `overseer status` prints and what the page draws come from one parse of
 * one file — including which rows are unreadable and why. Forwarding the parsed
 * shape instead would have needed a second reader of that shape in the browser.
 * That is also why this route reads the file itself rather than calling
 * `readSchedulePreviewFile`, which returns only the parsed shape.
 *
 * ## Bounded, and never a 500 for a file it could not read
 *
 * A file past `MAX_SCHEDULE_FILE_BYTES` is refused on its size, before it is
 * read — the daemon writes a few kilobytes, and this is a request handler on
 * the one process the Overseer cannot do without (fleet-dashboard-modes.md §
 * An on-demand route may block the event loop only for work whose worst case it
 * can state). No subprocess, no repo reads. Every failure to read is its own
 * arm with a sentence; the 500 is kept for a bug in this file.
 *
 * The payload's type lives here rather than in `wire.ts`, and the browser reads
 * it as `unknown` (`web/src/schedule-client.ts`); `tests/fleet-schedule-route.test.ts`
 * hands this route's real bytes to that client, so the two cannot drift apart
 * unnoticed.
 */
import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";

import { SCHEDULE_PREVIEW_FILE } from "../overseer/schedule-preview.js";
import { parseSchedulePreview, SCHEDULE_PREVIEW_SCHEMA } from "./schedule-parse.js";

export const SCHEDULE_PATH = "/api/overseer/schedule";

/** The payload's own version — not the file's, which is `SCHEDULE_PREVIEW_SCHEMA`. */
export const SCHEDULE_PAYLOAD_SCHEMA = 1;

/** A few KB is what the daemon writes for a handful of jobs. Past this, the file is not read at all. */
export const MAX_SCHEDULE_FILE_BYTES = 256 * 1024;

/** What reading the store's file found, before the parser has seen it. */
export type ScheduleFileRead =
  | { kind: "absent" }
  | { kind: "too-large"; bytes: number }
  | { kind: "unreadable"; why: string }
  | { kind: "read"; json: unknown };

export type ScheduleRouteDeps = {
  readFile(): ScheduleFileRead;
  nowMs(): number;
};

/** The answer, one arm per kind of nothing, with the server's instant on every one. */
export type SchedulePayload = {
  schema: typeof SCHEDULE_PAYLOAD_SCHEMA;
  /** When this server read the file, by its own clock — the box's, like the file's `writtenAt`. */
  servedAt: string;
  file:
    | { kind: "absent"; why: string }
    | { kind: "unreadable"; why: string }
    | { kind: "unsupported-schema"; schema: number; known: number }
    /** The file's own JSON, which the one parser accepted as a preview. The browser parses it again. */
    | { kind: "preview"; preview: unknown };
};

const ABSENT =
  `there is no ${SCHEDULE_PREVIEW_FILE} in the Overseer store this dashboard reads: the running daemon predates this build and writes no preview, ` +
  "or has not finished a checkpoint tick since it started, or is failing to write the file";

function message(cause: unknown): string {
  return cause instanceof Error && cause.message.trim() !== "" ? cause.message : String(cause);
}

/**
 * The default reader: the store's file, refused on its size before it is read.
 *
 * Opened first and measured through the descriptor, so the size checked is the
 * size of the file read — the daemon replaces it by rename, and a path checked
 * then read could be two different files.
 */
export function readScheduleFile(storeDir: string, maxBytes = MAX_SCHEDULE_FILE_BYTES): ScheduleFileRead {
  const path = join(storeDir, SCHEDULE_PREVIEW_FILE);
  let fd: number;
  try {
    // Do not follow a store entry somewhere else, and do not let a FIFO block
    // the dashboard before `fstat` can refuse it as non-regular.
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return { kind: "absent" };
    if ((cause as NodeJS.ErrnoException).code === "ELOOP") {
      return { kind: "unreadable", why: `${SCHEDULE_PREVIEW_FILE} is not a regular file in the Overseer store, so it was not read` };
    }
    return { kind: "unreadable", why: `${SCHEDULE_PREVIEW_FILE} could not be opened (${message(cause)})` };
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) return { kind: "unreadable", why: `${SCHEDULE_PREVIEW_FILE} is not a regular file in the Overseer store, so it was not read` };
    const bytes = stat.size;
    if (bytes > maxBytes) return { kind: "too-large", bytes };
    const text = readFileSync(fd, "utf8");
    try {
      return { kind: "read", json: JSON.parse(text) as unknown };
    } catch (cause) {
      return { kind: "unreadable", why: `${SCHEDULE_PREVIEW_FILE} is not JSON (${message(cause)})` };
    }
  } catch (cause) {
    return { kind: "unreadable", why: `${SCHEDULE_PREVIEW_FILE} could not be read (${message(cause)})` };
  } finally {
    closeSync(fd);
  }
}

/** The whole answer, pure given its reader and clock. Never throws for anything the reader does. */
export function schedulePayload(deps: ScheduleRouteDeps): SchedulePayload {
  const servedAt = new Date(deps.nowMs()).toISOString();
  let read: ScheduleFileRead;
  try {
    read = deps.readFile();
  } catch (cause) {
    read = { kind: "unreadable", why: `reading ${SCHEDULE_PREVIEW_FILE} threw: ${message(cause)}` };
  }
  const answer = (file: SchedulePayload["file"]): SchedulePayload => ({ schema: SCHEDULE_PAYLOAD_SCHEMA, servedAt, file });
  switch (read.kind) {
    case "absent":
      return answer({ kind: "absent", why: ABSENT });
    case "too-large":
      return answer({
        kind: "unreadable",
        why: `${SCHEDULE_PREVIEW_FILE} is ${read.bytes} bytes, more than the ${MAX_SCHEDULE_FILE_BYTES} this route will read, so it was not read — the daemon writes a few kilobytes`,
      });
    case "unreadable":
      return answer({ kind: "unreadable", why: read.why });
    case "read": {
      const parsed = parseSchedulePreview(read.json);
      switch (parsed.kind) {
        case "preview":
          return answer({ kind: "preview", preview: read.json });
        case "unsupported-schema":
          return answer({ kind: "unsupported-schema", schema: parsed.schema, known: SCHEDULE_PREVIEW_SCHEMA });
        case "unreadable":
          return answer({ kind: "unreadable", why: parsed.why });
        default: {
          const never: never = parsed;
          throw new Error(`no schedule payload for ${JSON.stringify(never)}`);
        }
      }
    }
    default: {
      const never: never = read;
      throw new Error(`no schedule payload for ${JSON.stringify(never)}`);
    }
  }
}

function json(res: ServerResponse, req: IncomingMessage, status: number, value: unknown, extra: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...extra });
  res.end(req.method === "HEAD" ? undefined : JSON.stringify(value));
}

/**
 * The path exactly, and only it: a query string is the same route, anything
 * beneath it is a 404, and a sibling such as `/api/overseer/schedules` is not
 * this route's to claim.
 */
export function scheduleRoute(deps: ScheduleRouteDeps): { handle(req: IncomingMessage, res: ServerResponse): boolean } {
  return {
    handle(req, res): boolean {
      const path = (req.url ?? "/").split("?")[0] ?? "";
      if (path !== SCHEDULE_PATH && !path.startsWith(`${SCHEDULE_PATH}/`)) return false;
      if (path !== SCHEDULE_PATH) {
        json(res, req, 404, { error: "route-not-found", why: `no such route: ${path}` });
        return true;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        json(res, req, 405, { error: "method-not-allowed", why: "the schedule preview is read-only; use GET or HEAD" }, { allow: "GET, HEAD" });
        return true;
      }
      let payload: SchedulePayload;
      try {
        payload = schedulePayload(deps);
      } catch (cause) {
        json(res, req, 500, { error: "internal-error", why: `building the schedule answer threw: ${message(cause)}` });
        return true;
      }
      json(res, req, 200, payload);
      return true;
    },
  };
}
