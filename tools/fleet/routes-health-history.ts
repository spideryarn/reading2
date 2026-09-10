/**
 * `GET /api/health/history` — the last N hours of box health, for the chart.
 *
 * A route module rather than lines in `server.ts`, for the same reason
 * `refresh.ts` is a module: importing `server.ts` binds port 8787, so anything
 * that lives there cannot be driven by a test. This handler takes a store and
 * an `IncomingMessage`, and a test can hand it both.
 *
 * ## Two arms on the wire, because an empty array is not a failure
 *
 * `{ kind: "history", samples: [] }` says *we looked and there is nothing in
 * that window*. `{ kind: "unreadable", why }` says *we could not look*. Drawn
 * as the same blank chart those become one claim — "the box was down all day" —
 * which is the specific lie this whole feature exists not to tell. The
 * distinction is the store's (`HistoryRead`) and this route's job is to carry
 * it, not to simplify it.
 *
 * ## Gzip, and what was rejected instead
 *
 * ~1,200 samples × ~870 bytes is about a megabyte, read on a phone over
 * Tailscale. `zlib` is a node builtin and this is a handful of lines behind an
 * `accept-encoding` check.
 *
 * **The alternative — averaging into buckets server-side — is refused
 * outright.** A bucket mean is exactly the mechanism that hides the five-minute
 * spike this chart exists to show, and it would hide it in the producer, where
 * nothing downstream could ever recover it. Compression loses nothing.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { gzipSync } from "node:zlib";

import { WORK_EVERY_MS, type HealthHistory, type HealthSample, type RetentionStatus } from "./health-history.js";

export const HISTORY_PATH = "/api/health/history";

/** The default window, and the one Greg asked for. */
export const DEFAULT_WINDOW_HOURS = 24;

/**
 * The widest window the route will serve.
 *
 * Not a security limit — this server has no untrusted caller — but a limit on
 * how much of a possibly-large file gets serialised into one response because
 * somebody typed a number into a URL.
 */
export const MAX_WINDOW_HOURS = 168;

/** Compress anything above this. Below it the header costs more than it saves. */
const GZIP_ABOVE_BYTES = 8 * 1024;

/**
 * What the browser gets.
 *
 * **This type crosses the server/browser boundary.** `tools/fleet/wire.ts` is
 * landing as the one leaf module for every such type; until it does, this lives
 * beside the shape it describes and moves there mechanically.
 */
export type HistoryPayload =
  | {
      schema: 1;
      kind: "history";
      /** What was asked for, after clamping — so the page can say if it got less. */
      windowHours: number;
      /** The window's edges, epoch ms, by the SERVER's clock. See `nowMs` below. */
      fromMs: number;
      toMs: number;
      /** Oldest first. */
      samples: HealthSample[];
      /** The last sample before the window, so the page can classify its left edge. */
      predecessor: HealthSample | null;
      /** Where unparseable lines were, so a renderer breaks rather than reconnects. */
      holes: { afterAt: string | null; beforeAt: string | null }[];
      /**
       * The oldest sample the store holds at all, window or not. Null when the
       * store is empty. **This is what lets the page draw "nothing was recorded
       * before this" differently from "the record has a hole in it".**
       */
      earliestAt: string | null;
      /** True when a rotation means `earliestAt` is the oldest RETAINED sample, not the first ever. */
      rotated: boolean;
      /** How the writer itself is doing — see `RetentionStatus` in health-history.ts. */
      retention: RetentionStatus;
      /** Lines in the store that would not parse. Counted, never hidden. */
      unreadableLines: number;
      /**
       * How often the dashboard intends to collect. The page needs it to say
       * whether the RIGHT-HAND EDGE is overdue — the gap that is happening now,
       * which no sample can record because it is the one that has not arrived.
       */
      refreshMs: number;
      /** Persistence cadence for work readings; the browser must not restate five minutes. */
      workEveryMs: number;
    }
  | { schema: 1; kind: "unreadable"; why: string };

export type HistoryRouteDeps = {
  store: HealthHistory | null;
  refreshMs: number;
  /**
   * The server's clock, so the window's edges are stamped by the same process
   * that stamped the samples. A browser computing "24h ago" from its OWN clock
   * would draw a phone in the wrong timezone, or with a drifted clock, as a
   * chart that is missing its most recent hours — absence caused by arithmetic,
   * which is indistinguishable on screen from absence caused by an outage.
   */
  nowMs(): number;
};

/**
 * How many hours the caller asked for, clamped, never NaN.
 *
 * Pure and exported so the clamp is testable without a socket. A missing or
 * unparseable `hours` is the default rather than an error: this is a chart, and
 * refusing to draw because a query string was odd helps nobody.
 */
export function windowHoursFrom(url: string): number {
  const value = new URL(url, "http://fleet.invalid").searchParams.get("hours");
  if (value === null) return DEFAULT_WINDOW_HOURS;
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours <= 0) return DEFAULT_WINDOW_HOURS;
  return Math.min(hours, MAX_WINDOW_HOURS);
}

/**
 * Build the payload. **Pure given a store** — no request, no response, no
 * clock of its own — so the interesting half of this route is testable directly.
 */
export function historyPayload(deps: HistoryRouteDeps, windowHours: number): HistoryPayload {
  if (deps.store === null) {
    return {
      schema: 1,
      kind: "unreadable",
      why:
        "this dashboard is not retaining box health — the store would not open at startup, and the " +
        "reason is in the server's log. Nothing has been recorded, which is not the same as the box " +
        "having been quiet.",
    };
  }
  const toMs = deps.nowMs();
  const fromMs = toMs - windowHours * 60 * 60 * 1000;
  const read = deps.store.read({ sinceMs: fromMs });
  if (read.kind === "unreadable") {
    return { schema: 1, kind: "unreadable", why: read.why };
  }
  return {
    schema: 1,
    kind: "history",
    windowHours,
    fromMs,
    toMs,
    samples: read.samples,
    predecessor: read.predecessor,
    /* ISO on the wire, like every other timestamp here, rather than the epoch
       ms the store works in — one format on this API, and the client parses. */
    holes: read.holes.map((hole) => ({
      afterAt: hole.afterAtMs === null ? null : new Date(hole.afterAtMs).toISOString(),
      beforeAt: hole.beforeAtMs === null ? null : new Date(hole.beforeAtMs).toISOString(),
    })),
    earliestAt: read.earliestAt,
    rotated: read.rotated,
    /* THE WRITER'S OWN CONDITION, carried whether or not it is bad. A page that
       only heard about retention when it broke would have no way to say "and it
       is fine" — and a chart quietly missing its newest hour, with no
       explanation available, is a manufactured outage. GPT Sol's finding 3. */
    retention: deps.store.status(),
    unreadableLines: read.unreadableLines,
    refreshMs: deps.refreshMs,
    workEveryMs: WORK_EVERY_MS,
  };
}

/**
 * Mount it. Returns false when the request is not this route's, the same shape
 * as `renameRoute().handle` — so `server.ts` keeps holding nothing but wiring.
 */
export function healthHistoryRoute(deps: HistoryRouteDeps): {
  handle(req: IncomingMessage, res: ServerResponse): boolean;
} {
  return {
    handle(req, res): boolean {
      const url = req.url ?? "/";
      if (!url.startsWith(HISTORY_PATH)) return false;
      /* An exact path, so the `startsWith` that mounts it cannot quietly widen
         into `/api/health/history/../something`. Same rule the new-session route
         states. */
      const path = url.split("?")[0] ?? "";
      if (path !== HISTORY_PATH) {
        res.writeHead(404, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify({ schema: 1, kind: "unreadable", why: `no such route: ${path}` }));
        return true;
      }

      let body: string;
      try {
        body = JSON.stringify(historyPayload(deps, windowHoursFrom(url)));
      } catch (err) {
        /* The store is built not to throw — every failure of it is an arm — so
           this is for the case where that is itself wrong. A hung request is
           indistinguishable from a dead box on a phone. */
        res.writeHead(500, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(
          JSON.stringify({
            schema: 1,
            kind: "unreadable",
            why: `building the history answer threw: ${err instanceof Error ? err.message : String(err)}`,
          }),
        );
        return true;
      }

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
        return true;
      }
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", vary: "accept-encoding" });
      res.end(body);
      return true;
    },
  };
}
