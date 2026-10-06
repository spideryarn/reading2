/**
 * **The Anthropic Messages wire — pointed at OpenRouter.**
 *
 * The sibling of [`src/openrouter-stream.ts`](openrouter-stream.ts), and named
 * for the same thing it is: a *wire shape*, not a vendor. Both files talk to
 * OpenRouter. That one speaks OpenAI's chat/completions shape, for the calls a
 * reader waits on. This one speaks Anthropic's Messages shape, for the pipeline
 * stages `TASK_WIRE` (src/models.ts) puts on it — through OpenRouter's
 * Anthropic-compatible endpoint,
 * `POST https://openrouter.ai/api/v1/messages`, which its docs call the
 * "Anthropic Skin".
 *
 * The one way a Messages-wire pipeline stage calls a model: `streamMessage`, then
 * `finalMessage()` — ai-gateway.md#one-gateway-five-wires.
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
 * [docs/plans/260827q-ai-cost-tracking.md](../docs/plans/260827q-ai-cost-tracking.md).
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
import {
  providerCost,
  beginSpend,
  keyFingerprint,
  recordSpend,
} from "./ai-spend.js";
import {
  type AbortClass,
  type CallFailure,
  abortClass,
  networkClass,
  providerEventClass,
  stoppedByOurClock,
  thrownClass,
} from "./call-failure.js";
import { stageFailure } from "./job-failure.js";
import { log } from "./log.js";
import { MODEL_REFUSED, NOT_CONFIGURED } from "./messages.js";
import { isHighPowerModel, type ModelPower, type Task, modelFor } from "./models.js";
import { type Nanos, providerCostToNanos } from "./pricing.js";
import { truncationFailure } from "./token-budget.js";
import { TRANSIENT_STATUSES, TRANSPORT_ATTEMPTS, backoffMs, waitOrStop } from "./transport-retry.js";

/** Where the Anthropic Messages protocol is served from. Not `api.anthropic.com`. */
/* Not exported — see `OPENROUTER_BASE` in ai-call.ts for the same reasoning:
   an exported base is the way round the scan that forbids naming an endpoint. */
const MESSAGES_BASE_URL = "https://openrouter.ai/api";

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
     for all of them: `stageCli` (src/cli-ledger.ts) loads the file at
     each surviving command line's entrypoint, and nothing in the request path or
     a test loads anything. */
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error(NOT_CONFIGURED.message);
  return new Anthropic({
    baseURL: MESSAGES_BASE_URL,
    apiKey: key,
    authToken: key,
    logLevel: "off",
    /* **`0`, not the SDK's default of `2`, and this is an accounting decision
       rather than a reliability one.**

       `streamMessage` opens a fresh meter around each SDK operation, and the
       whole design rests on *one record, one network attempt*. With the default
       the SDK retries a failed request up to twice inside that operation, so a
       single `SpendRecord` could quietly cover three HTTP attempts — and a
       retry after a 5xx that arrived *post-generation* is an attempt that was
       billed. The row would then be a third of the truth, with nothing to say
       so, which is the exact shape of understatement this whole module exists
       to prevent. Found by a GPT Sol review of the code.

       What it would cost on its own: a transport blip that the SDK used to
       paper over surfaces as a failed step. **For five weeks it did.** This
       comment said "the pipeline already retries at the step level", and the
       only step-level retry is a reader pressing Retry, so one dropped
       connection failed an import (report spya-x4zut6, plan 261003m). The
       replacement is `streamMessage`'s own loop, below: a *countable*
       transport retry, every attempt its own record, and only before the
       response has begun. [`src/pdf-read.ts`](pdf-read.ts) §
       `withTransportRetries` is the older one of the same shape. */
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
  /** Which key paid, by name and never by value. `keyFingerprint` in ai-spend.ts. */
  credentialFingerprint: string | null;
  /**
   * **The pricing inputs, off the raw `message_delta` rather than off
   * `finalMessage()`.**
   *
   * Not a stylistic choice: the SDK merges the delta's usage into the message it
   * hands back and **drops the fields its own `Usage` type does not name** — the
   * TTL split, the tier and the geography among them. Read from the message they
   * are all `null`, which is the shape of a cost report that is quietly missing
   * the reason its number moved. Found by driving a real canned stream through
   * this file and watching `cacheWrite5mTokens` come back null with the number
   * plainly in the fixture.
   */
  cacheWrite5mTokens: number | null;
  cacheWrite1hTokens: number | null;
  reasoningTokens: number | null;
  webSearches: number | null;
  serviceTier: string | null;
  inferenceGeo: string | null;
}

/**
 * Subscribe to the raw stream events and pull out what `finalMessage()` will
 * throw away.
 *
 * Returns a live object: its fields are `null` until the stream reaches its
 * `message_delta`, and populated afterwards. **Read it after awaiting
 * `finalMessage()`**, never before.
 *
 * **Not exported, since 2026-08-28.** It used to be, "so a caller that already
 * holds a stream can meter it without going through the wrapper" — which is a
 * description of the bypass this seam exists to remove. A caller that holds a
 * stream and a meter is a caller that can decide not to finish either, and once
 * the numbers reach a database that is a bypass with a ledger behind it looking
 * confident. GPT Sol asked for it to close before the schema hardened.
 */
function meterStream(stream: MessageStream): CallMeter {
  const meter: CallMeter = {
    costNanos: null,
    costUsd: null,
    upstreamCostNanos: null,
    generationId: null,
    upstream: null,
    isByok: null,
    credentialFingerprint: null,
    cacheWrite5mTokens: null,
    cacheWrite1hTokens: null,
    reasoningTokens: null,
    webSearches: null,
    serviceTier: null,
    inferenceGeo: null,
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
        cache_creation?: {
          ephemeral_5m_input_tokens?: unknown;
          ephemeral_1h_input_tokens?: unknown;
        };
        output_tokens_details?: { thinking_tokens?: unknown };
        server_tool_use?: { web_search_requests?: unknown };
        service_tier?: unknown;
        inference_geo?: unknown;
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
      const num = (v: unknown): number | null =>
        typeof v === "number" && Number.isFinite(v) ? v : null;
      const str = (v: unknown): string | null =>
        typeof v === "string" && v.length > 0 ? v : null;
      meter.cacheWrite5mTokens =
        num(raw.usage?.cache_creation?.ephemeral_5m_input_tokens) ??
        meter.cacheWrite5mTokens;
      meter.cacheWrite1hTokens =
        num(raw.usage?.cache_creation?.ephemeral_1h_input_tokens) ??
        meter.cacheWrite1hTokens;
      meter.reasoningTokens =
        num(raw.usage?.output_tokens_details?.thinking_tokens) ??
        meter.reasoningTokens;
      meter.webSearches =
        num(raw.usage?.server_tool_use?.web_search_requests) ?? meter.webSearches;
      meter.serviceTier = str(raw.usage?.service_tier) ?? meter.serviceTier;
      meter.inferenceGeo = str(raw.usage?.inference_geo) ?? meter.inferenceGeo;
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
 * JSON. `src/summarise.ts` was the worst of them, treating that as a repairable
 * parse error, **buying a second call**, and then salvaging the batch as merely
 * missing summaries — that file went with the whole of Summary mode on
 * 2026-08-31. Nothing pays twice for it today: `src/labels.ts` is the only stage
 * that retries, and it retries a truncated or short batch while refusing to
 * retry a malformed shape. So the cost is now a stage failing with a parse error
 * that names the wrong cause — cheaper, and still wrong. Raised by a GPT Sol
 * review.
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
 * Every text block of an answer, joined in order. A thinking block is not text.
 *
 * For the three stages whose ending is their own (`simple-summary`, `labels`,
 * `structure-deepen`). Everything else wants `finishedText`.
 */
export function messageText(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/**
 * **The ordinary ending of a stage's call: a refusal throws, a truncation
 * throws, and otherwise this is the answer's text.**
 *
 * Until 2026-10-04 each stage wrote these three steps out itself, copied from a
 * neighbour: 32 copies of the text-block filter in 18 files. The copies drifted
 * the way copies do. `src/illustrated.ts` threw its refusal as a plain `Error`
 * for a month, so the reader got the generic sentence rather than the refusal
 * one, while two comments said every site was declared. With one copy there is
 * nowhere to write that. docs/plans/261004d-fifth-sweep-cluster-19-one-helper-for-reading-a-messages-result.md.
 *
 * **The refusal is judged first**, as every copy did. The other order would tag
 * a refused answer that also ran out of room as `bug` and tell the reader a
 * setting of ours is wrong.
 *
 * **`stop_details` is neither thrown nor logged.** It is the provider's own
 * words about a request that carried the whole article, and this error is
 * copied onto the job and shown on the progress card. See `MODEL_REFUSED` in
 * src/messages.ts and `wasRefused` above.
 *
 * `stage`, `maxTokens`, `answerTokens` and `headroom` are `truncationFailure`'s
 * own arguments, and exist only for its sentence. Pass `headroom` where the
 * call was sized with something other than the default (src/structure.ts), or
 * the sentence quotes a number the call was never sized with.
 *
 * Not for a stage that answers a truncation itself rather than failing on it.
 * `src/labels.ts` retries the batch and `src/structure-deepen.ts` shrinks it;
 * `src/simple-summary.ts` returns its failures with the call's usage. Those
 * three keep their own checks and take `messageText`.
 */
export function finishedText(
  message: Anthropic.Message,
  stage: string,
  maxTokens: number,
  answerTokens: number,
  headroom?: number,
): string {
  if (wasRefused(message)) {
    throw stageFailure(MODEL_REFUSED, {
      authored: "the model answered with stop_reason: refusal",
    });
  }
  const text = messageText(message);
  if (message.stop_reason === "max_tokens") {
    throw truncationFailure(
      stage,
      maxTokens,
      answerTokens,
      { outputTokens: message.usage.output_tokens, answerChars: text.length },
      headroom,
    );
  }
  return text;
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
  /**
   * **Both are this file's to set, and passing either is a compile error.**
   *
   * They were optional overrides until 2026-08-28, and each had its own way of
   * being wrong quietly. A stage that passed its own `model` could be switched
   * back to the unprefixed `CAPABLE_MODEL` — a 404 on every call — and
   * `tests/models.test.ts` would stay green, because it only ever asked
   * `modelFor()` what it *would* return, never what a stage actually sent. A
   * stage that passed its own `provider` could drop the cache pin, which does
   * not fail: it just costs several times more.
   *
   * Typed `never` rather than merely overwritten, so the mistake is caught where
   * it is made. They are overwritten after the spread as well, because a body
   * can be assembled at run time out of something the type system never saw.
   */
  provider?: never;
  model?: never;
};

/**
 * What `streamMessage` hands back.
 *
 * **Five functions, and deliberately not the stream.** A stage used to get the
 * SDK's own `MessageStream`, which has its own `finalMessage()` on it — so the
 * ordinary-looking `await call.stream.finalMessage()` was a working call that
 * recorded nothing, and nothing counted it. That was fine while the numbers only
 * reached a log line; with a ledger behind them it is a bypass that makes the
 * ledger look complete. GPT Sol asked for it closed before the schema hardened.
 */
export interface MeteredCall {
  /** Progress, exactly as `stream.on("text", …)` gave it. */
  onText: (listener: (delta: string) => void) => void;
  /**
   * Once, when the response has begun (`message_start`) — before any thinking
   * or text, and the moment a prompt cache this request writes becomes
   * readable by another. Never, if the call fails before it begins; a caller
   * waiting on it must also wait on `finalMessage()`. Simple's staggered
   * fan-out starts its other levels here (plan 261001j).
   */
  onStart: (listener: () => void) => void;
  /** `stream.finalMessage()`, plus the spend record. The only way to get the answer. */
  finalMessage: () => Promise<Anthropic.Message>;
  /**
   * Whether **this call** ended because somebody aborted it — its last stream,
   * or the wait between two attempts, where there is no stream to ask.
   */
  readonly aborted: () => boolean;
  /**
   * **How many network requests this call has made so far** — zero when the
   * signal was already aborted, otherwise one unless a transport retry happened
   * (see `streamMessage`). Read it after `finalMessage()` settles. For the
   * callers that publish a request count of their own (`SimpleRun.calls`,
   * `LabelBatchRecord.requests`), so that their figure and the ledger's cannot
   * disagree about a retried call.
   */
  readonly attempts: () => number;
}

/**
 * Open a metered streamed call.
 *
 * The stage keeps what it had, in a narrower shape: `onText` for progress and
 * the `signal` for a reader hitting Stop, and `finalMessage()` for the answer.
 *
 * **That last one is the whole design.** Recording could have been left to each
 * stage, and then there would be seven places to forget it, and forgetting it
 * would produce a working article and an empty cost table. Here the ordinary way
 * to get the answer is the function that keeps the account.
 *
 * **And until 2026-08-28 there was a second way.** The SDK's own stream was
 * handed back, so `await call.stream.finalMessage()` worked and recorded
 * nothing, and nothing counted it: `unscopedCalls()` increments when
 * `recordSpend` runs with no collector open, and bypassing this wrapper never
 * calls `recordSpend` at all. A test scanning `src/` was the only guard, which
 * was a weaker guarantee than the other wire's and was written down as one.
 *
 * It is closed. The stream, the meter and `meterStream` are private; what comes
 * back is five functions. GPT Sol asked for it before the numbers became
 * database rows, on the grounds that a documented bypass under a ledger is a
 * ledger that looks complete.
 *
 * The test is still there, and still worth having:
 * [`tests/messages-stream.test.ts`](../tests/messages-stream.test.ts) drives this
 * function against a stubbed transport and asserts that one network attempt
 * produces exactly one `SpendRecord`. Delete the recording and it goes red.
 *
 * **One attempt, one record — and since 2026-10-03 a call may be up to three
 * attempts.** An attempt that fails *before `message_start`* on a transient
 * failure is made again, after a short wait, as a new stream with its own
 * pending call and its own row (plan 261003m). `message_start` is the boundary
 * because it is the first thing a listener can hear: before it, nothing has
 * been shown to anybody. **It is not proof that nothing was billed.** A
 * connection can drop after the provider accepted the work, so the failed
 * attempt's row has an unknown cost, not a zero one, and a retry knowingly
 * accepts that it may pay twice for the first second of a call.
 *
 * `provider` is injected for the same reason: a stage that forgets it does not
 * fail, it just quietly stops hitting the cache. A caller may still pass its
 * own, which is what makes the injection testable.
 */
/**
 * **The bytes that actually go on the wire** — a stage's body plus everything
 * this module injects into it.
 *
 * Its own function since 2026-09-04, and the reason is a caller that needs the
 * request without sending it: `src/structure.ts` fingerprints the whole-document call
 * so a later attempt can reuse an answer it has already paid for, and a key that
 * reconstructs the injected half from knowledge of what this function does is a
 * key that goes stale the day a third field is injected — silently, because a
 * mutation test can only enumerate the fields it already has. ⟨GPT Sol, finding
 * 2 on the code, 2026-09-04.⟩ So there is one assembly and both callers use it.
 *
 * **`model` is resolved here, once**, and handed back on the object rather than
 * recomputed by the caller: `resolveModel` reads the environment at call time,
 * so two reads are two chances to disagree.
 */
export function messagesWireBody(
  task: Task,
  body: MessagesBody,
  power: ModelPower,
): Anthropic.MessageStreamParams {
  const model = modelFor(task, power);
  /* **Effort parity, plan 260930f decision 1.** Opus 5.5's default effort is
     `medium` where Sonnet 5's is `high`, so a call that thinks adaptively
     without naming an effort (`illustrated` today) would think *less* on the
     model that is meant to think more. It gets `high` — Sonnet's own default,
     so no `max_tokens` ceiling sized against Sonnet is asked for more than it
     was. Keyed on the model actually sent rather than on `power`, because the
     reason is the model's default: an override to Opus needs it too. A call
     that chose its own effort keeps it. */
  const parity =
    isHighPowerModel(model) && body.thinking?.type === "adaptive" && body.output_config?.effort === undefined
      ? { output_config: { ...body.output_config, effort: "high" as const } }
      : {};
  /* **After the spread, not before it.** It was before until 2026-08-28, so a
     body assembled at run time — out of something the type system never saw —
     could carry its own `provider` and win. Nothing did; the test that proved
     it possible was written the same hour, and it went red on the old order.
     `model` was already after, which is why only one of the two was wrong. */
  const wire = {
    ...body,
    ...parity,
    provider: MESSAGES_PROVIDER,
    model,
  };
  return wire as Anthropic.MessageStreamParams;
}

export function streamMessage(
  task: Task,
  body: MessagesBody,
  /* `power` required, like `modelFor`'s: which article this call is for
     decides the model, and a stage that has not asked does not compile. */
  options: { power: ModelPower; signal?: AbortSignal },
): MeteredCall {
  /* **No request, no row.** The SDK refuses an already-aborted signal before
     calling `fetch`; opening a meter first would therefore write an `aborted`
     row for a network attempt that never happened. This also has to precede
     `messagesClient()`: a cancelled call has no need to discover whether a key
     was configured. */
  if (options.signal?.aborted) {
    let rejection: Promise<Anthropic.Message> | null = null;
    return {
      onText: () => {},
      onStart: () => {},
      finalMessage: () => {
        rejection ??= Promise.reject(new Anthropic.APIUserAbortError());
        return rejection;
      },
      aborted: () => true,
      attempts: () => 0,
    };
  }

  const client = messagesClient();
  const wire = messagesWireBody(task, body, options.power);
  const model = wire.model;

  /* The caller's listeners, kept here rather than on a stream, because a
     transport retry (below) opens a second stream and they have to follow it. A
     retry happens only before `message_start`, so neither list ever hears two
     attempts. */
  const textListeners: ((delta: string) => void)[] = [];
  const startListeners: (() => void)[] = [];

  /**
   * One network attempt: its own stream, its own meter, its own pending call.
   * *One record, one attempt* is the rule `messagesClient` § `maxRetries`
   * protects, and it is why a retry is a second one of these rather than a loop
   * inside the first.
   */
  const open = (n: number) => {
    const startedAt = Date.now();
    /* Registered before the stream opens, so a call that never comes back leaves a
       trace rather than simply not appearing. See `PendingCall` in ai-spend.ts. */
    const callId = beginSpend(task, model);
    const stream = client.messages.stream(wire, options.signal ? { signal: options.signal } : undefined);
    const meter = meterStream(stream);
    /* Off the client rather than out of the environment a second time: the key the
       call actually went out with is the one the reconciliation has to ask about,
       and a second read of `process.env` is a second chance to disagree. */
    meter.credentialFingerprint = keyFingerprint(client.apiKey ?? "");
    /* `n` is which go this is, and is what the attempt's row carries: a row
       with `attempt > 1` is a retry that really started. `begun` is this
       wire's acceptance boundary, `message_start`: a failure before it is
       `before_answer`, one after it `mid_answer`. */
    const attempt = {
      stream,
      meter,
      callId,
      startedAt,
      begun: false,
      n,
      /** Who stopped this stream, set as the SDK reports its abort. See the `abort` listener below. */
      stoppedBy: null as AbortClass | null,
    };
    stream.on("streamEvent", (event) => {
      if (attempt.begun || event.type !== "message_start") return;
      attempt.begun = true;
      for (const listener of startListeners) {
        /* The SDK calls raw-event listeners inline while it is assembling the
           message. A callback exception therefore becomes a stream failure
           unless it stops here. `onStart` is a notification seam, not part of
           parsing the provider's answer; log a safe, content-free line and let
           the stream continue. */
        try {
          listener();
        } catch {
          log("model").warn("a message-stream start listener threw; the model stream was left running");
        }
      }
    });
    stream.on("text", (delta) => {
      for (const listener of textListeners) listener(delta);
    });
    /* The SDK deliberately creates an unhandled rejection when a stream fails
       before its caller invokes a promise-returning method and no error listener
       exists. `MeteredCall` does not expose the SDK stream, so its caller cannot
       install one; keep the failure on `finalMessage()` (and the pending row if
       that method is never called) without also leaking a process-level
       rejection. The abort event follows the same SDK rule. */
    stream.on("error", () => {});
    /* **Who stopped it is taken here, as the SDK says the stream was aborted,
       and not when the row is written.** The row is written when
       `finalMessage()` is awaited, which can be later, and the caller's signal
       can have fired in between: a stream the SDK aborted by itself would then
       be recorded under a deadline that did not stop it. A signal that has not
       fired by now did not do this, and that is `abort`. GPT Sol, plan 261006d
       finding F17. */
    stream.on("abort", () => {
      attempt.stoppedBy = abortClass(options.signal?.aborted ? options.signal.reason : undefined);
    });
    return attempt;
  };
  /* Opened here, not on the first `finalMessage()`: the request has always gone
     out when `streamMessage` is called, and a caller may attach listeners and
     await later. */
  let current = open(1);
  let attempts = 1;
  /* A Stop that landed in the wait between two attempts. No stream was open to
     be aborted, so no stream can say so. */
  let stoppedWhileWaiting = false;

  /* **Memoised, because `finalMessage()` may be awaited more than once.** The
     SDK's own is idempotent — it resolves the same message every time — so a
     caller awaiting it twice is legal and cheap, and until a GPT Sol review
     caught it that produced a *second* spend record for one call. A cost table
     that double-counts is worse than one that undercounts: it is wrong in the
     direction that looks like the thing you were trying to measure. */
  let settled: Promise<Anthropic.Message> | null = null;

  const finalMessage = (): Promise<Anthropic.Message> => {
    settled ??= (async () => {
      for (let attempt = 1; ; attempt++) {
        const { stream, meter, startedAt, callId } = current;
        try {
          const message = await stream.finalMessage();
          record(task, model, meter, message.usage, startedAt, { outcome: "ok" }, callId, message.model, attempt);
          return message;
        } catch (err) {
          const end = recordFailure(err);
          /* **Asked of the outcome, not of whether there are failure fields**:
             an abort has them too, and is still never asked again. */
          const aborted = end.outcome === "aborted";
          /* **The transport retry `messagesClient` § `maxRetries` promised and
             nothing built until 2026-10-03** (plan 261003m, report spya-x4zut6:
             one dropped connection, 595 ms in, failed an import). The attempt
             that failed has its own record, just written; the next has its own
             too. */
          if (aborted || current.begun || attempt >= TRANSPORT_ATTEMPTS || !worthAnotherAttempt(err)) {
            throw err;
          }
          try {
            await waitOrStop(backoffMs(attempt), options.signal);
            /* A Stop can land after the wait resolves. Checked again here, so
               it cannot open an attempt, and a row, for a request never sent. */
            options.signal?.throwIfAborted();
          } catch {
            stoppedWhileWaiting = true;
            throw new Anthropic.APIUserAbortError();
          }
          /* Logged as the retry starts, not when the failure was seen: a Stop
             in the wait above means there is no retry, and this line has to
             agree with the ledger, where a retry is a row with `attempt > 1`. */
          log("model").warn(failureFields(task, model, attempt + 1, end.failure), "ai transport retry");
          current = open(attempt + 1);
          attempts += 1;
        }
      }
    })();
    return settled;
  };

  /**
   * Write the row of an attempt that did not answer, and hand back how it
   * ended: an `error`, or an `aborted` that says who stopped it. Both carry
   * failure fields, so the caller tells them apart by the outcome.
   */
  const recordFailure = (err: unknown): UnansweredEnd => {
    const { stream, meter, startedAt, callId, begun, n, stoppedBy } = current;
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
       reads as a cancel. Both found by a GPT Sol review.

       **And then it OR-ed the signal back in anyway**, one line under the
       paragraph explaining why that is wrong, which a second Sol review
       caught. What is left is causal on both halves: either the stream says
       it was aborted, or the error *is* the abort — the signal's own reason,
       or an `AbortError` where none was given. "The signal happens to be
       aborted now" is not one of the two. */
    const aborted = stream.aborted || isAbort(err, options.signal);
    /* The status off the stream's own response, when one arrived: an error
       that came in-band, or a body that broke, carries none itself. */
    const status = stream.response?.status ?? null;
    const end: UnansweredEnd = aborted
      ? {
          outcome: "aborted",
          failure: {
            /* The same boundary an error is placed by. */
            phase: begun ? "mid_answer" : "before_answer",
            /* What the `abort` listener saw. Where the SDK reported no abort
               the error is itself the signal's abort, seen here for the first
               time, so the reason is read now. */
            class: stoppedBy ?? abortClass(isAbort(err, options.signal) ? options.signal?.reason : undefined),
            status,
          },
        }
      : { outcome: "error", failure: failureOf(err, begun, status) };
    /* **One line for a call that died after its answer began** — the failure
       the retry above does not cover, and the one plan 261006b exists to
       count. An error only: a call somebody stopped part-way did not die. */
    if (end.outcome === "error" && end.failure.phase === "mid_answer") {
      log("model").warn(failureFields(task, model, n, end.failure), "ai call died part-way");
    }
    /* **And one for a call our own clock stopped**, at either phase. Not for
       `abort`: a reader pressing Stop is not news. Plan 261006d. */
    if (end.outcome === "aborted" && stoppedByOurClock(end.failure)) {
      log("model").warn(failureFields(task, model, n, end.failure), "ai call stopped by our clock");
    }
    record(task, model, meter, null, startedAt, end, callId, null, n);
    return end;
  };

  return {
    onText: (listener) => {
      textListeners.push(listener);
    },
    onStart: (listener) => {
      startListeners.push(listener);
    },
    finalMessage,
    aborted: () => stoppedWhileWaiting || current.stream.aborted,
    attempts: () => attempts,
  };
}

/**
 * The `error` events a `200` stream can open with that are worth asking again.
 * The SDK keeps the event's `type` on the error it throws (core/streaming.js),
 * and the rest of that closed set — authentication, permission, billing,
 * invalid request, not found, too large, rate limit — are verdicts or queues.
 */
const TRANSIENT_EVENT_TYPES: ReadonlySet<string> = new Set(["timeout_error", "overloaded_error", "api_error"]);

/**
 * **Could the identical request come out differently a second later?**
 *
 * Asked only of an attempt that failed before `message_start`, so no listener
 * has heard anything. Three shapes reach here, and each has its own answer:
 *
 * - **A server sent a status.** Yes only for `TRANSIENT_STATUSES`; any other is
 *   a verdict on the request (malformed, unauthorised, out of credit, too big)
 *   and repeating it buys the same verdict.
 * - **A `200` whose stream opened with an `error` event** — an `APIError` with
 *   no status that is not a connection error. Yes for `TRANSIENT_EVENT_TYPES`.
 *   **And yes when the event named no type at all**: that is not one of
 *   Anthropic's verdicts, it is OpenRouter or an upstream failing in a shape
 *   nobody documented, and the cost of being wrong is two short extra requests.
 * - **The transport itself**: no connection, a timeout (`APIConnectionError`
 *   and its subclass), or a body that broke before its first frame, which the
 *   SDK wraps in a plain `AnthropicError`. Yes.
 *
 * A missing key is not among them — `messagesClient` throws that before any
 * stream exists. An abort never gets this far; the caller checks it first.
 */
function worthAnotherAttempt(err: unknown): boolean {
  if (!(err instanceof Anthropic.APIError)) return true;
  if (typeof err.status === "number") return TRANSIENT_STATUSES.has(err.status);
  if (err instanceof Anthropic.APIConnectionError) return true;
  return err.type === null || err.type === undefined || TRANSIENT_EVENT_TYPES.has(err.type);
}

/**
 * **Where and why an attempt failed**, as the labels its row carries —
 * [`call-failure.ts`](call-failure.ts), which also says why nothing here keeps
 * a word the error said. The same shapes `worthAnotherAttempt` sorts, asked a
 * different question:
 *
 * - **A server sent a status**: `refused`, and the status.
 * - **The connection** (`APIConnectionError` and its timeout subclass):
 *   `network`, with the code when the SDK's wrapped `TypeError` has a known
 *   one on its own cause, which is two causes down from here.
 * - **An `error` event inside a `200`**: `provider:<type>` for one of
 *   Anthropic's types, so an overloaded second and a bad key are not one
 *   count; `in_band` for a type nobody listed or none at all.
 * - **Anything else**: a body that broke, which the SDK wraps in a plain
 *   `AnthropicError` with the `TypeError` as its cause. `network` when that is
 *   what it was, `other` when it was not.
 *
 * `begun` is the phase and nothing else decides it. An abort never gets here.
 */
function failureOf(err: unknown, begun: boolean, responseStatus: number | null): CallFailure {
  const phase = begun ? "mid_answer" : "before_answer";
  if (!(err instanceof Anthropic.APIError)) return { phase, class: thrownClass(err), status: responseStatus };
  if (typeof err.status === "number") return { phase, class: "refused", status: err.status };
  if (err instanceof Anthropic.APIConnectionError) return { phase, class: networkClass(err), status: responseStatus };
  return { phase, class: providerEventClass(err.type), status: responseStatus };
}

/** What each of this wire's log lines about a failure carries, and nothing else. The same six as ai-call.ts. */
function failureFields(task: Task, model: string, attempt: number, failure: CallFailure): Record<string, unknown> {
  return { job: task, wire: "messages", model, attempt, class: failure.class, status: failure.status };
}

/**
 * How one attempt ended. An `error` has to say how, and an `aborted` has to
 * say who stopped it; see `CallEnd` in ai-call.ts.
 */
type AttemptEnd =
  | { outcome: "ok" }
  | { outcome: "aborted"; failure: CallFailure & { class: AbortClass } }
  | { outcome: "error"; failure: CallFailure };

/** An attempt that did not answer. Both arms carry failure fields; only the outcome says which it was. */
type UnansweredEnd = Exclude<AttemptEnd, { outcome: "ok" }>;

/**
 * **Was this error the abort itself?** — the same question
 * [`ai-call.ts`](ai-call.ts) asks, and for the same reason: a provider dying at
 * the moment a reader presses Stop is not a cancel, and recording it as one puts
 * it in the outcome nobody investigates.
 */
function isAbort(err: unknown, signal: AbortSignal | undefined): boolean {
  if (!signal?.aborted) return false;
  return err === signal.reason || (err as Error | undefined)?.name === "AbortError";
}

/** Turn a finished call into a `SpendRecord`. Absent numbers stay absent. */
function record(
  task: Task,
  model: string,
  meter: CallMeter,
  usage: Anthropic.Usage | null,
  startedAt: number,
  end: AttemptEnd,
  callId: number | null,
  answeredBy: string | null,
  /** Which go this was. This wire's loop always counts, so never `null`. */
  attempt: number,
): void {
  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
  recordSpend(
    {
      job: task,
      wire: "messages",
      model,
      answeredBy,
      /* `provider` or `none`, never `computed`: nothing on this wire prices
         anything itself. See `SpendProvenance` in src/ai-spend.ts. */
      cost: providerCost(meter.costNanos),
      upstreamCostNanos: meter.upstreamCostNanos,
      /* See the same lines in ai-call.ts: this wire is OpenRouter's
         `/v1/messages`, never `api.anthropic.com`, and OpenRouter prices it. */
      providerAccount: "openrouter",
      generationId: meter.generationId,
      upstream: meter.upstream,
      credentialFingerprint: meter.credentialFingerprint,
      isByok: meter.isByok,
      inputTokens: num(usage?.input_tokens),
      outputTokens: num(usage?.output_tokens),
      cacheReadTokens: num(usage?.cache_read_input_tokens),
      cacheWriteTokens: num(usage?.cache_creation_input_tokens),
      cacheWrite5mTokens: meter.cacheWrite5mTokens,
      cacheWrite1hTokens: meter.cacheWrite1hTokens,
      /* Thinking is billed as output and is *inside* `output_tokens`, so this is
         never added to anything — it is the answer to "did that call spend its
         whole budget thinking", which is what a jump in the bill turns out to be
         about more often than a price change. */
      reasoningTokens: meter.reasoningTokens,
      webSearches: meter.webSearches,
      serviceTier: meter.serviceTier,
      inferenceGeo: meter.inferenceGeo,
      ms: Date.now() - startedAt,
      outcome: end.outcome,
      attempt,
      failure: end.outcome === "ok" ? null : end.failure,
    },
    callId,
  );
}
