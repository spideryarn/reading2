/**
 * `GET /api/decisions` — things done in Greg's name, for later review.
 *
 * A route module rather than lines in `server.ts`, for the reason
 * `routes-health-history.ts` states: importing `server.ts` binds port 8787, so
 * anything living there cannot be driven by a test. `decisionsPayload` is pure
 * given its readers, and `makeDecisionsRoute` is the production composition
 * which both `server.ts` and the route suite drive.
 *
 * ## READ-ONLY, AND THAT IS A SECURITY DECISION
 *
 * This dashboard has no authentication; reachability is the whole boundary.
 * A `POST …/reviewed` would let anything able to reach the port mark a decision
 * reviewed **in Greg's name**. That is precisely the number this record exists
 * to protect, and the fold's “only Greg may review” rule would accept a forged
 * `by`. There is therefore no write path here. Adding one waits on an identity
 * story. Only `scripts/overseer-decisions.ts` writes this record today.
 *
 * ## Five arms, because the silences are different
 *
 * `never-written`, `decisions`, and `unreadable` carry `readDecisions` through
 * rather than flattening it. This file is original input, not a cache: a record
 * this build cannot understand must never look like a healthy empty log. The
 * fourth arm, `oversized-unreviewed`, refuses loudly rather than dropping a
 * decision Greg has not seen. `oversized-file` refuses before reading and
 * folding an input over the explicit limit below.
 *
 * ## No gzip
 *
 * This route normally carries tens of rows. The content-encoding branch would
 * be more code than it saves; the explicit row and byte ceilings below bound
 * the exceptional case without adding synchronous compression to the shared
 * dashboard process. More importantly, the input byte ceiling makes the
 * synchronous read and fold defensible in this single Node control-plane
 * process: their worst case is stated before either operation begins.
 */
import { statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

import { loadCheckpoint, type CheckpointLoad } from "./attention.js";
import { projectDecisions, type DecisionsProjection } from "./decisions-view.js";
import type { DecisionRow, DecisionsFeed } from "./wire.js";
import {
  readDecisions as readDecisionRecord,
  DECISIONS_FILE,
  decisionsRoot,
  spellVersion,
  type DecisionRead,
} from "../overseer/decisions.js";

export const DECISIONS_PATH = "/api/decisions";

/** One hundred recent history rows show useful review/reversal context without making the record unbounded. */
export const REVIEWED_HISTORY_LIMIT = 100;

/**
 * A hard ceiling on the complete JSON body: 2 MiB is cheap on a phone and
 * gives ordinary decision prose orders of magnitude of headroom.
 */
export const MAX_DECISIONS_RESPONSE_BYTES = 2 * 1024 * 1024;

/** The largest append-only record this single-threaded request path will synchronously read and fold. */
export const MAX_DECISIONS_INPUT_BYTES = 8 * 1024 * 1024;

export type DecisionsRouteReaders = {
  /** Checked before `readDecisions`; null means there is no file to size. */
  decisionFileSize(): { path: string; sizeBytes: number } | null;
  /** Injected so a test never touches `~/.overseer/`. */
  readDecisions(): DecisionRead;
  /** One already-read checkpoint arm; `projectDecisions` owns its meaning. */
  loadCheckpoint(): CheckpointLoad;
  /** The server's clock owns both composed-at and every age/count window. */
  now(): Date;
};

function realReaders(): DecisionsRouteReaders {
  return {
    decisionFileSize: () => {
      const root = decisionsRoot();
      if (!path.isAbsolute(root)) return null;
      const file = path.join(root, DECISIONS_FILE);
      try {
        return { path: file, sizeBytes: statSync(file).size };
      } catch {
        /* `readDecisions` owns absent/unreadable distinctions and their copy.
           This probe owns only the positive fact that a present file is over
           the synchronous-work bound. */
        return null;
      }
    },
    readDecisions: () => readDecisionRecord(),
    loadCheckpoint: () => loadCheckpoint(),
    now: () => new Date(),
  };
}

function rowForWire(row: DecisionsProjection["records"][number]): DecisionRow {
  return {
    record: {
      ...row.record,
      options: row.record.options.map((option) => ({ ...option })),
      chose: { ...row.record.chose },
      advisers: [...row.record.advisers],
      bearsOn: {
        sessions: row.record.bearsOn.sessions.map((session) => ({
          name: session.name,
          execution: { ...session.execution },
        })),
        plan: row.record.bearsOn.plan,
      },
      touches: row.record.touches.map((touch) => ({ ...touch })),
    },
    ageMs: row.ageMs,
    pendingReview: row.pendingReview,
    sessions: row.sessions.map((session) => ({
      name: session.name,
      state:
        session.state.kind === "unavailable"
          ? { kind: "unavailable", why: { ...session.state.why } }
          : { ...session.state },
    })),
  };
}

type DecisionsAnswer = Extract<DecisionsFeed, { kind: "decisions" }>;

function answerWithRows(
  read: Extract<DecisionRead, { kind: "decisions" }>,
  projection: DecisionsProjection,
  rows: DecisionRow[],
  historyWithheld: number,
): DecisionsAnswer {
  return {
    schema: 1,
    kind: "decisions",
    version: spellVersion(read.view.version),
    path: read.path,
    composedAt: projection.composedAt,
    checkpoint: projection.checkpoint,
    aggregates: projection.aggregates,
    rows,
    historyWithheld,
    problems: projection.problems.map((problem) => ({ ...problem })),
  };
}

function bodyBytes(payload: DecisionsFeed): number {
  return Buffer.byteLength(JSON.stringify(payload), "utf8");
}

function unreadable(
  why: string,
  composedAt: string,
): Extract<DecisionsFeed, { kind: "unreadable" }> {
  const answer: Extract<DecisionsFeed, { kind: "unreadable" }> = {
    schema: 1,
    kind: "unreadable",
    composedAt,
    why,
  };
  return bodyBytes(answer) <= MAX_DECISIONS_RESPONSE_BYTES
    ? answer
    : {
        schema: 1,
        kind: "unreadable",
        composedAt,
        why: "the decision record failed with a reason too large for this route's 2097152-byte response limit",
      };
}

function oversized(
  unreviewedCount: number,
  composedAt: string,
): Extract<DecisionsFeed, { kind: "oversized-unreviewed" }> {
  return {
    schema: 1,
    kind: "oversized-unreviewed",
    composedAt,
    unreviewedCount,
    limitBytes: MAX_DECISIONS_RESPONSE_BYTES,
    why:
      `the ${unreviewedCount} not-yet-reviewed decision(s), plus the context needed to read them, ` +
      `exceed this route's ${MAX_DECISIONS_RESPONSE_BYTES}-byte limit. None were truncated. ` +
      "Use `npx tsx scripts/overseer-decisions.ts list` to inspect the record.",
  };
}

function oversizedFile(
  input: { path: string; sizeBytes: number },
  composedAt: string,
): Extract<DecisionsFeed, { kind: "oversized-file" }> {
  return {
    schema: 1,
    kind: "oversized-file",
    composedAt,
    sizeBytes: input.sizeBytes,
    limitBytes: MAX_DECISIONS_INPUT_BYTES,
    why:
      `${input.path} is ${input.sizeBytes} bytes, above this route's ${MAX_DECISIONS_INPUT_BYTES}-byte ` +
      "synchronous input limit. It was not read or folded; use `npx tsx scripts/overseer-decisions.ts list` " +
      "to inspect the record.",
  };
}

/**
 * Compose and bound the payload. Pure given its readers: it performs no
 * I/O and has no clock of its own.
 */
export function decisionsPayload(readers: DecisionsRouteReaders): DecisionsFeed {
  const now = readers.now();
  const composedAt = now.toISOString();
  const input = readers.decisionFileSize();
  if (input !== null && input.sizeBytes > MAX_DECISIONS_INPUT_BYTES) {
    return oversizedFile(input, composedAt);
  }
  const read = readers.readDecisions();
  if (read.kind === "never-written") {
    return {
      schema: 1,
      kind: "never-written",
      composedAt,
      why:
        "no decision record has been written yet. That is the ordinary state before the first decision, " +
        "not the same as a record which exists and is empty.",
    };
  }
  if (read.kind === "unreadable") {
    return unreadable(read.why, composedAt);
  }

  const projection = projectDecisions(read.view, readers.loadCheckpoint(), now);
  const pendingProjected = projection.records.filter((row) => row.pendingReview);
  const byId = new Map(projection.records.map((row) => [row.record.id, row]));
  const requiredIds = new Set(pendingProjected.map((row) => row.record.id));
  for (const pending of pendingProjected) {
    let ancestorId = pending.record.supersedes;
    while (ancestorId !== null && !requiredIds.has(ancestorId)) {
      requiredIds.add(ancestorId);
      ancestorId = byId.get(ancestorId)?.record.supersedes ?? null;
    }
  }
  /* A pending correction is not intelligible without everything it replaced.
     Keep pending rows and their complete supersession ancestry in the record's
     established order, outside the history cap but inside the byte ceiling. */
  const required = projection.records.filter((row) => requiredIds.has(row.record.id)).map(rowForWire);
  const history = projection.records.filter((row) => !requiredIds.has(row.record.id)).map(rowForWire);
  const cappedHistory = history.slice(0, REVIEWED_HISTORY_LIMIT);

  const mandatory = answerWithRows(read, projection, required, history.length);
  if (bodyBytes(mandatory) > MAX_DECISIONS_RESPONSE_BYTES) {
    /* The named arm says the protected rows themselves are too large. Required
       context can independently be pathological (for example, thousands of
       parse problems); calling that “0 unreviewed rows are oversized” is both
       false and confusing, so it remains a loud but bounded unreadable arm. */
    if (Buffer.byteLength(JSON.stringify(required), "utf8") > MAX_DECISIONS_RESPONSE_BYTES) {
      return oversized(pendingProjected.length, composedAt);
    }
    return unreadable(
      "the decision answer's required context exceeds this route's 2097152-byte response limit. " +
        "No decision rows were truncated; use `npx tsx scripts/overseer-decisions.ts list` to inspect the record.",
      composedAt,
    );
  }

  /* The complete payload grows monotonically with a prefix of history. Binary
     search finds the largest prefix that fits without serialising up to 100
     near-2-MiB candidates. The withheld count is recomputed for every candidate
     and therefore includes both the row cap and the byte cap exactly. */
  let low = 0;
  let high = cappedHistory.length;
  while (low < high) {
    const count = Math.ceil((low + high) / 2);
    const candidate = answerWithRows(
      read,
      projection,
      [...required, ...cappedHistory.slice(0, count)],
      history.length - count,
    );
    if (bodyBytes(candidate) <= MAX_DECISIONS_RESPONSE_BYTES) low = count;
    else high = count - 1;
  }

  return answerWithRows(
    read,
    projection,
    [...required, ...cappedHistory.slice(0, low)],
    history.length - low,
  );
}

/** The exact production composition. Tests inject only its leaf readers. */
export function makeDecisionsRoute(readers: DecisionsRouteReaders = realReaders()): {
  handle(req: IncomingMessage, res: ServerResponse): boolean;
} {
  return {
    handle(req, res): boolean {
      const url = req.url ?? "/";
      if (!url.startsWith(DECISIONS_PATH)) return false;
      const bare = url.split("?")[0] ?? "";
      if (bare !== DECISIONS_PATH) {
        res.writeHead(404, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify(unreadable(`no such route: ${bare}`, readers.now().toISOString())));
        return true;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, {
          "content-type": "application/json",
          "cache-control": "no-store",
          allow: "GET, HEAD",
        });
        res.end(
          JSON.stringify({
            schema: 1,
            kind: "unreadable",
            composedAt: readers.now().toISOString(),
            why:
              "this route is read-only on purpose: the decision record protects what Greg has reviewed, " +
              "and this server has no authentication. Use `npx tsx scripts/overseer-decisions.ts` to write.",
          }),
        );
        return true;
      }

      let payload: DecisionsFeed;
      try {
        payload = decisionsPayload(readers);
      } catch (cause) {
        res.writeHead(500, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(
          JSON.stringify(
            unreadable(
              `building the decisions answer threw: ${cause instanceof Error ? cause.message : String(cause)}`,
              readers.now().toISOString(),
            ),
          ),
        );
        return true;
      }

      let body = JSON.stringify(payload);
      /* A defensive final check on the bytes actually sent. `decisionsPayload`
         owns the useful reduction; this protects the contract if that code is
         later changed without updating its accounting. */
      if (Buffer.byteLength(body, "utf8") > MAX_DECISIONS_RESPONSE_BYTES) {
        body = JSON.stringify(
          payload.kind === "decisions"
            ? oversized(payload.rows.filter((row) => row.pendingReview).length, payload.composedAt)
            : unreadable(
                "the decisions answer exceeded this route's 2097152-byte response limit",
                payload.composedAt,
              ),
        );
      }
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : body);
      return true;
    },
  };
}
