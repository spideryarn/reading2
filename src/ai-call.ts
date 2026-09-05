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
 * that way.
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
  type SpendRecord,
  beginSpend,
  keyFingerprint,
  recordSpend,
} from "./ai-spend.js";
/* `sniffImage` says what a picture actually is, from its signature. Reused
   rather than re-implemented so this repo has one statement of the PNG magic
   bytes; `assets.ts` imports nothing at all, so this closes no cycle. */
import { imageDimensions, sniffImage } from "./assets.js";
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
import {
  type StreamChunk,
  readerAborted,
  type StreamEnd,
  sseChunks,
  type Usage,
  whereSearchCountCameFrom,
} from "./openrouter-stream.js";
import { type Nanos, providerCostToNanos } from "./pricing.js";

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
  /* **Our own clocks, then the reader, then what the provider said.** The first
     two are the order every caller already had, and they have to come first
     because a deadline or a stall aborts the reader's signal too — so all three
     arrive as one aborted signal and only `readerAborted` tells them apart.
     Mutating this order turns three tests in tests/openrouter-stream.test.ts red.

     **The reader beats a `finish_reason` that has already arrived**, and that
     is a real edge worth knowing: a provider that said `error` and *then* lost
     its reader before `[DONE]` classifies as `abandoned`, so the caller applies
     its abandonment policy rather than its failure policy. Deliberate — it is
     what every caller did before this function existed, and the alternative
     asks a reader who has gone to be told off for the provider's fault. Note it
     differs from an `error` arriving as `chunk.error` *data*, which every caller
     throws on inside the loop and which therefore never reaches here.
     GPT Sol's review of Stage C, 2026-09-01. */
  if (deadline.aborted) return { kind: "timed-out" };
  if (stalled.aborted) return { kind: "went-quiet" };
  if (readerAborted(signal, deadline, stalled)) return { kind: "abandoned" };
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

/** The three paths this app posts to. A union, so a fourth cannot be invented. */
export type OpenRouterPath =
  | "/v1/chat/completions"
  | "/v1/embeddings"
  /* Pictures. `openRouterImage` below is the only thing that sends here, and
     `illustrate` is the only job routed to it. */
  | "/v1/images";

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

/** Every job with a row in `AI_JOB_ROUTE`: everything this file can send. */
export type RoutedJob = ChatJob | ImageJob;

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
 * - **`dictation` has no `order`, and that omission is the point.** The three
 *   Anthropic-bound calls pin the upstream so repeat calls land on the cache;
 *   copied onto a Gemini model that preference is not merely useless, it is
 *   wrong *quietly* — OpenRouter finds no Anthropic upstream, falls through to
 *   the real one, and answers. `zdr` is the load-bearing one: the copy beside
 *   the microphone says the reader's voice is not stored, and this app can only
 *   speak for itself unless the routing says otherwise.
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
  dictation: {
    path: "/v1/chat/completions",
    wire: "chat",
    provider: { zdr: true, require_parameters: true },
  },
  pdf: {
    path: "/v1/chat/completions",
    wire: "chat",
    provider: { require_parameters: true, allow_fallbacks: false },
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
     docs/research/260902b-env-key-proposal-spike.md. */
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
  | "hierarchy"
  | "labels"
  | "arc"
  | "tweets"
  | "glossary"
  | "quotes"
  | "ideas"
  | "sketch"
  | "timeline"
  /* **The brief, not the plate.** `illustrated` writes the words an image model
     draws from and goes down the Messages wire like every other article-reading
     stage; `illustrate` two entries below is the picture itself, excluded for a
     different reason. Two jobs, one feature, and the pair is the reason both
     names appear in this list — src/illustrated.ts. */
  | "illustrated"
  /* Generation only. `quiz-mark` is a separate `Task` and stays IN — it is a
     request-path call on chat/completions and needs a route below. */
  | "quiz"
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
   */
  readonly kind: "no-endpoints" | null;
  /** `Retry-After`, parsed to milliseconds, or `null` if it was absent or nonsense. */
  readonly retryAfterMs: number | null;
  constructor(status: number, body: string, headers: Headers) {
    super(providerHttpFailure(status).message);
    this.name = "ProviderRefused";
    this.status = status;
    this.kind =
      status === 404 && body.includes("No endpoints available")
        ? "no-endpoints"
        : null;
    this.retryAfterMs = headers ? retryAfterMs(headers) : null;
  }
}

/**
 * `Retry-After` as a number of milliseconds. Seconds or an HTTP date; both are
 * legal.
 *
 * **What the provider actually said, not what a caller can afford.** This
 * clamped to 30 s until 2026-09-04, which meant a header saying *ten minutes*
 * and one saying *thirty seconds* arrived here indistinguishable — so the only
 * caller that wanted to *decide* about a long wait could not tell there had been
 * one, and asked again well inside a window the provider had just told it was
 * closed. Truncating an instruction and then obeying the truncation is the
 * dishonest shape ⟨GPT Sol, 2026-09-04⟩; how long a wait is affordable is a
 * property of the caller's deadline, and the callers have one each
 * (src/pdf-read.ts § `MAX_RETRY_AFTER_MS`, src/embeddings.ts § `backoffMs`).
 *
 * Still a parsed number and never a string: nothing a provider wrote leaves
 * this function — see `ProviderRefused`.
 *
 * **Exported since 2026-09-05** for the deepening wave
 * (src/hierarchy-deepen.ts), which meets its 429s on the Anthropic SDK's road
 * rather than this one and so has an `APIError` with a `Headers` on it instead
 * of a `ProviderRefused`. The header is the same header; a second parser for it
 * would be a second opinion about what "a minute" means, and the two would
 * disagree the day one of them learned about the HTTP-date form.
 */
export function retryAfterMs(headers: Headers): number | null {
  const header = headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(header) - Date.now();
  return Number.isFinite(ms) && ms > 0 ? ms : null;
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
  ) {
    /* Registered *before* the network call, so a request that never comes back
       leaves a trace. See `PendingCall` in ai-spend.ts. */
    this.callId = beginSpend(job, model);
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
    this.inputTokens = num(u.prompt_tokens) ?? this.inputTokens;
    this.outputTokens = num(u.completion_tokens) ?? this.outputTokens;
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

  /** Which upstream answered, when the frame says. The Messages wire gets this free. */
  sawUpstream(provider: unknown): void {
    if (typeof provider === "string" && provider.length > 0)
      this.upstream = provider;
  }

  /**
   * Record the call. **Idempotent**, because the alternative double-counts: a
   * caller that finishes in a `finally` and again on an error path is an
   * ordinary mistake, and a cost table that over-reports is worse than one that
   * under-reports — it is wrong in the direction that looks like the thing you
   * were trying to measure. The same bug was found on the other wire by a GPT
   * Sol review, where `finalMessage()` could be awaited twice.
   */
  finish(outcome: SpendRecord["outcome"]): void {
    if (this.done) return;
    this.done = true;
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
        outcome,
      },
      this.callId,
    );
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
  return JSON.stringify({
    ...body,
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
 * repository. Callers log the operator's half themselves, because they know
 * which feature just failed.
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
  if (!key) throw new Error(NOT_CONFIGURED.message);
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
 * left the process. Every caller happens to validate its own key first today,
 * which is exactly why nothing caught it. Raised by a GPT Sol review of the
 * code.
 */
function prepare(
  job: ChatJob,
  body: AiRequestBody,
  streaming: boolean,
  key0: string | undefined,
): { key: string; payload: string; url: string; fingerprint: string } {
  const key = apiKey(key0);
  return {
    key,
    payload: outgoing(job, body, streaming),
    url: `${OPENROUTER_BASE}${pathFor(job)}`,
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

function send(
  prepared: { key: string; payload: string; url: string },
  signal: AbortSignal | undefined,
): Promise<Response> {
  return fetch(prepared.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${prepared.key}`,
      "Content-Type": "application/json",
      ...ATTRIBUTION,
    },
    ...(signal ? { signal } : {}),
    body: prepared.payload,
  });
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
 * Drain a failed response and throw the status, never the words.
 *
 * The body **has** to be consumed or the connection leaks; nothing here wants to
 * know what it said.
 */
async function refuse(response: Response): Promise<never> {
  const body = await response.text().catch(() => "");
  throw new ProviderRefused(response.status, body, response.headers);
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
}

/**
 * **A streamed call, from the fetch to the spend record, in one frame.**
 *
 * Lazy: nothing is sent until the first `next()`. From then the `finally` below
 * owns the call, so every way out — the consumer breaking early, the consumer
 * throwing, an abort, a provider dying mid-answer, a 429, a body that will not
 * read — records what was spent.
 *
 * The caller's per-chunk loop does not change. It gets the same `StreamChunk`s
 * `sseChunks` yields; what it loses is the fetch, the status check, and the
 * ability to forget the accounting.
 *
 * `signal.aborted` decides `"aborted"` against `"error"`. That is a coarser
 * question than the one [`stoppedByReader`](openrouter-stream.ts) answers — that
 * one separates a reader pressing Stop from our own deadline, which matters to
 * the reader and does not matter to the bill.
 */
export async function* openRouterStream(
  job: ChatJob,
  body: AiRequestBody,
  options: StreamOptions,
): AsyncGenerator<StreamChunk> {
  /* Before the meter — see `prepare`: no attempt, no record. */
  const prepared = prepare(job, body, true, options.apiKey);
  const meter = new Meter(job, body.model, wireOf(job), prepared.fingerprint);
  let outcome: SpendRecord["outcome"] = "ok";
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
   */
  let ranToEnd = false;
  try {
    const response = await send(prepared, options.signal);
    meter.generationId = generationIdOf(response);
    if (!response.ok || !response.body) await refuse(response);
    /* Non-null: `refuse` throws, but TypeScript cannot see through the `await`. */
    const stream = response.body as ReadableStream<Uint8Array>;
    /* **Reset, so a reused `end` cannot carry a stale verdict into a new
       stream.** `converse` runs up to four requests in a turn; it builds a fresh
       object for each, so nothing depends on this today — which is exactly when
       to write it, because the next caller to loop will not know it had to. */
    options.end.finishReason = null;
    options.end.answered = false;
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
      /* **Every chunk that has one, not just the last.** The usage chunk is
         normally the final one and carries no choices — but "normally" is doing
         work in that sentence, and overwriting with each one costs nothing and
         cannot be wrong about which was last. */
      if (chunk.usage) meter.saw(chunk.usage);
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
    outcome = abortedBy(err, options.signal) ? "aborted" : "error";
    throw err;
  } finally {
    if (outcome === "ok") {
      /* **An abort can end the loop cleanly**, because `sseChunks` cancels the
         reader on abort and a cancelled read resolves `{done: true}` rather than
         throwing. Both streaming callers carry a guard for exactly that race in
         their own logging; this is its equivalent for the bill. */
      if (options.signal.aborted) outcome = "aborted";
      /* The consumer closed us early — see `ranToEnd` above. */
      else if (!ranToEnd) outcome = "aborted";
      /* **The stream stopped without saying it had finished.** `[DONE]` is the
         only clean end there is, and every caller already treats its absence as
         a failure (`ENDED_UNFINISHED`). Recording that call as `"ok"` made the
         spend row and the feature's own verdict disagree about the same event —
         the kind of disagreement nobody notices until they are reconciling a
         bill. Raised by a GPT Sol review. */
      else if (!options.end.terminated) outcome = "error";
    }
    meter.finish(outcome);
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
 * happened whatever the caller decides next.
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
  options?: { signal?: AbortSignal; apiKey?: string },
): Promise<JsonCall> {
  /* Before the meter — see `prepare`: no attempt, no record. */
  const prepared = prepare(job, body, false, options?.apiKey);
  const meter = new Meter(job, body.model, wireOf(job), prepared.fingerprint);
  let outcome: SpendRecord["outcome"] = "ok";
  try {
    const response = await send(prepared, options?.signal);
    meter.generationId = generationIdOf(response);
    /* Read once, before the status is judged. A failed body still has to be
       consumed or the connection leaks, and reading it twice throws. */
    const text = await response.text();
    /* **The images seam does this the other way round on purpose**, parsing the
       body and metering any `usage` in it *before* judging the status, because
       a `429` there arrives carrying the cost of a plate that was already drawn
       (`openRouterImage` below). It has not been changed here, and that is a
       gap rather than a decision: no non-2xx on this wire has been *observed*
       carrying usage, and nobody has looked. If you are here because a chat
       call's money went missing, this is the line. */
    if (!response.ok) {
      outcome = "error";
      throw new ProviderRefused(response.status, text, response.headers);
    }
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* Left as `null`, and the parse error is never rethrown from here: V8 puts
         the first characters of the offending input into the `SyntaxError`
         message, so a mangled response can carry a prefix of what we sent it —
         which on this wire is an article, a reader's question, or their voice.
         See `providerSpokeNonsense` in openrouter-stream.ts. */
    }
    const record = json as
      | { usage?: unknown; model?: unknown; provider?: unknown }
      | null;
    if (record?.usage) meter.saw(record.usage);
    meter.sawModel(record?.model);
    meter.sawUpstream(record?.provider);
    return {
      json,
      answeredBy: meter.answeredBy,
      generationId: meter.generationId,
    };
  } catch (err) {
    if (outcome === "ok")
      outcome = abortedBy(err, options?.signal) ? "aborted" : "error";
    throw err;
  } finally {
    meter.finish(outcome);
  }
}

/* --------------------------------------------------------------- pictures -- */

/**
 * **A picture, on the same gateway and in a shape nothing else here speaks.**
 *
 * `POST /v1/images` with `google/gemini-3.1-flash-image`, for the Illustrated
 * diagram sub-mode — docs/plans/260903c-illustrated-diagram-sub-mode.md, and
 * docs/research/260904a-nano-banana-text-in-generated-images.md for the swap.
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
   * (docs/research/260904a-nano-banana-text-in-generated-images.md).
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
  options?: { signal?: AbortSignal; apiKey?: string },
): Promise<ImageCall> {
  /* Before the meter — see `prepare`: no attempt, no record. A missing key
     must not leave a spend row for a call that never left the process. */
  const key = apiKey(options?.apiKey);
  const prepared = {
    key,
    payload: outgoingImage(job, body),
    url: `${OPENROUTER_BASE}${routeFor(job).path}`,
  };
  const meter = new Meter(job, body.model, wireOf(job), keyFingerprint(key));
  let outcome: SpendRecord["outcome"] = "ok";
  try {
    const response = await send(prepared, options?.signal);
    meter.generationId = generationIdOf(response);
    /* Read once, before the status is judged: a failed body still has to be
       consumed or the connection leaks, and reading it twice throws. */
    const text = await response.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* Swallowed and never rethrown: V8 puts a prefix of the offending input
         into the `SyntaxError`, and the input here wraps a prompt quoted from
         the article. `readPlate` throws our own sentence a line below. */
    }
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
      outcome = "error";
      throw new ProviderRefused(response.status, text, response.headers);
    }
    const plate = readPlate(record);
    return {
      image: plate.image,
      mediaType: plate.mediaType,
      answeredBy: meter.answeredBy,
      generationId: meter.generationId,
    };
  } catch (err) {
    if (outcome === "ok")
      outcome = abortedBy(err, options?.signal) ? "aborted" : "error";
    throw err;
  } finally {
    meter.finish(outcome);
  }
}
