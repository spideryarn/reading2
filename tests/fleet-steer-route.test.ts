/**
 * The HTTP skin over the delivery module — tools/fleet/routes-steer.ts.
 *
 * **NOTHING HERE SENDS A KEYSTROKE.** There are ~37 live agent sessions on this
 * box doing other people's work, and a test run is not a reason to type into
 * one. `steer.ts` has its own live-fire evidence (a throwaway `wf-steer-`
 * session, recorded in its header); this file drives the route through the
 * injected `sendMessage`/`answerQuestion` seam, and the fake records what it was
 * handed. So the assertion that matters most is not "did it return 200" — it is
 * **which fields reached the delivery module**, because a route that quietly
 * re-derived the target from live tmux would return 200 just as happily and
 * would have disarmed every guard downstream.
 *
 * The tmux ids in the fixtures are deliberately fictional (`%99001`, `$99001`)
 * and no test constructs a real one, so a bug that somehow reached the real
 * `realIo()` would refuse rather than land somewhere.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import type { FleetStatus } from "../tools/fleet/status.js";
import type { SeenQuestion, SteerResult, SteerTarget } from "../tools/fleet/steer.js";
import {
  checkOrigin,
  createRateLimiter,
  makeSteerRoutes,
  parseAnswerBody,
  parseMessageBody,
  parseOptionKey,
  parseStatus,
  readBody,
  REFUSAL_STATUS,
  type SteerDeps,
} from "../tools/fleet/routes-steer.js";

/* ------------------------------------------------------------------ *
 * Fakes: a request, a response, and the delivery module.
 * ------------------------------------------------------------------ */

const HOST = "100.90.80.70:8787";
const ORIGIN = `http://${HOST}`;
const CLAUDE_ID = "117e181a-1111-4222-8333-444455556666";

/** The body the React client sends for a message, in one place. */
function messageBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    paneId: "%99001",
    sessionId: "$99001",
    claudeSessionId: CLAUDE_ID,
    panePid: 424242,
    status: { kind: "needs-you" },
    text: "please merge origin/dev before you carry on",
    ...over,
  };
}

const SEEN: SeenQuestion = {
  kind: "question",
  prompt: "Do you trust the files in this folder?",
  options: [
    { label: "Yes, proceed", key: { via: "selected" } },
    { label: "No, exit", key: { via: "arrows", key: "Down", presses: 1 } },
  ],
};

function answerBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    paneId: "%99001",
    sessionId: "$99001",
    claudeSessionId: CLAUDE_ID,
    panePid: 424242,
    status: { kind: "needs-you" },
    question: SEEN,
    optionIndex: 1,
    ...over,
  };
}

type FakeRes = {
  status: number | null;
  headers: Record<string, string>;
  body: string;
  done: Promise<void>;
};

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

/**
 * A request as a real stream, so `readBody`'s counting is exercised rather than
 * bypassed. `push` before the handler reads is fine — a PassThrough buffers.
 */
function fakeReq(opts: {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}): import("node:http").IncomingMessage {
  const stream = new PassThrough();
  const body = opts.body ?? "";
  if (body !== "") stream.write(body);
  stream.end();
  return Object.assign(stream, {
    url: opts.url ?? "/api/steer/message",
    method: opts.method ?? "POST",
    headers: {
      host: HOST,
      origin: ORIGIN,
      "content-type": "application/json",
      ...opts.headers,
    },
    socket: { remoteAddress: "100.90.80.71" },
  }) as unknown as import("node:http").IncomingMessage;
}

type Call =
  | { op: "message"; target: SteerTarget; text: string; declaredStatus: FleetStatus }
  | { op: "answer"; target: SteerTarget; seen: SeenQuestion; optionIndex: number; declaredStatus: FleetStatus };

const OK: SteerResult = {
  ok: true,
  verified: { paneId: "%99001", sessionId: "$99001", panePid: 424242, claudePid: 424299 },
  sent: [["send-keys", "-t", "%99001", "-l", "--", "…"]],
};

/** The route, with the delivery module replaced by a recorder. */
function harness(result: SteerResult | (() => SteerResult) = OK, over: Partial<SteerDeps> = {}) {
  const calls: Call[] = [];
  const logs: string[] = [];
  const give = (): SteerResult => (typeof result === "function" ? result() : result);
  const routes = makeSteerRoutes({
    sendMessage: (target, text, declaredStatus) => {
      calls.push({ op: "message", target, text, declaredStatus });
      return give();
    },
    answerQuestion: (target, seen, optionIndex, declaredStatus) => {
      calls.push({ op: "answer", target, seen, optionIndex, declaredStatus });
      return give();
    },
    log: (line) => logs.push(line),
    ...over,
  });
  return { routes, calls, logs };
}

async function post(
  routes: ReturnType<typeof harness>["routes"],
  req: import("node:http").IncomingMessage,
): Promise<FakeRes & { json: Record<string, unknown> }> {
  const { res, seen } = fakeRes();
  const handled = routes.handle(req, res);
  expect(handled).toBe(true);
  await seen.done;
  return { ...seen, json: seen.body === "" ? {} : (JSON.parse(seen.body) as Record<string, unknown>) };
}

/* ------------------------------------------------------------------ *
 * The identity claims — the one that matters most.
 * ------------------------------------------------------------------ */

describe("carrying the client's claims through", () => {
  it("hands the delivery module exactly the identity fields the client sent", async () => {
    const { routes, calls } = harness();
    const r = await post(routes, fakeReq({ body: JSON.stringify(messageBody()) }));

    expect(r.status).toBe(200);
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.op).toBe("message");
    // Field by field, and `toEqual` on the whole object as well, so an EXTRA
    // field the route invented (a pane it looked up, a status it re-derived)
    // fails too — a per-field check would not see one.
    expect(call?.target).toEqual({
      paneId: "%99001",
      sessionId: "$99001",
      claudeSessionId: CLAUDE_ID,
      panePid: 424242,
    });
    expect(call?.op === "message" && call.text).toBe("please merge origin/dev before you carry on");
    expect(call?.declaredStatus).toEqual({ kind: "needs-you" });
  });

  it("passes a panePid the live box could not possibly agree with, unchanged", async () => {
    // The point of the field is to catch `respawn-pane`, which it can only do if
    // the route forwards what the CLIENT saw. A route that replaced it with
    // `#{pane_pid}` read now would forward a pid that always matches.
    const { routes, calls } = harness();
    await post(routes, fakeReq({ body: JSON.stringify(messageBody({ panePid: 7 })) }));
    expect(calls[0]?.target.panePid).toBe(7);
  });

  it("omits panePid entirely when the client had none, rather than inventing one", async () => {
    const { routes, calls } = harness();
    const body = messageBody();
    delete body.panePid;
    await post(routes, fakeReq({ body: JSON.stringify(body) }));
    expect(calls[0]?.target).toEqual({ paneId: "%99001", sessionId: "$99001", claudeSessionId: CLAUDE_ID });
    expect("panePid" in (calls[0]?.target ?? {})).toBe(false);
  });

  it("refuses a body with no claudeSessionId rather than steering without one", async () => {
    const { routes, calls } = harness();
    const body = messageBody();
    delete body.claudeSessionId;
    const r = await post(routes, fakeReq({ body: JSON.stringify(body) }));
    expect(r.status).toBe(400);
    expect(r.json.code).toBe("bad-request");
    expect(String(r.json.why)).toContain("claudeSessionId");
    expect(calls).toHaveLength(0);
  });

  it("never imports a value from the modules that read the live box", () => {
    // The backstop for the whole design, computed a different way from the
    // tests above: they would all still pass if the route called `capturePane`
    // in addition to forwarding the body. This reads the source.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(path.join(here, "..", "tools", "fleet", "routes-steer.ts"), "utf8");
    const imports = src.match(/^import .*$|^} from ".*";$/gm) ?? [];
    for (const line of imports) {
      if (/collect\.js|pane\.js|status\.js/.test(line)) {
        expect(line, `${line} must be a type-only import`).toMatch(/^import type/);
      }
    }
    expect(src).not.toContain("capturePane(");
    expect(src).not.toContain("execFile");
    expect(src).not.toContain("realIo(");
  });
});

/* ------------------------------------------------------------------ *
 * CSRF and content type.
 * ------------------------------------------------------------------ */

describe("who may POST", () => {
  it("rejects a missing Origin without calling through", async () => {
    const { routes, calls } = harness();
    const req = fakeReq({ body: JSON.stringify(messageBody()) });
    delete (req.headers as Record<string, unknown>).origin;
    const r = await post(routes, req);
    expect(r.status).toBe(403);
    expect(r.json.code).toBe("forbidden-origin");
    expect(calls).toHaveLength(0);
  });

  it("rejects Origin: null, which a sandboxed iframe sends", async () => {
    const { routes, calls } = harness();
    const r = await post(routes, fakeReq({ headers: { origin: "null" }, body: JSON.stringify(messageBody()) }));
    expect(r.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("rejects a foreign Origin", async () => {
    const { routes, calls } = harness();
    const r = await post(
      routes,
      fakeReq({ headers: { origin: "https://evil.example" }, body: JSON.stringify(messageBody()) }),
    );
    expect(r.status).toBe(403);
    expect(String(r.json.why)).toContain("evil.example");
    expect(calls).toHaveLength(0);
  });

  it("rejects a rebinding attempt, where Origin and Host agree on a public name", () => {
    // The case a plain `origin.host === host` comparison passes: the browser was
    // pointed at `evil.example`, which now resolves to this box.
    const v = checkOrigin({
      "content-type": "application/json",
      origin: "https://evil.example",
      host: "evil.example",
    });
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.why).toContain("evil.example");
  });

  it("accepts the two names this dashboard is actually reached by", () => {
    for (const host of ["127.0.0.1:8787", "100.90.80.70:8787", "somebox.tail1234.ts.net:8787", "localhost:8787"]) {
      const v = checkOrigin({ "content-type": "application/json", origin: `http://${host}`, host });
      expect(v.ok, host).toBe(true);
    }
  });

  it("rejects a non-JSON content-type without calling through", async () => {
    const { routes, calls } = harness();
    const r = await post(
      routes,
      // text/plain is a CORS "simple" type, so it is the one a cross-origin
      // form can send with no preflight. It must not be accepted.
      fakeReq({ headers: { "content-type": "text/plain" }, body: JSON.stringify(messageBody()) }),
    );
    expect(r.status).toBe(415);
    expect(r.json.code).toBe("unsupported-media-type");
    expect(calls).toHaveLength(0);
  });

  it("accepts application/json with a charset", () => {
    const v = checkOrigin({ "content-type": "application/json; charset=utf-8", origin: ORIGIN, host: HOST });
    expect(v.ok).toBe(true);
  });

  it("refuses a GET at the steering URL", async () => {
    const { routes, calls } = harness();
    const { res, seen } = fakeRes();
    expect(routes.handle(fakeReq({ method: "GET" }), res)).toBe(true);
    await seen.done;
    expect(seen.status).toBe(405);
    expect(seen.headers.allow).toBe("POST");
    expect(calls).toHaveLength(0);
  });

  it("declines a URL that is not ours, so the server can fall through to the client", () => {
    const { routes } = harness();
    const { res } = fakeRes();
    expect(routes.handle(fakeReq({ url: "/api/state" }), res)).toBe(false);
    expect(routes.handle(fakeReq({ url: "/index.html", method: "GET" }), res)).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * The body cap.
 * ------------------------------------------------------------------ */

describe("the body cap", () => {
  it("rejects an oversized body WITHOUT buffering all of it", async () => {
    const stream = new PassThrough();
    const req = Object.assign(stream, { headers: {} }) as unknown as Parameters<typeof readBody>[0];
    const limit = 1024;
    const chunk = "x".repeat(256);
    const promise = readBody(req, limit);
    // 256 KiB pushed at a 1 KiB limit. If it buffered the lot, `bytesRead`
    // would be a thousand times the limit — which is the measurement, not the
    // refusal: a route that read everything and then complained returns the
    // same `ok:false`.
    for (let i = 0; i < 1024; i++) stream.write(chunk);
    stream.end();
    const r = await promise;
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.code).toBe("body-too-large");
    expect(r.bytesRead).toBeGreaterThan(limit);
    expect(r.bytesRead).toBeLessThanOrEqual(limit + chunk.length);
  });

  it("rejects on a content-length claim before reading a byte", async () => {
    const stream = new PassThrough();
    const req = Object.assign(stream, { headers: { "content-length": "999999" } }) as unknown as Parameters<
      typeof readBody
    >[0];
    const r = await readBody(req, 1024);
    expect(r.ok).toBe(false);
    expect(r.bytesRead).toBe(0);
  });

  it("answers 413 on the route, and does not call through", async () => {
    const { routes, calls } = harness();
    const r = await post(
      routes,
      fakeReq({ body: JSON.stringify(messageBody({ text: "y".repeat(20_000) })) }),
    );
    expect(r.status).toBe(413);
    expect(r.json.code).toBe("body-too-large");
    expect(calls).toHaveLength(0);
  });

  it("rejects a body that is not JSON", async () => {
    const { routes, calls } = harness();
    const r = await post(routes, fakeReq({ body: "{not json" }));
    expect(r.status).toBe(400);
    expect(r.json.code).toBe("bad-request");
    expect(calls).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * Refusals come back as refusals.
 * ------------------------------------------------------------------ */

describe("returning the discriminated result honestly", () => {
  it("turns a refusal into a 4xx carrying the code — not a 200 and not a 500", async () => {
    const { routes } = harness({
      ok: false,
      reason: { code: "question-changed", why: "pane %99001 is asking something else now" },
    });
    const r = await post(routes, fakeReq({ url: "/api/steer/answer", body: JSON.stringify(answerBody()) }));
    expect(r.status).toBe(409);
    expect(r.status).toBeLessThan(500);
    expect(r.json).toEqual({
      ok: false,
      code: "question-changed",
      why: "pane %99001 is asking something else now",
    });
  });

  it("gives a caller's mistake a 400 and the world having moved a 409", () => {
    expect(REFUSAL_STATUS["bad-target"]).toBe(400);
    expect(REFUSAL_STATUS["bad-text"]).toBe(400);
    expect(REFUSAL_STATUS["no-such-option"]).toBe(400);
    for (const code of ["pane-gone", "wrong-pane", "no-claude-in-pane", "question-gone", "send-failed"] as const) {
      expect(REFUSAL_STATUS[code], code).toBe(409);
    }
    // And nothing is a 5xx or a 2xx, because either would be a lie about which
    // half of the system was wrong.
    for (const status of Object.values(REFUSAL_STATUS)) {
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(500);
    }
  });

  it("reports a throw from the delivery module as 500 internal, distinguishably", async () => {
    const { routes } = harness(() => {
      throw new Error("tmux is not on PATH");
    });
    const r = await post(routes, fakeReq({ body: JSON.stringify(messageBody()) }));
    expect(r.status).toBe(500);
    // `internal` is not a RefusalCode, which is how a client tells "the server
    // broke" from "the dialog moved on".
    expect(r.json.code).toBe("internal");
  });

  it("returns the verified identity and the argv on success", async () => {
    const { routes } = harness();
    const r = await post(routes, fakeReq({ body: JSON.stringify(messageBody()) }));
    expect(r.json.ok).toBe(true);
    expect(r.json.op).toBe("message");
    expect(r.json.verified).toEqual({ paneId: "%99001", sessionId: "$99001", panePid: 424242, claudePid: 424299 });
    expect(r.json.sent).toEqual([["send-keys", "-t", "%99001", "-l", "--", "…"]]);
  });
});

/* ------------------------------------------------------------------ *
 * Answering a dialog.
 * ------------------------------------------------------------------ */

describe("answering a dialog", () => {
  it("passes the dialog the client is showing, and the index it chose", async () => {
    const { routes, calls } = harness();
    const r = await post(routes, fakeReq({ url: "/api/steer/answer", body: JSON.stringify(answerBody()) }));
    expect(r.status).toBe(200);
    const call = calls[0];
    expect(call?.op).toBe("answer");
    expect(call?.op === "answer" && call.optionIndex).toBe(1);
    expect(call?.op === "answer" && call.seen).toEqual(SEEN);
  });

  it("rebuilds an option key in pane.ts's property order, so sameQuestion can match it", () => {
    // JSON preserves whatever order the client serialised, and `sameQuestion`
    // compares keys with JSON.stringify. A pass-through would fail as
    // `question-changed` for a reason that has nothing to do with the pane.
    const scrambled = { digit: "3", via: "digit" };
    expect(JSON.stringify(parseOptionKey(scrambled))).toBe(JSON.stringify({ via: "digit", digit: "3" }));
    const arrows = { presses: 2, key: "Down", via: "arrows" };
    expect(JSON.stringify(parseOptionKey(arrows))).toBe(JSON.stringify({ via: "arrows", key: "Down", presses: 2 }));
  });

  it("refuses a malformed question rather than passing it down", async () => {
    const { routes, calls } = harness();
    const r = await post(
      routes,
      fakeReq({
        url: "/api/steer/answer",
        body: JSON.stringify(answerBody({ question: { kind: "question", prompt: "?", options: [{ label: 1 }] } })),
      }),
    );
    expect(r.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("refuses a negative optionIndex", () => {
    expect(parseAnswerBody(answerBody({ optionIndex: -1 })).ok).toBe(false);
    expect(parseAnswerBody(answerBody({ optionIndex: 1.5 })).ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Rate limiting.
 * ------------------------------------------------------------------ */

describe("the rate limiter", () => {
  it("refuses the second of two rapid requests to the same session", async () => {
    let clock = 1_000_000;
    const { routes, calls } = harness(OK, { now: () => clock });
    const first = await post(routes, fakeReq({ body: JSON.stringify(messageBody()) }));
    expect(first.status).toBe(200);

    clock += 40; // a key repeat, or a double tap
    const second = await post(routes, fakeReq({ body: JSON.stringify(messageBody()) }));
    expect(second.status).toBe(429);
    expect(second.json.code).toBe("rate-limited");
    expect(second.headers["retry-after"]).toBeDefined();
    // The real assertion: the second one never reached the delivery module.
    expect(calls).toHaveLength(1);
  });

  it("lets the same session through once the floor has passed", async () => {
    let clock = 1_000_000;
    const { routes, calls } = harness(OK, { now: () => clock });
    await post(routes, fakeReq({ body: JSON.stringify(messageBody()) }));
    clock += 5_000;
    const second = await post(routes, fakeReq({ body: JSON.stringify(messageBody()) }));
    expect(second.status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it("does not let a refused request consume the caller's next slot", () => {
    const limiter = createRateLimiter({ minIntervalMs: 1000, burstMax: 5, burstWindowMs: 10_000 });
    expect(limiter.check("%1", 0).ok).toBe(true);
    expect(limiter.check("%1", 100).ok).toBe(false);
    expect(limiter.check("%1", 200).ok).toBe(false);
    // If the refusals had moved the clock, this would still be inside the floor.
    expect(limiter.check("%1", 1001).ok).toBe(true);
  });

  it("has a whole-box ceiling as well as a per-pane floor", () => {
    const limiter = createRateLimiter({ minIntervalMs: 10, burstMax: 3, burstWindowMs: 10_000 });
    expect(limiter.check("%1", 0).ok).toBe(true);
    expect(limiter.check("%2", 100).ok).toBe(true);
    expect(limiter.check("%3", 200).ok).toBe(true);
    expect(limiter.check("%4", 300).ok).toBe(false);
    // …and the window is a window, not a total.
    expect(limiter.check("%4", 20_000).ok).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Parsing, and the log.
 * ------------------------------------------------------------------ */

describe("parsing untrusted bodies", () => {
  it("refuses everything that is not an object", () => {
    for (const raw of [null, 3, "x", [], true]) {
      expect(parseMessageBody(raw).ok, JSON.stringify(raw)).toBe(false);
      expect(parseAnswerBody(raw).ok, JSON.stringify(raw)).toBe(false);
    }
  });

  it("requires a status, and keeps the non-steerable ones so the refusal can explain", () => {
    expect(parseMessageBody(messageBody({ status: undefined })).ok).toBe(false);
    expect(parseMessageBody(messageBody({ status: "working" })).ok).toBe(false);
    expect(parseStatus({ kind: "shell", busy: null })).toEqual({ kind: "shell", busy: null });
    expect(parseStatus({ kind: "unknown", why: "no agents list" })).toEqual({
      kind: "unknown",
      why: "no agents list",
    });
    expect(parseStatus({ kind: "shell" })).toBeNull();
    expect(parseStatus({ kind: "invented" })).toBeNull();
  });

  it("refuses a panePid that is not a pid instead of dropping it", () => {
    // Dropping it would turn a malformed field into a WEAKER check, silently.
    expect(parseMessageBody(messageBody({ panePid: "424242" })).ok).toBe(false);
    expect(parseMessageBody(messageBody({ panePid: -1 })).ok).toBe(false);
    expect(parseMessageBody(messageBody({ panePid: 1.5 })).ok).toBe(false);
  });

  it("leaves the shape checks that mean something to the delivery module", () => {
    // `%nope` is not a pane id — but that is `checkTarget`'s verdict, not ours,
    // so the route forwards it and lets the module refuse `bad-target`.
    const parsed = parseMessageBody(messageBody({ paneId: "%nope" }));
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.value.target.paneId).toBe("%nope");
  });
});

describe("the log", () => {
  it("records the attempt and the outcome, and never the message text", async () => {
    const secret = "the passphrase is hunter2";
    const { routes, logs } = harness();
    await post(routes, fakeReq({ body: JSON.stringify(messageBody({ text: secret })) }));
    const all = logs.join("\n");
    expect(all).toContain("attempt");
    expect(all).toContain("SENT");
    expect(all).toContain("%99001");
    expect(all).toContain(CLAUDE_ID);
    expect(all).toContain(`chars=${secret.length}`);
    expect(all).not.toContain(secret);
    expect(all).not.toContain("hunter2");
  });

  it("logs an attempt that is refused at the door, not only the ones that get in", async () => {
    const { routes, logs } = harness();
    await post(routes, fakeReq({ headers: { origin: "https://evil.example" }, body: "{}" }));
    expect(logs.some((l) => l.includes("attempt"))).toBe(true);
    expect(logs.some((l) => l.includes("forbidden-origin"))).toBe(true);
  });

  it("does not log the dialog's prompt or labels, which are another agent's screen", async () => {
    const { routes, logs } = harness();
    await post(routes, fakeReq({ url: "/api/steer/answer", body: JSON.stringify(answerBody()) }));
    const all = logs.join("\n");
    expect(all).toContain("option=1/2");
    expect(all).not.toContain("Do you trust");
    expect(all).not.toContain("Yes, proceed");
  });

  it("uses the injected log, so a test never writes to the server's stdout", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { routes } = harness();
    await post(routes, fakeReq({ body: JSON.stringify(messageBody()) }));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
