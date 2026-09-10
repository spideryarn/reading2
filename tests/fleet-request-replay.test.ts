/**
 * Request ids and replay on the three write routes — plan 260910d, Stage 2.
 *
 * **NO TRANSPORT HERE REACHES TMUX.** Every send goes through an injected fake
 * that counts; the fixture handles (`$97701`, `%97701`) are fictional. The
 * receipt journal is a real one on a temporary disk, because a memory journal
 * refuses every keyed accept by design (a key promises durability).
 *
 * "One effect" means one transport call for the two steer routes and one queue
 * item for the session route.
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { classifyGate, type PaneOption } from "../tools/fleet/pane.js";
import { QuarantineBook } from "../tools/fleet/quarantine.js";
import { SteeringQueue } from "../tools/fleet/queue.js";
import { openReceiptJournal, RETENTION_MS, type AcceptReceiptInput, type ReceiptJournal } from "../tools/fleet/receipt-journal.js";
import { requestFingerprint, type RequestRoute } from "../tools/fleet/request-key.js";
import { makeActionRoutes } from "../tools/fleet/routes-actions.js";
import { createRateLimiter, makeSteerRoutes, type RateLimiter } from "../tools/fleet/routes-steer.js";
import { makeSendCoordinator } from "../tools/fleet/send-coordinator.js";
import type { SeenQuestion, SteerResult, SteerTarget } from "../tools/fleet/steer.js";
import { releaseLock, takeLock, type HeldLock } from "../tools/overseer/lock.js";
import { FrozenDisk } from "./helpers/fleet-frozen-disk.js";

const NOW = 1_800_300_000_000;
const HOST = "100.90.80.70:8787";
const ORIGIN = `http://${HOST}`;
const SESSION = "$97701";
const PANE = "%97701";
const PANE_PID = 977_010;
const RUN = "a7a7a7a7";
const CONVERSATION = randomUUID();
const TEXT = "the words of this replay fixture";

const OPTIONS: PaneOption[] = [
  { label: "Yes, proceed", key: { via: "selected" }, consequence: "once" },
  { label: "No, exit", key: { via: "arrows", key: "Down", presses: 1 }, consequence: "decline" },
];
const SEEN: SeenQuestion = {
  kind: "question",
  prompt: "Which of these shall I do?",
  material: { kind: "no-material" },
  options: OPTIONS,
  gate: classifyGate({ kind: "no-material" }, OPTIONS),
};

const roots: string[] = [];
const locks: Array<{ lock: HeldLock; path: string }> = [];
afterEach(() => {
  while (locks.length > 0) {
    const entry = locks.pop();
    if (entry !== undefined) releaseLock(entry.lock, entry.path);
  }
  while (roots.length > 0) rmSync(roots.pop() ?? "", { recursive: true, force: true });
});

function freshId(mintedAt: number = NOW): string {
  return `rq-${mintedAt.toString(36)}-${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

function diskJournal(disk: FrozenDisk): ReceiptJournal {
  const dir = mkdtempSync(join(tmpdir(), "fleet-request-replay-"));
  roots.push(dir);
  const path = join(dir, "writer.lock");
  const taken = takeLock(path, () => new Date(NOW));
  if (!taken.ok) throw new Error("could not take the test writer lock");
  locks.push({ lock: taken.lock, path });
  const opened = openReceiptJournal(dir, {
    lock: { held: taken.lock, lockedOutBy: null },
    now: () => NOW,
    serverInstanceId: RUN,
    writeLine: disk.writer("receipts"),
  });
  if (opened.kind !== "open") throw new Error(opened.why);
  return opened.journal;
}

const OK = (target: SteerTarget): SteerResult => ({
  ok: true,
  verified: { paneId: target.paneId, sessionId: target.sessionId, panePid: PANE_PID, claudePid: PANE_PID + 1 },
  sent: [["send-keys", "-t", target.paneId, "-l", "--", "fixture"], ["send-keys", "-t", target.paneId, "Enter"]],
});

type Res = { status: number | null; json: Record<string, unknown> };

/**
 * The three Stage 2 routes this file drives. The two Stage 3 routes that take
 * a `requestId` — `actions-box` and `broadcast` — are driven by
 * tests/fleet-enacted-receipts.test.ts and tests/fleet-broadcast-receipts.test.ts.
 */
type ReplayRoute = Extract<RequestRoute, "steer-message" | "steer-answer" | "actions-session">;

function bodyFor(route: ReplayRoute, variant: "original" | "altered" = "original"): Record<string, unknown> {
  const target = { paneId: PANE, sessionId: SESSION, claudeSessionId: CONVERSATION, panePid: PANE_PID };
  switch (route) {
    case "steer-message":
      return { ...target, status: { kind: "idle" }, speaker: "greg", text: variant === "original" ? TEXT : `${TEXT}, altered` };
    case "steer-answer":
      return { ...target, status: { kind: "needs-you" }, question: SEEN, optionIndex: variant === "original" ? 0 : 1 };
    case "actions-session":
      return { ...target, status: { kind: "idle" }, mode: "enqueue", speaker: "greg", text: variant === "original" ? TEXT : `${TEXT}, altered` };
    default: {
      const never: never = route;
      throw new Error(`no body for ${String(never)}`);
    }
  }
}

/** A body today's parse refuses — a speaker, an index or an action this build does not know. */
function retiredBody(route: ReplayRoute): Record<string, unknown> {
  switch (route) {
    case "steer-message":
      return { ...bodyFor(route), speaker: "a-speaker-this-build-refuses" };
    case "steer-answer":
      return { ...bodyFor(route), optionIndex: -1 };
    case "actions-session": {
      const { text: _text, ...rest } = bodyFor(route);
      return { ...rest, actionId: "an-action-retired-from-the-catalogue" };
    }
    default: {
      const never: never = route;
      throw new Error(`no body for ${String(never)}`);
    }
  }
}

const URL: Record<ReplayRoute, string> = {
  "steer-message": "/api/steer/message",
  "steer-answer": "/api/steer/answer",
  "actions-session": "/api/actions/session",
};

function world(
  route: ReplayRoute,
  options: { disk?: FrozenDisk; limiter?: RateLimiter; result?: (target: SteerTarget) => SteerResult } = {},
) {
  const disk = options.disk ?? new FrozenDisk();
  const receipts = diskJournal(disk);
  const book = new QuarantineBook({ now: () => NOW, serverInstanceId: RUN });
  let transportCalls = 0;
  const give = (target: SteerTarget): SteerResult => {
    transportCalls += 1;
    return (options.result ?? OK)(target);
  };
  const send = makeSendCoordinator({
    book,
    sendMessage: (target) => give(target),
    answerQuestion: (target) => give(target),
  });
  const limiter = options.limiter ?? createRateLimiter({ minIntervalMs: 0, burstMax: 1_000, burstWindowMs: 1 });
  let handle: (req: IncomingMessage, res: ServerResponse) => boolean;
  let queue: SteeringQueue | null = null;
  if (route === "actions-session") {
    queue = new SteeringQueue({ now: () => NOW, serverInstanceId: RUN, quarantine: book, receipts });
    const routes = makeActionRoutes({
      serverInstanceId: RUN,
      queue,
      send,
      now: () => NOW,
      limiter,
      log: () => {},
      actEnabled: () => false,
      primaryDir: () => "/nonexistent/fixture-checkout",
    });
    handle = (req, res) => routes.handle(req, res);
  } else {
    const routes = makeSteerRoutes({ send, receipts, now: () => NOW, limiter, log: () => {}, answeringEnabled: () => true });
    handle = (req, res) => routes.handle(req, res);
  }

  async function post(body: Record<string, unknown>): Promise<Res> {
    const stream = new PassThrough();
    stream.write(JSON.stringify(body));
    stream.end();
    const req = Object.assign(stream, {
      url: URL[route],
      method: "POST",
      headers: { host: HOST, origin: ORIGIN, "content-type": "application/json" },
      socket: { remoteAddress: "100.90.80.71" },
    }) as unknown as IncomingMessage;
    let finish: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const seen: { status: number | null; body: string } = { status: null, body: "" };
    const res = {
      writeHead(status: number) {
        seen.status = status;
        return res;
      },
      end(chunk?: string) {
        seen.body = chunk ?? "";
        finish();
        return res;
      },
    } as unknown as ServerResponse;
    expect(handle(req, res)).toBe(true);
    await done;
    return { status: seen.status, json: seen.body === "" ? {} : (JSON.parse(seen.body) as Record<string, unknown>) };
  }

  return {
    post,
    receipts,
    book,
    effects: (): number => (queue === null ? transportCalls : queue.totalSize()),
    transportCalls: (): number => transportCalls,
  };
}

const ROUTES: ReplayRoute[] = ["steer-message", "steer-answer", "actions-session"];

describe.each(ROUTES)("a keyed request on %s", (route) => {
  it("the same id and body twice has one effect and returns one receipt twice", async () => {
    const w = world(route);
    const requestId = freshId();
    const first = await w.post({ ...bodyFor(route), requestId });
    expect(first.status).toBe(200);
    expect(typeof first.json.receiptId).toBe("string");
    expect(w.effects()).toBe(1);

    const second = await w.post({ ...bodyFor(route), requestId });
    expect(second.status).toBe(200);
    expect(second.json).toMatchObject({ ok: true, op: "receipt", replay: true });
    const receipt = second.json.receipt as Record<string, unknown>;
    expect(receipt.receiptId).toBe(first.json.receiptId);
    // Still pending for queued work that has not been delivered; a direct send is already over.
    if (route === "actions-session") expect(receipt).toMatchObject({ state: "accepted", pending: true });
    else expect(receipt).toMatchObject({ state: "keys-submitted", pending: false });
    expect(JSON.stringify(second.json)).not.toContain(TEXT);

    const third = await w.post({ ...bodyFor(route), requestId });
    expect(third.json).toEqual(second.json);
    expect(w.effects()).toBe(1);
    expect(w.transportCalls()).toBe(route === "actions-session" ? 0 : 1);
  });

  it("the same id with a different body is a 409 conflict and has no effect", async () => {
    const w = world(route);
    const requestId = freshId();
    expect((await w.post({ ...bodyFor(route), requestId })).status).toBe(200);
    const conflict = await w.post({ ...bodyFor(route, "altered"), requestId });
    expect(conflict.status).toBe(409);
    expect(conflict.json.code).toBe("request-id-conflict");
    expect(w.effects()).toBe(1);
  });

  it("a present but malformed id is a 400, never downgraded to unkeyed", async () => {
    const w = world(route);
    for (const requestId of ["rq-not-a-request-id", null, 17]) {
      const refused = await w.post({ ...bodyFor(route), requestId });
      expect(refused.status).toBe(400);
      expect(refused.json.code).toBe("bad-request-id");
    }
    expect(w.effects()).toBe(0);
    expect(w.receipts.recent(10)).toEqual([]);
  });

  it("an old id this journal no longer holds is refused as expired", async () => {
    const w = world(route);
    const refused = await w.post({ ...bodyFor(route), requestId: freshId(NOW - RETENTION_MS - 2 * 60 * 60 * 1_000) });
    expect(refused.status).toBe(409);
    expect(refused.json.code).toBe("request-id-expired");
    expect(String(refused.json.why)).toMatch(/may already have been acted on/);
    expect(w.effects()).toBe(0);
  });

  it("a replay is answered before the rate limiter", async () => {
    const w = world(route, { limiter: createRateLimiter({ minIntervalMs: 10 * 60 * 1_000, burstMax: 1_000, burstWindowMs: 1 }) });
    const requestId = freshId();
    expect((await w.post({ ...bodyFor(route), requestId })).status).toBe(200);
    // The control: a fresh request is refused by the limiter right now.
    const limited = await w.post({ ...bodyFor(route, "altered"), requestId: freshId() });
    expect(limited.status).toBe(429);
    const replay = await w.post({ ...bodyFor(route), requestId });
    expect(replay.status).toBe(200);
    expect(replay.json).toMatchObject({ op: "receipt", replay: true });
    expect(w.effects()).toBe(1);
  });

  it("a replay is answered before today's parse and catalogue", async () => {
    const w = world(route);
    const body = retiredBody(route);
    // The control: without a key, this build refuses the body outright.
    expect((await w.post(body)).status).toBe(400);
    const requestId = freshId();
    const seeded: AcceptReceiptInput = {
      requestId,
      fingerprint: requestFingerprint(route, body),
      op: route === "steer-message" ? "steer-message" : route === "steer-answer" ? "steer-answer" : "queued-action",
      origin: route === "actions-session" ? "enqueue" : "direct-steer",
      actor: route === "steer-answer" ? { kind: "unattributed-http", id: null } : { kind: "client-claimed", id: "greg" },
      speaker: route === "steer-answer" ? null : "greg",
      target: { sessionId: SESSION, paneId: PANE, claudeSessionId: CONVERSATION, tmuxGeneration: null },
      what: "accepted by an earlier build",
      queue: route === "actions-session" ? { itemId: `${RUN}-q900`, enqueuedAt: NOW - 1_000 } : null,
    };
    const accepted = w.receipts.accept(seeded);
    if (!accepted.ok) throw new Error(accepted.why);

    const replay = await w.post({ ...body, requestId });
    expect(replay.status).toBe(200);
    expect(replay.json).toMatchObject({ op: "receipt", replay: true, receipt: { receiptId: accepted.receiptId } });
    expect(w.effects()).toBe(0);
  });

  it("a keyed accept that cannot land is a 503 with no effect", async () => {
    const disk = new FrozenDisk();
    const w = world(route, { disk });
    disk.arm({ store: "receipts", kind: "accepted", mode: "throw" });
    const refused = await w.post({ ...bodyFor(route), requestId: freshId() });
    expect(refused.status).toBe(503);
    expect(refused.json.code).toBe("receipt-unavailable");
    expect(w.effects()).toBe(0);
    expect(w.transportCalls()).toBe(0);
    expect(w.receipts.recent(10)).toEqual([]);
  });
});

describe.each(["steer-message", "steer-answer"] as const)("a direct send on %s", (route) => {
  it("does not type when a durably accepted receipt's attempted cannot land", async () => {
    const disk = new FrozenDisk();
    const w = world(route, { disk });
    disk.arm({ store: "receipts", kind: "attempted", mode: "throw" });
    const refused = await w.post({ ...bodyFor(route), requestId: freshId() });
    expect(refused.status).toBe(503);
    expect(refused.json.code).toBe("receipt-unavailable");
    expect(typeof refused.json.receiptId).toBe("string");
    expect(w.transportCalls()).toBe(0);
    expect(w.receipts.get(String(refused.json.receiptId))?.last).toMatchObject({
      kind: "outcome",
      state: "not-sent",
      reason: "attempt-not-recorded",
    });
  });

  it("records who asked, what, and where, and never the words", async () => {
    const w = world(route);
    w.receipts.noteGeneration(4_242);
    expect((await w.post(bodyFor(route))).status).toBe(200);
    const [receipt] = w.receipts.recent(1);
    expect(receipt?.accepted).toMatchObject({
      requestId: null,
      fingerprint: null,
      op: route,
      origin: "direct-steer",
      actor: route === "steer-message" ? { kind: "client-claimed", id: "greg" } : { kind: "unattributed-http", id: null },
      speaker: route === "steer-message" ? "greg" : null,
      target: { sessionId: SESSION, paneId: PANE, claudeSessionId: CONVERSATION, tmuxGeneration: 4_242 },
      queue: null,
    });
    expect(receipt?.last).toMatchObject({ kind: "outcome", state: "keys-submitted", reason: "transport-ok" });
    expect(JSON.stringify(receipt)).not.toContain(TEXT);
  });
});

describe("direct-send outcomes, read off the coordinator", () => {
  it("a transport refusal that sent nothing is not-sent with the refusal's code", async () => {
    const w = world("steer-message", {
      result: () => ({ ok: false, reason: { code: "pane-gone", why: "gone" }, delivery: "none", sent: [] }),
    });
    await w.post(bodyFor("steer-message"));
    expect(w.receipts.recent(1)[0]?.last).toMatchObject({ state: "not-sent", reason: "transport-refused-unsent", code: "pane-gone" });
  });

  it("a partial send is outcome-unknown with the hold's reading, and the next send to the held session is not-sent", async () => {
    const w = world("steer-message", {
      result: (target) => ({
        ok: false,
        reason: { code: "send-partial", why: "the Enter did not land" },
        delivery: "partial",
        sent: [["send-keys", "-t", target.paneId, "-l", "--", "fixture"]],
      }),
    });
    await w.post(bodyFor("steer-message"));
    expect(w.receipts.recent(1)[0]?.last).toMatchObject({ state: "outcome-unknown", reason: "partial", code: "send-partial" });
    const held = await w.post(bodyFor("steer-message", "altered"));
    expect(held.status).toBe(409);
    expect(w.transportCalls()).toBe(1);
    const latest = w.receipts.recent(2).find((state) => state.last.kind === "outcome" && state.last.reason === "session-held");
    expect(latest?.last).toMatchObject({ state: "not-sent", reason: "session-held" });
  });

  it("a transport that throws is outcome-unknown, threw", async () => {
    const w = world("steer-message", {
      result: () => {
        throw new Error("the fake transport fell over");
      },
    });
    expect((await w.post(bodyFor("steer-message"))).status).toBe(500);
    expect(w.receipts.recent(1)[0]?.last).toMatchObject({ state: "outcome-unknown", reason: "threw" });
  });
});
