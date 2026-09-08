/**
 * **The impure half of a rule: how it looks at the box, and what it is allowed
 * to do about what it sees.**
 *
 * `rules.ts` is the arithmetic and `rule-protocol.ts` is the ordering. This file is
 * the one function those two are given — deliberately small, because everything
 * a person would want to argue with afterwards is in the pure half.
 *
 * ## Both rules ask the dashboard, and that is one mechanism rather than two
 *
 * Rule 2 POSTs the box action's dry run; rule 1 GETs `/api/state` and reads
 * `permissionMode` off the rows. Same origin, same module, same shape of
 * `cannot-see`.
 *
 * **The plan proposed something else for rule 1** — that the daemon already
 * holds the raw payload from its own stream, so a rule could read that and
 * spend no request. Not taken, and the argument is worth keeping because it is
 * a close call. Reading the daemon's held payload means new plumbing between
 * `daemon.ts`, `scripts/overseer.ts` and this file; it makes rule 1 blind
 * exactly when the Overseer's transport is down, which is when the box is
 * least well; and, decisively, it would give the rules **two different ways to
 * look at the fleet** where one already works. `/api/state` serves a cached
 * string and does not make the box collect — `source.ts`'s own fallback poller
 * hits it every 15 seconds, against rule 1's once every 15 minutes — so the
 * cost the plan was avoiding is a request that reads a variable. What the plan
 * was really insisting on is that nothing here widens `ObservedRow` or touches
 * `observation.ts`, and nothing here does: this is its own narrow parser with
 * its own unknown arms.
 *
 * ## Looking is the dashboard's own dry run, and nothing else
 *
 * `killRoute`'s `dry-run` branch already scans the process table, computes the
 * candidates through `selectForKill`, and answers with each one's named rule and
 * its `etimeSeconds`. It **signals nothing and spends no limiter** — verified in
 * `tools/fleet/routes-actions.ts` before this was written. So rule 2 writes no
 * second process scan and invents no second recogniser: a second one would drift
 * from the list the confirmation panel shows, and the whole value of the number
 * this rule records is that it is the number the page shows.
 *
 * **`mode` is the literal `"dry-run"` here and there is no parameter for it.**
 * Not a default, not a flag: this module has no way to express a request that
 * kills. Gate 3 — *never act on a job definition that changed after it was
 * authorised* — and the plan's own rule that v1 proposes and never takes.
 *
 * ## Acting, which this module cannot do — and it is an absence, not a refusal
 *
 * There is **no actor in this file**. `ruleWork` hands the daemon `observe` and
 * a pid, so the process holds no capability to act on a proposal, and a spec
 * carrying `disposition: "act"` meets a refusal from `rule-protocol.ts` naming
 * the actor it does not have. That replaced a `refusingActor` which answered
 * `refused` politely: GPT Sol's SC-2 is that such a thing is a runtime
 * conditional wearing the clothes of a boundary.
 *
 * The reason there is nothing to put here is SP-7: the kill route checks
 * `confirm: true` before it checks `FLEET_ACT_ENABLED`, and **an unattended
 * process asserting a human-facing confirmation is the authority grant itself**,
 * which is Greg's to make and nobody else's.
 */
import type { ActionId, KillPolicy } from "../fleet/actions.js";
import type { ProposingRuleWork } from "./rule-protocol.js";
import type {
  LaunchModeSpec,
  ObservedCollection,
  ObservedLaunchMode,
  ObservedSession,
  RuleObservation,
  RuleSpec,
  WedgedProcess,
  WedgedWorkSpec,
} from "./rules.js";

/** The env var that arms the deterministic rules ALONE. See `scripts/overseer.ts` § schedulerWiring for why that is a separate switch. */
export const RULES_ENABLED_VAR = "OVERSEER_RULES_ENABLED";

/** Same shape as `OVERSEER_JOBS_ENABLED` and `FLEET_ACT_ENABLED`: exactly `"1"`, nothing else, off by default. */
export function rulesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[RULES_ENABLED_VAR] === "1";
}

/**
 * How long the dashboard has to answer before the rule gives up looking.
 *
 * The dry run reads the whole process table — 750 processes on this box on
 * 2026-09-08 — so it is not instant, and a box under the pressure this rule
 * exists to notice is exactly when it will be slowest. Ten seconds is generous
 * against a measured sub-second call, and giving up is a `cannot-see`, which
 * ends the attempt rather than starting a retry.
 */
export const OBSERVE_TIMEOUT_MS = 10_000;

/** Which box action's dry run answers a given policy's question. Exhaustive, so a third policy has to say which action it means. */
function killActionFor(policy: KillPolicy): ActionId {
  switch (policy) {
    case "safe-to-kill":
      return "kill-safe-processes";
    case "test-suites":
      return "kill-test-suites";
    default: {
      const never: never = policy;
      throw new Error(`no kill action for policy ${JSON.stringify(never)}`);
    }
  }
}

/** The subset of `fetch` this needs, so a test can answer without a socket. */
export type HttpPost = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
}>;

/** The subset of `fetch` rule 1 needs. Separate from `HttpPost` because the shapes of the two calls are different and a union would hide which. */
export type HttpGet = (url: string, init: { method: string; headers: Record<string, string>; signal: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
}>;

export type ObserverOptions = {
  /** Where the dashboard is, origin included — `http://127.0.0.1:8787`. */
  readonly baseUrl: string;
  readonly post?: HttpPost;
  readonly get?: HttpGet;
  readonly timeoutMs?: number;
};

function isRecord(u: unknown): u is Record<string, unknown> {
  return typeof u === "object" && u !== null && !Array.isArray(u);
}

/**
 * One candidate off the wire.
 *
 * Checked field by field rather than cast, for the reason `store.ts`'s parser
 * gives: this is a boundary, and a candidate whose `etimeSeconds` arrived as a
 * string would compare `>= 14400` as `false` and quietly turn a wedged box into
 * *"nothing is wedged"* — a refusal that looks exactly like a clean bill.
 */
function parseCandidate(u: unknown): WedgedProcess | null {
  if (!isRecord(u)) return null;
  const { pid, rule, why, comm, args, rssKiB, etimeSeconds } = u;
  if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 1) return null;
  if (typeof rule !== "string" || rule === "") return null;
  for (const value of [why, comm, args]) if (typeof value !== "string") return null;
  for (const value of [rssKiB, etimeSeconds]) if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return {
    pid,
    rule,
    why: why as string,
    comm: comm as string,
    args: args as string,
    rssKiB: rssKiB as number,
    etimeSeconds: etimeSeconds as number,
  };
}

/**
 * Ask the dashboard what its safe-kill policy licenses right now, and take
 * nothing.
 *
 * The `Origin` header is the dashboard's own, because `checkOrigin` requires
 * one that matches `Host` — the CSRF check is about a browser being used as a
 * confused deputy, and a server-side caller says which origin it is claiming to
 * be. That is the documented way for a non-browser client to opt in
 * (`routes-steer.ts` § checkOrigin), not a bypass of anything.
 */
export function fleetObserver(options: ObserverOptions): (spec: WedgedWorkSpec) => Promise<RuleObservation> {
  const post: HttpPost = options.post ?? ((url, init) => fetch(url, init));
  const timeoutMs = options.timeoutMs ?? OBSERVE_TIMEOUT_MS;
  const url = `${options.baseUrl.replace(/\/+$/, "")}/api/actions/box`;
  const origin = new URL(options.baseUrl).origin;
  return async (spec: WedgedWorkSpec): Promise<RuleObservation> => {
    const cannotSee = (why: string): RuleObservation => ({ kind: "cannot-see", why: `could not reach the fleet API at ${url}: ${why}` });
    let response: Awaited<ReturnType<HttpPost>>;
    try {
      response = await post(url, {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        // THE MODE IS A LITERAL. There is no parameter that could make this a
        // `run`, and `confirm` is absent rather than false, so no caller of this
        // module can turn a look into a kill.
        body: JSON.stringify({ actionId: killActionFor(spec.policy), mode: "dry-run", speaker: "overseer", pids: [] }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      return cannotSee(cause instanceof Error ? cause.message : String(cause));
    }
    if (!response.ok) return cannotSee(`it answered ${response.status} ${response.statusText}`);
    let body: unknown;
    try {
      body = JSON.parse(await response.text()) as unknown;
    } catch (cause) {
      return cannotSee(`its answer was not JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    if (!isRecord(body) || body["ok"] !== true || !isRecord(body["result"])) {
      return cannotSee("its answer was not a dry-run result this version understands");
    }
    const result = body["result"];
    const raw = result["candidates"];
    const scanned = result["scanned"];
    if (!Array.isArray(raw) || typeof scanned !== "number") return cannotSee("its dry-run result has no candidate list to read");
    const candidates: WedgedProcess[] = [];
    for (const item of raw) {
      const candidate = parseCandidate(item);
      // ONE UNREADABLE CANDIDATE POISONS THE WHOLE OBSERVATION, deliberately.
      // Skipping it would shrink the numerator silently, and this rule's only
      // output is a count somebody is asked to believe.
      if (candidate === null) return cannotSee("one of its candidates is not a process record this version understands");
      candidates.push(candidate);
    }
    return { kind: "wedged", candidates, scanned };
  };
}

/**
 * **What the daemon is handed: looking, and the pid an in-process run is
 * recorded under. There is no actor in it.**
 *
 * This used to carry a `refusingActor` — an `act` that always answered
 * `refused` — and GPT Sol's SC-2 is that a refusing actor is a runtime
 * conditional in the clothes of a boundary: the process held the capability and
 * one edit stood between it and a kill. The refusal is now structural. A daemon
 * given this object has no `act` to call, and a spec carrying
 * `disposition: "act"` meets a `refused` from `rule-protocol.ts` naming the
 * missing actor, exactly as a session job does in a process with no `spawn`.
 *
 * SP-7 is why there is nothing to put here: *an unattended process asserting the
 * `confirm: true` a kill route demands is the authority grant itself*, and that
 * is Greg's to make. Stage 3d is where an actor gets built, and it has to build
 * one rather than switch one on.
 */
export function ruleWork(options: ObserverOptions & { selfPid: number }): ProposingRuleWork {
  const wedged = fleetObserver(options);
  const launchModes = fleetStateObserver(options);
  return {
    selfPid: options.selfPid,
    // ONE OBSERVER PER RULE, CHOSEN BY THE SPEC'S OWN HASHED `kind`, and
    // exhaustive — so a third rule cannot quietly be handed the wrong evidence.
    // The pairing is checked again in `decideRule`, which answers `cannot-tell`
    // rather than deciding on a sighting of the wrong thing.
    observe: async (spec: RuleSpec): Promise<RuleObservation> => {
      switch (spec.kind) {
        case "wedged-work":
          return wedged(spec);
        case "launch-mode":
          return launchModes(spec);
        default: {
          const never: never = spec;
          throw new Error(`no observer for rule spec ${JSON.stringify(never)}`);
        }
      }
    },
  };
}

/* ------------------------------------------------------------------ *
 * Rule 1: reading the permission modes off the dashboard's own state.
 * ------------------------------------------------------------------ */

/**
 * One session's permission mode, off the wire — **with our own unknown arms.**
 *
 * Every failure to read lands on `cannot-tell`, never on `not-auto`, and that
 * is `readPaneMode`'s own rule one layer out: the tempting rule is *anything
 * that is not auto is the defect*, which is right about today's arms and wrong
 * the day the producer adds one. Every row would light up red at once, and a
 * signal that has cried wolf on twenty rows is a signal Greg stops reading.
 * `why` quotes what it actually saw, so teaching this a new arm is one line.
 *
 * An ABSENT field is `cannot-tell` for the same reason and a different one: a
 * dashboard too old to report it has told us nothing, and reading its silence
 * as health is exactly the drop `state.ts` documents on its own side.
 */
function parseLaunchMode(u: unknown): ObservedLaunchMode {
  if (u === undefined || u === null) {
    return { kind: "cannot-tell", why: "this dashboard does not report a permission mode for its rows" };
  }
  if (!isRecord(u)) return { kind: "cannot-tell", why: "the row's permissionMode is not an object" };
  const kind = u["kind"];
  const why = typeof u["why"] === "string" ? (u["why"] as string) : "";
  switch (kind) {
    case "auto":
      return { kind: "auto" };
    case "not-auto": {
      const mode = u["mode"];
      // THE NAME, OR NOTHING. `not-auto` without the mode it printed is a
      // warning a person cannot act on — "manual mode" is a sentence, "not
      // auto" is a thing to go and check — and inventing a name here would put
      // a claim in the log the producer never made.
      if (typeof mode !== "string" || mode === "") {
        return { kind: "cannot-tell", why: "the row says its mode is not auto but does not name it" };
      }
      return { kind: "not-auto", mode };
    }
    case "cannot-tell":
      return { kind: "cannot-tell", why: why === "" ? "the dashboard could not read this session's mode" : why };
    case "not-applicable":
      return { kind: "not-applicable", why: why === "" ? "this row has no permission mode" : why };
    default:
      return { kind: "cannot-tell", why: `the row's permission mode is ${JSON.stringify(kind)}, which this build does not recognise` };
  }
}

/** One row off the wire. Only what rule 1 reads: the address, the name a person would search for, and the mode. */
function parseSession(u: unknown): ObservedSession | null {
  if (!isRecord(u)) return null;
  const id = u["id"];
  if (typeof id !== "string" || id === "") return null;
  const name = u["name"];
  if (typeof name !== "string") return null;
  return { id, name, mode: parseLaunchMode(u["permissionMode"]) };
}

/**
 * How old the collection was when it was served, from the payload's own two
 * timestamps.
 *
 * **Both are the dashboard's clock**, so this is a duration it measured itself
 * and there is no skew between two machines to argue about — which is the
 * whole reason the age is computed here rather than against the Overseer's
 * `now()`.
 *
 * `null` means the pair cannot be read at all, which is a `cannot-see` rather
 * than an age: a payload whose `servedAt` predates its `collectedAt` is a
 * producer we do not understand, and clamping that to zero would turn a broken
 * reading into a fresh-looking one.
 */
function parseCollection(result: Record<string, unknown>): ObservedCollection | null {
  const collectedAt = result["collectedAt"];
  if (collectedAt === null) return { collected: false };
  if (typeof collectedAt !== "string") return null;
  const servedAt = result["servedAt"];
  if (typeof servedAt !== "string") return null;
  const collectedMs = Date.parse(collectedAt);
  const servedMs = Date.parse(servedAt);
  if (!Number.isFinite(collectedMs) || !Number.isFinite(servedMs)) return null;
  if (servedMs < collectedMs) return null;
  return { collected: true, ageSeconds: Math.round((servedMs - collectedMs) / 1000) };
}

/**
 * **Ask the dashboard which mode each session launched in, and take nothing.**
 *
 * `GET /api/state` is the same cached payload the page polls and the Overseer's
 * own fallback reads; it does not make the box collect. No `Origin` header,
 * because this is a read route with no CSRF check to opt into — unlike the
 * action route rule 2 posts to.
 *
 * There is no parameter here that could reach a write route, and no method but
 * GET, for the same reason rule 2's `mode` is a literal.
 */
export function fleetStateObserver(options: ObserverOptions): (spec: LaunchModeSpec) => Promise<RuleObservation> {
  const get: HttpGet = options.get ?? ((url, init) => fetch(url, init));
  const timeoutMs = options.timeoutMs ?? OBSERVE_TIMEOUT_MS;
  const url = `${options.baseUrl.replace(/\/+$/, "")}/api/state`;
  return async (): Promise<RuleObservation> => {
    const cannotSee = (why: string): RuleObservation => ({ kind: "cannot-see", why: `could not read the fleet state at ${url}: ${why}` });
    let response: Awaited<ReturnType<HttpGet>>;
    try {
      response = await get(url, { method: "GET", headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (cause) {
      return cannotSee(cause instanceof Error ? cause.message : String(cause));
    }
    if (!response.ok) return cannotSee(`it answered ${response.status} ${response.statusText}`);
    let body: unknown;
    try {
      body = JSON.parse(await response.text()) as unknown;
    } catch (cause) {
      return cannotSee(`its answer was not JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    if (!isRecord(body)) return cannotSee("its answer was not a fleet state this version understands");
    // **A PAYLOAD THAT SAYS ITS OWN COLLECTION FAILED CARRIES THE PREVIOUS
    // ROWS.** `refresh.ts` keeps the error BESIDE the last snapshot, so
    // `/api/state` goes on serving the sessions it last managed to see with a
    // non-null `error` — and 21:37Z to 21:47Z on 2026-09-08 is what that looks
    // like on this box. Reading those rows is reading the past and calling it
    // the present. `admissible.ts` refuses such a payload for the daemon's own
    // pipeline; this is the same refusal for the rules, and it was missing
    // (GPT Sol's finding 2 on 3b).
    //
    // Present AND null, not merely falsy: a producer that stopped sending the
    // field is one we cannot ask, which is a `cannot-see` rather than a clean
    // bill.
    const error = body["error"];
    if (error !== null) {
      return cannotSee(
        typeof error === "string"
          ? `its last collection failed (${error}), so the rows it is still serving are the previous ones`
          : "it does not say whether its last collection succeeded, so its rows cannot be believed",
      );
    }
    const collection = parseCollection(body);
    if (collection === null) return cannotSee("its collection clock is not a pair of timestamps this version can read");
    const rows = body["rows"];
    if (!Array.isArray(rows)) return cannotSee("its state has no row list to read");
    const sessions: ObservedSession[] = [];
    for (const item of rows) {
      const session = parseSession(item);
      // ONE UNREADABLE ROW POISONS THE WHOLE OBSERVATION, deliberately and for
      // rule 2's reason: skipping it would shrink a denominator silently, and
      // every number this rule records is one somebody is asked to believe.
      // Note the asymmetry that is NOT a leak — a row we can read whose MODE we
      // cannot is a `cannot-tell` arm rather than a poisoning, because that is
      // a fact about one session and this is a fact about the payload.
      if (session === null) return cannotSee("one of its rows is not a session record this version understands");
      sessions.push(session);
    }
    return { kind: "launch-modes", collection, sessions };
  };
}
