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
  | { kind: "collector-failed"; atMs: number; nextDueMs: number; why: string }
  /**
   * A reading was taken and could not be kept — its serialised form was over the
   * store's per-record limit. Drawn like a collector failure, because from the
   * chart's point of view it is the same fact: **we looked, and there is no
   * number.** It exists as its own arm so the reason on screen is the true one.
   */
  | { kind: "sample-omitted"; atMs: number; nextDueMs: number; why: string };

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

  if (raw["kind"] === "collector-failed" || raw["kind"] === "sample-omitted") {
    const why = raw["why"];
    return {
      kind: raw["kind"],
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
function parseRetention(raw: unknown): RetentionView | null | "malformed" {
  /* `null` is a real answer — this server does not report retention — and is
     the only absence allowed. Anything else that is not an object is a payload
     shape this page does not understand, and constructing an apparently healthy
     status out of it would put a reassurance on the page that nothing produced.
     GPT Sol's second round. */
  if (raw === null) return null;
  if (!isRecord(raw)) return "malformed";
  for (const field of ["lastAttemptAt", "lastSuccessAt", "failure", "poisoned", "lockedOutBy"]) {
    if (!(field in raw)) return "malformed";
  }
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
/**
 * Everything about a payload that can make it UNREADABLE, in one place.
 *
 * Split out of `parseHistory` because the refusals and the building are two
 * jobs, and interleaved they measured 30 cognitive complexity — over the limit,
 * and over the point at which a reader can hold "which of these returns early"
 * in their head. **Every branch here ends the answer**; nothing below it does.
 *
 * Returns the refusal, or `null` when the envelope is sound.
 */
function refuseEnvelope(raw: unknown): HistoryView | null {
  if (!isRecord(raw)) {
    return { kind: "no-answer", why: "the dashboard server answered something that is not this API" };
  }
  /**
   * **THE SCHEMA IS CHECKED FIRST, BEFORE ANY ARM.** A payload stamped
   * `schema: 2` was accepted and drawn as current history, and an `unreadable`
   * envelope of an unknown version got past even after the first fix, because
   * that arm was handled above the check. Both GPT Sol's. The whole point of a
   * version on the wire is that a server which changed what a field MEANS is not
   * rendered by a build that predates the change, and an arm read before the
   * version is an arm read without it.
   *
   * `state.ts`'s rule: bump when a consumer that ignored the change would be
   * WRONG rather than merely poorer. So an unknown schema refuses and says which
   * one it saw.
   */
  const schema = raw["schema"];
  if (schema !== 1) {
    return {
      kind: "no-answer",
      why:
        `this page can read version 1 of the history API and the server sent ${JSON.stringify(schema)}. ` +
        "Refusing to draw it rather than guessing what changed — reload, or rebuild the client.",
    };
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

  /**
   * **EVERY FIELD THE HONESTY DEPENDS ON IS REQUIRED, NOT DEFAULTED.**
   *
   * Defaulting looks harmless one field at a time and is not, because each of
   * these is the thing that keeps a silence from reading as calm. GPT Sol
   * enumerated the concrete failures, and each is a renamed field away:
   *
   *  - `predecessor` absent → a window with no samples produces no gaps, and the
   *    panel prints "empty after a restart" about a dashboard down for a day;
   *  - `holes` absent → the line reconnects across corruption;
   *  - `retention` absent, or `lockedOutBy` renamed inside it → a writer that
   *    has stopped looks healthy;
   *  - `earliestAtMs`/`rotated` absent → "collecting since" claims a start time
   *    that a rotation makes false.
   *
   * So a payload missing any of them is refused, in one place, naming the field.
   * A field the server genuinely has no value for sends `null` — which is a
   * claim — and that is what `nullable` allows.
   */
  const required = ["samples", "predecessor", "holes", "earliestAt", "rotated", "retention", "unreadableLines", "refreshMs"];
  const missing = required.filter((field) => !(field in raw));
  if (missing.length > 0) {
    return {
      kind: "no-answer",
      why:
        `the history came back without ${missing.join(", ")} — a payload this page cannot read, ` +
        "rather than a day with nothing in it. The server is probably a different build from this page.",
    };
  }
  if (parseRetention(raw["retention"]) === "malformed") {
    return {
      kind: "no-answer",
      why: "the history's retention block is not a shape this page understands, and a writer that has stopped must not look healthy",
    };
  }

  return null;
}

/**
 * The reply, whatever it is. **Never throws and never returns null** — an answer
 * it cannot classify is `no-answer` with a sentence saying so, because a caller
 * left holding a null would have to write that sentence itself and there would
 * then be two of them.
 *
 * The refusals live in `refuseEnvelope` above; what is left here is the
 * building, which is allowed to assume the shape.
 */
export function parseHistory(raw: unknown): HistoryView {
  const refusal = refuseEnvelope(raw);
  if (refusal !== null) return refusal;
  /* `refuseEnvelope` has established every one of these; the cast is the
     narrowing TypeScript cannot carry across a function boundary. */
  const payload = raw as Record<string, unknown>;
  const fromMs = num(payload["fromMs"]) ?? 0;
  const toMs = num(payload["toMs"]) ?? 0;
  const retention = parseRetention(payload["retention"]) as RetentionView | null;

  const rawSamples = payload["samples"];
  /**
   * **A MISSING `samples` KEY IS NOT AN EMPTY DAY.** Renaming or dropping the
   * field produced a perfectly valid "the box recorded nothing for 24 hours" —
   * GPT Sol verified it, and it is the same collapse `state.ts` refuses when it
   * insists an empty `rows` is only a claim once `collectedAt` is non-null. An
   * absent array is a payload this page cannot read, not a quiet box.
   */
  if (!Array.isArray(rawSamples)) {
    return {
      kind: "no-answer",
      why: "the history came back with no samples array at all, which is a payload this page cannot read rather than a day with nothing in it",
    };
  }

  const samples: HealthSampleView[] = [];
  let unreadableSamples = 0;
  /**
   * **A SAMPLE THIS PAGE CANNOT READ BECOMES A POSITIONAL HOLE**, not just a
   * number in a footnote.
   *
   * The store already does this for a line it cannot parse, and the client had
   * the other half of the same bug: a malformed sample between two healthy ones
   * was dropped, and the line was drawn straight across it. GPT Sol's finding 1,
   * and it is the same reconnection a break must never get.
   */
  const rejected: { afterAtMs: number | null; beforeAtMs: number | null }[] = [];
  let openRejection: { afterAtMs: number | null; beforeAtMs: number | null } | null = null;
  for (const item of rawSamples) {
    const sample = parseSample(item);
    if (sample === null) {
      unreadableSamples += 1;
      if (openRejection === null) {
        openRejection = { afterAtMs: samples[samples.length - 1]?.atMs ?? null, beforeAtMs: null };
        rejected.push(openRejection);
      }
      continue;
    }
    if (openRejection !== null) {
      openRejection.beforeAtMs = sample.atMs;
      openRejection = null;
    }
    samples.push(sample);
  }

  const holes: { afterAtMs: number | null; beforeAtMs: number | null }[] = [];
  if (Array.isArray(payload["holes"])) {
    for (const item of payload["holes"]) {
      if (!isRecord(item)) continue;
      holes.push({ afterAtMs: msFrom(item["afterAt"]), beforeAtMs: msFrom(item["beforeAt"]) });
    }
  }
  /* The store's holes and this page's rejections are the same fact from two
     sides of the wire, and the renderer treats them identically: a place where
     the line must stop. */
  holes.push(...rejected);

  return {
    kind: "history",
    windowHours: num(payload["windowHours"]) ?? (toMs - fromMs) / 3_600_000,
    fromMs,
    toMs,
    samples,
    predecessor: parseSample(payload["predecessor"]),
    holes,
    earliestAtMs: msFrom(payload["earliestAt"]),
    rotated: payload["rotated"] === true,
    retention,
    unreadableLines: num(payload["unreadableLines"]) ?? 0,
    /* A server that did not say falls back to the poll's own default rather
       than to zero — a zero would make every interval look overdue. */
    refreshMs: num(payload["refreshMs"]) ?? 60_000,
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
