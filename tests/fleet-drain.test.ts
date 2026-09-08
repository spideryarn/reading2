/**
 * The thing that was missing — tools/fleet/drain.ts, and its wiring.
 *
 * **NOTHING HERE SENDS A KEYSTROKE.** There are ~35 live agent sessions on this
 * box doing other people's work, and this file tests the one pass that types
 * into them unasked. `sendMessage` is injected everywhere and the fakes RECORD
 * what they were handed; the tmux ids are fictional (`%99001`, `$99001`), so a
 * bug that somehow reached the real delivery module would refuse against a pane
 * that is not on this box rather than land somewhere.
 *
 * THE ASSERTION THAT MATTERS IS NOT "drainOnce returns delivered". It is **what
 * reached the seam** — which target, and which text — because the bug this
 * stage exists to fix was invisible to a suite in which every part was tested
 * and the wiring between the parts was not. `queue.next()` was called from a
 * test and from nowhere in the product, so items were accepted, rendered,
 * cancelled, and never delivered. So there are two wiring tests here that name
 * the wiring: one through `makeActionRoutes`, and one through the module-level
 * `shared` that `handleActionRequest` and `drainSharedQueues` must both reach.
 *
 * docs/plans/260907e-agent-fleet-dashboard.md § Stage v0.5f.
 */
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { actionById } from "../tools/fleet/actions.js";
import type { FleetRow, FleetSnapshot } from "../tools/fleet/collect.js";
import { DRAIN_BUDGET_MS, drainOnce, MAX_SENDS_PER_PASS, summariseDrain, type DrainDeps, type DrainOutcome } from "../tools/fleet/drain.js";
import { SteeringQueue, type UnsentFailure } from "../tools/fleet/queue.js";
import { drainSharedQueues, handleActionRequest, makeActionRoutes, type ActionDeps } from "../tools/fleet/routes-actions.js";
import { createRateLimiter } from "../tools/fleet/routes-steer.js";
import type { FleetStatus } from "../tools/fleet/status.js";
import type { SteerResult, SteerTarget } from "../tools/fleet/steer.js";

/* ------------------------------------------------------------------ *
 * Fixtures. Fictional ids, distinct from every other test file's.
 * ------------------------------------------------------------------ */

const PANE_A = "%99001";
const SESSION_A = "$99001";
const PANE_B = "%99002";
const SESSION_B = "$99002";
const PANE_PID = 424242;

/**
 * Three uuids, all of them this file's own.
 *
 * `tests/fixture-ids.test.ts` is the reason they are not the digits anybody
 * reaches for: two fleet route test files copied one uuid between them and that
 * guard went red. Nothing here inserts a row, so the collision would have been
 * harmless — and sharing one anyway is how the next copied file collides for
 * real.
 */
const CONVO_A = "7c70f16c-8394-49ff-969e-8cd8e292f09a";
const CONVO_B = "76ed82ec-e4bc-497e-b8d4-28f37deeb05a";
/** The conversation a pane was resumed into, which orphans everything queued for the old one. */
const CONVO_RESUMED = "dc592db8-b614-4f6c-b875-29d003cca9fe";

const IDLE: FleetStatus = { kind: "idle" };
const WORKING: FleetStatus = { kind: "working" };
const SHELL: FleetStatus = { kind: "shell", busy: false };
const NO_CLAUDE: FleetStatus = { kind: "no-claude" };

function row(over: Partial<FleetRow> = {}): FleetRow {
  return {
    id: SESSION_A,
    name: "wf-fixture",
    title: null,
    repo: null,
    worktree: null,
    meta: { version: "legacy" },
    startedAt: "2026-09-08T00:00:00.000Z",
    status: IDLE,
    paneId: PANE_A,
    panePid: PANE_PID,
    claudeSessionId: CONVO_A,
    question: null,
    // Nothing in this file turns on it; it is a required field of a row, and a
    // fixture that could not say what mode a pane is in is the honest default.
    permissionMode: { kind: "cannot-tell", why: "a fixture row, not a pane that was read" },
    ...over,
  };
}

/** A fictional tmux server, so a generation change is something a test can stage. */
const TMUX_GENERATION = 990_001;

/**
 * A snapshot around some rows.
 *
 * `drainOnce` takes the whole thing rather than `rows` because `tmuxServerPid`
 * is what makes every `$…` and `%…` in them mean anything — see the queue's
 * `noteGeneration`.
 */
function snap(rows: FleetRow[], over: Partial<FleetSnapshot> = {}): FleetSnapshot {
  return {
    rows,
    collectedAt: "2026-09-08T12:00:00.000Z",
    tookMs: 13_000,
    tmuxServerPid: TMUX_GENERATION,
    ...over,
  };
}

const SENT_OK: SteerResult = {
  ok: true,
  verified: { paneId: PANE_A, sessionId: SESSION_A, panePid: PANE_PID, claudePid: 424299 },
  sent: [["send-keys", "-t", PANE_A, "-l", "--", "…"]],
};

const REFUSED: SteerResult = {
  ok: false,
  reason: { code: "not-at-input", why: "pane %99001 is not showing an input box" },
  delivery: "none",
  sent: [],
};

type Sent = { target: SteerTarget; text: string; declaredStatus: FleetStatus };

/** The delivery module as a recorder, and optionally as a thing that fails. */
function harness(over: { result?: SteerResult | ((t: SteerTarget, text: string) => SteerResult); queue?: SteeringQueue } = {}) {
  let clock = 1_000_000;
  const queue = over.queue ?? new SteeringQueue({ now: () => clock });
  const sent: Sent[] = [];
  const logs: string[] = [];
  const deps: DrainDeps = {
    queue,
    sendMessage: (target, text, declaredStatus) => {
      sent.push({ target, text, declaredStatus });
      return typeof over.result === "function" ? over.result(target, text) : (over.result ?? SENT_OK);
    },
    log: (line) => logs.push(line),
    now: () => clock,
  };
  return { deps, queue, sent, logs, tick: (ms: number) => (clock += ms) };
}

function outcomesFor(result: { outcomes: readonly DrainOutcome[] }, sessionId: string): DrainOutcome[] {
  return result.outcomes.filter((o) => o.sessionId === sessionId);
}

/* ------------------------------------------------------------------ *
 * A request and a response, for the two wiring tests.
 * ------------------------------------------------------------------ */

const HOST = "100.90.80.70:8787";
const ORIGIN = `http://${HOST}`;

type FakeRes = { status: number | null; body: string; done: Promise<void> };

function fakeRes(): { res: import("node:http").ServerResponse; seen: FakeRes } {
  let settle: () => void = () => {};
  const seen: FakeRes = {
    status: null,
    body: "",
    done: new Promise<void>((r) => {
      settle = r;
    }),
  };
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
  return { res: res as unknown as import("node:http").ServerResponse, seen };
}

function fakeReq(body: unknown, url = "/api/actions/session"): import("node:http").IncomingMessage {
  const stream = new PassThrough();
  stream.write(JSON.stringify(body));
  stream.end();
  return Object.assign(stream, {
    url,
    method: "POST",
    headers: { host: HOST, origin: ORIGIN, "content-type": "application/json" },
    socket: { remoteAddress: "100.90.80.71" },
  }) as unknown as import("node:http").IncomingMessage;
}

async function post(
  handle: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => boolean,
  body: unknown,
): Promise<{ status: number | null; json: Record<string, unknown> }> {
  const { res, seen } = fakeRes();
  expect(handle(fakeReq(body), res)).toBe(true);
  await seen.done;
  return { status: seen.status, json: seen.body === "" ? {} : (JSON.parse(seen.body) as Record<string, unknown>) };
}

/* ================================================================== *
 * The wiring. These are the tests that would have caught the hole.
 * ================================================================== */

describe("the route and the drain share one queue", () => {
  it("delivers an item that was enqueued through POST /api/actions/session", async () => {
    // END TO END THROUGH THE REAL ROUTE, because the bug was never in either
    // half: the queue delivered when a test asked it to, and the route filled a
    // queue nothing asked. Only a test that crosses the seam can see that.
    const sent: Sent[] = [];
    let clock = 1_000_000;
    const routes = makeActionRoutes({
      queue: new SteeringQueue({ now: () => clock }),
      sendMessage: (target, text, declaredStatus) => {
        sent.push({ target, text, declaredStatus });
        return SENT_OK;
      },
      now: () => clock,
      limiter: createRateLimiter({ minIntervalMs: 0, burstMax: 1_000, burstWindowMs: 1 }),
      log: () => {},
    } satisfies Partial<ActionDeps>);

    const enqueued = await post((req, res) => routes.handle(req, res), {
      paneId: PANE_A,
      sessionId: SESSION_A,
      claudeSessionId: CONVO_A,
      panePid: PANE_PID,
      status: { kind: "idle" },
      mode: "enqueue",
      text: "please push what you have",
    });
    expect(enqueued.status).toBe(200);
    expect(sent).toHaveLength(0);

    const result = routes.drain(snap([row()]));

    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toBe("please push what you have");
    expect(sent[0]?.target.paneId).toBe(PANE_A);
    expect(sent[0]?.target.sessionId).toBe(SESSION_A);
    expect(result.outcomes.map((o) => o.kind)).toEqual(["delivered"]);
  });

  it("reaches the same queue from handleActionRequest and drainSharedQueues", async () => {
    // THE MODULE-LEVEL `shared`, which is the instance production uses, and the
    // one place two queues could hide. Deliberately driven with a WORKING row:
    // `drainGate` refuses that arm before anything is sent, so this test can
    // exercise the real deps — including the real `sendMessage` — with no
    // possibility of a keystroke. (The ids are fictional as well, so even a
    // future bug that got past the gate would be refused by `verifyTarget`.)
    const enqueued = await post(handleActionRequest, {
      paneId: PANE_B,
      sessionId: SESSION_B,
      claudeSessionId: CONVO_B,
      panePid: PANE_PID,
      status: { kind: "working" },
      mode: "enqueue",
      actionId: "report-status",
    });
    expect(enqueued.status).toBe(200);

    const result = drainSharedQueues(snap([row({ id: SESSION_B, paneId: PANE_B, claudeSessionId: CONVO_B, status: WORKING })]));

    // If `drainSharedQueues` built its own queue, this row's queue would be
    // empty and nothing would have been considered at all.
    expect(result.considered).toBe(1);
    const held = outcomesFor(result, SESSION_B);
    expect(held.map((o) => o.kind)).toEqual(["held"]);
    expect(held[0]?.kind === "held" && held[0].reason).toBe("held");
  });
});

/* ================================================================== *
 * Delivering.
 * ================================================================== */

describe("drainOnce delivers", () => {
  it("sends a queued message to an idle session, addressed by the row", () => {
    const { deps, queue, sent } = harness();
    queue.enqueueMessage({ sessionId: SESSION_A, claudeSessionId: CONVO_A }, "have a look at the failing test first");

    const result = drainOnce(snap([row()]), deps);

    expect(sent).toHaveLength(1);
    // THE IDS, THE RIGHT WAY ROUND. `row.id` is the tmux SESSION handle and
    // `row.paneId` is the PANE handle; swapping them is the classic error here,
    // and steer.ts would refuse the send rather than misdirect it — but the
    // person would see an unexplained refusal for every message forever.
    expect(sent[0]?.target).toEqual({ paneId: PANE_A, sessionId: SESSION_A, claudeSessionId: CONVO_A, panePid: PANE_PID });
    expect(sent[0]?.text).toBe("have a look at the failing test first");
    expect(sent[0]?.declaredStatus).toEqual(IDLE);
    expect(result.outcomes.map((o) => o.kind)).toEqual(["delivered"]);
    // Settled, so it is gone rather than waiting to be sent again.
    expect(queue.size(SESSION_A)).toBe(0);
  });

  it("sends a spoken action's words, not its label or its summary", () => {
    const { deps, queue, sent } = harness();
    queue.enqueueAction({ sessionId: SESSION_A, claudeSessionId: CONVO_A }, "run-checks");
    const action = actionById("run-checks");

    drainOnce(snap([row()]), deps);

    expect(action?.effect).toBe("spoken");
    expect(sent[0]?.text).toBe(action?.effect === "spoken" ? action.text : "NOT A SPOKEN ACTION");
    expect(sent[0]?.text).not.toBe(action?.label);
    expect(sent[0]?.text).not.toBe(action?.summary);
  });

  it("carries panePid when the row has one, and leaves it out when it does not", () => {
    const { deps, queue, sent } = harness();
    queue.enqueueMessage({ sessionId: SESSION_A, claudeSessionId: CONVO_A }, "one");
    drainOnce(snap([row({ panePid: null })]), deps);
    // `panePid` is optional so a pid tmux would not tell us degrades to "no
    // respawn check" rather than making the row unsteerable — steer.ts's rule,
    // and an `undefined` written into the field would be a different thing
    // under exactOptionalPropertyTypes.
    expect(sent[0]?.target).toEqual({ paneId: PANE_A, sessionId: SESSION_A, claudeSessionId: CONVO_A });
    expect("panePid" in (sent[0]?.target ?? {})).toBe(false);
  });

  it("delivers at most one item per session per pass", () => {
    // The point of the queue: the agent gets a turn between instructions.
    const { deps, queue, sent } = harness();
    queue.enqueueMessage({ sessionId: SESSION_A, claudeSessionId: CONVO_A }, "first");
    queue.enqueueMessage({ sessionId: SESSION_A, claudeSessionId: CONVO_A }, "second");

    drainOnce(snap([row()]), deps);
    expect(sent.map((s) => s.text)).toEqual(["first"]);
    expect(queue.size(SESSION_A)).toBe(1);

    drainOnce(snap([row()]), deps);
    expect(sent.map((s) => s.text)).toEqual(["first", "second"]);
  });

  it("drains two sessions in one pass, and neither gets the other's item", () => {
    const { deps, queue, sent } = harness();
    queue.enqueueMessage({ sessionId: SESSION_A, claudeSessionId: CONVO_A }, "for A");
    queue.enqueueMessage({ sessionId: SESSION_B, claudeSessionId: CONVO_B }, "for B");

    const result = drainOnce(snap([row(), row({ id: SESSION_B, paneId: PANE_B, claudeSessionId: CONVO_B })]), deps);

    expect(sent).toHaveLength(2);
    const forA = sent.find((s) => s.target.sessionId === SESSION_A);
    const forB = sent.find((s) => s.target.sessionId === SESSION_B);
    expect(forA?.text).toBe("for A");
    expect(forA?.target.paneId).toBe(PANE_A);
    expect(forB?.text).toBe("for B");
    expect(forB?.target.paneId).toBe(PANE_B);
    expect(result.considered).toBe(2);
    expect(result.rows).toBe(2);
  });

  it("does not ask an empty queue what is next", () => {
    // `next()` is cheap, but it is also what LEASES, and a pass over 36 rows
    // that mostly have nothing queued should be 36 map lookups.
    const { deps, queue } = harness();
    const spy = vi.spyOn(queue, "next");
    const result = drainOnce(snap([row(), row({ id: SESSION_B, paneId: PANE_B, claudeSessionId: CONVO_B })]), deps);
    expect(spy).not.toHaveBeenCalled();
    expect(result.rows).toBe(2);
    expect(result.considered).toBe(0);
    expect(result.outcomes).toEqual([]);
  });
});

/* ================================================================== *
 * Not delivering, which is most of the file.
 * ================================================================== */

describe("drainOnce holds", () => {
  it("does not type at a session that is working, and keeps the item", () => {
    // `drainGate`'s `later` arm, and the reason the queue exists at all:
    // keystrokes sent to a busy Claude do not queue themselves anywhere useful.
    const { deps, queue, sent } = harness();
    queue.enqueueMessage({ sessionId: SESSION_A, claudeSessionId: CONVO_A }, "wait for me");

    const result = drainOnce(snap([row({ status: WORKING })]), deps);

    expect(sent).toHaveLength(0);
    expect(queue.size(SESSION_A)).toBe(1);
    expect(queue.snapshot(SESSION_A).items[0]?.leasedAt).toBe(null);
    const held = result.outcomes[0];
    expect(held?.kind === "held" && held.reason).toBe("held");
  });

  it("does not type at a session that is asking a question, and keeps the item", () => {
    // **THE P0 THIS FILE WAS REWRITTEN FOR.** `steerableStatus` permits
    // `needs-you` — it answers "may this session be steered at all" — but
    // `sendMessage` refuses a pane showing a dialog. Leasing here would mean
    // sending, being refused, and destroying the item; and repeated passes
    // would eat the whole queue while the agent sat on one question.
    const { deps, queue, sent } = harness();
    queue.enqueueMessage({ sessionId: SESSION_A, claudeSessionId: CONVO_A }, "the answer is 2");

    const result = drainOnce(snap([row({ status: { kind: "needs-you" } })]), deps);

    expect(sent).toHaveLength(0);
    expect(queue.size(SESSION_A)).toBe(1);
    expect(queue.snapshot(SESSION_A).items[0]?.leasedAt).toBe(null);
    const held = result.outcomes[0];
    expect(held?.kind === "held" && held.reason).toBe("held");
    // `later`, not `never`: it goes out once the dialog has been dealt with.
    drainOnce(snap([row()]), deps);
    expect(sent).toHaveLength(1);
  });

  it("does not type at a shell or at a session whose Claude has exited", () => {
    for (const status of [SHELL, NO_CLAUDE]) {
      const { deps, queue, sent } = harness();
      queue.enqueueMessage({ sessionId: SESSION_A, claudeSessionId: CONVO_A }, "hello");
      const result = drainOnce(snap([row({ status })]), deps);
      expect(sent, status.kind).toHaveLength(0);
      expect(queue.size(SESSION_A)).toBe(1);
      const blocked = result.outcomes[0];
      expect(blocked?.kind === "held" && blocked.reason, status.kind).toBe("blocked");
    }
  });

  it("does not deliver into a conversation the pane has since been resumed into", () => {
    const { deps, queue, sent } = harness();
    queue.enqueueMessage({ sessionId: SESSION_A, claudeSessionId: CONVO_A }, "for the old conversation");

    const result = drainOnce(snap([row({ claudeSessionId: CONVO_RESUMED })]), deps);

    expect(sent).toHaveLength(0);
    expect(queue.size(SESSION_A)).toBe(1);
    const orphaned = result.outcomes[0];
    expect(orphaned?.kind === "held" && orphaned.reason).toBe("orphaned");
  });

  it("cannot send to a row with no pane, and leaves the item unleased", () => {
    // `paneId` is a join against a separate pane listing and can be transiently
    // null on a live session. Leasing here would make the item `stuck` for a
    // person to clear, over a row that will very likely have a pane again in
    // sixty seconds.
    const { deps, queue, sent } = harness();
    queue.enqueueMessage({ sessionId: SESSION_A, claudeSessionId: CONVO_A }, "hello");

    const result = drainOnce(snap([row({ paneId: null })]), deps);

    expect(sent).toHaveLength(0);
    expect(queue.size(SESSION_A)).toBe(1);
    expect(queue.snapshot(SESSION_A).items[0]?.leasedAt).toBe(null);
    const held = result.outcomes[0];
    expect(held?.kind === "held" && held.reason).toBe("no-pane");

    // And it goes out on the pass after the pane comes back.
    drainOnce(snap([row()]), deps);
    expect(sent).toHaveLength(1);
  });

  it("holds a row whose conversation the collector could not name", () => {
    const { deps, queue, sent } = harness();
    queue.enqueueMessage({ sessionId: SESSION_A, claudeSessionId: CONVO_A }, "hello");
    const result = drainOnce(snap([row({ claudeSessionId: null })]), deps);
    expect(sent).toHaveLength(0);
    expect(queue.size(SESSION_A)).toBe(1);
    const held = result.outcomes[0];
    expect(held?.kind === "held" && held.reason).toBe("no-conversation");
  });
});

/* ================================================================== *
 * Failing, and the rule that nothing is retried.
 * ================================================================== */

describe("drainOnce fails honestly", () => {
  it("puts an item back when the transport says it sent nothing", () => {
    // **THE INSTRUCTION MUST SURVIVE THE COMMONEST REFUSAL ON THIS BOX.** The
    // row said idle; in the thirteen seconds since the collection the agent
    // opened a dialog, so `sendMessage` refuses with `pane-is-asking` having
    // sent nothing at all. Settling that as `refused` would destroy the
    // person's message at exactly the moment they most wanted it delivered.
    const asking: SteerResult = {
      ok: false,
      reason: { code: "pane-is-asking", why: "pane %99001 is asking a question" },
      delivery: "none",
      sent: [],
    };
    const { deps, queue, sent } = harness({ result: asking });
    queue.enqueueMessage({ sessionId: SESSION_A, claudeSessionId: CONVO_A }, "hello");

    const result = drainOnce(snap([row()]), deps);

    expect(sent).toHaveLength(1);
    const back = result.outcomes[0];
    expect(back?.kind).toBe("put-back");
    expect(back?.kind === "put-back" && back.code).toBe("pane-is-asking");
    // Still there, still at the head, and NOT leased — so the next pass can
    // try again once the dialog has been answered.
    expect(queue.size(SESSION_A)).toBe(1);
    expect(queue.snapshot(SESSION_A).items[0]?.leasedAt).toBe(null);

    drainOnce(snap([row()]), deps);
    expect(sent).toHaveLength(2);
  });

  it("settles a refusal that may have reached the pane, and never sends it again", () => {
    // `partial` and `unknown` are the ambiguous arms: something may be sitting
    // in that agent's input box unsent, so firing the same keys again is how a
    // message is delivered twice — the failure queue.ts's header ranks worse
    // than not delivering at all.
    for (const delivery of ["partial", "unknown"] as const) {
      const { deps, queue, sent } = harness({
        result: { ...REFUSED, delivery, sent: [["send-keys", "-t", PANE_A, "-l", "--", "…"]] },
      });
      queue.enqueueMessage({ sessionId: SESSION_A, claudeSessionId: CONVO_A }, "hello");

      const result = drainOnce(snap([row()]), deps);

      expect(sent, delivery).toHaveLength(1);
      expect(queue.size(SESSION_A), delivery).toBe(0);
      const refused = result.outcomes[0];
      expect(refused?.kind, delivery).toBe("refused");
      expect(refused?.kind === "refused" && refused.code).toBe("not-at-input");

      drainOnce(snap([row()]), deps);
      expect(sent, delivery).toHaveLength(1);
    }
  });

  it("refuses to put back an item on evidence that does not say nothing was sent", () => {
    // The queue's own guard, checked directly: the type stops a caller passing
    // the wrong evidence, and this stops an `as` somewhere else walking past it.
    const { queue } = harness();
    const added = queue.enqueueMessage({ sessionId: SESSION_A, claudeSessionId: CONVO_A }, "hello");
    expect(added.ok).toBe(true);
    const leased = queue.next(SESSION_A, { status: IDLE, claudeSessionId: CONVO_A });
    expect(leased.kind).toBe("ready");
    const lie = { ...REFUSED, delivery: "partial" } as unknown as UnsentFailure;
    const out = queue.release(SESSION_A, leased.kind === "ready" ? leased.item.id : "q1", lie);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.why).toContain("did not say that nothing was sent");
  });

  it("leaves the lease alone when the delivery module throws, and does not send twice", () => {
    // THE ANTI-RETRY RULE. Nothing can tell a request that died before the
    // keystrokes from one that died after, so the item is neither settled nor
    // requeued: it becomes stuck and waits for a person.
    const { deps, queue, sent, tick } = harness({
      result: () => {
        throw new Error("tmux went away");
      },
    });
    queue.enqueueMessage({ sessionId: SESSION_A, claudeSessionId: CONVO_A }, "hello");

    const first = drainOnce(snap([row()]), deps);
    expect(sent).toHaveLength(1);
    expect(first.outcomes[0]?.kind).toBe("threw");
    expect(queue.snapshot(SESSION_A).items[0]?.leasedAt).not.toBe(null);

    const second = drainOnce(snap([row()]), deps);
    expect(sent).toHaveLength(1);
    const held = second.outcomes[0];
    expect(held?.kind === "held" && held.reason).toBe("in-flight");

    // And past the lease it is `stuck` — still not retried.
    tick(10 * 60_000);
    const third = drainOnce(snap([row()]), deps);
    expect(sent).toHaveLength(1);
    const stuck = third.outcomes[0];
    expect(stuck?.kind === "held" && stuck.reason).toBe("stuck");
  });

  it("carries on to the next row when one row throws", () => {
    const { deps, queue, sent } = harness({
      result: (target) => {
        if (target.sessionId === SESSION_A) throw new Error("tmux went away");
        return SENT_OK;
      },
    });
    queue.enqueueMessage({ sessionId: SESSION_A, claudeSessionId: CONVO_A }, "for A");
    queue.enqueueMessage({ sessionId: SESSION_B, claudeSessionId: CONVO_B }, "for B");

    const result = drainOnce(snap([row(), row({ id: SESSION_B, paneId: PANE_B, claudeSessionId: CONVO_B })]), deps);

    expect(sent.map((s) => s.text)).toEqual(["for A", "for B"]);
    expect(outcomesFor(result, SESSION_A).map((o) => o.kind)).toEqual(["threw"]);
    expect(outcomesFor(result, SESSION_B).map((o) => o.kind)).toEqual(["delivered"]);
  });

  it("holds an item that has waited too long rather than delivering it unasked", () => {
    const { deps, queue, sent, tick } = harness();
    queue.enqueueMessage({ sessionId: SESSION_A, claudeSessionId: CONVO_A }, "run the checks");
    tick(31 * 60_000);

    const result = drainOnce(snap([row()]), deps);

    expect(sent).toHaveLength(0);
    const stale = result.outcomes[0];
    expect(stale?.kind === "held" && stale.reason).toBe("stale");
  });

  it("says what happened in one line, without a word of what was said", () => {
    const { deps, queue } = harness();
    queue.enqueueMessage({ sessionId: SESSION_A, claudeSessionId: CONVO_A }, "a secret plan nobody should log");
    const line = summariseDrain(drainOnce(snap([row()]), deps));
    expect(line).toContain("delivered=1");
    expect(line).not.toContain("secret");
  });
});

/* ================================================================== *
 * The bounds, which exist because a send blocks this whole process.
 * ================================================================== */

describe("drainOnce is bounded", () => {
  function rows(n: number): FleetRow[] {
    // Distinct fictional session and pane handles, and one conversation each.
    return Array.from({ length: n }, (_, i) => row({ id: `$9910${i}`, paneId: `%9910${i}`, claudeSessionId: CONVO_A }));
  }

  it("sends at most MAX_SENDS_PER_PASS items, however many are queued", () => {
    const { deps, queue, sent } = harness();
    const all = rows(MAX_SENDS_PER_PASS + 2);
    for (const r of all) queue.enqueueMessage({ sessionId: r.id, claudeSessionId: CONVO_A }, `for ${r.id}`);

    const result = drainOnce(snap(all), deps);

    expect(sent).toHaveLength(MAX_SENDS_PER_PASS);
    expect(result.considered).toBe(all.length);
    const over = result.outcomes.filter((o) => o.kind === "held" && o.reason === "out-of-time");
    expect(over).toHaveLength(2);
    // Nothing is lost: the two that did not fit are first in line next pass,
    // and unleased.
    for (const r of all.slice(MAX_SENDS_PER_PASS)) {
      expect(queue.snapshot(r.id).items[0]?.leasedAt, r.id).toBe(null);
    }
  });

  it("stops starting sends once the wall-clock budget is spent", () => {
    // The clock is injected, so a slow transport is a fake that advances it —
    // no waiting, and the bound is measured rather than assumed.
    let clock = 1_000_000;
    const queue = new SteeringQueue({ now: () => clock });
    const sent: string[] = [];
    const deps: DrainDeps = {
      queue,
      sendMessage: (_t, text) => {
        sent.push(text);
        clock += DRAIN_BUDGET_MS + 1;
        return SENT_OK;
      },
      log: () => {},
      now: () => clock,
    };
    const all = rows(3);
    for (const r of all) queue.enqueueMessage({ sessionId: r.id, claudeSessionId: CONVO_A }, `for ${r.id}`);

    const result = drainOnce(snap(all), deps);

    // One send overruns the budget — a synchronous `execFileSync` cannot be
    // interrupted, so the worst case is the budget plus one send, and that is
    // the promise being pinned here.
    expect(sent).toHaveLength(1);
    expect(result.outcomes.filter((o) => o.kind === "held" && o.reason === "out-of-time")).toHaveLength(2);
  });
});

/* ================================================================== *
 * The tmux generation, which is what makes a `$…` mean anything.
 * ================================================================== */

describe("drainOnce checks which tmux server it is looking at", () => {
  it("delivers nothing at all when the snapshot cannot say", () => {
    const { deps, queue, sent } = harness();
    queue.enqueueMessage({ sessionId: SESSION_A, claudeSessionId: CONVO_A }, "hello");

    const result = drainOnce(snap([row()], { tmuxServerPid: null }), deps);

    expect(sent).toHaveLength(0);
    expect(result.generation).toBe(null);
    expect(result.considered).toBe(1);
    const held = result.outcomes[0];
    expect(held?.kind === "held" && held.reason).toBe("no-generation");
    // Held, not dropped, and not leased.
    expect(queue.snapshot(SESSION_A).items[0]?.leasedAt).toBe(null);
  });

  it("invalidates everything queued against a tmux server that has been replaced", () => {
    // A restart re-issues `$…` and `%…` together, so the handle at the head of
    // this queue now names somebody else's session.
    const { deps, queue, sent } = harness();
    queue.enqueueMessage({ sessionId: SESSION_A, claudeSessionId: CONVO_A }, "hello");
    drainOnce(snap([row({ status: WORKING })]), deps);

    const after = drainOnce(snap([row()], { tmuxServerPid: TMUX_GENERATION + 1 }), deps);

    expect(sent).toHaveLength(0);
    expect(after.invalidated).toBe(1);
    const orphaned = after.outcomes[0];
    expect(orphaned?.kind === "held" && orphaned.reason).toBe("orphaned");
    // Visible rather than dropped: the page can say why it will not happen.
    expect(queue.size(SESSION_A)).toBe(1);
    expect(queue.snapshot(SESSION_A).items[0]?.invalidated).toContain("tmux server");
    // And it stays refused on every later pass, not just the one that noticed.
    drainOnce(snap([row()], { tmuxServerPid: TMUX_GENERATION + 1 }), deps);
    expect(sent).toHaveLength(0);
  });
});

/* ================================================================== *
 * What may not be queued, now that something drains.
 * ================================================================== */

describe("an enacted action cannot be queued", () => {
  it("is refused by the queue, in a sentence naming the alternative", () => {
    const { queue } = harness();
    for (const id of ["remove-worktree", "kill-session"]) {
      const out = queue.enqueueAction({ sessionId: SESSION_A, claudeSessionId: CONVO_A }, id);
      expect(out.ok, id).toBe(false);
      if (!out.ok) {
        expect(out.rule).toBe("enacted-not-deliverable");
        expect(out.why).toContain("dry-run");
        expect(out.why).toContain("confirm");
      }
    }
    expect(queue.size(SESSION_A)).toBe(0);
    // Paired positive: a spoken action still goes in.
    expect(queue.enqueueAction({ sessionId: SESSION_A, claudeSessionId: CONVO_A }, "push").ok).toBe(true);
  });

  it("is refused by the route with a code the page can act on", async () => {
    let clock = 1_000_000;
    const routes = makeActionRoutes({
      queue: new SteeringQueue({ now: () => clock }),
      sendMessage: () => SENT_OK,
      now: () => clock,
      limiter: createRateLimiter({ minIntervalMs: 0, burstMax: 1_000, burstWindowMs: 1 }),
      log: () => {},
    } satisfies Partial<ActionDeps>);

    const r = await post((req, res) => routes.handle(req, res), {
      paneId: PANE_A,
      sessionId: SESSION_A,
      claudeSessionId: CONVO_A,
      panePid: PANE_PID,
      status: { kind: "idle" },
      mode: "enqueue",
      actionId: "remove-worktree",
      confirm: true,
    });

    expect(r.status).toBe(400);
    expect(r.json.code).toBe("wrong-mode");
    expect(String(r.json.why)).toContain("dry-run");
  });
});
