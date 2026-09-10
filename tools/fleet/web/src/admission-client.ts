/**
 * The admission forecast — `GET /api/admission`.
 *
 * ## THE EXTRA ARMS SAY WHO FAILED
 *
 * The server has answers about the box: the gate would admit, reduce or
 * refuse; the machine has no policy; the server could not ask the gate; or the
 * requested kind has no model. This client adds `no-answer` for a different
 * fact: there is no admission answer the page can use. A source discriminant
 * keeps a phone's network failure in the browser's voice and a readable HTTP
 * failure in the server's; neither may borrow the other's failure.
 *
 * ## UNKNOWN INPUT IS AN ABSENCE, NEVER A NUMBER
 *
 * Every field used by the section is read by name. An unknown schema, outcome,
 * label or outcome number refuses the whole answer into `no-answer`; no
 * missing numeric field is defaulted to zero. The forecast instant is the one
 * exception: it is a caption on an otherwise complete answer, so an unreadable
 * one becomes `null` and the outcome stays. Timestamps are range-checked for
 * `Date` as well as checked for finiteness: `1e300` is finite but
 * `new Date(1e300).toISOString()` throws and would blank the whole panel.
 *
 * ## THE SEAM IS LATE-BOUND
 *
 * `httpAdmissionApi` calls `makeAdmissionApi()` at request time. Binding
 * `fetch` when this module is imported would make the seam unstubbable in a
 * suite that imported the dashboard first, and the resulting failure would
 * look like a real network request in a test with none.
 */

export const ADMISSION_URL = "api/admission";

export type AdmissionRequestKind = "test" | "review" | "browser";

export type AdmissionPolicyView =
  | { gateVersion: number; explanation: string; whyWithheld: null }
  | { gateVersion: number; explanation: null; whyWithheld: string };

type WorkerForecastView = {
  nominalWorkers: number;
  workers: number;
  capacity: number;
  availableBytes: number;
  reserveBytes: number;
  caveat: string;
};

export type AdmissionForecastOutcomeView =
  | ({ kind: "would-admit" } & WorkerForecastView)
  | ({ kind: "would-reduce" } & WorkerForecastView)
  | { kind: "would-refuse"; forecastCallMessage: string }
  | { kind: "not-applicable"; why: string }
  | { kind: "unknown"; why: string };

export type AdmissionView =
  | {
      kind: "answer";
      label: "forecast";
      /** Null keeps a valid forecast while making its missing time explicit. */
      computedAtMs: number | null;
      requestKind: "test";
      policy: AdmissionPolicyView;
      outcome: AdmissionForecastOutcomeView;
    }
  | {
      kind: "answer";
      label: "not-modelled";
      /** Null keeps a valid answer while making its missing time explicit. */
      computedAtMs: number | null;
      requestKind: "review" | "browser";
      outcome: { kind: "not-modelled"; why: string };
    }
  | { kind: "no-answer"; source: "browser" | "server"; why: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * The largest magnitude `new Date(ms)` will accept before it throws
 * `RangeError`, which during render blanks the whole panel rather than one
 * line. **Exported because `AdmissionSection.tsx` needs the same rule** — it had
 * its own copy of this number, and two copies of one threshold is the shape
 * that drifts silently: a test restating the number agrees with the drift
 * instead of catching it. One home, imported by both.
 */
export const DATE_LIMIT_MS = 8.64e15;

function dateInstant(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= DATE_LIMIT_MS
    ? value
    : null;
}

function noAnswer(why: string, source: "browser" | "server" = "browser"): AdmissionView {
  return { kind: "no-answer", source, why };
}

function parseRequestKind(raw: unknown): AdmissionRequestKind | null {
  if (!isRecord(raw)) return null;
  const kind = raw["kind"];
  return kind === "test" || kind === "review" || kind === "browser" ? kind : null;
}

function parsePolicy(raw: unknown): AdmissionPolicyView | null {
  if (!isRecord(raw)) return null;
  const gateVersion = nonNegativeInteger(raw["gateVersion"]);
  if (gateVersion === null) return null;

  const explanation = raw["explanation"];
  const whyWithheld = raw["whyWithheld"];
  if (nonEmptyString(explanation) !== null && whyWithheld === null) {
    return { gateVersion, explanation: explanation as string, whyWithheld: null };
  }
  if (explanation === null && nonEmptyString(whyWithheld) !== null) {
    return { gateVersion, explanation: null, whyWithheld: whyWithheld as string };
  }
  return null;
}

function parseWorkerOutcome(raw: Record<string, unknown>): AdmissionForecastOutcomeView | null {
  const kind = raw["kind"];
  if (kind !== "would-admit" && kind !== "would-reduce") return null;
  const nominalWorkers = positiveInteger(raw["nominalWorkers"]);
  const workers = positiveInteger(raw["workers"]);
  const capacity = positiveInteger(raw["capacity"]);
  const availableBytes = nonNegativeInteger(raw["availableBytes"]);
  const reserveBytes = nonNegativeInteger(raw["reserveBytes"]);
  const caveat = nonEmptyString(raw["caveat"]);
  if (
    raw["nominalWorkersSource"] !== "machine-default" ||
    nominalWorkers === null ||
    workers === null ||
    capacity === null ||
    availableBytes === null ||
    reserveBytes === null ||
    caveat === null
  ) {
    return null;
  }
  if (workers > capacity) return null;
  if (kind === "would-admit" && workers !== nominalWorkers) return null;
  if (kind === "would-reduce" && workers >= nominalWorkers) return null;

  const numbers: WorkerForecastView = {
    nominalWorkers,
    workers,
    capacity,
    availableBytes,
    reserveBytes,
    caveat,
  };
  return kind === "would-admit" ? { kind, ...numbers } : { kind, ...numbers };
}

function parseForecastOutcome(raw: unknown): AdmissionForecastOutcomeView | null {
  if (!isRecord(raw)) return null;
  if (raw["kind"] === "would-admit" || raw["kind"] === "would-reduce") {
    return parseWorkerOutcome(raw);
  }
  if (raw["kind"] === "would-refuse") {
    const message = nonEmptyString(raw["forecastCallMessage"]);
    if (message === null || raw["messageContext"] !== "dashboard-forecast-call") return null;
    return { kind: "would-refuse", forecastCallMessage: message };
  }
  if (raw["kind"] === "not-applicable" || raw["kind"] === "unknown") {
    const why = nonEmptyString(raw["why"]);
    return why === null ? null : { kind: raw["kind"], why };
  }
  return null;
}

/** Parse an unknown response body without throwing or manufacturing values. */
export function parseAdmission(raw: unknown): AdmissionView {
  if (!isRecord(raw) || raw["schema"] !== 1) {
    return noAnswer("the admission response was not version 1 of this API");
  }
  const computedAtMs = dateInstant(raw["computedAtMs"]);
  const requestKind = parseRequestKind(raw["request"]);
  if (requestKind === null || !isRecord(raw["outcome"])) {
    return noAnswer("the admission response was missing a readable request or outcome");
  }

  if (raw["label"] === "not-modelled") {
    const why = nonEmptyString(raw["outcome"]["why"]);
    if (
      (requestKind !== "review" && requestKind !== "browser") ||
      raw["outcome"]["kind"] !== "not-modelled" ||
      why === null ||
      "policy" in raw
    ) {
      return noAnswer("the admission response's not-modelled answer was not a shape this page understands");
    }
    return {
      kind: "answer",
      label: "not-modelled",
      computedAtMs,
      requestKind,
      outcome: { kind: "not-modelled", why },
    };
  }

  if (raw["label"] !== "forecast" || requestKind !== "test") {
    return noAnswer("the admission response carried an outcome or label this page does not understand");
  }
  const policy = parsePolicy(raw["policy"]);
  const outcome = parseForecastOutcome(raw["outcome"]);
  if (policy === null || outcome === null) {
    return noAnswer("the admission forecast contained a field this page could not read");
  }
  return { kind: "answer", label: "forecast", computedAtMs, requestKind, policy, outcome };
}

function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message.trim() === "" ? cause.name : cause.message;
  if (typeof cause === "string" && cause.trim() !== "") return cause;
  return "the request failed without a readable reason";
}

/** The injectable operation the section uses. Tests replace this, never `fetch`. */
export type AdmissionApi = { forecast: () => Promise<AdmissionView> };

export function makeAdmissionApi(fetchImpl: typeof fetch = fetch): AdmissionApi {
  return {
    async forecast(): Promise<AdmissionView> {
      let response: Response;
      try {
        response = await fetchImpl(ADMISSION_URL, { cache: "no-store" });
      } catch (cause) {
        return noAnswer(`the dashboard could not be reached: ${describe(cause)}`);
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch (cause) {
        return noAnswer(`the response was not readable JSON (${response.status}): ${describe(cause)}`, "server");
      }
      if (!response.ok) {
        return noAnswer(`the request answered with HTTP ${response.status}, not an admission forecast`, "server");
      }
      return parseAdmission(body);
    },
  };
}

/** The real operation, with `fetch` deliberately resolved only when called. */
export const httpAdmissionApi: AdmissionApi = {
  forecast: () => makeAdmissionApi().forecast(),
};
