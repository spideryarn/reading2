/**
 * `GET /api/feed` — the last N messages across every session, newest first.
 *
 * Greg, 2026-09-08:
 *
 * > add a "Recent messages" tab with a rolling window of the last N messages
 * > across all agents (making it easy to filter)
 *
 * ## THIS FILE PARSES NOTHING
 *
 * `tools/fleet/transcript.ts` locates the transcript, walks it backwards inside
 * a byte budget, classifies the speakers and writes the sentence for every way
 * it can fail. It is tested and it is not touched here. **This module is a
 * fan-out, a merge and a trim** — one `readRecentMessages` per row, and then
 * arithmetic. A second transcript parser is the thing most worth not building.
 *
 * ## WHY IT IS A ROUTE MODULE AND NOT LINES IN `server.ts`
 *
 * Importing `server.ts` binds port 8787, so anything living there cannot be
 * driven by a test. Same reason `routes-health-history.ts` is a module, and the
 * interesting half here — `mergeFeed` — is pure and takes no clock, no socket
 * and no filesystem.
 *
 * ## THE MERGE IS EXACT, AND THAT IS WHAT THE PER-SESSION LIMIT BUYS
 *
 * Each session is asked for **its own newest `limit`**, the same number the
 * reader asked for. Merge, sort descending, take `limit`. That is exactly "the
 * last N messages across all agents", and the proof is one line: any message
 * among the true newest N must be among its own session's newest N.
 *
 * The tempting cheaper version — ask each session for a small fixed k and merge
 * — is **wrong in precisely the case this tab exists for.** If one agent has
 * just written 40 of the last 50 messages on the box, the k=6 version shows six
 * of them and pads the rest with older messages from quieter sessions, and it
 * looks entirely normal doing it. Measured, reading more turns per session is
 * nearly free (limit 6 and limit 12 both read about one 256 kB chunk each), so
 * there is no reason to be approximate. The numbers are in the plan.
 *
 * ## AND WHERE THAT PROOF STOPS BEING TRUE
 *
 * It assumes each session really returned its newest `limit`, and a session
 * whose turns do not fit the byte budget returns fewer. **A short answer and a
 * quiet agent are the same thing on screen**, which is this feature's
 * silent-success failure (docs/reusable/silent-success.md). So `complete` is
 * computed per session, and `mayBeMissing` says which of the incomplete ones
 * actually cost the feed anything — see `mergeFeed`, which is where the one
 * piece of arithmetic worth reading lives.
 *
 * ## UNTRUSTED, ALL OF IT
 *
 * Every string that comes back is agent-authored text from a process that may
 * have been handling hostile input. Nothing here interprets it and nothing that
 * renders it may add markup.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { gzipSync } from "node:zlib";

import type { FleetRow, FleetSnapshot } from "./collect.js";
import { readRecentMessages, type RecentMessages } from "./transcript.js";
import type { FeedAttribution, FeedMessage, FeedPayload, FeedSession, FeedSessionRead } from "./wire.js";

export const FEED_PATH = "/api/feed";

/** How many messages the feed shows when nobody says. */
export const DEFAULT_FEED_LIMIT = 50;

/**
 * The most it will serve.
 *
 * Not a security limit — this server has no untrusted caller — but a limit on
 * how much gets read off disk and serialised because somebody typed a number
 * into a URL. At 100 per session the fan-out read 13 MB and produced 453 kB of
 * JSON; 200 is roughly twice that and is the point past which this stops being
 * a rolling window.
 */
export const MAX_FEED_LIMIT = 200;

/** Compress above this. Below it the header costs more than it saves. */
const GZIP_ABOVE_BYTES = 8 * 1024;

/**
 * How long a `working` session may write nothing before its attribution is
 * called into question.
 *
 * **THIS IS THE SAME NUMBER AS `STALE_TRANSCRIPT_MS` IN
 * `web/src/messages-client.ts`, AND THE DUPLICATE IS STRUCTURALLY FORCED.** That
 * file is compiled under the browser project (`web/tsconfig.json`, DOM libs, no
 * node types) and this one reaches `node:zlib`; neither can import the other,
 * and `wire.ts` — the one file both can see — is types only and may hold no
 * runtime value. So the choice was a third home nobody would find or a stated
 * copy, and this is the stated copy.
 *
 * The reasoning, which lives there: thirty minutes is a trade rather than a
 * fact. The false alarm to avoid is a genuine long tool call — the full gate on
 * this box takes 24 minutes and writes nothing to the transcript while it runs
 * — and the case it exists to catch is a transcript last written *hours* ago
 * against a row the collector calls `working`. Hours clear thirty minutes
 * easily. If one moves, move both.
 */
export const STALE_TRANSCRIPT_MS = 30 * 60 * 1000;

/**
 * How many messages the caller asked for, clamped, never NaN.
 *
 * Pure and exported so the clamp is testable without a socket. Nonsense falls
 * back to the default rather than erroring: this is a feed, and refusing to
 * draw because a query string was odd helps nobody.
 */
export function limitFrom(url: string): number {
  const value = new URL(url, "http://fleet.invalid").searchParams.get("limit");
  if (value === null) return DEFAULT_FEED_LIMIT;
  const limit = Number(value);
  if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_FEED_LIMIT;
  return Math.min(Math.floor(limit), MAX_FEED_LIMIT);
}

/**
 * One session's answer, ready to merge.
 *
 * The row's own fields rather than the row, so `mergeFeed` can be driven from a
 * fixture without building a `FleetRow`.
 */
export type FeedInput = {
  sessionId: string;
  name: string;
  title: string | null;
  /** `true` when the collector calls this row `working` — the only status the staleness check applies to. */
  working: boolean;
  result: RecentMessages;
};

/**
 * What the feed may claim about who said this, today.
 *
 * **`verified` is unreachable from here and that is deliberate.** It needs
 * `FleetRow.execution` (session 260908f-roadmap-exec-identity), which is not on
 * `dev`. When it lands, this function reads that field and nothing else in the
 * file moves. An arm nothing can currently produce is better than a `verified`
 * that quietly means "we did not check".
 *
 * **Only `working` rows are checked for staleness**, following
 * `transcriptAge` in messages-client.ts and for its reason: a session parked on
 * a dialog writes nothing until somebody answers it, routinely for hours, so
 * checking those would put the warning on exactly the rows Greg opens this page
 * to look at — and a warning that is usually wrong is one nobody reads.
 */
export function attributionOf(working: boolean, lastModified: string, nowMs: number): FeedAttribution {
  const claimed: FeedAttribution = {
    kind: "claimed-only",
    why: "the conversation id is the one pinned into this pane when it was created, which nothing has confirmed is still the conversation running in it",
  };
  if (!working) return claimed;
  const at = Date.parse(lastModified);
  if (!Number.isFinite(at)) return claimed;
  const ms = nowMs - at;
  if (ms < STALE_TRANSCRIPT_MS) return claimed;
  const minutes = Math.round(ms / 60_000);
  return {
    kind: "suspect",
    why: `this session is working, but its transcript has not been written to for ${minutes} minutes — the pane may have been re-used for a different conversation, in which case these are somebody else's messages`,
  };
}

/** One session's read, as the census reports it. */
function readOf(input: FeedInput, limit: number): FeedSessionRead {
  const r = input.result;
  if (r.kind === "not-found") return { kind: "not-found", reason: r.reason, why: r.why };
  if (r.kind === "unreadable") return { kind: "unreadable", path: r.path, why: r.why };
  return {
    kind: "read",
    turns: r.turns.length,
    /* Complete means *we got this session's newest `limit`*. Either the walk
       reached byte 0 — so there is provably nothing above — or it returned as
       many turns as were asked for. Anything else is the byte budget having
       stopped us early, and the feed must not present that as a quiet agent. */
    complete: r.reachedStartOfFile || r.turns.length >= limit,
    lastModified: r.lastModified,
    bytesRead: r.bytesRead,
    fileBytes: r.fileBytes,
    toolResultsSkipped: r.toolResultsSkipped,
  };
}

/** Epoch ms, or null when the string is absent or not a date. */
function msOf(at: string | null): number | null {
  if (at === null) return null;
  const ms = Date.parse(at);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * The merge. **Pure**: no clock of its own, no filesystem, no socket.
 *
 * `nowMs` is passed in rather than read, so the attribution readings are
 * reproducible in a test.
 */
export function mergeFeed(
  inputs: FeedInput[],
  limit: number,
  nowMs: number,
): {
  messages: FeedMessage[];
  undated: FeedMessage[];
  sessions: FeedSession[];
  mayBeMissing: string[];
} {
  const sessions: FeedSession[] = [];
  /* Carried beside each message only until the sort is done. The oldest dated
     message per session is what decides `mayBeMissing` below. */
  const dated: { message: FeedMessage; ms: number; order: number }[] = [];
  const undated: FeedMessage[] = [];
  const oldestBySession = new Map<string, number>();
  const incomplete: { sessionId: string; name: string }[] = [];

  let order = 0;
  for (const input of inputs) {
    const read = readOf(input, limit);
    sessions.push({ sessionId: input.sessionId, name: input.name, title: input.title, read });
    if (input.result.kind !== "found") continue;
    if (read.kind === "read" && !read.complete) {
      incomplete.push({ sessionId: input.sessionId, name: input.name });
    }
    const attribution = attributionOf(input.working, input.result.lastModified, nowMs);
    for (const turn of input.result.turns) {
      const message: FeedMessage = {
        sessionId: input.sessionId,
        sessionName: input.name,
        sessionTitle: input.title,
        attribution,
        /* **THE ASSIGNMENT THAT KEEPS `FeedSpeaker` HONEST.** `turn.speaker` is
           a `TurnSpeaker`; a speaker added to the reader and not to the wire
           union stops compiling right here. wire.ts § `FeedSpeaker`. */
        speaker: turn.speaker,
        at: turn.at,
        text: turn.text,
        truncated: turn.truncated,
        fullChars: turn.fullChars,
        toolCalls: turn.toolCalls,
        uuid: turn.uuid,
      };
      const ms = msOf(turn.at);
      if (ms === null) {
        undated.push(message);
        continue;
      }
      dated.push({ message, ms, order: order++ });
      const seen = oldestBySession.get(input.sessionId);
      if (seen === undefined || ms < seen) oldestBySession.set(input.sessionId, ms);
    }
  }

  /* Newest first — the inversion the sibling route does not do, done once here
     rather than in every client. `order` breaks ties so that two messages
     written in the same millisecond keep a stable position across refreshes;
     an unstable sort here would reshuffle the list under the reader's thumb. */
  dated.sort((a, b) => (b.ms - a.ms !== 0 ? b.ms - a.ms : a.order - b.order));
  const kept = dated.slice(0, limit);
  const messages = kept.map((d) => d.message);

  /* **THE CUTOFF, AND WHY IT IS NOT SIMPLY "EVERY INCOMPLETE SESSION".**
     A session cut short by the byte budget only costs this feed something if it
     might have had messages INSIDE the window being shown. If its oldest
     returned message is already older than the oldest message on screen, then
     everything of its that belongs in this window was read, and naming it would
     be noise — and a warning that is usually wrong is one nobody reads.

     `null` means nothing was trimmed, so the window reaches back as far as we
     read and any incompleteness at all is inside it. */
  const trimmed = dated.length > limit;
  const cutoffMs = trimmed ? (kept[kept.length - 1]?.ms ?? null) : null;
  const mayBeMissing = incomplete
    .filter(({ sessionId }) => {
      if (cutoffMs === null) return true;
      const oldest = oldestBySession.get(sessionId);
      /* No dated message at all from a session we know was cut short: we cannot
         place it relative to the cutoff, so we say so rather than assume it
         falls outside. */
      if (oldest === undefined) return true;
      return oldest > cutoffMs;
    })
    .map(({ name }) => name);

  return { messages, undated: undated.slice(0, limit), sessions, mayBeMissing };
}

export type FeedRouteDeps = {
  /**
   * The current snapshot, as a FUNCTION rather than a value: it is replaced
   * wholesale by each collection, and a route holding the one it was built with
   * would serve the fleet as it was at startup for ever.
   */
  snapshot(): FleetSnapshot | null;
  /** The server's clock, so the attribution readings are stamped by the process that read the files. */
  nowMs(): number;
  /** Injected so a test can drive the whole payload without a filesystem. */
  read?: (row: FleetRow, limit: number) => Promise<RecentMessages>;
};

/** The real reader, and the only place this module names the transcript store. */
function readRow(row: FleetRow, limit: number): Promise<RecentMessages> {
  return readRecentMessages({
    claudeSessionId: row.claudeSessionId,
    dir: row.meta.version === 1 ? row.meta.dir : null,
    limit,
  });
}

/**
 * Build the payload. Async because it reads, but otherwise the same shape as
 * `historyPayload`: everything interesting is in `mergeFeed`, which is pure.
 */
export async function feedPayload(deps: FeedRouteDeps, limit: number): Promise<FeedPayload> {
  const snapshot = deps.snapshot();
  if (snapshot === null) {
    return {
      schema: 1,
      kind: "unreadable",
      why: "this dashboard has not finished its first collection, so it does not yet know which sessions exist. That is not the same as the box being quiet.",
    };
  }
  const read = deps.read ?? readRow;
  const nowMs = deps.nowMs();
  /* All at once. Measured at 250 ms and ~10 MB of page cache for 21 rows at
     limit 50, on a box whose transcripts total 65 MB — the byte-bounded reader
     is what makes that safe, not restraint here. **This is not on the collection
     loop** and must never be moved onto it: docs/project/overseer-direction.md
     and the responsive-collection stage of the roadmap both say the collector
     may not be held by a slow reader. */
  const inputs: FeedInput[] = await Promise.all(
    snapshot.rows.map(async (row) => ({
      sessionId: row.id,
      name: row.name,
      title: row.title,
      working: row.status.kind === "working",
      result: await read(row, limit),
    })),
  );
  const merged = mergeFeed(inputs, limit, nowMs);
  return {
    schema: 1,
    kind: "feed",
    limit,
    messages: merged.messages,
    undated: merged.undated,
    sessions: merged.sessions,
    mayBeMissing: merged.mayBeMissing,
    collectedAt: snapshot.collectedAt,
    servedAt: new Date(nowMs).toISOString(),
  };
}

/**
 * Mount it. Returns false when the request is not this route's, the same shape
 * as `healthHistoryRoute().handle` — so `server.ts` keeps holding nothing but
 * wiring.
 */
export function recentFeedRoute(deps: FeedRouteDeps): {
  handle(req: IncomingMessage, res: ServerResponse): boolean;
} {
  return {
    handle(req, res): boolean {
      const url = req.url ?? "/";
      if (!url.startsWith(FEED_PATH)) return false;
      /* An exact path, so the `startsWith` that mounts it cannot quietly widen
         into `/api/feed/../something`. Same rule the health-history and
         new-session routes state. */
      const path = url.split("?")[0] ?? "";
      if (path !== FEED_PATH) {
        res.writeHead(404, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify({ schema: 1, kind: "unreadable", why: `no such route: ${path}` }));
        return true;
      }

      void feedPayload(deps, limitFrom(url))
        .then((payload) => {
          const body = JSON.stringify(payload);
          const accepts = String(req.headers["accept-encoding"] ?? "").includes("gzip");
          if (accepts && body.length > GZIP_ABOVE_BYTES) {
            const packed = gzipSync(body);
            res.writeHead(200, {
              "content-type": "application/json",
              "content-encoding": "gzip",
              "cache-control": "no-store",
              /* Anything that caches by URL must know the answer varies by header. */
              vary: "accept-encoding",
              "content-length": String(packed.length),
            });
            res.end(packed);
            return;
          }
          res.writeHead(200, {
            "content-type": "application/json",
            "cache-control": "no-store",
            vary: "accept-encoding",
          });
          res.end(body);
        })
        /* `readRecentMessages` is built not to reject — every failure of it is
           a `kind` — so this is for the case where that is itself wrong.
           Without it the request hangs until the phone gives up, which is
           indistinguishable from the box being down. */
        .catch((err: unknown) => {
          res.writeHead(500, { "content-type": "application/json", "cache-control": "no-store" });
          res.end(
            JSON.stringify({
              schema: 1,
              kind: "unreadable",
              why: `building the feed threw: ${err instanceof Error ? err.message : String(err)}`,
            }),
          );
        });
      return true;
    },
  };
}
