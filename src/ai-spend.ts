/**
 * **What the model calls in one piece of work cost** — collected without any
 * stage having to carry a total up to whoever wants it.
 *
 * The same shape as [`src/owner.ts`](owner.ts), and for the same reason. A
 * pipeline step is not one model call: `summarise` batches per parent, `labels`
 * fans out, `glossary` and `ideas` each make one but sit four frames below
 * `src/jobs.ts`. Threading a running total back up means a return-type change on
 * every stage and a place to forget it in each. `AsyncLocalStorage` is Node's
 * own answer, survives every `await`, and costs the stages nothing — they call
 * nothing at all. [`src/messages-stream.ts`](messages-stream.ts) records for
 * them, which is the point: the one seam every paid Messages call already goes
 * through is the one place this cannot be forgotten.
 *
 * ## Outside a scope this is a no-op, deliberately — and it counts them
 *
 * `currentOwnerId()` throws when nobody opened a box, because a store read
 * outside a request is a bug. This is the opposite case: a stage run from the
 * CLI, or from a test, is a perfectly ordinary thing and must not fail because
 * nobody was keeping accounts.
 *
 * But "silently does nothing" is how a cost table ends up empty while every
 * call succeeds, so it is not silent: `unscopedCalls()` counts what fell on the
 * floor, and anything that reports spend should say so rather than present a
 * total that is quietly missing rows. See
 * [silent-success.md](../docs/reusable/silent-success.md).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { log } from "./log.js";
import type { Nanos } from "./pricing.js";
/* **Type-only, and it has to stay type-only.** `src/models.ts` reaches
   `src/embeddings.ts`, which reaches `src/ai-call.ts`, which reaches this file —
   so a value import here closes a runtime cycle, and entering it from the wrong
   end throws `Cannot access 'EMBEDDING_MODEL' before initialization`. A `type`
   import is erased and adds no edge. That is also why `wire` is a field the two
   gateways fill in rather than something looked up from `AI_JOB_WIRE` here. */
import type { AiJob, Wire } from "./models.js";
import { currentOwnerId } from "./owner.js";

/**
 * One paid model call, as it actually happened.
 *
 * Everything the provider did not tell us is `null` rather than `0` — a zero
 * here is indistinguishable from a free call and would understate a bill for as
 * long as nobody looked.
 */
export interface SpendRecord {
  /**
   * Which job made the call.
   *
   * `AiJob`, not `Task`: transcribing a PDF, embedding a paragraph and
   * transcribing a reader's voice are deliberately not on a reasoning tier and
   * so are deliberately not `Task`s — see [`src/models.ts`](models.ts). **The
   * bill does not care about tiers**, and keying this on `Task` would have left
   * three real calls with nowhere to be recorded.
   */
  job: AiJob;
  /**
   * Which shape of API this went over, said by the gateway that sent it.
   *
   * Filled in here rather than looked up from `AI_JOB_WIRE`, for the import
   * reason at the top of this file — and it is the more honest place anyway,
   * since the gateway is the thing that knows what it actually sent.
   */
  wire: Wire;
  /** The model id as sent, in OpenRouter's spelling. */
  model: string;
  /**
   * Which model actually answered, when the response said — **not always the one
   * asked for.** OpenRouter may serve a variant, and a report that shows only
   * the requested id will attribute the money to a model that never ran.
   * `null` when the response did not say.
   */
  answeredBy: string | null;
  /** OpenRouter's own figure, in nano-dollars. `null` when it did not arrive. */
  costNanos: Nanos | null;
  /**
   * `cost_details.upstream_inference_cost`, in nano-dollars — **a different
   * definition of money from `costNanos`, kept because under BYOK they diverge.**
   *
   * `usage.cost` is what OpenRouter charged our credits. The upstream figure is
   * what the inference itself was worth. On an ordinary call they agree; on a
   * BYOK call `cost` is 0 and this is not, and a spend limit that read only the
   * first would let BYOK traffic through for free. Raised by a GPT Sol review —
   * see also `isByok`, which says which case a zero is.
   */
  upstreamCostNanos: Nanos | null;
  /**
   * **Which bill this call lands on.** `"openrouter"` for anything through
   * either gateway; `"anthropic"` for a declared bypass that talks to Anthropic
   * directly. Two accounts spend money in this repo and only one of them can be
   * reconciled, so the row has to say which.
   */
  providerAccount: ProviderAccount;
  /**
   * **Our own arithmetic**, for a call nobody can be asked about.
   *
   * Never set at the same time as `costNanos`: OpenRouter's figure is settled
   * and ours is an estimate, and a row that carried both would invite somebody
   * to pick. Only the declared bypasses fill this, from
   * [`priceAnthropicCall`](pricing.ts).
   */
  computedCostNanos: Nanos | null;
  /** `checked/effective-from` of the price row that did it. Null unless computed. */
  priceVersion: string | null;
  /** `x-generation-id` — the key to `GET /api/v1/generation?id=…` later. */
  generationId: string | null;
  /** Which upstream answered: `"Anthropic"`, `"Claude Platform on AWS"`, … */
  upstream: string | null;
  /**
   * A short, safe fingerprint of the key that paid — see `AiCallRow`, which is
   * where it matters. `null` when the gateway did not say.
   */
  credentialFingerprint: string | null;
  /**
   * Whether OpenRouter billed this to somebody else's key.
   *
   * **A `costNanos` of 0 means two different things and this is what separates
   * them.** Under BYOK OpenRouter's own cost is legitimately zero while the
   * upstream bills elsewhere — so without this field a BYOK call is a free call,
   * `unpriced` stays 0, and a total reads as correct while missing real money.
   * Raised by a GPT Sol review before this shape became a database column.
   */
  isByok: boolean | null;
  /** Tokens, straight off the response. Absent fields stay absent. */
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  /**
   * The cache write split by TTL, when the wire gives it.
   *
   * **Not decoration: the two are priced differently** — a 5-minute write is
   * 1.25x the input rate and a one-hour write is 2x — so a single total cannot
   * be priced correctly once both are in play, and this app uses both. Absent on
   * the chat wire, which reports one number.
   */
  cacheWrite5mTokens: number | null;
  cacheWrite1hTokens: number | null;
  /**
   * Thinking tokens, under whichever name the wire used.
   *
   * **Inside `outputTokens`, not additional** — so this is never added to a
   * total. It is what answers "did that call spend its whole budget thinking",
   * which is the question a cost report gets asked when a number jumps.
   */
  reasoningTokens: number | null;
  /**
   * Server-side web searches, which are **billed per search and invisible to
   * token arithmetic** — a call can cost ten cents more than its tokens say.
   */
  webSearches: number | null;
  /** Anthropic's `service_tier`. Batch is half price; priced as standard it is 2x wrong. */
  serviceTier: string | null;
  /** Anthropic's `inference_geo`. `"us"` is a documented 1.1x on every category. */
  inferenceGeo: string | null;
  /** Wall-clock milliseconds for the call. */
  ms: number;
  /** How it ended — `"ok"`, or the failure that stopped it. */
  outcome: "ok" | "error" | "aborted";
}

/**
 * **A call that has been started and not yet recorded.**
 *
 * The whole reason this exists: a caller can open a request and then drop it —
 * throw on a non-200 before reading the body, return early, forget a `finally` —
 * and the result is a working feature and a short bill, with nothing anywhere
 * saying so. A pending call is the only trace of that, and it is only worth
 * anything if something looks at it when the scope closes.
 *
 * Raised by a GPT Sol review, which also pointed out what it does **not** catch:
 * if the process dies, this dies with it. Catching that needs a row written to
 * disk before the network call, which is a later phase and is written down in
 * docs/plans/260827q-ai-cost-tracking.md rather than half-built here.
 */
export interface PendingCall {
  job: AiJob;
  /** The model as requested — the answer is not known yet, that being the point. */
  model: string;
  startedAt: number;
  /**
   * The row's id, **minted before the request goes out** rather than when it
   * comes back.
   *
   * So that the identifier for a call exists even for the calls that never
   * return one. GPT Sol asked for this: an id minted at record time is an id a
   * lost call never gets, and a lost call is the one you most want to be able to
   * name.
   */
  rowId: string;
}

/* ------------------------------------------------------- who it was for -- */

/**
 * **What kind of work opened this collector.** Written on every row, because a
 * report that adds a reader's chat to an eval sweep is a report nobody can act
 * on. `npm run cost` shows product spend and eval spend apart.
 */
export type ScopeKind = "request" | "job_step" | "cli" | "eval";

/**
 * **Which of the two bills a call lands on.**
 *
 * Everything the app itself does is `"openrouter"` — that is what "one seam per
 * wire" bought. `"anthropic"` exists for the three declared bypasses under
 * [`evals/declared-spend.ts`](../evals/declared-spend.ts), which talk to
 * Anthropic directly because comparing transports is the thing they measure.
 *
 * On the row because `npm run cost --reconcile` reads OpenRouter's key and
 * nothing reads Anthropic's. Without this column the difference between our
 * total and theirs would be permanently non-zero for a reason nobody could
 * name, and a check that is always wrong is a check nobody runs.
 */
export type ProviderAccount = "openrouter" | "anthropic";

/**
 * **Where a row's dollar figure came from.**
 *
 * `"provider"` — OpenRouter's own `usage.cost`, settled and reconcilable.
 * `"computed"` — our arithmetic over `ANTHROPIC_PRICES`, for a call that went
 * somewhere with nobody to ask. `"none"` — neither; the total is short by an
 * unknown amount and says so.
 *
 * The distinction is not pedantry. A price table drifts silently: the day
 * Anthropic changes a rate, every `computed` row after it is wrong and nothing
 * fails. Labelling them is what lets the report say which part of its own total
 * it stands behind.
 */
export type CostSource = "provider" | "computed" | "none";

/**
 * Which of the three a record is — derived, never passed.
 *
 * A BYOK call reports `cost: 0`, and that zero is an answer rather than an
 * absence, so `provider` is decided by "did OpenRouter say anything" and not by
 * "is the number non-zero".
 */
function costSourceOf(record: SpendRecord): CostSource {
  if (record.costNanos !== null) return "provider";
  if (record.computedCostNanos !== null) return "computed";
  return "none";
}

/**
 * Who and what a call should be billed to, supplied by whoever opened the
 * collector rather than discovered at the call.
 *
 * None of this is knowable from inside a gateway: `src/ai-call.ts` sees a model
 * id and a body. `runStep` knows the job, the step and the article; a route
 * knows the article it just parsed a slug for. So the frame that knows says so,
 * once, and every call inside it inherits it.
 */
export interface SpendAttribution {
  scopeKind: ScopeKind;
  /**
   * Whose money it is. Optional here and resolved at record time when omitted —
   * an HTTP request does not know its owner when the collector opens, because
   * the gate that fills the box runs inside it.
   */
  ownerId?: string;
  /**
   * The article, **by slug rather than by id**, and kept even where an id is
   * also stored.
   *
   * `ai_calls.article_id` is `on delete set null` on purpose, so an article that
   * goes away takes the link with it. The slug is the historical fact and cannot
   * be revoked by a later delete, which is what a billing row needs.
   */
  articleSlug?: string | null;
  jobId?: string | null;
  stepName?: string | null;
}

/**
 * One finished call, flattened for storage — the shape the ledger keeps.
 *
 * Separate from `SpendRecord` because they answer different questions.
 * `SpendRecord` is what the gateway saw; this is that plus who it was for, plus
 * the identifiers that make it findable afterwards. Building it here rather than
 * in the store means the two store implementations cannot disagree about what a
 * row is.
 */
export interface AiCallRow {
  /** Minted before the request went out. See `PendingCall.rowId`. */
  id: string;
  /**
   * The collector this call was made inside, so one invocation's calls can be
   * grouped without inventing a second identifier for a retry. GPT Sol's
   * suggestion, in place of an `attempt` counter: a retry is a separate call and
   * already has its own id.
   */
  runId: string;
  generationId: string | null;
  scopeKind: ScopeKind;
  ownerId: string;
  articleSlug: string | null;
  jobId: string | null;
  stepName: string | null;
  /**
   * Which shape of API this went over.
   *
   * On the row rather than derived later, because **the two wires do not mean
   * the same thing by "input tokens"** — the Messages wire reports cache reads
   * and writes *outside* `input_tokens`, and the chat wire reports them inside
   * `prompt_tokens`. A column called `input_tokens` summed across both is a
   * number with no meaning, and this is what stops somebody summing it.
   */
  wire: Wire;
  /** Which job made the call — `hierarchy`, `chat`, `embeddings`, … */
  job: AiJob;
  requestedModel: string;
  answeredModel: string | null;
  upstream: string | null;
  /**
   * A short, safe fingerprint of the credential that paid — never the key.
   *
   * The reconciliation against OpenRouter's `GET /api/v1/key` is per key, and
   * this repo already uses more than one. Without this, a rotation or a second
   * account shows up as a permanent unexplained difference, which is a check
   * everybody learns to ignore. GPT Sol raised it as the thing that separates a
   * ledger from a plausible table.
   */
  credentialFingerprint: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  outcome: SpendRecord["outcome"];
  /**
   * **Credits OpenRouter deducted**, in nano-dollars — not cash, and the name
   * says so.
   *
   * OpenRouter's margin is a fee on *buying* credits (about 5.5%, with a
   * minimum, and different again for crypto), not a per-token markup — so
   * multiplying each row by 1.055 would invent a precision that can never match
   * a bank statement. Cash belongs to a credit-purchase ledger that does not
   * exist yet. Decided with GPT Sol, 2026-08-28, in Greg's absence; see
   * docs/plans/260827q-ai-cost-tracking.md § Questions for Greg, Q5.
   */
  creditsUsedNanos: Nanos | null;
  upstreamInferenceNanos: Nanos | null;
  isByok: boolean | null;
  /** `openrouter` or `anthropic` — which of the two bills this lands on. */
  providerAccount: ProviderAccount;
  /**
   * **Where the dollar figure came from**, so a total can say how much of
   * itself was measured and how much was worked out.
   *
   * Derived from the two nanos fields rather than passed in, because there are
   * exactly two sources and a third field free to disagree with them is a
   * third thing that can be wrong. `provider` wins when OpenRouter answered at
   * all — including the BYOK zero, which is a real answer and not an absence.
   */
  costSource: CostSource;
  computedCostNanos: Nanos | null;
  priceVersion: string | null;
  /**
   * **`reported`, because the two wires do not mean the same thing by it.**
   *
   * On the Messages wire cache reads and writes are reported *outside*
   * `input_tokens`; on the chat wire they are inside `prompt_tokens`. So this is
   * whatever the provider called the input, for the wire named beside it — and
   * summing it across both without looking at `wire` gives a number that is not
   * a count of anything. A column called `input_tokens` invites exactly that
   * sum, which is why it is not called that. GPT Sol asked for the name twice.
   */
  reportedInputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  cacheWrite5mTokens: number | null;
  cacheWrite1hTokens: number | null;
  reasoningTokens: number | null;
  webSearches: number | null;
  serviceTier: string | null;
  inferenceGeo: string | null;
}

/**
 * Where a finished row goes. Supplied by whoever opened the collector.
 *
 * **An injected function rather than an import**, so this file keeps having no
 * IO in it and stays testable without a database. It is also what keeps the
 * module graph acyclic: `src/store/` imports plenty, and an edge from here into
 * it would be a cycle waiting for its second edge. GPT Sol's call, and the
 * reason the leaf-module refactor it suggested earlier is not needed.
 */
export type SpendSink = (row: AiCallRow) => Promise<void>;

/**
 * **A key's name, never the key.** The first twelve hex characters of its
 * SHA-256, which is enough to tell two OpenRouter accounts apart and to notice a
 * rotation, and is not enough to be a credential.
 *
 * Why it is on every row: the account-level reconciliation asks
 * `GET /api/v1/key` what OpenRouter thinks the key has spent, and that question
 * only has an answer per key. This repo already runs more than one — evals have
 * their own — so without a fingerprint the check produces a permanent
 * unexplained difference, and a check that is always wrong for a known reason is
 * one nobody reads. GPT Sol, 2026-08-28.
 */
export function keyFingerprint(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 12);
}

/**
 * One collector's box: what was recorded, what is still in flight, and whether
 * anybody is still listening.
 *
 * An object rather than the bare array this used to be, because "pending" is a
 * question you can only ask of a scope. A **process-global** pending gauge was
 * the first design and is useless: concurrent calls are legitimately pending all
 * the time, so the number is never zero and never means anything. Scoped, it has
 * exactly one honest reading — *this piece of work finished with a call still
 * open* — which is a bug every time.
 */
interface SpendBox {
  calls: SpendRecord[];
  active: Map<number, PendingCall>;
  /**
   * Every write this collector has started. Awaited before `collectSpend`
   * returns — see the comment there, which is the whole reason they are kept.
   */
  writes: Promise<void>[];
  /** How many of those rejected. See `SpendReport.writeFailures`. */
  writeFailures: number;
  sink: SpendSink | null;
  runId: string;
  /** Set when `collectSpend` returns. A record arriving after this is a late finish. */
  closed: boolean;
}

/**
 * What is in scope: one shared box, and this frame's view of who it is for.
 *
 * Split in two so that `withSpendAttribution` can overlay an article onto an
 * open collector **without starting a second one**. It re-enters with the same
 * `box` object and a different `attribution`, so the calls, the sink and the
 * `closed` flag are all still the one set — which a copied scope object would
 * not be, and the bug would have been a `closed` that never arrived.
 */
interface SpendScope {
  box: SpendBox;
  attribution: SpendAttribution;
}

const store = new AsyncLocalStorage<SpendScope>();

let dropped = 0;
let late = 0;
let nextCallId = 1;

/**
 * How many calls were recorded with no collector open since the process
 * started. Anything printing a total should print this too when it is not zero:
 * a total that silently omits rows is worse than no total.
 */
export function unscopedCalls(): number {
  return dropped;
}

/**
 * How many calls finished **after their collector had already reported**.
 *
 * The other half of `unscopedCalls()`, and process-wide for the same unavoidable
 * reason: a late finish is by definition after the report, so it can never
 * appear in the report it belongs to. A first draft put it on `SpendReport` and
 * it was a field that could only ever read zero — a counter nobody could read,
 * which is the failure this module is otherwise organised against. Found by
 * writing the test for it and watching the assertion be unwritable.
 *
 * What it means when it is not zero: some piece of work launched a model call
 * and returned before the call finished. The money is real and is in no total.
 * Today the one shape that could do that is a route returning before its stream
 * is drained — see the note at `handleApi` in [`src/routes.ts`](routes.ts).
 */
export function lateCalls(): number {
  return late;
}

/** Reset both counters. For tests; nothing in the app should call them. */
export function resetUnscopedCalls(): void {
  dropped = 0;
  late = 0;
}

/**
 * **Say a call has started**, before a byte goes over the wire.
 *
 * Returns the id to hand back to `recordSpend`, or `null` if nobody is
 * collecting. Called by the two gateways, not by callers.
 */
export function beginSpend(job: AiJob, model: string): number | null {
  const scope = store.getStore();
  if (!scope) return null;
  const id = nextCallId++;
  scope.box.active.set(id, {
    job,
    model,
    startedAt: Date.now(),
    rowId: randomUUID(),
  });
  return id;
}

/**
 * **Overlay an article (or a job, or a step) onto the collector already open.**
 *
 * For the frame that knows something the collector did not when it opened. A
 * route opens no collector of its own — `handleApi` did that before the router
 * ran — but it is the only place that knows which article the reader is asking
 * about, and without this the answer to *"what has this article cost me"* would
 * cover the ingest and none of the questions asked about it afterwards.
 *
 * The same box, a different view of it. Not a nested `collectSpend`, which would
 * hide the calls from the outer one; not a mutable field on the scope, which two
 * concurrent async branches would overwrite for each other. GPT Sol's shape.
 *
 * A no-op outside a collector, like everything else here.
 */
export function withSpendAttribution<T>(
  patch: Partial<SpendAttribution>,
  fn: () => T,
): T {
  const scope = store.getStore();
  if (!scope) return fn();
  return store.run(
    { box: scope.box, attribution: { ...scope.attribution, ...patch } },
    fn,
  );
}

/**
 * What a finished piece of work spent — and everything about it that is not
 * simply a total.
 */
export interface SpendReport {
  calls: SpendRecord[];
  /**
   * Calls opened and never recorded. **Nonzero is a bug**, and the entries say
   * which job and how old, so it can be chased rather than merely noticed.
   */
  pending: PendingCall[];
  /** The id every row from this collector carries, so a log line and a row can be joined. */
  runId: string;
  /**
   * **Rows this piece of work could not write down.** Nonzero means the totals
   * queried back out of the ledger afterwards are short by that many calls —
   * which is a different failure from `unpriced`, and invisible from the ledger
   * itself, because the evidence is the row that is not there.
   */
  writeFailures: number;
}

/**
 * A report of nothing, for a caller that has to have one before its collector
 * has run — `runStep`'s `catch` reads the spend, and a step can throw before
 * `onDone` has fired.
 */
export function emptySpend(): SpendReport {
  return { calls: [], pending: [], runId: "", writeFailures: 0 };
}

/** What the frame opening a collector tells it. All optional; all better supplied. */
export interface CollectOptions {
  /** Who and what to bill. Defaults to an unattributed CLI scope. */
  attribution?: SpendAttribution;
  /** Where finished rows go. Without one, nothing is written down. */
  sink?: SpendSink;
  /**
   * Called with the report on **both** paths, success and throw.
   *
   * Because a run that failed is precisely the one worth knowing the cost of:
   * the model call that blew up had usually already been paid for, and the retry
   * after it pays again. A caller reading only the resolved value loses that.
   */
  onDone?: (report: SpendReport) => void;
}

/**
 * Run `fn` with a fresh collector, and hand back both its answer and every call
 * made inside it — including inside anything it awaited.
 *
 * `run()` with a new scope each time, never `enterWith`, for the reason
 * [`src/owner.ts`](owner.ts) gives at length: `enterWith` mutates the *calling*
 * context, and two overlapping pieces of work on one process would then share a
 * box and bill each other.
 *
 * **Nested collectors do not merge.** An inner `collectSpend` shadows an outer
 * one for everything inside it, so the outer sees none of those calls. That is
 * the right answer for the one place it happens today — `runStep` in
 * [`src/jobs.ts`](jobs.ts) accounts for a pipeline step, which is not part of any
 * request — and it is written down because it is not what a reader would guess.
 */
export async function collectSpend<T>(
  fn: () => Promise<T>,
  options?: CollectOptions,
): Promise<{ result: T; report: SpendReport }> {
  const onDone = options?.onDone;
  const box: SpendBox = {
    calls: [],
    active: new Map(),
    writes: [],
    writeFailures: 0,
    sink: options?.sink ?? null,
    runId: randomUUID(),
    closed: false,
  };
  const scope: SpendScope = {
    box,
    attribution: options?.attribution ?? { scopeKind: "cli" },
  };
  const report = (): SpendReport => ({
    calls: box.calls,
    pending: [...box.active.values()],
    runId: box.runId,
    writeFailures: box.writeFailures,
  });
  try {
    const result = await store.run(scope, fn);
    return { result, report: report() };
  } finally {
    /* **Shut before the drain, not after it.**

       The first version closed the box *after* awaiting the writes, which looks
       like the careful order and is not: a call finishing during the drain was
       still accepted, appended a new promise, and `Promise.allSettled` had
       already captured its iterable — so `collectSpend` returned with that write
       unsettled. On Vercel the row then disappears. GPT Sol drove the path
       directly rather than reasoning about it.

       Closed here, that call is a *late* one: no row, a warn line naming it, and
       `lateCalls()`. Which is the honest answer — the report has already been
       taken, so a row written now would belong to a total that was published
       without it. */
    box.closed = true;
    /* **`onDone` exists because of the failure case, not the happy one.** When
       `fn` throws, this function rejects and its return never happens — so a
       caller that only reads the resolved value loses every record of what the
       failed run spent. And a run that failed is precisely the one worth knowing
       the cost of: the model call that blew up had usually already been paid
       for, and a retry pays again. Called in a `finally` so it fires on both
       paths. */
    onDone?.(report());
    /* **Every row is on disk before this function returns.**

       The instinct is to let the writes float — do not make a reader wait on a
       metrics insert. That is wrong on Vercel: a serverless function can be
       frozen the moment its response is sent, and an un-awaited promise then
       simply never runs. The rows that would go missing are exactly the
       request-path ones, which is the half a per-user total is made of.

       `allSettled`, because a sink that rejects has already logged and must not
       turn a working model call into a failed request. */
    await Promise.allSettled([...box.writes]);
  }
}

/**
 * Add a call to whatever collector is open. No-op — and counted — if none is.
 *
 * Called by [`src/ai-call.ts`](ai-call.ts) and
 * [`src/messages-stream.ts`](messages-stream.ts), not by their callers.
 *
 * `callId` is what `beginSpend` returned. Passing it is what clears the call out
 * of `pending`; omitting it leaves a phantom in-flight call behind, which is why
 * both gateways thread it through rather than treating it as optional detail.
 */
export function recordSpend(record: SpendRecord, callId?: number | null): void {
  const scope = store.getStore();
  if (!scope) {
    dropped += 1;
    /* **Said out loud, not merely counted.** A counter lives in one process's
       memory and no later `npm run cost` can read it, so on its own it is an
       anomaly nobody sees. A call made outside every collector is money spent
       that will never appear in any total, and the line is what reaches a
       person. It names the job and the model and no more: nothing about a
       prompt, an answer or an article goes near a log. */
    log("model").warn(
      { job: record.job, model: record.model, outcome: record.outcome },
      "a model call was made with no spend collector open — it is in no total",
    );
    return;
  }
  const started = callId != null ? scope.box.active.get(callId) : undefined;
  if (callId != null) scope.box.active.delete(callId);
  if (scope.box.closed) {
    /* **Counted and said out loud, not just counted.** A bare counter loses the
       job, the model and the money, and lives in one process's memory where no
       later `npm run cost` can read it — so on its own it is an anomaly nobody
       will ever see. The line is the part that reaches a person. Raised by a GPT
       Sol review, which pointed out that the counter alone was a thing nobody
       reads. */
    late += 1;
    log("model").warn(
      {
        job: record.job,
        model: record.model,
        outcome: record.outcome,
        costNanos: record.costNanos,
        ms: record.ms,
      },
      "a model call finished after its collector had already reported",
    );
    return;
  }
  scope.box.calls.push(record);
  write(scope, record, started);
}

/**
 * Start the row's journey to the ledger, and hold on to the promise.
 *
 * **Started here and awaited at scope close**, rather than batched into one
 * insert at the end. A batch loses everything on a mid-step crash — forty
 * finished calls for one process death — where a write per finished call loses
 * only what was genuinely still in flight. GPT Sol's call, 2026-08-28.
 *
 * The rejection handler is attached **immediately**, in the same tick as the
 * promise is made, so a slow sink that fails can never surface as an unhandled
 * rejection while the box waits its turn.
 */
function write(
  scope: SpendScope,
  record: SpendRecord,
  started: PendingCall | undefined,
): void {
  const sink = scope.box.sink;
  if (!sink) return;
  const owner = ownerFor(scope, record);
  /* **No owner, no row.** `owner_id` is `not null` and `on delete restrict`,
     like every other owned table here, so there is no honest row to write for a
     call whose owner cannot be named. Loud rather than quiet: the money is real
     and this is the only trace of it. */
  if (!owner) return;
  const finishedAt = Date.now();
  const startedAt = finishedAt - record.ms;
  const row: AiCallRow = {
    id: started?.rowId ?? randomUUID(),
    runId: scope.box.runId,
    generationId: record.generationId,
    scopeKind: scope.attribution.scopeKind,
    ownerId: owner,
    articleSlug: scope.attribution.articleSlug ?? null,
    jobId: scope.attribution.jobId ?? null,
    stepName: scope.attribution.stepName ?? null,
    wire: record.wire,
    job: record.job,
    requestedModel: record.model,
    answeredModel: record.answeredBy,
    upstream: record.upstream,
    credentialFingerprint: record.credentialFingerprint,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(),
    durationMs: record.ms,
    outcome: record.outcome,
    creditsUsedNanos: record.costNanos,
    upstreamInferenceNanos: record.upstreamCostNanos,
    isByok: record.isByok,
    providerAccount: record.providerAccount,
    costSource: costSourceOf(record),
    computedCostNanos: record.computedCostNanos,
    priceVersion: record.priceVersion,
    reportedInputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    cacheReadTokens: record.cacheReadTokens,
    cacheWriteTokens: record.cacheWriteTokens,
    cacheWrite5mTokens: record.cacheWrite5mTokens,
    cacheWrite1hTokens: record.cacheWrite1hTokens,
    reasoningTokens: record.reasoningTokens,
    webSearches: record.webSearches,
    serviceTier: record.serviceTier,
    inferenceGeo: record.inferenceGeo,
  };
  const promise = sink(row).catch((err: Error) => {
    scope.box.writeFailures += 1;
    /* **A metrics write must never kill a model call.** The old app rethrew
       here, which meant a Postgres hiccup could take down a reader-facing
       feature — logging.md quotes it as the thing not to copy. But a recorder
       that has silently stopped recording is the same class of bug as a cache
       that has silently stopped caching, so it says so. */
    log("model").warn(
      { job: row.job, model: row.requestedModel, id: row.id, err: err.message },
      "could not write the ai_calls row — this call is in no ledger",
    );
  });
  scope.box.writes.push(promise);
}

/**
 * Whose money this was.
 *
 * The frame that opened the collector says so when it knows — `runStep` does,
 * because a job carries its owner across the request that made it. An HTTP
 * request does **not** know at the moment its collector opens: the gate that
 * fills the owner box runs inside `serveApi`, which is inside the collector. So
 * the fallback is asked at record time, by which point the gate has long since
 * run, and `currentOwnerId()` will answer.
 *
 * It can still throw — a model call in a request that was never authenticated —
 * and that is caught rather than propagated, because this is the accounting
 * path and it may not be the thing that fails a reader's request.
 */
function ownerFor(scope: SpendScope, record: SpendRecord): string | null {
  if (scope.attribution.ownerId) return scope.attribution.ownerId;
  try {
    return currentOwnerId();
  } catch {
    log("model").warn(
      { job: record.job, model: record.model },
      "a model call had no owner to bill — no ledger row was written",
    );
    return null;
  }
}

/** True while a collector is open. Lets a caller decide whether to bother. */
export function collectingSpend(): boolean {
  return store.getStore() !== undefined;
}

/**
 * **True only while a collector is open that will actually write rows.**
 *
 * `collectingSpend()` is not enough for a caller that wants a guarantee: a
 * collector with no `sink` reports its calls to whoever opened it and writes
 * nothing durable, which is exactly the shape most tests use. GPT Sol drove the
 * path — a completed declared call with `unscopedCalls() === 1` — and it is the
 * one failure mode a declared bypass must not have, because the whole reason a
 * bypass is allowed at all is that it still writes a row.
 */
export function persistingSpend(): boolean {
  const box = store.getStore()?.box;
  /* **`!box.closed`, because the store outlives the collector.**
     `AsyncLocalStorage` follows into any async resource created inside the
     callback, so work retained past `collectSpend`'s return still sees the box.
     GPT Sol started a declared call from a callback held after the collector had
     finished: the body ran, the money went, and `recordSpend` counted the row as
     *late* and threw it away. An open box and a live one are different things. */
  return box != null && !box.closed && box.sink != null;
}

/**
 * What the open collector has recorded **so far**, or `null` outside one.
 *
 * For a caller that has to report *while still inside* its own scope — which is
 * every HTTP request, because the line about a request is written in
 * `serveApi`'s `finally`, and by then the scope `handleApi` opened has not
 * closed yet. Reading the snapshot from in here is the only way that line can
 * carry a cost at all.
 *
 * A copy of the arrays, not the live ones: a caller holding the collector's own
 * array would see it keep growing after it had reported, which is a report that
 * is wrong later rather than wrong now.
 */
export function currentSpend(): SpendReport | null {
  const scope = store.getStore();
  if (!scope) return null;
  return {
    calls: [...scope.box.calls],
    pending: [...scope.box.active.values()],
    runId: scope.box.runId,
    writeFailures: scope.box.writeFailures,
  };
}

/**
 * **What a finished piece of work spent, as log fields** — the one formatting of
 * this, shared by the pipeline's per-step line and the server's per-request one.
 *
 * `aiUnpriced`, `aiPending` and `aiLateFinishes` appear only when they are not
 * zero, so an ordinary line stays short and an unusual one says why. Each of the
 * three means something different and all three are bugs:
 *
 * - **`aiUnpriced`** — the call happened and reported no cost. The total below it
 *   is short by an unknown amount.
 * - **`aiPending`** — a call was started and never recorded. The jobs are named,
 *   because a bare count says something leaked without saying where to look.
 * A third anomaly, a call that finished after its scope reported, cannot appear
 * here at all — by definition it arrives after this function has run. It is
 * counted process-wide by `lateCalls()` instead, which is the honest place for
 * it; see the comment there.
 *
 * **An empty run gets no fields, but a run with a pending call does.** The early
 * return used to be `calls.length === 0`, which is the exact state a piece of
 * work that lost a request ends in — so the one symptom of the bug was
 * suppressed by the check for the ordinary case. Raised by a GPT Sol review.
 */
export function spendFields(spend: SpendReport): Record<string, unknown> {
  if (spend.calls.length === 0 && spend.pending.length === 0) return {};
  const { nanos, unpriced } = totalSpend(spend.calls);
  return {
    aiCalls: spend.calls.length,
    aiCostNanos: nanos,
    aiCost: formatNanos(nanos),
    /* The join between this line and the rows it is a total of. Without it,
       finding the calls behind a surprising number means guessing at a
       timestamp range. */
    aiRunId: spend.runId,
    ...(unpriced > 0 ? { aiUnpriced: unpriced } : {}),
    ...(spend.pending.length > 0
      ? {
          aiPending: spend.pending.length,
          aiPendingJobs: spend.pending.map((p) => p.job).join(","),
        }
      : {}),
    /* **A call that happened and left no row.** Different from `aiUnpriced`,
       which is a row with an unknown cost, and invisible to anything reading the
       ledger afterwards — the evidence is the row that is not there, so it has
       to be said here or nowhere. */
    ...(spend.writeFailures > 0 ? { aiWriteFailures: spend.writeFailures } : {}),
  };
}

/**
 * The total of a set of calls, in nano-dollars, **and how many of them could
 * not be priced**.
 *
 * Two numbers rather than one on purpose. A caller that gets only a total has no
 * way to tell "$0.30 across nine calls" from "$0.30 across nine calls, three of
 * which reported nothing" — and the second is a bug report.
 *
 * ## BYOK: the zero that is not free
 *
 * `usage.cost` is what **OpenRouter** charged. Under BYOK it is legitimately
 * `0`, because the inference was billed to somebody else's key upstream — so a
 * BYOK call summed naively contributes nothing, `unpriced` stays `0` because a
 * cost *did* arrive, and the total reads as correct while missing real money.
 * `isByok` was recorded specifically to tell that zero from a free call, and
 * then the first version of this function ignored it, which is the whole failure
 * in miniature: the field that makes a number honest is only worth having if
 * something reads it. Found by a GPT Sol review of the code, after an earlier
 * review had asked for the field.
 *
 * So a BYOK call is priced from `upstreamCostNanos` — the inference's own worth
 * — and counted as unpriced if even that is missing.
 */
export function totalSpend(calls: readonly SpendRecord[]): {
  nanos: Nanos;
  unpriced: number;
} {
  let nanos = 0;
  let unpriced = 0;
  for (const c of calls) {
    if (c.isByok === true) {
      /* Two different pockets, so they add rather than one standing in for the
         other: `upstreamCostNanos` is what the inference was worth to whoever's
         key paid for it, and `costNanos` is whatever OpenRouter charged us on
         top — usually nothing, sometimes a fee. Falling back from one to the
         other, as the first version did, made a BYOK call with no upstream
         figure read as **zero** rather than as unknown, which is the same
         understatement one level down. */
      if (c.upstreamCostNanos === null) unpriced += 1;
      else nanos += c.upstreamCostNanos + (c.costNanos ?? 0);
      continue;
    }
    /* **Our own arithmetic, for a declared bypass.** Second only to the BYOK
       branch because a computed call has no `costNanos` at all and would
       otherwise fall through to `unpriced` — which is precisely what it is not.

       This was missed once already. The persistent report was corrected and
       *this* function was not, so the line `npm run hierarchy` and every eval prints
       at the end of its own run said `$0.0000` about money it had just spent.
       GPT Sol found it: the command that made the spend was the one output that
       could not see it. */
    if (c.computedCostNanos !== null) {
      nanos += c.computedCostNanos;
      continue;
    }
    /* Not BYOK: `cost` and `cost_details.upstream_inference_cost` are the same
       money — a live probe on 2026-08-27 had them equal to seven decimal places
       — so adding both would double it. */
    if (c.costNanos === null) unpriced += 1;
    else nanos += c.costNanos;
  }
  return { nanos, unpriced };
}

/**
 * Nano-dollars as a short human string: `$0.0142`.
 *
 * **Four decimals, except when four decimals would say `$0.0000` about money
 * that was really spent.** A query embedding costs about $0.00000018 — the
 * reason this ledger counts in nano-dollars at all — and rounding it to `$0.0000`
 * puts back at the last step the exact lie the column type was chosen to avoid.
 * Seen doing it, on a live probe, five minutes after the column was proved
 * right.
 *
 * A true zero still prints `$0.0000`, because a free call and a very cheap one
 * are different things and only one of them wants seven decimals.
 */
export function formatNanos(nanos: Nanos): string {
  const dollars = nanos / 1e9;
  if (nanos !== 0 && Math.abs(dollars) < 0.0001) return `$${dollars.toFixed(8)}`;
  return `$${dollars.toFixed(4)}`;
}
