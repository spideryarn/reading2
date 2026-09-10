/**
 * `GET /api/diagnostics` — what the dashboard can say about itself and the
 * Overseer's store without the Overseer's code (docs/plans/260910f § D5, as
 * amended by Sol's F2). The Box health tab's diagnostics section draws it, and
 * `overseer diagnose` reads it for the dashboard's line.
 *
 * A route module rather than lines in `server.ts`, for `routes-recovery.ts`'s
 * reason: importing `server.ts` binds a port. `makeDiagnosticsRoute` is the
 * composition both `server.ts` and tests/fleet-diagnostics-route.test.ts drive.
 *
 * ## What it carries, and what it will not claim
 *
 *  - **Three bundle facts, kept apart** (D3): the dashboard's start stamp and
 *    the bundle stamp it saw on disk, both captured ONCE before the listeners
 *    opened and handed in as values; and the bundle stamp on disk NOW, read per
 *    request because a rebuild replaces it under a running server. The fourth
 *    fact — the bundle a tab is running — is compiled into the tab.
 *  - **Clocks as instants or `never`-with-a-reason**, never a null the page has
 *    to interpret.
 *  - **The store directory with its label** — `~/.overseer` or
 *    `OVERSEER_STORE_DIR=<path>` — and a relative override as `unknown`, which
 *    is the store's own refusal (`attention.ts` § `storeRoot`).
 *  - **The daemon's start stamp** through the fleet's own tolerant reader
 *    (`daemon-start.ts`), correlated to the checkpoint's instance.
 *  - **Not** whether the daemon holds this checkout's job list: that needs the
 *    Overseer's code, and the page names `overseer diagnose` instead.
 *
 * ## Read-only
 *
 * This dashboard has no authentication. Nothing here writes, and every read is
 * bounded by `store-probe.ts`'s contract (allow-listed names, no symlinks, a
 * byte ceiling). Synchronous: fifteen `lstat`s and two bounded reads.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";

import { storeRoot } from "./attention.js";
import { checkpointInstance, readDaemonStart } from "./daemon-start.js";
import { readCheckpointFeeds } from "./overseer-status.js";
import { STORE_PROBE_FILES, probeStoreFiles } from "./store-probe.js";
import type { BuildStampReading, DiagnosticsInstant, DiagnosticsStorePath, DiagnosticsSummary, StartRevision } from "./wire.js";

export const DIAGNOSTICS_PATH = "/api/diagnostics";

/** The collection loop's clocks, as `server.ts` holds them. */
export type CollectorClocks = { attemptedAt: string | null; collectedAt: string | null; lastError: string | null };

export type DiagnosticsReaders = {
  now(): Date;
  /** This server run's instance id. */
  instance: string;
  /** Captured once at startup — a value, not a reader, so it cannot be re-read lazily. */
  start: StartRevision;
  /** The bundle stamp on disk when this server started, captured once before the listeners opened. */
  bundleAtStart: BuildStampReading;
  /** The bundle stamp on disk now. Read per request. */
  bundleOnDisk(): BuildStampReading;
  collector(): CollectorClocks;
  /** When the box-health reading being served was taken, or null before the first. */
  healthCollectedAt(): string | null;
  /** Read for `OVERSEER_STORE_DIR` per request, so a test names a scratch store. */
  env: NodeJS.ProcessEnv;
};

const HEADERS = { "content-type": "application/json", "cache-control": "no-store" } as const;

/** Which store directory this dashboard reads, labelled the way a person would type it. */
export function storePathOf(env: NodeJS.ProcessEnv): DiagnosticsStorePath {
  const given = env["OVERSEER_STORE_DIR"];
  if (given === undefined || given.trim() === "") return { kind: "default", label: "~/.overseer", path: join(homedir(), ".overseer") };
  try {
    const path = storeRoot(env);
    return { kind: "override", label: `OVERSEER_STORE_DIR=${path}`, path };
  } catch (cause) {
    return { kind: "unknown", why: cause instanceof Error ? cause.message : String(cause) };
  }
}

const instant = (at: string | null, why: string): DiagnosticsInstant => (at === null ? { kind: "never", why } : { kind: "at", at });

export function composeDiagnostics(readers: DiagnosticsReaders): DiagnosticsSummary {
  const now = readers.now();
  const composedAt = now.toISOString();
  const clocks = readers.collector();
  const path = storePathOf(readers.env);
  const noStore = path.kind === "unknown" ? `there is no store directory to read: ${path.why}` : null;
  const store: Pick<DiagnosticsSummary, "store" | "daemon"> =
    path.kind === "unknown"
      ? { store: { path, files: { kind: "unknown", why: noStore ?? path.why } }, daemon: { kind: "unknown", why: noStore ?? path.why } }
      : {
          store: { path, files: { kind: "probed", files: probeStoreFiles(path.path, STORE_PROBE_FILES, now) } },
          daemon: readDaemonStart(path.path, checkpointInstance(readCheckpointFeeds(path.path, composedAt).overseer)),
        };
  return {
    schema: 1,
    composedAt,
    dashboard: {
      instance: readers.instance,
      start: readers.start,
      bundleAtStart: readers.bundleAtStart,
      bundleOnDisk: readers.bundleOnDisk(),
    },
    collector: {
      attempted: instant(clocks.attemptedAt, "this server has not started a collection yet"),
      collected: instant(clocks.collectedAt, "no collection has succeeded since this server started"),
      lastError: clocks.lastError === null ? { kind: "none" } : { kind: "error", message: clocks.lastError },
    },
    health: instant(readers.healthCollectedAt(), "no box-health reading has been taken since this server started"),
    ...store,
  };
}

/** The body of every non-200 answer. The client's parser reads its `why`. */
function failure(why: string): string {
  return JSON.stringify({ schema: 1, kind: "error", why });
}

/** The exact production composition. Tests inject only its leaf readers. */
export function makeDiagnosticsRoute(readers: DiagnosticsReaders): { handle(req: IncomingMessage, res: ServerResponse): boolean } {
  return {
    handle(req, res): boolean {
      const url = req.url ?? "/";
      if (!url.startsWith(DIAGNOSTICS_PATH)) return false;
      const bare = url.split("?")[0] ?? "";
      if (bare !== DIAGNOSTICS_PATH) {
        res.writeHead(404, HEADERS);
        res.end(failure(`no such route: ${bare}`));
        return true;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { ...HEADERS, allow: "GET, HEAD" });
        res.end(failure("this route is read-only: it reports, and nothing on it changes anything"));
        return true;
      }
      let body: string;
      try {
        body = JSON.stringify(composeDiagnostics(readers));
      } catch (cause) {
        res.writeHead(500, HEADERS);
        res.end(failure(`composing the diagnostics threw: ${cause instanceof Error ? cause.message : String(cause)}`));
        return true;
      }
      res.writeHead(200, HEADERS);
      res.end(req.method === "HEAD" ? undefined : body);
      return true;
    },
  };
}
