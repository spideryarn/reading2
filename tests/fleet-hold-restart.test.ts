/**
 * **THE ACCEPTANCE TEST FOR STAGE 4b: A HOLD OUTLIVES THE PROCESS THAT
 * RECORDED IT.**
 *
 * WHAT IT RESTARTS, AND WHY THAT IS THE ONLY VERSION OF THIS TEST WORTH
 * HAVING. Every composition is torn down and built again from nothing: a new
 * `QuarantineBook`, a new `SendCoordinator`, a new `SteeringQueue`, a new
 * server instance id, and a **new `HoldLedger` opened over the same
 * directory**. The second composition shares no object with the first — the
 * only thing that crosses the boundary is bytes on a disk, which is exactly
 * what crosses it when somebody restarts the dashboard. A test that handed the
 * book to the "new" process, or reused a ledger, would pass while the feature
 * did nothing.
 *
 * The one thing it cannot restart is the OS process. `mkdtemp` plus a full
 * teardown is the closest an in-process test gets, and the gap it leaves —
 * module-level state surviving where a real restart would clear it — is closed
 * by `resetSharedQuarantineForTests()` in the composition test at the bottom,
 * which drives the very function `server.ts` calls.
 *
 * **NOTHING HERE SENDS A KEYSTROKE.** Every transport is injected and every
 * tmux id is fictional; there are ~37 live agent sessions on this box doing
 * other people's work.
 *
 * docs/plans/260908j § Stage 4b.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { LEDGER_FILE, openHoldLedger, type HoldLedger } from "../tools/fleet/hold-ledger.js";
import {
  QuarantineBook,
  openSharedQuarantine,
  resetSharedQuarantineForTests,
  sharedQuarantineBook,
} from "../tools/fleet/quarantine.js";
import { SteeringQueue } from "../tools/fleet/queue.js";
import { makeActionRoutes } from "../tools/fleet/routes-actions.js";
import { createRateLimiter } from "../tools/fleet/routes-steer.js";
import { makeSendCoordinator, sharedSendCoordinator, type SendCoordinator } from "../tools/fleet/send-coordinator.js";
import type { FleetStatus } from "../tools/fleet/status.js";
import type { SteerResult, SteerTarget } from "../tools/fleet/steer.js";

const SESSION = "$97201";
const PANE = "%97201";
const CONVO = "9c1f5a8e-2b3d-4e0f-9a51-6b0dc2f3f1bb";

const TARGET: SteerTarget = { sessionId: SESSION, claudeSessionId: CONVO, paneId: PANE };
const IDLE: FleetStatus = { kind: "idle" };

/** A send that reached some of the sequence and not the end of it. */
const PARTIAL: SteerResult = {
  ok: false,
  reason: { code: "send-failed", why: "the second send-keys did not complete" },
  delivery: "partial",
  sent: [["send-keys", "-t", PANE, "-l", "--", "…"]],
};

/** A send the transport accounted for. Nothing is left unresolved by one. */
const DELIVERED: SteerResult = {
  ok: true,
  verified: { paneId: PANE, sessionId: SESSION, panePid: 4242, claudePid: 4243 },
  sent: [["send-keys", "-t", PANE, "-l", "--", "…"]],
};

const roots: string[] = [];
const ledgers: HoldLedger[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "s4b-restart-"));
  roots.push(root);
  return root;
}

/**
 * One whole composition, as `openSharedQuarantine` + `sharedSendCoordinator`
 * build one — a ledger, a book over it, and a coordinator over that.
 *
 * **THE TRANSPORT IS A COUNTER, AND IT IS THE ASSERTION THAT MATTERS.** A route
 * that answered a refusal and typed anyway would pass a weaker check; typing
 * anyway is the whole failure.
 */
function boot(dir: string, instance: string, fire: () => SteerResult): {
  book: QuarantineBook;
  send: SendCoordinator;
  ledger: HoldLedger;
  calls: () => number;
  down: () => void;
} {
  const result = openHoldLedger(dir);
  if (result.kind !== "open") throw new Error(`the ledger would not open: ${result.why}`);
  ledgers.push(result.ledger);
  let calls = 0;
  const book = new QuarantineBook({ now: () => Date.now(), serverInstanceId: instance, ledger: result.ledger });
  book.rehydrate();
  const send = makeSendCoordinator({
    book,
    sendMessage: () => {
      calls += 1;
      return fire();
    },
    answerQuestion: () => {
      calls += 1;
      return fire();
    },
  });
  return { book, send, ledger: result.ledger, calls: () => calls, down: () => result.ledger.close() };
}

const PURPOSE = {
  origin: "direct-steer",
  what: "message (42 characters)",
  onThrow: "hold",
  record: { kind: "book" },
} as const;

afterEach(() => {
  while (ledgers.length > 0) ledgers.pop()?.close();
  while (roots.length > 0) rmSync(roots.pop() ?? "", { recursive: true, force: true });
  resetSharedQuarantineForTests();
});

describe("a hold survives the process that recorded it", () => {
  it("comes back holding, with the id and version the page was looking at", () => {
    const dir = tempRoot();
    const first = boot(dir, "1a2b3c4d", () => PARTIAL);
    const attempt = first.send.message(TARGET, "x".repeat(42), IDLE, PURPOSE);
    expect(attempt.kind).toBe("answered");
    const before = first.book.holding(SESSION);
    expect(before).not.toBeNull();
    first.down();

    /* THE RESTART. Nothing from the first composition crosses this line — the
       ledger below is opened afresh over the same directory, and the book and
       coordinator are new objects with a new instance id. */
    const second = boot(dir, "0badcafe", () => PARTIAL);
    const after = second.book.holding(SESSION);
    expect(after).not.toBeNull();
    expect(after?.id).toBe(before?.id);
    expect(after?.version).toBe(before?.version);
    expect(after?.reading).toBe("partial");
    expect(after?.openedAt).toBe(before?.openedAt);
    expect(after?.basis).toEqual({ kind: "rehydrated-hold", recordedAt: expect.any(Number) });
  });

  it("reads it out of the FILE, not out of a shared object", () => {
    const dir = tempRoot();
    const first = boot(dir, "1a2b3c4d", () => PARTIAL);
    first.send.message(TARGET, "x".repeat(42), IDLE, PURPOSE);
    first.down();

    const lines = readFileSync(join(dir, LEDGER_FILE), "utf8").trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(2);
    // The attempt was written BEFORE the send and the hold after it, in that
    // order. The order is the guarantee: a crash between them leaves the first.
    expect(JSON.parse(lines[0] ?? "{}").kind).toBe("attempt");
    expect(JSON.parse(lines[lines.length - 1] ?? "{}").kind).toBe("held");
  });

  it("refuses a send to the rehydrated session — and the transport is not reached", () => {
    const dir = tempRoot();
    const first = boot(dir, "1a2b3c4d", () => PARTIAL);
    first.send.message(TARGET, "x".repeat(42), IDLE, PURPOSE);
    first.down();

    const second = boot(dir, "0badcafe", () => DELIVERED);
    const attempt = second.send.message(TARGET, "another sentence", IDLE, PURPOSE);
    expect(attempt.kind).toBe("held");
    expect(second.calls()).toBe(0);
  });

  it("both release gestures work on the rehydrated hold, and neither sends anything", () => {
    for (const gesture of ["operator-confirmed", "abandoned-unknown"] as const) {
      const dir = tempRoot();
      const first = boot(dir, "1a2b3c4d", () => PARTIAL);
      first.send.message(TARGET, "x".repeat(42), IDLE, PURPOSE);
      const opened = first.book.holding(SESSION);
      first.down();

      const second = boot(dir, "0badcafe", () => DELIVERED);
      const held = second.book.holding(SESSION);
      expect(held).not.toBeNull();
      const released = second.book.release({ holdId: held?.id ?? "", version: held?.version ?? 0, gesture });
      expect(released.ok).toBe(true);
      expect(second.book.holding(SESSION)).toBeNull();
      expect(second.calls()).toBe(0);
      // The id it answered is the one the FIRST run minted, which is the whole
      // of the Stage 2 tension: a queue id dies with its process, a hold id
      // names a fact about the world that outlived it.
      expect(held?.id).toBe(opened?.id);
      expect(held?.id.startsWith("1a2b3c4d-")).toBe(true);
      second.down();

      /* AND THE RELEASE IS DURABLE TOO. A gesture that cleared the hold in
         memory and left the ledger saying it was held would come back holding
         at the next restart, and the operator would have to release the same
         session for ever. */
      const third = boot(dir, "c0ffee00", () => DELIVERED);
      expect(third.book.holding(SESSION)).toBeNull();
    }
  });

  it("a version from before the restart still releases it — a phone in a pocket is answered", () => {
    const dir = tempRoot();
    const first = boot(dir, "1a2b3c4d", () => PARTIAL);
    first.send.message(TARGET, "x".repeat(42), IDLE, PURPOSE);
    const drawn = first.book.holding(SESSION);
    first.down();

    const second = boot(dir, "0badcafe", () => DELIVERED);
    const released = second.book.release({
      holdId: drawn?.id ?? "",
      version: drawn?.version ?? 0,
      gesture: "operator-confirmed",
    });
    expect(released.ok).toBe(true);
  });
});

describe("a send that was never accounted for", () => {
  /**
   * **THE WINDOW BETWEEN WRITING AND SENDING IS THE WHOLE POINT OF THE FILE.**
   *
   * A transport that throws with the drain's policy records no hold and settles
   * nothing — the lease is left open instead, which is memory and does not
   * survive a restart either. So the attempt line, written before the
   * keystrokes, is the only thing left, and it must come back as a hold.
   */
  it("comes back as a hold that says it does not know what happened", () => {
    const dir = tempRoot();
    const first = boot(dir, "1a2b3c4d", () => {
      throw new Error("tmux went away mid-sequence");
    });
    const attempt = first.send.message(TARGET, "x".repeat(42), IDLE, {
      ...PURPOSE,
      onThrow: "leave-the-lease-open",
    });
    expect(attempt.kind).toBe("threw");
    // Nothing was held in the first process: that is Stage 4's deliberate
    // choice, and it is what leaves the restart with only the ledger.
    expect(first.book.holding(SESSION)).toBeNull();
    first.down();

    const second = boot(dir, "0badcafe", () => DELIVERED);
    const held = second.book.holding(SESSION);
    expect(held).not.toBeNull();
    expect(held?.basis).toEqual({ kind: "rehydrated-attempt", attemptedAt: expect.any(Number) });
    /* IT KNOWS LESS THAN A LIVE HOLD, AND THE TYPE SAYS SO. No moment at which
       anything opened, no reading — because no process survived to take one. */
    expect(held?.openedAt).toBeNull();
    expect(held?.lastSendAt).toBeNull();
    expect(held?.reading).toBeNull();
    expect(held?.why).toContain("whether it was made at all");
    expect(second.calls()).toBe(0);
  });

  it("is releasable, with an id this run minted because no hold ever had one", () => {
    const dir = tempRoot();
    const first = boot(dir, "1a2b3c4d", () => {
      throw new Error("tmux went away mid-sequence");
    });
    first.send.message(TARGET, "x".repeat(42), IDLE, { ...PURPOSE, onThrow: "leave-the-lease-open" });
    first.down();

    const second = boot(dir, "0badcafe", () => DELIVERED);
    const held = second.book.holding(SESSION);
    expect(held?.id.startsWith("0badcafe-")).toBe(true);
    expect(second.book.idOrigin(held?.id ?? "")).toBe("this-instance");
    const released = second.book.release({
      holdId: held?.id ?? "",
      version: held?.version ?? 0,
      gesture: "abandoned-unknown",
    });
    expect(released.ok).toBe(true);
    expect(second.calls()).toBe(0);
  });

  it("a later send on it does not put an invented opening moment on disk", () => {
    const dir = tempRoot();
    const first = boot(dir, "1a2b3c4d", () => {
      throw new Error("tmux went away mid-sequence");
    });
    first.send.message(TARGET, "x".repeat(42), IDLE, { ...PURPOSE, onThrow: "leave-the-lease-open" });
    first.down();

    const second = boot(dir, "0badcafe", () => PARTIAL);
    /* The extend path, reached directly: the coordinator refuses to send to a
       held session, so nothing in production can get here — but the branch
       exists, and what it writes down would outlive everyone who could
       contradict it. */
    const extended = second.book.hold({
      sessionId: SESSION,
      paneId: PANE,
      claudeSessionId: CONVO,
      reading: "unknown",
      origin: "direct-steer",
      what: "message (9 characters)",
    });
    expect(extended.incidents).toBe(2);
    expect(extended.openedAt).toBeNull();
    second.down();

    const third = boot(dir, "c0ffee00", () => DELIVERED);
    const held = third.book.holding(SESSION);
    expect(held).not.toBeNull();
    // STILL HELD, and still saying it does not know when it opened — rather
    // than a `rehydrated-hold` whose `openedAt` was the later send's clock.
    expect(held?.basis.kind).toBe("rehydrated-attempt");
    expect(held?.openedAt).toBeNull();
  });

  it("a send that was accounted for leaves nothing behind", () => {
    const dir = tempRoot();
    const first = boot(dir, "1a2b3c4d", () => DELIVERED);
    first.send.message(TARGET, "x".repeat(42), IDLE, PURPOSE);
    first.down();

    const second = boot(dir, "0badcafe", () => DELIVERED);
    expect(second.book.holding(SESSION)).toBeNull();
    expect(second.book.heldSessions()).toEqual([]);
  });
});

describe("a tmux restart while the dashboard was down", () => {
  it("supersedes the rehydrated hold on the first generation that disagrees", () => {
    const dir = tempRoot();
    const first = boot(dir, "1a2b3c4d", () => PARTIAL);
    first.book.noteGeneration(990_001);
    first.send.message(TARGET, "x".repeat(42), IDLE, PURPOSE);
    first.down();

    const second = boot(dir, "0badcafe", () => DELIVERED);
    expect(second.book.holding(SESSION)).not.toBeNull();
    // A DIFFERENT TMUX SERVER: every pane went with the old one, so the input
    // box the hold was about no longer exists.
    expect(second.book.noteGeneration(990_002)).toBe(1);
    expect(second.book.holding(SESSION)).toBeNull();
    second.down();

    /* AND IT STAYS GONE. The supersession is written down, so the next start
       does not resurrect a hold over a pane that no longer exists. */
    const third = boot(dir, "c0ffee00", () => DELIVERED);
    expect(third.book.holding(SESSION)).toBeNull();
  });

  it("keeps holding when the tmux server is the same one", () => {
    const dir = tempRoot();
    const first = boot(dir, "1a2b3c4d", () => PARTIAL);
    first.book.noteGeneration(990_001);
    first.send.message(TARGET, "x".repeat(42), IDLE, PURPOSE);
    first.down();

    const second = boot(dir, "0badcafe", () => DELIVERED);
    expect(second.book.noteGeneration(990_001)).toBe(0);
    expect(second.book.holding(SESSION)).not.toBeNull();
  });
});

describe("the composition the server actually runs", () => {
  /**
   * **THE FUNCTION `server.ts` CALLS, DRIVEN HERE.**
   *
   * `health-wiring.ts`'s lesson: a test that assembles its own composition
   * proves the parts work and stays green if the server mounts a different one.
   * So this calls `openSharedQuarantine` itself, and the source guard below is
   * what says the server calls it, and calls it early enough.
   */
  it("rehydrates through openSharedQuarantine, before anything can be asked to type", () => {
    const dir = tempRoot();
    const seed = boot(dir, "1a2b3c4d", () => PARTIAL);
    seed.send.message(TARGET, "x".repeat(42), IDLE, PURPOSE);
    seed.down();

    const started = openSharedQuarantine({ dir, log: () => {} });
    expect(started.rehydrated.holds).toBe(1);
    expect(started.book).toBe(sharedQuarantineBook());
    expect(sharedQuarantineBook().holding(SESSION)).not.toBeNull();
    /* **AND IT IS THE BOOK THE REAL COORDINATOR SENDS THROUGH.** U6's lesson
       from Stage 4: every producer test injected its own book, so nothing asked
       *is it the same object?* — and a one-character change split the two
       compositions with the whole suite staying green. The ledger adds a third
       thing that can be joined to the wrong book, so it gets the same question.
       Nothing is sent: the coordinator is only asked which book it holds. */
    expect(sharedSendCoordinator().book()).toBe(started.book);
    // The operator is TOLD. A dashboard that came back holding a session and
    // said nothing is the same silence this stage is about.
    expect(started.lines.error.join(" ")).toContain("came back HELD");
  });

  it("refuses to start durably if the book was handed out first — the one case it throws in", () => {
    const dir = tempRoot();
    sharedQuarantineBook();
    expect(() => openSharedQuarantine({ dir, log: () => {} })).toThrow(/before its ledger was opened/);
  });

  it("server.ts opens the quarantine above the listener, not below it", () => {
    /* A SOURCE CHECK, because server.ts cannot be imported by a test without
       binding port 8787 — tests/fleet-health-wiring.test.ts makes the same move
       for the same reason. What it protects is an ORDER: a call that drifted
       below `createServer` would leave a window in which this process can be
       asked to type while it is still reading. */
    const source = readFileSync(fileURLToPath(new URL("../tools/fleet/server.ts", import.meta.url)), "utf8");
    const call = source.indexOf("openSharedQuarantine(");
    const listener = source.indexOf("createServer(handler)");
    expect(call).toBeGreaterThan(-1);
    expect(listener).toBeGreaterThan(-1);
    expect(call).toBeLessThan(listener);
    // And the lines it produces are printed rather than collected and dropped.
    expect(source).toMatch(/quarantine\.lines\.error/);
  });
});

/* ================================================================== *
 * THE OPERATOR'S WAY OUT, AFTER A RESTART.
 *
 * The book agreeing with itself is not evidence that the button works. These
 * go through the real route, because the id a rehydrated hold carries was
 * minted by a run this one is not — and until Stage 4b that was precisely the
 * shape the route refused as foreign.
 * ================================================================== */

const HOST = "100.90.80.70:8787";

function fakeRes(): { res: ServerResponse; seen: { status: number | null; body: string; done: Promise<void> } } {
  let settle: () => void = () => {};
  const seen = { status: null as number | null, body: "", done: Promise.resolve() };
  seen.done = new Promise<void>((r) => {
    settle = r;
  });
  const res = {
    writeHead(status: number) {
      seen.status = status;
      return res;
    },
    end(chunk?: string) {
      seen.body = chunk ?? "";
      settle();
      return res;
    },
  };
  return { res: res as unknown as ServerResponse, seen };
}

function fakeReq(url: string, body: unknown): IncomingMessage {
  const stream = new PassThrough();
  stream.write(JSON.stringify(body));
  stream.end();
  return Object.assign(stream, {
    url,
    method: "POST",
    headers: { host: HOST, origin: `http://${HOST}`, "content-type": "application/json" },
    socket: { remoteAddress: "100.90.80.71" },
  }) as unknown as IncomingMessage;
}

async function releaseThrough(
  routes: ReturnType<typeof makeActionRoutes>,
  body: Record<string, unknown>,
): Promise<{ status: number | null; json: Record<string, unknown> }> {
  const { res, seen } = fakeRes();
  expect(routes.handle(fakeReq("/api/actions/hold/release", body), res)).toBe(true);
  await seen.done;
  return { status: seen.status, json: seen.body === "" ? {} : (JSON.parse(seen.body) as Record<string, unknown>) };
}

/** The action routes over a book that has just come back from the ledger. */
function routesOver(book: QuarantineBook, send: SendCoordinator): ReturnType<typeof makeActionRoutes> {
  return makeActionRoutes({
    queue: new SteeringQueue({ now: () => Date.now(), serverInstanceId: book.serverInstanceId, quarantine: book }),
    send,
    now: () => Date.now(),
    limiter: createRateLimiter({ minIntervalMs: 0, burstMax: 1_000, burstWindowMs: 1 }),
    log: () => {},
    actEnabled: () => true,
    yieldToLoop: () => Promise.resolve(),
  });
}

describe("POST /api/actions/hold/release, on a hold from the previous run", () => {
  it("answers a foreign id it is actually holding, rather than refusing it as another run's", async () => {
    const dir = tempRoot();
    const first = boot(dir, "1a2b3c4d", () => PARTIAL);
    first.send.message(TARGET, "x".repeat(42), IDLE, PURPOSE);
    const drawn = first.book.holding(SESSION);
    first.down();

    const second = boot(dir, "0badcafe", () => DELIVERED);
    const routes = routesOver(second.book, second.send);
    expect(second.book.idOrigin(drawn?.id ?? "")).toBe("other-instance");

    const r = await releaseThrough(routes, {
      holdId: drawn?.id,
      version: drawn?.version,
      gesture: "operator-confirmed",
    });
    expect(r.status).toBe(200);
    expect(r.json.op).toBe("hold-released");
    expect(second.book.holding(SESSION)).toBeNull();
    expect(second.calls()).toBe(0);
  });

  it("still refuses a foreign id it is NOT holding — the Stage 2 rule where it still applies", async () => {
    const dir = tempRoot();
    const second = boot(dir, "0badcafe", () => DELIVERED);
    const routes = routesOver(second.book, second.send);
    const r = await releaseThrough(routes, { holdId: "1a2b3c4d-h9", version: 1, gesture: "abandoned-unknown" });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("other-instance");
    // AND THE SENTENCE NO LONGER SAYS HOLDS DO NOT SURVIVE A RESTART, because
    // they do now, and a refusal that explains itself with a false rule sends
    // somebody to look in the wrong place.
    expect(String(r.json.why)).not.toContain("do not survive");
    expect(String(r.json.why)).toContain("carried forward");
  });
});
