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
import { readRecentMessages, type RecentMessages, type TranscriptTurn } from "./transcript.js";
import type {
  FeedAttribution,
  FeedCoverage,
  FeedCoverageReason,
  FeedMessage,
  FeedPayload,
  FeedSession,
  FeedSessionRead,
} from "./wire.js";

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
  /**
   * The conversation uuid this row claims. **Carried so two rows naming the
   * same one can be spotted** — that would count one conversation's turns
   * twice, which breaks "each message belongs to exactly one session" and with
   * it the exactness of the merge.
   */
  claudeSessionId: string | null;
  result: RecentMessages;
};

/**
 * **THE GUARD TURN, AND WHY EVERY SESSION IS ASKED FOR ONE MORE THAN IT NEEDS.**
 *
 * One API turn is written as up to four JSONL records sharing a `message.id` —
 * 1497 of 2806 ids in the measured transcript appeared on more than one line —
 * and `recordsToTurns` coalesces them. So when the byte budget stops the walk
 * *inside* a shared id, the oldest turn it returns is built from only the
 * records that happened to fall above the boundary: a real-looking turn with
 * some of its text and some of its tool calls missing.
 *
 * That is invisible to a count. Asking for N and receiving N would say
 * "complete" while the oldest of those N is a fragment. **So every session is
 * asked for N+1 and the oldest is discarded whenever the walk did not reach the
 * start of the file.** The turn below a discarded one is whole by construction:
 * its records are contiguous and the boundary is below them.
 *
 * GPT Sol's P1 on the plan. The cost is one extra turn per session and no
 * second parser.
 */
export const GUARD_TURNS = 1;

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

/**
 * The turns this session actually contributes, with the guard turn dropped.
 *
 * See `GUARD_TURNS`. When the walk reached the start of the file nothing was
 * cut, so the oldest turn is whole and all of them are kept.
 */
export function contributedTurns(r: Extract<RecentMessages, { kind: "found" }>): TranscriptTurn[] {
  if (r.reachedStartOfFile || r.turns.length === 0) return r.turns;
  return r.turns.slice(1);
}

/** One session's read, as the census reports it. `turns` is post-guard. */
function readOf(input: FeedInput, limit: number): FeedSessionRead {
  const r = input.result;
  if (r.kind === "not-found") return { kind: "not-found", reason: r.reason, why: r.why };
  if (r.kind === "unreadable") return { kind: "unreadable", path: r.path, why: r.why };
  const turns = contributedTurns(r);
  return {
    kind: "read",
    turns: turns.length,
    /* Complete means *we got this session's newest `limit`, and the oldest of
       them is whole*. Either the walk reached byte 0 — so there is provably
       nothing above — or, after discarding the guard turn, it still has as many
       as were asked for. Anything else is the byte budget having stopped us
       early, and the feed must not present that as a quiet agent. */
    complete: r.reachedStartOfFile || turns.length >= limit,
    lastModified: r.lastModified,
    bytesRead: r.bytesRead,
    fileBytes: r.fileBytes,
    toolResultsSkipped: r.toolResultsSkipped,
    copies: r.copies,
    recordsUnparseable: r.recordsUnparseable,
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
  coverage: FeedCoverage;
} {
  const sessions: FeedSession[] = [];
  /* Carried beside each message only until the sort is done. The oldest dated
     message per session is what decides whether a truncation matters. */
  const dated: { message: FeedMessage; ms: number; order: number }[] = [];
  const undated: FeedMessage[] = [];
  const oldestBySession = new Map<string, number>();
  const incomplete: { sessionId: string; name: string }[] = [];
  const reasons: FeedCoverageReason[] = [];

  /* **TWO ROWS NAMING ONE CONVERSATION.** That breaks "each message belongs to
     exactly one session", so the same turns would be counted twice and the
     newest N would be padded with duplicates. Detected rather than
     de-duplicated: which of the two rows is the real one is not this module's
     to decide, and guessing would hide the fact that something is wrong. */
  const byConversation = new Map<string, string[]>();
  for (const input of inputs) {
    if (input.claudeSessionId === null || input.claudeSessionId === "") continue;
    const seen = byConversation.get(input.claudeSessionId) ?? [];
    seen.push(input.sessionId);
    byConversation.set(input.claudeSessionId, seen);
  }
  for (const [conversation, ids] of byConversation) {
    if (ids.length < 2) continue;
    for (const sessionId of ids) {
      reasons.push({
        sessionId,
        name: inputs.find((i) => i.sessionId === sessionId)?.name ?? sessionId,
        kind: "duplicate-conversation",
        why: `${ids.length} sessions claim the same conversation (${conversation}), so its messages appear more than once and at most one of these rows can be right`,
      });
    }
  }

  let order = 0;
  for (const input of inputs) {
    const read = readOf(input, limit);
    sessions.push({ sessionId: input.sessionId, name: input.name, title: input.title, read });

    if (read.kind === "unreadable") {
      /* **A SESSION WE COULD NOT READ MAY HOLD ALL OF THE NEWEST MESSAGES.**
         Showing it as one more row in the census does nothing to stop the list
         above looking authoritative, which is why this is coverage rather than
         an advisory line. GPT Sol's P1. */
      reasons.push({ sessionId: input.sessionId, name: input.name, kind: "unreadable", why: read.why });
    }
    if (read.kind === "not-found" && read.reason !== "no-claude-session-id") {
      /* `no-claude-session-id` is deliberately NOT a coverage failure: it is a
         shell or a scheduled session whose pane is still running `sleep`, and
         nine of 21 rows on this box are that. Counting them would make coverage
         permanently indeterminate, and a warning that is always on is one
         nobody reads. Every other reason means a conversation was claimed and
         its transcript could not be found, which really is a hole. */
      reasons.push({ sessionId: input.sessionId, name: input.name, kind: "no-transcript", why: read.why });
    }

    if (input.result.kind !== "found") continue;
    if (read.kind === "read" && !read.complete) {
      incomplete.push({ sessionId: input.sessionId, name: input.name });
    }
    const attribution = attributionOf(input.working, input.result.lastModified, nowMs);
    /* **AN INVERSION MEANS "NEWEST" IS NOT A TOTAL ORDER HERE.** Zero were
       observed in 955 sampled turns, but a wall-clock adjustment on the box
       would produce one, and the global sort would then place this session's
       messages wrongly against every other session's. */
    let previousMs: number | null = null;
    let inverted = false;
    let hasUndated = false;
    for (const turn of contributedTurns(input.result)) {
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
        hasUndated = true;
        continue;
      }
      if (previousMs !== null && ms < previousMs) inverted = true;
      previousMs = ms;
      dated.push({ message, ms, order: order++ });
      const seen = oldestBySession.get(input.sessionId);
      if (seen === undefined || ms < seen) oldestBySession.set(input.sessionId, ms);
    }

    if (inverted) {
      reasons.push({
        sessionId: input.sessionId,
        name: input.name,
        kind: "out-of-order",
        why: "this session's own timestamps go backwards, so its messages cannot be ordered against the other sessions' reliably",
      });
    }
    if (hasUndated) {
      /* **AN UNDATED TURN COSTS MORE THAN ITS OWN PLACE.** It was fetched
         inside this session's newest N, so it displaced a dated turn that was
         never fetched at all — and that turn may have belonged in the window.
         Showing the undated ones in a group below is therefore not enough to
         keep the dated list exact. GPT Sol's P2. */
      reasons.push({
        sessionId: input.sessionId,
        name: input.name,
        kind: "undated",
        why: "some of this session's newest turns carry no timestamp, so they cannot be placed in the ordering and an older dated turn of its own may be missing from the window",
      });
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
  for (const { sessionId, name } of incomplete) {
    const oldest = oldestBySession.get(sessionId);
    /* No dated message at all from a session we know was cut short: we cannot
       place it relative to the cutoff, so we say so rather than assume it falls
       outside. */
    const insideWindow = cutoffMs === null || oldest === undefined || oldest > cutoffMs;
    if (!insideWindow) continue;
    reasons.push({
      sessionId,
      name,
      kind: "byte-budget",
      why: "this session's transcript was cut short by the read budget before its newest messages were all reached, so it may have said more inside this window than is shown",
    });
  }

  /* **`complete` IS CONSTRUCTIBLE ONLY WHEN NOTHING ABOVE FIRED.** Every reason
     breaks one of the four premises the exactness proof rests on, so the answer
     to "is this the last N messages" is yes exactly when there are none. */
  const coverage: FeedCoverage = reasons.length === 0 ? { kind: "complete" } : { kind: "indeterminate", reasons };

  return { messages, undated: undated.slice(0, limit), sessions, coverage };
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
  const readStartedAt = new Date(nowMs).toISOString();
  /* All at once. Measured at 250 ms and ~10 MB of page cache for 21 rows at
     limit 50, on a box whose transcripts total 65 MB — the byte-bounded reader
     is what makes that safe, not restraint here. **This is not on the collection
     loop** and must never be moved onto it: docs/project/overseer-direction.md
     and the responsive-collection stage of the roadmap both say the collector
     may not be held by a slow reader.

     `limit + GUARD_TURNS`, never bare `limit` — see `GUARD_TURNS`. */
  const inputs: FeedInput[] = await Promise.all(
    snapshot.rows.map(async (row) => ({
      sessionId: row.id,
      name: row.name,
      title: row.title,
      working: row.status.kind === "working",
      claudeSessionId: row.claudeSessionId,
      result: await read(row, limit + GUARD_TURNS),
    })),
  );
  const merged = mergeFeed(inputs, limit, nowMs);
  const readFinishedAt = new Date(deps.nowMs()).toISOString();
  return {
    schema: 1,
    kind: "feed",
    limit,
    messages: merged.messages,
    undated: merged.undated,
    sessions: merged.sessions,
    coverage: merged.coverage,
    /* The census boundary rather than one instant — see `FeedPayload`. The
       snapshot was collected up to a minute ago and the files were read over
       the window below; there is no moment at which this describes the fleet. */
    collectedAt: snapshot.collectedAt,
    readStartedAt,
    readFinishedAt,
    servedAt: readFinishedAt,
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
