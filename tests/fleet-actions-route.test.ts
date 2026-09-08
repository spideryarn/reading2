/**
 * The HTTP skin over the action vocabulary — tools/fleet/routes-actions.ts.
 *
 * **NOTHING HERE SENDS A KEYSTROKE, RUNS A COMMAND OR SIGNALS A PROCESS.**
 * There are ~35 live agent sessions on this box doing other people's work; a
 * stray message costs somebody their context and a stray kill costs them
 * everything. Every seam in that file exists for this: `sendMessage` and the
 * whole `ActionIo` (running a step, reading the process table, asking who we
 * are) are injected, and the fakes here RECORD what they were handed. So the
 * assertions that matter are not "did it return 200" — they are **what reached
 * the seam**, because a route that ran a later step after an earlier one failed,
 * or that pre-rendered a broadcast, would return 200 just as happily.
 *
 * The tmux ids are deliberately fictional (`%99001`, `$99001`) and the
 * directories are under a fixture root, so a bug that somehow reached the real
 * io would refuse rather than land somewhere.
 */
import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { actionById, renderBroadcast, staggerMinutes, type BroadcastAction, type ProcRecord, type Step } from "../tools/fleet/actions.js";
import {
  judgeStep,
  makeActionRoutes,
  mergeProcs,
  parsePsArgs,
  parsePsComm,
  runPlan,
  type ActionDeps,
  type ActionIo,
  type StepRun,
} from "../tools/fleet/routes-actions.js";
import { createRateLimiter } from "../tools/fleet/routes-steer.js";
import { makeActionsApi } from "../tools/fleet/web/src/actions-client";
import { SteeringQueue } from "../tools/fleet/queue.js";
import type { FleetStatus } from "../tools/fleet/status.js";
import type { SteerResult, SteerTarget } from "../tools/fleet/steer.js";

/* ------------------------------------------------------------------ *
 * Fakes: a request, a response, the box, and the delivery module.
 * ------------------------------------------------------------------ */

const HOST = "100.90.80.70:8787";
const ORIGIN = `http://${HOST}`;
/**
 * DISTINCT FROM `fleet-steer-route.test.ts`'s, AND NOT AN EXEMPTION.
 *
 * This file was written by copying that one's fakes, so it copied its uuid too,
 * and `tests/fixture-ids.test.ts` went red on `dev`. Nothing here inserts a
 * database row — these are HTTP route tests against fakes — so an entry in that
 * guard's `NOT_A_ROW` would have been *semantically* right and is still the
 * wrong fix: it would leave two files sharing one id, and the next fleet route
 * test copied from either would reach for the same digits again. A distinct id
 * costs nothing and keeps the guard live for both files.
 *
 * The `1111-4222-8333-4444…` shape is the trap rather than the accident: it is
 * what anyone reaches for, which is exactly why two files reached for it.
 */
const CLAUDE_ID = "117e181a-ac71-4092-b3ee-5d0a1e7c9f42";
const PRIMARY = "/home/greg/fixture-checkout";
const WORKTREE = `${PRIMARY}/.claude/worktrees/wf-fixture`;

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

/** A request as a real stream, so the body cap is exercised rather than bypassed. */
function fakeReq(opts: { url?: string; method?: string; headers?: Record<string, string>; body?: unknown }): import("node:http").IncomingMessage {
  const stream = new PassThrough();
  const body = opts.body === undefined ? "" : typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  if (body !== "") stream.write(body);
  stream.end();
  return Object.assign(stream, {
    url: opts.url ?? "/api/actions/session",
    method: opts.method ?? "POST",
    headers: { host: HOST, origin: ORIGIN, "content-type": "application/json", ...opts.headers },
    socket: { remoteAddress: "100.90.80.71" },
  }) as unknown as import("node:http").IncomingMessage;
}

const OK_STEP: StepRun = { code: 0, stdout: "", stderr: "", timedOut: false, spawnError: null };

type Invocation = { argv: readonly string[]; cwd: string };

/** The box, as a recorder. Nothing it is asked to do actually happens. */
function fakeIo(opts: {
  step?: (step: Step, index: number) => StepRun;
  procs?: readonly ProcRecord[];
  scanFailure?: string;
  selfPid?: number;
}): { io: ActionIo; ran: Invocation[] } {
  const ran: Invocation[] = [];
  const io: ActionIo = {
    runStep: (step) => {
      const index = ran.length;
      ran.push({ argv: step.argv, cwd: step.cwd });
      if (opts.step) return Promise.resolve(opts.step(step, index));
      // The default is "the box is in the state the plan expects", which for an
      // `exit-zero` step is `OK_STEP` and for a `stdout-has-line` step has to
      // be the line — an empty stdout is a step that FAILED, not one nobody
      // arranged. Writing it here rather than in each caller keeps the four
      // enacted tests about what they are testing; the tests that want the
      // pairing to fail pass an explicit `step`, and there is one below for
      // every `stdout-has-line` step in the file.
      const pass = step.pass;
      return Promise.resolve(pass.kind === "stdout-has-line" ? { ...OK_STEP, stdout: `${pass.line}\n` } : OK_STEP);
    },
    listProcesses: () =>
      Promise.resolve(
        opts.scanFailure !== undefined
          ? { ok: false as const, why: opts.scanFailure }
          : { ok: true as const, procs: [...(opts.procs ?? [])], unreadable: 0 },
      ),
    selfPid: () => opts.selfPid ?? 999_999,
  };
  return { io, ran };
}

type Sent = { target: SteerTarget; text: string; declaredStatus: FleetStatus };

const SENT_OK: SteerResult = {
  ok: true,
  verified: { paneId: "%99001", sessionId: "$99001", panePid: 424242, claudePid: 424299 },
  sent: [["send-keys", "-t", "%99001", "-l", "--", "…"]],
};

/**
 * Which run of the server this harness's queue is, when a test does not care.
 *
 * A FIXED VALUE RATHER THAN A RANDOM ONE, so a failure message names the same
 * id twice and a test that accidentally depends on the shape of an id fails the
 * same way every time. The tests that DO care pass `instanceId` and get two.
 */
const INSTANCE = "1a2b3c4d";

function harness(
  over: Partial<ActionDeps> & {
    io?: ActionIo;
    result?: SteerResult | ((t: SteerTarget) => SteerResult);
    /** Which run of the server this is. Two harnesses with two of these is a restart. */
    instanceId?: string;
  } = {},
) {
  const sent: Sent[] = [];
  const logs: string[] = [];
  let clock = 1_000_000;
  const queue = over.queue ?? new SteeringQueue({ now: () => clock, serverInstanceId: over.instanceId ?? INSTANCE });
  const { result, instanceId: _instanceId, ...rest } = over;
  const routes = makeActionRoutes({
    queue,
    sendMessage: (target, text, declaredStatus) => {
      sent.push({ target, text, declaredStatus });
      return typeof result === "function" ? result(target) : (result ?? SENT_OK);
    },
    now: () => clock,
    // Generous by default, so an ordinary test is not accidentally a test of
    // the rate limiter. There is a describe block below that drives a tight one.
    limiter: createRateLimiter({ minIntervalMs: 0, burstMax: 1_000, burstWindowMs: 1 }),
    log: (line) => logs.push(line),
    // ON BY DEFAULT IN THE HARNESS, off by default in production — the same
    // asymmetry, and for the same reason, as `answeringEnabled` in the steering
    // route's tests: otherwise every test below would silently be a test of the
    // disabled path. The gate has its own block.
    actEnabled: () => true,
    primaryDir: () => PRIMARY,
    ...rest,
  });
  return { routes, sent, logs, queue, tick: (ms: number) => (clock += ms), now: () => clock };
}

async function call(
  routes: ReturnType<typeof harness>["routes"],
  req: import("node:http").IncomingMessage,
): Promise<FakeRes & { json: Record<string, unknown> }> {
  const { res, seen } = fakeRes();
  const handled = routes.handle(req, res);
  expect(handled).toBe(true);
  await seen.done;
  return { ...seen, json: seen.body === "" ? {} : (JSON.parse(seen.body) as Record<string, unknown>) };
}

/**
 * The dashboard's own `fetch`, wired straight to these routes.
 *
 * **So that the client's parse and the server's response meet with nothing
 * hand-written in between.** A fixture of a response is a claim about the
 * producer that nothing checks against the producer — which is how
 * `actions-client.ts` came to read a field name (`would`) that no route has
 * ever sent, under a fixture that supplied it. Driving `makeActionsApi` through
 * the real handler is the only version of this test that can fail.
 */
function browserFetch(routes: ReturnType<typeof harness>["routes"]): typeof fetch {
  return (async (input: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) => {
    // The client posts to a RELATIVE url, as a browser on the dashboard does,
    // and its GETs carry no content type — the default here is `fetch`'s, not
    // this file's convenience, so a route that checks the method sees what the
    // browser would send.
    const method = init?.method ?? "GET";
    const r = await call(
      routes,
      fakeReq({
        url: `/${String(input)}`,
        method,
        body: init?.body ?? "",
        headers: init?.headers ?? (method === "GET" ? { "content-type": "" } : {}),
      }),
    );
    return new Response(r.body, { status: r.status ?? 500 });
  }) as unknown as typeof fetch;
}

/**
 * The `result` of a 200, which is where every arm that describes an effect puts
 * what it did or would do.
 *
 * A helper rather than `r.json.candidates` at fifteen call sites, because the
 * flat spelling is what the client could not read: each arm named its own
 * top-level field, `actions-client.ts` looked for one name none of them used,
 * and the confirmation in front of a kill drew the word "null". Reading through
 * one accessor here mirrors the one accessor there.
 */
function resultOf(r: { json: Record<string, unknown> }): Record<string, unknown> {
  return (r.json["result"] ?? {}) as Record<string, unknown>;
}

/** The body the client sends for a session action, in one place. */
function sessionBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    paneId: "%99001",
    sessionId: "$99001",
    claudeSessionId: CLAUDE_ID,
    panePid: 424242,
    status: { kind: "idle" },
    actionId: "continue",
    ...over,
  };
}

function recipient(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { paneId: "%99001", sessionId: "$99001", claudeSessionId: CLAUDE_ID, panePid: 424242, status: { kind: "idle" }, ...over };
}

function proc(over: Partial<ProcRecord>): ProcRecord {
  return { pid: 5000, ppid: 4000, comm: "node", args: "node index.js", cwd: "/home/greg", rssKiB: 1000, etimeSeconds: 60, ...over };
}

const VITEST_ARGS = `${PRIMARY}/node_modules/.bin/vitest run`;

/* ================================================================== *
 * The catalogue and the queues.
 * ================================================================== */

describe("GET /api/actions", () => {
  it("serves the vocabulary from actions.ts rather than a copy", async () => {
    const { routes } = harness();
    const r = await call(routes, fakeReq({ url: "/api/actions", method: "GET", headers: { "content-type": "" } }));
    expect(r.status).toBe(200);
    const actions = r.json.actions as { session: { id: string; scope: string }[]; box: { id: string; scope: string }[] };
    expect(actions.session.map((a) => a.id)).toContain("continue");
    expect(actions.box.map((a) => a.id)).toEqual(
      expect.arrayContaining(["kill-test-suites", "kill-safe-processes", "resource-broadcast"]),
    );
    // Every entry is in the half its own scope puts it in. A route that filtered
    // by a hand-written list would pass the two assertions above.
    expect(actions.session.every((a) => a.scope === "session")).toBe(true);
    expect(actions.box.every((a) => a.scope === "box")).toBe(true);
  });

  it("shows a queued item, and says the queue is volatile", async () => {
    const { routes, queue } = harness();
    queue.enqueueAction({ sessionId: "$99001", claudeSessionId: CLAUDE_ID }, "pull", "greg");
    const r = await call(routes, fakeReq({ url: "/api/actions", method: "GET", headers: { "content-type": "" } }));
    const queues = r.json.queues as { sessionId: string; items: { id: string; stale: boolean; stuck: boolean; payload: { kind: string; action?: { id: string } } }[]; volatile: boolean; warning: string; deliverable: number }[];
    expect(queues).toHaveLength(1);
    expect(queues[0]?.sessionId).toBe("$99001");
    expect(queues[0]?.items.map((i) => i.payload.action?.id)).toEqual(["pull"]);
    expect(queues[0]?.items[0]?.stale).toBe(false);
    expect(queues[0]?.items[0]?.stuck).toBe(false);
    expect(queues[0]?.deliverable).toBe(1);
    expect(queues[0]?.volatile).toBe(true);
    // The warning is the queue's own sentence, not one written here.
    expect(queues[0]?.warning).toContain("Restarting it discards every one of them");
  });

  it("counts what could still be delivered, not what is in the list", async () => {
    // The page decides whether to offer Queue on an idle session by asking
    // whether anything is already ahead of the new message. An item the tmux
    // generation has killed, or one past `maxAgeMs`, is not ahead of anything —
    // it will never be delivered — so counting it would offer the button on the
    // strength of an ordering guarantee that does not exist. **The rule is the
    // queue's**, the same argument as `stale` above: a page that decided it
    // would be a second opinion, and the two would drift.
    const { routes, queue, tick } = harness();
    queue.enqueueAction({ sessionId: "$99001", claudeSessionId: CLAUDE_ID }, "pull", "greg");
    queue.noteGeneration(132_280);
    queue.noteGeneration(400_100);
    queue.enqueueAction({ sessionId: "$99001", claudeSessionId: CLAUDE_ID }, "push", "greg");
    tick(31 * 60_000);
    queue.enqueueAction({ sessionId: "$99001", claudeSessionId: CLAUDE_ID }, "continue", "greg");

    const r = await call(routes, fakeReq({ url: "/api/actions", method: "GET", headers: { "content-type": "" } }));
    const queues = r.json.queues as { items: { stale: boolean; invalidated: string | null }[]; deliverable: number }[];

    // Three items: one dead, one stale, one fresh. Only the last can go.
    expect(queues[0]?.items).toHaveLength(3);
    expect(queues[0]?.items[0]?.invalidated).not.toBe(null);
    expect(queues[0]?.items[1]?.stale).toBe(true);
    expect(queues[0]?.deliverable).toBe(1);
  });

  it("tells the page whether acting is switched on, rather than leaving it to guess", async () => {
    const on = await call(harness({ actEnabled: () => true }).routes, fakeReq({ url: "/api/actions", method: "GET", headers: { "content-type": "" } }));
    const off = await call(harness({ actEnabled: () => false }).routes, fakeReq({ url: "/api/actions", method: "GET", headers: { "content-type": "" } }));
    expect((on.json.acting as { enabled: boolean }).enabled).toBe(true);
    expect((off.json.acting as { enabled: boolean; why: string }).enabled).toBe(false);
    expect((off.json.acting as { why: string }).why).toContain("FLEET_ACT_ENABLED=1");
  });

  it("tells the page acting is off in words the page actually reads", async () => {
    // THE THIRD LIVE ONE. The route has sent `acting` since it was written,
    // under a comment saying the alternative is "a person discovering it by
    // tapping and getting a 503" — and `parseActionsFeed` did not read it, so
    // that is precisely what the page did. `FLEET_ACT_ENABLED` is off in
    // production, which makes this the state of every enacted button there.
    const off = await makeActionsApi(browserFetch(harness({ actEnabled: () => false }).routes)).feed();
    expect(off.ok).toBe(true);
    expect(off.ok && off.feed.acting.kind).toBe("off");
    expect(off.ok && off.feed.acting.kind === "off" && off.feed.acting.why).toContain("FLEET_ACT_ENABLED=1");

    const on = await makeActionsApi(browserFetch(harness({ actEnabled: () => true }).routes)).feed();
    expect(on.ok && on.feed.acting.kind).toBe("on");
  });

  it("is a GET, and refuses to act on any other method", async () => {
    const { routes } = harness();
    const r = await call(routes, fakeReq({ url: "/api/actions", method: "POST" }));
    expect(r.status).toBe(405);
    expect(r.headers.allow).toBe("GET");
  });

  it("claims its whole namespace, so nothing under web/dist/ can answer for it", async () => {
    const { routes } = harness();
    const { res, seen } = fakeRes();
    expect(routes.handle(fakeReq({ url: "/api/actions/nonsense", method: "POST" }), res)).toBe(true);
    await seen.done;
    expect(seen.status).toBe(400);
    // And a path outside the namespace is emphatically not ours.
    const other = fakeRes();
    expect(routes.handle(fakeReq({ url: "/api/state", method: "GET" }), other.res)).toBe(false);
    expect(other.seen.status).toBe(null);
  });
});

/* ================================================================== *
 * The CSRF triple, borrowed whole from the steering route.
 * ================================================================== */

describe("who is allowed to POST", () => {
  it("refuses a cross-origin write and accepts a same-origin one", async () => {
    const { routes, queue } = harness();
    const bad = await call(routes, fakeReq({ body: sessionBody(), headers: { origin: "http://evil.example" } }));
    expect(bad.status).toBe(403);
    expect(bad.json.code).toBe("forbidden-origin");
    expect(queue.size("$99001")).toBe(0);

    const good = await call(routes, fakeReq({ body: sessionBody() }));
    expect(good.status).toBe(200);
    expect(queue.size("$99001")).toBe(1);
  });

  it("refuses a rebindable hostname even when Origin and Host agree", async () => {
    const { routes } = harness();
    const r = await call(
      routes,
      fakeReq({ body: sessionBody(), headers: { host: "evil.example", origin: "http://evil.example" } }),
    );
    expect(r.status).toBe(403);
    expect(r.json.why).toContain("evil.example");
  });

  it("refuses a body that is not JSON, and one that is not an object", async () => {
    const { routes } = harness();
    const notJson = await call(routes, fakeReq({ body: "{" }));
    expect(notJson.status).toBe(400);
    expect(notJson.json.code).toBe("bad-request");
    const notObject = await call(routes, fakeReq({ body: "[1,2,3]" }));
    expect(notObject.json.why).toContain("not a JSON object");
  });
});

/* ================================================================== *
 * Enqueueing: the ordinary path, and the one nothing is sent from.
 * ================================================================== */

describe("POST /api/actions/session — enqueueing", () => {
  it("queues a spoken action and sends nothing", async () => {
    const { routes, queue, sent } = harness();
    const r = await call(routes, fakeReq({ body: sessionBody({ actionId: "report-status" }) }));
    expect(r.status).toBe(200);
    expect(r.json.op).toBe("enqueued");
    expect(queue.snapshot("$99001").items.map((i) => (i.payload.kind === "action" ? i.payload.action.id : null))).toEqual(["report-status"]);
    // The queue drains elsewhere. This route never types into a session.
    expect(sent).toEqual([]);
  });

  it("queues a free-text message, and refuses one steer.ts could never send", async () => {
    const { routes, queue } = harness();
    const ok = await call(routes, fakeReq({ body: sessionBody({ actionId: null, text: "merge origin/dev first" }) }));
    expect(ok.status).toBe(200);
    expect(queue.snapshot("$99001").items.map((i) => (i.payload.kind === "message" ? i.payload.text : null))).toEqual(["merge origin/dev first"]);

    const twoLines = await call(routes, fakeReq({ body: sessionBody({ actionId: null, text: "first line\nsecond line" }) }));
    expect(twoLines.status).toBe(400);
    // checkText's own sentence, via the queue — not one written in the route.
    expect(String(twoLines.json.why)).toMatch(/line/i);
    expect(queue.size("$99001")).toBe(1);
  });

  it("refuses a body with both an actionId and a text", async () => {
    const { routes, queue } = harness();
    const r = await call(routes, fakeReq({ body: sessionBody({ actionId: "continue", text: "or this" }) }));
    expect(r.status).toBe(400);
    expect(r.json.why).toContain("not both");
    expect(queue.size("$99001")).toBe(0);
  });

  it("queues for a session that is WORKING, which is what the queue is for", async () => {
    const { routes, queue } = harness();
    const r = await call(routes, fakeReq({ body: sessionBody({ status: { kind: "working" } }) }));
    expect(r.status).toBe(200);
    expect((r.json.gate as { kind: string }).kind).toBe("later");
    expect(queue.size("$99001")).toBe(1);
  });

  it("queues for a session that is ASKING, and says it will wait rather than go now", async () => {
    // The two gates answer different questions, and this field answers the
    // page's: `drainGate` permits a `needs-you` session (it is a live Claude at
    // a live pane, so the item is a good one) while the drain holds it until
    // the dialog is dealt with, because a message typed at a dialog answers it.
    const { routes, queue } = harness();
    const r = await call(routes, fakeReq({ body: sessionBody({ status: { kind: "needs-you" } }) }));
    expect(r.status).toBe(200);
    expect((r.json.gate as { kind: string }).kind).toBe("later");
    expect(queue.size("$99001")).toBe(1);
  });

  it("refuses now what could never drain, in steer.ts's own words", async () => {
    const { routes, queue } = harness();
    const shell = await call(routes, fakeReq({ body: sessionBody({ status: { kind: "shell", busy: false } }) }));
    expect(shell.status).toBe(409);
    expect(shell.json.code).toBe("not-steerable");
    // The sentence is the delivery module's, and it names the actual danger.
    expect(String(shell.json.why)).toMatch(/execute/i);
    expect(queue.size("$99001")).toBe(0);

    const noClaude = await call(routes, fakeReq({ body: sessionBody({ status: { kind: "no-claude" } }) }));
    expect(noClaude.json.code).toBe("not-steerable");
    expect(queue.size("$99001")).toBe(0);
  });

  it("refuses a box-wide action in one session's queue", async () => {
    const { routes, queue } = harness();
    const r = await call(routes, fakeReq({ body: sessionBody({ actionId: "resource-broadcast", confirm: true }) }));
    expect(r.status).toBe(400);
    expect(r.json.code).toBe("wrong-scope");
    expect(queue.size("$99001")).toBe(0);
  });

  it("requires a second tap for anything the catalogue marks needsConfirm", async () => {
    const { routes, queue } = harness();
    // `push` is a spoken action with needsConfirm — the gate is derived from the
    // catalogue, so this covers every enacted action too, without naming them.
    const without = await call(routes, fakeReq({ body: sessionBody({ actionId: "push" }) }));
    expect(without.status).toBe(400);
    expect(without.json.code).toBe("confirm-required");
    expect(queue.size("$99001")).toBe(0);

    const with_ = await call(routes, fakeReq({ body: sessionBody({ actionId: "push", confirm: true }) }));
    expect(with_.status).toBe(200);
    expect(queue.size("$99001")).toBe(1);
  });

  it("refuses an action nobody has ever heard of", async () => {
    const { routes } = harness();
    const r = await call(routes, fakeReq({ body: sessionBody({ actionId: "rm-rf-slash" }) }));
    expect(r.status).toBe(400);
    expect(r.json.why).toContain("rm-rf-slash");
  });
});

/* ================================================================== *
 * Cancelling.
 * ================================================================== */

describe("cancelling a queued item", () => {
  it("takes it out of the queue, by POST and by DELETE", async () => {
    const { routes, queue } = harness();
    queue.enqueueAction({ sessionId: "$99001", claudeSessionId: CLAUDE_ID }, "pull", "greg");
    queue.enqueueAction({ sessionId: "$99001", claudeSessionId: CLAUDE_ID }, "push", "greg");
    const ids = queue.snapshot("$99001").items.map((i) => i.id);
    expect(ids).toHaveLength(2);

    const first = await call(routes, fakeReq({ url: "/api/actions/cancel", body: { sessionId: "$99001", itemId: ids[0] } }));
    expect(first.status).toBe(200);
    expect(queue.snapshot("$99001").items.map((i) => i.id)).toEqual([ids[1]]);

    const second = await call(
      routes,
      fakeReq({ url: "/api/actions/cancel", method: "DELETE", body: { sessionId: "$99001", itemId: ids[1] } }),
    );
    expect(second.status).toBe(200);
    expect(queue.snapshot("$99001").items).toEqual([]);
  });

  it("tells 'there is nothing there' apart from 'it is going out right now'", async () => {
    const { routes, queue } = harness();
    queue.enqueueAction({ sessionId: "$99001", claudeSessionId: CLAUDE_ID }, "pull", "greg");
    const id = queue.snapshot("$99001").items[0]?.id ?? "";

    const missing = await call(routes, fakeReq({ url: "/api/actions/cancel", body: { sessionId: "$99001", itemId: "q999" } }));
    expect(missing.status).toBe(404);
    expect(missing.json.code).toBe("no-such-item");

    // Lease it, the way a drainer would.
    const leased = queue.next("$99001", { status: { kind: "idle" }, claudeSessionId: CLAUDE_ID });
    expect(leased.kind).toBe("ready");
    const inFlight = await call(routes, fakeReq({ url: "/api/actions/cancel", body: { sessionId: "$99001", itemId: id } }));
    expect(inFlight.status).toBe(409);
    expect(inFlight.json.code).toBe("in-flight");
    // And it is still there, because pretending otherwise is the dishonest option.
    expect(queue.snapshot("$99001").items.map((i) => i.id)).toEqual([id]);
  });
});

/* ================================================================== *
 * The two recovery routes. Both exist because a queue state the product
 * could reach had no gesture that got out of it — GPT Sol's D2 and D4.
 * ================================================================== */

const IDLE_CTX = { status: { kind: "idle" as const }, claudeSessionId: CLAUDE_ID };

describe("re-arming an item that has waited too long", () => {
  it("re-arms it, so the next pass can deliver it", async () => {
    // `SteeringQueue.revive()` was built and no route reached it, so an item
    // past `maxAgeMs` was a thing the page drew, promised, and could not send —
    // this stage's own bug in a state nobody had looked at.
    const { routes, queue, tick } = harness();
    queue.enqueueAction({ sessionId: "$99001", claudeSessionId: CLAUDE_ID }, "pull", "greg");
    const id = queue.snapshot("$99001").items[0]?.id ?? "";
    tick(31 * 60_000);
    expect(queue.next("$99001", IDLE_CTX).kind).toBe("stale");

    const r = await call(routes, fakeReq({ url: "/api/actions/revive", body: { sessionId: "$99001", itemId: id } }));

    expect(r.status).toBe(200);
    expect(r.json.op).toBe("revived");
    expect(queue.next("$99001", IDLE_CTX).kind).toBe("ready");
  });

  it("tells 'there is nothing there' apart from 'it is going out right now'", async () => {
    const { routes, queue } = harness();
    queue.enqueueAction({ sessionId: "$99001", claudeSessionId: CLAUDE_ID }, "pull", "greg");
    const id = queue.snapshot("$99001").items[0]?.id ?? "";

    const missing = await call(routes, fakeReq({ url: "/api/actions/revive", body: { sessionId: "$99001", itemId: "q999" } }));
    expect(missing.status).toBe(404);
    expect(missing.json.code).toBe("no-such-item");

    expect(queue.next("$99001", IDLE_CTX).kind).toBe("ready");
    const leased = await call(routes, fakeReq({ url: "/api/actions/revive", body: { sessionId: "$99001", itemId: id } }));
    expect(leased.status).toBe(409);
    expect(leased.json.code).toBe("in-flight");
  });

  it("is a write, so a GET at it may not act", async () => {
    const { routes, queue } = harness();
    queue.enqueueAction({ sessionId: "$99001", claudeSessionId: CLAUDE_ID }, "pull", "greg");
    const r = await call(routes, fakeReq({ url: "/api/actions/revive", method: "GET", headers: { "content-type": "" } }));
    expect(r.status).toBe(405);
  });

  it("refuses a cross-origin re-arm, the same as every other write", async () => {
    const { routes, queue } = harness();
    queue.enqueueAction({ sessionId: "$99001", claudeSessionId: CLAUDE_ID }, "pull", "greg");
    const id = queue.snapshot("$99001").items[0]?.id ?? "";
    const r = await call(
      routes,
      fakeReq({ url: "/api/actions/revive", headers: { origin: "http://evil.example" }, body: { sessionId: "$99001", itemId: id } }),
    );
    expect(r.status).toBe(403);
    expect(r.json.code).toBe("forbidden-origin");
  });
});

describe("abandoning a lease nobody settled", () => {
  /** Lease it and let the lease go stuck, which is what a thrown send leaves behind. */
  function wedge(h: ReturnType<typeof harness>): string {
    h.queue.enqueueAction({ sessionId: "$99001", claudeSessionId: CLAUDE_ID }, "pull", "greg");
    h.queue.enqueueAction({ sessionId: "$99001", claudeSessionId: CLAUDE_ID }, "push", "greg");
    const leased = h.queue.next("$99001", IDLE_CTX);
    if (leased.kind !== "ready") throw new Error("expected a lease");
    return leased.item.id;
  }

  it("clears a stuck lease, and the rest of the queue can drain again", async () => {
    // `drain.ts` deliberately leaves the lease open when `sendMessage` throws —
    // nothing can tell "died before the keystrokes" from "died after", so a
    // person decides. **There was no way for a person to decide.** `cancel()`
    // refuses a leased item, `clear()` keeps it, and `settle(…, "abandoned")`
    // had no route, so one thrown send wedged that session's queue for ever.
    const h = harness();
    const id = wedge(h);
    h.tick(61_000);
    expect(h.queue.next("$99001", IDLE_CTX).kind).toBe("stuck");

    const r = await call(h.routes, fakeReq({ url: "/api/actions/abandon", body: { sessionId: "$99001", itemId: id } }));

    expect(r.status).toBe(200);
    expect(r.json.op).toBe("abandoned");
    // The wedged item is gone and the one behind it is deliverable again.
    expect(h.queue.snapshot("$99001").items.map((i) => i.id)).not.toContain(id);
    expect(h.queue.next("$99001", IDLE_CTX).kind).toBe("ready");
  });

  it("will not abandon a lease that is still in flight, using the queue's own rule", async () => {
    // The distinction is `leaseMs`, and it is the queue's — `next()` has both
    // arms. Abandoning a send that is still going out would clear a lease while
    // the keystrokes are on their way, which is the one thing the open lease
    // exists to stop.
    const h = harness();
    const id = wedge(h);

    const r = await call(h.routes, fakeReq({ url: "/api/actions/abandon", body: { sessionId: "$99001", itemId: id } }));

    expect(r.status).toBe(409);
    expect(r.json.code).toBe("in-flight");
    expect(h.queue.snapshot("$99001").items.map((i) => i.id)).toContain(id);
  });

  it("refuses an item that was never handed out, and names the gesture that fits", async () => {
    const h = harness();
    h.queue.enqueueAction({ sessionId: "$99001", claudeSessionId: CLAUDE_ID }, "pull", "greg");
    const id = h.queue.snapshot("$99001").items[0]?.id ?? "";

    const r = await call(h.routes, fakeReq({ url: "/api/actions/abandon", body: { sessionId: "$99001", itemId: id } }));

    expect(r.status).toBe(400);
    expect(String(r.json.why)).toContain("cancel");
    expect(h.queue.snapshot("$99001").items.map((i) => i.id)).toContain(id);
  });

  it("says there is nothing there when there is nothing there", async () => {
    const h = harness();
    const r = await call(h.routes, fakeReq({ url: "/api/actions/abandon", body: { sessionId: "$99001", itemId: "q999" } }));
    expect(r.status).toBe(404);
    expect(r.json.code).toBe("no-such-item");
  });

  it("is a write, so a GET at it may not act", async () => {
    const h = harness();
    const r = await call(h.routes, fakeReq({ url: "/api/actions/abandon", method: "GET", headers: { "content-type": "" } }));
    expect(r.status).toBe(405);
  });
});

/* ================================================================== *
 * Emptying a queue. Instance 9 of docs/postmortems/260908b: `clear()` was
 * written, bounded and tested, and nothing in the product could reach it.
 * ================================================================== */

describe("clearing a whole session's queue", () => {
  /** Three items, the first of them leased — which is the case the whole design is about. */
  function loaded(h: ReturnType<typeof harness>): { leased: string; waiting: string[] } {
    for (const id of ["continue", "pull", "run-checks"] as const) {
      h.queue.enqueueAction({ sessionId: "$99001", claudeSessionId: CLAUDE_ID }, id, "greg");
    }
    const out = h.queue.next("$99001", IDLE_CTX);
    if (out.kind !== "ready") throw new Error("expected a lease");
    return {
      leased: out.item.id,
      waiting: h.queue.snapshot("$99001").items.filter((i) => i.leasedAt === null).map((i) => i.id),
    };
  }

  it("drops what was waiting, keeps what is going out, and says which is which — through the client", async () => {
    /*
     * **THE TEST THAT FAILS IF NOTHING CALLS `clear()`.** That is the detector
     * for this whole class (docs/postmortems/260908b § Class A: *who calls this,
     * on a path a person can reach?*), and it is why this drives
     * `makeActionsApi` over `browserFetch` rather than calling the method: the
     * method had 2 test call sites and 0 product ones and looked perfectly
     * healthy. What is asserted is the real `SteeringQueue` afterwards, and the
     * answer the browser's own parser made of the response.
     */
    const h = harness();
    const { leased, waiting } = loaded(h);
    expect(waiting).toHaveLength(2);

    const outcome = await makeActionsApi(browserFetch(h.routes)).clear("$99001", waiting);

    if (!outcome.ok) throw new Error(`expected a clear, got ${outcome.why}`);
    if (outcome.kind !== "queue-cleared") throw new Error(`expected queue-cleared, got ${outcome.kind}`);
    expect(outcome.removed.map((i) => i.id)).toEqual(waiting);
    // The safety property, on the wire and off it: the leased item survived and
    // is NAMED, so nothing can report this as "the queue is empty now".
    expect(outcome.keptInFlight?.id).toBe(leased);
    expect(h.queue.snapshot("$99001").items.map((i) => i.id)).toEqual([leased]);
  });

  it("says nothing stayed when nothing was going out", async () => {
    // The other half of the same claim. `keptInFlight: null` is a positive
    // answer — the queue really is empty — and it has to be distinguishable
    // from the arm above rather than both reading as "cleared".
    const h = harness();
    h.queue.enqueueAction({ sessionId: "$99001", claudeSessionId: CLAUDE_ID }, "pull", "greg");
    const ids = h.queue.snapshot("$99001").items.map((i) => i.id);

    const outcome = await makeActionsApi(browserFetch(h.routes)).clear("$99001", ids);

    if (!outcome.ok || outcome.kind !== "queue-cleared") throw new Error("expected a clear");
    expect(outcome.keptInFlight).toBeNull();
    expect(h.queue.snapshot("$99001").items).toEqual([]);
  });

  it("refuses to drop an item that was not on the list the person read", async () => {
    // The point of sending ids at all. Something the reader never saw arrived
    // between the confirmation being drawn and the tap; destroying it silently
    // is the one thing a bulk delete must not do.
    const h = harness();
    h.queue.enqueueAction({ sessionId: "$99001", claudeSessionId: CLAUDE_ID }, "pull", "greg");
    const read = h.queue.snapshot("$99001").items.map((i) => i.id);
    h.queue.enqueueAction({ sessionId: "$99001", claudeSessionId: CLAUDE_ID }, "push", "greg");
    const arrived = h.queue.snapshot("$99001").items.map((i) => i.id).filter((id) => !read.includes(id));

    const r = await call(h.routes, fakeReq({ url: "/api/actions/clear", body: { sessionId: "$99001", itemIds: read } }));

    expect(r.status).toBe(409);
    expect(r.json.code).toBe("stale-view");
    expect(String(r.json.why)).toContain(arrived[0] ?? "");
    // And NOTHING was dropped. A partial clear would be the worst of both.
    expect(h.queue.snapshot("$99001").items).toHaveLength(2);
  });

  it("refuses a list naming something that is no longer waiting", async () => {
    const h = harness();
    h.queue.enqueueAction({ sessionId: "$99001", claudeSessionId: CLAUDE_ID }, "pull", "greg");
    const ids = h.queue.snapshot("$99001").items.map((i) => i.id);

    const r = await call(
      h.routes,
      fakeReq({ url: "/api/actions/clear", body: { sessionId: "$99001", itemIds: [...ids, "q999"] } }),
    );

    expect(r.status).toBe(409);
    expect(r.json.code).toBe("stale-view");
    expect(String(r.json.why)).toContain("q999");
    expect(h.queue.snapshot("$99001").items).toHaveLength(1);
  });

  it("will not clear a queue whose only item is already going out", async () => {
    // `clear()` would keep it and remove nothing, and answering 200 to that
    // would be a "cleared" that cleared nothing.
    const h = harness();
    h.queue.enqueueAction({ sessionId: "$99001", claudeSessionId: CLAUDE_ID }, "pull", "greg");
    const out = h.queue.next("$99001", IDLE_CTX);
    expect(out.kind).toBe("ready");

    const r = await call(h.routes, fakeReq({ url: "/api/actions/clear", body: { sessionId: "$99001", itemIds: [] } }));

    expect(r.status).toBe(404);
    expect(r.json.code).toBe("no-such-item");
    expect(h.queue.snapshot("$99001").items).toHaveLength(1);
  });

  it("refuses a body that does not say which items, rather than clearing sight unseen", async () => {
    const h = harness();
    h.queue.enqueueAction({ sessionId: "$99001", claudeSessionId: CLAUDE_ID }, "pull", "greg");

    const r = await call(h.routes, fakeReq({ url: "/api/actions/clear", body: { sessionId: "$99001" } }));

    expect(r.status).toBe(400);
    expect(r.json.code).toBe("bad-request");
    expect(h.queue.snapshot("$99001").items).toHaveLength(1);
  });

  it("is a write, so a GET at it may not act", async () => {
    const h = harness();
    h.queue.enqueueAction({ sessionId: "$99001", claudeSessionId: CLAUDE_ID }, "pull", "greg");
    const r = await call(h.routes, fakeReq({ url: "/api/actions/clear", method: "GET", headers: { "content-type": "" } }));
    expect(r.status).toBe(405);
    expect(h.queue.snapshot("$99001").items).toHaveLength(1);
  });

  it("refuses a cross-origin clear, the same as every other write", async () => {
    const h = harness();
    h.queue.enqueueAction({ sessionId: "$99001", claudeSessionId: CLAUDE_ID }, "pull", "greg");
    const ids = h.queue.snapshot("$99001").items.map((i) => i.id);
    const r = await call(
      h.routes,
      fakeReq({ url: "/api/actions/clear", headers: { origin: "http://evil.example" }, body: { sessionId: "$99001", itemIds: ids } }),
    );
    expect(r.status).toBe(403);
    expect(r.json.code).toBe("forbidden-origin");
    expect(h.queue.snapshot("$99001").items).toHaveLength(1);
  });
});

/* ================================================================== *
 * An id minted by a previous run of this server.
 *
 * **THE HAZARD IS NOT "THE ITEM IS GONE", IT IS "THE ITEM IS SOMEBODY
 * ELSE'S".** The queue is volatile, so a restart empties it — but the very
 * next enqueue starts the counter again, so a phone that has been open across
 * a restart is holding ids the running server is busy re-issuing to different
 * work. Every one of these tests asserts what happened to the LIVE item, not
 * just the status code: an unprefixed build cancels, re-arms, abandons or
 * clears a stranger's instruction and answers 200.
 * ================================================================== */

describe("an item id from a previous run of the server", () => {
  const TARGET = { sessionId: "$99001", claudeSessionId: CLAUDE_ID };

  /**
   * Two servers in one process, which is exactly what a restart looks like from
   * the phone's side. Each has queued its own first item, so both counters are
   * at one and an unprefixed id collides by construction.
   */
  function twoRuns(): {
    dead: ReturnType<typeof harness>;
    live: ReturnType<typeof harness>;
    staleId: string;
    liveId: string;
  } {
    const dead = harness({ instanceId: "deadbeef" });
    const live = harness({ instanceId: "0badcafe" });
    dead.queue.enqueueAction(TARGET, "pull", "greg");
    live.queue.enqueueAction(TARGET, "push", "greg");
    return {
      dead,
      live,
      staleId: dead.queue.snapshot("$99001").items[0]?.id ?? "",
      liveId: live.queue.snapshot("$99001").items[0]?.id ?? "",
    };
  }

  it("cannot be confused with this run's, because the two runs mint different ids", () => {
    const { staleId, liveId } = twoRuns();
    // The whole defect in one line: without a prefix both of these are `q1`.
    expect(staleId).not.toBe(liveId);
  });

  it("does not cancel this run's item", async () => {
    const { live, staleId, liveId } = twoRuns();
    const r = await call(live.routes, fakeReq({ url: "/api/actions/cancel", body: { sessionId: "$99001", itemId: staleId } }));
    expect(r.json.code).toBe("other-instance");
    expect(r.status).toBe(409);
    // The fact that matters. The item nobody asked about is still queued.
    expect(live.queue.snapshot("$99001").items.map((i) => i.id)).toEqual([liveId]);
  });

  it("does not re-arm this run's item", async () => {
    const { live, staleId } = twoRuns();
    live.tick(31 * 60_000);
    expect(live.queue.next("$99001", IDLE_CTX).kind).toBe("stale");

    const r = await call(live.routes, fakeReq({ url: "/api/actions/revive", body: { sessionId: "$99001", itemId: staleId } }));

    expect(r.json.code).toBe("other-instance");
    expect(r.status).toBe(409);
    // Still stale: nothing was re-armed, so no pass will deliver it.
    expect(live.queue.next("$99001", IDLE_CTX).kind).toBe("stale");
  });

  it("does not abandon this run's lease", async () => {
    const { live, staleId, liveId } = twoRuns();
    const leased = live.queue.next("$99001", IDLE_CTX);
    expect(leased.kind).toBe("ready");
    live.tick(61_000);
    expect(live.queue.next("$99001", IDLE_CTX).kind).toBe("stuck");

    const r = await call(live.routes, fakeReq({ url: "/api/actions/abandon", body: { sessionId: "$99001", itemId: staleId } }));

    expect(r.json.code).toBe("other-instance");
    expect(r.status).toBe(409);
    expect(live.queue.snapshot("$99001").items.map((i) => i.id)).toEqual([liveId]);
  });

  it("does not clear this run's queue", async () => {
    // **AND `stale-view` WOULD NOT HAVE CAUGHT IT.** `clear` compares the
    // client's list with the queue's droppable set, which is a guard against
    // CONCURRENT DRIFT — something arriving between the list being drawn and
    // the tap. An old `[q1]` posted against a restarted queue that also holds
    // exactly one item called `q1` passes that comparison exactly.
    const { live, staleId, liveId } = twoRuns();

    const r = await call(live.routes, fakeReq({ url: "/api/actions/clear", body: { sessionId: "$99001", itemIds: [staleId] } }));

    expect(r.json.code).toBe("other-instance");
    expect(r.status).toBe(409);
    expect(live.queue.snapshot("$99001").items.map((i) => i.id)).toEqual([liveId]);
  });

  it("says which server it came from, and does not say 'no such item'", async () => {
    // The two facts are different and the second one is the misleading one: it
    // invites the person to conclude the instruction was never queued.
    const { live, staleId } = twoRuns();
    const r = await call(live.routes, fakeReq({ url: "/api/actions/cancel", body: { sessionId: "$99001", itemId: staleId } }));
    expect(r.json.code).not.toBe("no-such-item");
    expect(String(r.json.why)).toContain(staleId);
    expect(String(r.json.why)).toContain("restart");
  });

  it("leaves an id that names no run at all as 'no such item'", async () => {
    // A hand-typed or garbled id is not evidence of a previous server, and
    // saying so would be a fresh false statement in place of the old one.
    const { live } = twoRuns();
    const r = await call(live.routes, fakeReq({ url: "/api/actions/cancel", body: { sessionId: "$99001", itemId: "q999" } }));
    expect(r.status).toBe(404);
    expect(r.json.code).toBe("no-such-item");
  });

  it("still lets this run's own ids through all four routes", async () => {
    // The paired positive. A refusal that fires on everything is not a guard,
    // it is an outage, and each of the four has its own copy of the check.
    const h = harness();
    for (const id of ["continue", "pull", "push", "run-checks"] as const) {
      h.queue.enqueueAction(TARGET, id, "greg");
    }
    const ids = h.queue.snapshot("$99001").items.map((i) => i.id);
    const [first, second, third, fourth] = ids as [string, string, string, string];

    const cancelled = await call(h.routes, fakeReq({ url: "/api/actions/cancel", body: { sessionId: "$99001", itemId: first } }));
    expect(cancelled.status).toBe(200);

    h.tick(31 * 60_000);
    const revived = await call(h.routes, fakeReq({ url: "/api/actions/revive", body: { sessionId: "$99001", itemId: second } }));
    expect(revived.status).toBe(200);

    const leased = h.queue.next("$99001", IDLE_CTX);
    if (leased.kind !== "ready") throw new Error("expected a lease");
    expect(leased.item.id).toBe(second);
    h.tick(61_000);
    const abandoned = await call(h.routes, fakeReq({ url: "/api/actions/abandon", body: { sessionId: "$99001", itemId: second } }));
    expect(abandoned.status).toBe(200);

    const cleared = await call(h.routes, fakeReq({ url: "/api/actions/clear", body: { sessionId: "$99001", itemIds: [third, fourth] } }));
    expect(cleared.status).toBe(200);
    expect(h.queue.snapshot("$99001").items).toEqual([]);
  });

  it("does not swallow `stale-view`, which answers a different question", async () => {
    // The two refusals must not merge. This one is entirely WITHIN one run:
    // the ids are this server's, and the list is simply out of date.
    const h = harness();
    h.queue.enqueueAction(TARGET, "pull", "greg");
    const read = h.queue.snapshot("$99001").items.map((i) => i.id);
    h.queue.enqueueAction(TARGET, "push", "greg");

    const r = await call(h.routes, fakeReq({ url: "/api/actions/clear", body: { sessionId: "$99001", itemIds: read } }));

    expect(r.status).toBe(409);
    expect(r.json.code).toBe("stale-view");
    expect(h.queue.snapshot("$99001").items).toHaveLength(2);
  });
});

/* ================================================================== *
 * The plan runner. The property here is the expensive one.
 * ================================================================== */

describe("runPlan", () => {
  const plan = {
    action: actionById("remove-worktree") as never,
    steps: [
      { argv: ["one"], cwd: "/tmp", why: "first", pass: { kind: "exit-zero" } },
      { argv: ["two"], cwd: "/tmp", why: "second", pass: { kind: "exit-zero" } },
      { argv: ["three"], cwd: "/tmp", why: "third", pass: { kind: "exit-zero" } },
    ] as readonly Step[],
  };

  it("runs every step in order when they all pass", async () => {
    const { io, ran } = fakeIo({});
    const run = await runPlan({ ...plan, action: plan.action }, io);
    expect(ran.map((r) => r.argv[0])).toEqual(["one", "two", "three"]);
    expect(run.completed).toBe(true);
    expect(run.stoppedAt).toBe(null);
  });

  it("STOPS at the first failed step and never runs a later one", async () => {
    const { io, ran } = fakeIo({ step: (_s, i) => (i === 0 ? { ...OK_STEP, code: 1 } : OK_STEP) });
    const run = await runPlan({ ...plan, action: plan.action }, io);
    // The whole point of the contract: `two` and `three` were never invoked.
    expect(ran.map((r) => r.argv[0])).toEqual(["one"]);
    expect(run.completed).toBe(false);
    expect(run.stoppedAt).toBe(0);
    expect(run.steps.map((s) => s.status)).toEqual(["failed"]);
  });

  it("carries on past a best-effort failure, and records it as a failure anyway", async () => {
    const kills = {
      action: actionById("kill-test-suites") as never,
      steps: [
        { argv: ["kill", "-TERM", "10"], cwd: "/tmp", why: "a", pass: { kind: "best-effort" } },
        { argv: ["kill", "-TERM", "11"], cwd: "/tmp", why: "b", pass: { kind: "best-effort" } },
      ] as readonly Step[],
    };
    const { io, ran } = fakeIo({ step: (_s, i) => (i === 0 ? { ...OK_STEP, code: 1, stderr: "no such process" } : OK_STEP) });
    const run = await runPlan(kills, io);
    expect(ran.map((r) => r.argv[2])).toEqual(["10", "11"]);
    expect(run.completed).toBe(true);
    // Recorded, not smoothed into a pass: eleven of thirty finding nothing there
    // is a fact worth reading.
    expect(run.steps.map((s) => s.status)).toEqual(["failed-ignored", "passed"]);
    expect(run.steps[0]?.tail).toBe("no such process");
  });
});

describe("judgeStep", () => {
  const line = (l: string): Step => ({ argv: ["tmux"], cwd: "/tmp", why: "", pass: { kind: "stdout-has-line", line: l } });

  it("passes stdout-has-line only on an exact trimmed line", () => {
    expect(judgeStep(line("$99001 wf-a"), { ...OK_STEP, stdout: "$99002 other\n$99001 wf-a\n" }).status).toBe("passed");
    // A prefix of the wanted line is not the line: `$99001 wf-a-2` must not
    // authorise a kill aimed at `wf-a`.
    expect(judgeStep(line("$99001 wf-a"), { ...OK_STEP, stdout: "$99001 wf-a-2\n" }).status).toBe("failed");
  });

  it("fails a killed step even when its output contains the line", () => {
    // A `tmux list-sessions` we killed at two minutes has told us nothing, and
    // the half-written output it left behind must not be read as evidence.
    const timedOut = judgeStep(line("$99001 wf-a"), { ...OK_STEP, stdout: "$99001 wf-a\n", timedOut: true });
    expect(timedOut.status).toBe("failed");
    expect(timedOut.verdict).toContain("too long");
    const noBinary = judgeStep(line("$99001 wf-a"), { ...OK_STEP, stdout: "$99001 wf-a\n", code: null, spawnError: "ENOENT: no tmux" });
    expect(noBinary.status).toBe("failed");
  });

  it("fails exit-zero on a non-zero exit and passes it on a zero", () => {
    const step: Step = { argv: ["npm"], cwd: "/tmp", why: "", pass: { kind: "exit-zero" } };
    expect(judgeStep(step, OK_STEP).status).toBe("passed");
    expect(judgeStep(step, { ...OK_STEP, code: 1 }).status).toBe("failed");
    expect(judgeStep(step, { ...OK_STEP, code: 2 }).verdict).toContain("exited 2");
  });
});

/* ================================================================== *
 * Enacted session actions: the four gates, and the plan.
 * ================================================================== */

describe("POST /api/actions/session — enacted", () => {
  const removeBody = (over: Record<string, unknown> = {}) =>
    sessionBody({ actionId: "remove-worktree", confirm: true, worktreeDir: WORKTREE, branch: "worktree-fixture", ...over });

  it("dry-runs the removal without running anything", async () => {
    const { io, ran } = fakeIo({});
    const { routes } = harness({ io });
    const r = await call(routes, fakeReq({ body: removeBody({ mode: "dry-run" }) }));
    expect(r.status).toBe(200);
    expect(r.json.op).toBe("dry-run");
    const steps = resultOf(r).steps as { argv: string[]; cwd: string }[];
    expect(steps.map((s) => s.argv)).toEqual([
      ["git", "-C", WORKTREE, "rev-parse", "--abbrev-ref", "HEAD"],
      ["npm", "run", "worktree:check"],
      ["npm", "run", "worktree:sweep", "--", "remove", "--branch", "worktree-fixture"],
    ]);
    expect(steps[0]?.cwd).toBe(PRIMARY);
    expect(steps[1]?.cwd).toBe(WORKTREE);
    expect(steps[2]?.cwd).toBe(PRIMARY);
    expect(ran).toEqual([]);
  });

  /**
   * The pairing step failing, which is what makes its presence mean anything.
   *
   * `worktreeDir` and `branch` reach this route as two independent claims off
   * one rendered row, and nothing downstream puts them back together: the check
   * runs in the directory, the sweep removes by branch. So a row that has gone
   * stale — the tree re-made on another branch, the page not refreshed — could
   * have the check clear one tree and the sweep remove another. Here the
   * directory turns out to be on `worktree-something-else`, and NOTHING RUNS
   * after the first step.
   */
  it("stops when the directory is not on the branch the page claimed", async () => {
    const { io, ran } = fakeIo({ step: () => ({ ...OK_STEP, stdout: "worktree-something-else\n" }) });
    const { routes } = harness({ io });
    const r = await call(routes, fakeReq({ body: removeBody({ mode: "run" }) }));
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("plan-failed");
    expect(ran.map((x) => x.argv[0])).toEqual(["git"]);
    const run = r.json.run as { stoppedAt: number; steps: { status: string }[] };
    expect(run.stoppedAt).toBe(0);
    expect(run.steps.map((s) => s.status)).toEqual(["failed"]);
  });

  it("refuses a directory outside this checkout's worktrees", async () => {
    const { io, ran } = fakeIo({});
    const { routes } = harness({ io });
    for (const dir of ["/home/greg/somewhere-else/.claude/worktrees/x", "/etc", PRIMARY]) {
      const r = await call(routes, fakeReq({ body: removeBody({ mode: "run", worktreeDir: dir }) }));
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(String(r.json.code)).toMatch(/plan-refused|bad-request/);
    }
    expect(ran).toEqual([]);
  });

  it("runs the removal in order, and STOPS when worktree:check says no", async () => {
    const { io, ran } = fakeIo({
      step: (_s, i) => (i === 1 ? { ...OK_STEP, code: 1, stdout: "blocked: data/ has 3 files" } : { ...OK_STEP, stdout: "worktree-fixture\n" }),
    });
    const { routes } = harness({ io });
    const r = await call(routes, fakeReq({ body: removeBody({ mode: "run" }) }));
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("plan-failed");
    // THE ASSERTION THIS WHOLE FILE IS FOR: the sweep was never invoked.
    expect(ran.map((x) => x.argv[0])).toEqual(["git", "npm"]);
    expect(ran[1]?.argv[2]).toBe("worktree:check");
    const run = r.json.run as { steps: { status: string }[]; stoppedAt: number };
    expect(run.stoppedAt).toBe(1);
    expect(run.steps.map((s) => s.status)).toEqual(["passed", "failed"]);
  });

  it("runs both steps when the check passes", async () => {
    const { io, ran } = fakeIo({});
    const { routes } = harness({ io });
    const r = await call(routes, fakeReq({ body: removeBody({ mode: "run" }) }));
    expect(r.status).toBe(200);
    expect(r.json.op).toBe("ran");
    expect(ran.map((x) => x.argv[0])).toEqual(["git", "npm", "npm"]);
    expect(ran.slice(1).map((x) => x.argv[2])).toEqual(["worktree:check", "worktree:sweep"]);
  });

  it("will not kill a session whose name no longer means that session", async () => {
    const killBody = (over: Record<string, unknown> = {}) =>
      sessionBody({ actionId: "kill-session", confirm: true, mode: "run", sessionName: "wf-fixture", ...over });

    // tmux lists a DIFFERENT handle against that name — the name was reassigned.
    const stale = fakeIo({ step: () => ({ ...OK_STEP, stdout: "$99002 wf-fixture\n$99001 something-else\n" }) });
    const bad = await call(harness({ io: stale.io }).routes, fakeReq({ body: killBody() }));
    expect(bad.status).toBe(409);
    expect(stale.ran.map((x) => x.argv[0])).toEqual(["tmux"]);

    // And with the pairing intact, gjd-remote is reached.
    const fresh = fakeIo({ step: () => ({ ...OK_STEP, stdout: "$99001 wf-fixture\n" }) });
    const good = await call(harness({ io: fresh.io }).routes, fakeReq({ body: killBody() }));
    expect(good.status).toBe(200);
    expect(fresh.ran.map((x) => x.argv[0])).toEqual(["tmux", "npx"]);
    expect(fresh.ran[1]?.argv).toContain("kill");
  });

  it("refuses to run without a confirm, and without the flag", async () => {
    const unconfirmed = fakeIo({});
    const a = await call(harness({ io: unconfirmed.io }).routes, fakeReq({ body: removeBody({ mode: "run", confirm: false }) }));
    expect(a.status).toBe(400);
    expect(a.json.code).toBe("confirm-required");
    expect(unconfirmed.ran).toEqual([]);

    const disabled = fakeIo({});
    const b = await call(harness({ io: disabled.io, actEnabled: () => false }).routes, fakeReq({ body: removeBody({ mode: "run" }) }));
    expect(b.status).toBe(503);
    expect(b.json.code).toBe("acting-disabled");
    expect(String(b.json.why)).toContain("FLEET_ACT_ENABLED=1");
    expect(disabled.ran).toEqual([]);

    // A dry run is not gated by the flag: asking what it would do is free.
    const dry = await call(harness({ io: disabled.io, actEnabled: () => false }).routes, fakeReq({ body: removeBody({ mode: "dry-run" }) }));
    expect(dry.status).toBe(200);
  });

  it("will not let an immediate effect jump the queue", async () => {
    const { io, ran } = fakeIo({});
    const { routes, queue } = harness({ io });
    queue.enqueueAction({ sessionId: "$99001", claudeSessionId: CLAUDE_ID }, "push", "greg");
    const r = await call(routes, fakeReq({ body: removeBody({ mode: "run" }) }));
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("queue-not-empty");
    expect(String(r.json.why)).toContain("cancel them first");
    expect(ran).toEqual([]);

    // Cancel it, and the same request goes through — which is queue.ts's own
    // instruction for doing something right now.
    const id = queue.snapshot("$99001").items[0]?.id ?? "";
    await call(routes, fakeReq({ url: "/api/actions/cancel", body: { sessionId: "$99001", itemId: id } }));
    const again = await call(routes, fakeReq({ body: removeBody({ mode: "run" }) }));
    expect(again.status).toBe(200);
    expect(ran.map((x) => x.argv[0])).toEqual(["git", "npm", "npm"]);
    expect(ran.slice(1).map((x) => x.argv[2])).toEqual(["worktree:check", "worktree:sweep"]);
  });

  it("refuses a mode that does not go with the effect", async () => {
    const { routes } = harness();
    const spokenRun = await call(routes, fakeReq({ body: sessionBody({ actionId: "continue", mode: "run", confirm: true }) }));
    expect(spokenRun.status).toBe(400);
    expect(spokenRun.json.code).toBe("wrong-mode");
    const messageRun = await call(routes, fakeReq({ body: sessionBody({ actionId: null, text: "hello", mode: "run" }) }));
    expect(messageRun.json.code).toBe("wrong-mode");
  });

  it("enqueues rather than acting when mode is left out", async () => {
    // THE DEFAULT IS `enqueue`, WHICH IS THE POINT: a body with no mode must
    // never run a plan. It used to be checked with `remove-worktree`, which the
    // queue now refuses outright (nothing drains an enacted item — queue.ts's
    // `enacted-not-deliverable`), so the two halves are checked separately: a
    // spoken action lands in the queue, and the enacted one is turned away
    // without a single step running either way.
    const { io, ran } = fakeIo({});
    const { routes, queue } = harness({ io });
    const spoken = await call(routes, fakeReq({ body: sessionBody({ actionId: "continue" }) }));
    expect(spoken.json.op).toBe("enqueued");
    expect(queue.size("$99001")).toBe(1);

    const enacted = await call(routes, fakeReq({ body: removeBody() }));
    expect(enacted.status).toBe(400);
    expect(enacted.json.code).toBe("wrong-mode");
    expect(String(enacted.json.why)).toContain("dry-run");
    expect(queue.size("$99001")).toBe(1);
    expect(ran).toEqual([]);
  });
});

/* ================================================================== *
 * Box: killing.
 * ================================================================== */

describe("POST /api/actions/box — killing", () => {
  const suites = [
    proc({ pid: 5001, comm: "node-MainThread", args: VITEST_ARGS }),
    proc({ pid: 5002, comm: "node-MainThread", args: VITEST_ARGS }),
  ];
  const bystanders = [
    // Matches the vitest rule and is protected. The refusals win.
    proc({ pid: 5003, comm: "claude", args: VITEST_ARGS }),
    // An agent that merely mentions vitest on its command line.
    proc({ pid: 5004, comm: "node", args: "node scripts/edit.js vitest.config.ts" }),
    // Us. Killing it kills the killer.
    proc({ pid: 999_999, comm: "node", args: VITEST_ARGS }),
  ];

  it("hands the page a preview it can actually show, and says it was a dry run", async () => {
    // THE JOIN, DRIVEN FROM THE BROWSER'S END. Both halves of this were right
    // on their own and disagreed about a NAME: eleven `respond(res, 200, …)`
    // calls here, not one of them carrying the field `actions-client.ts` reads,
    // so the confirmation panel in front of `kill-test-suites` rendered the
    // literal grey word "null" where the consequences belong (#11 in
    // docs/postmortems/260908b-…). No assertion on either end could see it —
    // only one that runs the real client parse over the real response.
    const { io, ran } = fakeIo({ procs: [...suites, ...bystanders] });
    const { routes } = harness({ io });
    const outcome = await makeActionsApi(browserFetch(routes)).box("kill-test-suites", true);
    expect(outcome.ok).toBe(true);
    const shown = outcome.ok ? outcome.result : null;
    // Written as "what a person would read off the panel" rather than as a
    // field access, because `RawValue` renders whatever this is: an assertion
    // that the field is merely `not.toBe(null)` passes on `undefined`, which is
    // exactly what a page reading a name nobody sends gets.
    expect(JSON.stringify(shown ?? null)).toContain('"pid":5001');
    expect(outcome.ok && outcome.dryRunStated).toBe(true);
    expect(outcome.ok && outcome.dryRun).toBe(true);
    expect(ran).toEqual([]);
  });

  it("asks for a real run in the field this route reads, so the second press is not another dry run", async () => {
    // THE REQUEST HALF OF THE SAME JOIN. `boxActionBody` sent `dryRun: boolean`
    // and `parseBoxBody` has only ever read `mode`, which defaults here to
    // `dry-run` — so every box action ever pressed on the page was a dry run,
    // including the confirmed one, and the panel said "Done." over it. The
    // refusal below is the PROOF the route read `run`: a body it read as a dry
    // run answers 200 with a preview, and this answers 409.
    const { io, ran } = fakeIo({ procs: [...suites] });
    const { routes } = harness({ io });
    const outcome = await makeActionsApi(browserFetch(routes)).box("kill-test-suites", false);

    expect(outcome.ok).toBe(false);
    // AND THE REMAINING GAP, NAMED RATHER THAN HIDDEN: the page does not yet
    // carry the pids it showed into the confirmed request, so a real kill is
    // refused by the both-lists rule. That is an honest refusal in the server's
    // own words rather than a false success, which is why it is reported and
    // not patched over here — the fix is for the panel to send
    // `result.candidates`' pids back, and it is a separate change.
    expect(outcome.ok === false && outcome.code).toBe("nothing-to-kill");
    expect(ran).toEqual([]);
  });

  it("dry-runs a kill: the named rule decides, and nothing is signalled", async () => {
    const { io, ran } = fakeIo({ procs: [...suites, ...bystanders] });
    const { routes } = harness({ io });
    const r = await call(routes, fakeReq({ url: "/api/actions/box", body: { actionId: "kill-test-suites", mode: "dry-run" } }));
    expect(r.status).toBe(200);
    const candidates = resultOf(r).candidates as { pid: number; rule: string; comm: string }[];
    expect(candidates.map((c) => c.pid)).toEqual([5001, 5002]);
    expect(candidates.every((c) => c.rule === "vitest-runner")).toBe(true);
    expect(candidates[0]?.comm).toBe("node-MainThread");
    expect(resultOf(r).scanned).toBe(5);
    expect(ran).toEqual([]);
  });

  it("kills only what BOTH the fresh scan and the person's list agree on", async () => {
    // 5001 was shown and still matches. 5002 was shown and has since stopped
    // matching (it is not in the scan). 5005 matches now and was never shown.
    const { io, ran } = fakeIo({ procs: [suites[0] as ProcRecord, proc({ pid: 5005, comm: "node-MainThread", args: VITEST_ARGS })] });
    const { routes } = harness({ io });
    const r = await call(
      routes,
      fakeReq({ url: "/api/actions/box", body: { actionId: "kill-test-suites", mode: "run", confirm: true, pids: [5001, 5002] } }),
    );
    expect(r.status).toBe(200);
    expect(resultOf(r).killed).toEqual([5001]);
    expect(ran.map((x) => x.argv)).toEqual([["kill", "-TERM", "5001"]]);
    const skipped = resultOf(r).skipped as { pid: number; why: string }[];
    expect(skipped.map((s) => s.pid).sort()).toEqual([5002, 5005]);
    expect(skipped.find((s) => s.pid === 5005)?.why).toContain("was not on the list you confirmed");
  });

  it("kills nothing when nothing on the confirmed list still matches", async () => {
    const { io, ran } = fakeIo({ procs: [proc({ pid: 5005, comm: "node-MainThread", args: VITEST_ARGS })] });
    const { routes } = harness({ io });
    const r = await call(
      routes,
      fakeReq({ url: "/api/actions/box", body: { actionId: "kill-test-suites", mode: "run", confirm: true, pids: [5001] } }),
    );
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("nothing-to-kill");
    expect(ran).toEqual([]);
  });

  it("refuses to kill on an unreadable process table rather than reporting a clean box", async () => {
    const { io, ran } = fakeIo({ scanFailure: "ps could not be read: ETIMEDOUT" });
    const { routes } = harness({ io });
    const r = await call(routes, fakeReq({ url: "/api/actions/box", body: { actionId: "kill-safe-processes", mode: "dry-run" } }));
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("box-unreadable");
    expect(ran).toEqual([]);
  });

  it("uses the safe-to-kill rules for the other button, and not the vitest one", async () => {
    const orphan = proc({ pid: 6001, comm: "node", args: "node dev.js", cwd: "/home/greg/gone (deleted)" });
    const { io } = fakeIo({ procs: [orphan, ...suites] });
    const { routes } = harness({ io });
    const r = await call(routes, fakeReq({ url: "/api/actions/box", body: { actionId: "kill-safe-processes", mode: "dry-run" } }));
    const candidates = resultOf(r).candidates as { pid: number; rule: string }[];
    expect(candidates.map((c) => c.pid)).toEqual([6001]);
    expect(candidates[0]?.rule).toBe("cwd-deleted");
  });

  it("refuses a kill without a confirm and without the flag", async () => {
    const a = fakeIo({ procs: suites });
    const noConfirm = await call(
      harness({ io: a.io }).routes,
      fakeReq({ url: "/api/actions/box", body: { actionId: "kill-test-suites", mode: "run", pids: [5001] } }),
    );
    expect(noConfirm.status).toBe(400);
    expect(noConfirm.json.code).toBe("confirm-required");
    expect(a.ran).toEqual([]);

    const b = fakeIo({ procs: suites });
    const disabled = await call(
      harness({ io: b.io, actEnabled: () => false }).routes,
      fakeReq({ url: "/api/actions/box", body: { actionId: "kill-test-suites", mode: "run", confirm: true, pids: [5001] } }),
    );
    expect(disabled.status).toBe(503);
    expect(b.ran).toEqual([]);
  });

  it("refuses a session action at the box route", async () => {
    const { routes } = harness();
    const r = await call(routes, fakeReq({ url: "/api/actions/box", body: { actionId: "continue" } }));
    expect(r.status).toBe(400);
    expect(r.json.code).toBe("wrong-scope");
  });
});

/* ================================================================== *
 * Box: the broadcast. The stagger is the property.
 * ================================================================== */

describe("POST /api/actions/box — the staggered broadcast", () => {
  const BROADCAST = actionById("resource-broadcast") as BroadcastAction;

  const five = [
    recipient({ paneId: "%1", sessionId: "$1" }),
    recipient({ paneId: "%2", sessionId: "$2", status: { kind: "working" } }),
    recipient({ paneId: "%3", sessionId: "$3", status: { kind: "needs-you" } }),
    recipient({ paneId: "%4", sessionId: "$4", status: { kind: "shell", busy: false } }),
    recipient({ paneId: "%5", sessionId: "$5" }),
  ];

  function body(over: Record<string, unknown> = {}): Record<string, unknown> {
    return { actionId: "resource-broadcast", mode: "run", confirm: true, speaker: "greg", recipients: five, ...over };
  }

  it("staggers across the recipients it can actually speak to", async () => {
    const { routes, sent } = harness();
    const r = await call(routes, fakeReq({ url: "/api/actions/box", body: body() }));
    expect(r.status).toBe(200);
    // Three deliverable of five: the working one is held, the shell is blocked.
    expect(resultOf(r).total).toBe(3);
    expect(sent.map((s) => s.target.paneId)).toEqual(["%1", "%3", "%5"]);

    // The minutes are the shared function's, with the DELIVERABLE denominator —
    // the near end, the middle and the far end of Greg's "up to an hour".
    const minutes = [0, 1, 2].map((i) => staggerMinutes(i, 3, BROADCAST.stagger));
    expect(minutes).toEqual([5, 33, 60]);
    for (const [i, s] of sent.entries()) {
      expect(s.text).toBe(renderBroadcast(BROADCAST, { index: i, total: 3 }, "greg"));
      expect(s.text).toContain(`pause for ${minutes[i]} minutes`);
    }
    // And they are genuinely different, which is the whole point.
    expect(new Set(sent.map((s) => s.text)).size).toBe(3);
  });

  it("says what happened to every row, including the ones it did not speak to", async () => {
    const { routes } = harness();
    const r = await call(routes, fakeReq({ url: "/api/actions/box", body: body() }));
    const rows = resultOf(r).recipients as { paneId: string; outcome: string; minutes: number | null; why: string | null }[];
    expect(rows.map((x) => `${x.paneId}:${x.outcome}`)).toEqual(["%1:sent", "%2:held", "%3:sent", "%4:blocked", "%5:sent"]);
    expect(rows.find((x) => x.paneId === "%2")?.why).toContain("working");
    expect(rows.find((x) => x.paneId === "%4")?.minutes).toBe(null);
  });

  it("carries on when one recipient refuses, and reports its code", async () => {
    const refusal: SteerResult = {
      ok: false,
      reason: { code: "not-at-input", why: "pane %3 is not showing an input box" },
      delivery: "none",
      sent: [],
    };
    const { routes, sent } = harness({ result: (t) => (t.paneId === "%3" ? refusal : SENT_OK) });
    const r = await call(routes, fakeReq({ url: "/api/actions/box", body: body() }));
    expect(sent.map((s) => s.target.paneId)).toEqual(["%1", "%3", "%5"]);
    const rows = resultOf(r).recipients as { paneId: string; outcome: string; code: string | null }[];
    expect(rows.find((x) => x.paneId === "%3")).toMatchObject({ outcome: "refused", code: "not-at-input" });
    expect(rows.filter((x) => x.outcome === "sent").map((x) => x.paneId)).toEqual(["%1", "%5"]);
  });

  it("previews without speaking, with the same minutes the send would use", async () => {
    const { routes, sent } = harness();
    const r = await call(routes, fakeReq({ url: "/api/actions/box", body: body({ mode: "dry-run" }) }));
    expect(r.status).toBe(200);
    expect(r.json.op).toBe("broadcast-preview");
    const rows = resultOf(r).recipients as { paneId: string; minutes: number | null }[];
    expect(rows.filter((x) => x.minutes !== null).map((x) => x.minutes)).toEqual([5, 33, 60]);
    expect(String(resultOf(r).sample)).toBe(renderBroadcast(BROADCAST, { index: 0, total: 3 }, "greg"));
    expect(sent).toEqual([]);
  });

  it("attributes an unattributed broadcast to the Overseer, not to Greg", async () => {
    const { routes, sent } = harness();
    await call(routes, fakeReq({ url: "/api/actions/box", body: body({ speaker: undefined }) }));
    expect(sent[0]?.text).toContain("The Overseer");
    expect(sent[0]?.text).toBe(renderBroadcast(BROADCAST, { index: 0, total: 3 }, "overseer"));

    const asGreg = harness();
    await call(asGreg.routes, fakeReq({ url: "/api/actions/box", body: body({ speaker: "greg" }) }));
    expect(asGreg.sent[0]?.text).toContain("[Greg, via the fleet dashboard]");
  });

  it("speaks to a duplicated row once", async () => {
    const { routes, sent } = harness();
    const dup = [recipient({ paneId: "%1", sessionId: "$1" }), recipient({ paneId: "%1", sessionId: "$1" }), recipient({ paneId: "%2", sessionId: "$2" })];
    const r = await call(routes, fakeReq({ url: "/api/actions/box", body: body({ recipients: dup }) }));
    expect(sent.map((s) => s.target.paneId)).toEqual(["%1", "%2"]);
    expect(resultOf(r).total).toBe(2);
  });

  it("will not tell the fleet twice in ten minutes", async () => {
    const h = harness();
    const first = await call(h.routes, fakeReq({ url: "/api/actions/box", body: body() }));
    expect(first.status).toBe(200);
    expect(h.sent).toHaveLength(3);

    h.tick(60_000);
    const second = await call(h.routes, fakeReq({ url: "/api/actions/box", body: body() }));
    expect(second.status).toBe(429);
    expect(second.json.code).toBe("cooldown");
    expect(second.headers["retry-after"]).toBeDefined();
    // Nothing more went out.
    expect(h.sent).toHaveLength(3);

    h.tick(10 * 60_000);
    const later = await call(h.routes, fakeReq({ url: "/api/actions/box", body: body() }));
    expect(later.status).toBe(200);
    expect(h.sent).toHaveLength(6);
  });

  it("refuses without a confirm, without the flag, and with nobody to tell", async () => {
    const a = harness();
    const noConfirm = await call(a.routes, fakeReq({ url: "/api/actions/box", body: body({ confirm: false }) }));
    expect(noConfirm.json.code).toBe("confirm-required");
    expect(a.sent).toEqual([]);

    const b = harness({ actEnabled: () => false });
    const disabled = await call(b.routes, fakeReq({ url: "/api/actions/box", body: body() }));
    expect(disabled.status).toBe(503);
    expect(b.sent).toEqual([]);

    const c = harness();
    const nobody = await call(
      c.routes,
      fakeReq({ url: "/api/actions/box", body: body({ recipients: [recipient({ status: { kind: "shell", busy: null } })] }) }),
    );
    expect(nobody.status).toBe(409);
    expect(nobody.json.code).toBe("not-steerable");
    expect(c.sent).toEqual([]);

    const d = harness();
    const none = await call(d.routes, fakeReq({ url: "/api/actions/box", body: body({ recipients: [] }) }));
    expect(none.status).toBe(400);
    expect(d.sent).toEqual([]);
  });

  it("hands the event loop back between every send", async () => {
    let yields = 0;
    const { routes, sent } = harness({ yieldToLoop: () => { yields += 1; return Promise.resolve(); } });
    await call(routes, fakeReq({ url: "/api/actions/box", body: body() }));
    // `sendMessage` is synchronous and blocks this whole server; without a turn
    // between sends, the page and the stream answer nothing for the length of
    // the fan-out.
    expect(sent).toHaveLength(3);
    expect(yields).toBe(3);
  });

  it("stops at the deadline and names the rows it never reached", async () => {
    // Each send costs a minute of wall clock, the way a tmux call does on a box
    // at load 391. The deadline is 90s, so the third recipient is past it — and
    // the clock is driven BY the send, which is the only way to measure a rule
    // about elapsed time without sleeping through it.
    let clock = 1_000_000;
    const sent: string[] = [];
    const routes = makeActionRoutes({
      queue: new SteeringQueue({ now: () => clock, serverInstanceId: "1a2b3c4d" }),
      sendMessage: (target) => {
        sent.push(target.paneId);
        clock += 60_000;
        return SENT_OK;
      },
      now: () => clock,
      limiter: createRateLimiter({ minIntervalMs: 0, burstMax: 1_000, burstWindowMs: 1 }),
      log: () => {},
      actEnabled: () => true,
      yieldToLoop: () => Promise.resolve(),
      primaryDir: () => PRIMARY,
      io: fakeIo({}).io,
    });
    const r = await call(routes, fakeReq({ url: "/api/actions/box", body: body() }));
    expect(r.status).toBe(200);
    // Two got through (at 0s and 60s); the third was past 90s.
    expect(sent).toEqual(["%1", "%3"]);
    const rows = resultOf(r).recipients as { paneId: string; outcome: string; why: string | null }[];
    expect(rows.find((x) => x.paneId === "%5")?.outcome).toBe("not-reached");
    expect(String(rows.find((x) => x.paneId === "%5")?.why)).toContain("ran out of time");
  });

  it("refuses a fan-out bigger than a fleet", async () => {
    const { routes, sent } = harness();
    const many = Array.from({ length: 81 }, (_, i) => recipient({ paneId: `%${i}`, sessionId: `$${i}` }));
    const r = await call(routes, fakeReq({ url: "/api/actions/box", body: body({ recipients: many }) }));
    expect(r.status).toBe(400);
    expect(String(r.json.why)).toContain("81");
    expect(sent).toEqual([]);
  });

  it("refuses a recipient that is not addressable, rather than speaking to the rest", async () => {
    const { routes, sent } = harness();
    const withBad = [recipient({ paneId: "%1", sessionId: "$1" }), recipient({ paneId: "%2", sessionId: "$2", claudeSessionId: undefined })];
    const r = await call(routes, fakeReq({ url: "/api/actions/box", body: body({ recipients: withBad }) }));
    expect(r.status).toBe(400);
    expect(String(r.json.why)).toContain("claudeSessionId");
    expect(sent).toEqual([]);
  });
});

/* ================================================================== *
 * Rate limiting, and reading the process table.
 * ================================================================== */

describe("rate limiting", () => {
  it("does not let a held key fill a queue, and does not charge for a refusal", async () => {
    const limiter = createRateLimiter({ minIntervalMs: 5_000, burstMax: 100, burstWindowMs: 10_000 });
    const { routes, queue } = harness({ limiter });
    const first = await call(routes, fakeReq({ body: sessionBody({ actionId: "continue" }) }));
    expect(first.status).toBe(200);
    const second = await call(routes, fakeReq({ body: sessionBody({ actionId: "pull" }) }));
    expect(second.status).toBe(429);
    expect(second.headers["retry-after"]).toBe("5");
    expect(queue.size("$99001")).toBe(1);

    // A refusal that never reached the queue must not spend a slot: the clock
    // has not moved, so this is still inside the floor from the FIRST accepted
    // request, not from the refused one.
    const refused = await call(routes, fakeReq({ body: sessionBody({ actionId: "nope" }) }));
    expect(refused.status).toBe(400);
    expect(queue.size("$99001")).toBe(1);
  });
});

describe("what a refusal says about delivery, and what a page may conclude from it", () => {
  /**
   * A `FleetRow` as far as the request bodies are concerned.
   *
   * `steerTargetBody` reads five fields off a row and nothing else, so this is
   * the whole of what `run()` needs. A cast rather than a full row, because a
   * full one would be a fixture of the state payload — a different file's
   * subject — and would go stale against it silently.
   */
  const ROW = {
    id: "$99001",
    paneId: "%99001",
    claudeSessionId: CLAUDE_ID,
    panePid: 424242,
    rawStatus: { kind: "idle" },
  } as unknown as Parameters<ReturnType<typeof makeActionsApi>["run"]>[0];

  it("sends no delivery on a refusal that had already run two steps", async () => {
    /* NOT AN OVERSIGHT, AND THE TEST IS HERE SO IT STAYS DELIBERATE. This
       refusal arrives AFTER `git rev-parse` and `npm run worktree:check` have
       actually run on the box, and it still has no opinion about delivery,
       because `delivery` is a fact about keystrokes and no keystroke was
       involved. The route must not invent one — a `delivery: "none"` here would
       be the server signing its name to "nothing happened" over two commands
       that did. Absence is the honest answer, and the client reads it as
       `not-told`. */
    const { io, ran } = fakeIo({
      step: (_s, i) => (i === 1 ? { ...OK_STEP, code: 1, stdout: "blocked: data/ has 3 files" } : { ...OK_STEP, stdout: "worktree-fixture\n" }),
    });
    const { routes } = harness({ io });
    const r = await call(
      routes,
      fakeReq({ body: sessionBody({ actionId: "remove-worktree", confirm: true, mode: "run", worktreeDir: WORKTREE, branch: "worktree-fixture" }) }),
    );
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("plan-failed");
    expect(ran.map((x) => x.argv[0])).toEqual(["git", "npm"]);
    expect(r.json).not.toHaveProperty("delivery");
  });

  it("is read as not-told rather than none by the client that receives it", async () => {
    /* THE JOIN, over the real handler. Everything either side of it can be
       right while the client still reads a missing field as `none` — which is
       what it did, by having nowhere to put the answer at all. */
    const { routes } = harness({});
    const outcome = await makeActionsApi(browserFetch(routes)).run(ROW, "remove-worktree");
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.code).toBe("confirm-required");
    expect(outcome.ok === false && outcome.delivery).toEqual({ kind: "not-told" });
    // The server's sentence, unparaphrased, and from the server.
    expect(outcome.ok === false && outcome.from).toBe("server");
  });
});

describe("reading the process table", () => {
  it("parses ps output, and keeps a comm with a space in it", () => {
    const args = parsePsArgs(["    1     0  12000    98765 /sbin/init splash", " 4242     1  91000    12345 node /x/node_modules/.bin/vitest run", "garbage"].join("\n"));
    expect(args.map((a) => a.pid)).toEqual([1, 4242]);
    expect(args[1]).toMatchObject({ ppid: 1, rssKiB: 91000, etimeSeconds: 12345, args: "node /x/node_modules/.bin/vitest run" });

    const comms = parsePsComm(["    1 systemd", " 4242 node-MainThread", " 4300 tmux: server"].join("\n"));
    expect(comms.get(4300)).toBe("tmux: server");
    expect(comms.get(4242)).toBe("node-MainThread");
  });

  it("DROPS a process whose comm it could not read, rather than judging it", () => {
    // The safety property: `isProtected` matches a prefix of comm, so a record
    // with an empty one matches nothing on the protected list — a `claude` we
    // failed to name would look exactly like an ordinary process.
    const rows = parsePsArgs([" 4242     1  91000    12345 node /x/node_modules/.bin/vitest run", " 4243     1  91000    12345 also-a-vitest"].join("\n"));
    const merged = mergeProcs(rows, new Map([[4242, "node-MainThread"]]), () => null);
    expect(merged.procs.map((p) => p.pid)).toEqual([4242]);
    expect(merged.unreadable).toBe(1);
  });

  it("carries the deleted-cwd marker through unchanged", () => {
    const rows = parsePsArgs(" 4242     1  91000    12345 node dev.js");
    const merged = mergeProcs(rows, new Map([[4242, "node"]]), () => "/home/greg/gone (deleted)");
    expect(merged.procs[0]?.cwd).toBe("/home/greg/gone (deleted)");
  });
});
