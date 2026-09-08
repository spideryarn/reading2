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

import { classifyGate, fingerprintMaterial, type PaneOption } from "../tools/fleet/pane.js";
import { QuarantineBook } from "../tools/fleet/quarantine.js";
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
    // WHAT THE PAGE SENDS, and the field is here rather than left out because
    // this fixture is a claim about the client. `steerMessageBody` puts
    // `speaker: "greg"` in every body; a fixture without it would be exercising
    // the default path and calling it the page's.
    speaker: "greg",
    ...over,
  };
}

const SEEN_OPTIONS: PaneOption[] = [
  { label: "Yes, proceed", key: { via: "selected" }, consequence: "once" },
  { label: "No, exit", key: { via: "arrows", key: "Down", presses: 1 }, consequence: "decline" },
];

const SEEN: SeenQuestion = {
  kind: "question",
  prompt: "Do you trust the files in this folder?",
  // A trust prompt genuinely has nothing above it to show — the `no-material`
  // arm is a real answer here, not a placeholder standing in for one.
  material: { kind: "no-material" },
  options: SEEN_OPTIONS,
  // Called rather than written out. `gate` is recomputed by `parseQuestion`
  // exactly as `consequence` is, so a literal here would be this file's opinion
  // of the classifier rather than the classifier's — and would go stale the
  // first time a `why` string is reworded. What this route is asserting is that
  // it recomputes at all; whether it classifies *correctly* is
  // tests/fleet-pane.test.ts's job, on real captures.
  gate: classifyGate({ kind: "no-material" }, SEEN_OPTIONS),
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
    // ON BY DEFAULT IN THE HARNESS, off by default in production — and the
    // asymmetry is deliberate rather than a convenience. These tests are about
    // what the route passes DOWN to the delivery module, and every one of them
    // would otherwise be asserting the disabled path instead, quietly, while
    // still reading as a test of answering. The gate itself has its own
    // describe block below, which drives both sides of it explicitly.
    answeringEnabled: () => true,
    /**
     * ITS OWN BOOK, NEVER THE PROCESS-SHARED ONE.
     *
     * `realSteerDeps()` reaches for `sharedQuarantineBook()`, which is a
     * module-level singleton — and a module-level singleton written to by every
     * test in a file is the shape that makes a suite pass alone and fail in a
     * batch. Nothing in THIS file reads the book; what it needs is that a
     * `partial` fixture here cannot leak a hold into another test's world.
     */
    quarantine: new QuarantineBook({ now: () => 1_700_000_000_000, serverInstanceId: "1a2b3c4d" }),
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
    // ATTRIBUTED. The text the delivery module is handed is not the text the
    // body carried: it has the line saying who is speaking in front of it,
    // because every message reaches an agent as an ordinary user turn and
    // nothing else in it says whether a person or an automated coordinator
    // wrote it (tools/fleet/actions.ts § `Speaker`). This route hands text
    // straight to a pane, so this is the assertion that keeps it honest.
    expect(call?.op === "message" && call.text).toBe("[Greg, via the fleet dashboard] please merge origin/dev before you carry on");
    expect(call?.declaredStatus).toEqual({ kind: "needs-you" });
  });

  it("labels a caller that did not say who it was as the Overseer, not as Greg", async () => {
    // THE DEFAULT IS THE WEAKER CLAIM, and it is the whole of `parseSpeaker`'s
    // argument: a coordinator that forgets to say who it is must not inherit
    // Greg's authority by omission, which is the one failure the attribution
    // rule exists to prevent. The other default is unrecoverable — nothing
    // downstream can tell an unattributed message from Greg's.
    const { routes, calls } = harness();
    const body = messageBody();
    delete body["speaker"];
    const r = await post(routes, fakeReq({ body: JSON.stringify(body) }));

    expect(r.status).toBe(200);
    expect(calls[0]?.op === "message" && calls[0].text.startsWith("[The Overseer — an automated coordinator, NOT Greg.")).toBe(true);
  });

  it("refuses a slash command from anybody but Greg, and types nothing", async () => {
    // A slash command cannot carry the prefix — it must be first on the line or
    // Claude Code will not run it — so for any speaker but Greg there is no way
    // to send one AND say who is sending it. `/loop 5m <prose>` is why that
    // matters: the argument to a slash command is instructions, so an
    // unprefixed one is a general way to speak in Greg's voice rather than the
    // narrow, reviewed hole `/compact` opens.
    const { routes, calls } = harness();
    const r = await post(routes, fakeReq({ body: JSON.stringify(messageBody({ speaker: "overseer", text: "/compact" })) }));

    expect(r.status).toBe(400);
    expect(String(r.json.why)).toContain("only Greg may send one");
    expect(calls).toEqual([]);

    // And Greg's own slash command still goes, unprefixed, as it must.
    const mine = await post(routes, fakeReq({ body: JSON.stringify(messageBody({ speaker: "greg", text: "/compact" })) }));
    expect(mine.status).toBe(200);
    expect(calls[0]?.op === "message" && calls[0].text).toBe("/compact");
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

  it("never calls anything that reads the live box", () => {
    // The backstop for the whole design, computed a different way from the
    // tests above: they would all still pass if the route called `capturePane`
    // in addition to forwarding the body. This reads the source.
    //
    // IT USED TO FORBID ANY VALUE IMPORT from collect/pane/status, and that
    // was the wrong rule expressed the easy way. The rule is that this file
    // must not ASK THE BOX ANYTHING — if it re-read the pane at send time,
    // `verifyTarget` would be comparing the box against itself and every guard
    // in steer.ts would pass unconditionally. A pure function that hashes a
    // string or classifies a label does not ask the box anything, and
    // `classifyConsequence` in particular has to be recomputed here rather than
    // trusted from the wire.
    //
    // So the ban is on the reading functions BY NAME. That is a list somebody
    // must extend when pane.ts grows another one — which is worse than a
    // blanket rule and is the price of allowing the two pure ones. The comment
    // at the top of pane.ts's exports says so.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(path.join(here, "..", "tools", "fleet", "routes-steer.ts"), "utf8");
    for (const banned of ["capturePane(", "parsePane(", "collect(", "statusesOf(", "execFile", "realIo("]) {
      expect(src, `routes-steer.ts must not call ${banned} — it would ask the box instead of the client`).not.toContain(
        banned,
      );
    }
    // The positive half, so this cannot pass by the file having been emptied:
    // it does still forward what the client claimed.
    expect(src).toContain("deps.sendMessage(target,");
    expect(src).toContain("deps.answerQuestion(target,");
  });

  it("recomputes an option's consequence rather than trusting the client's", async () => {
    // `consequence` distinguishes "yes, once" from "yes, and stop asking me" —
    // a decision about one action versus a change to the session's permission
    // posture for everything after it. A client that sent the wrong one would
    // otherwise have its word taken, and the wrong word is the dangerous one.
    const { routes, calls } = harness();
    const body = answerBody({
      question: {
        kind: "question",
        prompt: "Do you want to create notes.md?",
        material: { kind: "no-material" },
        options: [
          // The label says "don't ask again"; the client claims it is harmless.
          { label: "Yes, and don't ask again", key: { via: "digit", digit: "2" }, consequence: "once" },
          { label: "No", key: { via: "digit", digit: "3" }, consequence: "once" },
        ],
      },
      optionIndex: 0,
    });
    const r = await post(routes, fakeReq({ url: "/api/steer/answer", body: JSON.stringify(body) }));
    expect(r.status).toBe(200);
    const call = calls[0];
    expect(call?.op).toBe("answer");
    if (call?.op !== "answer") throw new Error("unreachable");
    expect(call.seen.options[0]?.consequence).toBe("persistent");
    // And the honest one was not "corrected" into something else.
    expect(call.seen.options[1]?.consequence).toBe("decline");
  });

  it("refuses a material whose fingerprint does not match its own text", async () => {
    // A body that disagrees with itself has two answers to one question, and
    // something downstream eventually reads the wrong one. Rebuilding the hash
    // removes the disagreement rather than choosing a winner.
    const { routes, calls } = harness();
    const body = answerBody({
      question: {
        kind: "question",
        prompt: "Do you want to create notes.md?",
        material: { kind: "read", text: "1 hello", fingerprint: "0".repeat(64) },
        options: [{ label: "Yes", key: { via: "digit", digit: "1" }, consequence: "once" }],
      },
      optionIndex: 0,
    });
    const r = await post(routes, fakeReq({ url: "/api/steer/answer", body: JSON.stringify(body) }));
    expect(r.status).toBe(400);
    expect(r.json.code).toBe("bad-request");
    expect(calls).toHaveLength(0);
  });

  it("accepts a material whose fingerprint is the real hash of its text", async () => {
    // The other side, so the test above cannot pass by every material being
    // refused — which would disable answering while looking like a guard.
    const text = "1 hello";
    const { routes, calls } = harness();
    const body = answerBody({
      question: {
        kind: "question",
        prompt: "Do you want to create notes.md?",
        material: { kind: "read", text, fingerprint: fingerprintMaterial(text) },
        options: [{ label: "Yes", key: { via: "digit", digit: "1" }, consequence: "once" }],
      },
      optionIndex: 0,
    });
    const r = await post(routes, fakeReq({ url: "/api/steer/answer", body: JSON.stringify(body) }));
    expect(r.status).toBe(200);
    expect(calls).toHaveLength(1);
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
      // A refusal now has to say what happened to the keystrokes, and the
      // compiler insists — `SteerFailure` requires both. `none` is the honest
      // value for this one: the dialog had changed, so nothing was sent.
      delivery: "none",
      sent: [],
    });
    const r = await post(routes, fakeReq({ url: "/api/steer/answer", body: JSON.stringify(answerBody()) }));
    expect(r.status).toBe(409);
    expect(r.status).toBeLessThan(500);
    expect(r.json).toEqual({
      ok: false,
      code: "question-changed",
      why: "pane %99001 is asking something else now",
      // Reaches the CLIENT, not only the log. A refusal is not one thing, and
      // the difference between "nothing was sent" and "your text is sitting in
      // their input box" is the difference between "try again" being right and
      // being the worst available advice — and it is the person on the phone
      // who has to know which.
      delivery: "none",
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

describe("the answering kill switch", () => {
  /**
   * THIS USED TO BE THE WHOLE DISCRIMINATION AND IS NOW ONLY THE OFF SWITCH.
   *
   * Answering was refused outright on 2026-09-08 after two cross-family reviews:
   * Astra changed a proposed file's contents in a fixture and `parsePane`
   * returned an identical question, so the approval bound to the sentence rather
   * than to what was being approved; Sol added that pane text is not provenance
   * at all. The first is fixed — `material` and `sameMaterial`. The second is
   * not fixable, and Greg's reply is why the blanket refusal went:
   *
   * > Yes auto mode is the default. But mightn't there be other reasons why it
   * > needs to answer with multiple choice to a session etc?
   * > — Greg, 2026-09-08
   *
   * There are. So `classifyGate` decides per dialog and `steer.ts` enforces it
   * on a fresh capture, and this flag is what is left: a way to stop all of it
   * at once, defaulting to ON. The gate itself is tested in
   * `tests/fleet-pane.test.ts`, and its refusal in `tests/fleet-steer.test.ts`.
   */
  it("refuses everything when it is switched off, with 503 and a way round it", async () => {
    const { routes, calls } = harness(OK, { answeringEnabled: () => false });
    const r = await post(routes, fakeReq({ url: "/api/steer/answer", body: JSON.stringify(answerBody()) }));
    expect(r.status).toBe(503);
    expect(r.json["code"]).toBe("answering-disabled");
    // The sentence is rendered on a phone by somebody who cannot read this file,
    // so it has to name the switch and the way round it.
    expect(String(r.json["why"])).toMatch(/FLEET_ANSWER_ENABLED=0/);
    expect(String(r.json["why"])).toMatch(/gjd-remote resume/);
    // AND NOTHING REACHED THE DELIVERY MODULE. The status code alone would be
    // satisfied by a route that refuses after sending.
    expect(calls).toEqual([]);
  });

  /**
   * The default, stated as a test rather than left in a comment: unset means ON,
   * and only the exact string "0" means off. Written as the rule rather than by
   * poking `process.env`, which is shared with every other test in the file.
   */
  it("is ON unless the variable is exactly '0'", () => {
    const enabled = (v: string | undefined): boolean => v !== "0";
    expect(enabled(undefined)).toBe(true);
    expect(enabled("1")).toBe(true);
    expect(enabled("")).toBe(true);
    expect(enabled("0")).toBe(false);
  });

  it("leaves sending a MESSAGE alone", async () => {
    // The gate is about tapping an option, not about steering. A gate that
    // quietly took both would be discovered by Greg, at night, on his phone.
    const { routes, calls } = harness(OK, { answeringEnabled: () => false });
    const r = await post(routes, fakeReq({ url: "/api/steer/message", body: JSON.stringify(messageBody()) }));
    expect(r.status).toBe(200);
    expect(calls.map((c) => c.op)).toEqual(["message"]);
  });

  it("lets an answer through when it is switched on", async () => {
    // The other side of the switch, so this file cannot pass by refusing
    // everything — and so the fix, when it lands, has something to flip.
    const { routes, calls } = harness(OK, { answeringEnabled: () => true });
    const r = await post(routes, fakeReq({ url: "/api/steer/answer", body: JSON.stringify(answerBody()) }));
    expect(r.status).toBe(200);
    expect(calls.map((c) => c.op)).toEqual(["answer"]);
  });
});

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
    limiter.check("%1", 0);
    limiter.record("%1", 0);
    expect(limiter.check("%1", 100).ok).toBe(false);
    expect(limiter.check("%1", 200).ok).toBe(false);
    // If the refusals had moved the clock, this would still be inside the floor.
    expect(limiter.check("%1", 1001).ok).toBe(true);
  });

  it("has a whole-box ceiling as well as a per-pane floor", () => {
    const limiter = createRateLimiter({ minIntervalMs: 10, burstMax: 3, burstWindowMs: 10_000 });
    for (const [pane, at] of [["%1", 0], ["%2", 100], ["%3", 200]] as const) {
      expect(limiter.check(pane, at).ok).toBe(true);
      limiter.record(pane, at);
    }
    expect(limiter.check("%4", 300).ok).toBe(false);
    // …and the window is a window, not a total.
    expect(limiter.check("%4", 20_000).ok).toBe(true);
  });

  it("does not spend a slot merely for being asked — Sol's F18", () => {
    // THE COUPLING THIS SPLIT REMOVES. `check` used to record the moment it said
    // yes, so six well-formed but bogus requests spent the whole fleet's
    // allowance and locked out a real one for ten seconds without a keystroke
    // going anywhere. The two tests above were written against that behaviour
    // and passed because of it, which is why they needed rewriting rather than
    // merely adapting.
    const limiter = createRateLimiter({ minIntervalMs: 1000, burstMax: 3, burstWindowMs: 10_000 });
    for (let i = 0; i < 20; i++) expect(limiter.check("%1", i).ok).toBe(true);
    // Twenty questions, no answers spent. And the positive half: once one is
    // actually spent, the floor bites — so this cannot pass by the limiter
    // having stopped working altogether.
    limiter.record("%1", 20);
    expect(limiter.check("%1", 21).ok).toBe(false);
  });

  it("charges a request that reached the delivery module, even when it was refused there", async () => {
    // The other side of F18, and the reason `record` is not simply moved to the
    // success path: a request that got as far as `verifyTarget` has cost the box
    // three tmux commands with ten-second timeouts, whatever it returned. That
    // is the cost the allowance exists to bound.
    let clock = 1_000_000;
    const refused: SteerResult = {
      ok: false,
      reason: { code: "pane-gone", why: "no such pane" },
      delivery: "none",
      sent: [],
    };
    const { routes, calls } = harness(refused, { now: () => clock });
    const first = await post(routes, fakeReq({ body: JSON.stringify(messageBody()) }));
    expect(first.status).toBe(409);
    expect(calls).toHaveLength(1);

    clock += 40;
    const second = await post(routes, fakeReq({ body: JSON.stringify(messageBody()) }));
    expect(second.status).toBe(429);
    // And it did not reach delivery a second time.
    expect(calls).toHaveLength(1);
  });

  it("charges nothing for a request refused before delivery", async () => {
    // A malformed body never reaches tmux, so it must not cost the fleet a slot.
    let clock = 1_000_000;
    const { routes, calls } = harness(OK, { now: () => clock });
    for (let i = 0; i < 8; i++) {
      const bad = await post(routes, fakeReq({ body: JSON.stringify({ paneId: "not-a-pane" }) }));
      expect(bad.status).toBe(400);
    }
    expect(calls).toHaveLength(0);

    clock += 1;
    const real = await post(routes, fakeReq({ body: JSON.stringify(messageBody()) }));
    expect(real.status).toBe(200);
    expect(calls).toHaveLength(1);
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
      // STAMPED HERE, not read from the body, and not one of the six real
      // causes `sessionState` can produce. This status did not come from the
      // box; a browser said what it had on screen. Writing `agents-unavailable`
      // would assert that the box reported a fault when the box was never
      // asked — the same lie as inventing a `collectedAt` for a collection that
      // never happened. The client's own prose survives in `why`, which is what
      // the refusal sentence renders.
      cause: "client-declared",
      why: "no agents list",
    });
    expect(parseStatus({ kind: "shell" })).toBeNull();
    expect(parseStatus({ kind: "invented" })).toBeNull();
  });

  it("overwrites a cause the client sent rather than believing it", () => {
    // The half the assertion above cannot show, because its input has no cause
    // to overwrite. A client that names one of the box's real faults must not
    // have that string laundered into a field whose whole purpose is to say
    // what the BOX observed.
    const s = parseStatus({ kind: "unknown", cause: "agents-unavailable", why: "no agents list" });
    expect(s).toEqual({ kind: "unknown", cause: "client-declared", why: "no agents list" });
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

  it("keeps a refusal to ONE line, whatever another process put in its own argv", async () => {
    // A refusal's `why` names what it found — a flag, a session id — and those
    // come out of somebody else's command line. Anyone who can start a process
    // on this box chooses them, and `claude --session-id $'x\nSENT …'` would
    // otherwise write a second, forged line into the log a person reads to find
    // out what went wrong. THE FILE ALREADY PROTECTS THE MESSAGE from the log
    // and said so; it was letting argv in through the back.
    const forged = "x\nsteer message: SENT pane=%99001 landed=2 calls";
    const { routes, logs } = harness({
      ok: false,
      delivery: "none",
      sent: [],
      reason: { code: "claude-unreadable", why: `a claude under pane %99001 carrying \`--session-id ${forged}\`` },
    });
    await post(routes, fakeReq({ body: JSON.stringify(messageBody()) }));

    const refusals = logs.filter((l) => l.includes("refused"));
    expect(refusals).toHaveLength(1);
    for (const line of logs) expect(line).not.toContain("\n");
    // The reason still reaches the reader — it is flattened, not withheld.
    expect(refusals[0]).toContain("claude-unreadable");
    expect(refusals[0]).toContain("SENT pane=%99001");
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
