/**
 * `GET /api/admission` — what the existing Vitest gate would say right now.
 *
 * This route forecasts; it reserves nothing and changes no launch. The gate is
 * still the sole owner of its arithmetic, so this module carries its result and
 * message instead of restating thresholds.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import { decideAdmission as gateDecideAdmission, type AdmissionDecision, type MemorySnapshot } from "../../vitest-admission.js";
import type { AdmissionPayload, AdmissionPolicy, AdmissionRequest } from "./wire.js";

export const ADMISSION_PATH = "/api/admission";

export type AdmissionRouteDeps = {
  nowMs(): number;
  readMemorySnapshot(): MemorySnapshot;
  readReserveBytes(): number | undefined;
  resolveParallelWorkers(): number;
  policyVersion: number;
  decideAdmission?: ((args: {
    nominalWorkers: number;
    snapshot: MemorySnapshot;
    reserveBytes: number | undefined;
  }) => AdmissionDecision) | undefined;
};

type AdmissionExplanation = Omit<AdmissionPayload, "schema" | "request" | "computedAtMs">;

const CAVEAT = "A reduced worker count is the config default; --maxWorkers on the command line overrides it.";

const EXPLANATIONS: Readonly<Record<number, string>> = {
  1:
    "The gate holds back the machine reserve and its measured fixed run cost, then turns the " +
    "remaining memory into worker capacity using its measured per-worker cost. It refuses when no worker fits.",
};

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function policyFor(version: number): AdmissionPolicy {
  const explanation = EXPLANATIONS[version];
  if (explanation !== undefined) return { gateVersion: version, explanation, whyWithheld: null };
  return {
    gateVersion: version,
    explanation: null,
    whyWithheld:
      `this dashboard has no explanation for admission policy v${version}; ` +
      "the numbers below are live, the wording is withheld",
  };
}

function unknownExplanation(policyVersion: number, why: string): AdmissionExplanation {
  return {
    label: "forecast",
    policy: policyFor(policyVersion),
    outcome: { kind: "unknown", why },
    caveat: CAVEAT,
  };
}

function notModelledExplanation(request: AdmissionRequest, policyVersion: number): AdmissionExplanation {
  return {
    label: "not-modelled",
    policy: policyFor(policyVersion),
    outcome: {
      kind: "not-modelled",
      why: `no measured cost model or launch gate exists for ${request.kind} work`,
    },
    caveat: CAVEAT,
  };
}

/** Stamp only after the observation has reached an outcome. */
function payload(
  deps: AdmissionRouteDeps,
  request: AdmissionRequest,
  explanation: AdmissionExplanation,
): AdmissionPayload {
  return { schema: 1, request, computedAtMs: deps.nowMs(), ...explanation };
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
 * The field stays on the type for the same reason `cost` does: the next stage's
 * admission owner will have a real requester to hear one from, and it will
 * stamp its own arrival time as `receivedAtMs` rather than trusting this.
 */
export function parseAdmissionRequest(url: string): AdmissionRequest {
  let kind: AdmissionRequest["kind"] = "test";
  try {
    const asked = new URL(url, "http://fleet.invalid").searchParams.get("kind");
    if (asked === "review" || asked === "browser" || asked === "test") kind = asked;
  } catch {
    // A malformed dashboard URL asks the useful default question rather than blanking the card.
  }
  return { kind, cost: "heavy", owner: null, requestedAtClientMs: null };
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
  if (deps.request.kind !== "test") return notModelledExplanation(deps.request, deps.policyVersion);

  const decision = (deps.decideAdmission ?? gateDecideAdmission)({
    nominalWorkers: deps.nominalWorkers,
    snapshot: deps.snapshot,
    reserveBytes: deps.reserveBytes,
  });
  if (decision.kind === "not-applicable") {
    return { label: "forecast", policy, outcome: decision, caveat: CAVEAT };
  }
  if (decision.kind === "refuse") {
    return {
      label: "forecast",
      policy,
      outcome: { kind: "would-refuse", why: decision.message },
      caveat: CAVEAT,
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
    },
    caveat: CAVEAT,
  };
}

/**
 * Take the fresh machine readings and build the wire answer. Reader failures
 * become the explicit unknown arm here; unexpected failures remain visible to
 * the route's 500 boundary.
 */
export function admissionPayload(deps: AdmissionRouteDeps, request: AdmissionRequest): AdmissionPayload {
  if (request.kind !== "test") {
    return payload(deps, request, notModelledExplanation(request, deps.policyVersion));
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

  const snapshot = deps.readMemorySnapshot();
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
        res.end(JSON.stringify({ schema: 1, kind: "unknown", why: `no such route: ${path}` }));
        return true;
      }

      let body: string;
      try {
        const request = parseAdmissionRequest(url);
        body = JSON.stringify(admissionPayload(deps, request));
      } catch (cause) {
        res.writeHead(500, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(
          JSON.stringify({
            schema: 1,
            kind: "unknown",
            why: `building the admission answer threw: ${message(cause)}`,
          }),
        );
        return true;
      }
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(body);
      return true;
    },
  };
}
