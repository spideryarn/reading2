/**
 * **The browser half of the live-conversation meter.**
 *
 * Stage 2B of docs/plans/260902g-cost-tracking-that-can-set-a-price.md. The
 * server half — the session journal, the three endpoints, `parseRealtimeUsage`
 * and `acceptRealtimeUsage` — is in src/live.ts and src/routes.ts, and it was
 * built first and deliberately: until this file existed, every issued session
 * was journalled as *connected, reported nothing*, which is a visible gap
 * rather than an absence.
 *
 * ## Why the browser is the only place this can be measured
 *
 * The audio is a `RTCPeerConnection` from the tab straight to OpenAI, because
 * relayed audio needs a long-lived socket a serverless function does not have
 * (useLiveConversation.ts's header). So the `usage` object OpenAI attaches to
 * `response.done` is delivered to *client JavaScript* and to nothing else —
 * there is no server-side copy of it anywhere, and no OpenAI admin key here to
 * reconcile against. docs/research/realtime-voice-cost-tracking-web.md § 2.
 *
 * ## The two halves are billed in different units, and that is the whole shape
 *
 * `gpt-realtime-2.1` answers, and is billed per token split by modality — audio
 * in is $32/Mtok against $4 for text. `gpt-live-transcribe` writes down what the
 * reader said, on its own event, and is billed **per audio minute**. A meter
 * that watched only `response.done` would price half the feature at zero with
 * nothing going red, which is why `LiveUsageReport` is a discriminated union
 * rather than token counts with an optional `seconds` beside them.
 *
 * ## What this file will not do
 *
 * - **It never sends a dollar amount, a model, an owner or an article.** All of
 *   those come from the session row the server wrote when it minted the token. A
 *   client that could name its own model could name the cheap one.
 * - **It never invents a number the provider did not send.** A zero standing in
 *   for an absent count is a plausible number with the evidence removed, and the
 *   server's parser refuses a report with a missing field precisely so the
 *   mistake is a loud 400 rather than a row priced at nothing.
 *   docs/reusable/silent-success.md. The two documented exceptions are argued
 *   for at `responseReport` below, and both bias the figure *up*.
 * - **It has no durable outbox and no ack-based retry.** GPT Sol cut both for
 *   the alpha: they are what an invoice needs, and this is a pricing estimate.
 *   The accepted loss is the final turn on a crash or an instant tab close, so
 *   the aggregate is biased low by a probably-small unknown. *"Add the durable
 *   outbox before usage affects an allowance, an invoice, or a promise made to
 *   users."*
 */

/**
 * **What the browser is allowed to say about one paid event.**
 *
 * This is the wire shape of `RealtimeUsage` in src/live.ts, and the two are
 * checked against each other in tests/live-meter.test.ts by handing what this
 * file builds to the server's own `parseRealtimeUsage` — the seam is the point,
 * so the test imports the real parser rather than a copy of its rules.
 *
 * **Declared here rather than imported**, because src/live.ts reaches
 * `node:crypto`, the system prompts and the OpenAI request shapes, and nothing
 * under `src/web/` may import a server module — tests/client-imports.test.ts
 * says why, with the 24KB bundle that proved it.
 */
export type LiveUsageReport =
  | {
      kind: "response";
      /** OpenAI's `response.id`. The server derives the row id from it, so a retry collides rather than doubles. */
      providerEventId: string;
      status: "completed" | "cancelled" | "failed" | "incomplete";
      /** When this tab saw `response.created`, or null if it never did. */
      startedAt: string | null;
      /** When this tab saw `response.done`. */
      finishedAt: string;
      /** The whole conversation so far, rebilled this turn. */
      inputTokens: number;
      outputTokens: number;
      inputTextTokens: number;
      inputAudioTokens: number;
      inputImageTokens: number;
      cachedTokens: number;
      cachedTextTokens: number;
      cachedAudioTokens: number;
      outputTextTokens: number;
      outputAudioTokens: number;
    }
  | {
      kind: "transcription";
      /** The transcribed item's id — `item_id`, not `event_id`, which changes per delivery. */
      providerEventId: string;
      startedAt: string | null;
      finishedAt: string;
      /** Seconds of the reader's audio. The only thing this half is billed on. */
      audioSeconds: number;
    };

/** The four statuses a realtime response ends on. OpenAI's own vocabulary, and the server's. */
const STATUSES = new Set(["completed", "cancelled", "failed", "incomplete"]);

/** A non-negative whole number off the wire, or `null` for anything else. */
function whole(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

/**
 * A count that is allowed to be missing, and reads as none when it is.
 *
 * Used only where an absence cannot make the price *lower* — see the two cases
 * argued at `responseReport`. Everywhere else a missing count makes the whole
 * report unreportable, which is the honest answer.
 */
function wholeOrNone(value: unknown): number {
  return value === undefined || value === null ? 0 : (whole(value) ?? 0);
}

function objectAt(parent: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  const found = parent?.[key];
  return typeof found === "object" && found !== null ? (found as Record<string, unknown>) : undefined;
}

/**
 * **One spoken turn, from `response.done`** — or `null` when the event does not
 * carry enough to price it.
 *
 * The times are handed in rather than read off the event, because realtime
 * events carry no timestamp at all: `startedAt` is when this tab saw
 * `response.created` for the same response id, and `finishedAt` is when it saw
 * this event. The server keeps both apart from its own receipt time, which is
 * what lets a late report be counted in the period it belongs to.
 *
 * ## Why `null` rather than a report with zeros in it
 *
 * At least one provider defect has `response.done` arriving with the top-level
 * totals and **no** `input_token_details` / `output_token_details`
 * (openai/openai-agents-js#538). Filling those with zeros would produce a report
 * the server happily accepts — the details are checked as `<=` their parents —
 * and prices at approximately nothing, because every rate is applied to a
 * modality split that is all zero. A turn that cost twenty cents would land in
 * the ledger as free, and no check anywhere would go red. So a turn whose
 * modality split is absent is *not reported*, and the caller counts it.
 *
 * ## The two counts that ARE allowed to be missing, and why
 *
 * - **`cached_tokens` and `cached_tokens_details`.** The nested split was
 *   missing from `openai-node`'s own types for a while (openai-node#1600) and is
 *   reported absent in the wild. Reading an absent cached count as zero prices
 *   that input at the *fresh* rate, which is ten times the cached one — so the
 *   error is upward, against us, and the parent count still travels on the row
 *   for anyone auditing it later. An absent cached split can therefore only
 *   overstate what we spent, which is the safe direction for a figure that
 *   exists to set a price.
 * - **`image_tokens`.** There is no image rate anywhere in src/pricing.ts and
 *   `liveSession` configures no image input, so a true non-zero here is refused
 *   by the server rather than priced. A missing one cannot mis-price anything,
 *   because there is nothing to price it at.
 */
export function responseReport(
  event: Record<string, unknown>,
  times: { startedAt: string | null; finishedAt: string },
): LiveUsageReport | null {
  const response = objectAt(event, "response");
  const usage = objectAt(response, "usage");
  const id = response?.id;
  const status = response?.status;
  if (!usage || typeof id !== "string" || id === "") return null;
  if (typeof status !== "string" || !STATUSES.has(status)) return null;

  const inputTokens = whole(usage.input_tokens);
  const outputTokens = whole(usage.output_tokens);
  const inputDetails = objectAt(usage, "input_token_details");
  const outputDetails = objectAt(usage, "output_token_details");
  if (inputTokens === null || outputTokens === null || !inputDetails || !outputDetails) return null;

  const inputTextTokens = whole(inputDetails.text_tokens);
  const inputAudioTokens = whole(inputDetails.audio_tokens);
  const outputTextTokens = whole(outputDetails.text_tokens);
  const outputAudioTokens = whole(outputDetails.audio_tokens);
  if (
    inputTextTokens === null ||
    inputAudioTokens === null ||
    outputTextTokens === null ||
    outputAudioTokens === null
  ) {
    return null;
  }

  const cachedDetails = objectAt(inputDetails, "cached_tokens_details");
  return {
    kind: "response",
    providerEventId: id,
    status: status as "completed" | "cancelled" | "failed" | "incomplete",
    startedAt: times.startedAt,
    finishedAt: times.finishedAt,
    inputTokens,
    outputTokens,
    inputTextTokens,
    inputAudioTokens,
    inputImageTokens: wholeOrNone(inputDetails.image_tokens),
    cachedTokens: wholeOrNone(inputDetails.cached_tokens),
    cachedTextTokens: wholeOrNone(cachedDetails?.text_tokens),
    cachedAudioTokens: wholeOrNone(cachedDetails?.audio_tokens),
    outputTextTokens,
    outputAudioTokens,
  };
}

/**
 * **One transcription, from `conversation.item.input_audio_transcription.completed`.**
 *
 * A separate billed line from the turn it belongs to, on its own event, which is
 * the reason a `response.done`-only meter would miss half the feature.
 *
 * **Seconds, and only seconds.** The event's `usage` comes in two shapes:
 * `{ type: "duration", seconds }` and `{ type: "tokens", … }`. `gpt-live-transcribe`
 * is billed per audio minute and `TRANSCRIPTION_PRICES` in src/pricing.ts holds
 * exactly one rate, per minute — so the duration shape is the one this can
 * price, and a token-shaped usage is reported as *unreportable* rather than
 * converted by a made-up tokens-per-second factor. If that is ever what real
 * sessions send, the fix is a token rate card on the server, and the console
 * line the caller writes is how we would find out.
 *
 * `item_id` rather than `event_id` is the idempotency key: `event_id` is minted
 * per delivery, so a retry under it would write a second row for one cost.
 */
export function transcriptionReport(
  event: Record<string, unknown>,
  times: { startedAt: string | null; finishedAt: string },
): LiveUsageReport | null {
  const itemId = event.item_id;
  if (typeof itemId !== "string" || itemId === "") return null;
  const usage = objectAt(event, "usage");
  const seconds = usage?.seconds;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return null;
  return {
    kind: "transcription",
    providerEventId: itemId,
    startedAt: times.startedAt,
    finishedAt: times.finishedAt,
    audioSeconds: seconds,
  };
}

/**
 * What one attempt at posting came back as, and the queue's whole decision
 * table.
 *
 * **`refused` is not a failure to retry.** The server answers a malformed or
 * impossible report with a 400 and a sentence, deliberately (`badReport` in
 * src/live.ts: *"a report the server refuses is a report the browser must stop
 * retrying"*). A queue that retried those could never drain and would spend the
 * rest of the session posting the same rejected event.
 */
export type PostOutcome = "accepted" | "retry" | "refused";

/** One thing waiting to be told to the server. */
type Pending =
  | { kind: "connected"; tries: number }
  | { kind: "usage"; report: LiveUsageReport; tries: number }
  | { kind: "close"; reason: string | null; tries: number };

/** The three accounting calls, as the meter needs them. `apiWiring` in wiring.ts is the real one. */
export interface MeterTransport {
  liveConnected(sessionId: string, keepalive: boolean): Promise<PostOutcome>;
  liveUsage(sessionId: string, report: LiveUsageReport, keepalive: boolean): Promise<PostOutcome>;
  liveClose(sessionId: string, reason: string | null, keepalive: boolean): Promise<PostOutcome>;
}

/**
 * How long to wait before trying a failed post again, in order.
 *
 * Runs out rather than going forever: after the last one the event is dropped
 * and counted. About a minute of trying covers a dropped connection or a server
 * restart, which is the whole class of failure an in-memory queue can honestly
 * claim to cover — anything longer than the tab's own life is what the durable
 * outbox we deliberately did not build would be for.
 */
const RETRY_DELAYS_MS = [500, 2_000, 5_000, 15_000, 30_000] as const;

/**
 * The most events the queue will hold.
 *
 * A twenty-minute session at its busiest is a few hundred events, so reaching
 * this means the server has been unreachable for minutes and the tab is
 * accumulating memory for reports that will very likely never be sent. The
 * oldest goes, because the newest is the one still arriving; either way it is a
 * drop and it is counted rather than silent.
 */
const MAX_QUEUE = 200;

/** What the meter has managed to do. Read by tests, and by anyone debugging a session. */
export interface MeterStatus {
  accepted: number;
  refused: number;
  dropped: number;
  /** Events that carried a cost this file could not describe. See `responseReport`. */
  unreportable: number;
  pending: number;
}

/**
 * **The queue: post immediately, retry in memory while the tab lives, and give
 * the teardown a hint.**
 *
 * Immediately, because the failure this design actually has is the tab closing
 * — not a reader lying about their token count, which
 * docs/project/security-map.md is explicit nobody here has an incentive to do.
 * Every turn posted as it happens is every turn but the last one.
 *
 * In memory, because the alternative — an IndexedDB outbox with acknowledged
 * delivery — was cut for the alpha by name. It is what an invoice needs.
 *
 * **`keepalive` on the last pass is a hint and never the path.** A browser
 * allows a small budget of keepalive requests during unload and gives no
 * feedback about whether any of them arrived; treating it as the delivery
 * mechanism would mean a meter whose successful case is unobservable.
 * `sendBeacon` is not used at all, for a concrete reason rather than taste: it
 * cannot set an `Authorization` header, and every route under `/api/` takes a
 * bearer token and no cookie, so a beacon would be a 401 that looks like a send.
 */
export class LiveMeter {
  readonly #sessionId: string;
  readonly #transport: MeterTransport;
  readonly #delays: readonly number[];
  #queue: Pending[] = [];
  #draining: Promise<void> | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #finished = false;
  #counts = { accepted: 0, refused: 0, dropped: 0, unreportable: 0 };

  constructor(opts: {
    sessionId: string;
    transport: MeterTransport;
    /** Overridden in tests, so a retry does not cost the suite thirty seconds. */
    delays?: readonly number[];
  }) {
    this.#sessionId = opts.sessionId;
    this.#transport = opts.transport;
    this.#delays = opts.delays ?? RETRY_DELAYS_MS;
  }

  get status(): MeterStatus {
    return { ...this.#counts, pending: this.#queue.length };
  }

  /** The data channel opened, so this issued session became a conversation. */
  connected(): void {
    this.#push({ kind: "connected", tries: 0 });
  }

  /** One paid event. */
  report(report: LiveUsageReport): void {
    this.#push({ kind: "usage", report, tries: 0 });
  }

  /**
   * An event arrived carrying a cost that could not be described — counted here
   * so that "the meter saw nothing" and "the meter saw something it could not
   * read" are different facts rather than one shrug.
   */
  couldNotRead(): void {
    this.#counts.unreportable += 1;
  }

  /**
   * The conversation ended, and why. Best-effort by nature: a closed laptop
   * says nothing, and the server is written to treat a missing `closed_at` as
   * ordinary rather than as a session still running.
   */
  end(reason: string | null): void {
    this.#push({ kind: "close", reason, tries: 0 });
  }

  /**
   * **The last pass**, on teardown. Every remaining item gets exactly one more
   * attempt, with `keepalive` set, and then the queue is abandoned whatever
   * happened — a retry after this point has no tab to run in.
   */
  async flush(): Promise<void> {
    if (this.#finished) return;
    this.#finished = true;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    /* Wait for a post already in flight before starting the last pass, so one
       event is not posted twice concurrently — the server absorbs the duplicate
       on `on conflict do nothing`, but a request nobody needed is still a
       request made during unload, where the budget is small. */
    await this.#draining;
    const last = this.#queue;
    this.#queue = [];
    for (const item of last) {
      const outcome = await this.#post(item, true);
      this.#count(outcome);
    }
  }

  #push(item: Pending): void {
    if (this.#finished) return;
    if (this.#queue.length >= MAX_QUEUE) {
      this.#queue.shift();
      this.#counts.dropped += 1;
    }
    this.#queue.push(item);
    void this.#drain();
  }

  /**
   * One at a time, in order.
   *
   * The order does not matter to the ledger — each report is an independent row
   * keyed on its own provider event id — but a single flight does: it is what
   * makes "the server is down" cost one outstanding request rather than one per
   * turn of a twenty-minute conversation.
   */
  #drain(): Promise<void> {
    if (this.#draining) return this.#draining;
    /* **A pending retry owns the queue until it fires.** Without this a new
       report arriving during a backoff would post the head item at once, which
       is precisely the hammering the backoff exists to prevent — and it is the
       ordinary case here, because reports keep arriving while the server is
       down. */
    if (this.#timer !== null) return Promise.resolve();
    /* `finally` rather than a line at the end of the loop: the callback runs on
       a microtask, so it cannot clear the field *before* the assignment below
       has put anything in it. A loop that returned without awaiting anything —
       an empty queue — did exactly that, and left a resolved promise standing
       in `#draining` for ever, which is a meter that silently stops sending. */
    const run = this.#loop().finally(() => {
      this.#draining = null;
    });
    this.#draining = run;
    return run;
  }

  async #loop(): Promise<void> {
    while (!this.#finished && this.#queue.length > 0) {
      const item = this.#queue[0];
      if (!item) break;
      const outcome = await this.#post(item, false);
      if (outcome === "retry") {
        const delay = this.#delays[item.tries];
        item.tries += 1;
        if (delay === undefined) {
          /* Out of attempts. Dropped and counted rather than kept for ever: an
             item at the head that can never succeed would hold every later
             report behind it for the rest of the session. */
          this.#queue.shift();
          this.#counts.dropped += 1;
          continue;
        }
        this.#timer = setTimeout(() => {
          this.#timer = null;
          void this.#drain();
        }, delay);
        return;
      }
      this.#queue.shift();
      this.#count(outcome);
    }
  }

  #count(outcome: PostOutcome): void {
    if (outcome === "accepted") this.#counts.accepted += 1;
    else if (outcome === "refused") this.#counts.refused += 1;
    else this.#counts.dropped += 1;
  }

  /**
   * **A throw is a `retry`, and the `try` is not defensive clutter.**
   *
   * `apiWiring` already turns a dead network into an outcome, but this queue is
   * driven from `void this.#drain()` inside an event handler — so a transport
   * that threw would become an unhandled rejection in the middle of a
   * conversation, which is a page error the reader can see and a session the
   * accounting took down. The ledger is never allowed to cost anybody a turn.
   */
  async #post(item: Pending, keepalive: boolean): Promise<PostOutcome> {
    try {
      if (item.kind === "connected") {
        return await this.#transport.liveConnected(this.#sessionId, keepalive);
      }
      if (item.kind === "usage") {
        return await this.#transport.liveUsage(this.#sessionId, item.report, keepalive);
      }
      return await this.#transport.liveClose(this.#sessionId, item.reason, keepalive);
    } catch {
      return "retry";
    }
  }
}
