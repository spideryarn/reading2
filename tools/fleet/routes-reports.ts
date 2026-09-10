/**
 * `GET /api/reports` — what agents claimed, for the Claims section of the
 * Decisions tab. Plan 260910e, Stage 3a.
 *
 * A route module rather than lines in `server.ts`, for the reason
 * `routes-decisions.ts` gives: importing `server.ts` binds a port, so anything
 * living there cannot be driven by a test. `reportsPayload` is pure given its
 * readers; `makeReportsRoute` is the production composition, and
 * `reportsApiRoute` is the one instance `server.ts` mounts.
 *
 * ## Read-only, and that is a design decision
 *
 * A report is a claim the daemon records from its inbox, stamped against the
 * register it holds. A write path here would let anything that can reach this
 * unauthenticated port claim to be any session. Submissions go through
 * `npx tsx scripts/overseer.ts report`; this route only reads.
 *
 * ## Four arms, because the silences are different
 *
 * `never-written`, `reports` and `unreadable` carry `readReports` through: a
 * LOST log (`reports.created` present, the log gone) must never read as a new
 * empty one. `never-written` also carries the inbox counts, because "nothing
 * recorded, three submitted" is how a daemon that is not draining shows up.
 * `oversized-file` refuses before reading, like the decisions route.
 *
 * ## The bounds, and their exact strength
 *
 * The 8 MiB input ceiling is checked with `statSync` before the read, without
 * the daemon's lock, so an append in between can make the read larger than
 * the ceiling that admitted it — a guard against a log that has grown, not a
 * hard limit; `routes-decisions.ts` says the same of its own. The 2 MiB
 * response ceiling is exact: the session rows, counts and problems are
 * mandatory, and recent claims are withheld from the oldest end, counted.
 *
 * The inbox is not behind the 8 MiB check — it is a directory, not a file — so
 * its bound is `readInbox`'s own: each directory read lazily to at most 1 000
 * entries, at most 200 files opened in each, and every count carried as
 * `{ exact }` or `{ atLeast }` (GPT Sol's WR-S3-5). A flooded inbox costs this
 * route a bounded read and arrives as "at least", never as a partial number.
 */
import { statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

import { loadCheckpoint, storeRoot, type CheckpointLoad } from "./attention.js";
import {
  inboxCounts,
  projectReports,
  type InboxCounts,
  type ProjectedClaim,
  type ProjectedClaimed,
  type ProjectedSessions,
} from "./reports-view.js";
import type {
  ReportsFeed,
  ReportWireActor,
  ReportWireClaim,
  ReportWireClaimed,
  ReportWireCount,
  ReportWireQuarantine,
  ReportWireSessions,
} from "./wire.js";
import {
  readInbox as readReportInbox,
  readReports as readReportLog,
  REPORTS_FILE,
  type BoundedCount,
  type InboxListing,
  type ReportActor,
  type ReportsRead,
} from "../overseer/reports.js";

export const REPORTS_PATH = "/api/reports";

/**
 * The payload's schema, on every arm including the inline refusals. Not the
 * log's schema. 2 since WR-S3-5 made every count `{ exact } | { atLeast }`: a
 * browser that reads version 1 refuses the new shape rather than drawing an
 * object where it expects a number.
 */
export const REPORTS_FEED_SCHEMA = 2;
export const MAX_REPORTS_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MAX_REPORTS_INPUT_BYTES = 8 * 1024 * 1024;

export type ReportsRouteReaders = {
  /** Checked before `readReports`; null means there is no file to size. */
  reportFileSize(): { path: string; sizeBytes: number } | null;
  /** Injected so a test never touches `~/.overseer/`. */
  readReports(): ReportsRead;
  readInbox(): InboxListing;
  /** One already-read checkpoint arm; `projectReports` owns its meaning. */
  loadCheckpoint(): CheckpointLoad;
  now(): Date;
};

/** The report root is the store root: the daemon that drains the inbox writes there. */
function realReaders(): ReportsRouteReaders {
  return {
    reportFileSize: () => {
      try {
        const file = path.join(storeRoot(), REPORTS_FILE);
        return { path: file, sizeBytes: statSync(file).size };
      } catch {
        // `readReports` owns absent and unreadable, and their copy.
        return null;
      }
    },
    readReports: () => {
      let root: string;
      try {
        root = storeRoot();
      } catch (cause) {
        return { kind: "unreadable", why: cause instanceof Error ? cause.message : String(cause), path: REPORTS_FILE };
      }
      return readReportLog(root);
    },
    readInbox: () => readReportInbox(storeRoot()),
    loadCheckpoint: () => loadCheckpoint(),
    now: () => new Date(),
  };
}

function actorForWire(actor: ReportActor): ReportWireActor {
  return actor.kind === "session" ? { kind: "session", name: actor.name } : { kind: actor.kind };
}

function claimForWire(claim: ProjectedClaim): ReportWireClaim {
  const head = {
    eventId: claim.eventId,
    claimedBy: actorForWire(claim.claimedBy),
    submittedAt: claim.submittedAt,
    receivedAt: claim.receivedAt,
    execution:
      claim.execution !== null && typeof claim.execution === "object"
        ? { unverifiable: claim.execution.unverifiable }
        : claim.execution,
    job: {
      plan: claim.job.plan,
      queueItem: claim.job.queueItem,
      occurrence: claim.job.occurrence === null ? null : { ...claim.job.occurrence },
    },
    summary: claim.summary,
    artefacts: claim.artefacts.map((item) => ({ ref: { ...item.ref }, check: { ...item.check } })),
    corrects: claim.corrects,
    correctedBy:
      claim.correctedBy === null
        ? null
        : { eventId: claim.correctedBy.eventId, actor: actorForWire(claim.correctedBy.actor), at: claim.correctedBy.at },
    laterClaim: claim.laterClaim,
  };
  switch (claim.kind) {
    case "progress":
      return { ...head, kind: "progress" };
    case "blocked":
      return { ...head, kind: "blocked", on: claim.on, needs: claim.needs };
    case "completed":
      return {
        ...head,
        kind: "completed",
        ending: claim.ending,
        revisions: {
          reviewed: [...claim.revisions.reviewed],
          tested: [...claim.revisions.tested],
          merged: [...claim.revisions.merged],
        },
      };
    case "decision":
      return { ...head, kind: "decision", decisionId: claim.decisionId };
    default: {
      const never: never = claim;
      throw new Error(`unhandled claim kind ${JSON.stringify(never)}`);
    }
  }
}

function countForWire(count: BoundedCount): ReportWireCount {
  return "exact" in count ? { exact: count.exact } : { atLeast: count.atLeast };
}

function countsForWire(counts: InboxCounts): { inFlight: ReportWireCount; refused: ReportWireCount; quarantine: ReportWireQuarantine } {
  return {
    inFlight: countForWire(counts.inFlight),
    refused: countForWire(counts.refused),
    quarantine: { count: countForWire(counts.quarantine.count), oldestMovedAt: counts.quarantine.oldestMovedAt },
  };
}

function claimedForWire(claimed: ProjectedClaimed): ReportWireClaimed {
  return { kind: "claimed", claims: claimed.claims, latest: claimForWire(claimed.latest) };
}

function sessionsForWire(sessions: ProjectedSessions): ReportWireSessions {
  if (sessions.kind === "register-unavailable") {
    return {
      kind: "register-unavailable",
      why: sessions.why,
      reported: sessions.reported.map((row) => ({ name: row.name, latest: claimedForWire(row.latest) })),
    };
  }
  return {
    kind: "joined-with-register",
    rows: sessions.rows.map((row) =>
      row.register === "not-in-register"
        ? { name: row.name, register: "not-in-register", latest: claimedForWire(row.latest) }
        : {
            name: row.name,
            register: "in-register",
            latest: row.latest.kind === "unreported" ? { kind: "unreported" } : claimedForWire(row.latest),
          },
    ),
  };
}

function bodyBytes(payload: ReportsFeed): number {
  return Buffer.byteLength(JSON.stringify(payload), "utf8");
}

function unreadable(why: string, composedAt: string): Extract<ReportsFeed, { kind: "unreadable" }> {
  const answer: Extract<ReportsFeed, { kind: "unreadable" }> = { schema: REPORTS_FEED_SCHEMA, kind: "unreadable", composedAt, why };
  return bodyBytes(answer) <= MAX_REPORTS_RESPONSE_BYTES
    ? answer
    : {
        schema: REPORTS_FEED_SCHEMA,
        kind: "unreadable",
        composedAt,
        why: `the reports log failed with a reason too large for this route's ${MAX_REPORTS_RESPONSE_BYTES}-byte response limit`,
      };
}

/** Compose and bound the payload. Pure given its readers. */
export function reportsPayload(readers: ReportsRouteReaders): ReportsFeed {
  const now = readers.now();
  const composedAt = now.toISOString();
  const input = readers.reportFileSize();
  if (input !== null && input.sizeBytes > MAX_REPORTS_INPUT_BYTES) {
    return {
      schema: REPORTS_FEED_SCHEMA,
      kind: "oversized-file",
      composedAt,
      sizeBytes: input.sizeBytes,
      limitBytes: MAX_REPORTS_INPUT_BYTES,
      why:
        `${input.path} is ${input.sizeBytes} bytes, above this route's ${MAX_REPORTS_INPUT_BYTES}-byte synchronous ` +
        "input limit. It was not read; use `npx tsx scripts/overseer.ts reports` to read the log.",
    };
  }
  const read = readers.readReports();
  if (read.kind === "unreadable") return unreadable(read.why, composedAt);
  const inbox = readers.readInbox();
  if (read.kind === "never-written") {
    return {
      schema: REPORTS_FEED_SCHEMA,
      kind: "never-written",
      composedAt,
      why:
        `no report has been recorded yet: ${read.path} has never been written. That is the ordinary state ` +
        "before the first report, not the same as a log that exists and is empty.",
      ...countsForWire(inboxCounts(inbox)),
    };
  }

  const projection = projectReports(read.view, inbox, readers.loadCheckpoint(), now);
  const sessions = sessionsForWire(projection.sessions);
  const problems = projection.problems.map((problem) => ({ ...problem }));
  const recent = projection.recent.map(claimForWire);
  const totalClaims = projection.recent.length + projection.recentWithheld;
  const counts = countsForWire(projection);
  const answerWith = (count: number): Extract<ReportsFeed, { kind: "reports" }> => ({
    schema: REPORTS_FEED_SCHEMA,
    kind: "reports",
    path: read.path,
    composedAt,
    sessions,
    recent: recent.slice(0, count),
    recentWithheld: totalClaims - count,
    ...counts,
    problems,
  });

  if (bodyBytes(answerWith(0)) > MAX_REPORTS_RESPONSE_BYTES) {
    return unreadable(
      "the reports answer's required context — the session rows and the log's problems — exceeds this route's " +
        `${MAX_REPORTS_RESPONSE_BYTES}-byte response limit. No claim was truncated; use ` +
        "`npx tsx scripts/overseer.ts reports` to read the log.",
      composedAt,
    );
  }
  /* The payload grows monotonically with a prefix of recent claims, so a binary
     search finds the largest prefix that fits; the withheld count is recomputed
     for each candidate, so it covers both the row cap and the byte cap. */
  let low = 0;
  let high = recent.length;
  while (low < high) {
    const count = Math.ceil((low + high) / 2);
    if (bodyBytes(answerWith(count)) <= MAX_REPORTS_RESPONSE_BYTES) low = count;
    else high = count - 1;
  }
  return answerWith(low);
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: string,
  extra: Record<string, string> = {},
  withoutBody = false,
): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...extra });
  res.end(withoutBody ? undefined : body);
}

/** The exact production composition. Tests inject only its leaf readers. */
export function makeReportsRoute(readers: ReportsRouteReaders = realReaders()): {
  handle(req: IncomingMessage, res: ServerResponse): boolean;
} {
  return {
    handle(req, res): boolean {
      const url = req.url ?? "/";
      if (!url.startsWith(REPORTS_PATH)) return false;
      const head = req.method === "HEAD";
      const bare = url.split("?")[0] ?? "";
      if (bare !== REPORTS_PATH) {
        sendJson(res, 404, JSON.stringify(unreadable(`no such route: ${bare}`, readers.now().toISOString())), {}, head);
        return true;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        sendJson(
          res,
          405,
          JSON.stringify(
            unreadable(
              "this route is read-only on purpose: a report is a claim the daemon records from its inbox, and this " +
                "server has no authentication. Submit one with `npx tsx scripts/overseer.ts report <kind>`.",
              readers.now().toISOString(),
            ),
          ),
          { allow: "GET, HEAD" },
        );
        return true;
      }

      let payload: ReportsFeed;
      try {
        payload = reportsPayload(readers);
      } catch (cause) {
        sendJson(
          res,
          500,
          JSON.stringify(
            unreadable(
              `building the reports answer threw: ${cause instanceof Error ? cause.message : String(cause)}`,
              readers.now().toISOString(),
            ),
          ),
          {},
          head,
        );
        return true;
      }
      let body = JSON.stringify(payload);
      // A defensive last check on the bytes actually sent; `reportsPayload` owns the useful reduction.
      if (Buffer.byteLength(body, "utf8") > MAX_REPORTS_RESPONSE_BYTES) {
        body = JSON.stringify(
          unreadable(`the reports answer exceeded this route's ${MAX_REPORTS_RESPONSE_BYTES}-byte response limit`, payload.composedAt),
        );
      }
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : body);
      return true;
    },
  };
}

/** The one instance `server.ts` mounts. Its readers resolve the store root per request. */
export const reportsApiRoute = makeReportsRoute();
