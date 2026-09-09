/**
 * **The join between the two mounted route families, which nothing tested.**
 *
 * Stage 4's guarantee is one sentence: a session that may be holding half a
 * message is not handed the next one. That sentence is only true if the direct
 * steer route, the broadcast and the drain are all looking at **one** quarantine
 * book. Every producer test injects a book of its own — rightly, because a
 * module-level singleton written to by every test in a file is the shape that
 * passes alone and fails in a batch — and the consequence is that all of them
 * would go on passing if the real compositions came apart.
 *
 * They could. A review of the landed stage showed that changing one `??=` to `=`
 * in `quarantine.ts` gives `handleSteerRequest` and the action queue different
 * books — direct uncertainty recorded where the drain never looks — **with the
 * whole suite green**. That disproved a claim written into the stage's own
 * commit message and repeated to two other sessions: that a producer without a
 * hold makes a test red. The producer tests enumerate today's producers; they do
 * not require tomorrow's, and they do not require the real wiring at all.
 *
 * So this file asks the only question they cannot: **is it the same object?** —
 * once by identity, and once by driving an ambiguous send through one family and
 * reading the hold back out of the other.
 *
 * NOTHING HERE SENDS A KEYSTROKE. The transport is faked at the coordinator, the
 * tmux ids are fictional, and the only real thing is the wiring.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { QuarantineBook, sharedQuarantineBook } from "../tools/fleet/quarantine.js";
import { makeActionRoutes, realActionDeps } from "../tools/fleet/routes-actions.js";
import { createRateLimiter, makeSteerRoutes, realSteerDeps } from "../tools/fleet/routes-steer.js";
import { makeSendCoordinator, sharedSendCoordinator } from "../tools/fleet/send-coordinator.js";
import type { SteerResult } from "../tools/fleet/steer.js";

const SESSION = "$96001";
const PANE = "%96001";
const CONVO = "3f0c9b21-77aa-4c31-8e55-1d2b4a6f9e07";

const HOST = "100.90.80.70:8787";

/** A send that came back with the text in the box and no Enter behind it. */
const PARTIAL: SteerResult = {
  ok: false,
  reason: { code: "send-failed", why: "the second send-keys did not complete" },
  delivery: "partial",
  sent: [["send-keys", "-t", PANE, "-l", "--", "…"]],
};

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

function fakeReq(url: string, body: unknown, method = "POST"): IncomingMessage {
  const stream = new PassThrough();
  if (method !== "GET") stream.write(JSON.stringify(body));
  stream.end();
  return Object.assign(stream, {
    url,
    method,
    headers: { host: HOST, origin: `http://${HOST}`, "content-type": "application/json" },
    socket: { remoteAddress: "100.90.80.71" },
  }) as unknown as IncomingMessage;
}

async function post(handle: (req: IncomingMessage, res: ServerResponse) => boolean, req: IncomingMessage) {
  const { res, seen } = fakeRes();
  expect(handle(req, res)).toBe(true);
  await seen.done;
  return { status: seen.status, json: seen.body === "" ? {} : (JSON.parse(seen.body) as Record<string, unknown>) };
}

describe("there is one quarantine book in this process", () => {
  it("hands back the same object twice", () => {
    // THE MUTATION THIS CATCHES IS ONE CHARACTER: `shared ??=` to `shared =`.
    // It is not an interesting bug on its own; it is the cheapest possible
    // demonstration that the property is asserted somewhere at all.
    expect(sharedQuarantineBook()).toBe(sharedQuarantineBook());
  });

  it("is the book BOTH real compositions reach, by identity", () => {
    // Not "a book each". The steering route reaches it through the shared send
    // coordinator; the action routes reach it twice over, once for the queue
    // that `next()` asks and once for the coordinator the broadcast sends
    // through. Three paths, one object.
    const shared = sharedQuarantineBook();
    expect(realSteerDeps().send.book()).toBe(shared);
    expect(realActionDeps().send.book()).toBe(shared);
    expect(realActionDeps().queue.quarantineBook()).toBe(shared);
    expect(sharedSendCoordinator().book()).toBe(shared);
  });

  it("refuses to build action routes whose queue and coordinator disagree", () => {
    // THE GUARD ITSELF, driven. Two books here is exactly what the `??=`
    // mutation produces in production, and the routes must not come up at all
    // rather than come up half-right — because half-right means the page says
    // one thing and the drain does another.
    const other = makeSendCoordinator({
      book: new QuarantineBook({ now: () => 1_700_000_000_000, serverInstanceId: "0badcafe" }),
      sendMessage: () => PARTIAL,
      answerQuestion: () => PARTIAL,
    });
    expect(() => makeActionRoutes({ send: other })).toThrow(/two different quarantine books/i);
  });
});

describe("a hold opened by the direct steer route is visible to the action catalogue", () => {
  it("crosses the seam the producer tests cannot", async () => {
    /* THE END-TO-END HALF, and it is the one that would have caught the `??=`
       mutation even if somebody deleted the identity assertions above.

       The steering route is built with the REAL composition's book —
       `realSteerDeps().send.book()`, asserted above to be the shared one — and
       only its transport is replaced, because there are ~37 live agent sessions
       on this box and a test run is not a reason to type into one. The action
       routes are left entirely alone: their queue finds its book the way
       production does. So if the two ever stop being one object, the hold this
       records goes somewhere the catalogue cannot see, and the last expectation
       below fails. */
    const shared = sharedQuarantineBook();
    const steer = makeSteerRoutes({
      send: makeSendCoordinator({ book: shared, sendMessage: () => PARTIAL, answerQuestion: () => PARTIAL }),
      log: () => {},
      limiter: createRateLimiter({ minIntervalMs: 0, burstMax: 1_000, burstWindowMs: 1 }),
    });

    const sent = await post(
      steer.handle,
      fakeReq("/api/steer/message", {
        paneId: PANE,
        sessionId: SESSION,
        claudeSessionId: CONVO,
        panePid: 424242,
        status: { kind: "idle" },
        text: "have a look at the failing test before you push",
        speaker: "greg",
      }),
    );
    expect(sent.json.delivery).toBe("partial");

    // THE ACTION ROUTES, BUILT THE WAY PRODUCTION BUILDS THEM. Nothing about
    // the book is passed in.
    const actions = makeActionRoutes({ log: () => {} });
    const cat = await post(actions.handle, fakeReq("/api/actions", undefined, "GET"));
    const queues = cat.json.queues as { sessionId: string; quarantine: { id: string; why: string } | null }[];
    const held = queues.find((x) => x.sessionId === SESSION);

    expect(held, "the hold the steer route opened must reach the action catalogue").toBeDefined();
    expect(held?.quarantine?.id).toBe(shared.holding(SESSION)?.id);
    expect(held?.quarantine?.why ?? "").toMatch(/input box/i);

    // Left clean, because this file is the one place that writes to the
    // process-wide book and another file's test must not inherit a held
    // session.
    const open = shared.holding(SESSION);
    if (open !== null) shared.release({ holdId: open.id, version: open.version, gesture: "abandoned-unknown" });
    expect(shared.holding(SESSION)).toBeNull();
  });
});
