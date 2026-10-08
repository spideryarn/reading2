/**
 * **Every model call this app makes over HTTP** — the one place a request to
 * OpenRouter is built, sent, read and *accounted for*.
 *
 * The sibling of [`src/messages-stream.ts`](messages-stream.ts). That file owns
 * the pipeline stages, which speak Anthropic's Messages shape through the SDK;
 * this one owns the calls that speak OpenAI's shape and are made with `fetch` —
 * chat, explain, search, quiz marking, the three referee runs, dictation, the
 * PDF reader, and embeddings. It said "the six" until 2026-09-02 and had been
 * ten for a while; a count in prose is a fact nothing keeps in step, so `grep`
 * for `openRouterStream(`, `openRouterJson(` and `openRouterImage(` rather than
 * trusting this
 * sentence. Between the two files there is no third way to spend money, and
 * [`tests/ai-call.test.ts`](../tests/ai-call.test.ts) scans `src/` to keep it
 * that way. The doc that owns both is ai-gateway.md#one-gateway-a-wire-for-each-shape.
 *
 * > Presumably we want to do this in a way that's reusable (i.e. whenever we
 * > make an AI call, we do it in the same way, which takes care of cost-tracking
 * > etc)?
 * >
 * > — Greg, 2026-08-27
 *
 * ## The shape, and why it is a generator rather than three steps
 *
 * There are two entry points, `openRouterStream` and `openRouterJson`, and each
 * is **one indivisible operation**: send, check the status, read the body, meter
 * it, finish. Nothing in between is exported — no `Response`, no meter, no
 * separately callable chunk parser.
 *
 * The first draft did export those three, and a GPT Sol review found the hole in
 * about a page: `openRouterCall()` hands back a non-200 response, the caller
 * throws its own error before it ever reaches the metering step, and the call
 * sits open for ever having cost money nobody recorded. Every design where the
 * caller holds two halves has some version of that. Here the fetch happens on
 * the generator's **first `next()`**, and from that moment the same stack frame
 * owns the request through its `finally` — early `break`, a throw, an abort, a
 * missing `[DONE]`, a 429, a body that will not read: all of them cross it.
 *
 * ## What the callers keep
 *
 * The deadline clock, the stall clock, the abort wording, the logging, and what
 * they do with each chunk. Those differ for real reasons — `converse` runs a
 * multi-round tool loop with one deadline and a fresh stall clock per round,
 * `search` reads the stream strictly because its payload is JSON rather than
 * prose, `explain` guards a race where the stall cancel beats the pending read's
 * rejection — and folding them together would be one refactor risking three
 * working files to remove duplication that is not duplication.
 *
 * ## `provider` is a table, not a default
 *
 * The obvious move — inject the Anthropic pin the way
 * [`messages-stream.ts`](messages-stream.ts) does — is **wrong here, and wrong
 * silently**. Three of these six must not have it: dictation talks to Gemini and
 * needs `zdr`, the PDF reader talks to OpenAI and must forbid fallback, and
 * embeddings talks to Voyage. Leaving each caller to pass its own was the second
 * draft, and Sol rejected that too: a field six callers set independently is a
 * field that drifts. So it is `AI_JOB_ROUTE` below — exhaustive, so a seventh
 * job cannot be added without somebody deciding, and injected *after* the
 * caller's body so it cannot be overridden by accident.
 */
import {
  providerCost,
  beginSpend,
  keyFingerprint,
  recordSpend,
} from "./ai-spend.js";
/* `sniffImage` says what a picture actually is, from its signature. Reused
   rather than re-implemented so this repo has one statement of the PNG magic
   bytes; `assets.ts` imports nothing at all, so this closes no cycle. */
import { imageDimensions, sniffImage } from "./assets.js";
/* **The container list, from the file both ends of dictation import.**
   `dictation-limits.ts` imports nothing at all — that is the whole reason it
   exists — so this closes no cycle, and taking the type rather than restating
   it means the gateway cannot be handed a container the browser never
   validated. */
import {
  type AbortClass,
  type CallFailure,
  type FailureClass,
  abortClass,
  isErrorEnvelope,
  networkClass,
  stoppedByOurClock,
  thrownClass,
} from "./call-failure.js";
import type { AudioFormat } from "./dictation-limits.js";
/* `log.ts` imports only pino and its redaction list, so this closes no cycle. */
import { log } from "./log.js";
import { NOT_CONFIGURED, providerHttpFailure } from "./messages.js";
/* **A type-only import, and that is load-bearing rather than tidy.** A value
   import here closes a cycle: `models.ts` imports `EMBEDDING_MODEL` from
   `embeddings.ts`, which now imports this file. Entering the graph through
   `embeddings.ts` then reaches `models.ts` while `EMBEDDING_MODEL` is still in
   its temporal dead zone, and `NON_TASK_MODELS` — a top-level literal that
   dereferences it — throws `Cannot access 'EMBEDDING_MODEL' before
   initialization` at import time. Found by importing the two modules in the
   other order, which is a thing nothing in the app happens to do today and
   something the next file to import embeddings might. `import type` is erased,
   so it creates no edge at all. */
import type { AiJob, Wire } from "./models.js";
import { parseRetryAfter } from "./retry-after.js";
import { isHighPowerModel } from "./high-power-model.js";
import {
  type StreamChunk,
  readerAborted,
  type StreamEnd,
  spokeNonsense,
  sseChunks,
  type Usage,
  whereSearchCountCameFrom,
} from "./openrouter-stream.js";
import { type Nanos, providerCostToNanos } from "./pricing.js";
import { TRANSIENT_STATUSES, TRANSPORT_ATTEMPTS, backoffMs, waitOrStop } from "./transport-retry.js";

/**
 * **How a stream ended**, as one value with one true answer.
 *
 * Every caller needs this and, until 2026-09-01, every caller worked it out
 * again from three signals, a boolean and a string — in the same order, with
 * the same comment, and with the same mistake in six of the seven. The mistake
 * is worth stating once because it is what this type exists to make
 * unwriteable: the guard was
 *
 * ```ts
 * if (!stopped && !end.terminated && finishReason === null) throw …
 * ```
 *
 * and a non-null finish reason can only ever make a conjunction *less* likely
 * to be true. So no value of `finish_reason` ever failed a stream anywhere,
 * and the comment beside it described a loosening as though it were a check.
 *
 * ## This says what happened. It does not say what to do
 *
 * That line is the whole design, and it is not squeamishness — the callers
 * genuinely disagree, on evidence:
 *
 * - `"length"` is fatal to a quiz mark (a half-written mark ticked a question
 *   off), success-with-a-flag to chat (`truncated`, because throwing away text
 *   the reader watched arrive is worse), usually caught downstream by the four
 *   JSON callers when the object fails to parse, and unchecked in `explain`.
 * - An abandoned stream means keep-and-flag to chat, discard to quiz, keep-if-
 *   it-parses to the JSON callers.
 *
 * A shared classifier that threw on `"length"` would break six callers to fix
 * one. So this reports, and each caller `switch`es — with a `never` default, so
 * that a new member of this union is a compile error at every site rather than
 * a branch somebody forgot.
 *
 * ## One per stream, not one per request
 *
 * `converse` makes up to four requests in a turn for tool rounds and resets
 * `end` between them, so this describes **one `sseChunks` run**. Folding a
 * turn's rounds into a turn's verdict is the caller's, and has to be: a
 * `"length"` on round two means something different from one on the last round.
 */
export type StreamOutcome =
  /** `[DONE]` arrived, or the model said it had finished. */
  | { kind: "finished" }
  /** `"length"` — it ran out of room and stopped mid-sentence. */
  | { kind: "truncated" }
  /** `"content_filter"` — the provider stopped itself. */
  | { kind: "filtered" }
  /** `"tool_calls"` — it wants a tool run before it can carry on. */
  | { kind: "wants-tools" }
  /** `"error"` — the provider failed, and said so in the finish reason. */
  | { kind: "provider-failed" }
  /** The caller's own signal fired: the reader left, or asked for something else. */
  | { kind: "abandoned" }
  /** Our deadline. */
  | { kind: "timed-out" }
  /** Our stall timer — the connection is open and nothing is coming. */
  | { kind: "went-quiet" }
  /**
   * The stream stopped and nothing says why. No `[DONE]`, no finish reason: a
   * dropped connection, a killed instance. **The case the old guard was aiming
   * at**, and the only one it could ever actually catch.
   */
  | { kind: "unterminated" }
  /**
   * A finish reason nobody here has a name for — `end_turn`, `eos`, a capital,
   * whatever a future gateway sends.
   *
   * **A member of its own, and this is the correction that made the union
   * honest.** The first draft folded an unknown reason into `finished` when the
   * stream had terminated and `unterminated` when it had not, which reads as
   * tidy and is not: "an unrecognised stop is a clean one" is a *decision*, with
   * a cost on each side — accept it and one bad case behaves as before; refuse
   * it and a provider spelling `stop` differently fails every call it serves, by
   * throwing away complete replies people have already read. Quiz weighed that
   * and chose to accept; burying the same choice in the classifier would have
   * made it every caller's, invisibly, and made quiz's deny-list look like a
   * coincidence. GPT Sol's review of this plan.
   *
   * So the classifier reports the fact — here is a reason, here is whether the
   * terminator arrived — and each caller decides.
   */
  | { kind: "unknown-finish-reason"; reason: string; terminated: boolean };

/**
 * Classify one finished `sseChunks` run.
 *
 * Ours before theirs, deliberately. A deadline or a stall aborts the reader,
 * which ends the loop cleanly and leaves whatever `finish_reason` had arrived
 * standing — so asking the provider first would file our own twenty-second
 * silence as whatever the model last happened to say. `readerAborted` already
 * encodes that precedence for the reader's signal and is reused rather than
 * re-derived.
 */
export function classifyEnd(
  end: StreamEnd,
  signals: { signal: AbortSignal | undefined; deadline: AbortSignal; stalled: AbortSignal },
): StreamOutcome {
  const { signal, deadline, stalled } = signals;
  /* **The terminator beats everything, then our own clocks, then the reader,
     then what the provider said.**

     `[DONE]` is set only when `data: [DONE]` literally arrives
     (src/openrouter-stream.ts), so `terminated` is not "something the provider
     said" — it is proof that **the complete SSE response was received**. Nothing
     that happens afterwards can make it less complete, and a signal that fired
     in the gap between the terminator arriving and this function being called is
     exactly that: afterwards. The three checks below used to run first, and a
     deadline landing in that gap threw away a whole answer the reader had
     already watched appear, with *"the AI service did not finish within…"*.
     Reproduced end to end in tests/converse-stream-end.test.ts § "a terminator
     that had already arrived when our own clock fired"; found by GPT Sol,
     finding F5, 2026-09-05.

     **This does not weaken the mid-stream cases**, which are the ones the order
     below exists for. A deadline or a stall that fires while the stream is
     running aborts the reader, `sseChunks` cancels, and the loop ends *without*
     `[DONE]` — so `terminated` is false and the three checks run exactly as they
     did. The gate only lets through a stream that genuinely finished.

     **Our own clocks before the reader**, because a deadline or a stall aborts
     the reader's signal too — all three arrive as one aborted signal and only
     `readerAborted` tells them apart. Mutating that order turns three tests in
     tests/openrouter-stream.test.ts red.

     **The reader beats a `finish_reason` that has already arrived**, and that
     is a real edge worth knowing: a provider that said `error` and *then* lost
     its reader before `[DONE]` classifies as `abandoned`, so the caller applies
     its abandonment policy rather than its failure policy. Deliberate — it is
     what every caller did before this function existed, and the alternative
     asks a reader who has gone to be told off for the provider's fault. Note it
     differs from an `error` arriving as `chunk.error` *data*, which every caller
     throws on inside the loop and which therefore never reaches here.
     GPT Sol's review of Stage C, 2026-09-01. */
  if (!end.terminated) {
    if (deadline.aborted) return { kind: "timed-out" };
    if (stalled.aborted) return { kind: "went-quiet" };
    if (readerAborted(signal, deadline, stalled)) return { kind: "abandoned" };
  }
  switch (end.finishReason) {
    case "length":
      return { kind: "truncated" };
    case "content_filter":
      return { kind: "filtered" };
    case "tool_calls":
      return { kind: "wants-tools" };
    case "error":
      return { kind: "provider-failed" };
    case "stop":
      return { kind: "finished" };
  }
  /* A reason we do not have a name for is handed on as a fact, with the
     terminator beside it, rather than resolved here — see the union member. */
  if (end.finishReason) {
    return {
      kind: "unknown-finish-reason",
      reason: end.finishReason,
      terminated: end.terminated,
    };
  }
  /* Nothing said why. The terminator is all there is to go on, and that is the
     one case the guard this replaces could actually catch. */
  return end.terminated ? { kind: "finished" } : { kind: "unterminated" };
}


/** Where OpenRouter lives. One string, so nobody has a fifth copy of it. */
/* **Not exported, since 2026-08-28.** It was, and an exported base is the
   easiest way past the scan that forbids naming an OpenRouter endpoint outside
   this file: assemble the URL from the constant and the scan sees no endpoint.
   The scan is a tripwire rather than a boundary — deliberately obfuscated string
   assembly is not something a grep can catch — but leaving the pieces on the
   table is not the same as accepting that. GPT Sol asked for it twice. */
const OPENROUTER_BASE = "https://openrouter.ai/api";

/** The paths this app posts to. A union, so another cannot be invented. */
export type OpenRouterPath =
  | "/v1/chat/completions"
  | "/v1/embeddings"
  /* Pictures. `openRouterImage` below is the only thing that sends here, and
     `illustrate` is the only job routed to it. */
  | "/v1/images"
  /* Voices. `openRouterTranscription` below is the only thing that sends here,
     and `dictation` is the only job routed to it. */
  | "/v1/audio/transcriptions"
  /* Decisions — typed probabilities rather than text. `openRouterDecisions`
     below is the only thing that sends here, and `search-quick` and
     `command-pick` are the jobs routed to it. **Not under `/v1`**: OpenRouter serves it only as
     `POST /api/alpha/decisions` (spike 261002o), so the base's `/api` is all
     it shares with the others. */
  | "/alpha/decisions";

/**
 * **The jobs whose answer is a picture** — one member, and it is deliberately
 * not in `ChatJob`.
 *
 * `openRouterStream` and `openRouterJson` take a `ChatJob`; `openRouterImage`
 * takes an `ImageJob`. The route table below covers both, because there is one
 * table of "where does this go and how is it billed" and splitting it would be
 * two places for a job to be missing from. The *entry points* stay narrow, so
 * `openRouterJson("illustrate", …)` — which would post a picture request to
 * chat/completions and record it as a chat call — does not compile.
 */
export type ImageJob = "illustrate";

/**
 * **The job whose answer is a transcript** — one member, excluded from `ChatJob`
 * for the same reason `illustrate` is.
 *
 * `openRouterTranscription` takes this and nothing else takes it, so the audio
 * cannot be posted to chat/completions and recorded as a chat call. See the
 * `dictation` entry at the foot of `ChatJob` for what moved and when.
 */
export type TranscriptionJob = "dictation";

/**
 * **The jobs whose answer is a set of probabilities** — excluded from
 * `ChatJob` for `illustrate`'s reason: the Decisions answer is
 * `{answers: {<key>: {…}}}` with no `choices`, so every chat parser would
 * read it as an empty reply. `openRouterDecisions` takes these and nothing
 * else takes them. Quick search asks `noul` questions; the command bar's
 * pick asks one `choice` (since 2026-10-03, plan 261003k).
 */
export type DecisionJob = "search-quick" | "command-pick";

/** Every job with a row in `AI_JOB_ROUTE`: everything this file can send. */
export type RoutedJob = ChatJob | ImageJob | TranscriptionJob | DecisionJob;

/**
 * Where one job goes, how hard we insist on getting there, and what the ledger
 * should call it.
 *
 * **`wire` is stated, never derived.** It used to be
 * `path === "/v1/embeddings" ? "embeddings" : "chat"`, which was correct while
 * there were two paths and became a silent lie the moment there were three: an
 * image call would have been written to `ai_calls` with `wire: "chat"`, the row
 * would have been accepted, and nothing anywhere would have failed. The only
 * symptom is a `SUM(output_tokens)` that adds a plate's image tokens to a
 * paragraph's words — docs/reusable/silent-success.md, and a cross-family
 * review caught it before it shipped. `tests/ai-call.test.ts` holds this column
 * against `AI_JOB_WIRE`, which is the other, independent statement of the same
 * fact.
 */
interface Route {
  path: OpenRouterPath;
  wire: Wire;
  /**
   * OpenRouter's provider-routing block, or **`null` for "send no `provider`
   * key at all"**, which is not the same as `{}`.
   *
   * The distinction exists because of one job. Every chat row here was measured
   * on chat/completions; none of them has ever been tried against `/v1/images`,
   * and `env-proposal` below is the write-up of what an unverified field in a
   * request body costs — `require_parameters` turned a `temperature: 0` into a
   * 404 with no endpoints left, which the feature reported as "the model could
   * not be reached". The spike of 2026-09-03 got a 200 from a body with no
   * `provider` in it, so that is the body we send. Setting this to an object
   * later is a one-line change and a measurement somebody has to make first.
   */
  provider: Record<string, unknown> | null;
}

/**
 * **Where each job goes, and how hard we insist on getting there** — the two
 * things this app has been most quietly wrong about, in one row per job.
 *
 * A `Record`, exhaustive over `RoutedJob` — every job this file can send, which
 * since 2026-09-03 is the chat jobs plus the one image job — for the reason
 * [`AI_JOB_WIRE`](models.ts) gives: a job nobody assigned would otherwise
 * *work* — OpenRouter routes it somewhere, answers, and the only symptom is the
 * bill or a missing guarantee.
 *
 * `path` lives here rather than being a caller's argument because the two would
 * then be free to disagree, and an `embeddings` spend row whose call went to
 * chat/completions is wrong about the one thing a cost table is for while
 * looking entirely fine. It is checked against `AI_JOB_WIRE` by
 * [`tests/ai-call.test.ts`](../tests/ai-call.test.ts) rather than derived from
 * it, because deriving it would mean a value import and a module cycle — see the
 * note on the import above.
 *
 * The three `provider` rows that are not the obvious one, each with its reason
 * kept beside it because each was arrived at painfully:
 *
 * - **`dictation` has no `provider` block at all**, which is the strongest
 *   version of a lesson this list already taught twice. It used to have
 *   `{ zdr: true, require_parameters: true }` and no `order`, because copying
 *   the Anthropic pin onto a Gemini model would have been useless *quietly* —
 *   OpenRouter finds no Anthropic upstream, falls through to the real one, and
 *   answers. `zdr` was the load-bearing half: it was what let the copy beside
 *   the microphone say a reader's voice was not stored.
 *
 *   Since 2026-09-07 the job posts to `/v1/audio/transcriptions`, where
 *   OpenRouter does not apply routing or `zdr` at all, so the flag stopped
 *   backing that sentence and the sentence was rewritten
 *   (docs/plans/260907c-dictation-onto-an-openai-transcriber.md). The row's
 *   `null` and the measurement behind it are at the entry itself, below.
 * - **`pdf` forbids fallback outright.** Its whole request is a JSON schema, and
 *   an upstream that silently ignores one writes prose instead — a failure that
 *   looks like a model having a bad day rather than like a routing decision.
 * - **`embeddings` pins nothing.** It talks to Voyage.
 *
 * And on the three that do pin Anthropic: `order` rather than `only`, because a
 * cache miss costs money and an unavailable feature costs the reader the
 * feature. Preference, not a ban. `require_parameters` is the half that is not a
 * preference — without it a fallback may serve the request having silently
 * dropped `cache_control`, which is not a degraded answer but a full-price
 * answer that looks identical to a cheap one.
 */
export const AI_JOB_ROUTE: Record<RoutedJob, Route> = {
  chat: {
    path: "/v1/chat/completions",
    wire: "chat",
    provider: { order: ["anthropic"], require_parameters: true },
  },
  explain: {
    path: "/v1/chat/completions",
    wire: "chat",
    provider: { order: ["anthropic"], require_parameters: true },
  },
  /* ***Dig deeper*'s answer** (src/explain.ts with a `dig`, plan 261001p) —
     **explain's row exactly, and it has to be.** The request is explain's:
     the same system prompt and article part with the same breakpoint, sent
     to the high-power model, so it shares its cached prefix with a
     high-powered article's ordinary explain calls. The cache is keyed on the
     model and the prefix bytes, not on our job name — this row exists for the
     ledger — so the `order` pin that keeps explain landing on the provider
     holding its prefix must be the same here, or a dug answer would write a
     second copy of the article somewhere else. */
  "dig-deeper": {
    path: "/v1/chat/completions",
    wire: "chat",
    provider: { order: ["anthropic"], require_parameters: true },
  },
  search: {
    path: "/v1/chat/completions",
    wire: "chat",
    provider: { order: ["anthropic"], require_parameters: true },
  },
  /* **Mirror — the referee's own notes read back to them** (src/referee-mirror.ts).
     Search's shape and search's route, with one of search's two reasons and not
     the other.

     `require_parameters` carries over unchanged: it means "only upstreams that
     support the parameters actually sent", and a provider that quietly drops
     one answers something the validator then throws away as unreadable.

     The `order` pin does NOT carry over for the caching reason the entries
     above give — this is the one paying job that never sends the article, so
     there is no cached prefix here to keep landing on and no `cache_control`
     anywhere in the request. It is pinned for a different reason: this call is
     a page of instructions about what not to say, and the only evidence it
     works is a transcript read by a person (evals/referee-mirror.ts). A silent
     switch of upstream changes the thing that transcript is evidence about,
     and nothing in the answer would look any different. */
  "referee-mirror": {
    path: "/v1/chat/completions",
    wire: "chat",
    provider: { order: ["anthropic"], require_parameters: true },
  },
  /* **Hidden text's Opus check** (src/referee-hidden-check.ts): Mirror's policy
     for Mirror's reasons — no article, no cache, so the pin is about keeping
     the upstream the evidence was gathered on, and `require_parameters` so the
     schema and the reasoning setting are not quietly dropped. */
  "referee-hidden-check": {
    path: "/v1/chat/completions",
    wire: "chat",
    provider: { order: ["anthropic"], require_parameters: true },
  },
  /* **Criteria — the referee's own questions run over the paper**
     (src/referee-criteria-run.ts). Search's policy exactly, and for both of
     search's reasons rather than one:

     `order` is pinned because this call sends the whole (identity-stripped)
     article behind a `cache_control` breakpoint, and a referee works through a
     list of criteria one after another over the same paper. Landing on a
     different upstream halfway down that list pays for the article again, and
     the answer looks identical.

     `require_parameters` is the half that is not a preference: a fallback that
     silently dropped `cache_control` gives a full-price answer indistinguishable
     from a cheap one, and on a `literature` criterion it would drop the web
     search tool instead — which is worse, because the model then answers from
     memory, cites nothing, and `validateResults` throws every uncited result
     away. An empty panel is what a referee would see, and nothing would say the
     tool never ran. */
  "referee-criteria": {
    path: "/v1/chat/completions",
    wire: "chat",
    provider: { order: ["anthropic"], require_parameters: true },
  },
  /* **Claims — what the paper says about itself, and where it takes it up**
     (src/referee-claims-run.ts). Criteria's policy, and the caching half of it
     is stronger here rather than weaker.

     `order` is pinned because this call sends the whole (identity-stripped)
     article behind the *same* `cache_control` breakpoint a criterion run sends —
     byte for byte, because both render `articleWithIds(meta, blocks,
     "anonymous")` as the first content part and nothing else. A referee who
     pulls the claims and then works down a list of criteria over the same paper
     is landing on one cached prefix all afternoon, and a different upstream
     halfway through pays for the paper again while the answer looks identical.

     `require_parameters` is the half that is not a preference: a fallback that
     silently dropped `cache_control` gives a full-price answer indistinguishable
     from a cheap one, and this is the largest single prompt in the mode. */
  "referee-claims": {
    path: "/v1/chat/completions",
    wire: "chat",
    provider: { order: ["anthropic"], require_parameters: true },
  },
  /* **Candidates — who could review this paper, for an editor**
     (src/converse.ts, on `ThreadKind` `"candidates"`). Chat's policy exactly,
     because it *is* chat's call with a third system prompt — but the second half
     of that policy is load-bearing here in a way it is not for chat.

     `order` is pinned for chat's reason: the paper sits behind a `cache_control`
     breakpoint and a conversation is many turns over one paper, so a different
     upstream mid-conversation pays for the paper again and the answer looks
     identical.

     `require_parameters` is the one that matters. This turn sends
     `openrouter:web_search`, and a fallback that silently dropped it leaves a
     model answering from memory — which is not an empty panel but a *full* one,
     of plausible names with no citations behind them. `readShortlist` then drops
     every row for being uncited (src/referee-candidates.ts, rule 1), so the
     editor sees "the model named people and none of them could be shown" and
     nothing anywhere says the search tool was never offered. */
  "referee-candidates": {
    path: "/v1/chat/completions",
    wire: "chat",
    provider: { order: ["anthropic"], require_parameters: true },
  },
  /* **The second look at a PDF's front matter** (src/pdf-frontmatter.ts).

     `require_parameters` is the half that is load-bearing: the whole answer is
     a JSON schema of three id lists, and an upstream that quietly ignored
     `response_format` writes prose instead — which `parseAnswer` throws away,
     so the article silently keeps whatever title the ladder would have given
     it. That is a paid call with no effect and nothing saying so.

     `order` is pinned for consistency with the rest of the chat wire rather
     than for caching: this call sends three pages of records and no
     `cache_control`, so there is no prefix here to keep landing on. */
  "pdf-frontmatter": {
    path: "/v1/chat/completions",
    wire: "chat",
    provider: { order: ["anthropic"], require_parameters: true },
  },
  /* **Debate — what the rest of the web says about this piece** (src/debate.ts).
     `referee-candidates`' policy, and its `require_parameters` argument holds
     here with the volume turned up.

     This is the only *pipeline step* that sends `openrouter:web_search`, and a
     fallback that silently dropped it leaves a model answering from memory —
     which is not an empty panel but a **full** one, of plausible pages with no
     annotation behind any of them. Every rule in `readGroup` then drops every
     row as `uncited`, so a reader sees "the search returned nothing it could
     verify" and nothing anywhere says the tool was never offered. That is the
     failure `referee-candidates` already wrote down; here it costs up to $0.27
     rather than a turn of a conversation.

     `order` is pinned for consistency with the rest of this wire rather than
     for caching: neither pass sends `cache_control`, so there is no prefix here
     to keep landing on. The two passes are one request each, minutes apart from
     the next article's. */
  debate: {
    path: "/v1/chat/completions",
    wire: "chat",
    provider: { order: ["anthropic"], require_parameters: true },
  },
  /* The same policy as `explain` and for the same two reasons. The upstream is
     pinned so that a reader working through a batch of questions keeps hitting
     the cached article rather than paying for it once per answer; and
     `require_parameters` is what stops a fallback serving the request having
     silently dropped `cache_control`, which is a full-price answer that looks
     exactly like a cheap one. */
  "quiz-mark": {
    path: "/v1/chat/completions",
    wire: "chat",
    provider: { order: ["anthropic"], require_parameters: true },
  },
  /* **No `order`, exactly like `link-summary` above and for its reason.** The
     app's other quick-tier job, pointed at an OpenAI model, and an Anthropic pin
     here would not merely be useless but wrong *quietly*: OpenRouter would find
     no Anthropic upstream, fall through to the real one, and answer anyway — a
     line of configuration that reads as a guarantee and enforces nothing.

     `require_parameters` is kept, and it is doing less here than it does for the
     two rows above: this job sends no `cache_control`, because it never sends
     the article, so there is no cached prefix a fallback could silently drop. It
     stays because a provider that cannot honour the token ceiling on a job whose
     whole contract is "one word" should not serve it. */
  "quiz-verdict": {
    path: "/v1/chat/completions",
    wire: "chat",
    provider: { require_parameters: true },
  },
  /* **The Luna summary of where a hyperlink goes** (src/link-summary.ts) — a
     quick-tier job with **no `order`**, and the first of the two; `quiz-verdict`
     above joined it on 2026-09-07 and copies this row's reasoning.

     `dictation`'s argument, one row down, applies exactly: the Anthropic pin
     exists so repeat calls land on a cached prefix, and pointed at an OpenAI
     model it is not merely useless but wrong *quietly* — OpenRouter finds no
     Anthropic upstream, falls through to the real one, and answers. There is no
     cached prefix here either: every summary is a different destination, a
     different paragraph and a different reader.

     **`require_parameters` is kept, and it is the half that matters.** The
     request sends `max_completion_tokens` — the spelling this model advertises,
     rather than the deprecated `max_tokens` every other chat caller here sends —
     and `reasoning: { effort: "low" }`. An upstream that quietly dropped either
     would answer at full reasoning with no ceiling: a summary that costs several
     times what it should and arrives late, with nothing at all looking wrong.
     That is `pdf`'s reason with money instead of a schema. Its teeth are real —
     see `env-proposal` below, where an unsupported `temperature` became a 404 —
     so anything added to this body needs checking against Luna's upstreams
     first. */
  "link-summary": {
    path: "/v1/chat/completions",
    wire: "chat",
    provider: { require_parameters: true },
  },
  /* **Simple's fidelity guard** (src/simple-check.ts) — `link-summary`'s row,
     because it is the request plan 261001h measured, sent through that route.
     The same two reasons: no `order` on a quick-tier OpenAI model, and
     `require_parameters` so an upstream cannot quietly drop the token ceiling
     or the low effort. */
  "simple-check": {
    path: "/v1/chat/completions",
    wire: "chat",
    provider: { require_parameters: true },
  },
  /* ***Dig deeper*'s forced search** (src/dig-deeper.ts) — `link-summary`'s
     row, for both of its reasons: no `order`, because this is a quick-tier
     OpenAI model and the Anthropic pin is wrong quietly there, and no cached
     prefix to keep; and `require_parameters`, which here guards the point of
     the call. An upstream that dropped `tool_choice` would let the model skip
     the search, and one that dropped the Exa tool would answer from memory —
     both caught downstream by the search-count witness, but only as a refusal
     the reader sees, where this makes them a routing choice instead. */
  "dig-deeper-search": {
    path: "/v1/chat/completions",
    wire: "chat",
    provider: { require_parameters: true },
  },
  /* **Find one cited work's own page** (src/citation-find.ts). `debate`'s
     policy and its reason: the request sends `openrouter:web_search`, and a
     fallback that silently dropped the tool leaves a model answering from
     memory. Here that is caught rather than shown — no annotation, nothing
     kept — but the reader would be told "no page matched" for a search that
     never ran, which `require_parameters` is what prevents. `order` for
     consistency with this wire; there is no `cache_control` to keep. */
  "citations-find": {
    path: "/v1/chat/completions",
    wire: "chat",
    provider: { order: ["anthropic"], require_parameters: true },
  },
  /* **An uploaded paper looking for its own page** (src/source-guess.ts) — the
     same request as `citations-find` through the same `findWorkPage`, so the
     same policy for the same reason. */
  "upload-source-guess": {
    path: "/v1/chat/completions",
    wire: "chat",
    provider: { order: ["anthropic"], require_parameters: true },
  },
  /* **Citations' *Investigate*** (src/citation-investigate.ts) — explain's
     route and both of its reasons: the article is a cached first part, so the
     `order` pin keeps it landing on the prefix it wrote, and the request pins
     Exa and `max_characters` on the search tool, which an upstream that
     dropped them would answer without. */
  "citation-investigate": {
    path: "/v1/chat/completions",
    wire: "chat",
    provider: { order: ["anthropic"], require_parameters: true },
  },
  /* **A cited paper's passages, picked** (src/citation-paper-passages.ts) —
     the press's own route, for consistency with the two calls around it. No
     tools and no cache marker, so nothing here depends on `require_parameters`
     beyond `max_tokens`; kept so an upstream that would drop a parameter is
     refused rather than answering differently. */
  "citation-paper-passages": {
    path: "/v1/chat/completions",
    wire: "chat",
    provider: { order: ["anthropic"], require_parameters: true },
  },
  /* **A cited work's influence, from the press's own search results**
     (src/citation-influence.ts) — the passages call's route for the passages
     call's reason. `require_parameters` matters here: the answer is read
     through a strict `response_format`, and an upstream that dropped it would
     answer in prose. */
  "citation-influence": {
    path: "/v1/chat/completions",
    wire: "chat",
    provider: { order: ["anthropic"], require_parameters: true },
  },
  /* **The one job with no `provider` block, and it used to be the one job whose
     `provider` block mattered most.**

     It was `{ zdr: true, require_parameters: true }`, and the comment above
     called `zdr` load-bearing: it is what let the copy beside the microphone
     promise a reader's voice was not stored. Dictation moved to
     `/v1/audio/transcriptions` on 2026-09-07 (docs/plans/260907c-…), and
     **OpenRouter does not apply routing on that endpoint.** Not refuses —
     ignores:

       provider: {"only":["anthropic"]}        200, with a transcript
       provider: {"zdr":true}                  200, for a model that is absent
                                               from GET /api/v1/endpoints/zdr

     Their STT guide says as much of `order`, `only` and `ignore`, and is silent
     on `zdr`; the second line above is what settles `zdr`, because an enforced
     flag would 404 there exactly as it does on the chat endpoint. So `null`
     rather than `{}`: a routing constraint nobody reads is worse than none,
     because it sits here looking like a guarantee and a reader's privacy page
     gets written from it. `evals/dictation/probe-stt-routes.ts` re-runs both
     rows.

     **"The provider block is ignored" would be too strong, and this row used to
     say it.** What is ignored is *routing* — `order`, `only`, `ignore`, `zdr`.
     `provider.options` is forwarded, and has to be: it is the channel the
     vocabulary travels down, and `outgoingTranscription` builds one there on
     every call that has words to send. The two live in the same object and are
     treated completely differently by the far end, which is worth knowing
     before adding anything to either. GPT Sol's review of the built code.

     `require_parameters` goes for a plainer reason — there are no parameters
     left to require. The JSON schema went with the chat endpoint. */
  dictation: {
    path: "/v1/audio/transcriptions",
    wire: "transcription",
    provider: null,
  },
  /* **Quick search** (src/quick-search.ts, plan 261002e). No `provider` block,
     for `dictation`'s reason in a stronger form: Jev has one upstream
     (TypeSafe), nothing here is cached, and the alpha endpoint has never been
     measured with routing keys in its body — the request the spike measured
     5,000 times carried `model`, `state` and `questions` and nothing else.
     An unmeasured key is the `env-proposal` lesson waiting to happen. */
  "search-quick": {
    path: "/alpha/decisions",
    wire: "decisions",
    provider: null,
  },
  /* **The command bar's sentence, picked** (src/command-pick-call.ts, plan
     261003k). `search-quick`'s row for its reason: the eval's 600-odd calls
     carried `model`, `state` and `questions` and nothing else. */
  "command-pick": {
    path: "/alpha/decisions",
    wire: "decisions",
    provider: null,
  },
  /* **And its words, copied out** by the quick tier's model. The policy the
     eval's `luna` arm was measured with (evals/command-pick/run.ts §
     `CHAT_ARMS`), and nothing more: an upstream that dropped `reasoning` or
     `response_format` would think for a second or answer in prose. No
     `order`: nothing here is cached. */
  "command-pick-words": {
    path: "/v1/chat/completions",
    wire: "chat",
    provider: { require_parameters: true },
  },
  /* **The bar's short list from why you are reading** (src/command-suggest-call.ts,
     plan 261005k). `command-pick-words`'s policy for its reason: the answer
     is a strict JSON schema with reasoning off, and an upstream that dropped
     either would answer in prose or think while the reader watches the bar.
     No `order`: nothing here is cached. */
  "command-suggest": {
    path: "/v1/chat/completions",
    wire: "chat",
    provider: { require_parameters: true },
  },
  /* **A question asked on the Help pages** (src/help-chat-call.ts, plan
     261007k) — **the first quick-tier job with a prefix worth caching**, so
     the first OpenAI-model row with an `order`, and the reasoning is the
     opposite of `link-summary`'s for that reason.

     Every request carries the whole Help, about 28k tokens of system prompt
     that is byte-identical across every reader and every question; only the
     last user message differs. On `HELP_CHAT_MODEL` (an OpenAI model) the
     cache is **OpenAI's automatic prefix cache**: no `cache_control` marker
     (that is Anthropic's mechanism, and docs/project/prompt-caching.md's rule
     is about explicit breakpoints), a 1,024-token floor this clears many
     times over, and a read billed at a fraction of input. A cache lives on the
     upstream that wrote it (prompt-caching.md § What breaks a cache, 6), so
     `order: ["openai"]` prefers OpenAI's own endpoint, where the prefix is
     most likely warm, over any other upstream OpenRouter might pick.

     - **`order`, not `only`**, for the house reason: a cache miss costs money,
       an unavailable Help box costs the reader the feature.
     - **`require_parameters`**, for `link-summary`'s reason: the body sends
       `max_completion_tokens` and reasoning `none`, and an upstream that
       dropped either would think at length with no ceiling.
     - **No `prompt_cache_key` and no `session_id`.** Either might steer
       routing towards a warm machine, and neither has been sent through this
       gateway before; an unmeasured key is `env-proposal`'s lesson. OpenRouter's
       sticky routing keys on the first system *and* first user message, so it
       is no help here either: the user message is the question.

     **Measured on 2026-10-07**
     (docs/investigations/261007b-help-chat-model-and-refusals.md): every
     call landed on OpenAI, and every call after the first read ~26,750 cached
     tokens whatever the question, still warm after 12 minutes of quiet; cold
     $0.0068 (the write is billed at 1.25x input), warm $0.0006. The global
     fuse is still sized from the cold cost, so a cache that stops reading costs
     money, not safety. */
  "help-chat": {
    path: "/v1/chat/completions",
    wire: "chat",
    provider: { order: ["openai"], require_parameters: true },
  },
  pdf: {
    path: "/v1/chat/completions",
    wire: "chat",
    provider: { require_parameters: true, allow_fallbacks: false },
  },
  /* **A refused PDF figure, located** (src/pdf-figure-locate.ts). The PDF
     reader's policy, for its reason: the answer is a strict JSON schema, and an
     upstream that dropped `response_format` would answer in prose that the
     judge then refuses as unreadable — a figure lost, and money spent, with
     nothing to say why. No `order`: nothing here is cached. */
  "pdf-figure-locate": {
    path: "/v1/chat/completions",
    wire: "chat",
    provider: { require_parameters: true, allow_fallbacks: false },
  },
  /* **The shelf's topics, scored** (src/shelf-terms/model-scores.ts). The same
     policy as the eval row that chose the model, and `pdf-figure-locate`'s
     reason: the answer is a strict JSON schema, and an upstream that dropped
     `response_format` or `max_completion_tokens` would answer in a shape the
     parser refuses — money spent and the reader left on the program's list,
     with nothing to say why. No `order`: an OpenAI model, and nothing cached. */
  "shelf-topics": {
    path: "/v1/chat/completions",
    wire: "chat",
    provider: { require_parameters: true, allow_fallbacks: false },
  },
  /* **A batch-added paper's title, authors and abstract**
     (src/paper-metadata.ts) — the one row that names its upstreams with `only`,
     because the reason is a promise about retention rather than a cache.

     Greg asked for this job to run "via a ZDR provider, e.g. Fireworks", and
     what it sends is the first two pages of a paper a reader uploaded.

     - `zdr: true` restricts every endpoint considered, fallbacks included, to
       OpenRouter's zero-retention list (provider-routing docs, read
       2026-10-01: "the request will only be routed to endpoints that have a
       Zero Data Retention policy").
     - `only` is the whitelist and `order` the preference within it, so
       fallbacks go down this list and nowhere else. All three were on the ZDR
       list for `deepseek/deepseek-v4.1-flash` on 2026-10-01, all three
       advertise `response_format` and `structured_outputs`, and none is an fp4
       endpoint (DeepInfra's is fp8; Fireworks and Together state no
       quantisation). A base slug matches every endpoint of that provider, so
       `fireworks` includes `fireworks/us`, which is also ZDR. No
       `quantizations` filter: the whitelist already excludes the fp4 ones, and
       a whitelist of quantisations would drop the two that state none.
     - **`allow_fallbacks: true`, and it was `false`.** Fireworks alone was
       measured on 2026-10-01: its shared pool answered 429
       (`limit_source: upstream_provider_shared_pool`) on 8 of 39 papers at two
       in flight, and one paper failed after six retries
       (evals/results/paper-metadata-2026-10-01.md).
     - `require_parameters` for `pdf-figure-locate`'s reason: the answer is a
       strict JSON schema, and an upstream that dropped `response_format`
       would answer in a shape the parser refuses.

     The gateway never retries a 429 (`worthAskingAgain`); a refusal that survives
     the fallbacks reaches the caller as `ProviderRefused`, and the job layer
     decides whether to try again. tests/paper-metadata.test.ts asserts these
     bytes on the wire. */
  "paper-metadata": {
    path: "/v1/chat/completions",
    wire: "chat",
    provider: {
      order: ["fireworks", "deepinfra", "together"],
      only: ["fireworks", "deepinfra", "together"],
      zdr: true,
      require_parameters: true,
      allow_fallbacks: true,
    },
  },
  /* **How hard a piece is to read** (src/reading-difficulty.ts) — the same
     model as `paper-metadata` and the same promise, for the same reason: what
     it sends is up to about 3,000 words of an article a reader added. Every
     field is `paper-metadata`'s and that row says why each is what it is.
     Written out, not shared through a constant, so a change to one job's
     route is a decision about that job. tests/reading-difficulty.test.ts
     asserts these bytes on the wire. */
  "reading-difficulty": {
    path: "/v1/chat/completions",
    wire: "chat",
    provider: {
      order: ["fireworks", "deepinfra", "together"],
      only: ["fireworks", "deepinfra", "together"],
      zdr: true,
      require_parameters: true,
      allow_fallbacks: true,
    },
  },
  /* **An imported title, lightly tidied** (src/title-tidy-model.ts).
     `paper-metadata`'s route above, copied for its reasons: what it sends is
     the title of something a reader may have uploaded, so every endpoint is a
     zero-retention one, and the answer is a strict JSON schema. A refusal that
     survives the fallbacks costs nothing but the model's tidy: the caller
     falls back to the rule. */
  "title-tidy": {
    path: "/v1/chat/completions",
    wire: "chat",
    provider: {
      order: ["fireworks", "deepinfra", "together"],
      only: ["fireworks", "deepinfra", "together"],
      zdr: true,
      require_parameters: true,
      allow_fallbacks: true,
    },
  },
  /* **A conversation's one-line gist** (src/chat-gist.ts). `title-tidy`'s
     route, copied for a sharper reason: what it sends is the reader's own
     conversation, so every endpoint is a zero-retention one. A refusal costs
     the gist and nothing else: the index shows the title alone. */
  "chat-gist": {
    path: "/v1/chat/completions",
    wire: "chat",
    provider: {
      order: ["fireworks", "deepinfra", "together"],
      only: ["fireworks", "deepinfra", "together"],
      zdr: true,
      require_parameters: true,
      allow_fallbacks: true,
    },
  },
  embeddings: { path: "/v1/embeddings", wire: "embeddings", provider: {} },
  /* **Forbids fallback — and my first reason for it was wrong.** I wrote that a
     silent fallback would substitute a different *model*; GPT Sol corrected it:
     provider fallback picks a different **upstream** for the model you asked
     for, and without `order` or `only` the first one is load-balanced anyway.
     The real reason is narrower and still good: an eval reports a latency and a
     quality number, both of which vary by upstream, so a silent backup attempt
     makes a number belong to a provider the write-up never names.
     `require_parameters` is the load-bearing half — it means "only upstreams
     that support the parameters actually sent", and a provider that quietly
     drops a JSON schema answers with prose, which every eval here scores as the
     model having a bad day. */
  eval: {
    path: "/v1/chat/completions",
    wire: "chat",
    provider: { require_parameters: true, allow_fallbacks: false },
  },
  /* **`gjd-remote push-env`'s key-name classifier** — the only call in the app
     whose whole input is a list of variable *names*
     (scripts/gjd-remote-envpolicy.ts). Two cents, once per repo.

     **No `order`, deliberately.** The three Anthropic pins above exist to keep
     repeat calls landing on one cached prefix; there is nothing cached here.
     One call, a few dozen short names, thrown away afterwards. Copying a pin
     onto it would be the `dictation` mistake with a different model: a
     preference that buys nothing and reads as though it bought something.

     **`require_parameters` is kept**, and it is not a pin — it means "only
     upstreams that support the parameters actually sent". The request asks for
     `response_format: {type: "json_object"}`, and an upstream that quietly
     dropped it answers prose. `parseProposal` fails closed on that, so nothing
     unsafe happens; what happens instead is that every key comes back
     unclassified with no explanation, which reads like the model having a bad
     day rather than like a routing decision. Same reasoning as `pdf`, one
     notch weaker, because here a wrong answer costs a nicety rather than a
     feature.

     **It also has teeth this table has not had before, and they drew blood.**
     `require_parameters` turns an unsupported parameter from a silent no-op
     into a hard 404 with no endpoints left: a `temperature: 0` in the request
     body made every call fail that way, and the feature reported it as "the
     model could not be reached". Anything added to that body has to be checked
     against the chosen model's upstreams first —
     docs/investigations/260902b-env-key-proposal-spike.md. */
  "env-proposal": {
    path: "/v1/chat/completions",
    wire: "chat",
    provider: { require_parameters: true },
  },
  /* **The one row that is not a chat completion.** `openRouterImage` sends it;
     `openRouterStream` and `openRouterJson` cannot, because `illustrate` is not
     a `ChatJob`.

     `provider: null` — no routing block at all, rather than an empty one. The
     reason is directly above, on `Route.provider`: nothing in that column has
     been measured against this endpoint, the spike that proved the endpoint
     works sent no `provider` key, and `env-proposal` two rows up is this repo's
     write-up of what an unverified body field costs.

     `wire: "images"` is why this table has a `wire` column at all. Derived from
     the path, this row would have said `"chat"`. */
  illustrate: {
    path: "/v1/images",
    wire: "images",
    provider: null,
  },
};

/** The values OpenRouter's chat wire takes for `reasoning.effort` (docs/project/ai-gateway.md). */
export type ReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

/**
 * How hard a chat job's model thinks: a named effort, or the provider's
 * default with the reason nobody has chosen one.
 *
 * A union rather than an optional field, so "decided to leave it" and "never
 * thought about it" cannot be the same value.
 */
export type ReasoningDecision =
  | { readonly effort: ReasoningEffort }
  | { readonly providerDefault: string };

/**
 * **How hard each chat job thinks — decided here, for every job, and sent from
 * here.**
 *
 * `max_tokens` covers the model's thinking as well as its answer, and every
 * capable-tier model this app sends thinks by default, for as long as it likes,
 * more on a longer input. A ceiling sized for the answer alone is therefore a
 * ceiling the thinking can spend first. The pipeline learned that on 2026-08-25
 * (docs/postmortems/260826a-toc-max-tokens.md) and wrote it into
 * src/token-budget.ts — which nothing on this wire imports, so Referee Claims,
 * built a week later with a 12,000 ceiling sized for its JSON, failed on every
 * long paper it was given
 * (docs/postmortems/260928b-a-lesson-kept-in-a-helper-does-not-reach-the-other-wire.md).
 *
 * So the decision lives at the seam every chat call passes through, where it
 * cannot be absent: **exhaustive over `ChatJob`**, so a new job does not compile
 * until somebody has written down how hard it thinks, and **`outgoing` sends
 * it**, after the caller's body, which is forbidden from carrying its own
 * (`AiRequestBody.reasoning` is `never`). A caller sizing its `max_tokens`
 * reads its row here.
 *
 * `providerDefault` is a legitimate answer and most rows give it: it is what
 * every one of them sent before this table existed, so writing it down changed
 * nothing any reader sees. Its string is the reason, and "nothing has failed" is
 * a weaker reason than a measurement — say which.
 *
 * `openRouterStream` warns, with the job, when a stream stops on `length`
 * having spent reasoning tokens: the log line that would have named the claims
 * bug the first time it happened.
 */
export const CHAT_REASONING: Record<ChatJob, ReasoningDecision> = {
  chat: {
    providerDefault:
      "Not measured. A turn can run several tool rounds, each with its own ceiling; " +
      "the empty-answer log records each round's finish reason (docs/project/chat-tools.md).",
  },
  explain: {
    providerDefault:
      "Not measured, and the tightest ceiling of the whole-article calls (src/explain.ts). " +
      "Nothing has failed that we know of; the length warning below is what would say so.",
  },
  /* Explain's decision, because it is explain's call. On the high-power model
     a `providerDefault` row is sent as `high` (`wireEffort` below). */
  "dig-deeper": {
    providerDefault:
      "Explain's call on the high-power model, so `high` on the wire (wireEffort). Not measured; " +
      "a probe ran out at explain's 1,500, hence src/dig-deeper.ts § DIG_ANSWER_TOKENS.",
  },
  search: {
    providerDefault:
      "Measured 2026-09-28 on an 8,290-word essay: 44 and 194 thinking tokens against a " +
      "4,000 ceiling, about 30% used (docs/plans/260928c-referee-claims-fail-on-long-pieces.md).",
  },
  "referee-mirror": {
    providerDefault:
      "Not measured. It reads the referee's own comments and their passages, never the " +
      "whole paper, so its input does not grow with the article.",
  },
  /* Not measured. `medium` rather than Opus's default `high`: one short
     judgment per row needs some thought about a fragment that may be trying
     to fool it, not an essay of it, and src/referee-hidden-check.ts §
     `outputTokensFor` sizes its ceiling as twice the answer for that share. */
  "referee-hidden-check": { effort: "medium" },
  /* Measured 2026-09-28 on an 8,290-word essay: unleashed, a `single` criterion
     thought for 1,349–1,558 tokens and used 85–94% of its 4,000; at `medium` it
     thought for none, answered in 19s against 35–39s, and returned as many
     results. docs/plans/260928c-referee-claims-fail-on-long-pieces.md, and
     src/referee-criteria-run.ts for the budget sized with it. */
  "referee-criteria": { effort: "medium" },
  /* The job this table was written for. Unleashed, on an 8,290-word essay,
     8,000–13,000 thinking tokens, 113–160s, and on one run all 12,000 of the
     old ceiling with nothing written. At `medium`: none on that essay, 1,207 on
     a short synthetic paper, answers in about 50s. `low` lost a passage to a
     paraphrased quote. src/referee-claims-run.ts sizes its budget with this. */
  "referee-claims": { effort: "medium" },
  "referee-candidates": {
    providerDefault:
      "Not measured. A chat personality (src/converse.ts) that weighs web search results, " +
      "where thinking is the job; its ceiling is 12,000.",
  },
  "pdf-frontmatter": {
    providerDefault: "Not measured. Reads a PDF's first pages, not the whole paper.",
  },
  debate: {
    providerDefault:
      "Not measured. Weighs web search results against the article, where thinking is the job; " +
      "its answer ceiling is src/debate.ts § ANSWER_TOKENS.",
  },
  "quiz-mark": {
    providerDefault:
      "Not measured. A short mark against a whole-article prompt; a cut-off mark is refused " +
      "rather than shown (src/quiz-mark.ts § MARK_CUT_OFF).",
  },
  "quiz-verdict": {
    providerDefault: "Not measured. One word out, on the quick tier.",
  },
  /* Greg's choice for this job, 2026-09-05 — src/link-summary.ts § the request
     says why, and that the documented 1,024-token floor means even `low` buys
     a thousand tokens of thinking. Sent from here since 2026-09-28. */
  "link-summary": { effort: "low" },
  /* The effort plan 261001h measured at, through `link-summary`'s row: a
     verdict per paragraph, not a piece of writing. */
  "simple-check": { effort: "low" },
  /* Low: it writes a search and a one-line keyword query. The reasoning floor
     (`link-summary`'s note) still buys about a thousand tokens of thinking;
     src/dig-deeper.ts § DIG_SEARCH_MAX_TOKENS is sized clear of it. */
  "dig-deeper-search": { effort: "low" },
  "citations-find": {
    providerDefault: "Not measured. One cited work and a web search, not the article.",
  },
  "upload-source-guess": {
    providerDefault: "Not measured. One uploaded paper's title and a web search, not the article.",
  },
  "citation-investigate": {
    providerDefault:
      "Not measured. Explain's shape over the whole article with a few web searches; " +
      "its ceiling is src/citation-investigate.ts § ANSWER_TOKENS.",
  },
  "citation-paper-passages": {
    providerDefault:
      "Not measured. About 5,000 words of one paper and one claim, three short quotes out; " +
      "its ceiling is src/citation-paper-passages.ts § PASSAGES_ANSWER_TOKENS.",
  },
  "citation-influence": {
    providerDefault:
      "Not measured. Up to five search extracts and one work's title, a number and a short quote out; " +
      "its ceiling is src/citation-influence.ts § INFLUENCE_ANSWER_TOKENS.",
  },
  pdf: {
    providerDefault:
      "Not measured on this wire's terms. Reads a whole PDF into structured blocks with a " +
      "16,000 ceiling (src/pdf-read.ts).",
  },
  "pdf-figure-locate": {
    providerDefault: "Not measured. One page image, not the article.",
  },
  /* Left at the default because the default is what the eval measured and
     judged: 27 calls, 330–1,650 reasoning tokens, 6–20 s, ~$0.001. Nobody
     waits on it — the program's list is sent first — so `low` would buy
     seconds nobody sees at a quality nobody has measured.
     docs/plans/260929c-shelf-topics-chosen-by-a-model.md § Stage 1. */
  "shelf-topics": {
    providerDefault:
      "Measured 2026-09-29 by the eval that chose the model: 330–1,650 reasoning tokens, " +
      "6–20 s, ~$0.001 a call (plan 260929c). Unmeasured at any named effort.",
  },
  /* Copying four fields off a page needs no thinking. Probed 2026-10-01 on
     Fireworks: the default spent ~230 reasoning tokens and ~4 s on a toy page,
     `none` spent 0 and answered in ~0.9 s, for half the cost. The eval that
     judged DeepSeek against Luna ran at this setting:
     evals/results/paper-metadata-2026-10-01.md. */
  "paper-metadata": { effort: "none" },
  /* Two numbers and a sentence, with a 300-token answer ceiling that thinking
     would spend before the answer began. `none` is `paper-metadata`'s setting
     on the same model, and the one the ratings were measured at:
     evals/reading-time-difficulty/rate.ts. */
  "reading-difficulty": { effort: "none" },
  /* Recasing one line needs no thinking, and import waits on it. The setting
     the eval ran at:
     docs/investigations/261005b-title-tidying-rule-against-a-small-model.md. */
  "title-tidy": { effort: "none" },
  /* One line describing a conversation. Nobody waits on it, but thinking
     would spend the 300-token ceiling before the answer began. */
  "chat-gist": { effort: "none" },
  /* Copying two words out of one sentence needs no thinking, and the reader
     is watching the bar. The setting every chat arm of the eval ran at, with
     no reasoning token spent on any of 600 answers
     (docs/investigations/261003e-which-fast-model-turns-a-sentence-into-a-command-and-its-argument.md). */
  "command-pick-words": { effort: "none" },
  /* A handful of short items from two short lines, with the reader watching
     the bar. The setting the eval ran at
     (docs/investigations/261005b-does-the-command-bar-suggest-useful-searches-from-why-you-are-reading.md). */
  "command-suggest": { effort: "none" },
  /* Finding the right Help page and saying what it says, with the reader
     watching the box. `command-suggest`'s setting on the same model; whether
     a little thinking would buy better answers was not measured, because at
     `none` the eval found nothing for it to fix
     (docs/investigations/261007b-help-chat-model-and-refusals.md): every
     refusal held and the answers kept to the pages, so the ceiling of 800
     tokens stays all answer. */
  "help-chat": { effort: "none" },
  eval: {
    providerDefault:
      "Through the gateway an eval call takes the provider default. An eval comparing efforts " +
      "posts its own request (evals/structure-whole-document/model-arms.ts § chatBody), not via here.",
  },
  embeddings: {
    providerDefault: "An embedding model, which does not think; there is nothing to decide.",
  },
  "env-proposal": {
    providerDefault: "Not measured. A short proposal from a short prompt.",
  },
};

/**
 * The effort a job's row names, or `null` for a `providerDefault` row — for a
 * caller sizing its `max_tokens` against what will actually be sent.
 */
export function effortOf(job: ChatJob): ReasoningEffort | null {
  const row = CHAT_REASONING[job];
  return "effort" in row ? row.effort : null;
}

/**
 * **The effort that goes on the wire for this job and this model** — the row's,
 * except that a `providerDefault` row sent to the high-power model gets `high`.
 *
 * Opus 5.5's default effort is `medium` where Sonnet 5's is `high`, so leaving
 * the default in place would make High-powered AI think *less* on every
 * provider-default job — explain, chat, search, debate, citations, quiz marking —
 * which is the opposite of the switch's promise. `high` is Sonnet's own
 * default, so no ceiling sized against Sonnet is asked for more than it was.
 * Keyed on the model sent, because the reason is that model's default. Plan
 * 260930f decision 1, Sol F2.
 */
export function wireEffort(job: ChatJob, model: unknown): ReasoningEffort | null {
  const row = CHAT_REASONING[job];
  if ("effort" in row) return row.effort;
  return typeof model === "string" && isHighPowerModel(model) ? "high" : null;
}

/**
 * Which path a job posts to.
 *
 * **The `undefined` check is not defensive noise.** `ChatJob` excludes the eight
 * pipeline stages, so in typed code this cannot miss — but `AiJob` is a wider
 * type that flows in from stored rows and from `Object.keys`, and a `"labels"`
 * arriving here would otherwise read `undefined.path` and throw a `TypeError`
 * about a property, which says nothing about what actually went wrong. Those
 * eight go through [`streamMessage`](messages-stream.ts); the message says so.
 * Found by the test for it, which asserted the sentence and got the `TypeError`.
 */
export function pathFor(job: ChatJob): OpenRouterPath {
  return routeFor(job).path;
}

/**
 * The jobs that come down this wire — everything that is not a pipeline stage.
 *
 * **Hand-written, and it is the one list a new pipeline stage has to be added
 * to by hand.** `TASK_WIRE` in src/models.ts already knows which tasks speak
 * `"messages"`, but it is a value and this is a type, so nothing derives one
 * from the other. Leave a stage out and `AI_JOB_ROUTE` below demands a route
 * for a job that will never post to OpenRouter — which is at least a compile
 * error, and is how `timeline` was added on 2026-08-31.
 */
export type ChatJob = Exclude<
  AiJob,
  | "structure"
  | "labels"
  | "arc"
  | "tweets"
  | "glossary"
  | "quotes"
  | "ideas"
  | "sketch"
  | "timeline"
  | "citations"
  /* **The brief, not the plate.** `illustrated` writes the words an image model
     draws from and goes down the Messages wire like every other article-reading
     stage; `illustrate` two entries below is the picture itself, excluded for a
     different reason. Two jobs, one feature, and the pair is the reason both
     names appear in this list — src/illustrated.ts. */
  | "illustrated"
  /* Generation only. `quiz-mark` is a separate `Task` and stays IN — it is a
     request-path call on chat/completions and needs a route below. */
  | "quiz"
  | "faq"
  /* Generation, on the Messages wire like `faq`. src/relations.ts. */
  | "relations"
  /* Generation, on the Messages wire like `faq`. src/skim.ts. */
  | "skim"
  /* Generation, on the Messages wire like `faq`. src/crossrefs.ts. */
  | "crossrefs"
  /* Generation, on the Messages wire like `faq`. src/simple-summary.ts. */
  | "simple"
  /* **Not a pipeline stage, and still not on this wire.** A live session is a
     WebRTC connection the browser holds open to OpenAI; this file never sends
     it anything and never sees a response, so there is no OpenRouter path to
     route it to and `AI_JOB_ROUTE` must not demand one. It was the compile
     error above that made this the third reason a job is excluded here rather
     than the second, which is the type doing exactly what the docstring says.
     src/live.ts, and docs/project/ai-gateway.md. */
  | "live_conversation"
  /* **Not a pipeline stage, on this wire, and still not a chat completion.**
     `illustrate` posts to `/v1/images`, whose answer is `data: [{ b64_json }]`
     with no `choices` anywhere in it — so every parser `openRouterStream` and
     `openRouterJson` hand their body to would read it as an empty reply. It has
     a row in `AI_JOB_ROUTE` (which is keyed on `RoutedJob`, not on this type)
     and its own entry point, `openRouterImage`. Excluding it here is what makes
     `openRouterJson("illustrate", …)` a compile error rather than a picture
     recorded as a chat call. */
  | "illustrate"
  /* **The fourth reason, and it arrived on 2026-09-07: a job that used to be on
     this wire and left.** `dictation` posted to chat/completions with the audio
     as an `input_audio` part and a JSON schema around the answer, until
     `openai/gpt-transcribe` turned out to take both a browser's webm and a
     `keywords` array — docs/plans/260907c-dictation-onto-an-openai-transcriber.md.
     It now posts to `/v1/audio/transcriptions`, whose answer is `{text}` with no
     `choices` and whose `usage` counts seconds rather than tokens, so it is
     excluded here for `illustrate`'s reason exactly: to make
     `openRouterJson("dictation", …)` a compile error rather than a transcript
     read as an empty reply. Its entry point is `openRouterTranscription`. */
  | "dictation"
  /* **Quick search, on the Decisions wire** — `illustrate`'s reason again: its
     answer is `{answers}`, not `choices`, so `openRouterJson("search-quick", …)`
     must be a compile error rather than a set of probabilities read as an
     empty reply. Its entry point is `openRouterDecisions`. Plan 261002e. */
  | "search-quick"
  /* The command bar's pick, on the same wire for the same reason. Its words
     (`command-pick-words`) are a chat completion and stay in. Plan 261003k. */
  | "command-pick"
>;

/**
 * **The provider refused with an HTTP status.**
 *
 * Its `message` is the reader-facing sentence, already mapped from the status by
 * [`src/messages.ts`](messages.ts). The number is on the object rather than in
 * the sentence, so a caller can log which failure it was without the reader
 * being shown a number that means nothing to them.
 *
 * **The provider's own body is not on here and never will be.** OpenRouter's
 * error text is the one place an upstream might echo part of what we sent, and
 * what we sent is an article, a reader's question, or their voice. The body is
 * discarded at this boundary rather than carried on a field marked do-not-log:
 * sensitive data parked on an object is sensitive data waiting for the next
 * serialiser to find it. See `providerRefused` in
 * [`openrouter-stream.ts`](openrouter-stream.ts) for the longer version, and be
 * honest that something diagnostic *was* lost.
 *
 * **What replaces it is allowlisted rather than free text**: a `kind` drawn from
 * a fixed set, and a retry delay parsed to a number. Both are things we decided
 * to look for, so neither can carry a sentence the provider wrote. That
 * distinction is the whole design — a caller that needs to *act* on a failure
 * gets a value it can branch on, and a caller that merely wants to explain one
 * gets the status.
 */
export class ProviderRefused extends Error {
  readonly status: number;
  /**
   * A recognised failure, or `null` for "some other refusal".
   *
   * `"no-endpoints"` is OpenRouter answering *"No endpoints available matching
   * your guardrail restrictions and data policy"* — a **404 that reads like a
   * bad model id and is neither**: it is this account's privacy settings
   * refusing every upstream that serves the model. It cost an hour once, and
   * retrying cannot help, because it is a setting rather than a queue. So it is
   * classified here, by matching a fixed string, and the string we matched
   * against never leaves this function.
   *
   * `"context-exceeded"` is the Decisions endpoint's 400 for a request past the
   * model's 32k context. Its body is `{"error":{"message":"HTTP 400: …
   * max_tokens_exceeded …"}}` — the real reason is a JSON string inside
   * `message` (spike 261002o). Quick search halves the chunk and asks again on
   * this, which it could not do from a bare 400: a malformed request answers
   * 400 too, and halving that would only spend twice.
   */
  readonly kind: "no-endpoints" | "context-exceeded" | null;
  /**
   * `Retry-After`, parsed to milliseconds (src/retry-after.ts), or `null` if it
   * was absent, nonsense or not a wait at all: `0` and a date already past are
   * `null` too, so a caller's own backoff applies. Never clamped; how long a
   * wait is affordable is the caller's to decide.
   */
  readonly retryAfterMs: number | null;
  /**
   * **Did this refusal's body carry a cost?** — the meter's answer, at the
   * moment it was thrown. A refusal that was billed is not bought again, and a
   * caller with its own retry loop cannot see the meter, so the verdict travels
   * with the error. Read through `worthAskingAgain`, not on its own.
   *
   * Required, so every construction site has to say. A site that cannot know
   * (src/pdf-read.ts § `refuseBodyError`, a refusal found inside a `200`) says
   * `true`: a `200` is work the provider accepted, and the careful answer to
   * "was it billed" is yes.
   */
  readonly priced: boolean;
  constructor(status: number, body: string, headers: Headers, priced: boolean) {
    super(providerHttpFailure(status).message);
    this.name = "ProviderRefused";
    this.status = status;
    this.priced = priced;
    this.kind =
      status === 404 && body.includes("No endpoints available")
        ? "no-endpoints"
        : status === 400 && body.includes("max_tokens_exceeded")
          ? "context-exceeded"
          : null;
    this.retryAfterMs = headers ? parseRetryAfter(headers.get("retry-after"), Date.now()) : null;
  }
}

/* ---------------------------------------------------------------- the meter -- */

function num(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

/**
 * OpenRouter's `usage`, in the shape both of this wire's responses use — the
 * streamed final chunk and the non-streamed body carry the same object.
 *
 * `cache_write_tokens` has **two spellings** and both are read, for the reason
 * [`openrouter-stream.ts`](openrouter-stream.ts) gives at length: a live
 * streamed call put it under `prompt_tokens_details`, and the non-streamed path
 * read a top-level one and got a real number. Reading only one of them looks
 * exactly like "nothing was cached".
 */
interface WireUsage {
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  /* **The transcription endpoint's spelling for the same two numbers.**
     OpenRouter documents `input_tokens`, `output_tokens` and `total_tokens` as
     optional on `/v1/audio/transcriptions`; `openai/gpt-transcribe` sends none
     of them — measured at 3 seconds of audio and at 22 on 2026-09-07, where the
     whole `usage` was `{seconds, cost}`. They are read anyway, because the cost
     of reading a field nobody sends is nothing and the cost of *not* reading one
     that arrives is a token count silently missing from the ledger for a wire
     nobody thinks to check. GPT Sol's third review. */
  input_tokens?: unknown;
  output_tokens?: unknown;
  cost?: unknown;
  is_byok?: unknown;
  cost_details?: { upstream_inference_cost?: unknown };
  prompt_tokens_details?: {
    cached_tokens?: unknown;
    cache_write_tokens?: unknown;
  };
  cache_write_tokens?: unknown;
  /** Thinking, on this wire's spelling. Inside `completion_tokens`, not additional. */
  completion_tokens_details?: { reasoning_tokens?: unknown };
  /* **The two web-search spellings are deliberately absent from this
     interface.** They are declared once, on `Usage` in
     [`openrouter-stream.ts`](openrouter-stream.ts), beside the parser that
     reads them — a second declaration here would be a second copy of a wire
     shape that has already changed spelling once. `saw` hands the raw object to
     that parser instead. */
}

/**
 * **How one attempt ended, as the meter is told it.** A union rather than an
 * outcome and an optional failure beside it, so an `error` that does not say
 * where and why does not compile, and an `ok` cannot carry a failure.
 *
 * **Nor does an `aborted` that does not say who stopped it.** The signal a
 * seam is handed is the caller's composite — its own, its deadline, its stall
 * clock — and until 2026-10-06 a provider that went silent and a reader who
 * left were one row here. The signal's reason now tells them apart
 * (`abortClass` in call-failure.ts), so an `aborted` end carries the class,
 * and how far the call had got. `Meter.stopped` is the one place it is made.
 * Plan docs/plans/261006d-count-stalls-and-deadlines-apart-from-a-reader-s-stop.md.
 */
type CallEnd =
  | { outcome: "ok" }
  | { outcome: "aborted"; failure: CallFailure & { class: AbortClass } }
  | { outcome: "error"; failure: CallFailure };

/** Who is calling, for a log line: the three names a failure is counted under. */
interface Caller {
  job: AiJob;
  wire: Wire;
  model: string;
}

/**
 * The failure for an error from an attempt **that no response was accepted
 * for**: a refusal, or `fetch` itself rejecting. One function, because two
 * things ask it — the failed attempt's row (`Meter.failed`) and the line
 * logged as the next attempt starts (`warnRetry`) — and a retry counted under
 * one label and logged under another could not be joined back up.
 *
 * The network is recognised the way `worthAskingAgain` recognises it, a
 * `TypeError` that `send` saw `fetch` reject with. Anything else `fetch` threw
 * is a test double or a guard, and is `other`.
 */
function unansweredFailure(err: unknown): CallFailure {
  if (err instanceof ProviderRefused) {
    /* A `2xx` can only be here from `refuse` on a streamed `200` that came with
       no body: nothing was refused, and there was nothing to read. */
    const accepted = err.status >= 200 && err.status < 300;
    return { phase: "before_answer", class: accepted ? "unreadable" : "refused", status: err.status };
  }
  return {
    phase: "before_answer",
    class: err instanceof TypeError && neverAnswered.has(err) ? networkClass(err) : "other",
    status: null,
  };
}

/** What each of this file's log lines about a failure carries, and nothing else. */
function failureFields(who: Caller, attempt: number | null, failure: CallFailure): Record<string, unknown> {
  return { job: who.job, wire: who.wire, model: who.model, attempt, class: failure.class, status: failure.status };
}

/**
 * **One line as a retry's attempt starts** — not when the failure is seen,
 * because a Stop during the backoff means the retry never happens, and the
 * line has to agree with the ledger, where a retry is a row with
 * `attempt > 1`. `after` is the failure that caused it. Labels and numbers
 * only: docs/project/logging.md.
 */
function warnRetry(who: Caller, attempt: number, after: CallFailure): void {
  log("model").warn(failureFields(who, attempt, after), "ai transport retry");
}

/**
 * One call's accounting, from before the request to after the last byte.
 *
 * Not exported, and that is the design rather than tidiness: a meter a caller
 * holds is a meter a caller can decline to finish. The only way to get one is to
 * start a call, and the only way to start a call finishes it.
 */
class Meter {
  private readonly startedAt = Date.now();
  private readonly callId: number | null;
  private done = false;
  /**
   * Where this attempt has got to, which is what decides a failure's phase.
   * `status` is `null` until a response arrives; `accepted` is the seam's own
   * boundary (see `answered`); `verdict` is what a body that *was* read turned
   * out to be, when that was not an answer.
   */
  private responded = false;
  private status: number | null = null;
  private accepted = false;
  private bodyRead = false;
  private verdict: FailureClass | null = null;
  costNanos: Nanos | null = null;
  upstreamCostNanos: Nanos | null = null;
  generationId: string | null = null;
  answeredBy: string | null = null;
  isByok: boolean | null = null;
  inputTokens: number | null = null;
  outputTokens: number | null = null;
  cacheReadTokens: number | null = null;
  cacheWriteTokens: number | null = null;
  reasoningTokens: number | null = null;
  webSearches: number | null = null;
  upstream: string | null = null;

  constructor(
    private readonly job: AiJob,
    private readonly model: string,
    private readonly wire: Wire,
    private readonly credentialFingerprint: string,
    /**
     * Which go this is in the seam's retry loop, or `null` where the caller
     * owns the loop. Required, so a seam cannot open a meter without saying:
     * `SpendRecord.attempt`.
     */
    private readonly attempt: number | null,
  ) {
    /* Registered *before* the network call, so a request that never comes back
       leaves a trace. See `PendingCall` in ai-spend.ts. */
    this.callId = beginSpend(job, model);
  }

  /**
   * **A response arrived.** Its status is kept now, before the body is read,
   * so that 503 headers followed by a body that will not read is still a 503
   * on the row: `ProviderRefused` is never built on that path, and taking the
   * status from it alone would lose the one thing known.
   *
   * `accepted` is whether this crossed the seam's acceptance boundary, and the
   * seam says, because the two kinds differ: `response.ok` on a whole call, a
   * `2xx` with a body in hand on a stream.
   */
  answered(response: Response, accepted: boolean): void {
    this.responded = true;
    this.generationId = generationIdOf(response);
    /* The guard is for the hand-built doubles `generationIdOf` describes. */
    this.status = typeof response.status === "number" ? response.status : null;
    this.accepted = accepted;
  }

  /**
   * **The whole body was read**, and this is what it was: `parsed` is whether
   * it was JSON at all, `json` the value. An accepted body that would not
   * parse, or that is an error envelope, is noted here for whichever of the
   * seam's two ways out comes next: a reader that throws, or `openRouterJson`
   * handing the body back for its caller to judge.
   */
  read(parsed: boolean, json: unknown): void {
    this.bodyRead = true;
    this.verdict = !parsed ? "unreadable" : isErrorEnvelope(json) ? "in_band" : null;
  }

  /** What an accepted body that was read turned out to be, when it was not an answer. `null` otherwise. */
  notAnAnswer(): CallEnd | null {
    return this.accepted && this.verdict ? this.died(this.verdict) : null;
  }

  /** A failure after the acceptance boundary that nothing threw: the stream said so, or simply stopped. */
  died(why: FailureClass): CallEnd {
    return { outcome: "error", failure: { phase: "mid_answer", class: why, status: this.status } };
  }

  /**
   * **An attempt that was stopped rather than failed**: who stopped it, from
   * the signal's reason, and how far it had got, by the same acceptance
   * boundary an error is placed by.
   *
   * A signal that has not fired, or none, is `abort`: the consumer closed the
   * stream early and nobody's clock did it. The reason is read only off a
   * signal that has fired, and only to pick a label.
   */
  stopped(signal: AbortSignal | undefined): CallEnd {
    return {
      outcome: "aborted",
      failure: {
        phase: this.accepted ? "mid_answer" : "before_answer",
        class: abortClass(signal?.aborted ? signal.reason : undefined),
        status: this.status,
      },
    };
  }

  /**
   * **How an attempt that threw ended**, from how far it had got.
   *
   * The phase is the acceptance boundary and nothing else: not whether the
   * retry would ask again, and not the class of the error, which is a
   * `TypeError` for a connection that never opened and for a `200` whose body
   * was cut off alike.
   *
   * - No response: whatever `send` threw (`unansweredFailure`).
   * - A response that was not accepted: `before_answer`, with its status,
   *   whether the refusal was thrown cleanly or its body broke first.
   * - Accepted, body not yet read: the body broke. `mid_answer`.
   * - Accepted and read: what threw was our own reading of it, so the body was
   *   not an answer. `unreadable`, or `in_band` where it was an error envelope.
   */
  failed(err: unknown, signal: AbortSignal | undefined): CallEnd {
    if (abortedBy(err, signal)) return this.stopped(signal);
    if (!this.responded || err instanceof ProviderRefused) return { outcome: "error", failure: unansweredFailure(err) };
    if (!this.accepted) {
      return { outcome: "error", failure: { phase: "before_answer", class: "refused", status: this.status } };
    }
    if (this.bodyRead) return this.died(this.verdict ?? "unreadable");
    return this.died(spokeNonsense(err) ? "unreadable" : thrownClass(err));
  }

  saw(usage: unknown): void {
    if (!usage || typeof usage !== "object") return;
    const u = usage as WireUsage;
    if (typeof u.cost === "number")
      this.costNanos = providerCostToNanos(u.cost);
    const upstream = u.cost_details?.upstream_inference_cost;
    if (typeof upstream === "number")
      this.upstreamCostNanos = providerCostToNanos(upstream);
    if (typeof u.is_byok === "boolean") this.isByok = u.is_byok;
    this.inputTokens = num(u.prompt_tokens) ?? num(u.input_tokens) ?? this.inputTokens;
    this.outputTokens = num(u.completion_tokens) ?? num(u.output_tokens) ?? this.outputTokens;
    this.cacheReadTokens =
      num(u.prompt_tokens_details?.cached_tokens) ?? this.cacheReadTokens;
    this.cacheWriteTokens =
      num(u.prompt_tokens_details?.cache_write_tokens) ??
      num(u.cache_write_tokens) ??
      this.cacheWriteTokens;
    this.reasoningTokens =
      num(u.completion_tokens_details?.reasoning_tokens) ?? this.reasoningTokens;
    /* **The existing parser, not a third reading of the same two fields.** It
       already runs on these very calls — src/explain.ts and
       src/referee-criteria-run.ts call it for their own logs — so the count was
       being computed and then thrown away here. Its `null` for "this chunk did
       not say" is what makes `??` safe: a usage frame without the field cannot
       reset a count an earlier one gave. */
    this.webSearches =
      whereSearchCountCameFrom(usage as Usage).searches ?? this.webSearches;
  }

  sawModel(model: unknown): void {
    if (typeof model === "string" && model.length > 0) this.answeredBy = model;
  }

  /** Set when `sawRoute` found a selected endpoint; the frame's word is then ignored. */
  private upstreamFromRoute = false;
  /** False for a request whose frames are known to mislabel — see `frameProviderTrusted`. */
  trustFrameProvider = true;

  /** Which upstream answered, when the frame says. The Messages wire gets this free. */
  sawUpstream(provider: unknown): void {
    if (this.upstreamFromRoute || !this.trustFrameProvider) return;
    if (typeof provider === "string" && provider.length > 0)
      this.upstream = provider;
  }

  /**
   * The endpoint OpenRouter says it selected, from `openrouter_metadata` —
   * believed over the frame's `provider`, which is wrong on the Exa path. See
   * `ROUTE_METADATA`. Absent metadata changes nothing.
   */
  sawRoute(metadata: unknown): void {
    const available = (metadata as { endpoints?: { available?: unknown } } | null)
      ?.endpoints?.available;
    if (!Array.isArray(available)) return;
    const selected = (available as { provider?: unknown; selected?: unknown }[]).find(
      (e) => e?.selected === true,
    );
    if (typeof selected?.provider === "string" && selected.provider.length > 0) {
      this.upstream = selected.provider;
      this.upstreamFromRoute = true;
    }
  }

  /**
   * Record the call. **Idempotent**, because the alternative double-counts: a
   * caller that finishes in a `finally` and again on an error path is an
   * ordinary mistake, and a cost table that over-reports is worse than one that
   * under-reports — it is wrong in the direction that looks like the thing you
   * were trying to measure. The same bug was found on the other wire by a GPT
   * Sol review, where `finalMessage()` could be awaited twice.
   */
  finish(end: CallEnd): void {
    if (this.done) return;
    this.done = true;
    const failure = end.outcome === "ok" ? null : end.failure;
    /* **One line for a call that died after its answer began** — the event the
       retry does not cover, and the one plan 261006b exists to count. An
       error only: a call somebody stopped part-way did not die. */
    if (end.outcome === "error" && end.failure.phase === "mid_answer") {
      log("model").warn(failureFields(this.caller(), this.attempt, end.failure), "ai call died part-way");
    }
    /* **And one for a call our own clock stopped**, at either phase. Not for
       `abort`: a reader pressing Stop is not news. Plan 261006d. */
    if (end.outcome === "aborted" && stoppedByOurClock(end.failure)) {
      log("model").warn(failureFields(this.caller(), this.attempt, end.failure), "ai call stopped by our clock");
    }
    recordSpend(
      {
        job: this.job,
        wire: this.wire,
        model: this.model,
        answeredBy: this.answeredBy,
        /* **One field, one of three arms** — never a settled figure and a
           computed one side by side. Nothing on this wire computes anything: it
           posts to OpenRouter, which either reports a cost or does not, so this
           is always `provider` or `none` and `providerCost` is the conversion.
           src/ai-spend.ts's `SpendProvenance` has the argument. */
        cost: providerCost(this.costNanos),
        upstreamCostNanos: this.upstreamCostNanos,
        /* Hard-coded rather than a field: this file only ever posts to
           OpenRouter, and a variable here would be a place for that to stop
           being true without anything saying so. */
        providerAccount: "openrouter",
        generationId: this.generationId,
        upstream: this.upstream,
        credentialFingerprint: this.credentialFingerprint,
        isByok: this.isByok,
        inputTokens: this.inputTokens,
        outputTokens: this.outputTokens,
        cacheReadTokens: this.cacheReadTokens,
        cacheWriteTokens: this.cacheWriteTokens,
        /* **Null rather than zero on this wire.** OpenAI's shape reports one
           cache-write total and does not split it by TTL, so a `0` here would be
           a claim that no one-hour write happened — which is a different thing
           from not being told. The Messages wire fills these in. */
        cacheWrite5mTokens: null,
        cacheWrite1hTokens: null,
        reasoningTokens: this.reasoningTokens,
        /* **Four callers on this wire run server-side web searches** — explain
           (up to 8 a call), chat, referee-criteria and referee-candidates all
           send `tools: [{ type: "openrouter:web_search" }]` — and a search is
           billed per result, so a call can cost ten cents more than its tokens
           say. Until 2026-09-02 this was hard-coded `null` under a comment
           asserting the opposite, and `web_searches` was null on every row in
           the ledger. `service_tier` and `inference_geo` really are Anthropic's
           own fields on the Messages shape, and stay null here. */
        webSearches: this.webSearches,
        serviceTier: null,
        inferenceGeo: null,
        ms: Date.now() - this.startedAt,
        outcome: end.outcome,
        attempt: this.attempt,
        failure,
      },
      this.callId,
    );
  }

  private caller(): Caller {
    return { job: this.job, wire: this.wire, model: this.model };
  }
}

/* --------------------------------------------------------------- the request -- */

/**
 * How OpenRouter attributes our traffic in its own dashboard.
 *
 * Three of the six callers sent these and three did not, which made the
 * dashboard's per-app breakdown quietly a breakdown of *half* the app. Not a
 * correctness problem; a "why do these numbers not add up" problem, for whoever
 * does the reconciling six months from now.
 */
const ATTRIBUTION = {
  "HTTP-Referer": "http://localhost:5273",
  "X-Title": "Spideryarn",
} as const;

/**
 * **Asks OpenRouter to say which endpoint it actually picked**, because on one
 * path the frame's own `provider` does not.
 *
 * A request carrying an Exa `openrouter:web_search` comes back with
 * `provider: "OpenAI"` on every frame, streamed or not, for a Claude model
 * pinned to Anthropic — and equally under a Bedrock-only pin, while
 * `only: ["openai"]` 404s. The routing is obeyed; the label is the server-tool
 * loop's. This header adds `openrouter_metadata`, whose
 * `endpoints.available[].selected` named Anthropic and Bedrock correctly in
 * every probe. In each streamed probe it arrived once on the usage chunk;
 * `Meter.sawRoute` nevertheless reads every chunk and does not depend on that
 * observed ordering. Measured 2026-10-01:
 * docs/plans/261001g-exa-upstream-label.md.
 */
const ROUTE_METADATA = { "X-OpenRouter-Metadata": "enabled" } as const;

/**
 * **Is the frame's `provider` worth believing for this request?** Not when it
 * asks for Exa: see `ROUTE_METADATA`. Only the explicit spelling every caller
 * here uses is recognised; a default-engine search that fell back to Exa, or
 * the older `plugins` form, would not be caught by this and would rely on the
 * metadata alone.
 */
function frameProviderTrusted(body: AiRequestBody): boolean {
  const tools = Array.isArray(body.tools) ? (body.tools as unknown[]) : [];
  return !tools.some((t) => {
    const tool = t as { type?: unknown; parameters?: { engine?: unknown } } | null;
    return tool?.type === "openrouter:web_search" && tool.parameters?.engine === "exa";
  });
}

/**
 * The body a caller passes: whatever the endpoint wants, and a `model`.
 *
 * The four fields this file owns are typed `never`, so passing one is a compile
 * error rather than a value silently overwritten. They are overwritten anyway,
 * after the spread — belt and braces, because `Record<string, unknown>` can be
 * built at run time from something the type system never saw.
 */
export type AiRequestBody = {
  model: string;
  provider?: never;
  stream?: never;
  stream_options?: never;
  usage?: never;
  /** Decided per job in `CHAT_REASONING` and sent by `outgoing`, since 2026-09-28. */
  reasoning?: never;
} & Record<string, unknown>;

/**
 * The request as it actually goes out.
 *
 * `usage: { include: true }` and, on a stream, `stream_options: { include_usage:
 * true }`. Probed live on 2026-08-27, three otherwise-identical requests:
 * **`cost`, `is_byok` and `cost_details` arrive with either flag, and with both
 * together, identically** — so setting them cannot change what a call costs or
 * returns. It can only stop a caller from omitting the one flag whose absence
 * looks like good news: without it a streamed response carries no `usage` at
 * all, and every token count, cache count and cost reads as zero.
 *
 * Spread first, injected second. `tests/ai-call.test.ts` asserts the outgoing
 * body rather than trusting this.
 */
/** The row for a job, with the same guard and the same message as `pathFor`. */
function routeFor(job: RoutedJob): Route {
  const route = AI_JOB_ROUTE[job];
  if (!route) {
    throw new Error(
      `${job} is a pipeline stage — use streamMessage, not this wire`,
    );
  }
  return route;
}

function outgoing(
  job: ChatJob,
  body: AiRequestBody,
  streaming: boolean,
): string {
  /* After the spread, like `provider`: a body built at run time can carry a
     `reasoning` the type never saw, and the table is the decision. A
     `providerDefault` row strips one for the same reason. */
  const { reasoning: _ignored, ...rest } = body as Record<string, unknown>;
  const effort = wireEffort(job, rest.model);
  return JSON.stringify({
    ...rest,
    ...(effort ? { reasoning: { effort } } : {}),
    /* Every chat row has one; the conditional is for `Route.provider`'s `null`,
       which only the image route uses and which never reaches here. */
    ...(routeFor(job).provider ? { provider: routeFor(job).provider } : {}),
    usage: { include: true },
    ...(streaming
      ? { stream: true, stream_options: { include_usage: true } }
      : {}),
  });
}

/**
 * The key, or the sentence a reader gets instead.
 *
 * `NOT_CONFIGURED.message` rather than the variable's name, for the split
 * docs/project/logging.md describes: the name of an environment variable is
 * useful to whoever runs the server and useless to a reader, who has not got the
 * repository. The operator's half is logged here, once, in fixed words with
 * nothing interpolated. Until 2026-10-04 seven runners each logged their own
 * version first, from a pre-check of a key they never used; those are gone
 * (plan 261004c § R3), so this is the only place a missing key is said. Which
 * feature it was is on the caller's own failure line.
 *
 * **`loadEnvLocal()` is deliberately not called here** — same reason as
 * [`messagesClient`](messages-stream.ts), which learned it the expensive way: a
 * test that deletes `OPENROUTER_API_KEY` on purpose had the real key handed back
 * to it and made a live, paid call. Loading the file belongs at the program's
 * edge.
 */
function apiKey(override: string | undefined): string {
  /* **An explicit override is allowed; reading a file is not.** The two look
     similar and are opposites. `loadEnvLocal()` here would re-read credentials a
     caller has just removed — which is exactly how a test that deletes
     `OPENROUTER_API_KEY` on purpose came to make a live, paid call. A key passed
     in as an argument cannot do that: the caller decided. src/embeddings.ts is
     the one that uses it, because it has threaded its key through explicitly
     since before this seam existed and its "no endpoints available" message
     names the key prefix, which is the fastest way to tell two OpenRouter
     accounts apart. */
  const key = override ?? process.env.OPENROUTER_API_KEY;
  if (!key) {
    log("model").error("OPENROUTER_API_KEY is not set, so every model call on this wire will fail");
    throw new Error(NOT_CONFIGURED.message);
  }
  return key;
}

/**
 * Everything that can fail **before** a request exists, done before the meter
 * does.
 *
 * The rule the meter rests on is *one record, one network attempt*, and it has
 * an inverse the first version got wrong: **no attempt, no record.** The meter
 * used to be constructed first, so a missing key or an unserialisable body — a
 * `BigInt`, a circular reference — produced a spend row for a call that never
 * left the process. Every caller validated its own key first at the time, which
 * is exactly why nothing caught it. Raised by a GPT Sol review of the code.
 *
 * Since 2026-10-04 the streaming runners no longer check the key themselves, so
 * `apiKey` below is the only check on their road and this order is what stands
 * between a missing key and a phantom row (tests/no-key-runners.test.ts).
 */
function prepare(
  job: ChatJob,
  body: AiRequestBody,
  streaming: boolean,
  key0: string | undefined,
): {
  key: string;
  payload: string;
  url: string;
  headers: Record<string, string>;
  fingerprint: string;
} {
  const key = apiKey(key0);
  return {
    key,
    payload: outgoing(job, body, streaming),
    url: `${OPENROUTER_BASE}${pathFor(job)}`,
    /* Chat only: the other paths this function serves (embeddings) were never
       probed with it, and their frames carry no `provider` to correct. */
    headers: wireOf(job) === "chat" ? ROUTE_METADATA : {},
    /* Named, never carried. See `keyFingerprint` — the reconciliation is per
       key, and `src/embeddings.ts` legitimately passes a different one. */
    fingerprint: keyFingerprint(key),
  };
}

/**
 * Which shape this job's request goes out in, and therefore what its ledger row
 * calls itself.
 *
 * **Read off the row, not computed from the path.** This was
 * `path === "/v1/embeddings" ? "embeddings" : "chat"` — right while there were
 * two paths, and a silent lie the moment there were three: the image endpoint
 * would have been billed as chat, the row would have been written, and nothing
 * would have gone red. A cross-family review found it before the third path
 * landed. See `Route.wire`.
 */
function wireOf(job: RoutedJob): Wire {
  return routeFor(job).wire;
}

/**
 * The one `fetch` on this wire. **An error `fetch` itself rejected with is
 * remembered as never answered**, because this is the only place that can tell
 * it from a `200` whose body broke later: both are a `TypeError` by the time a
 * caller catches one. `worthAskingAgain` reads the mark.
 */
async function send(
  prepared: { key: string; payload: string; url: string; headers?: Record<string, string> },
  signal: AbortSignal | undefined,
): Promise<Response> {
  try {
    return await fetch(prepared.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${prepared.key}`,
        "Content-Type": "application/json",
        ...ATTRIBUTION,
        ...prepared.headers,
      },
      ...(signal ? { signal } : {}),
      body: prepared.payload,
    });
  } catch (err) {
    /* Only an object can go in a `WeakSet`, and anything can be thrown. */
    if (typeof err === "object" && err !== null) neverAnswered.add(err);
    throw err;
  }
}

/* ------------------------------------------------------ the transport retry -- */

/** Errors `fetch` rejected with: no response existed. Written only by `send`. */
const neverAnswered = new WeakSet<object>();

/**
 * **Is this failure eligible for another identical request?** The one rule for
 * this wire, used by the retry below
 * and by the callers that keep a loop of their own (src/pdf-read.ts,
 * src/embeddings.ts), so an opt-out cannot bypass it.
 *
 * Yes for exactly two things:
 *
 * - **`fetch` itself failed with a `TypeError`** — what undici throws for a
 *   network failure ("fetch failed"). A `TypeError` from anywhere else is not
 *   one: a `200` whose body would not read is a response, and OpenRouter may
 *   have billed it. A plain `Error` from `fetch` is not one either; in this
 *   repo it is a test double or a guard.
 * - **A refusal with one of `TRANSIENT_STATUSES` that priced nothing.** Never a
 *   429 (see that set), and never a refusal whose body carried a cost.
 *
 * It does not look at a signal. An abort is the caller's to check first.
 */
export function worthAskingAgain(err: unknown): boolean {
  if (err instanceof ProviderRefused) return !err.priced && TRANSIENT_STATUSES.has(err.status);
  return err instanceof TypeError && neverAnswered.has(err);
}

/** What every seam's options carry for the retry. */
interface RetryOptions {
  signal?: AbortSignal;
  /**
   * `false` for a caller that already owns this decision: it has its own loop,
   * or it counts its asks as a spend cap, or a fallback beats two seconds of
   * waiting. Without it the loops multiply. The five that pass it, and why, are
   * in docs/project/ai-gateway.md § "A transport blip is retried".
   */
  retryTransport?: false;
}

/** After attempt `attempt` failed with `err`: is another one due? An abort and an opt-out both say no. */
function mayAskAgain(err: unknown, attempt: number, options: RetryOptions | undefined): boolean {
  if (options?.retryTransport === false || options?.signal?.aborted) return false;
  return attempt < TRANSPORT_ATTEMPTS && worthAskingAgain(err);
}

/**
 * The wait between two attempts. **A Stop or a deadline during it ends the call
 * as the abort it is**: the signal's own `reason` is thrown, which is what
 * `abortedBy` here and `stoppedByReader` / `explainAbort` in
 * [`openrouter-stream.ts`](openrouter-stream.ts) test for by identity. No
 * `Meter` exists during the wait, so the wait writes no row.
 */
async function backOff(attempt: number, signal: AbortSignal | undefined): Promise<void> {
  try {
    await waitOrStop(backoffMs(attempt), signal);
  } catch {
    /* `waitOrStop` rejects only when the signal fired, so there is one. */
    throw (signal as AbortSignal).reason;
  }
}

/**
 * **Run one whole call up to `TRANSPORT_ATTEMPTS` times** — plan 261005j. Until
 * 2026-10-05 no seam here asked twice, so one dropped connection failed a
 * pipeline step, a plate, or a reader's dictation.
 *
 * `attempt` is a seam's whole body from its `new Meter` to its `finally`, so
 * **each attempt is its own meter and its own row**: a call that blipped once
 * is two rows, `error` then `ok`, and *one record, one network attempt* still
 * holds. It is handed its ordinal, which is the row's `attempt`. When no further attempt is due the attempt's own error is rethrown
 * unchanged, so a `ProviderRefused` keeps its status for the caller.
 *
 * The streamed seam does not use this: its retry stops at the response headers,
 * not at the end of the call. See `acceptedStream`.
 */
async function asTransportAttempts<T>(
  who: Caller,
  options: RetryOptions | undefined,
  attempt: (n: number | null) => Promise<T>,
): Promise<T> {
  /* What the previous attempt failed with, for the line logged as the next
     one starts. Only a failure `mayAskAgain` passed gets here, so it is always
     one `unansweredFailure` can place. */
  let after: CallFailure | null = null;
  for (let n = 1; ; n++) {
    /* Cancellation can arrive after the wait resolves. Check before the retry
       creates a meter: an already-aborted fetch sends no network request. */
    if (n > 1) options?.signal?.throwIfAborted();
    if (after) warnRetry(who, n, after);
    try {
      return await attempt(ordinal(n, options));
    } catch (err) {
      if (!mayAskAgain(err, n, options)) throw err;
      after = unansweredFailure(err);
      await backOff(n, options?.signal);
    }
  }
}

/**
 * **The number an attempt's row carries**: its place in the loop, or `null`
 * when the caller opted out of the loop. Not `1`, though an opted-out seam
 * does make exactly one request: its caller is looping around it
 * (src/pdf-read.ts, src/embeddings.ts), so its third go would be a third row
 * saying `1`, and a count of `attempt > 1` would read those retries as none.
 */
function ordinal(n: number, options: RetryOptions | undefined): number | null {
  return options?.retryTransport === false ? null : n;
}

/** A whole (non-streamed) seam's options. */
export interface CallOptions extends RetryOptions {
  /** A key to use instead of `OPENROUTER_API_KEY`. See `apiKey` for why this is allowed. */
  apiKey?: string;
}

/**
 * `x-generation-id`, the key for `GET /api/v1/generation?id=…` later.
 *
 * **Off the headers rather than out of the body**: on a non-200 there is no
 * usage object at all, and this is then the only handle on the call that exists
 * — which is what makes a failed call reconcilable afterwards.
 *
 * The optional chaining is not defending against a real response, which always
 * has a `headers`. It is defending against the dozen hand-built `{ ok: true,
 * body }` doubles across `tests/`, some of them inside child processes, none of
 * which is going to stay a complete `Response` as this file grows. Returning
 * `null` is the honest answer in that case and `null` is already what this field
 * means when the header did not arrive — so nothing is being swallowed, and the
 * alternative was a `TypeError` from a line that is not about anything the test
 * was testing.
 */
function generationIdOf(response: Response): string | null {
  return response.headers?.get("x-generation-id") ?? null;
}

/**
 * **Did this error come from the abort, or merely arrive while one was set?**
 *
 * The two are not the same and the first version treated them as the same: any
 * failure raised while `signal.aborted` was true got recorded as `"aborted"`,
 * so a provider dying at the moment a reader pressed Stop went into the ledger
 * as a cancel — and a cancel is the one outcome nobody investigates.
 *
 * Aborting rejects with the signal's own `reason`, so identity is the strong
 * test; the name check covers an abort raised with no reason given.
 * `stoppedByReader` in [`openrouter-stream.ts`](openrouter-stream.ts) makes the
 * same distinction for the reader-facing message, and a GPT Sol review pointed
 * out that the bill was still using the weaker question.
 */
function abortedBy(err: unknown, signal: AbortSignal | undefined): boolean {
  if (!signal?.aborted) return false;
  return err === signal.reason || (err as Error | undefined)?.name === "AbortError";
}

/**
 * **A chat-wire response body, parsed once, with whatever it says about money
 * handed to the meter.** The parsed value, or `null` where it was not JSON;
 * which of the two a `null` was is told to the meter (`Meter.read`).
 *
 * Shared by the two seams that used to judge the status first:
 * `openRouterJson`, and `refuse` for a stream that was refused. It is called
 * **before the status is judged** in both, the order the image seam has had
 * since 2026-09-03 (`openRouterImage`, which says why at length): a `429` or a
 * `5xx` whose body carries `usage` is a call the provider priced, and rejecting
 * it on the status before parsing leaves an unpriced error row. Nothing about a
 * non-2xx makes its `usage` less true.
 *
 * No refusal on this wire has been observed carrying usage (plan 261004c §
 * F11). This is a proof about our code and a guess about the provider: if one
 * ever does, the row is right.
 *
 * `Meter.saw` overwrites its figures and does not add to them, and a refused
 * stream never reaches the SSE loop, so nothing here can count a call twice.
 *
 * The parse error is swallowed and never rethrown: V8 puts the first characters
 * of the offending input into a `SyntaxError`'s message, so a mangled response
 * can carry a prefix of what we sent it, which on this wire is an article, a
 * reader's question or their voice. See `providerSpokeNonsense` in
 * openrouter-stream.ts. And nothing from the body is quoted by this function:
 * it reads numbers, a model id and a provider name into the meter and returns.
 */
function meterBody(meter: Meter, text: string): unknown {
  let json: unknown = null;
  let parsed = true;
  try {
    json = JSON.parse(text);
  } catch {
    /* Left as `null`. See above for why the error goes nowhere. */
    parsed = false;
  }
  /* The caller is still handed `null` for a body that was not JSON, and cannot
     tell that from a body that was the JSON `null`. The meter can, and it is
     the row that has to: until 2026-10-06 a `200` that would not parse was an
     `ok` row. */
  meter.read(parsed, json);
  /* Only a JSON object can carry any of these. `null`, an array, a string and a
     number all parse, and none of them is a body to read fields off. */
  const record =
    json !== null && typeof json === "object" && !Array.isArray(json)
      ? (json as { usage?: unknown; model?: unknown; provider?: unknown; openrouter_metadata?: unknown })
      : null;
  if (record?.usage) meter.saw(record.usage);
  meter.sawModel(record?.model);
  meter.sawUpstream(record?.provider);
  meter.sawRoute(record?.openrouter_metadata);
  return json;
}

/**
 * Drain a failed response, meter anything it priced, and throw the status,
 * never the words.
 *
 * The body **has** to be consumed or the connection leaks. Until 2026-10-04
 * nothing here looked at what it said; now `meterBody` reads any `usage` out of
 * it first, so a refusal the provider charged for is not an unpriced row.
 *
 * **The `.catch(() => "")` is kept on purpose**, and it is the one place this
 * differs from the image seam, which awaits `response.text()` bare. A refused
 * stream whose body fails to read is still a refusal, with a status, a
 * classification and a `Retry-After` the caller acts on. Without the catch it
 * would surface as a transport error and lose all three ⟨GPT Sol, reviewing the
 * plan, F3⟩. An unreadable body simply meters nothing.
 */
async function refuse(response: Response, meter: Meter): Promise<never> {
  const body = await response.text().catch(() => "");
  meterBody(meter, body);
  throw new ProviderRefused(response.status, body, response.headers, meter.costNanos !== null);
}

export interface StreamOptions {
  /** A key to use instead of `OPENROUTER_API_KEY`. See `apiKey` for why this is allowed. */
  apiKey?: string;
  /** The caller's composite signal — its own, plus its deadline, plus its stall clock. */
  signal: AbortSignal;
  /** Called on every read, parsed or not. This is what makes a stall timer measure silence. */
  onActivity: () => void;
  /** Set to `terminated: true` only when `data: [DONE]` actually arrives. */
  end: StreamEnd;
  /** What to do with a `data:` frame that is not valid JSON — see `SseChunksOptions`. */
  malformedFrames?: "skip" | "throw";
  /** `false` to make exactly one request. See `RetryOptions`. */
  retryTransport?: false;
}

/**
 * **Send a streamed request until a `200` with a body is in hand**, up to
 * `TRANSPORT_ATTEMPTS` times, and hand back that body with its open meter.
 *
 * The retry on this seam ends here, at the response headers. Once a `200`
 * arrives nothing is asked again — not a body that breaks before its first
 * frame, not a stream that dies mid-answer. That is deliberately tighter than
 * the Messages wire, which retries up to `message_start`: a `200` on this wire
 * means OpenRouter has accepted the work and may be billing it.
 *
 * **Each attempt is its own `Meter`.** A failed one is finished here, before
 * the wait, so no call is pending while nothing is in flight; the accepted one
 * is returned unfinished, and `openRouterStream`'s `finally` finishes it. This
 * is an `async` function rather than part of the generator so that a
 * consumer's `return()` cannot land between a meter and its `finish`.
 */
async function acceptedStream(
  job: ChatJob,
  body: AiRequestBody,
  prepared: ReturnType<typeof prepare>,
  options: StreamOptions,
): Promise<{ stream: ReadableStream<Uint8Array>; meter: Meter }> {
  /* The failure the next attempt is a retry of — see `asTransportAttempts`. */
  let after: CallFailure | null = null;
  for (let attempt = 1; ; attempt++) {
    /* The wait and the activity callback can both precede an abort. Neither
       authorizes a new meter after the caller has stopped. */
    if (attempt > 1) options.signal.throwIfAborted();
    /* **Reset, so a reused `end` cannot carry a stale verdict into a new
       attempt.** `converse` runs up to four requests in a turn; it builds a
       fresh object for each, so nothing depends on this today — which is exactly
       when to write it, because the next caller to loop will not know it had to.

       **Before `send`, not after the body arrives**, and the difference is the
       whole point of an out-parameter: this says "here is how *this attempt*
       ended", so it has to be cleared when the attempt starts rather than when
       it starts going well. Placed after the response was validated, a retry
       that aborted, was refused, or came back with no body left the previous
       stream's verdict standing — so the caller classified a call that never
       reached a byte using the last one's terminator. GPT Sol, finding F8.

       **`terminated` was missing from the list entirely until 2026-09-05**,
       which made the sentence above false in the one way that matters most: a
       reused object whose first stream ended on `[DONE]` and whose second ended
       at EOF with nothing to say why classified as `finished`, and — since F5 —
       the stale `true` would also suppress the clock checks. A promise in a
       comment that the code does not keep is worse than no promise, because the
       next caller reads the comment. GPT Sol, finding F7.

       **And once per attempt, not once per call**, since 2026-10-05: a retry
       is a new attempt, and the same rule applies to it. */
    options.end.terminated = false;
    options.end.finishReason = null;
    options.end.answered = false;
    const who = { job, wire: wireOf(job), model: body.model };
    if (after) warnRetry(who, attempt, after);
    const meter = new Meter(job, body.model, who.wire, prepared.fingerprint, ordinal(attempt, options));
    meter.trustFrameProvider = frameProviderTrusted(body);
    try {
      const response = await send(prepared, options.signal);
      /* **This seam's acceptance boundary: a `2xx` with a body in hand.** A
         failure on this side of it is `before_answer`; from the `return` below
         onwards it is `mid_answer`, and `openRouterStream` records it. */
      meter.answered(response, response.ok && !!response.body);
      if (!response.ok || !response.body) await refuse(response, meter);
      /* Non-null: `refuse` throws, but TypeScript cannot see through the `await`. */
      return { stream: response.body as ReadableStream<Uint8Array>, meter };
    } catch (err) {
      const end = meter.failed(err, options.signal);
      meter.finish(end);
      if (!mayAskAgain(err, attempt, options)) throw err;
      after = end.outcome === "error" ? end.failure : null;
      /* **Twice, around the wait.** Before it, so a failure that landed just
         short of the caller's stall clock does not have the backoff counted as
         provider silence; after it, so the next request starts with a full
         allowance. The caller's overall deadline is untouched. */
      options.onActivity();
      await backOff(attempt, options.signal);
      options.onActivity();
    }
  }
}

/**
 * **A streamed call, from the fetch to the spend record, in one frame.**
 *
 * Lazy: nothing is sent until the first `next()`. From then every way out —
 * the consumer breaking early, the consumer throwing, an abort, a provider dying
 * mid-answer, a 429, a body that will not read — records what was spent. An
 * attempt that never reached a `200` is recorded by `acceptedStream`, which may
 * then ask again; the one that did is recorded by the `finally` below.
 *
 * The caller's per-chunk loop does not change. It gets the same `StreamChunk`s
 * `sseChunks` yields; what it loses is the fetch, the status check, and the
 * ability to forget the accounting.
 *
 * A thrown failure is `aborted` only when it is the abort itself; a clean
 * loop end also checks `signal.aborted` for the cancelled-read race. An
 * observed in-band error wins over both. For an abort, the signal's reason
 * says who stopped it (`Meter.stopped`). [`stoppedByReader`](openrouter-stream.ts)
 * asks much the same of the caller's separate signals for the reader's message.
 */
export async function* openRouterStream(
  job: ChatJob,
  body: AiRequestBody,
  options: StreamOptions,
): AsyncGenerator<StreamChunk> {
  /* Before the meter — see `prepare`: no attempt, no record. */
  const prepared = prepare(job, body, true, options.apiKey);
  /* Everything up to a `200` with a body, retried there and nowhere later. From
     here the meter is the accepted attempt's, and the `finally` below owns it. */
  const { stream, meter } = await acceptedStream(job, body, prepared, options);
  let end: CallEnd = { outcome: "ok" };
  /**
   * **The provider said, inside the stream, that it had failed.** Noted here
   * because this loop is the only thing that sees it as what it is. Every
   * consumer throws on `chunk.error`, and a consumer's throw reaches this
   * generator as a `return()` (see `ranToEnd` below), so until 2026-10-06 a
   * provider failing mid-answer was recorded as `aborted` — the outcome nobody
   * investigates, and the one a count of part-way deaths leaves out.
   */
  let sawErrorChunk = false;
  /**
   * Whether the loop below ran to its own end.
   *
   * **The subtlety this exists for is invisible in the code without it.** When a
   * consumer throws inside its `for await`, or `break`s out, the async-iteration
   * protocol closes this generator by calling its `return()`. A `return()` runs
   * the `finally` and **does not run the `catch`** — the consumer's error is
   * never thrown *into* here. So `outcome` stayed `"ok"`, and a turn that blew
   * up on `chunk.error`, or a caller that gave up halfway, was recorded as a
   * clean successful call. Found by a GPT Sol review of the code; the test meant
   * to cover it asserted only the *number* of records, which is the check that
   * shares an assumption with the bug.
   *
   * A `break` and a consumer's throw are indistinguishable from in here — the
   * protocol hands us the same `return()` for both — so both record as
   * `"aborted"`, meaning *this call did not run to completion*. That is weaker
   * than the truth, and it is not wrong, which `"ok"` was.
   *
   * One throw is no longer in that bucket: the one every consumer makes on an
   * in-band error chunk. See `sawErrorChunk`.
   */
  let ranToEnd = false;
  try {
    for await (const chunk of sseChunks(
      stream,
      options.signal,
      options.onActivity,
      options.end,
      {
        ...(options.malformedFrames
          ? { malformedFrames: options.malformedFrames }
          : {}),
      },
    )) {
      meter.sawModel(chunk.model);
      meter.sawUpstream(chunk.provider);
      meter.sawRoute(chunk.openrouter_metadata);
      /* **Every chunk that has one, not just the last.** The usage chunk is
         normally the final one and carries no choices — but "normally" is doing
         work in that sentence, and overwriting with each one costs nothing and
         cannot be wrong about which was last. */
      if (chunk.usage) meter.saw(chunk.usage);
      /* Only that it is there. Its `message` is the provider's words and goes
         nowhere from here. */
      if (chunk.error) sawErrorChunk = true;
      /* **The finish reason is recorded here, once, for everybody.** It used to
         be scraped by each of the seven consumers with the same line, and a
         consumer that forgot simply had `null` for ever — which reads exactly
         like a provider that never said. `classifyEnd` above is what turns it
         into a decision, and every caller keeps its own policy on that
         decision. `answered` likewise: a stream that opened and said nothing is
         a different failure from one that was cut off. */
      options.end.answered = true;
      const reason = chunk.choices?.[0]?.finish_reason;
      if (reason) options.end.finishReason = reason;
      yield chunk;
    }
    ranToEnd = true;
  } catch (err) {
    /* Past the acceptance boundary, so anything but an abort is `mid_answer`. */
    end = meter.failed(err, options.signal);
    throw err;
  } finally {
    /* The provider's error remains evidence even if a later body read throws
       or aborts. Keep the thrown error for the caller, but record the observed
       in-band failure rather than replacing it with its subsequent cleanup. */
    if (sawErrorChunk) end = meter.died("in_band");
    else if (end.outcome === "ok") {
      /* **An abort can end the loop cleanly**, because `sseChunks` cancels the
         reader on abort and a cancelled read resolves `{done: true}` rather than
         throwing. Both streaming callers carry a guard for exactly that race in
         their own logging; this is its equivalent for the bill. */
      if (options.signal.aborted) end = meter.stopped(options.signal);
      /* The consumer closed us early — see `ranToEnd` above. No signal fired,
         so `stopped` says `abort`: nobody's clock did this. */
      else if (!ranToEnd) end = meter.stopped(undefined);
      /* **The stream stopped without saying it had finished.** `[DONE]` is the
         only clean end there is, and every caller already treats its absence as
         a failure (`ENDED_UNFINISHED`). Recording that call as `"ok"` made the
         spend row and the feature's own verdict disagree about the same event —
         the kind of disagreement nobody notices until they are reconciling a
         bill. Raised by a GPT Sol review. */
      else if (!options.end.terminated) end = meter.died("unfinished");
    }
    meter.finish(end);
    warnIfThinkingAteTheCeiling(job, body, options.end, meter);
  }
}

/**
 * **One line, for every streamed chat call, when the model's thinking spent the
 * allowance.** A stream that stops on `length` having spent reasoning tokens is
 * the shape of the claims bug
 * (docs/postmortems/260928b-a-lesson-kept-in-a-helper-does-not-reach-the-other-wire.md),
 * and until this line each caller's own log said `finishReason: "length"` and
 * nothing about where the tokens went — which read as *the input was too big*.
 * A warning, not an error: the caller decides what the stop means and logs its
 * own verdict; this says which of `CHAT_REASONING`'s rows to revisit.
 *
 * Counts and names only — `logging.md`'s rule, and the job's prompt is somebody's
 * article.
 */
function warnIfThinkingAteTheCeiling(
  job: ChatJob,
  body: AiRequestBody,
  end: StreamEnd,
  meter: Meter,
): void {
  if (end.finishReason !== "length" || !meter.reasoningTokens) return;
  try {
    const effort = wireEffort(job, body.model);
    log("model").warn(
      {
        job,
        model: body.model,
        ceiling: num(body.max_tokens) ?? num(body.max_completion_tokens),
        reasoningTokens: meter.reasoningTokens,
        outputTokens: meter.outputTokens,
        effort: effort ?? "provider-default",
      },
      `${job} stopped at its token ceiling after ${meter.reasoningTokens} tokens of thinking — ` +
        "see CHAT_REASONING in src/ai-call.ts",
    );
  } catch {
    // A log line must not be able to fail a call.
  }
}

/** A finished non-streamed call. Only a successful one carries a body. */
export interface JsonCall {
  /** The parsed body, or `null` if the provider sent something that is not JSON. */
  json: unknown;
  /** Which model answered, if it said. */
  answeredBy: string | null;
  /** `x-generation-id`, for reconciling this call later. */
  generationId: string | null;
}

/**
 * **A whole call, for the three that do not stream**: dictation, the PDF reader,
 * embeddings.
 *
 * Same lifecycle guarantee as the streaming one — the meter is finished on every
 * path, including a refusal, because the call is what cost money and it has
 * happened whatever the caller decides next. A transport blip is asked again,
 * each attempt with a meter of its own (`asTransportAttempts`).
 *
 * Two deliberate refusals in the return type, both from a GPT Sol review:
 *
 * - **A failure returns no text.** It throws `ProviderRefused`, carrying the
 *   status and nothing else. Handing back the provider's words is how a reader's
 *   voice or an article's prose reaches a log, and the boundary that already
 *   discarded them on the streaming path must not have a back door here.
 * - **`json` is `unknown`, not a generic.** A `Promise<T>` here would be an
 *   unchecked cast wearing a type's clothes. All three callers already validate
 *   their own responses, and they should keep doing it where they can say what a
 *   bad one means.
 */
export async function openRouterJson(
  job: ChatJob,
  body: AiRequestBody,
  options?: CallOptions,
): Promise<JsonCall> {
  /* Before the meter — see `prepare`: no attempt, no record. */
  const prepared = prepare(job, body, false, options?.apiKey);
  /* One attempt, one meter, one row. See `asTransportAttempts`. */
  return asTransportAttempts({ job, wire: wireOf(job), model: body.model }, options, async (n) => {
    const meter = new Meter(job, body.model, wireOf(job), prepared.fingerprint, n);
    meter.trustFrameProvider = frameProviderTrusted(body);
    let end: CallEnd = { outcome: "ok" };
    try {
      const response = await send(prepared, options?.signal);
      /* The acceptance boundary of a whole call: `2xx` headers. */
      meter.answered(response, response.ok);
      /* Read once, before the status is judged. A failed body still has to be
         consumed or the connection leaks, and reading it twice throws. */
      const text = await response.text();
      /* **Metered before the status is judged**, the same order as the images
         seam below and for its reason: a `429` whose body carries `usage` is a
         call the provider priced. Until 2026-10-04 this seam judged first, and
         its comment called that "a gap rather than a decision"; `meterBody` says
         the rest. A body that is not JSON comes back `null`, which is what a
         caller has always been handed for one. */
      const json = meterBody(meter, text);
      if (!response.ok) {
        /* The raw text, not the parsed value: `ProviderRefused` classifies by
           matching fixed strings in it, and keeps none of it. */
        throw new ProviderRefused(response.status, text, response.headers, meter.costNanos !== null);
      }
      /* **A `200` that is not an answer is not an `ok` row**, though it is
         still returned. Two shapes: a body that would not parse, and an error
         envelope (`{ error }` and no `choices`). Both were `ok` rows until
         2026-10-06, because the caller is what rejects them and the meter had
         finished by then (src/pdf-read.ts § `refuseBodyError`).

         **Only the row changes.** The caller gets the same `null` or the same
         envelope, throws what it always threw, and its own retry decides what
         it always decided. */
      end = meter.notAnAnswer() ?? end;
      return {
        json,
        answeredBy: meter.answeredBy,
        generationId: meter.generationId,
      };
    } catch (err) {
      end = meter.failed(err, options?.signal);
      throw err;
    } finally {
      meter.finish(end);
    }
  });
}

/* --------------------------------------------------------------- pictures -- */

/**
 * **A picture, on the same gateway and in a shape nothing else here speaks.**
 *
 * `POST /v1/images` with `google/gemini-3.1-flash-image`, for the Illustrated
 * diagram sub-mode — docs/plans/260903c-illustrated-diagram-sub-mode.md, and
 * docs/investigations/260904a-nano-banana-text-in-generated-images.md for the swap.
 *
 * It is in this file, beside `openRouterJson`, rather than in a file of its
 * own, because what this file is *for* is that there is no second way to spend
 * money: one key, one base URL, one `Meter`, one `finally`. A separate module
 * that read `OPENROUTER_API_KEY` and called `fetch` would be exactly the hole
 * the header describes, drawn in a nicer shape — and
 * `tests/no-undeclared-spend.test.ts` would have had to be told to allow it.
 *
 * ## Where it chafes, and what was done about each
 *
 * 1. **There is no `choices` array.** The answer is `data: [{ b64_json,
 *    media_type }]`. So it has its own request type and its own reader, and
 *    reuses neither of the chat ones. `openRouterJson` could have carried the
 *    body as `unknown`, but then every caller would decode base64 itself —
 *    which is the one step that can silently produce zero bytes.
 * 2. **No `provider` block and no `usage: {include: true}`.** Both are chat-wire
 *    furniture that has never been sent to this endpoint. The spike of
 *    2026-09-03 posted five fields and got a complete `usage` object back
 *    unasked, so asking for it would be a guess on the one call whose failure
 *    mode is a 400. See `Route.provider`.
 * 3. **The bill arrives priced, and the BYOK path is still the one to know
 *    about.** `google/gemini-3.1-flash-image` answers `is_byok: false` with a
 *    real `usage.cost` ($0.0676 for a 1K plate, measured 2026-09-04), so the
 *    `Meter` reads it exactly as it reads a chat call — better accounting than
 *    the model it replaced. `openai/gpt-image-2` was served on somebody else's
 *    key and answered `is_byok: true`, `usage.cost: 0`, with the real figure in
 *    `usage.cost_details.upstream_inference_cost`; **nothing here ever did
 *    anything about that**, and that is why the swap needed no money code at
 *    all. `Meter.saw` reads both fields and `normaliseByokUpstream` in
 *    [`ai-spend.ts`](ai-spend.ts) puts the second in `byok_upstream_nanos` under
 *    the three conditions the database CHECK enforces, whichever kind of row a
 *    future model produces.
 *
 * Everything that makes a call accountable is shared unchanged: `apiKey`,
 * `keyFingerprint`, `OPENROUTER_BASE`, `ATTRIBUTION`, `send`, `generationIdOf`,
 * `abortedBy`, `ProviderRefused` and the private `Meter` — begun before the
 * fetch, finished exactly once in a `finally`, so a throw still writes a row.
 */

/** One reference image, inline. `input_references` takes 0-14 of them. */
export interface ImageReference {
  /** `data:image/png;base64,…` — the whole picture in the URL. */
  dataUrl: string;
}

/**
 * What a caller asks for.
 *
 * Named fields rather than `AiRequestBody`'s `Record<string, unknown>`, and
 * that is the `env-proposal` lesson applied at the type level: this endpoint
 * 404s on a parameter its upstream does not know, so a free-form body would be
 * a place for an unmeasured field to arrive without anybody deciding.
 */
export interface ImageRequest {
  model: string;
  prompt: string;
  /** `"2:3"`, `"1:1"`, … Omitted from the body when absent, so the model's default stands. */
  aspectRatio?: string;
  /**
   * `512 | 1K | 2K | 4K`, per the model's own enum. Omitted when absent.
   *
   * **The only size knob this endpoint has for the model we draw with**, and
   * the one the 2026-09-04 spike settled at `1K` — cheaper, faster *and* more
   * legible at thumbnail than `2K`, because the model spends extra pixels on
   * detail rather than on type
   * (docs/investigations/260904a-nano-banana-text-in-generated-images.md).
   *
   * **What is deliberately not here is `quality`, `output_format` and
   * `output_compression`.** They were sent while `openai/gpt-image-2` drew the
   * plates and they are absent from `google/gemini-3.1-flash-image`'s
   * `supported_parameters` — `output_format` measurably so: sent at 1K on
   * 2026-09-04 and ignored, PNG back regardless. An unmeasured body key on this
   * endpoint is what turned a `temperature: 0` into a 404 with no endpoints
   * left (§ `env-proposal`), so a field nothing sends is a field this interface
   * does not have. The history of the three is in this file's git log and in
   * docs/project/diagram.md § Illustrated.
   */
  resolution?: string;
  /** Style and content references. **Omitted entirely when empty**, never sent as `[]`. */
  inputReferences?: readonly ImageReference[];
}

/**
 * One picture, and the two handles that make the call reconcilable afterwards.
 *
 * **No cost on here, deliberately.** A `usdCost: number | null` would have to
 * be one of two different numbers on a BYOK call — what OpenRouter charged (0)
 * or what the inference was worth (0.0132) — and collapsing those into one
 * nullable field is precisely the ambiguity
 * `drizzle/20260902141103_byok_upstream_nanos.sql` was written to remove, at
 * the cost of a doubled total that only TypeScript knew better than. The money
 * is on the ledger row, where it has three named columns and a CHECK; a caller
 * that wants it reads `collectSpend`'s report. `ms` is left off for the same
 * reason in miniature: the row has `duration_ms`, and a caller can hold a clock.
 */
export interface ImageCall {
  /** The decoded bytes, validated. */
  image: Uint8Array;
  /** What the bytes actually are, from the signature — not from what the provider claimed. */
  mediaType: string;
  /** Which model answered, when the response says. `null` on this endpoint today. */
  answeredBy: string | null;
  /** `x-generation-id`, for reconciling this call later. */
  generationId: string | null;
}

/**
 * The request as it goes out.
 *
 * `n: 1` is ours rather than the caller's: a plate is a plate, and a number a
 * caller could pass is a number that can quadruple a bill by being wrong.
 * `tests/ai-call-images.test.ts` asserts these bytes rather than trusting this.
 */
function outgoingImage(job: ImageJob, body: ImageRequest): string {
  const route = routeFor(job);
  const references = body.inputReferences ?? [];
  return JSON.stringify({
    model: body.model,
    prompt: body.prompt,
    n: 1,
    ...(body.aspectRatio === undefined ? {} : { aspect_ratio: body.aspectRatio }),
    ...(body.resolution === undefined ? {} : { resolution: body.resolution }),
    /* **Absent rather than `[]`.** 0-16 is the documented range and an empty
       array is a value inside it that nothing has been measured against;
       omission is what the spike sent when it sent none. */
    ...(references.length === 0
      ? {}
      : {
          input_references: references.map((reference) => ({
            type: "image_url",
            image_url: { url: reference.dataUrl },
          })),
        }),
    /* `null` today, so nothing goes out. Read off the table so that setting it
       is one edit rather than two. */
    ...(route.provider ? { provider: route.provider } : {}),
  });
}

/** The images response, in the shape the spike of 2026-09-03 measured. */
interface ImageBody {
  data?: unknown;
  usage?: unknown;
  model?: unknown;
  provider?: unknown;
}

/**
 * **How big a picture is allowed to be before we call it an attack.**
 *
 * Not tuning knobs — a plate at `resolution: "1K"` and `2:3` measured 848x1264
 * and 1.9 MB of PNG, so every bound here is several times what the feature
 * produces.
 * They exist because the bytes arrive from outside this process. Stage 3 reads
 * the dimensions out of the header rather than decoding — src/assets.ts
 * § `imageDimensions` — so nothing downstream allocates width x height x 4 any
 * more, but a picture claiming 20000x20000 is still either broken or hostile
 * and refusing it here costs one `if`.
 */
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_IMAGE_EDGE = 8192;
const MAX_IMAGE_PIXELS = 33_554_432;

/**
 * **The first plate, decoded and checked — and every failure is a sentence of
 * ours.**
 *
 * Not one word of the provider's body reaches the thrown error, for the reason
 * `ProviderRefused` gives at length: a mangled or refusing response is exactly
 * where an upstream echoes back what we sent it, and what we sent is a prompt
 * quoted from the reader's article.
 *
 * **The signature decides what these bytes are; the provider's `media_type` is
 * only allowed to agree.** Taking the claim would mean the name we hand to the
 * blob store is a promise nobody checked — the same rule `sniffImage`'s own
 * docstring makes for a downloaded figure, which is why this reuses it rather
 * than writing a fourth copy of the PNG signature.
 */
function readPlate(body: ImageBody | null): { image: Uint8Array; mediaType: string } {
  const first = Array.isArray(body?.data) ? body.data[0] : null;
  const plate = (first ?? null) as { b64_json?: unknown; media_type?: unknown } | null;
  const b64 = plate?.b64_json;
  if (typeof b64 !== "string" || b64.length === 0)
    throw new Error("the images endpoint answered with no picture in it");
  /* Base64 that is not base64 does not throw here — `Buffer.from` decodes as
     much as it can and hands back the rest — so an empty result is the only
     signal there is, and a zero-byte "plate" written to the blob store would be
     a silent success of exactly the kind docs/reusable/silent-success.md is
     about. */
  const image = new Uint8Array(Buffer.from(b64, "base64"));
  if (image.byteLength === 0)
    throw new Error("the images endpoint's picture did not decode");
  if (image.byteLength > MAX_IMAGE_BYTES)
    throw new Error("the images endpoint's picture is implausibly large");
  const sniffed = sniffImage(image);
  if (!sniffed)
    throw new Error("the images endpoint answered with bytes that are not a picture");
  const claimed = plate?.media_type;
  if (typeof claimed === "string" && claimed !== sniffed.contentType)
    throw new Error(
      `the images endpoint called its picture ${claimed} and sent ${sniffed.contentType}`,
    );
  /* **Both formats now, and the change is a widening rather than a rewrite.**
     This was PNG-only while the dimension read was private to this file and
     said so; src/assets.ts § `imageDimensions` is the shared version, and a
     JPEG claiming 20000x20000 is exactly as much of a decode bomb as a PNG
     claiming it. `null` still means we could not tell, and the byte cap above
     is what stands behind that case. */
  const size = imageDimensions(image);
  if (
    size &&
    (size.width < 1 ||
      size.height < 1 ||
      size.width > MAX_IMAGE_EDGE ||
      size.height > MAX_IMAGE_EDGE ||
      size.width * size.height > MAX_IMAGE_PIXELS)
  ) {
    throw new Error("the images endpoint's picture claims implausible dimensions");
  }
  return { image, mediaType: sniffed.contentType };
}

/**
 * **A whole image call, from the fetch to the spend record, in one frame.**
 *
 * Same lifecycle guarantee as `openRouterJson`: the meter is finished on every
 * path, refusals included, because the call is what cost money and it has
 * happened whatever the caller decides next. A 200 whose body carries usage but
 * no usable picture is therefore recorded as a call that cost money and
 * `"error"` — which is what it was.
 *
 * **`job` is first and is an `ImageJob`**, which is both halves of the type
 * doing its work: `openRouterImage("chat", …)` will not compile, and neither
 * will `openRouterJson("illustrate", …)`. It is a parameter rather than a
 * constant inside for the reason `openRouterJson`'s is — a `grep` for
 * `openRouterImage(` should say which job is spending, and the day there is a
 * second image job the shape does not have to change. See `ChatJob`.
 */
export async function openRouterImage(
  job: ImageJob,
  body: ImageRequest,
  options?: CallOptions,
): Promise<ImageCall> {
  /* Before the meter — see `prepare`: no attempt, no record. A missing key
     must not leave a spend row for a call that never left the process. */
  const key = apiKey(options?.apiKey);
  const prepared = {
    key,
    payload: outgoingImage(job, body),
    url: `${OPENROUTER_BASE}${routeFor(job).path}`,
  };
  /* One attempt, one meter, one row. See `asTransportAttempts`. */
  return asTransportAttempts({ job, wire: wireOf(job), model: body.model }, options, async (n) => {
    const meter = new Meter(job, body.model, wireOf(job), keyFingerprint(key), n);
    let end: CallEnd = { outcome: "ok" };
    try {
      const response = await send(prepared, options?.signal);
      meter.answered(response, response.ok);
      /* Read once, before the status is judged: a failed body still has to be
         consumed or the connection leaks, and reading it twice throws. */
      const text = await response.text();
      let json: unknown = null;
      let parsed = true;
      try {
        json = JSON.parse(text);
      } catch {
        /* Swallowed and never rethrown: V8 puts a prefix of the offending input
           into the `SyntaxError`, and the input here wraps a prompt quoted from
           the article. `readPlate` throws our own sentence a line below. */
        parsed = false;
      }
      meter.read(parsed, json);
      const record = json as ImageBody | null;
      /* **The usage is read before the status is judged, and before the picture
         is read.** Both orders were wrong once and in the same direction — money
         the provider told us about, thrown away because of what we decided to do
         next:
           - a `200` that generated a plate and then refused to hand it over is
             still billed for the plate it generated;
           - a **`429` whose body carries `usage`** is a call the provider priced,
             and rejecting it on the status before parsing recorded an unpriced
             error row for a plate that had already cost $0.013 (GPT Sol,
             2026-09-03). Nothing about a non-2xx makes its `usage` less true.
         The body is still never quoted: `ProviderRefused` gets the text and
         decides what may be said about it, and nothing from it reaches a message
         of ours. */
      if (record?.usage) meter.saw(record.usage);
      meter.sawModel(record?.model);
      meter.sawUpstream(record?.provider);
      if (!response.ok) {
        throw new ProviderRefused(response.status, text, response.headers, meter.costNanos !== null);
      }
      const plate = readPlate(record);
      return {
        image: plate.image,
        mediaType: plate.mediaType,
        answeredBy: meter.answeredBy,
        generationId: meter.generationId,
      };
    } catch (err) {
      end = meter.failed(err, options?.signal);
      throw err;
    } finally {
      meter.finish(end);
    }
  });
}

/* ----------------------------------------------------------------- voices -- */

/**
 * **A transcript, on the same gateway and in the third shape this file speaks.**
 *
 * `POST /v1/audio/transcriptions` with `openai/gpt-transcribe`, for dictation —
 * docs/plans/260907c-dictation-onto-an-openai-transcriber.md for why it moved
 * off chat/completions on 2026-09-07, and [`transcribe.ts`](transcribe.ts) for
 * everything about *what* gets sent, which is deliberately not decided here.
 *
 * It is in this file, beside `openRouterJson` and `openRouterImage`, for the
 * reason the header gives and `openRouterImage` repeats: what this file is for
 * is that there is no second way to spend money. One key, one base URL, one
 * `Meter`, one `finally`. A module of its own that read `OPENROUTER_API_KEY`
 * and called `fetch` would be the hole this file exists to close, and
 * `tests/no-undeclared-spend.test.ts` would have had to be told to allow it.
 *
 * ## Where it chafes, and what was done about each
 *
 * 1. **There is no `choices` array, and the model we use reports no tokens.**
 *    The answer is `{ text }` and `gpt-transcribe`'s `usage` is
 *    `{ seconds, cost }` — measured at 3 seconds of audio and at 22. The
 *    protocol allows more than that: OpenRouter documents optional
 *    `input_tokens` / `output_tokens` / `total_tokens` here, in different
 *    spellings from the chat wire's, and `WireUsage` reads both spellings so a
 *    model that does send them is not silently uncounted. So it has its own
 *    request type, its own reader and its own `Wire` — see the `transcription`
 *    member in [`models.ts`](models.ts) for why a row on this wire must not be
 *    summed with the chat rows.
 * 2. **`usage: { include: true }` is not sent**, unlike every chat call. It is
 *    chat-wire furniture; this endpoint returns a `usage` object unasked, and
 *    it is the kind of endpoint whose answer to an unmeasured body key is a 400
 *    rather than a shrug — see `Route.provider` and the `env-proposal`
 *    write-up.
 * 3. **No route-level `provider` policy is configured, and here that is a
 *    finding rather than a default.** OpenRouter does not apply routing on this
 *    endpoint: a `zdr: true` and an impossible `only: ["anthropic"]` both answer
 *    200. The `dictation` row in `AI_JOB_ROUTE` carries the measurement and what
 *    it cost the privacy page. The outgoing request *does* carry a `provider`
 *    key when there are keywords — see the next point, and do not read this one
 *    as "nothing under `provider` is sent".
 * 4. **`keywords` is not OpenRouter's field, so it goes down the one channel
 *    they leave open for a provider's own** — `provider.options.openai`. They
 *    document that *"unrecognized keys are silently dropped"*, which makes this
 *    the one parameter here that can stop working without anything going red.
 *    `tests/dictation-keywords.test.ts` is the guard, and it asserts that a
 *    *transcript changes*, never that a request succeeded.
 * 5. **The bill is zero, and that is not a bug in this code.** `usage.cost`
 *    came back `0` for 3 seconds of audio and for 22. `Meter.saw` records what
 *    it is told, so dictation rows carry no cost. `unpriceZero` below drops
 *    that zero so the row reads *unpriced* rather than *free* — which is the
 *    honest state, not a repair. **Reconciliation does not fix it**: `npm run
 *    cost --reconcile` compares our total against the account's and prints the
 *    gap, so it can tell you money is missing and cannot tell you which request
 *    spent it. The spend cap is at OpenRouter and is unaffected; our own
 *    per-job attribution is.
 */

/** What a caller asks for. Named fields, for `ImageRequest`'s reason exactly. */
export interface TranscriptionRequest {
  model: string;
  /** The recording, base64, already checked against the shared size cap. */
  audio: string;
  /** The container, already validated by `isAudioFormat` in dictation-limits.ts. */
  format: AudioFormat;
  /**
   * Spellings the transcriber should expect — *"words or phrases to guide
   * transcription of the input audio"*, and the reason dictation is on this
   * model at all.
   *
   * **Omitted entirely when empty, never sent as `[]`.** An empty array is a
   * value nothing has been measured against, and the caller already warns about
   * the case where it has nothing to say ([`transcribe.ts`](transcribe.ts)).
   */
  keywords?: readonly string[];
}

/** What comes back. `text` is empty for a recording with no speech in it. */
export interface TranscriptionCall {
  text: string;
  answeredBy: string | null;
  generationId: string | null;
  /**
   * **How long the recording was, by the provider's own measure** —
   * `usage.seconds` — or null when the reply did not say.
   *
   * The server has no other way to know: the browser sends bytes, not a
   * duration, and bytes ÷ seconds is the one number that says whether a
   * browser recorded at the bitrate it was asked for. WebKit falls back to
   * 192 kbps *silently* when Core Audio refuses a hint, so without this the
   * iPad fix in docs/plans/260912b-dictation-slow-on-weak-wifi.md could stop
   * working and nothing would say so.
   */
  seconds: number | null;
}

/**
 * Put one OpenAI-specific option into a route's `provider.options`, keeping
 * whatever was already there.
 *
 * Two levels rather than one: `options` may carry other providers' bags, and
 * `options.openai` may carry other OpenAI options. `Route.provider` is typed
 * `Record<string, unknown>`, so both levels are read defensively rather than
 * asserted — an `options` that is not an object is a malformed row and is
 * dropped in favour of the one thing we know we need to send.
 */
function mergeOpenAiOption(
  existing: unknown,
  add: Record<string, unknown>,
): Record<string, unknown> {
  const options = isRecord(existing) ? existing : {};
  const openai = isRecord(options.openai) ? options.openai : {};
  return { ...options, openai: { ...openai, ...add } };
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function outgoingTranscription(
  job: TranscriptionJob,
  body: TranscriptionRequest,
): string {
  const route = routeFor(job);
  const keywords = body.keywords ?? [];
  /**
   * **The routing policy and the vocabulary share one key, so they are merged
   * rather than spread.**
   *
   * The first version of this wrote `...{provider: {options: …}}` and then
   * `...(route.provider ? {provider: route.provider} : {})`, which is the
   * ordinary shape everywhere else in this file and is a trap here: both write
   * `provider`, so the second wins outright. It was harmless only because
   * `dictation.provider` is `null` — and the day somebody gives that row an
   * object, **the vocabulary stops being sent and the only symptom is a
   * slightly worse transcript**. No error, no red test, just "Spiderrion"
   * coming back again. Found by a subagent reading the two files side by side,
   * which is the same way GPT Sol found the eval that reimplemented the request
   * it was measuring.
   *
   * `undefined` when there is nothing to say, so the key is absent rather than
   * `{}` — an empty `provider` is a value nothing has been measured against.
   */
  const provider =
    keywords.length === 0 && !route.provider
      ? undefined
      : {
          ...route.provider,
          ...(keywords.length === 0
            ? {}
            : {
                /* **Nested, because a shallow merge only moved the collision one
                   level down.** `{...route.provider, options: {...}}` keeps
                   `zdr` and `require_parameters` and then replaces the whole
                   `options` bag — so a row carrying another provider's options,
                   or another OpenAI option, would lose them exactly as the
                   keywords were being lost before. The comment above promised a
                   general merge and the first fix did not deliver one; GPT Sol's
                   review of the built code, finding 4. */
                options: mergeOpenAiOption(route.provider?.options, {
                  keywords,
                }),
              }),
        };
  return JSON.stringify({
    model: body.model,
    input_audio: { data: body.audio, format: body.format },
    /* `json` rather than `verbose_json`: the extra field is timestamps nothing
       here reads, and OpenRouter documents some models rejecting the verbose
       form outright. */
    response_format: "json",
    ...(provider ? { provider } : {}),
  });
}

/**
 * **What the transcriber said**, or our own sentence instead of it.
 *
 * Nothing from the body is quoted into what this throws — the rule
 * [`transcribe.ts`](transcribe.ts) states at length, and it is sharper on this
 * wire than on any other, because a provider that echoes a request back is
 * echoing a reader's **voice**.
 */
/**
 * **A `cost: 0` from a paid model means "not priced", not "free".**
 *
 * This endpoint answers `usage: {seconds, cost}` and the cost is `0` — at 3
 * seconds of audio and at 22, measured 2026-09-07 — for a model OpenRouter
 * lists at $0.0045/minute. `Meter.saw` takes any number it is given as the
 * provider's settled price, so passing that straight through writes a row
 * saying the call was free, with `source: "provider"` asserting that the
 * provider *told* us so. Owner and job totals then understate by exactly the
 * amount nobody can see, and `npm run cost` reports a confident zero rather
 * than a gap.
 *
 * Dropping the field instead makes the row say `source: "none"` — *the total is
 * short by an unknown amount and says so*, which is the honest state and one
 * `ai-spend.ts` already has a vocabulary for. The account-level reconciliation
 * remains the only way to recover the real figure.
 *
 * **Only an exact zero is dropped**, so the day OpenRouter starts pricing these
 * calls the number is used without anybody having to notice. GPT Sol's plan
 * review, finding 3.
 */
function unpriceZero(usage: unknown): unknown {
  if (!usage || typeof usage !== "object") return usage;
  const u = usage as { cost?: unknown; is_byok?: unknown };
  if (u.cost !== 0) return usage;
  /* **A BYOK zero is a real zero, and dropping it loses the upstream figure.**
     `normaliseByokUpstream` in ai-spend.ts only writes `byok_upstream_nanos`
     when the row's cost `source` is `"provider"` — the shape where OpenRouter
     charged nothing because somebody else's key paid, and the true amount is in
     `cost_details.upstream_inference_cost`. Unpricing that zero flips the source
     to `"none"` and throws the upstream charge away, turning a fully-known cost
     into an unknown one. That is the opposite of what this function is for.
     GPT Sol's review of the built code, finding 1. */
  if (u.is_byok === true) return usage;
  const { cost: _dropped, ...rest } = u;
  return rest;
}

export class UnreadableAnswer extends Error {}

function readTranscript(body: unknown): string {
  const said = (body as { text?: unknown } | null)?.text;
  /* **Its own class, so the caller can tell "answered nonsense" from "never
     answered".** It was a bare `Error`, which `transcribe.ts` could only catch
     alongside a DNS failure and an aborted socket — so a 200 carrying a body we
     could not read was reported to the reader as *"could not be reached"*, of a
     service that had been reached and had replied. GPT Sol's review of the
     built code. Carries no part of the body, for this wire's usual reason: it
     may be a reader's voice echoed back. */
  if (typeof said !== "string")
    throw new UnreadableAnswer("the transcription answer had no text field");
  return said;
}

export async function openRouterTranscription(
  job: TranscriptionJob,
  body: TranscriptionRequest,
  options?: CallOptions,
): Promise<TranscriptionCall> {
  /* Before the meter — see `prepare`: no attempt, no record. */
  const key = apiKey(options?.apiKey);
  /* **And an abort that has already happened is also "no attempt".** `fetch`
     rejects an already-aborted signal without sending a byte, so constructing
     the meter first writes a row for a call that never left the process —
     `routes.ts` installs the reader-disconnected signal *before* `transcribe`
     spends time building a vocabulary, so by the time the gateway is reached it
     can genuinely be aborted already. The image wire has the same hole and
     `tests/ai-call-images.test.ts` characterises it; this one does not.
     A signal that aborts after this line still records, which is right: the
     request had left. GPT Sol's review of the built code, finding 3. */
  options?.signal?.throwIfAborted();
  const prepared = {
    key,
    payload: outgoingTranscription(job, body),
    url: `${OPENROUTER_BASE}${routeFor(job).path}`,
  };
  /* One attempt, one meter, one row. See `asTransportAttempts`. */
  return asTransportAttempts({ job, wire: wireOf(job), model: body.model }, options, async (n) => {
    const meter = new Meter(job, body.model, wireOf(job), keyFingerprint(key), n);
    let end: CallEnd = { outcome: "ok" };
    try {
      const response = await send(prepared, options?.signal);
      meter.answered(response, response.ok);
      /* Read once, before the status is judged: a failed body still has to be
         consumed or the connection leaks, and reading it twice throws. */
      const text = await response.text();
      let json: unknown = null;
      let parsed = true;
      try {
        json = JSON.parse(text);
      } catch {
        /* Swallowed and never rethrown. V8 puts a prefix of the offending input
           into the `SyntaxError`, and the input here is base64 of somebody
           talking. `readTranscript` throws our own sentence below. */
        parsed = false;
      }
      meter.read(parsed, json);
      const record = json as
        | { usage?: unknown; model?: unknown; provider?: unknown }
        | null;
      /* Usage before the status, for the reason `openRouterImage` sets out: a
         non-2xx carrying a priced `usage` is still a call somebody billed, and
         nothing about the status makes that number less true. */
      if (record?.usage) meter.saw(unpriceZero(record.usage));
      meter.sawModel(record?.model);
      meter.sawUpstream(record?.provider);
      if (!response.ok) {
        throw new ProviderRefused(response.status, text, response.headers, meter.costNanos !== null);
      }
      const usage = isRecord(record?.usage) ? record.usage : {};
      return {
        text: readTranscript(record),
        answeredBy: meter.answeredBy,
        generationId: meter.generationId,
        seconds:
          typeof usage.seconds === "number" && Number.isFinite(usage.seconds) && usage.seconds > 0
            ? usage.seconds
            : null,
      };
    } catch (err) {
      end = meter.failed(err, options?.signal);
      throw err;
    } finally {
      meter.finish(end);
    }
  });
}

/* ------------------------------------------------------------- decisions -- */

/**
 * **OpenRouter's Decisions API** — `POST /api/alpha/decisions`, where a model
 * answers named, typed questions about a `state` with probabilities rather than
 * text. Quick search's one call (src/quick-search.ts, plan 261002e).
 *
 * Modelled line for line on `openRouterTranscription`, and for the same reasons
 * it is its own seam rather than a body handed to `openRouterJson`:
 *
 * 1. **The answer is `{answers: {<key>: {noul}}}`**, no `choices` anywhere, so
 *    a chat parser would read it as an empty reply. Its own request type, its
 *    own reader and its own `Wire`.
 * 2. **`usage` arrives in the transcription wire's spelling** —
 *    `{input_tokens, output_tokens, cost}` — which `Meter.saw` already reads.
 *    Output is free on Jev, so `output_tokens` is a count with no price on it;
 *    it is recorded anyway, because a token column nobody fills reads as zero.
 * 3. **`usage: { include: true }` is not sent**, nor anything else the spike did
 *    not measure. The body is `{model, state, questions}` exactly. This is an
 *    alpha endpoint; its answer to an unmeasured key is the thing nobody knows.
 * 4. **A refusal's reason is a JSON string inside `error.message`** —
 *    `ProviderRefused.kind` classifies the one a caller acts on
 *    (`"context-exceeded"`), and the body goes no further than that, for this
 *    file's usual reason: it may echo the article back.
 *
 * Two kinds of question are typed here, because they are the two the app
 * asks: `noul` (a yes/no answered as a probability — quick search) and, since
 * 2026-10-03, `choice` (one of several named options, with a probability for
 * each — the command bar's pick, plan 261003k; its answer's shape is the one
 * evals/command-pick/ saved 600 of). `score` exists on the wire and was ruled
 * out by the spike; adding it is a member of `DecisionQuestion` and a branch in
 * `readDecisions`.
 */
export type DecisionQuestion =
  | {
      type: "noul";
      /** The question, in words, naming the part of `state` it is about. */
      instructions: string;
    }
  | {
      type: "choice";
      instructions: string;
      /** Each option's key, and the words that say when to choose it. */
      criteria: Record<string, string>;
    };

/** One `choice` question's answer. */
export interface DecisionChoice {
  /** The key the model chose — **not checked against `criteria` here**; the caller knows what it offered. */
  choice: string;
  /** How sure, in [0, 1]. */
  confidence: number;
  /** Every option the model gave a probability in [0, 1], by key. */
  probabilities: Record<string, number>;
}

/** What a caller asks for. Named fields, for `ImageRequest`'s reason. */
export interface DecisionRequest {
  model: string;
  /** The material every question is judged against. Billed once, not per question. */
  state: Record<string, unknown>;
  /** One entry per answer wanted, keyed by whatever the caller will look it up by. */
  questions: Record<string, DecisionQuestion>;
}

/** What comes back. */
export interface DecisionCall {
  /**
   * Each question's probability of *yes*, keyed as asked. **Only the answers
   * that were a number in [0, 1]** — a question the model did not answer, or
   * answered with something else, is absent rather than guessed at, and the
   * caller can count the gap against what it asked.
   */
  noul: Record<string, number>;
  /**
   * Each `choice` question's answer, keyed as asked — and absent, for the
   * reason above, unless it named a choice and a confidence in [0, 1].
   */
  choice: Record<string, DecisionChoice>;
  answeredBy: string | null;
  generationId: string | null;
  /** The meter's own reading of `usage`, so a caller logs the figure the ledger holds. */
  inputTokens: number | null;
  outputTokens: number | null;
}

const isProbability = (p: unknown): p is number =>
  typeof p === "number" && Number.isFinite(p) && p >= 0 && p <= 1;

function readDecisions(body: unknown): Pick<DecisionCall, "noul" | "choice"> {
  const answers = (body as { answers?: unknown } | null)?.answers;
  /* Its own class, for `readTranscript`'s reason: "answered nonsense" and
     "never answered" are different failures, and a `{}` read as "nothing
     matched" is the one a reader could never diagnose. Carries no part of the
     body. */
  if (!isRecord(answers))
    throw new UnreadableAnswer("the decisions answer had no answers object");
  const noul: Record<string, number> = {};
  const choice: Record<string, DecisionChoice> = {};
  for (const [key, answer] of Object.entries(answers)) {
    if (!isRecord(answer)) continue;
    if (isProbability(answer.noul)) noul[key] = answer.noul;
    /* A choice with no confidence is not read as a sure one, or as an unsure
       one: it is left out, and the caller sees the gap. */
    if (typeof answer.choice === "string" && isProbability(answer.confidence)) {
      const probabilities: Record<string, number> = {};
      if (isRecord(answer.probabilities)) {
        for (const [option, p] of Object.entries(answer.probabilities)) {
          if (isProbability(p)) probabilities[option] = p;
        }
      }
      choice[key] = { choice: answer.choice, confidence: answer.confidence, probabilities };
    }
  }
  return { noul, choice };
}

export async function openRouterDecisions(
  job: DecisionJob,
  body: DecisionRequest,
  options?: CallOptions,
): Promise<DecisionCall> {
  /* Before the meter — see `prepare`: no attempt, no record. */
  const key = apiKey(options?.apiKey);
  /* And an abort that has already happened is also "no attempt" — see the same
     line in `openRouterTranscription`. Quick search fires its chunks in
     parallel, and a reader who leaves while one is being halved reaches here
     already aborted. */
  options?.signal?.throwIfAborted();
  const route = routeFor(job);
  const prepared = {
    key,
    payload: JSON.stringify({
      model: body.model,
      state: body.state,
      questions: body.questions,
      /* `Route.provider` is `null` for the one job here; spread rather than
         dropped, so a row that gains a policy sends it rather than having it
         ignored in silence. */
      ...(route.provider ? { provider: route.provider } : {}),
    }),
    url: `${OPENROUTER_BASE}${route.path}`,
  };
  /* One attempt, one meter, one row. See `asTransportAttempts`. */
  return asTransportAttempts({ job, wire: wireOf(job), model: body.model }, options, async (n) => {
    const meter = new Meter(job, body.model, wireOf(job), keyFingerprint(key), n);
    let end: CallEnd = { outcome: "ok" };
    try {
      const response = await send(prepared, options?.signal);
      meter.answered(response, response.ok);
      /* Read once, before the status is judged — `openRouterTranscription`. */
      const text = await response.text();
      let json: unknown = null;
      let parsed = true;
      try {
        json = JSON.parse(text);
      } catch {
        /* Swallowed and never rethrown: V8 quotes a prefix of the input, and the
           input here may be the article echoed back. `readDecisions` throws our
           own sentence below. */
        parsed = false;
      }
      meter.read(parsed, json);
      const record = json as
        | { usage?: unknown; model?: unknown; provider?: unknown }
        | null;
      /* Usage before the status, for `openRouterImage`'s reason: a non-2xx that
         carries a priced `usage` is still a call somebody billed. `unpriceZero`
         for its own reason: Jev's input is priced, so a `cost: 0` would be a
         row claiming to be free rather than one saying it was not told. */
      if (record?.usage) meter.saw(unpriceZero(record.usage));
      meter.sawModel(record?.model);
      meter.sawUpstream(record?.provider);
      if (!response.ok) {
        throw new ProviderRefused(response.status, text, response.headers, meter.costNanos !== null);
      }
      return {
        ...readDecisions(record),
        answeredBy: meter.answeredBy,
        generationId: meter.generationId,
        inputTokens: meter.inputTokens,
        outputTokens: meter.outputTokens,
      };
    } catch (err) {
      end = meter.failed(err, options?.signal);
      throw err;
    } finally {
      meter.finish(end);
    }
  });
}
