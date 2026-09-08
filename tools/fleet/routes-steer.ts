/**
 * v0.2 of the fleet dashboard: the HTTP skin over `steer.ts`.
 *
 * THIS IS THE FIRST WRITE PATH IN A TOOL THAT WAS READ-ONLY, and everything it
 * does is either parsing or refusing. The delivery module next door
 * (`steer.ts`) owns every question about whether a keystroke may go out; this
 * file owns the four questions a network hop adds:
 *
 *  1. **is this body anything at all** — it arrives from a browser, where the
 *     TypeScript types are comments and the JSON can be any shape;
 *  2. **did a person on this dashboard ask for it**, rather than a page on some
 *     other origin using a browser as a confused deputy (see `checkOrigin`);
 *  3. **is it the same session the person was LOOKING AT** — see
 *     "THE CLIENT'S CLAIMS ARE THE INPUT" below, which is the whole design;
 *  4. **is it the fortieth in a second**, from a held-down key on a phone.
 *
 * THE CLIENT'S CLAIMS ARE THE INPUT, AND THIS FILE NEVER LOOKS THEM UP.
 * `paneId`, `sessionId`, `claudeSessionId`, `panePid` and the declared status
 * all come out of the request body, because they are what the person could see
 * when they tapped. If this route re-read them from live tmux at send time,
 * `verifyTarget` would be comparing the box against itself and every guard in
 * `steer.ts` would pass unconditionally — the page could be ten minutes stale,
 * the session could have been resumed into a different conversation, and the
 * message would still go out with a green tick. That is failure mode 5 in the
 * delivery module's own report, and it is the reason this file imports NO VALUE
 * from `collect.ts`, `status.ts` or `pane.ts`: only types, which cost nothing at
 * runtime. `tests/fleet-steer-route.test.ts` reads this source and fails if a
 * value import appears.
 *
 * NO IMPORT SIDE EFFECTS, the same rule as every other module here: nothing at
 * module scope runs a command, binds anything or reads the environment. The
 * shared router is built on first use.
 *
 * `console.log` rather than src/log.ts — the reason is in server.ts's header,
 * and it applies here for the same reason. EVERY ATTEMPT AND EVERY OUTCOME IS
 * LOGGED, and the message text is NEVER logged: this box's dashboard log would
 * otherwise become a transcript of everything anybody has ever said to an agent,
 * sitting in a place nobody thinks of as one. Character counts only.
 */
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import type { Readable } from "node:stream";

import type { OptionKey, PaneOption } from "./pane.js";
import type { FleetStatus } from "./status.js";
import {
  answerQuestion as realAnswerQuestion,
  sendMessage as realSendMessage,
  type RefusalCode,
  type SeenQuestion,
  type SteerResult,
  type SteerTarget,
  type Verified,
} from "./steer.js";

/* ------------------------------------------------------------------ *
 * Limits. Exported so a test can drive them rather than sleeping.
 * ------------------------------------------------------------------ */

/**
 * 16 KiB, against a 4000-character message limit in `checkText`.
 *
 * The number matters less than the fact that there is one. A `for await` over a
 * request stream with no cap is a memory hole a single POST can drive: on a box
 * that hit load 391 with the OOM killer firing this morning, "the dashboard ate
 * the RAM" is not a theoretical failure. The answer dialog is the bigger of the
 * two bodies — a prompt plus every option label — and 16 KiB is roomy for it.
 */
export const MAX_BODY_BYTES = 16 * 1024;

/** Per-pane floor between two accepted sends. A held key on a phone repeats far faster. */
export const MIN_INTERVAL_MS = 1_500;
/** And a whole-box ceiling, so twenty panes cannot each be at their own floor. */
export const BURST_MAX = 6;
export const BURST_WINDOW_MS = 10_000;

/* ------------------------------------------------------------------ *
 * The wire shapes.
 * ------------------------------------------------------------------ */

/**
 * Everything wrong that is not a `Refusal` from the delivery module.
 *
 * A separate namespace from `RefusalCode` on purpose: the client must be able to
 * tell "we did not send, and here is which of the world's facts had changed"
 * from "your request never got as far as the guards". `internal` is the only one
 * that means the server broke.
 */
export type RouteErrorCode =
  | "bad-request"
  | "forbidden-origin"
  | "unsupported-media-type"
  | "body-too-large"
  | "rate-limited"
  | "method-not-allowed"
  | "internal";

export type SteerOp = "message" | "answer";

/** What the client gets back. `ok:false` always carries a code and a sentence. */
export type SteerResponse =
  | { ok: true; op: SteerOp; verified: Verified; sent: readonly (readonly string[])[] }
  | { ok: false; code: RefusalCode | RouteErrorCode; why: string };

/**
 * A refusal's HTTP status.
 *
 * **Nothing in here is a 5xx, and nothing in here is a 200.** A `Record` keyed
 * by the union rather than a switch with a default, so that a thirteenth
 * `RefusalCode` in steer.ts stops this file compiling instead of inheriting
 * somebody's guess. Two groups:
 *
 *  - **400** — the request itself is wrong, and re-sending it unchanged will
 *    fail again. A bug in the client, or a message with a newline in it.
 *  - **409** — the request was well-formed and the BOX is not what the client
 *    said it was. Refreshing and looking again is the move. `box-unreadable`
 *    and `send-failed` are here rather than at 503 deliberately: from the
 *    client's point of view the useful fact is "nothing was delivered, your
 *    view may be stale", and a 5xx would be read as "the dashboard is down" by
 *    every retry loop that ever gets pointed at this. The code in the body is
 *    what distinguishes them, and it is always there.
 */
export const REFUSAL_STATUS: Record<RefusalCode, number> = {
  "bad-target": 400,
  "bad-text": 400,
  "no-such-option": 400,
  "declared-not-steerable": 409,
  "box-unreadable": 409,
  "pane-gone": 409,
  "wrong-pane": 409,
  "pane-in-copy-mode": 409,
  "no-claude-in-pane": 409,
  "question-gone": 409,
  "question-changed": 409,
  "send-failed": 409,
};

/* ------------------------------------------------------------------ *
 * Reading a body without trusting its size.
 * ------------------------------------------------------------------ */

/** Just enough of an `IncomingMessage` to read one, so a test needs no server. */
export type BodyStream = Readable & { headers: IncomingHttpHeaders };

export type BodyRead =
  | { ok: true; text: string; bytesRead: number }
  | { ok: false; code: RouteErrorCode; why: string; bytesRead: number };

/**
 * The body, or a refusal, and never more than `limit` bytes in memory.
 *
 * TWO CHECKS, NOT ONE. `content-length` is consulted first because rejecting
 * before reading is free — but it is a claim, and a chunked request has none at
 * all, so the running total is the one that actually holds. The moment the total
 * crosses the limit we stop counting, drop what we have, destroy the socket and
 * resolve; `bytesRead` is returned so a test can assert we stopped, which is the
 * only way to tell "capped" from "buffered the lot and then complained"
 * (silent-success.md: ask what your check prints when it is defeated).
 */
export function readBody(req: BodyStream, limit: number = MAX_BODY_BYTES): Promise<BodyRead> {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > limit) {
    req.destroy();
    return Promise.resolve({
      ok: false,
      code: "body-too-large",
      why: `the body says it is ${declared} bytes and the limit is ${limit}`,
      bytesRead: 0,
    });
  }
  return new Promise<BodyRead>((resolve) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let done = false;
    const finish = (r: BodyRead): void => {
      if (done) return;
      done = true;
      resolve(r);
    };
    req.on("data", (chunk: Buffer | string) => {
      if (done) return;
      const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
      bytes += buf.length;
      if (bytes > limit) {
        // Drop what we have rather than keep it: the request is refused either
        // way, and holding it is the memory the cap exists to save.
        chunks.length = 0;
        finish({ ok: false, code: "body-too-large", why: `the body is over ${limit} bytes`, bytesRead: bytes });
        req.destroy();
        return;
      }
      chunks.push(buf);
    });
    req.on("end", () => finish({ ok: true, text: Buffer.concat(chunks).toString("utf8"), bytesRead: bytes }));
    req.on("error", (err: Error) =>
      finish({ ok: false, code: "bad-request", why: `the request stream failed: ${err.message}`, bytesRead: bytes }),
    );
    req.on("aborted", () =>
      finish({ ok: false, code: "bad-request", why: "the request was aborted", bytesRead: bytes }),
    );
  });
}

/* ------------------------------------------------------------------ *
 * Who is allowed to POST.
 * ------------------------------------------------------------------ */

export type HeaderVerdict = { ok: true } | { ok: false; status: number; code: RouteErrorCode; why: string };

/**
 * A hostname we are willing to be addressed as.
 *
 * IP literals, `localhost`, and Tailscale's MagicDNS suffix — nothing else, and
 * that is what closes DNS rebinding. Without it, a page at `evil.example` whose
 * DNS re-resolves to this box's tailnet address sends `Host: evil.example` AND
 * `Origin: http://evil.example`, which agree with each other perfectly and would
 * sail through a same-origin comparison. There is no name this dashboard is
 * legitimately reached by that is not in this set — `parseBinds` in config.ts
 * refuses a wildcard and the two real binds are a literal `127.0.0.1` and a
 * tailnet address.
 */
function addressableHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (h === "localhost") return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
  if (h.includes(":") && /^[0-9a-f:.]+$/.test(h)) return true;
  return h.endsWith(".ts.net");
}

function header(headers: IncomingHttpHeaders, name: string): string | null {
  const v = headers[name];
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v[0] ?? null;
  return null;
}

/**
 * The CSRF check, and it is worth being precise about what it buys.
 *
 * **WHAT IT STOPS.** This server has no authentication — reachability over the
 * tailnet is the whole of the access control (orchestrator-direction.md
 * § Access). So any page in any browser on any device that is on the tailnet can
 * issue a cross-origin POST at this port, and without this function that POST
 * would type into somebody's agent session. Requiring an `Origin` that matches
 * the `Host` we were reached by means:
 *
 *  - a form or `fetch` from another page cannot forge it — `Origin` is set by
 *    the browser and is not writable by script;
 *  - `Origin: null` is refused rather than treated as absent, which is what a
 *    sandboxed iframe, a `data:` document and some redirect chains send;
 *  - a missing `Origin` is refused too, so a non-browser client has to opt in by
 *    saying which origin it is claiming to be;
 *  - `content-type: application/json` is required, which the CORS "simple
 *    request" rules do not permit cross-origin without a preflight — and this
 *    server answers no preflight, so the browser blocks such a request before we
 *    ever see it. That is the second lock; the `Origin` check is the first;
 *  - `addressableHost` refuses a public DNS name, which is what a rebinding
 *    attack must present.
 *
 * **WHAT IT DOES NOT STOP, and nothing in this file could.** It is not
 * authentication. Anything on the tailnet that can make an HTTP request with
 * headers of its own choosing — `curl`, a script, a compromised app on a phone,
 * another agent on this box — sets `Origin` to whatever it likes and is
 * indistinguishable from the dashboard. It does not stop the dashboard's own
 * page being driven by a browser extension, or by an XSS in the dashboard, both
 * of which are same-origin by definition. It does not stop a person on the
 * tailnet who simply opens the dashboard. And it says nothing about WHICH
 * person pressed the button, because there is nobody to say. The threat it
 * addresses is the browser-as-confused-deputy one; the rest is reachability,
 * and reachability is still the design.
 */
export function checkOrigin(headers: IncomingHttpHeaders): HeaderVerdict {
  const contentType = (header(headers, "content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (contentType !== "application/json") {
    return {
      ok: false,
      status: 415,
      code: "unsupported-media-type",
      why: `content-type must be application/json, not '${contentType || "(absent)"}'`,
    };
  }
  const origin = header(headers, "origin");
  if (origin === null || origin === "" || origin === "null") {
    return {
      ok: false,
      status: 403,
      code: "forbidden-origin",
      why: "a same-origin Origin header is required on a write",
    };
  }
  const host = header(headers, "host");
  if (host === null || host === "") {
    return {
      ok: false,
      status: 403,
      code: "forbidden-origin",
      why: "the request has no Host header to match the Origin against",
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return { ok: false, status: 403, code: "forbidden-origin", why: `'${origin}' is not an origin` };
  }
  if (parsed.host.toLowerCase() !== host.toLowerCase()) {
    return {
      ok: false,
      status: 403,
      code: "forbidden-origin",
      why: `Origin ${parsed.host} is not this server (${host})`,
    };
  }
  if (!addressableHost(parsed.hostname)) {
    return {
      ok: false,
      status: 403,
      code: "forbidden-origin",
      why: `this dashboard is not reached by the name '${parsed.hostname}'`,
    };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * Parsing. Every field of every body, checked.
 * ------------------------------------------------------------------ */

export type Parsed<T> = { ok: true; value: T } | { ok: false; why: string };

function bad<T>(why: string): Parsed<T> {
  return { ok: false, why };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/**
 * Every `FleetStatus` kind, as a compile-time list.
 *
 * A `Record` keyed by the union, so an eighth `SessionState` arm fails to
 * compile here and somebody decides whether the dashboard may declare it — the
 * same trick, and the same reason, as `steerableStatus`'s `never`.
 */
const STATUS_KINDS: Record<FleetStatus["kind"], true> = {
  "needs-you": true,
  working: true,
  idle: true,
  waiting: true,
  "no-claude": true,
  shell: true,
  unknown: true,
};

/**
 * The status the CLIENT derived, out of JSON.
 *
 * Parsed rather than trusted, and NOT narrowed to the steerable three: a
 * `shell` declared here produces `declared-not-steerable`, which is the refusal
 * that tells the reader WHY ("it is a shell, which would EXECUTE the message"),
 * where rejecting it as a bad body would only say their JSON was wrong.
 */
export function parseStatus(v: unknown): FleetStatus | null {
  const o = asRecord(v);
  if (!o) return null;
  const kind = asString(o.kind);
  if (kind === null || !Object.hasOwn(STATUS_KINDS, kind)) return null;
  switch (kind) {
    case "needs-you":
      return { kind: "needs-you" };
    case "working":
      return { kind: "working" };
    case "idle":
      return { kind: "idle" };
    case "no-claude":
      return { kind: "no-claude" };
    case "waiting": {
      const secondsLeft = o.secondsLeft;
      if (typeof secondsLeft !== "number" || !Number.isFinite(secondsLeft)) return null;
      return { kind: "waiting", secondsLeft };
    }
    case "shell": {
      const busy = o.busy;
      if (busy !== true && busy !== false && busy !== null) return null;
      return { kind: "shell", busy };
    }
    case "unknown": {
      const why = asString(o.why);
      if (why === null) return null;
      return { kind: "unknown", why };
    }
    default:
      return null;
  }
}

/**
 * One option's keystrokes, REBUILT rather than passed through.
 *
 * The rebuild is not tidiness. `sameQuestion` compares keys with
 * `JSON.stringify`, which is sensitive to PROPERTY ORDER, and a body is in
 * whatever order the client serialised. `{"digit":"1","via":"digit"}` and
 * `{"via":"digit","digit":"1"}` are the same option and different strings, so a
 * faithful pass-through would make an answer fail as `question-changed` for a
 * reason that has nothing to do with the pane. Constructing here in pane.ts's
 * own order removes the question.
 */
export function parseOptionKey(v: unknown): OptionKey | null {
  const o = asRecord(v);
  if (!o) return null;
  switch (asString(o.via)) {
    case "digit": {
      const digit = asString(o.digit);
      return digit === null ? null : { via: "digit", digit };
    }
    case "arrows": {
      const key = asString(o.key);
      const presses = o.presses;
      if (key !== "Down" && key !== "Up") return null;
      if (typeof presses !== "number" || !Number.isSafeInteger(presses)) return null;
      return { via: "arrows", key, presses };
    }
    case "selected":
      return { via: "selected" };
    default:
      return null;
  }
}

/** The dialog the client says it is showing. */
export function parseQuestion(v: unknown): SeenQuestion | null {
  const o = asRecord(v);
  if (!o) return null;
  if (asString(o.kind) !== "question") return null;
  const prompt = asString(o.prompt);
  if (prompt === null) return null;
  const raw = o.options;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 64) return null;
  const options: PaneOption[] = [];
  for (const item of raw) {
    const opt = asRecord(item);
    if (!opt) return null;
    const label = asString(opt.label);
    const key = parseOptionKey(opt.key);
    if (label === null || key === null) return null;
    options.push({ label, key });
  }
  return { kind: "question", prompt, options };
}

/**
 * The three identifiers plus the optional pid, exactly as the client sent them.
 *
 * The SHAPE is checked here and the MEANING is checked by `checkTarget` inside
 * the delivery module, which is one regex's worth of deliberate duplication: a
 * body that is missing a field should say "no claudeSessionId" rather than
 * reaching `verifyTarget` as `undefined` and being reported as a bad address.
 */
export function parseTarget(o: Record<string, unknown>): Parsed<SteerTarget> {
  const paneId = asString(o.paneId);
  const sessionId = asString(o.sessionId);
  const claudeSessionId = asString(o.claudeSessionId);
  if (paneId === null) return bad("paneId is missing, and it is the address");
  if (sessionId === null) return bad("sessionId is missing");
  if (claudeSessionId === null) {
    // Required, not defaulted: it is the only identifier that survives a
    // `gjd-remote resume`, so a caller that omits it is a caller that cannot
    // tell this conversation from the one that replaced it.
    return bad("claudeSessionId is missing, and it is what identifies the CONVERSATION rather than the pane");
  }
  const rawPid = o.panePid;
  if (rawPid === undefined || rawPid === null) {
    return { ok: true, value: { paneId, sessionId, claudeSessionId } };
  }
  if (typeof rawPid !== "number" || !Number.isSafeInteger(rawPid) || rawPid <= 0) {
    return bad("panePid is present and is not a pid; send it correctly or leave it out");
  }
  return { ok: true, value: { paneId, sessionId, claudeSessionId, panePid: rawPid } };
}

export type MessageRequest = { target: SteerTarget; text: string; declaredStatus: FleetStatus };
export type AnswerRequest = {
  target: SteerTarget;
  seen: SeenQuestion;
  optionIndex: number;
  declaredStatus: FleetStatus;
};

/** `POST /api/steer/message`'s body. */
export function parseMessageBody(raw: unknown): Parsed<MessageRequest> {
  const o = asRecord(raw);
  if (!o) return bad("the body is not a JSON object");
  const target = parseTarget(o);
  if (!target.ok) return target;
  const text = asString(o.text);
  if (text === null) return bad("text is missing");
  const declaredStatus = parseStatus(o.status);
  if (declaredStatus === null) {
    return bad("status is missing or is not a status; send the one the row you tapped was showing");
  }
  return { ok: true, value: { target: target.value, text, declaredStatus } };
}

/** `POST /api/steer/answer`'s body. */
export function parseAnswerBody(raw: unknown): Parsed<AnswerRequest> {
  const o = asRecord(raw);
  if (!o) return bad("the body is not a JSON object");
  const target = parseTarget(o);
  if (!target.ok) return target;
  const seen = parseQuestion(o.question);
  if (seen === null) {
    return bad("question is missing or malformed; send the dialog this client is displaying");
  }
  const optionIndex = o.optionIndex;
  if (typeof optionIndex !== "number" || !Number.isSafeInteger(optionIndex) || optionIndex < 0) {
    return bad("optionIndex is missing or is not an index");
  }
  const declaredStatus = parseStatus(o.status);
  if (declaredStatus === null) {
    return bad("status is missing or is not a status; send the one the row you tapped was showing");
  }
  return { ok: true, value: { target: target.value, seen, optionIndex, declaredStatus } };
}

/* ------------------------------------------------------------------ *
 * Rate limiting.
 * ------------------------------------------------------------------ */

export type RateVerdict = { ok: true } | { ok: false; why: string; retryAfterMs: number };

export type RateLimiter = { check(key: string, now: number): RateVerdict };

/**
 * A floor per pane and a ceiling for the box.
 *
 * The per-pane floor is the one this exists for: a key held down on a phone's
 * on-screen keyboard, or a double-tap on a button whose first press has not
 * visibly landed yet, would otherwise deliver a stream of keystrokes into a live
 * agent. The whole-box ceiling catches the shape the floor cannot — a script
 * walking every row at once.
 *
 * A REFUSED REQUEST DOES NOT CONSUME A SLOT, so a client that hammers cannot
 * push its own next legitimate press further away; only accepted sends move the
 * clock. The clock is injected rather than read, so the test measures the rule
 * instead of sleeping through it.
 */
export function createRateLimiter(
  opts: { minIntervalMs: number; burstMax: number; burstWindowMs: number } = {
    minIntervalMs: MIN_INTERVAL_MS,
    burstMax: BURST_MAX,
    burstWindowMs: BURST_WINDOW_MS,
  },
): RateLimiter {
  const lastByKey = new Map<string, number>();
  let recent: number[] = [];
  return {
    check(key, now) {
      const prev = lastByKey.get(key);
      if (prev !== undefined && now - prev < opts.minIntervalMs) {
        return {
          ok: false,
          why: `that session had a keystroke ${now - prev}ms ago; the floor is ${opts.minIntervalMs}ms`,
          retryAfterMs: opts.minIntervalMs - (now - prev),
        };
      }
      recent = recent.filter((t) => now - t < opts.burstWindowMs);
      if (recent.length >= opts.burstMax) {
        const oldest = recent[0] ?? now;
        return {
          ok: false,
          why: `${recent.length} sends across the fleet in the last ${opts.burstWindowMs}ms is the ceiling`,
          retryAfterMs: Math.max(1, opts.burstWindowMs - (now - oldest)),
        };
      }
      lastByKey.set(key, now);
      recent.push(now);
      // The map is keyed by pane id, which is unbounded over a long uptime.
      // Forget anything far older than its own floor.
      if (lastByKey.size > 256) {
        for (const [k, t] of lastByKey) if (now - t > opts.minIntervalMs * 20) lastByKey.delete(k);
      }
      return { ok: true };
    },
  };
}

/* ------------------------------------------------------------------ *
 * The routes.
 * ------------------------------------------------------------------ */

/**
 * The seam. `sendMessage` and `answerQuestion` are injected so that this file's
 * own tests can prove what it passes DOWN without a single real keystroke going
 * out — there are ~37 live agent sessions on this box doing other people's work,
 * and a test suite is not a reason to type into one. The delivery module has its
 * own live-fire evidence; these tests must not repeat it.
 */
export type SteerDeps = {
  sendMessage: typeof realSendMessage;
  answerQuestion: typeof realAnswerQuestion;
  now: () => number;
  limiter: RateLimiter;
  log: (line: string) => void;
};

export function realSteerDeps(): SteerDeps {
  return {
    sendMessage: realSendMessage,
    answerQuestion: realAnswerQuestion,
    now: () => Date.now(),
    limiter: createRateLimiter(),
    log: (line) => console.log(line),
  };
}

export type SteerRoutes = {
  /** True when this request was ours — mounted the way `serveStatic` is. */
  handle(req: IncomingMessage, res: ServerResponse): boolean;
};

function respond(res: ServerResponse, status: number, body: SteerResponse, extra: Record<string, string> = {}): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...extra });
  res.end(json);
}

/** The bit of a request that identifies the caller, for the log. Never the body. */
function who(req: IncomingMessage): string {
  const origin = header(req.headers, "origin") ?? "-";
  const from = req.socket?.remoteAddress ?? "-";
  return `from=${from} origin=${origin}`;
}

export function makeSteerRoutes(overrides: Partial<SteerDeps> = {}): SteerRoutes {
  const deps: SteerDeps = { ...realSteerDeps(), ...overrides };

  async function run(op: SteerOp, req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Logged BEFORE anything can refuse it, so an attempt turned away at the
    // door still leaves a trace. A write path whose log records only the
    // successes is a write path you cannot investigate.
    deps.log(`steer ${op}: attempt ${who(req)}`);

    const headerCheck = checkOrigin(req.headers);
    if (!headerCheck.ok) {
      deps.log(`steer ${op}: refused code=${headerCheck.code} why=${headerCheck.why}`);
      respond(res, headerCheck.status, { ok: false, code: headerCheck.code, why: headerCheck.why });
      return;
    }

    const body = await readBody(req);
    if (!body.ok) {
      deps.log(`steer ${op}: refused code=${body.code} bytes=${body.bytesRead}`);
      respond(res, body.code === "body-too-large" ? 413 : 400, { ok: false, code: body.code, why: body.why });
      return;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(body.text);
    } catch (e) {
      deps.log(`steer ${op}: refused code=bad-request why=not-json`);
      respond(res, 400, { ok: false, code: "bad-request", why: `the body is not JSON: ${(e as Error).message}` });
      return;
    }

    const parsed = op === "message" ? parseMessageBody(raw) : parseAnswerBody(raw);
    if (!parsed.ok) {
      deps.log(`steer ${op}: refused code=bad-request why=${parsed.why}`);
      respond(res, 400, { ok: false, code: "bad-request", why: parsed.why });
      return;
    }
    const request = parsed.value;
    const target = request.target;

    // Note what is NOT in this line: the message. Its length, the session, the
    // option index — enough to reconstruct what happened, and nothing that turns
    // this log into a record of what people say to their agents.
    const shape =
      "text" in request ? `chars=${request.text.length}` : `option=${request.optionIndex}/${request.seen.options.length}`;
    deps.log(
      `steer ${op}: pane=${target.paneId} session=${target.sessionId} claude=${target.claudeSessionId} ` +
        `pid=${target.panePid ?? "-"} declared=${request.declaredStatus.kind} ${shape}`,
    );

    const rate = deps.limiter.check(target.paneId, deps.now());
    if (!rate.ok) {
      deps.log(`steer ${op}: refused code=rate-limited pane=${target.paneId} why=${rate.why}`);
      respond(
        res,
        429,
        { ok: false, code: "rate-limited", why: rate.why },
        { "retry-after": String(Math.max(1, Math.ceil(rate.retryAfterMs / 1000))) },
      );
      return;
    }

    // EVERY FIELD BELOW COMES OUT OF THE BODY. Nothing here asks tmux who is in
    // that pane — see the header. The delivery module does the asking, and it
    // compares what it finds against these claims.
    let result: SteerResult;
    try {
      result =
        "text" in request
          ? deps.sendMessage(target, request.text, request.declaredStatus)
          : deps.answerQuestion(target, request.seen, request.optionIndex, request.declaredStatus);
    } catch (e) {
      // Only a bug reaches here: every expected failure is a `Refusal`. So this
      // is the one 5xx in the file, and it says `internal` rather than a refusal
      // code so the client can tell a broken server from a stale view.
      const why = `the delivery module threw: ${(e as Error).message}`;
      deps.log(`steer ${op}: FAILED pane=${target.paneId} ${why}`);
      respond(res, 500, { ok: false, code: "internal", why });
      return;
    }

    if (!result.ok) {
      deps.log(`steer ${op}: refused pane=${target.paneId} code=${result.reason.code} why=${result.reason.why}`);
      respond(res, REFUSAL_STATUS[result.reason.code], {
        ok: false,
        code: result.reason.code,
        why: result.reason.why,
      });
      return;
    }

    deps.log(
      `steer ${op}: SENT pane=${result.verified.paneId} session=${result.verified.sessionId} ` +
        `panePid=${result.verified.panePid} claudePid=${result.verified.claudePid} calls=${result.sent.length}`,
    );
    respond(res, 200, { ok: true, op, verified: result.verified, sent: result.sent });
  }

  return {
    handle(req, res) {
      const path = (req.url ?? "/").split("?")[0] ?? "/";
      const op: SteerOp | null =
        path === "/api/steer/message" ? "message" : path === "/api/steer/answer" ? "answer" : null;
      if (op === null) return false;
      if (req.method !== "POST") {
        // A GET at this URL is a link somebody sent, or a browser prefetching.
        // Neither may type into a session.
        respond(res, 405, { ok: false, code: "method-not-allowed", why: "steering is POST only" }, { allow: "POST" });
        return true;
      }
      // The promise is deliberately floating: `handler` in server.ts is
      // synchronous and returns void, the same as `serveStatic`. `run` cannot
      // reject — every path inside it is caught — so there is nothing to await.
      void run(op, req, res);
      return true;
    },
  };
}

/**
 * The mounted routes, built once, on first use rather than at import.
 *
 * Lazy because the rate limiter is state, and a module-scope one would be built
 * by anything that so much as imports a type from here. NO IMPORT SIDE EFFECTS
 * is the rule the rest of this directory keeps, and a limiter is exactly the
 * sort of thing that quietly becomes one.
 */
let shared: SteerRoutes | null = null;

export function handleSteerRequest(req: IncomingMessage, res: ServerResponse): boolean {
  shared ??= makeSteerRoutes();
  return shared.handle(req, res);
}
