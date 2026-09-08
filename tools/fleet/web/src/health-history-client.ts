/**
 * The last day of box health — `GET /api/health/history`.
 *
 * ## FOUR ARMS, BECAUSE THE SERVER HAS TWO AND THE WIRE CAN FAIL TOO
 *
 * The same discipline `messages-client.ts` states at length, and for a sharper
 * reason here: every arm below is a different kind of *nothing*, and this whole
 * panel exists to keep kinds of nothing apart.
 *
 *  - **`history`** — we looked. `samples` may be empty, and that is a claim
 *    about the window, not a failure.
 *  - **`unreadable`** — the SERVER could not look. Its `why`, in its voice: the
 *    store would not open, or the file would not read.
 *  - **`no-answer`** — THIS BROWSER never got an answer it could read. Our
 *    sentence, and it says so, because the phone's own network trouble must not
 *    appear on screen wearing the server's voice.
 *
 * (The fourth is the panel's: `loading`, which is not a claim about anything.)
 *
 * Collapsing any two of these produces a blank 24-hour chart, and **a blank
 * chart reads as "the box was down"** — the one thing this feature must never
 * say by accident.
 *
 * ## The sample is held loosely on purpose
 *
 * `report` is `Record<string, unknown>`, not a typed `HealthReport`. The
 * collector's shape belongs to `tools/fleet/health.ts` — a node module this
 * browser project cannot import without dragging node types in, the same trade
 * `types.ts` and `health-view.ts` already make — and these records crossed a
 * VERSION boundary as well as a wire: some of them were written by a build from
 * last week. So `history-series.ts` reads the fields it needs, by name, and
 * turns anything it does not recognise into a stated unknown rather than a
 * number.
 */

export const HISTORY_URL = "api/health/history";

/** One sample, with its timestamp already parsed so no renderer has to. */
export type HealthSampleView =
  | {
      kind: "reading";
      atMs: number;
      /** What the writer expected the interval to the NEXT sample to be. See history-series.ts. */
      nextDueMs: number;
      report: Record<string, unknown>;
    }
  | { kind: "collector-failed"; atMs: number; nextDueMs: number; why: string };

/** What the server says about its own ability to write the history down. */
export type RetentionView = {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  failure: string | null;
  poisoned: boolean;
  lockedOutBy: string | null;
};

export type HistoryView =
  | {
      kind: "history";
      windowHours: number;
      fromMs: number;
      toMs: number;
      /** Oldest first. */
      samples: HealthSampleView[];
      /**
       * The last sample BEFORE the window, when there is one.
       *
       * The left edge cannot be classified without it: a window that opens in
       * the middle of a break has no sample near its start, and nothing in
       * `samples` says whether that is a break already running or where the
       * record begins.
       */
      predecessor: HealthSampleView | null;
      /**
       * Where the store found lines it could not parse, **placed rather than
       * merely counted** — bracketed by the timestamps on either side, so a
       * renderer breaks its line there instead of reconnecting across it.
       */
      holes: { afterAtMs: number | null; beforeAtMs: number | null }[];
      /**
       * The oldest sample the store holds at all — **the field that tells
       * "nothing was recorded before this" apart from "the record has a hole
       * in it"**. Null when the store is empty, which is the same message about
       * the whole window.
       */
      earliestAtMs: number | null;
      /** True when a rotation means `earliestAtMs` is the oldest RETAINED sample, not the first ever. */
      rotated: boolean;
      /** Lines in the store that would not parse. Shown, not swallowed. */
      unreadableLines: number;
      /** How often the dashboard intends to collect. */
      refreshMs: number;
      /** Samples that arrived but could not be read HERE. Counted, never dropped. */
      unreadableSamples: number;
      /**
       * **How the WRITER is doing**, which is not the same question as what it
       * wrote. A writer that has silently stopped grows a break at the chart's
       * right-hand edge that looks exactly like the box going down — an outage
       * manufactured by the monitoring. Null when the server did not say.
       */
      retention: RetentionView | null;
    }
  | { kind: "unreadable"; why: string }
  /** This page never got an answer it could read. **Our sentence, not the server's.** */
  | { kind: "no-answer"; why: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function msFrom(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

/** One sample off the wire, or null when it is not one. */
export function parseSample(raw: unknown): HealthSampleView | null {
  if (!isRecord(raw)) return null;
  const atMs = msFrom(raw["at"]);
  if (atMs === null) return null;
  const nextDueMs = num(raw["nextDueMs"]);
  if (nextDueMs === null || nextDueMs <= 0) return null;

  if (raw["kind"] === "collector-failed") {
    const why = raw["why"];
    return {
      kind: "collector-failed",
      atMs,
      nextDueMs,
      why: typeof why === "string" && why !== "" ? why : "the collector failed and gave no reason",
    };
  }
  if (raw["kind"] === "reading" && isRecord(raw["report"])) {
    return { kind: "reading", atMs, nextDueMs, report: raw["report"] };
  }
  return null;
}

/**
 * The writer's own condition, or null when the server did not report it.
 *
 * **Null is "did not say", never "fine".** A server built before this field
 * existed makes no claim about whether it is still writing, and inventing a
 * healthy one here would put a reassurance on the page that nothing produced.
 */
function parseRetention(raw: unknown): RetentionView | null {
  if (!isRecord(raw)) return null;
  const failure = raw["failure"];
  const lockedOutBy = raw["lockedOutBy"];
  return {
    lastAttemptAt: typeof raw["lastAttemptAt"] === "string" ? raw["lastAttemptAt"] : null,
    lastSuccessAt: typeof raw["lastSuccessAt"] === "string" ? raw["lastSuccessAt"] : null,
    failure: typeof failure === "string" && failure !== "" ? failure : null,
    poisoned: raw["poisoned"] === true,
    lockedOutBy: typeof lockedOutBy === "string" && lockedOutBy !== "" ? lockedOutBy : null,
  };
}

/**
 * The reply, whatever it is. **Never throws and never returns null** — an answer
 * it cannot classify is `no-answer` with a sentence saying so, because a caller
 * left holding a null would have to write that sentence itself and there would
 * then be two of them.
 */
export function parseHistory(raw: unknown): HistoryView {
  if (!isRecord(raw)) {
    return { kind: "no-answer", why: "the dashboard server answered something that is not this API" };
  }
  if (raw["kind"] === "unreadable") {
    const why = raw["why"];
    return {
      kind: "unreadable",
      why: typeof why === "string" && why !== "" ? why : "the server said it could not read the history and did not say why",
    };
  }
  if (raw["kind"] !== "history") {
    return { kind: "no-answer", why: "the dashboard server answered something that is not this API" };
  }

  const fromMs = num(raw["fromMs"]);
  const toMs = num(raw["toMs"]);
  if (fromMs === null || toMs === null || toMs <= fromMs) {
    /* WITHOUT AN AXIS THERE IS NOTHING HONEST TO DRAW. A chart plotted over a
       window this page invented would put every point in the wrong place and
       look entirely normal doing it. */
    return { kind: "no-answer", why: "the history came back without a usable window to plot it against" };
  }

  const rawSamples = raw["samples"];
  const samples: HealthSampleView[] = [];
  let unreadableSamples = 0;
  if (Array.isArray(rawSamples)) {
    for (const item of rawSamples) {
      const sample = parseSample(item);
      if (sample === null) unreadableSamples += 1;
      else samples.push(sample);
    }
  }

  const holes: { afterAtMs: number | null; beforeAtMs: number | null }[] = [];
  if (Array.isArray(raw["holes"])) {
    for (const item of raw["holes"]) {
      if (!isRecord(item)) continue;
      holes.push({ afterAtMs: msFrom(item["afterAt"]), beforeAtMs: msFrom(item["beforeAt"]) });
    }
  }

  return {
    kind: "history",
    windowHours: num(raw["windowHours"]) ?? (toMs - fromMs) / 3_600_000,
    fromMs,
    toMs,
    samples,
    predecessor: parseSample(raw["predecessor"]),
    holes,
    earliestAtMs: msFrom(raw["earliestAt"]),
    rotated: raw["rotated"] === true,
    retention: parseRetention(raw["retention"]),
    unreadableLines: num(raw["unreadableLines"]) ?? 0,
    /* A server that did not say falls back to the poll's own default rather
       than to zero — a zero would make every interval look overdue. */
    refreshMs: num(raw["refreshMs"]) ?? 60_000,
    unreadableSamples,
  };
}

/** A thrown thing, as a sentence. Never "[object Object]". */
function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message === "" ? cause.name : cause.message;
  if (typeof cause === "string" && cause !== "") return cause;
  return "the request failed, and gave no reason";
}

/** The injection point, the same shape as `MessagesApi` and `ActionsApi`. */
export type HistoryApi = { window: (hours: number) => Promise<HistoryView> };

export function makeHistoryApi(fetchImpl: typeof fetch = fetch): HistoryApi {
  return {
    async window(hours): Promise<HistoryView> {
      let response: Response;
      try {
        response = await fetchImpl(`${HISTORY_URL}?hours=${encodeURIComponent(String(hours))}`, { cache: "no-store" });
      } catch (cause) {
        return { kind: "no-answer", why: `this browser could not reach the dashboard: ${describe(cause)}` };
      }
      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch (cause) {
        return {
          kind: "no-answer",
          why: `the dashboard server answered ${response.status} and the body was not JSON: ${describe(cause)}`,
        };
      }
      return parseHistory(parsed);
    },
  };
}

/** The default instance. Late-bound `fetch`, for the reason in steer-client.ts. */
export const httpHistoryApi: HistoryApi = {
  window: (hours) => makeHistoryApi().window(hours),
};
