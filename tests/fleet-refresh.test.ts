/**
 * One turn of the fleet dashboard's loop — tools/fleet/refresh.ts.
 *
 * **THIS IS THE TEST THE ORIGINAL BUG NEEDED, AND THE OTHERS WOULD NOT HAVE
 * CAUGHT IT.** The queue, the route and the delivery module were each tested;
 * what was missing was the LINE THAT JOINS THEM, and a missing line lives in
 * whatever function nobody can import. So this drives the real action route and
 * the real orchestration together: a message is posted over HTTP, one refresh
 * turn runs against a fake collector, and the assertion is that the exact text
 * and the exact target arrive at a fake transport. Delete the drain call from
 * `refreshOnce` and this goes red; nothing else in the suite does. GPT Sol's
 * D8, 2026-09-08.
 *
 * **NOTHING HERE SENDS A KEYSTROKE.** The transport is injected and the tmux
 * ids are fictional (`%99101`, `$99101`), which matters more in this file than
 * in most: it is the only one that exercises the whole path a real message
 * takes, and there are ~35 live agent sessions on this box.
 */
import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import type { FleetRow, FleetSnapshot } from "../tools/fleet/collect.js";
import type { DrainResult } from "../tools/fleet/drain.js";
import { SteeringQueue } from "../tools/fleet/queue.js";
import { refreshOnce, type RefreshDeps } from "../tools/fleet/refresh.js";
import { makeActionRoutes, type ActionDeps, type ActionRoutes } from "../tools/fleet/routes-actions.js";
import { createRateLimiter } from "../tools/fleet/routes-steer.js";
import type { FleetStatus } from "../tools/fleet/status.js";
import type { SteerResult, SteerTarget } from "../tools/fleet/steer.js";

const HOST = "100.90.80.70:8787";
const ORIGIN = `http://${HOST}`;
const PANE = "%99101";
const SESSION = "$99101";
const PANE_PID = 424243;
/** This file's own, for the reason tests/fixture-ids.test.ts exists. */
const CONVO = "3a1d5c84-6f2b-4e77-9c10-8b6ef0a2d551";
const TMUX_GENERATION = 991_001;

const IDLE: FleetStatus = { kind: "idle" };

const SENT_OK: SteerResult = {
  ok: true,
  verified: { paneId: PANE, sessionId: SESSION, panePid: PANE_PID, claudePid: 424299 },
  sent: [["send-keys", "-t", PANE, "-l", "--", "…"]],
};

function row(over: Partial<FleetRow> = {}): FleetRow {
  return {
    id: SESSION,
    name: "wf-fixture",
    title: null,
    repo: null,
    worktree: null,
    meta: { version: "legacy" },
    startedAt: "2026-09-08T00:00:00.000Z",
    status: IDLE,
    paneId: PANE,
    panePid: PANE_PID,
    claudeSessionId: CONVO,
    question: null,
    // Required on a row, and irrelevant here: a fixture is not a pane that was read.
    permissionMode: { kind: "cannot-tell", why: "a fixture row, not a pane that was read" },
    ...over,
  };
}

function snap(over: Partial<FleetSnapshot> = {}): FleetSnapshot {
  return { rows: [row()], collectedAt: "2026-09-08T12:00:00.000Z", tookMs: 13_000, tmuxServerPid: TMUX_GENERATION, ...over };
}

/* ------------------------------------------------------------------ *
 * The real routes, with a recording transport.
 * ------------------------------------------------------------------ */

type Sent = { target: SteerTarget; text: string; declaredStatus: FleetStatus };

function actionRoutes(): { routes: ActionRoutes; sent: Sent[]; queue: SteeringQueue } {
  let clock = 1_000_000;
  const sent: Sent[] = [];
  const queue = new SteeringQueue({ now: () => clock });
  const routes = makeActionRoutes({
    queue,
    sendMessage: (target, text, declaredStatus) => {
      sent.push({ target, text, declaredStatus });
      return SENT_OK;
    },
    now: () => clock,
    limiter: createRateLimiter({ minIntervalMs: 0, burstMax: 1_000, burstWindowMs: 1 }),
    log: () => {},
  } satisfies Partial<ActionDeps>);
  return { routes, sent, queue };
}

async function enqueueOverHttp(routes: ActionRoutes, body: Record<string, unknown>): Promise<number | null> {
  const stream = new PassThrough();
  stream.write(JSON.stringify(body));
  stream.end();
  const req = Object.assign(stream, {
    url: "/api/actions/session",
    method: "POST",
    headers: { host: HOST, origin: ORIGIN, "content-type": "application/json" },
    socket: { remoteAddress: "100.90.80.71" },
  }) as unknown as import("node:http").IncomingMessage;

  let status: number | null = null;
  let settle: () => void = () => {};
  const done = new Promise<void>((r) => {
    settle = r;
  });
  const res = {
    writeHead(code: number) {
      status = code;
      return res;
    },
    end() {
      settle();
      return res;
    },
  };
  expect(routes.handle(req, res as unknown as import("node:http").ServerResponse)).toBe(true);
  await done;
  return status;
}

/** The rest of one turn's world, recording rather than doing. */
function refreshHarness(over: Partial<RefreshDeps> = {}) {
  const events: string[] = [];
  const logs: string[] = [];
  const kept: ({ snapshot: FleetSnapshot } | { error: string })[] = [];
  const deps: RefreshDeps = {
    collect: () => Promise.resolve(snap()),
    keep: (result) => {
      kept.push(result);
      events.push("keep");
    },
    refreshHealth: () => events.push("health"),
    publish: () => events.push("publish"),
    drain: () => {
      events.push("drain");
      return { rows: 0, considered: 0, generation: TMUX_GENERATION, invalidated: 0, outcomes: [] } satisfies DrainResult;
    },
    log: (line) => {
      logs.push(line);
      events.push("log");
    },
    logError: (line) => {
      logs.push(line);
      events.push("logError");
    },
    subscribers: () => 0,
    ...over,
  };
  return { deps, events, logs, kept };
}

/* ================================================================== *
 * The wiring, end to end.
 * ================================================================== */

describe("one refresh turn", () => {
  it("delivers a message posted to the action route, to the pane the snapshot names", async () => {
    const { routes, sent, queue } = actionRoutes();
    const status = await enqueueOverHttp(routes, {
      paneId: PANE,
      sessionId: SESSION,
      claudeSessionId: CONVO,
      panePid: PANE_PID,
      status: { kind: "idle" },
      mode: "enqueue",
      text: "merge origin/dev before you push",
    });
    expect(status).toBe(200);
    expect(sent).toHaveLength(0);
    expect(queue.size(SESSION)).toBe(1);

    const { deps } = refreshHarness({ drain: (s) => routes.drain(s) });
    const outcome = await refreshOnce(deps);

    // THE WHOLE ADDRESS, not just that something was sent.
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toBe("merge origin/dev before you push");
    expect(sent[0]?.target).toEqual({ paneId: PANE, sessionId: SESSION, claudeSessionId: CONVO, panePid: PANE_PID });
    expect(sent[0]?.declaredStatus).toEqual(IDLE);
    // And it has left the waiting state rather than merely having been read.
    expect(queue.size(SESSION)).toBe(0);
    expect(outcome.drained?.outcomes.map((o) => o.kind)).toEqual(["delivered"]);
  });

  it("publishes the snapshot before it delivers anything", async () => {
    // Delivery blocks this process for as long as tmux takes, and nothing a
    // person is looking at should wait behind a keystroke.
    const { deps, events } = refreshHarness();
    await refreshOnce(deps);
    expect(events.filter((e) => e === "keep" || e === "health" || e === "publish" || e === "drain")).toEqual([
      "keep",
      "health",
      "publish",
      "drain",
    ]);
  });

  it("never delivers off a failed collection", async () => {
    // The rows we would aim at are the previous ones, and a status is the whole
    // reason a message goes now rather than in a minute.
    const { deps, events, kept } = refreshHarness({ collect: () => Promise.reject(new Error("tmux timed out")) });
    const outcome = await refreshOnce(deps);
    expect(events).not.toContain("drain");
    expect(outcome.error).toBe("tmux timed out");
    expect(outcome.drained).toBe(null);
    expect(kept).toEqual([{ error: "tmux timed out" }]);
    // The failure is still published and the vitals still taken — a collection
    // fails when the box is in trouble, which is when they are worth most.
    expect(events).toContain("health");
    expect(events).toContain("publish");
  });

  it("does not let a drain that throws report the collection as failed", async () => {
    const { deps, events, logs } = refreshHarness({
      drain: () => {
        events.push("drain");
        throw new Error("the delivery module exploded");
      },
    });
    const outcome = await refreshOnce(deps);
    expect(outcome.collected).not.toBe(null);
    expect(outcome.error).toBe(null);
    expect(outcome.drainError).toBe("the delivery module exploded");
    expect(logs.join(" ")).toContain("drain failed");
    // And the next turn happens exactly as before: nothing here rethrows.
    const again = await refreshOnce(refreshHarness().deps);
    expect(again.error).toBe(null);
  });
});
