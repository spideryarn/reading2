/**
 * `GET /api/recovery` — the work a reboot or a tmux restart interrupted, as the
 * Overseer recorded it.
 *
 * A route module rather than lines in `server.ts`, for the reason
 * `routes-decisions.ts` gives: importing `server.ts` binds port 8787, so
 * anything living there cannot be driven by a test. `makeRecoveryRoute` is the
 * production composition that both `server.ts` and the route suite drive.
 *
 * ## READ-ONLY, AND THERE IS NO WRITE PATH OF ANY KIND
 *
 * This dashboard has no authentication; reachability is the whole boundary. A
 * dismissal is an operator's decision in Greg's name, and it goes through
 * `scripts/overseer-recovery.ts` into the daemon's inbox, where the daemon, the
 * single writer, checks it. Nothing here starts, resumes or dismisses anything
 * (plan 260910e § "What this deliberately does not do"). Action routes belong to
 * `action-receipts`.
 *
 * ## Asynchronous
 *
 * `handle` answers `true` at once and does its reading on a promise, so a slow
 * disk holds one request, not the server. The promise never rejects: every
 * failure is answered, 500 with the reason.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import { loadRecoveryFile, projectRecovery, type RecoveryFileLoad } from "./recovery-feed.js";
import type { RecoveryFeed } from "./wire.js";

export const RECOVERY_PATH = "/api/recovery";

export type RecoveryRouteReaders = {
  /** Injected so a test never touches `~/.overseer/`. The real one resolves the store at call time. */
  load(): Promise<RecoveryFileLoad>;
  /** The server's clock owns `composedAt`. */
  now(): Date;
};

function realReaders(): RecoveryRouteReaders {
  return { load: () => loadRecoveryFile(), now: () => new Date() };
}

const HEADERS = { "content-type": "application/json", "cache-control": "no-store" } as const;

function unreadable(why: string, composedAt: string): RecoveryFeed {
  return { schema: 1, kind: "unreadable", composedAt, why };
}

async function respond(readers: RecoveryRouteReaders, req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: string;
  try {
    const composedAt = readers.now().toISOString();
    body = JSON.stringify(projectRecovery(await readers.load(), composedAt));
  } catch (cause) {
    let composedAt: string;
    try {
      composedAt = readers.now().toISOString();
    } catch {
      composedAt = new Date().toISOString();
    }
    res.writeHead(500, HEADERS);
    res.end(JSON.stringify(unreadable(`building the recovery answer threw: ${cause instanceof Error ? cause.message : String(cause)}`, composedAt)));
    return;
  }
  res.writeHead(200, HEADERS);
  res.end(req.method === "HEAD" ? undefined : body);
}

/** The exact production composition. Tests inject only its leaf readers. */
export function makeRecoveryRoute(readers: RecoveryRouteReaders = realReaders()): {
  handle(req: IncomingMessage, res: ServerResponse): boolean;
} {
  return {
    handle(req, res): boolean {
      const url = req.url ?? "/";
      if (!url.startsWith(RECOVERY_PATH)) return false;
      const bare = url.split("?")[0] ?? "";
      if (bare !== RECOVERY_PATH) {
        res.writeHead(404, HEADERS);
        res.end(JSON.stringify(unreadable(`no such route: ${bare}`, readers.now().toISOString())));
        return true;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { ...HEADERS, allow: "GET, HEAD" });
        res.end(
          JSON.stringify(
            unreadable(
              "this route is read-only on purpose: nothing on this page starts, resumes or dismisses interrupted work, and this server has no authentication. Dismissals go through the recovery CLI.",
              readers.now().toISOString(),
            ),
          ),
        );
        return true;
      }
      void respond(readers, req, res);
      return true;
    },
  };
}
