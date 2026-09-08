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
import type { HealthTurn, SampleStamp } from "../tools/fleet/health-history.js";
import type { HealthReport } from "../tools/fleet/health.js";
import { SteeringQueue } from "../tools/fleet/queue.js";
import { collectionStillRunning, refreshOnce, singleFlightCollect, type RefreshDeps } from "../tools/fleet/refresh.js";
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
    /* The arm the collector produces before `readPauses` has run. Not `none`:
       a fixture is in no position to claim we looked everywhere. */
    pause: { kind: "cannot-tell", why: "the fixture did not say", cause: "rate-limits-not-collected" },
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
  const queue = new SteeringQueue({ now: () => clock, serverInstanceId: "1a2b3c4d" });
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

/** A health reading with nothing interesting in it, for turns that are not about health. */
function bareReport(): HealthReport {
  return {
    load: { kind: "unknown", why: "not measured in this test" },
    memory: { kind: "unknown", why: "not measured in this test" },
    swap: { kind: "unknown", why: "not measured in this test" },
    disk: { kind: "unknown", why: "not measured in this test" },
    swapActivity: { kind: "skipped" },
    attribution: { kind: "unknown", why: "not measured in this test" },
    verdict: { level: "unknown", reasons: ["fixture"] },
    collectedAt: "2026-09-08T12:00:00.000Z",
    tookMs: 7,
  };
}

/** The rest of one turn's world, recording rather than doing. */
function refreshHarness(over: Partial<RefreshDeps> = {}) {
  const events: string[] = [];
  const logs: string[] = [];
  const kept: ({ snapshot: FleetSnapshot } | { error: string })[] = [];
  const retained: { turn: HealthTurn; stamp: SampleStamp }[] = [];
  const deps: RefreshDeps = {
    collect: () => Promise.resolve(snap()),
    keep: (result) => {
      kept.push(result);
      events.push("keep");
    },
    refreshHealth: () => {
      events.push("health");
      return { kind: "reading", report: bareReport() };
    },
    retainHealth: (turn, stamp) => {
      retained.push({ turn, stamp });
      events.push("retain");
    },
    refreshMs: 60_000,
    now: () => new Date("2026-09-08T12:00:30.000Z"),
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
  return { deps, events, logs, kept, retained };
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
      // AS THE PAGE POSTS IT. Every body the dashboard sends says who is
      // speaking; an absent `speaker` is read as the weaker claim, so a fixture
      // without it would be a test of the default rather than of the button.
      speaker: "greg",
      text: "merge origin/dev before you push",
    });
    expect(status).toBe(200);
    expect(sent).toHaveLength(0);
    expect(queue.size(SESSION)).toBe(1);

    const { deps } = refreshHarness({ drain: (s) => routes.drain(s) });
    const outcome = await refreshOnce(deps);

    // THE WHOLE ADDRESS, not just that something was sent.
    expect(sent).toHaveLength(1);
    // ATTRIBUTED, and the prefix is rendered at DELIVERY — so this turn is
    // where it has to appear. The words are the person's; the line in front of
    // them is what tells the agent whose they are.
    expect(sent[0]?.text).toBe("[Greg, via the fleet dashboard] merge origin/dev before you push");
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

/* ================================================================== *
 * The health history, joined the same way and for the same reason.
 * ================================================================== */

describe("one refresh turn, retaining box health", () => {
  it("retains after it publishes and before it drains", async () => {
    /* After publish: publishing is what a person is waiting on, and a write
       that can stall on dirty-page writeback does not belong in front of it.
       Before drain: the drain is up to six ten-second `execFileSync` calls and
       anything behind it can be starved for a minute. */
    const { deps, events } = refreshHarness();
    await refreshOnce(deps);
    expect(events.indexOf("retain")).toBeGreaterThan(events.indexOf("publish"));
    expect(events.indexOf("retain")).toBeLessThan(events.indexOf("drain"));
  });

  it("retains the turn even when the collection failed, because that is when it matters", async () => {
    const { deps, retained } = refreshHarness({ collect: () => Promise.reject(new Error("tmux timed out")) });
    await refreshOnce(deps);
    expect(retained).toHaveLength(1);
  });

  it("records the LONGER interval after a failed collection, not the nominal one", async () => {
    /* The loop waits 5x after a failure. A sample that claimed the nominal
       cadence would make every backed-off turn look like a five-minute outage
       — an alarm that is usually wrong, which is the same picture as a quiet
       page over a dead box. */
    const good = refreshHarness();
    await refreshOnce(good.deps);
    const bad = refreshHarness({ collect: () => Promise.reject(new Error("tmux timed out")) });
    await refreshOnce(bad.deps);

    /* 60s wait + the fixture snapshot's tookMs + the health reading's 7ms. */
    expect(good.retained[0]?.stamp.nextDueMs).toBeGreaterThanOrEqual(60_000);
    expect(good.retained[0]?.stamp.nextDueMs).toBeLessThan(120_000);
    /* 5 x 60s, and no collection time to add because there was no collection. */
    expect(bad.retained[0]?.stamp.nextDueMs).toBe(300_000 + 7);
  });

  it("does not let a retention failure stop the loop or spoil the collection", async () => {
    const { deps, events, logs } = refreshHarness({
      retainHealth: () => {
        events.push("retain");
        throw new Error("no space left on device");
      },
    });
    const outcome = await refreshOnce(deps);
    expect(outcome.error).toBe(null);
    expect(outcome.collected).not.toBe(null);
    expect(events).toContain("publish");
    expect(events).toContain("drain");
    expect(logs.join(" ")).toContain("no space left on device");
  });

  it("appends a collector failure as its own arm rather than as a reading", async () => {
    const { deps, retained } = refreshHarness({
      refreshHealth: () => ({ kind: "collector-failed", why: "collectHealth threw: out of memory" }),
    });
    await refreshOnce(deps);
    expect(retained[0]?.turn).toEqual({ kind: "collector-failed", why: "collectHealth threw: out of memory" });
  });

  /* THE END-TO-END JOIN IS IN tests/fleet-health-wiring.test.ts, and it is not
     here on purpose. A version of it lived in this file and built its own store
     and its own route — which would stay green if `server.ts` composed a
     DIFFERENT store, the exact failure the test claimed to catch. It now drives
     `makeHealthRetention`, the function the server itself calls. GPT Sol's
     finding 5, 2026-09-08. */
});

/* ------------------------------------------------------------------ *
 * The latch: one owned collection attempt at a time.
 *
 * **Every test here is about a child that outlives its caller**, which is the
 * shape of E-blocking: `collectWithDeadline` rejects on the timer and nothing
 * remembers the `bash -c` still grepping thirty-five transcripts, so the loop's
 * response to a wedged collector was a second one. Nothing here spawns a
 * process — `run` is a promise the test resolves by hand, which is the only way
 * to hold a child in the wedged state on purpose.
 * ------------------------------------------------------------------ */

/** A child the test settles when it likes, and which counts how many were started. */
function fakeChild() {
  let starts = 0;
  const settlers: { resolve(s: FleetSnapshot): void; reject(e: Error): void }[] = [];
  return {
    get starts() {
      return starts;
    },
    run(): Promise<FleetSnapshot> {
      starts += 1;
      return new Promise<FleetSnapshot>((resolve, reject) => settlers.push({ resolve, reject }));
    },
    /** Settle the nth child (0-based) and let its handlers run. */
    async finish(index: number, snapshot: FleetSnapshot): Promise<void> {
      settlers[index]?.resolve(snapshot);
      await Promise.resolve();
      await Promise.resolve();
    },
    async fail(index: number, why: string): Promise<void> {
      settlers[index]?.reject(new Error(why));
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

/** The latch with a clock the test moves, and a 10ms caller deadline. */
function latched(child: { run(): Promise<FleetSnapshot> }, clock: { ms: number }, late: string[] = []) {
  return singleFlightCollect({
    run: () => child.run(),
    deadlineMs: 10,
    now: () => clock.ms,
    onLate: (line) => late.push(line),
  });
}

describe("singleFlightCollect — a caller's deadline does not release the child", () => {
  it("starts no second child while the first has not settled", async () => {
    const child = fakeChild();
    const clock = { ms: 0 };
    const latch = latched(child, clock);

    await expect(latch.collect()).rejects.toThrow(/did not finish within/);
    expect(child.starts).toBe(1);

    // The next turn of the loop, with the child still wedged.
    clock.ms = 420_000;
    await expect(latch.collect()).rejects.toThrow(/has been running for 420s and has not finished/);
    // THE ASSERTION THE WHOLE STAGE IS FOR.
    expect(child.starts).toBe(1);

    // And a third turn is still not a third child.
    clock.ms = 780_000;
    await expect(latch.collect()).rejects.toThrow(collectionStillRunning(780_000));
    expect(child.starts).toBe(1);
  });

  it("a repeated refresh reports the stuck child and keeps the old rows", async () => {
    const child = fakeChild();
    const clock = { ms: 0 };
    const latch = latched(child, clock);
    const { deps, kept } = refreshHarness({ collect: () => latch.collect() });

    await refreshOnce(deps);
    clock.ms = 300_000;
    await refreshOnce(deps);

    expect(kept).toHaveLength(2);
    // Never a snapshot, so `server.ts` keeps the previous one — and the second
    // turn's sentence is the stuck child rather than a fresh abandonment.
    expect(kept.every((k) => "error" in k)).toBe(true);
    expect(kept[1]).toEqual({ error: expect.stringContaining("has been running for 300s") });
    expect(child.starts).toBe(1);
  });

  it("logs a late success and drops it — the next turn collects afresh", async () => {
    const child = fakeChild();
    const clock = { ms: 0 };
    const late: string[] = [];
    const latch = latched(child, clock, late);

    await expect(latch.collect()).rejects.toThrow(/did not finish within/);
    clock.ms = 500_000;
    const arrived = snap({ collectedAt: "2026-09-08T11:52:00.000Z" });
    await child.finish(0, arrived);

    // On the record, so "the child finally finished" and "it is gone for ever"
    // are distinguishable afterwards.
    expect(late[0]).toContain("has come back with 1 rows");
    expect(late[0]).toContain("2026-09-08T11:52:00.000Z");
    expect(late[0]).toContain("not used");

    // And the latch is free, so the next turn is a real collection rather than
    // eight-minute-old rows wearing a fresh turn's clothes.
    const fresh = snap({ collectedAt: "2026-09-08T12:04:00.000Z" });
    const next = latch.collect();
    expect(child.starts).toBe(2);
    await child.finish(1, fresh);
    await expect(next).resolves.toEqual(fresh);
  });

  it("a late snapshot never reaches keep, publish or the drain", async () => {
    /* **THE REASON A LATE SUCCESS IS DROPPED AT ALL**, and the assertion that
       says so. `refreshOnce` gives whatever `collect()` resolves with to
       `drain()`, which aims tmux keystrokes at the panes those rows name and
       decides *whether to send now* from each row's `status`. refresh.ts's own
       rule, six lines from the bottom of the file: stale rows are how the right
       text reaches the wrong session. */
    const child = fakeChild();
    const clock = { ms: 0 };
    const latch = latched(child, clock);
    const { deps, kept, events } = refreshHarness({ collect: () => latch.collect() });

    await refreshOnce(deps); // the deadline fires; the child keeps running
    clock.ms = 500_000;
    const stale = snap({ collectedAt: "2026-09-08T11:52:00.000Z" });
    await child.finish(0, stale);

    // The turn that saw the abandonment kept an error, and nothing since has
    // put those rows anywhere.
    expect(kept).toEqual([{ error: expect.stringContaining("did not finish within") }]);
    expect(events).not.toContain("drain");

    // And the next turn drains off a FRESH collection, not the late one.
    const fresh = snap({ collectedAt: "2026-09-08T12:04:00.000Z" });
    const turn = refreshOnce(deps);
    await child.finish(1, fresh);
    await turn;
    expect(kept[1]).toEqual({ snapshot: fresh });
    expect(events).toContain("drain");
  });

  it("a late failure is logged, not reported, and does not block the next collection", async () => {
    const child = fakeChild();
    const clock = { ms: 0 };
    const late: string[] = [];
    const latch = latched(child, clock, late);

    await expect(latch.collect()).rejects.toThrow(/did not finish within/);
    clock.ms = 300_000;
    await child.fail(0, "tmux server gone");

    expect(late[0]).toContain("tmux server gone");
    expect(late[0]).toContain("not reported");

    // The latch is free again, and the next turn is a real collection.
    const fresh = snap();
    const next = latch.collect();
    expect(child.starts).toBe(2);
    await child.finish(1, fresh);
    await expect(next).resolves.toEqual(fresh);
  });

  it("onStart fires exactly when a child starts, and never on a turn that is refused", async () => {
    /* **`attemptedAt` HANGS OFF THIS**, and five things read `attemptedAt` as
       the moment a collection began: the page's header, attempt-clock.ts, and
       the Overseer's daemon.ts, observation.ts and notes.ts. If a refused turn
       fired this, the page would say "a collection was started 0s ago" over a
       child that had been wedged for seven minutes. GPT Sol's P1, 2026-09-08. */
    const child = fakeChild();
    const clock = { ms: 0 };
    const starts: number[] = [];
    const latch = singleFlightCollect({
      run: () => child.run(),
      deadlineMs: 10,
      now: () => clock.ms,
      onStart: () => starts.push(clock.ms),
    });

    await expect(latch.collect()).rejects.toThrow(/did not finish within/);
    expect(starts).toEqual([0]);

    // The wedged child is still out there, so this turn starts nothing — and
    // must say nothing.
    clock.ms = 420_000;
    await expect(latch.collect()).rejects.toThrow(/has been running for 420s/);
    expect(starts).toEqual([0]);

    clock.ms = 500_000;
    await expect(latch.collect()).rejects.toThrow(/has been running for 500s/);
    expect(starts).toEqual([0]);

    // The child finally settles; the next turn does start one, and says so.
    await child.finish(0, snap());
    clock.ms = 560_000;
    const next = latch.collect();
    await child.finish(1, snap());
    await next;
    expect(starts).toEqual([0, 560_000]);
  });

  it("an onLate that throws does not become an unhandled rejection", async () => {
    /* The child's own rejection is handled; the promise `then` RETURNS is the
       one nobody was listening to. GPT Sol probed it with a throwing logger,
       2026-09-08. Vitest fails the run on an unhandled rejection, so the
       assertion is partly that this test finishes at all. */
    const child = fakeChild();
    const clock = { ms: 0 };
    const latch = singleFlightCollect({
      run: () => child.run(),
      deadlineMs: 10,
      now: () => clock.ms,
      onLate: () => {
        throw new Error("the logger itself failed");
      },
    });

    await expect(latch.collect()).rejects.toThrow(/did not finish within/);
    await child.finish(0, snap());
    await new Promise((r) => setTimeout(r, 5));

    // And the latch is still usable, not wedged by its own logger.
    const fresh = snap();
    const next = latch.collect();
    expect(child.starts).toBe(2);
    await child.finish(1, fresh);
    await expect(next).resolves.toEqual(fresh);
  });

  it("a child that fails inside the deadline is reported normally and releases the latch", async () => {
    const child = fakeChild();
    const clock = { ms: 0 };
    const latch = latched(child, clock);

    const first = latch.collect();
    await child.fail(0, "could not read this box's tmux sessions");
    await expect(first).rejects.toThrow("could not read this box's tmux sessions");

    const fresh = snap();
    const second = latch.collect();
    expect(child.starts).toBe(2);
    await child.finish(1, fresh);
    await expect(second).resolves.toEqual(fresh);
  });
});
