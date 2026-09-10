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

export type AdmissionRefusalEntryView = {
  at: string;
  source: "test-run" | "readiness-precheck";
  policyVersion: number;
  availableBytes: number | null;
  reserveBytes: number | null;
  swapTotalBytes: number | null;
  swapFreeBytes: number | null;
  pid: number;
  host: string;
};

export type AdmissionJournalView =
  | { kind: "read"; entries: AdmissionRefusalEntryView[]; unparseableLines: number }
  | { kind: "directory-absent" }
  | { kind: "unreadable"; why: string };

export type AdmissionCensusClassView = "test" | "codex-batch" | "browser";

export type AdmissionCensusCountsView = {
  byClass: Record<AdmissionCensusClassView, { roots: number; uncertain: number }>;
  changedUnderRead: number;
  unreadable: number;
  processesSeen: number;
};

export type AdmissionCensusView =
  | { kind: "not-yet-computed"; label: "observed"; startedAtMs: number }
  | {
      kind: "value";
      label: "observed";
      census: AdmissionCensusCountsView;
      startedAtMs: number;
      completedAtMs: number;
      durationMs: number;
      cadenceMs: number;
    }
  | {
      kind: "failed";
      label: "observed";
      why: string;
      failedAtMs: number;
      cadenceMs: number;
      lastGood: { census: AdmissionCensusCountsView; startedAtMs: number; completedAtMs: number } | null;
    }
  | { kind: "unreadable"; why: string };

export type AdmissionView =
  | {
      kind: "answer";
      label: "forecast";
      /** Null keeps a valid forecast while making its missing time explicit. */
      computedAtMs: number | null;
      requestKind: "test";
      policy: AdmissionPolicyView;
      outcome: AdmissionForecastOutcomeView;
      journal: AdmissionJournalView;
      census: AdmissionCensusView;
    }
  | {
      kind: "answer";
      label: "not-modelled";
      /** Null keeps a valid answer while making its missing time explicit. */
      computedAtMs: number | null;
      requestKind: "review" | "browser";
      outcome: { kind: "not-modelled"; why: string };
      journal: AdmissionJournalView;
      census: AdmissionCensusView;
    }
  | {
      kind: "no-answer";
      source: "browser" | "server";
      why: string;
      /** A valid census survives an independently unreadable forecast. */
      census: AdmissionCensusView | null;
    };

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

function noAnswer(
  why: string,
  source: "browser" | "server" = "browser",
  census: AdmissionCensusView | null = null,
): AdmissionView {
  return { kind: "no-answer", source, why, census };
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

function nullableBytes(value: unknown): number | null | undefined {
  if (value === null) return null;
  const bytes = nonNegativeInteger(value);
  return bytes === null ? undefined : bytes;
}

function parseJournalEntry(raw: unknown): AdmissionRefusalEntryView | null {
  if (!isRecord(raw)) return null;
  const at = nonEmptyString(raw["at"]);
  const source = raw["source"];
  const policyVersion = nonNegativeInteger(raw["policyVersion"]);
  const availableBytes = nullableBytes(raw["availableBytes"]);
  const reserveBytes = nullableBytes(raw["reserveBytes"]);
  const swapTotalBytes = nullableBytes(raw["swapTotalBytes"]);
  const swapFreeBytes = nullableBytes(raw["swapFreeBytes"]);
  const pid = positiveInteger(raw["pid"]);
  const host = nonEmptyString(raw["host"]);
  if (
    at === null ||
    !Number.isFinite(Date.parse(at)) ||
    (source !== "test-run" && source !== "readiness-precheck") ||
    policyVersion === null ||
    availableBytes === undefined ||
    reserveBytes === undefined ||
    swapTotalBytes === undefined ||
    swapFreeBytes === undefined ||
    pid === null ||
    host === null
  ) {
    return null;
  }
  return {
    at,
    source,
    policyVersion,
    availableBytes,
    reserveBytes,
    swapTotalBytes,
    swapFreeBytes,
    pid,
    host,
  };
}

function parseJournal(raw: unknown): AdmissionJournalView {
  if (!isRecord(raw)) return { kind: "unreadable", why: "the response did not contain a readable journal state" };
  if (raw["kind"] === "directory-absent") return { kind: "directory-absent" };
  if (raw["kind"] === "unreadable") {
    const why = nonEmptyString(raw["why"]);
    return why === null
      ? { kind: "unreadable", why: "the response's unreadable journal state had no reason" }
      : { kind: "unreadable", why };
  }
  if (raw["kind"] !== "read" || !Array.isArray(raw["entries"])) {
    return { kind: "unreadable", why: "the response carried a journal state this page does not understand" };
  }
  const unparseableLines = nonNegativeInteger(raw["unparseableLines"]);
  const entries = raw["entries"].map(parseJournalEntry);
  if (unparseableLines === null || entries.some((entry) => entry === null)) {
    return { kind: "unreadable", why: "the response's readable journal state contained an unreadable field" };
  }
  return { kind: "read", entries: entries as AdmissionRefusalEntryView[], unparseableLines };
}

function unreadableCensus(why: string): AdmissionCensusView {
  return { kind: "unreadable", why };
}

function parseCensusCounts(raw: unknown): AdmissionCensusCountsView | null {
  if (!isRecord(raw) || !isRecord(raw["byClass"])) return null;
  const byClass = raw["byClass"];
  const parseClass = (name: AdmissionCensusClassView): { roots: number; uncertain: number } | null => {
    const value = byClass[name];
    if (!isRecord(value)) return null;
    const roots = nonNegativeInteger(value["roots"]);
    const uncertain = nonNegativeInteger(value["uncertain"]);
    return roots === null || uncertain === null ? null : { roots, uncertain };
  };
  const test = parseClass("test");
  const codexBatch = parseClass("codex-batch");
  const browser = parseClass("browser");
  const changedUnderRead = nonNegativeInteger(raw["changedUnderRead"]);
  const unreadable = nonNegativeInteger(raw["unreadable"]);
  const processesSeen = nonNegativeInteger(raw["processesSeen"]);
  if (
    test === null ||
    codexBatch === null ||
    browser === null ||
    changedUnderRead === null ||
    unreadable === null ||
    processesSeen === null
  ) {
    return null;
  }
  const accountedFor =
    test.roots +
    test.uncertain +
    codexBatch.roots +
    codexBatch.uncertain +
    browser.roots +
    browser.uncertain +
    changedUnderRead +
    unreadable;
  if (!Number.isSafeInteger(accountedFor) || accountedFor > processesSeen) return null;
  return {
    byClass: { test, "codex-batch": codexBatch, browser },
    changedUnderRead,
    unreadable,
    processesSeen,
  };
}

function parseCensus(raw: unknown): AdmissionCensusView {
  if (!isRecord(raw)) {
    return unreadableCensus("the response did not contain a readable process census state");
  }
  if (raw["label"] !== "observed") {
    return unreadableCensus("the response's process census had an unknown signal label");
  }
  if (raw["kind"] === "not-yet-computed") {
    const startedAtMs = dateInstant(raw["startedAtMs"]);
    return startedAtMs === null
      ? unreadableCensus("the response's unfinished process census had an unreadable start time")
      : { kind: "not-yet-computed", label: "observed", startedAtMs };
  }
  if (raw["kind"] === "value") {
    const census = parseCensusCounts(raw["census"]);
    const startedAtMs = dateInstant(raw["startedAtMs"]);
    const completedAtMs = dateInstant(raw["completedAtMs"]);
    const durationMs = nonNegativeInteger(raw["durationMs"]);
    const cadenceMs = positiveInteger(raw["cadenceMs"]);
    if (
      census === null ||
      startedAtMs === null ||
      completedAtMs === null ||
      durationMs === null ||
      cadenceMs === null ||
      completedAtMs < startedAtMs
    ) {
      return unreadableCensus("the response's process census value contained an unreadable field");
    }
    return { kind: "value", label: "observed", census, startedAtMs, completedAtMs, durationMs, cadenceMs };
  }
  if (raw["kind"] === "failed") {
    const why = nonEmptyString(raw["why"]);
    const failedAtMs = dateInstant(raw["failedAtMs"]);
    const cadenceMs = positiveInteger(raw["cadenceMs"]);
    const rawLastGood = raw["lastGood"];
    let lastGood: {
      census: AdmissionCensusCountsView;
      startedAtMs: number;
      completedAtMs: number;
    } | null;
    if (rawLastGood === null) {
      lastGood = null;
    } else if (isRecord(rawLastGood)) {
      const census = parseCensusCounts(rawLastGood["census"]);
      const startedAtMs = dateInstant(rawLastGood["startedAtMs"]);
      const completedAtMs = dateInstant(rawLastGood["completedAtMs"]);
      if (
        census === null ||
        startedAtMs === null ||
        completedAtMs === null ||
        completedAtMs < startedAtMs
      ) {
        return unreadableCensus("the response's failed process census had an unreadable last value");
      }
      lastGood = { census, startedAtMs, completedAtMs };
    } else {
      return unreadableCensus("the response's failed process census had an unreadable last value");
    }
    if (why === null || failedAtMs === null || cadenceMs === null) {
      return unreadableCensus("the response's failed process census contained an unreadable field");
    }
    return { kind: "failed", label: "observed", why, failedAtMs, cadenceMs, lastGood };
  }
  return unreadableCensus("the response carried a process census state this page does not understand");
}

/** Parse an unknown response body without throwing or manufacturing values. */
export function parseAdmission(raw: unknown): AdmissionView {
  if (!isRecord(raw) || raw["schema"] !== 1) {
    return noAnswer("the admission response was not version 1 of this API");
  }
  const computedAtMs = dateInstant(raw["computedAtMs"]);
  const journal = parseJournal(raw["journal"]);
  const census = parseCensus(raw["census"]);
  const requestKind = parseRequestKind(raw["request"]);
  if (requestKind === null || !isRecord(raw["outcome"])) {
    return noAnswer("the admission response was missing a readable request or outcome", "browser", census);
  }

  if (raw["label"] === "not-modelled") {
    const why = nonEmptyString(raw["outcome"]["why"]);
    if (
      (requestKind !== "review" && requestKind !== "browser") ||
      raw["outcome"]["kind"] !== "not-modelled" ||
      why === null ||
      "policy" in raw
    ) {
      return noAnswer(
        "the admission response's not-modelled answer was not a shape this page understands",
        "browser",
        census,
      );
    }
    return {
      kind: "answer",
      label: "not-modelled",
      computedAtMs,
      requestKind,
      outcome: { kind: "not-modelled", why },
      journal,
      census,
    };
  }

  if (raw["label"] !== "forecast" || requestKind !== "test") {
    return noAnswer(
      "the admission response carried an outcome or label this page does not understand",
      "browser",
      census,
    );
  }
  const policy = parsePolicy(raw["policy"]);
  const outcome = parseForecastOutcome(raw["outcome"]);
  if (policy === null || outcome === null) {
    return noAnswer("the admission forecast contained a field this page could not read", "browser", census);
  }
  return { kind: "answer", label: "forecast", computedAtMs, requestKind, policy, outcome, journal, census };
}

function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message.trim() === "" ? cause.name : cause.message;
  if (typeof cause === "string" && cause.trim() !== "") return cause;
  return "the request failed without a readable reason";
}

/** The injectable operation the section uses. Tests replace this, never `fetch`. */
export type AdmissionApi = { forecast: (options?: { signal?: AbortSignal }) => Promise<AdmissionView> };

export function makeAdmissionApi(fetchImpl: typeof fetch = fetch): AdmissionApi {
  return {
    async forecast(options = {}): Promise<AdmissionView> {
      let response: Response;
      try {
        const request: RequestInit = options.signal === undefined
          ? { cache: "no-store" }
          : { cache: "no-store", signal: options.signal };
        response = await fetchImpl(ADMISSION_URL, request);
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
  forecast: (options) => makeAdmissionApi().forecast(options),
};
