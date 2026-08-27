/**
 * **The Anthropic Messages wire — pointed at OpenRouter.**
 *
 * The sibling of [`src/openrouter-stream.ts`](openrouter-stream.ts), and named
 * for the same thing it is: a *wire shape*, not a vendor. Both files talk to
 * OpenRouter. That one speaks OpenAI's chat/completions shape, for the calls a
 * reader waits on. This one speaks Anthropic's Messages shape, for the seven
 * pipeline stages — through OpenRouter's Anthropic-compatible endpoint,
 * `POST https://openrouter.ai/api/v1/messages`, which its docs call the
 * "Anthropic Skin".
 *
 * ## Why the SDK is still here
 *
 * Because it works unchanged. The seven stages keep `client.messages.stream(…)`,
 * `finalMessage()`, `thinking: {type: "adaptive"}`, `output_config.effort`,
 * `cache_control` breakpoints and native `stop_reason` values. Only the client's
 * construction and the model's spelling move. That is the whole reason this
 * migration is a `baseURL` rather than a rewrite: routing the stages through the
 * *chat/completions* shape instead would have meant translating every one of
 * those, and losing adaptive thinking outright — OpenRouter's `reasoning.effort`
 * takes `max|xhigh|high|medium|low|minimal|none` and 400s on `adaptive`.
 *
 * ## What we get for it, which is the point
 *
 * The Skin returns Anthropic's own `usage` object — the additive counters, the
 * 5m/1h cache split, `service_tier`, `inference_geo` — **and OpenRouter's
 * `cost`, beside them.** So a call reports what it did *and* what it cost, in
 * one shape, with no price table in the middle. See
 * [docs/plans/ai-cost-tracking.md](../docs/plans/ai-cost-tracking.md).
 *
 * ## The three things that fail silently here
 *
 * Every one of these looks exactly like working code. They are why this file
 * exists at all rather than each stage constructing its own client.
 *
 * 1. **`finalMessage()` drops `cost`.** It is on the wire, in the
 *    `message_delta` event, next to the full native usage. The SDK's merge keeps
 *    only the fields its own types know about and discards the rest, so a stage
 *    reading `message.usage.cost` gets `undefined` for ever and nothing errors.
 *    `meterStream` below subscribes to the raw events instead.
 *    [`tests/messages-stream.test.ts`](../tests/messages-stream.test.ts) goes red
 *    if that stops arriving.
 * 2. **The default upstream is not Anthropic.** Unpinned, live probes landed on
 *    "Claude Platform on AWS" every time. A cache lives on the upstream that
 *    wrote it, so an unpinned stage would work perfectly and never read a cache
 *    again — the bill roughly triples and nothing anywhere complains.
 *    `MESSAGES_PROVIDER` is therefore mandatory rather than advisory.
 * 3. **`require_parameters` defaults to `false` while `allow_fallbacks` defaults
 *    to `true`.** So a fallback upstream that does not support `cache_control` or
 *    adaptive thinking may be handed the request and serve it *without them*,
 *    successfully. Availability quietly beating correctness. It is set below.
 *
 * And the rule that found all three, worth keeping in mind before adding a
 * fourth field: **OpenRouter accepting a request is never evidence that
 * OpenRouter honoured a field.** A made-up top-level key (`spideryarn_nonsense`)
 * comes back `200` with no complaint. Only an observable difference in the
 * response proves anything.
 */
import Anthropic from "@anthropic-ai/sdk";
import { type SpendRecord, beginSpend, recordSpend } from "./ai-spend.js";
import { NOT_CONFIGURED } from "./messages.js";
import { type Task, modelFor } from "./models.js";
import { type Nanos, providerCostToNanos } from "./pricing.js";

/** Where the Anthropic Messages protocol is served from. Not `api.anthropic.com`. */
export const MESSAGES_BASE_URL = "https://openrouter.ai/api";

/**
 * **Which upstream, and how hard we insist.**
 *
 * `order` rather than `only`, for the reason
 * [`PROVIDER_ORDER`](openrouter-stream.ts) gives on the other wire: a cache miss
 * costs money, an unavailable feature costs the reader the feature, and
 * forbidding fallback outright turns an Anthropic outage into a hard failure.
 * Preference, not a ban.
 *
 * `require_parameters` is the half that is *not* a preference. Without it a
 * fallback may serve the request having silently dropped `cache_control` or
 * `thinking` — which is not a degraded answer, it is a full-price answer that
 * looks identical to a cheap one. With it, an upstream that cannot honour the
 * parameters is not offered the request in the first place.
 */
export const MESSAGES_PROVIDER = {
  order: ["anthropic"],
  allow_fallbacks: true,
  require_parameters: true,
} as const;

/**
 * The SDK, pointed at the Skin.
 *
 * `authToken` rather than `apiKey` is the load-bearing part: the SDK sends
 * `apiKey` as Anthropic's `x-api-key` header, and OpenRouter wants
 * `Authorization: Bearer`. `authToken` is what produces the latter. Both are
 * passed because the SDK refuses to construct without one of them and throws its
 * own error naming an environment variable, which is not a thing to show a
 * reader — see `NOT_CONFIGURED` in [`src/messages.ts`](messages.ts).
 *
 * `logLevel: "off"` carries over from the seven call sites this replaces. The
 * SDK's own logger writes to stderr and would bypass
 * [`src/log.ts`](log.ts) entirely — see docs/project/logging.md.
 */
export function messagesClient(): Anthropic {
  /* **`loadEnvLocal()` is deliberately NOT called here**, and it was, for about
     an hour. Six of the seven stages never loaded `.env.local` — they did not
     have to, because the SDK they used to construct read `ANTHROPIC_API_KEY`
     out of whatever shell had exported it — so `npm run arc` came back
     `[ai-not-set-up]` from a laptop where the key is plainly present, and
     loading the file here looked like the obvious fix.

     It is the wrong layer, and `tests/labels-batching.test.ts` said so within
     the hour: that test **deletes `OPENROUTER_API_KEY` on purpose**, so that a
     run which wrongly refuses to resume has to reach the model and fail
     instantly. Reading the file here handed the real key back, and the test
     made a real, paid call to a live API and then timed out. A library that
     re-reads credentials a caller has just removed cannot be told not to.

     So it belongs at the program's edge — which is what `src/ideas.ts` already
     did, its own comment saying it was "worth fixing for all of them". Now done
     for all of them: each stage's CLI `main()` loads the file, and nothing in
     the request path or a test loads anything. */
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error(NOT_CONFIGURED.message);
  return new Anthropic({
    baseURL: MESSAGES_BASE_URL,
    apiKey: key,
    authToken: key,
    logLevel: "off",
    /* **`0`, not the SDK's default of `2`, and this is an accounting decision
       rather than a reliability one.**

       `streamMessage` opens exactly one meter around one SDK operation, and the
       whole design rests on *one record, one call*. With the default the SDK
       retries a failed request up to twice inside that operation, so a single
       `SpendRecord` could quietly cover three HTTP attempts — and a retry after
       a 5xx that arrived *post-generation* is an attempt that was billed. The
       row would then be a third of the truth, with nothing to say so, which is
       the exact shape of understatement this whole module exists to prevent.
       Found by a GPT Sol review of the code.

       What it costs: a transport blip that the SDK used to paper over now
       surfaces as a failed step. That is the honest trade — the pipeline
       already retries at the step level, where a retry is visible on the job,
       and [`src/pdf-read.ts`](pdf-read.ts) shows what a deliberate,
       *countable* transport retry looks like when one is wanted. */
    maxRetries: 0,
  });
}

/**
 * The SDK's streaming handle.
 *
 * Derived from the method's own return type rather than imported from
 * `@anthropic-ai/sdk/lib/MessageStream.js`: the class is not re-exported from
 * the package root, and a deep path into `lib/` is a private path that can move
 * in a patch release. This spelling cannot go stale without the call below
 * failing to compile at the same moment.
 */
export type MessageStream = ReturnType<Anthropic["messages"]["stream"]>;

/**
 * What a finished call cost and where it ran — everything the SDK's typed
 * `Message` does not carry.
 *
 * Every field is nullable on purpose. This is a record of what the provider
 * actually said, and a field that did not arrive must read as *absent* rather
 * than as zero: a `0` here would be indistinguishable from a free call and would
 * quietly understate a bill. `null` is a thing a report can notice and count.
 */
export interface CallMeter {
  /** OpenRouter's own figure for this call, in nano-dollars. `null` if it never arrived. */
  costNanos: Nanos | null;
  /** `usage.cost` verbatim, in dollars, for logging and for a report to re-check. */
  costUsd: number | null;
  /**
   * `cost_details.upstream_inference_cost`, in nano-dollars — **a different
   * definition of money from `costNanos`.** They agree on an ordinary call and
   * diverge under BYOK, where `cost` is 0 because OpenRouter charged nothing and
   * the inference was still worth something. See `SpendRecord.upstreamCostNanos`.
   */
  upstreamCostNanos: Nanos | null;
  /** `x-generation-id`, the key for `GET /api/v1/generation?id=…` later. */
  generationId: string | null;
  /** Which upstream actually answered — "Anthropic", "Claude Platform on AWS", … */
  upstream: string | null;
  /**
   * Whether the call was billed to somebody else's key.
   *
   * **Recorded because under BYOK OpenRouter's `cost` can legitimately be
   * `0`** while the upstream bills elsewhere — and a zero here is otherwise
   * indistinguishable from a genuinely free call, which is the one reading a
   * cost report must never get wrong. Raised by a GPT Sol review before this
   * shape hardened into a database column.
   */
  isByok: boolean | null;
}

/**
 * Subscribe to the raw stream events and pull out what `finalMessage()` will
 * throw away.
 *
 * Returns a live object: its fields are `null` until the stream reaches its
 * `message_delta`, and populated afterwards. **Read it after awaiting
 * `finalMessage()`**, never before.
 *
 * Exported separately from `streamMessage` so a caller that already holds a
 * stream — a test, or a stage doing something unusual — can meter it without
 * going through the wrapper.
 */
export function meterStream(stream: MessageStream): CallMeter {
  const meter: CallMeter = {
    costNanos: null,
    costUsd: null,
    upstreamCostNanos: null,
    generationId: null,
    upstream: null,
    isByok: null,
  };
  stream.on("streamEvent", (event: { type: string }) => {
    /* Deliberately reading through a cast rather than the SDK's types. The
       whole point of this function is the fields the SDK's types do not have;
       typing it against them would remove exactly what we came for. */
    const raw = event as unknown as {
      message?: { id?: string; provider?: string };
      usage?: {
        cost?: unknown;
        is_byok?: unknown;
        cost_details?: { upstream_inference_cost?: unknown };
      };
    };
    if (event.type === "message_start") {
      if (typeof raw.message?.id === "string") meter.generationId = raw.message.id;
      if (typeof raw.message?.provider === "string") meter.upstream = raw.message.provider;
    }
    if (event.type === "message_delta") {
      if (typeof raw.usage?.cost === "number") {
        meter.costUsd = raw.usage.cost;
        meter.costNanos = providerCostToNanos(raw.usage.cost);
      }
      const upstreamCost = raw.usage?.cost_details?.upstream_inference_cost;
      if (typeof upstreamCost === "number") {
        meter.upstreamCostNanos = providerCostToNanos(upstreamCost);
      }
      if (typeof raw.usage?.is_byok === "boolean")
        meter.isByok = raw.usage.is_byok;
    }
  });
  return meter;
}

/**
 * **Did the model refuse?** — the one place allowed to look at `stop_details`.
 *
 * Anthropic answers a blocked request with `stop_reason: "refusal"`, and until
 * 2026-08-27 all seven stages simply compared against that. Going through
 * OpenRouter put a question mark over it that cannot be removed by reading:
 * **OpenRouter's own Messages reference contradicts itself**, showing
 * `stop_details.type: "refusal"` beside `stop_reason: "end_turn"` in the same
 * example.
 *
 * It could not be settled by probe either. Triggering a genuine refusal means
 * composing a request harmful enough to trip a safety classifier, which is not a
 * thing to do to find out a field name.
 *
 * **So the check accepts either, which is the right answer whichever way the
 * documentation gets fixed.** It costs one clause. The alternative — assuming
 * `stop_reason` and being wrong — is not a failed generation but a *silent* one:
 * the branch never fires, and each stage tries to parse a refusal sentence as
 * JSON. [`src/summarise.ts`](summarise.ts) is the worst of them, treating that as
 * a repairable parse error, **buying a second call**, and then salvaging the
 * batch as merely missing summaries. Raised by a GPT Sol review.
 *
 * **Only `.type` is read, and nothing but a boolean leaves this function.**
 * `stop_details` is the provider's own words about a request that carried the
 * whole article, and it must reach neither a log nor a screen — the rule
 * [`tests/stop-details.test.ts`](../tests/stop-details.test.ts) enforces across
 * `src/`, of which this is the single deliberate exception.
 */
export function wasRefused(message: Anthropic.Message): boolean {
  if (message.stop_reason === "refusal") return true;
  const details = message.stop_details as { type?: unknown } | null | undefined;
  return details?.type === "refusal";
}

/**
 * The body a stage passes, plus the fields Anthropic's own types do not know.
 *
 * `MessageStreamParams`, not `MessageCreateParamsStreaming`: the latter requires
 * `stream: true` in the body, which `.stream()` sets for you. Using it would
 * have made every one of the seven stages write a `stream: true` that does
 * nothing.
 */
export type MessagesBody = Omit<Anthropic.MessageStreamParams, "model"> & {
  provider?: typeof MESSAGES_PROVIDER;
  /**
   * Optional, and normally omitted — `streamMessage` derives it from the task.
   *
   * **Left to the caller until a GPT Sol review pointed out what that allowed.**
   * Each of the seven stages passed `CAPABLE_MODEL_OPENROUTER` itself, so a stage
   * could be switched back to the unprefixed `CAPABLE_MODEL` — a 404 on every
   * call — and `tests/models.test.ts` would stay green, because it only ever
   * asked `modelFor()` what it *would* return, never what a stage actually sent.
   * One source for the id closes that: `modelFor(task)` is now what goes on the
   * wire, and the outgoing bodies are asserted.
   */
  model?: Anthropic.MessageStreamParams["model"];
};

/** What `streamMessage` hands back: the SDK's stream, and a `finalMessage` that keeps accounts. */
export interface MeteredCall {
  /** The SDK's own stream. Subscribe to `"text"` for progress exactly as before. */
  stream: MessageStream;
  /** Populated by the time `finalMessage()` resolves; `null` before that. */
  meter: CallMeter;
  /** `stream.finalMessage()`, plus the spend record. Await this, not the stream's own. */
  finalMessage: () => Promise<Anthropic.Message>;
}

/**
 * Open a metered streamed call.
 *
 * The stage keeps everything it had — `stream.on("text", …)` for progress, the
 * `signal` for a reader hitting Stop — and swaps `stream.finalMessage()` for the
 * `finalMessage()` on the returned object.
 *
 * **That swap is the whole design.** Recording could have been left to each
 * stage, and then there would be seven places to forget it, and forgetting it
 * would produce a working article and an empty cost table. Here the ordinary way
 * to get the answer is the function that keeps the account.
 *
 * **But a stage that awaits `call.stream.finalMessage()` instead still works and
 * still records nothing, and nothing counts that.** An earlier version of this
 * paragraph claimed `unscopedCalls()` in [`src/ai-spend.ts`](ai-spend.ts) was the
 * backstop; it is not, and a GPT Sol review said so. That counter increments when
 * `recordSpend` runs with no collector open — bypassing this wrapper never calls
 * `recordSpend` at all, so it increments nothing. The two failures look identical
 * from the outside and only one of them is counted.
 *
 * What actually guards it is a test:
 * [`tests/messages-stream.test.ts`](../tests/messages-stream.test.ts) drives this
 * function against a stubbed transport and asserts that one finished call
 * produces exactly one `SpendRecord`. Delete the recording and it goes red.
 *
 * `provider` is injected for the same reason: a stage that forgets it does not
 * fail, it just quietly stops hitting the cache. A caller may still pass its
 * own, which is what makes the injection testable.
 */
export function streamMessage(
  task: Task,
  body: MessagesBody,
  options?: { signal?: AbortSignal },
): MeteredCall {
  const client = messagesClient();
  const startedAt = Date.now();
  const model = body.model ?? modelFor(task);
  /* Registered before the stream opens, so a call that never comes back leaves a
     trace rather than simply not appearing. See `PendingCall` in ai-spend.ts. */
  const callId = beginSpend(task, model);
  const stream = client.messages.stream(
    { provider: MESSAGES_PROVIDER, ...body, model } as Anthropic.MessageStreamParams,
    options,
  );
  const meter = meterStream(stream);

  /* **Memoised, because `finalMessage()` may be awaited more than once.** The
     SDK's own is idempotent — it resolves the same message every time — so a
     caller awaiting it twice is legal and cheap, and until a GPT Sol review
     caught it that produced a *second* spend record for one call. A cost table
     that double-counts is worse than one that undercounts: it is wrong in the
     direction that looks like the thing you were trying to measure. */
  let settled: Promise<Anthropic.Message> | null = null;

  const finalMessage = (): Promise<Anthropic.Message> => {
    settled ??= (async () => {
      try {
        const message = await stream.finalMessage();
        record(
          task,
          model,
          meter,
          message.usage,
          startedAt,
          "ok",
          callId,
          message.model,
        );
        return message;
      } catch (err) {
        /* **An aborted or failed call has usually still cost money.** Recording
           it with a non-`ok` outcome is the honest answer: a row saying "this
           happened, and here is what we know about what it cost" is something a
           report can surface, where no row at all is a hole in the bill that
           nothing points at.

           The cost is whatever the meter caught, **not forced to null**. If the
           terminal `message_delta` arrived and the stream then failed, that
           figure is real and keeping it is strictly better. Where nothing
           arrived it stays null, which reads as *unknown* rather than as free.
           So the number on a non-`ok` row is a **lower bound**, and anything
           reporting it should say so.

           `stream.aborted`, not `options.signal.aborted`: the SDK exposes how
           *this stream* ended, where the external signal answers a different
           question and gets two cases wrong — `stream.abort()` with no signal
           reads as an error, and a provider failure racing a later signal abort
           reads as a cancel. Both found by a GPT Sol review. */
        const aborted = stream.aborted || options?.signal?.aborted === true;
        record(
          task,
          model,
          meter,
          null,
          startedAt,
          aborted ? "aborted" : "error",
          callId,
          null,
        );
        throw err;
      }
    })();
    return settled;
  };

  return { stream, meter, finalMessage };
}

/** Turn a finished call into a `SpendRecord`. Absent numbers stay absent. */
function record(
  task: Task,
  model: string,
  meter: CallMeter,
  usage: Anthropic.Usage | null,
  startedAt: number,
  outcome: SpendRecord["outcome"],
  callId: number | null,
  answeredBy: string | null,
): void {
  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
  recordSpend(
    {
      job: task,
      model,
      answeredBy,
      costNanos: meter.costNanos,
      upstreamCostNanos: meter.upstreamCostNanos,
      generationId: meter.generationId,
      upstream: meter.upstream,
      isByok: meter.isByok,
      inputTokens: num(usage?.input_tokens),
      outputTokens: num(usage?.output_tokens),
      cacheReadTokens: num(usage?.cache_read_input_tokens),
      cacheWriteTokens: num(usage?.cache_creation_input_tokens),
      ms: Date.now() - startedAt,
      outcome,
    },
    callId,
  );
}
