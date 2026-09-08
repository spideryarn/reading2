/**
 * **The impure half of a rule: how it looks at the box, and what it is allowed
 * to do about what it sees.**
 *
 * `rules.ts` is the arithmetic and `scheduler.ts` is the ordering. This file is
 * the one function those two are given — deliberately small, because everything
 * a person would want to argue with afterwards is in the pure half.
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
 * carrying `disposition: "act"` meets a refusal from `scheduler.ts` naming the
 * actor it does not have. That replaced a `refusingActor` which answered
 * `refused` politely: GPT Sol's SC-2 is that such a thing is a runtime
 * conditional wearing the clothes of a boundary.
 *
 * The reason there is nothing to put here is SP-7: the kill route checks
 * `confirm: true` before it checks `FLEET_ACT_ENABLED`, and **an unattended
 * process asserting a human-facing confirmation is the authority grant itself**,
 * which is Greg's to make and nobody else's.
 */
import type { ActionId, KillPolicy } from "../fleet/actions.js";
import type { ProposingRuleWork } from "./scheduler.js";
import type { RuleObservation, RuleSpec, WedgedProcess } from "./rules.js";

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

export type ObserverOptions = {
  /** Where the dashboard is, origin included — `http://127.0.0.1:8787`. */
  readonly baseUrl: string;
  readonly post?: HttpPost;
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
export function fleetObserver(options: ObserverOptions): ProposingRuleWork["observe"] {
  const post: HttpPost = options.post ?? ((url, init) => fetch(url, init));
  const timeoutMs = options.timeoutMs ?? OBSERVE_TIMEOUT_MS;
  const url = `${options.baseUrl.replace(/\/+$/, "")}/api/actions/box`;
  const origin = new URL(options.baseUrl).origin;
  return async (spec: RuleSpec): Promise<RuleObservation> => {
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
    return { kind: "seen", candidates, scanned };
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
 * `disposition: "act"` meets a `refused` from `scheduler.ts` naming the missing
 * actor, exactly as a session job does in a process with no `spawn`.
 *
 * SP-7 is why there is nothing to put here: *an unattended process asserting the
 * `confirm: true` a kill route demands is the authority grant itself*, and that
 * is Greg's to make. Stage 3d is where an actor gets built, and it has to build
 * one rather than switch one on.
 */
export function ruleWork(options: ObserverOptions & { selfPid: number }): ProposingRuleWork {
  return { selfPid: options.selfPid, observe: fleetObserver(options) };
}
