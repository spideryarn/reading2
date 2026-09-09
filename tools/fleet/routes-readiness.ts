/**
 * `GET /api/readiness` — whether dev is green, and the day behind that answer.
 *
 * A route module rather than lines in `server.ts`, for the same reason
 * `routes-health-history.ts` is one: importing `server.ts` binds port 8787, so
 * anything living there cannot be driven by a test. This handler takes a
 * snapshot source and an `IncomingMessage`, and a test can hand it both.
 *
 * ## It serves a snapshot. It computes nothing.
 *
 * Everything expensive — git, the directory scan, `tmux ls` — happens on the
 * refresh loop (`readiness-wiring.ts`), and this hands over whatever that last
 * produced. A handler that computed its own answer would `spawnSync` git inside
 * the request path of a single-threaded server, which on a box that has reached
 * load average 391 means the diagnostic page stops responding exactly when
 * somebody is trying to find out why.
 *
 * The consequence is that the answer is **up to one refresh old**, and
 * `collectedAt` says so rather than leaving the page to assume. Same contract as
 * the health payload.
 *
 * ## Two arms, because "nothing recorded" is not "we could not look"
 *
 * `{ kind: "readiness", … }` carries an answer, possibly an `unknown` one with
 * its reason. `{ kind: "unavailable", why }` says the snapshot itself does not
 * exist yet — the server has not completed a refresh. Drawn as the same empty
 * page those become one claim, and it would be the wrong one.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { gzipSync } from "node:zlib";

import type { ReadinessSnapshot } from "./readiness-wiring.js";

export const READINESS_PATH = "/api/readiness";

/** Compress anything above this. Below it the header costs more than it saves. */
const GZIP_ABOVE_BYTES = 8 * 1024;

/**
 * What the browser gets.
 *
 * **This type crosses the server/browser boundary**, so it lives beside the
 * shape it describes until `wire.ts` claims it, and moves there mechanically.
 */
export type ReadinessPayload =
  | ({ schema: 1; kind: "readiness"; windowHours: number; refreshMs: number } & ReadinessSnapshot)
  | { schema: 1; kind: "unavailable"; why: string };

export type ReadinessRouteDeps = {
  /** The last snapshot the refresh loop produced, or null before the first one. */
  snapshot(): ReadinessSnapshot | null;
  windowHours: number;
  refreshMs: number;
};

export function readinessPayload(deps: ReadinessRouteDeps): ReadinessPayload {
  const snapshot = deps.snapshot();
  if (snapshot === null) {
    return {
      schema: 1,
      kind: "unavailable",
      why:
        "this dashboard has not finished a readiness collection yet — nothing has been looked at, " +
        "which is not the same as nothing having been recorded",
    };
  }
  return {
    schema: 1,
    kind: "readiness",
    windowHours: deps.windowHours,
    refreshMs: deps.refreshMs,
    ...snapshot,
  };
}

/**
 * Mount it. Returns false for a request that is not its own, the same shape as
 * `healthHistoryRoute().handle` — so `server.ts` keeps holding nothing but
 * wiring.
 */
export function readinessRoute(deps: ReadinessRouteDeps): {
  handle(req: IncomingMessage, res: ServerResponse): boolean;
} {
  return {
    handle(req, res): boolean {
      const url = req.url ?? "/";
      if (!url.startsWith(READINESS_PATH)) return false;
      /* An exact path, so the `startsWith` that mounts it cannot quietly widen
         into `/api/readiness/../something`. The same rule the other routes state. */
      const path = url.split("?")[0] ?? "";
      if (path !== READINESS_PATH) {
        res.writeHead(404, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify({ schema: 1, kind: "unavailable", why: `no such route: ${path}` }));
        return true;
      }

      let body: string;
      try {
        body = JSON.stringify(readinessPayload(deps));
      } catch (err) {
        /* The snapshot is built not to throw — every failure of it is an arm —
           so this is for the case where that is itself wrong. A hung request is
           indistinguishable from a dead box on a phone. */
        res.writeHead(500, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(
          JSON.stringify({
            schema: 1,
            kind: "unavailable",
            why: `building the readiness answer threw: ${err instanceof Error ? err.message : String(err)}`,
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
          /* Anything caching by URL must know the answer varies by header. */
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
