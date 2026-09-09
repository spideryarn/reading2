/**
 * **ONE LINE TO EVERY AGENT ON THE BOX**, and the several ways that is refused.
 *
 * > there should be a way to send messages directly to the Overseer in the
 * > Overseer tab, and also to broadcast to all agents
 * >
 * > — Greg, 2026-09-08
 *
 * ## What this suite is really guarding
 *
 * A broadcast is the most expensive thing this dashboard can do. Every line it
 * delivers is a turn of a paid model and costs that agent its context, and it
 * does that N times at once. So the failures worth catching are not "it did not
 * send" — they are:
 *
 *  - **it reached a third of the fleet and called itself a broadcast to all
 *    agents**, because most sessions on this box are working most of the time;
 *  - **it sent and said it had not**, or the reverse;
 *  - **it left half a sentence in somebody's input box and nothing recorded
 *    it**, so the queue drained the next item onto the end of it;
 *  - **it held the server's single thread** for minutes while the page, the SSE
 *    stream and every other route answered nothing.
 *
 * Each of those has a test below, and none of them is a happy path.
 *
 * ## The shape under test, which changed once and is the interesting part
 *
 * A recipient is an OUTER scheduling arm — `would-send`, `would-queue`,
 * `attempted`, `queued`, `skipped`, `not-reached` — and only `attempted`
 * carries a delivery reading, embedded as the steer route's own response body.
 * The first version folded *working*, *dry run* and *deadline* into
 * `{ok:false, code, delivery:"none"}`, which invented a second delivery
 * vocabulary while claiming to reuse the first. Several assertions here exist
 * to keep those two halves apart.
 *
 * ## NOTHING HERE TOUCHES TMUX
 *
 * `sendMessage` and the queue door are both injected and every test uses a
 * fake. There are live agent sessions on this box doing real work; a suite is
 * not a reason to type into one. The delivery module has its own live-fire
 * evidence and this must not repeat it.
 */
import { PassThrough } from "node:stream";

import { beforeEach, describe, expect, it } from "vitest";

import { QuarantineBook } from "../tools/fleet/quarantine.js";
import { enqueueSharedMessage } from "../tools/fleet/routes-actions.js";
import { makeBroadcastRoutes, type BroadcastDeps, type BroadcastRecipient } from "../tools/fleet/routes-broadcast.js";
import type { FleetStatus } from "../tools/fleet/status.js";
import type { SteerResult, SteerTarget } from "../tools/fleet/steer.js";

const HOST = "box.tail1234.ts.net:8787";
const ORIGIN = `http://${HOST}`;

type FakeRes = { status: number | null; headers: Record<string, string>; body: string; done: Promise<void> };

function fakeRes(): { res: import("node:http").ServerResponse; seen: FakeRes } {
  let settle: () => void = () => {};
  const seen: FakeRes = {
    status: null,
    headers: {},
    body: "",
    done: new Promise<void>((r) => {
      settle = r;
    }),
  };
  const res = {
    writeHead(status: number, headers: Record<string, string>) {
      seen.status = status;
      seen.headers = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
      return res;
    },
    end(chunk?: string) {
      seen.body = chunk ?? "";
      settle();
      return res;
    },
  };
  return { res: res as unknown as import("node:http").ServerResponse, seen };
}

function fakeReq(opts: { url?: string; method?: string; headers?: Record<string, string>; body?: unknown }) {
  const stream = new PassThrough();
  const body = opts.body === undefined ? "" : JSON.stringify(opts.body);
  if (body !== "") stream.write(body);
  stream.end();
  return Object.assign(stream, {
    url: opts.url ?? "/api/broadcast",
    method: opts.method ?? "POST",
    headers: { host: HOST, origin: ORIGIN, "content-type": "application/json", ...opts.headers },
    socket: { remoteAddress: "100.90.80.71" },
  }) as unknown as import("node:http").IncomingMessage;
}

/** One recipient as the page sends it: the row's own claims, verbatim. */
function recipient(over: { id: string; pane?: string; status?: FleetStatus }) {
  return {
    sessionId: over.id,
    paneId: over.pane ?? `%${over.id.slice(1)}`,
    claudeSessionId: "117e181a-155b-435a-b95b-e74220678d1a",
    panePid: 4242,
    status: over.status ?? ({ kind: "idle" } as FleetStatus),
  };
}

const WORKING: FleetStatus = { kind: "working" };
const SHELL: FleetStatus = { kind: "shell", busy: false };

const OK: SteerResult = {
  ok: true,
  verified: { paneId: "%1", sessionId: "$1", panePid: 4242, claudePid: 5150 },
  sent: [["tmux", "send-keys", "-t", "%1", "-l", "--", "x"]],
};

type Sent = { target: SteerTarget; text: string; declaredStatus: FleetStatus };
type Queued = { sessionId: string; text: string; speaker: string };

function harness(over: Partial<BroadcastDeps> = {}) {
  const calls: Sent[] = [];
  const queued: Queued[] = [];
  const log: string[] = [];
  let clock = 1_000_000;
  const quarantine = new QuarantineBook({ now: () => clock, serverInstanceId: "test-instance" });
  const deps: Partial<BroadcastDeps> = {
    sendMessage: (target, text, declaredStatus) => {
      calls.push({ target, text, declaredStatus });
      return OK;
    },
    now: () => clock,
    log: (line) => log.push(line),
    quarantine,
    enqueue: (target, text, speaker) => {
      queued.push({ sessionId: target.sessionId, text, speaker });
      return { ok: true, position: queued.length };
    },
    runEnabled: () => true,
    // Synchronous in tests: the point of the seam is that the DEADLINE can be
    // driven by moving the clock, not by actually waiting.
    yieldToLoop: () => Promise.resolve(),
    ...over,
  };
  return {
    calls,
    queued,
    log,
    quarantine,
    routes: makeBroadcastRoutes(deps),
    tick: (ms: number) => {
      clock += ms;
    },
    at: () => clock,
  };
}

async function post(
  routes: ReturnType<typeof harness>["routes"],
  body: unknown,
  opts: { headers?: Record<string, string>; url?: string; method?: string } = {},
): Promise<FakeRes & { json: Record<string, unknown> }> {
  const { res, seen } = fakeRes();
  const handled = routes.handle(fakeReq({ body, ...opts }), res);
  expect(handled).toBe(true);
  await seen.done;
  return { ...seen, json: seen.body === "" ? {} : (JSON.parse(seen.body) as Record<string, unknown>) };
}

const TEXT = "ease off on the test suites for twenty minutes";

function run(over: Record<string, unknown> = {}) {
  return {
    text: TEXT,
    speaker: "greg",
    mode: "run",
    confirm: true,
    recipients: [recipient({ id: "$1" }), recipient({ id: "$2" })],
    ...over,
  };
}

type Result = { counts: Record<string, number>; recipients: BroadcastRecipient[]; sample?: string };

function result(json: Record<string, unknown>): Result {
  return (json["result"] ?? { counts: {}, recipients: [] }) as Result;
}

function rows(json: Record<string, unknown>): BroadcastRecipient[] {
  return result(json).recipients;
}

function row(json: Record<string, unknown>, sessionId: string): BroadcastRecipient {
  const found = rows(json).find((r) => r.sessionId === sessionId);
  if (found === undefined) throw new Error(`no recipient ${sessionId} in ${JSON.stringify(rows(json))}`);
  return found;
}

/** Narrow to the arm, so a test asserting on a field proves the arm too. */
function attempt(r: BroadcastRecipient) {
  if (r.kind !== "attempted") throw new Error(`expected an attempted send, got ${r.kind}`);
  return r.attempt;
}

let h: ReturnType<typeof harness>;
beforeEach(() => {
  h = harness();
});

describe("the door", () => {
  it("is POST only", async () => {
    const r = await post(h.routes, undefined, { method: "GET" });
    expect(r.status).toBe(405);
    expect(h.calls).toHaveLength(0);
  });

  it("refuses a cross-origin post before reading the body", async () => {
    const r = await post(h.routes, run(), { headers: { origin: "http://evil.example" } });
    expect(r.status).toBe(403);
    expect(h.calls).toHaveLength(0);
  });

  it("refuses a body that is not json", async () => {
    const r = await post(h.routes, run(), { headers: { "content-type": "text/plain" } });
    expect(r.status).toBe(415);
    expect(h.calls).toHaveLength(0);
  });

  it("refuses a run that was not confirmed", async () => {
    const r = await post(h.routes, run({ confirm: false }));
    expect(r.status).toBe(400);
    expect(h.calls).toHaveLength(0);
  });

  it("refuses a real run when broadcasting is switched off, and still previews", async () => {
    /* A KILL SWITCH THAT HAS TO BE ADDED UNDER PRESSURE IS ONE THAT DOES NOT
       EXIST. And a dry run is deliberately NOT gated: seeing what a broadcast
       would do is exactly what somebody deciding whether to turn it back on
       needs. */
    const off = harness({ runEnabled: () => false });
    const real = await post(off.routes, run());
    expect(real.status).toBe(503);
    expect(off.calls).toHaveLength(0);
    expect(off.queued).toHaveLength(0);

    const preview = await post(off.routes, run({ mode: "dry-run", confirm: false }));
    expect(preview.status).toBe(200);
  });

  it("refuses more recipients than a fleet has", async () => {
    /* **ONE OVER THE CAP, NOT TWO HUNDRED.** Two hundred was the first version
       of this test and it passed for the wrong reason: the body limit fired
       first and answered 413, so the recipient cap was never reached and a
       broken cap would have looked tested. The body cap is now the box route's
       64 KiB rather than the steer route's 16 KiB, for exactly this reason. */
    const many = Array.from({ length: 81 }, (_, i) => recipient({ id: `$${i + 1}` }));
    const r = await post(h.routes, run({ recipients: many }));
    expect(r.status).toBe(400);
    expect(String(r.json["why"])).toContain("80");
    expect(h.calls).toHaveLength(0);
  });

  it("takes eighty recipients without tripping the body limit", async () => {
    /* The cap has to be REACHABLE, which is the half the test above cannot
       show. Eighty addresses plus a full-length message is around 12 KB. */
    const many = Array.from({ length: 80 }, (_, i) => recipient({ id: `$${i + 1}` }));
    const r = await post(h.routes, run({ recipients: many, text: "x".repeat(1_500) }));
    expect(r.status).toBe(200);
    expect(h.calls).toHaveLength(80);
  });

  it("refuses an empty message", async () => {
    const r = await post(h.routes, run({ text: "   " }));
    expect(r.status).toBe(400);
    expect(h.calls).toHaveLength(0);
  });

  it("refuses a message too long to say to a whole fleet", async () => {
    const r = await post(h.routes, run({ text: "x".repeat(2_001) }));
    expect(r.status).toBe(400);
    expect(h.calls).toHaveLength(0);
  });

  it("refuses recipients the client did not send, rather than choosing its own", async () => {
    /* THE SERVER MUST NOT PICK THE FLEET. The count in the confirmation the
       person read is the count off the page; a server that filled in its own
       snapshot would send to a set nobody agreed to, and the two would differ
       exactly when the box is changing fastest. */
    const r = await post(h.routes, run({ recipients: [] }));
    expect(r.status).toBe(400);
    expect(String(r.json["why"])).toContain("recipients");
    expect(h.calls).toHaveLength(0);
  });

  it("refuses the same pane twice rather than quietly sending to it twice", async () => {
    /* Deduplicating silently would hide whatever produced the duplicate, and
       two lines back-to-back into one input box is the concatenation failure
       the quarantine exists for. */
    const r = await post(h.routes, run({ recipients: [recipient({ id: "$1" }), recipient({ id: "$1" })] }));
    expect(r.status).toBe(400);
    expect(h.calls).toHaveLength(0);
  });

  it("refuses a slash command rather than stripping the slash", async () => {
    const r = await post(h.routes, run({ text: "/compact", speaker: "overseer" }));
    expect(r.status).toBe(400);
    expect(r.json["code"]).toBe("cannot-attribute");
    expect(h.calls).toHaveLength(0);
  });
});

describe("who gets it — and the busiest sessions are the point", () => {
  it("types at the sessions at a prompt, with the speaker's prefix on the words", async () => {
    const r = await post(h.routes, run());
    expect(r.status).toBe(200);
    expect(h.calls).toHaveLength(2);
    expect(h.calls.map((c) => c.target.sessionId)).toEqual(["$1", "$2"]);
    // `renderMessage`'s doing, not this route's: the prefix says who is speaking.
    expect(h.calls[0]?.text).toContain(TEXT);
    expect(h.calls[0]?.text).not.toBe(TEXT);
    expect(result(r.json).counts["submitted"]).toBe(2);
  });

  it("QUEUES a working session instead of dropping it", async () => {
    /**
     * The finding this route was rebuilt around. Keystrokes into a busy Claude
     * do not queue themselves anywhere useful — which is an argument for
     * putting the line in that session's queue, not for omitting it. On this
     * box most sessions are working most of the time, so the first version
     * reached about a third of the fleet while calling itself a broadcast to
     * all agents.
     */
    const r = await post(
      h.routes,
      run({ recipients: [recipient({ id: "$1" }), recipient({ id: "$2", status: WORKING })] }),
    );
    expect(h.calls.map((c) => c.target.sessionId)).toEqual(["$1"]);
    expect(h.queued.map((q) => q.sessionId)).toEqual(["$2"]);
    expect(row(r.json, "$2").kind).toBe("queued");
    expect(result(r.json).counts).toMatchObject({ asked: 2, submitted: 1, queued: 1, skipped: 0 });
  });

  it("hands the queue the RAW line, so the prefix is not applied twice", async () => {
    /* The queue stores what it is given and the drain renders the speaker's
       prefix at delivery. An already-prefixed string arrives as
       "Greg says: Greg says: …". */
    await post(h.routes, run({ recipients: [recipient({ id: "$2", status: WORKING })] }));
    expect(h.queued[0]?.text).toBe(TEXT);
    expect(h.queued[0]?.speaker).toBe("greg");
  });

  it("queues BEFORE it sends, so a slow fan-out cannot swallow the cheap half", async () => {
    const order: string[] = [];
    const seq = harness({
      sendMessage: (target) => {
        order.push(`send ${target.sessionId}`);
        return OK;
      },
      enqueue: (target) => {
        order.push(`queue ${target.sessionId}`);
        return { ok: true, position: 1 };
      },
    });
    await post(
      seq.routes,
      run({ recipients: [recipient({ id: "$1" }), recipient({ id: "$2", status: WORKING })] }),
    );
    expect(order).toEqual(["queue $2", "send $1"]);
  });

  it("reports a working session as skipped when this build has no door to the queue", async () => {
    /* The `null` arm is a real state, not a TODO: a build without the door must
       say what it could not reach rather than implying it reached everybody. */
    const doorless = harness({ enqueue: null });
    const r = await post(
      doorless.routes,
      run({ recipients: [recipient({ id: "$1" }), recipient({ id: "$2", status: WORKING })] }),
    );
    const skipped = row(r.json, "$2");
    expect(skipped.kind).toBe("skipped");
    expect(skipped.kind === "skipped" && skipped.why).toContain("busy Claude");
    expect(skipped.kind === "skipped" && skipped.why).toContain("no door");
  });

  it("reports a queue that refused, rather than counting it as delivered", async () => {
    const full = harness({
      enqueue: () => ({ ok: false, rule: "session-queue-full", why: "this session already has 20 items queued" }),
    });
    const r = await post(full.routes, run({ recipients: [recipient({ id: "$2", status: WORKING })] }));
    const refused = row(r.json, "$2");
    expect(refused.kind).toBe("skipped");
    expect(refused.kind === "skipped" && refused.why).toContain("20 items");
    expect(result(r.json).counts["queued"]).toBe(0);
  });

  it("refuses the whole broadcast on a message the queue will not take, rather than N identical rows", async () => {
    /**
     * `bad-text` is a fact about the MESSAGE, so it fails identically for every
     * recipient: twenty rows saying it would be one truth reported twenty
     * times. It ends the broadcast cleanly because the queue half runs BEFORE
     * the fan-out — nothing has been typed at anybody yet — and the cooldown is
     * handed back, because a broadcast that sent nothing must not lock the
     * fleet out for ten minutes.
     */
    const bad = harness({ enqueue: () => ({ ok: false, rule: "bad-text", why: "that text cannot be sent" }) });
    const r = await post(
      bad.routes,
      run({ recipients: [recipient({ id: "$1" }), recipient({ id: "$2", status: WORKING })] }),
    );
    expect(r.status).toBe(400);
    expect(r.json["code"]).toBe("bad-text");
    // Nothing typed at the session that WAS at a prompt.
    expect(bad.calls).toHaveLength(0);
    // And the fleet is not locked out over a message that never went.
    const after = await post(bad.routes, run({ recipients: [recipient({ id: "$1" })] }));
    expect(after.status).toBe(200);
  });

  it("skips a shell, because the text would be EXECUTED there", async () => {
    const r = await post(
      h.routes,
      run({ recipients: [recipient({ id: "$1" }), recipient({ id: "$2", status: SHELL })] }),
    );
    expect(h.calls.map((c) => c.target.sessionId)).toEqual(["$1"]);
    expect(h.queued).toHaveLength(0);
    const skipped = row(r.json, "$2");
    expect(skipped.kind).toBe("skipped");
    expect(skipped.kind === "skipped" && skipped.why).toContain("EXECUTE");
  });

  it("refuses the whole broadcast when nobody can be reached, and still says why for each", async () => {
    const r = await post(
      h.routes,
      run({
        recipients: [
          recipient({ id: "$1", status: SHELL }),
          recipient({ id: "$2", status: { kind: "no-claude" } }),
        ],
      }),
    );
    expect(r.status).toBe(409);
    expect(h.calls).toHaveLength(0);
    /* **THE DIAGNOSIS SURVIVES THE REFUSAL.** A bare "there is nobody to tell"
       is a shrug; "a shell and a dead Claude" is something a person can act on.
       This route answered the shrug for about an hour on 2026-09-09. */
    expect(rows(r.json)).toHaveLength(2);
    expect(row(r.json, "$1").kind === "skipped" && row(r.json, "$1")).toBeTruthy();
    const dead = row(r.json, "$2");
    expect(dead.kind === "skipped" && dead.why).toContain("exited");
  });

  it("does not refuse the whole broadcast when the only reachable sessions are working", async () => {
    /* A fleet where everything is busy is the normal state of this box, and it
       is emphatically not "nobody to tell". */
    const r = await post(h.routes, run({ recipients: [recipient({ id: "$1", status: WORKING })] }));
    expect(r.status).toBe(200);
    expect(result(r.json).counts["queued"]).toBe(1);
  });
});

describe("a dry run is not a delivery, and cannot be mistaken for one", () => {
  it("sends nothing, queues nothing, and says what it would have done to each", async () => {
    const r = await post(
      h.routes,
      run({
        mode: "dry-run",
        confirm: false,
        recipients: [recipient({ id: "$1" }), recipient({ id: "$2", status: WORKING }), recipient({ id: "$3", status: SHELL })],
      }),
    );
    expect(h.calls).toHaveLength(0);
    expect(h.queued).toHaveLength(0);
    expect(r.json["op"]).toBe("broadcast-preview");
    expect(row(r.json, "$1").kind).toBe("would-send");
    expect(row(r.json, "$2").kind).toBe("would-queue");
    expect(row(r.json, "$3").kind).toBe("skipped");
  });

  it("counts nothing as submitted or queued, because nothing was", async () => {
    /* A preview whose numbers matched a delivery's exactly is how a dry run
       gets read as a fan-out — which is the envelope-misread this whole panel
       has already had once. */
    const r = await post(h.routes, run({ mode: "dry-run", confirm: false }));
    expect(result(r.json).counts).toMatchObject({ asked: 2, submitted: 0, queued: 0 });
  });

  it("shows the exact line that would go out, prefix and all", async () => {
    const r = await post(h.routes, run({ mode: "dry-run", confirm: false }));
    expect(result(r.json).sample).toContain(TEXT);
    // The RENDERED line, not the raw one — otherwise the preview is of a
    // different message from the one that gets sent.
    expect(result(r.json).sample).not.toBe(TEXT);
    expect(result(r.json).sample).toBe(h.calls[0]?.text ?? (await sendOnce()));
  });

  async function sendOnce(): Promise<string> {
    const one = harness();
    await post(one.routes, run());
    return one.calls[0]?.text ?? "";
  }

  it("never emits a would-* arm from a real run, nor an attempt from a preview", async () => {
    const preview = await post(h.routes, run({ mode: "dry-run", confirm: false }));
    expect(rows(preview.json).some((x) => x.kind === "attempted" || x.kind === "queued")).toBe(false);
    const real = await post(h.routes, run());
    expect(rows(real.json).some((x) => x.kind === "would-send" || x.kind === "would-queue")).toBe(false);
  });
});

describe("what it reports about each recipient", () => {
  it("carries the delivery reading out of a refusal, never swallowing it", async () => {
    const partial = harness({
      sendMessage: () => ({
        ok: false,
        reason: { code: "send-partial", why: "the text went and the Enter did not" },
        delivery: "partial",
        sent: [["tmux", "send-keys", "-t", "%1", "-l", "--", "x"]],
      }),
    });
    const r = await post(partial.routes, run({ recipients: [recipient({ id: "$1" })] }));
    const a = attempt(row(r.json, "$1"));
    expect(a.ok).toBe(false);
    /* The field the browser's `parseDelivery` reads. Losing it renders a
       half-sent message as "nothing was sent", which invites the retry that
       appends to it. */
    expect(a.ok === false && a.delivery).toBe("partial");
    expect(a.ok === false && a.code).toBe("send-partial");
    // And the status, so the page's reading of a recipient is the same reading
    // it gives a direct steer rather than a reconstruction of one.
    expect(a.status).toBeGreaterThanOrEqual(400);
  });

  it("carries the verified address and the argv out of a success", async () => {
    const r = await post(h.routes, run({ recipients: [recipient({ id: "$1" })] }));
    const a = attempt(row(r.json, "$1"));
    expect(a.ok).toBe(true);
    expect(a.ok === true && a.verified).toMatchObject({ paneId: "%1" });
    expect(a.ok === true && a.sent.length).toBeGreaterThan(0);
    expect(a.status).toBe(200);
  });

  it("keeps going after one recipient refuses", async () => {
    let n = 0;
    const flaky = harness({
      sendMessage: () => {
        n += 1;
        if (n === 1) return { ok: false, reason: { code: "pane-gone", why: "gone" }, delivery: "none", sent: [] };
        return OK;
      },
    });
    const r = await post(flaky.routes, run());
    expect(attempt(row(r.json, "$1")).ok).toBe(false);
    expect(attempt(row(r.json, "$2")).ok).toBe(true);
    expect(result(r.json).counts["submitted"]).toBe(1);
  });

  it("survives a throw from one recipient without losing the rest", async () => {
    let n = 0;
    const thrower = harness({
      sendMessage: () => {
        n += 1;
        if (n === 1) throw new Error("tmux went away");
        return OK;
      },
    });
    const r = await post(thrower.routes, run());
    expect(r.status).toBe(200);
    const first = attempt(row(r.json, "$1"));
    expect(first.ok).toBe(false);
    // A throw says nothing about what reached the pane, so it must not read as
    // "nothing was sent".
    expect(first.ok === false && first.delivery).toBe("unknown");
    expect(attempt(row(r.json, "$2")).ok).toBe(true);
  });

  it("accounts for every row the page asked about, in the page's order", async () => {
    const r = await post(
      h.routes,
      run({
        recipients: [
          recipient({ id: "$1", status: SHELL }),
          recipient({ id: "$2", status: WORKING }),
          recipient({ id: "$3" }),
        ],
      }),
    );
    // A list that quietly omitted the skipped ones would read as a smaller
    // fleet than there is.
    expect(rows(r.json).map((x) => x.sessionId)).toEqual(["$1", "$2", "$3"]);
    expect(rows(r.json).map((x) => x.kind)).toEqual(["skipped", "queued", "attempted"]);
  });
});

describe("a session left in doubt is held", () => {
  /**
   * A producer of ambiguous sends. A `partial` or `unknown` leaves the literal
   * text in that agent's input box with no Enter behind it, and the NEXT queued
   * item drains onto the end of it — one instruction neither person wrote.
   * Every producer has to reach the same book.
   */
  it("opens a hold on a partial send", async () => {
    const partial = harness({
      sendMessage: () => ({
        ok: false,
        reason: { code: "send-partial", why: "half of it went" },
        delivery: "partial",
        sent: [["tmux", "send-keys", "-t", "%1", "-l", "--", "x"]],
      }),
    });
    await post(partial.routes, run({ recipients: [recipient({ id: "$1" })] }));
    const held = partial.quarantine.holding("$1");
    expect(held).not.toBeNull();
    expect(held?.reading).toBe("partial");
    expect(held?.origin).toBe("broadcast");
    /* The promise every one of these paths makes: the hold's sentence is
       logged, and no word of the message is in it — the payload is described by
       its length. */
    expect(held?.why).not.toContain("ease off");
    expect(held?.why).toContain("characters");
  });

  it("opens a hold when the delivery module throws, because that is the least evidence there is", async () => {
    const thrower = harness({
      sendMessage: () => {
        throw new Error("tmux went away");
      },
    });
    await post(thrower.routes, run({ recipients: [recipient({ id: "$1" })] }));
    expect(thrower.quarantine.holding("$1")?.reading).toBe("threw");
  });

  it("does NOT hold a session nothing was sent to", async () => {
    const refused = harness({
      sendMessage: () => ({ ok: false, reason: { code: "pane-gone", why: "gone" }, delivery: "none", sent: [] }),
    });
    await post(refused.routes, run({ recipients: [recipient({ id: "$1" })] }));
    /* A hold stops that session's queue. Opening one where the evidence says
       plainly that nothing went out would stop delivery to a session that is
       perfectly fine, and a hold nobody can explain is one people learn to
       clear without looking. */
    expect(refused.quarantine.holding("$1")).toBeNull();
  });

  it("holds on a delivery of none that contradicts itself", async () => {
    const contradictory = harness({
      sendMessage: () => ({
        ok: false,
        reason: { code: "pane-gone", why: "gone" },
        delivery: "none",
        // It says nothing went, and lists a tmux call that completed.
        sent: [["tmux", "send-keys", "-t", "%1", "-l", "--", "x"]],
      }),
    });
    await post(contradictory.routes, run({ recipients: [recipient({ id: "$1" })] }));
    expect(contradictory.quarantine.holding("$1")?.reading).toBe("none-contradicted");
  });

  it("does not hold anything on a dry run", async () => {
    await post(h.routes, run({ mode: "dry-run", confirm: false }));
    expect(h.quarantine.heldSessions()).toEqual([]);
  });

  it("queues for a held session rather than refusing, because refusing loses the instruction", async () => {
    /* A hold blocks at `next()`, not at enqueue. Items accumulate and drain
       when a person releases the hold, which is what keeps somebody's line from
       being thrown away by a fault in a different send. */
    h.quarantine.hold({
      sessionId: "$2",
      paneId: "%2",
      claudeSessionId: "117e181a-155b-435a-b95b-e74220678d1a",
      reading: "partial",
      origin: "direct-steer",
      what: "message (10 characters)",
    });
    const r = await post(h.routes, run({ recipients: [recipient({ id: "$2", status: WORKING })] }));
    expect(row(r.json, "$2").kind).toBe("queued");
  });
});

describe("it must not hold the server's only thread", () => {
  it("stops at the deadline and names every row it never reached", async () => {
    /* `sendMessage` is synchronous — three execFileSync tmux calls with
       ten-second timeouts each — so on the box this button exists FOR, a
       fan-out of thirty-six is minutes of a dashboard that answers nothing.
       Better to tell thirty of thirty-six and say so. */
    const slow = harness({});
    let sent = 0;
    const routes = makeBroadcastRoutes({
      sendMessage: () => {
        sent += 1;
        slow.tick(40_000);
        return OK;
      },
      now: slow.at,
      log: () => {},
      quarantine: slow.quarantine,
      enqueue: null,
      runEnabled: () => true,
      yieldToLoop: () => Promise.resolve(),
    });
    const r = await post(routes, run({ recipients: Array.from({ length: 8 }, (_, i) => recipient({ id: `$${i + 1}` })) }));
    expect(r.status).toBe(200);
    expect(sent).toBeLessThan(8);
    const unreached = rows(r.json).filter((x) => x.kind === "not-reached");
    expect(unreached.length).toBeGreaterThan(0);
    // Every recipient the client asked about is accounted for.
    expect(rows(r.json)).toHaveLength(8);
    expect(result(r.json).counts["notReached"]).toBe(unreached.length);
  });

  it("hands the event loop back between recipients", async () => {
    let yields = 0;
    const routes = makeBroadcastRoutes({
      sendMessage: () => OK,
      now: () => 1_000_000,
      log: () => {},
      quarantine: new QuarantineBook({ now: () => 1_000_000, serverInstanceId: "t" }),
      enqueue: null,
      runEnabled: () => true,
      yieldToLoop: async () => {
        yields += 1;
      },
    });
    await post(routes, run({ recipients: [recipient({ id: "$1" }), recipient({ id: "$2" }), recipient({ id: "$3" })] }));
    expect(yields).toBeGreaterThanOrEqual(2);
  });
});

describe("the cooldown", () => {
  it("refuses a second broadcast straight after the first, and says how long is left", async () => {
    await post(h.routes, run());
    const second = await post(h.routes, run());
    expect(second.status).toBe(429);
    expect(second.headers["retry-after"]).toBeDefined();
    expect(h.calls).toHaveLength(2);
  });

  it("is spent before the fan-out finishes, so two at once cannot interleave", async () => {
    /**
     * The failure this guards: a fan-out of thirty-six takes a while, and a
     * second request arriving halfway through must find the cooldown already
     * spent. If it were taken after the loop, the two would interleave and
     * every agent would get two lines in an order nobody controls.
     *
     * Driven by starting a slow broadcast and posting a second one while the
     * first is still inside its loop.
     */
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const slow = harness({ yieldToLoop: () => gate });
    const first = post(slow.routes, run());
    // The first is now parked inside `fanOut`, between recipients.
    await Promise.resolve();
    const second = await post(slow.routes, run());
    expect(second.status).toBe(429);
    release();
    expect((await first).status).toBe(200);
  });

  it("does not spend the cooldown on a dry run", async () => {
    await post(h.routes, run({ mode: "dry-run", confirm: false }));
    const real = await post(h.routes, run());
    expect(real.status).toBe(200);
  });

  it("does not spend the cooldown on a broadcast that reached nobody", async () => {
    /* A refusal cost the box nothing, and charging for it would lock somebody
       out of the fleet for ten minutes over a request that did not happen. */
    await post(h.routes, run({ recipients: [recipient({ id: "$1", status: SHELL })] }));
    const real = await post(h.routes, run());
    expect(real.status).toBe(200);
  });

  it("lets one through once the cooldown has passed", async () => {
    await post(h.routes, run());
    h.tick(10 * 60_000 + 1);
    const later = await post(h.routes, run());
    expect(later.status).toBe(200);
  });
});

describe("the composition root, which the tests above are structurally blind to", () => {
  /**
   * **EVERY TEST IN THIS FILE INJECTS ITS OWN `enqueue`, SO NONE OF THEM CAN
   * SEE WHETHER THE REAL ONE REACHES THE REAL QUEUE.**
   *
   * That blindness is invisible in a green suite, and it is where two of
   * tonight's defects lived next door: `shared ??= makeActionRoutes()` becoming
   * `shared = makeActionRoutes()` hands two callers two different queues, every
   * unit test goes on passing, and the item the page can see is the one nothing
   * ever delivers. The comment on `drainSharedQueues` has said why since it was
   * written; nothing checked it.
   *
   * So this asserts the property directly: two calls through the door land in
   * ONE queue. It looks like it is testing the language, which is the reason
   * nobody writes it.
   *
   * No tmux and no send — enqueueing is state, and this never reaches a pane.
   */
  it("reaches one queue, so two calls through the door stack", () => {
    const target = { sessionId: "$97531", claudeSessionId: "117e181a-155b-435a-b95b-e74220678d1a" };
    const first = enqueueSharedMessage(target, "the first line", "greg");
    const second = enqueueSharedMessage(target, "a different second line", "greg");
    expect(first).toMatchObject({ ok: true, position: 1 });
    // `2` is the whole assertion: a second queue would answer `1` again.
    expect(second).toMatchObject({ ok: true, position: 2 });
  });
});

describe("the log", () => {
  it("never contains a word of what was broadcast", async () => {
    await post(
      h.routes,
      run({
        text: "the secret plan is to rewrite the extractor",
        recipients: [recipient({ id: "$1" }), recipient({ id: "$2", status: WORKING })],
      }),
    );
    const all = h.log.join("\n");
    expect(all).not.toContain("secret plan");
    expect(all).not.toContain("extractor");
    // But it does record that it happened, and to how many.
    expect(all).toContain("broadcast");
    expect(all).toContain("submitted=1");
  });
});
