/**
 * `GET /api/usage/history?hours=N` — the last N hours of usage readings.
 *
 * Mirrors `routes-health-history.ts` almost exactly, and the one place it does
 * not is the point of this file.
 *
 * ## Recorder health is DERIVED here, not carried
 *
 * Health's route serves `store.status()` — `lastAttemptAt`, `failure`,
 * `poisoned` — because its writer and its route live in the same dashboard
 * process. **Ours do not.** The writer is the Overseer daemon; the route is the
 * dashboard. Those fields live in memory this process cannot reach, and serving
 * a `status()` read off a *reader* handle would be a fabrication: it would say
 * "no failures" because this process has never attempted a write.
 *
 * So the honest weaker answer: **is anything still being recorded?**, computed
 * from the records themselves. The last line's own source instant plus its own
 * `nextDueMs` against now gives *overdue by how long*, which is what the reader
 * actually wants to know and is derivable without seeing the writer at all.
 *
 * What it cannot distinguish is *why* — a daemon that is down looks the same as
 * one whose disk went read-only. That is a real limitation and the page says so
 * rather than guessing. A status sidecar the daemon writes and this reads would
 * close it, and is named in the plan as a later option; building it now would be
 * a second on-disk seam for a distinction nobody has yet needed.
 *
 * **Why "overdue" is not just `now - lastRecordedAt > 300s`:** the cadence is on
 * each record. A daemon started with a different `--usage-interval`, or a future
 * change to `USAGE_INTERVAL_MS`, would otherwise make every ordinary gap look
 * like a failure — and a monitor that cries wolf at its own configuration is the
 * failure mode this whole area keeps circling.
 */
import { gzipSync } from "node:zlib";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { UsageHistoryReader, UsageHistorySample } from "./usage-history.js";

export const USAGE_HISTORY_PATH = "/api/usage/history";
export const DEFAULT_WINDOW_HOURS = 24;
export const MAX_WINDOW_HOURS = 168;
const GZIP_ABOVE_BYTES = 8 * 1024;

/**
 * How late the recorder is, derived from the records.
 *
 * `null` for `lastRecordedAt` means nothing has been recorded at all — which is
 * NOT the same as the recorder being late, and the page says different things
 * about them. A fresh box has recorded nothing and is perfectly healthy.
 */
export type RecorderHealth = {
  lastRecordedAt: string | null;
  /** The cadence the last record itself declared. Null when there is no record. */
  expectedEveryMs: number | null;
  /** How far past `expectedEveryMs` we are. Null when unknown or not overdue. */
  overdueByMs: number | null;
};

export type UsageHistoryPayload =
  | {
      schema: 1;
      kind: "history";
      windowHours: number;
      fromMs: number;
      toMs: number;
      samples: UsageHistorySample[];
      predecessor: UsageHistorySample | null;
      holes: { afterAt: string | null; beforeAt: string | null }[];
      earliestAt: string | null;
      rotated: boolean;
      unreadableLines: number;
      unsupportedLines: number;
      recorder: RecorderHealth;
      refreshMs: number;
    }
  | { schema: 1; kind: "unreadable"; why: string };

export type UsageHistoryRouteDeps = {
  store: UsageHistoryReader | null;
  refreshMs: number;
  /**
   * The server's clock, so the window's edges are stamped by the same process
   * that will be compared against them. A browser computing "24h ago" from its
   * own clock draws a drifted phone as a chart missing its newest hours —
   * absence caused by arithmetic, indistinguishable on screen from an outage.
   */
  nowMs(): number;
};

export function windowHoursFrom(url: string): number {
  const value = new URL(url, "http://fleet.invalid").searchParams.get("hours");
  if (value === null) return DEFAULT_WINDOW_HOURS;
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours <= 0) return DEFAULT_WINDOW_HOURS;
  return Math.min(hours, MAX_WINDOW_HOURS);
}

/**
 * The newest record's **append** instant and cadence, and how overdue that makes
 * the recorder.
 *
 * ## It is measured from `recordedAt`, not `collectedAt`
 *
 * A pass is stamped `collectedAt` when it STARTS and appended 13–16 seconds
 * later, because the transcript scan takes that long (measured on live records:
 * source gaps of 300,000 ms against append delays of 13,042–15,693 ms). Measuring
 * from `collectedAt` + the cadence therefore declares the recorder overdue during
 * every single healthy scan — an alarm that fires on the normal case, which is
 * the failure this whole area keeps circling. GPT Sol H1.
 *
 * "Is anything still being recorded" is a question about *writes*, so it is
 * answered with the instant of the last write.
 *
 * ## It considers the PREDECESSOR
 *
 * If the daemon died 25 hours ago, a 24-hour read returns no samples at all and
 * the last record as `predecessor`. Computing health from `samples` alone then
 * reports *nothing has ever been recorded* — the exact inverse of the truth,
 * on the one screen whose job is to say the recorder stopped. GPT Sol H4.
 *
 * Reads the LAST record in file order rather than the largest instant: a clock
 * that stepped backwards should surface as a regression in the series, not be
 * smoothed over here by picking whichever number is biggest.
 */
export function recorderHealthOf(
  samples: readonly UsageHistorySample[],
  nowMs: number,
  predecessor: UsageHistorySample | null = null,
): RecorderHealth {
  let lastAtMs: number | null = null;
  let expectedEveryMs: number | null = null;
  /* The predecessor first, so an in-window sample always wins over it. */
  for (const sample of [...(predecessor === null ? [] : [predecessor]), ...samples]) {
    if (sample.kind === "unsupported") continue;
    lastAtMs = sample.kind === "sample" ? Date.parse(sample.line.recordedAt) : sample.recordedAtMs;
    expectedEveryMs = sample.kind === "sample" ? sample.line.nextDueMs : sample.nextDueMs;
  }
  if (lastAtMs === null || !Number.isFinite(lastAtMs)) {
    return { lastRecordedAt: null, expectedEveryMs: null, overdueByMs: null };
  }
  const late = expectedEveryMs === null ? null : nowMs - lastAtMs - expectedEveryMs;
  return {
    lastRecordedAt: new Date(lastAtMs).toISOString(),
    expectedEveryMs,
    overdueByMs: late !== null && late > 0 ? late : null,
  };
}

/** Pure given a store: no request, no response, no clock of its own. */
export function usageHistoryPayload(deps: UsageHistoryRouteDeps, windowHours: number): UsageHistoryPayload {
  if (deps.store === null) {
    return {
      schema: 1,
      kind: "unreadable",
      why:
        "this dashboard is not reading usage history — the store would not open, and the reason is in " +
        "the server's log. Nothing is being shown, which is not the same as nothing having happened.",
    };
  }
  const toMs = deps.nowMs();
  const fromMs = toMs - windowHours * 60 * 60 * 1000;
  const read = deps.store.read({ sinceMs: fromMs });
  if (read.kind === "unreadable") return { schema: 1, kind: "unreadable", why: read.why };

  return {
    schema: 1,
    kind: "history",
    windowHours,
    fromMs,
    toMs,
    samples: read.samples,
    predecessor: read.predecessor,
    holes: read.holes.map((hole) => ({
      afterAt: hole.afterAtMs === null ? null : new Date(hole.afterAtMs).toISOString(),
      beforeAt: hole.beforeAtMs === null ? null : new Date(hole.beforeAtMs).toISOString(),
    })),
    earliestAt: read.earliestAt,
    rotated: read.rotated,
    unreadableLines: read.unreadableLines,
    unsupportedLines: read.unsupportedLines,
    recorder: recorderHealthOf(read.samples, toMs, read.predecessor),
    refreshMs: deps.refreshMs,
  };
}

export function usageHistoryRoute(deps: UsageHistoryRouteDeps): {
  handle(req: IncomingMessage, res: ServerResponse): boolean;
} {
  return {
    handle(req, res): boolean {
      const url = req.url ?? "/";
      if (!url.startsWith(USAGE_HISTORY_PATH)) return false;
      const path = url.split("?")[0] ?? "";
      if (path !== USAGE_HISTORY_PATH) {
        res.writeHead(404, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify({ schema: 1, kind: "unreadable", why: `no such route: ${path}` }));
        return true;
      }

      let body: string;
      try {
        body = JSON.stringify(usageHistoryPayload(deps, windowHoursFrom(url)));
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(
          JSON.stringify({
            schema: 1,
            kind: "unreadable",
            why: `building the usage history answer threw: ${err instanceof Error ? err.message : String(err)}`,
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
