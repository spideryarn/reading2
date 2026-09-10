/**
 * The health-history composition, in one importable place.
 *
 * **THIS FILE EXISTS BECAUSE THE TEST THAT WAS SUPPOSED TO CATCH THE DEAD
 * FEATURE DID NOT.** The first version of the join test built its own store,
 * handed it to its own `healthHistoryRoute`, ran a turn and read it back — and
 * it would have stayed green if `server.ts` had mounted the route with a
 * *different* store instance, or against a different directory. That is not a
 * near miss: it is the same shape as the bug this whole module was re-arranged
 * around, where a route, a queue and a delivery module were each tested and the
 * line joining them was missing. GPT Sol's finding 5, 2026-09-08.
 *
 * So the composition is here, `server.ts` holds nothing but a call to it, and
 * the test drives **the same function the server does**. Building the store
 * twice is now impossible rather than merely unlikely: there is one place that
 * says which directory, one that opens it, and one that hands it to the route.
 *
 * What this still cannot prove is that `server.ts` calls `route.handle` in its
 * request path — that line lives in a file no test can import, because
 * importing it binds port 8787. Two things cover it: a source check in
 * tests/fleet-health-wiring.test.ts, which is the same kind of guard
 * tests/fleet-web.test.tsx already uses, and looking at the real page in a real
 * browser, which is what the plan's last stage is for.
 */
import {
  WORK_EVERY_MS,
  openHealthHistory,
  type HealthHistory,
  type HealthTurn,
  type OpenedHistory,
  type SampleStamp,
} from "./health-history.js";
import { readCheckpointFeeds } from "./overseer-status.js";
import { healthHistoryRoute } from "./routes-health-history.js";
import { projectStoredWork } from "./work-groups.js";
import type { StoredWork, StoredWorkTurn, WorkFeed } from "./wire.js";

export type HealthRetention = {
  /** Null when the store would not open. The dashboard runs on regardless. */
  store: HealthHistory | null;
  /** Mount this in the request path. Returns false for a request that is not its own. */
  route: { handle(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse): boolean };
  /** The `retainHealth` dep for `refreshOnce`. A no-op when the store would not open. */
  retainHealth(turn: HealthTurn, stamp: SampleStamp): void;
  /** What to say at startup — the directory, or why there is not one. */
  lines: { log: string[]; error: string[] };
  /** The raw open result, for anything that wants more than the sentences. */
  opened: OpenedHistory;
};

export function makeHealthRetention(options: {
  /** `undefined` takes the default root; `openHealthHistory` refuses a relative path. */
  dir?: string | undefined;
  refreshMs: number;
  nowMs?: (() => number) | undefined;
  /** One projection of the real checkpoint read by default; injected to make cadence observable in tests. */
  readWork?: ((checkedAt: string) => WorkFeed) | undefined;
}): HealthRetention {
  const opened = openHealthHistory(options.dir);
  const store = opened.kind === "open" ? opened.store : null;
  const nowMs = options.nowMs ?? ((): number => Date.now());
  const readWork = options.readWork ?? ((checkedAt: string): WorkFeed => readCheckpointFeeds(undefined, checkedAt).work);
  /* Intentionally process-local and initially unset. A restart is exactly when
     somebody needs to know what was running, so its first retained turn is due
     rather than inheriting a phase reconstructed from yesterday's bytes. */
  let lastWorkWrittenAtMs: number | null = null;
  const log: string[] = [];
  const error: string[] = [];

  const unavailable = (checkedAt: string, why: string): StoredWork =>
    projectStoredWork({
      kind: "unavailable",
      source: { kind: "checkpoint-unavailable", checkedAt },
      why,
    }, checkedAt);

  const dueWork = (checkedAt: string): StoredWorkTurn => {
    let feed: WorkFeed;
    try {
      feed = readWork(checkedAt);
    } catch (cause) {
      return {
        kind: "due",
        result: unavailable(
          checkedAt,
          `reading the work checkpoint threw: ${cause instanceof Error ? cause.message : String(cause)}`,
        ),
      };
    }
    switch (feed.kind) {
      case "published":
        return { kind: "due", result: feed.work };
      case "checkpoint-absent":
        return {
          kind: "due",
          result: unavailable(checkedAt, "the Overseer checkpoint did not exist when the work reading was due"),
        };
      case "checkpoint-unreadable":
        return { kind: "due", result: unavailable(checkedAt, feed.why) };
      default: {
        const never: never = feed;
        return { kind: "due", result: unavailable(checkedAt, `the work reader returned ${JSON.stringify(never)}`) };
      }
    }
  };

  if (opened.kind === "open") {
    log.push(`health history → ${opened.dir}`);
    if (opened.repaired.torn) {
      error.push(`health history: repaired a torn last line (${opened.repaired.droppedBytes} bytes dropped)`);
    }
    const lockedOut = opened.store.status().lockedOutBy;
    /* Not an error that stops anything, and not silent either: reading without
       writing is a real mode and the page says so too. */
    if (lockedOut !== null) error.push(`health history is read-only here: ${lockedOut}`);
  } else {
    error.push(`health history disabled: ${opened.why}`);
  }

  return {
    store,
    opened,
    lines: { log, error },
    route: healthHistoryRoute({
      store,
      refreshMs: options.refreshMs,
      nowMs,
    }),
    /* Kept here rather than branched at the refresh call site: whether history
       is being kept and when work is due are composition facts, and the loop
       should not have an opinion about either. Where failure is REPORTED is the
       route, which carries `store.status()` on every answer. */
    retainHealth: (turn, stamp) => {
      if (store === null) return;
      const checkedAtMs = nowMs();
      const due =
        lastWorkWrittenAtMs === null ||
        checkedAtMs < lastWorkWrittenAtMs ||
        checkedAtMs - lastWorkWrittenAtMs >= WORK_EVERY_MS;
      const workTurn: StoredWorkTurn = due
        ? dueWork(new Date(checkedAtMs).toISOString())
        : { kind: "not-due" };
      /* `append` says whether bytes reached the store. A read-only or poisoned
         dashboard must keep trying on the next turn; advancing here merely
         because no exception escaped would silently stop those retries. */
      const written = store.append(turn, stamp, workTurn);
      if (written && due) lastWorkWrittenAtMs = checkedAtMs;
    },
  };
}
