/**
 * `GET /api/admission` — what the existing Vitest gate would say right now.
 *
 * This route forecasts; it reserves nothing and changes no launch. The gate is
 * still the sole owner of its arithmetic, so this module carries its result and
 * message instead of restating thresholds.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import { decideAdmission as gateDecideAdmission, type AdmissionDecision, type MemorySnapshot } from "../../vitest-admission.js";
import type {
  AdmissionCensusState,
  AdmissionOutcome,
  AdmissionPayload,
  AdmissionPolicy,
  AdmissionRefusalJournal,
  AdmissionRequest,
} from "./wire.js";

export const ADMISSION_PATH = "/api/admission";

export type AdmissionRouteDeps = {
  nowMs(): number;
  readMemorySnapshot(): MemorySnapshot;
  readReserveBytes(): number | undefined;
  resolveParallelWorkers(): number;
  policyVersion: number;
  readRefusals(): AdmissionRefusalJournal;
  readCensus(): AdmissionCensusState;
  decideAdmission?: ((args: {
    nominalWorkers: number;
    snapshot: MemorySnapshot;
    reserveBytes: number | undefined;
  }) => AdmissionDecision) | undefined;
};

type AdmissionExplanation =
  | {
      label: "forecast";
      policy: AdmissionPolicy;
      outcome: Exclude<AdmissionOutcome, { kind: "not-modelled" }>;
    }
  | {
      label: "not-modelled";
      outcome: Extract<AdmissionOutcome, { kind: "not-modelled" }>;
    };

const CAVEAT = "A reduced worker count is the config default; --maxWorkers on the command line overrides it.";
const CENSUS_CADENCE_MS = 30_000;

const EXPLANATIONS: Readonly<Record<number, string>> = {
  1:
    "The gate uses the machine's current available memory and its calibrated test-run cost model " +
    "to forecast whether a run fits and, if so, how many workers the config should ask for.",
};

function message(cause: unknown): string {
  if (cause instanceof Error) {
    if (cause.message.trim() !== "") return cause.message;
    return cause.name.trim() === "" ? "unknown failure" : cause.name;
  }
  try {
    const rendered = String(cause);
    if (rendered.trim() === "") return "unknown failure";
    return `unexpected failure (thrown value: ${rendered})`;
  } catch {
    return "unknown failure";
  }
}

function policyFor(version: number): AdmissionPolicy {
  const explanation = EXPLANATIONS[version];
  if (explanation !== undefined) return { gateVersion: version, explanation, whyWithheld: null };
  return {
    gateVersion: version,
    explanation: null,
    whyWithheld: `this dashboard has no explanation for admission policy v${version}; policy wording is withheld`,
  };
}

function unknownExplanation(policyVersion: number, why: string): AdmissionExplanation {
  return {
    label: "forecast",
    policy: policyFor(policyVersion),
    outcome: { kind: "unknown", why },
  };
}

function notModelledExplanation(request: AdmissionRequest): AdmissionExplanation {
  return {
    label: "not-modelled",
    outcome: {
      kind: "not-modelled",
      why: `no measured cost model or launch gate exists for ${request.kind} work`,
    },
  };
}

/** Stamp only after the answer has reached an outcome. */
function payload(
  deps: AdmissionRouteDeps,
  request: AdmissionRequest,
  explanation: AdmissionExplanation,
): AdmissionPayload {
  let journal: AdmissionRefusalJournal;
  try {
    journal = deps.readRefusals();
  } catch (cause) {
    journal = { kind: "unreadable", why: `reading the refusal journal threw: ${message(cause)}` };
  }
  let census: AdmissionCensusState;
  try {
    census = deps.readCensus();
  } catch (cause) {
    census = {
      kind: "failed",
      label: "observed",
      why: `reading the admission census threw: ${message(cause)}`,
      failedAtMs: deps.nowMs(),
      cadenceMs: CENSUS_CADENCE_MS,
      lastGood: null,
    };
  }
  const base = { schema: 1 as const, request, computedAtMs: deps.nowMs(), journal, census };
  if (explanation.label === "forecast") {
    return {
      ...base,
      label: explanation.label,
      policy: explanation.policy,
      outcome: explanation.outcome,
    };
  }
  return { ...base, label: explanation.label, outcome: explanation.outcome };
}

/**
 * Read the sole active query field. The remaining request fields deliberately
 * describe defaults, not a second half-hidden query API.
 *
 * **`requestedAtClientMs` is null here, and filling it would be a lie.** The
 * wire documents it as the CALLER's clock; no caller over HTTP supplies one,
 * and this function has only the server's. An earlier version stamped it from
 * `deps.nowMs()`, which is the server's instant wearing the caller's name — the
 * quiet kind of wrong, because a later queue reading the field would sort on
 * server time believing it held client time, or believe it held client data it
 * never received. The server's own instant has a home and it is
 * `AdmissionPayload.computedAtMs`. `tests/fleet-admission-route.test.ts` §
 * "the caller's clock" pins both halves.
 *
 * Both caller-owned fields stay on the type for the next admission owner, which
 * will have a real requester to hear a cost and a time from. This route fills
 * neither. That future owner will stamp its own arrival time as `receivedAtMs`
 * rather than trusting the caller's clock.
 */
export function parseAdmissionRequest(url: string): AdmissionRequest {
  let kind: AdmissionRequest["kind"] = "test";
  try {
    const asked = new URL(url, "http://fleet.invalid").searchParams.get("kind");
    if (asked === "review" || asked === "browser" || asked === "test") kind = asked;
  } catch {
    // A malformed dashboard URL asks the useful default question rather than blanking the card.
  }
  return { kind, cost: null, owner: null, requestedAtClientMs: null };
}

/** The entire forecast over values a caller can supply without touching the machine. */
export function explainAdmission(deps: {
  snapshot: MemorySnapshot;
  reserveBytes: number | undefined;
  nominalWorkers: number;
  policyVersion: number;
  request: AdmissionRequest;
  decideAdmission?: AdmissionRouteDeps["decideAdmission"];
}): AdmissionExplanation {
  const policy = policyFor(deps.policyVersion);
  if (deps.request.kind !== "test") return notModelledExplanation(deps.request);

  const decision = (deps.decideAdmission ?? gateDecideAdmission)({
    nominalWorkers: deps.nominalWorkers,
    snapshot: deps.snapshot,
    reserveBytes: deps.reserveBytes,
  });
  if (decision.kind === "not-applicable") {
    return { label: "forecast", policy, outcome: decision };
  }
  if (decision.kind === "refuse") {
    return {
      label: "forecast",
      policy,
      outcome: {
        kind: "would-refuse",
        forecastCallMessage: decision.message,
        messageContext: "dashboard-forecast-call",
      },
    };
  }
  return {
    label: "forecast",
    policy,
    outcome: {
      kind: decision.workers < deps.nominalWorkers ? "would-reduce" : "would-admit",
      nominalWorkers: deps.nominalWorkers,
      nominalWorkersSource: "machine-default",
      workers: decision.workers,
      capacity: decision.capacity,
      availableBytes: decision.availableBytes,
      reserveBytes: decision.reserveBytes,
      caveat: CAVEAT,
    },
  };
}

/**
 * Take the fresh machine readings and build the wire answer. Reader failures
 * become the explicit unknown arm here; unexpected failures remain visible to
 * the route's 500 boundary.
 */
export function admissionPayload(deps: AdmissionRouteDeps, request: AdmissionRequest): AdmissionPayload {
  if (request.kind !== "test") {
    return payload(deps, request, notModelledExplanation(request));
  }

  let nominalWorkers: number;
  const override = process.env.VITEST_MAX_WORKERS;
  /* scripts/readiness-loop.ts's nominalWorkers() is the precedent for saving
     and restoring this consumed variable. A forecast differs in one respect:
     it reports the MACHINE default, so hide the dashboard's own override before
     asking, then restore the process environment exactly as it was. */
  delete process.env.VITEST_MAX_WORKERS;
  try {
    nominalWorkers = deps.resolveParallelWorkers();
  } catch (cause) {
    return payload(deps, request, unknownExplanation(deps.policyVersion, message(cause)));
  } finally {
    if (override === undefined) delete process.env.VITEST_MAX_WORKERS;
    else process.env.VITEST_MAX_WORKERS = override;
  }

  let snapshot: MemorySnapshot;
  try {
    snapshot = deps.readMemorySnapshot();
  } catch (cause) {
    return payload(deps, request, unknownExplanation(deps.policyVersion, message(cause)));
  }
  let reserveBytes: number | undefined;
  try {
    reserveBytes = deps.readReserveBytes();
  } catch (cause) {
    return payload(deps, request, unknownExplanation(deps.policyVersion, message(cause)));
  }

  return payload(
    deps,
    request,
    explainAdmission({
      snapshot,
      reserveBytes,
      nominalWorkers,
      policyVersion: deps.policyVersion,
      request,
      decideAdmission: deps.decideAdmission,
    }),
  );
}

/** Mount the forecast without widening its path prefix into extra routes. */
export function admissionRoute(deps: AdmissionRouteDeps): {
  handle(req: IncomingMessage, res: ServerResponse): boolean;
} {
  return {
    handle(req, res): boolean {
      const url = req.url ?? "/";
      if (!url.startsWith(ADMISSION_PATH)) return false;
      const path = url.split("?")[0] ?? "";
      if (path !== ADMISSION_PATH) {
        res.writeHead(404, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(
          req.method === "HEAD"
            ? undefined
            : JSON.stringify({ error: "route-not-found", why: `no such route: ${path}` }),
        );
        return true;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, {
          "content-type": "application/json",
          "cache-control": "no-store",
          allow: "GET, HEAD",
        });
        res.end(
          JSON.stringify({
            error: "method-not-allowed",
            why: "this admission route is read-only; use GET or HEAD",
          }),
        );
        return true;
      }

      let body: string;
      try {
        const request = parseAdmissionRequest(url);
        body = JSON.stringify(admissionPayload(deps, request));
      } catch (cause) {
        res.writeHead(500, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(
          req.method === "HEAD"
            ? undefined
            : JSON.stringify({
                error: "internal-error",
                why: `building the admission answer threw: ${message(cause)}`,
              }),
        );
        return true;
      }
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : body);
      return true;
    },
  };
}
