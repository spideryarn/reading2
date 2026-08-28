/**
 * **The two model calls that are allowed to skip the gateway, and the two that
 * still do without permission.**
 *
 * Every paid call the app makes goes through one of two seams
 * ([`src/messages-stream.ts`](../src/messages-stream.ts) and
 * [`src/ai-call.ts`](../src/ai-call.ts)), which is what makes
 * [`npm run cost`](../scripts/ai-cost.ts) able to claim it has seen everything.
 * `evals/` breaks that, and for one eval it breaks it *correctly*: the PDF
 * bake-off exists to compare the Anthropic SDK against OpenRouter, and a
 * bake-off forced onto one transport is measuring nothing.
 *
 * So the answer is not "make everything use the seam". It is: **a bypass has to
 * be declared, and a declared bypass still writes a row.** Silence reads as
 * zero, and zero is the one answer that is definitely wrong.
 *
 * ## What this is not
 *
 * It is not a second way to call a model. Three things stop it becoming one:
 *
 * 1. It lives under `evals/`, so nothing in `src/` can reach it without a
 *    relative import that stands out in a diff.
 * 2. `DECLARATIONS` names the **one file** each id may be used from, and
 *    `declaredFetch` throws outside a declaration.
 * 3. [`tests/no-undeclared-spend.test.ts`](../tests/no-undeclared-spend.test.ts)
 *    fails on any new way of reaching a provider that is not in that table.
 *
 * ## Why `beginSpend` and `recordSpend` rather than one `record()` call
 *
 * A completion-only function is forgotten on the throwing path, and it mints the
 * row's id *after* the request — so a call that never comes back leaves nothing
 * at all. GPT Sol's objection, 2026-08-28, and it is the same objection that
 * shaped [`streamMessage`](../src/messages-stream.ts): the ordinary way to make
 * the call is the thing that keeps the account, and there is no way to make the
 * call without it.
 *
 * ## Retries were the trap
 *
 * The bare Anthropic client retries twice by default. One `messages.create` can
 * therefore be three billable attempts, and a wrapper that records "the call"
 * would record a third of the money with nothing looking wrong. Also GPT Sol.
 * `anthropicForDeclared()` sets `maxRetries: 0`, and `declaredFetch` counts
 * attempts so that the setting has to keep working rather than merely having
 * been written down once.
 */

import Anthropic from "@anthropic-ai/sdk";
import { AsyncLocalStorage } from "node:async_hooks";

import {
  beginSpend,
  keyFingerprint,
  persistingSpend,
  type ProviderAccount,
  recordSpend,
  type SpendRecord,
  withSpendAttribution,
} from "../src/ai-spend.js";
import {
  type Declaration,
  declarationFor,
} from "../src/spend-declarations.js";
import {
  type AnthropicUsageLike,
  type OpenRouterUsageLike,
  priceAnthropicCall,
  providerCostToNanos,
} from "../src/pricing.js";

/* --------------------------------------------------------- the guarded fetch */

interface ActiveCall {
  readonly declaration: Declaration;
  attempts: number;
  /**
   * **Set the moment the wrapper finishes**, because `AsyncLocalStorage`
   * outlives the callback that created it.
   *
   * GPT Sol scheduled a fetch inside `fn`, let `fn` return, and awaited the
   * detached work afterwards: the request went out and the row for it had
   * already been written and closed. A store that exists is not the same as a
   * call that is still running.
   */
  finished: boolean;
}

const active = new AsyncLocalStorage<ActiveCall>();

/**
 * **A `fetch` that refuses to run outside a declaration.**
 *
 * The static scan is a tripwire — deliberately obfuscated string assembly is not
 * something a grep can catch, and `src/ai-call.ts` says so about its own base
 * URL. This is the half with teeth: pass it to the SDK as `ClientOptions.fetch`,
 * or call it directly, and a request made anywhere but inside
 * `withDeclaredExternalCall` throws instead of quietly spending money.
 *
 * It also **counts attempts**, which is how `maxRetries: 0` stays true. A
 * default-configured Anthropic client turns one call into up to three billable
 * requests, and the wrapper would then record a third of what was spent.
 */
export const declaredFetch: typeof fetch = (input, init) => {
  const call = active.getStore();
  if (call?.finished) {
    return Promise.reject(
      new Error(
        "a declared-bypass fetch ran after its declared call had already been recorded — the row for it is written and closed, so this request is in no total",
      ),
    );
  }
  if (!call) {
    return Promise.reject(
      new Error(
        "a declared-bypass fetch ran outside withDeclaredExternalCall — this call would have spent money with no ledger row",
      ),
    );
  }
  call.attempts += 1;
  return fetch(input, init);
};

/* ------------------------------------------------------------ the wrapper -- */

/** What the body of a declared call may report back about what it cost. */
/**
 * Anthropic's `usage`, plus the three fields it reports that pricing does not
 * read but a later reader will want — dropped by the first version of this
 * wrapper, and both seams keep them.
 */
export type ObservedAnthropicUsage = AnthropicUsageLike & {
  service_tier?: string | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
  /**
   * **Where the inference actually ran**, and it is reported — I had written
   * that it was unknowable and GPT Sol checked the installed SDK, where
   * `Usage.inference_geo` is declared. Worth keeping straight: US inference is
   * priced above the standard rate for supported models, so a call that ran
   * there costs more than `ANTHROPIC_PRICES` says.
   *
   * The **multiplier is deliberately not applied.** This file's price table is
   * checked and dated against a published page, and putting a second-hand 1.1x
   * into it is exactly the kind of unreviewed number those comments exist to
   * refuse. The row carries the geo instead, so the day somebody checks the
   * rate the affected calls can be found rather than guessed at.
   */
  inference_geo?: string | null;
  /* **`thinking_tokens`, not `reasoning_tokens`.** GPT Sol named the wrong
     field and the compiler caught it — an optional property that does not exist
     reads as `undefined`, so the column would have stayed null for ever while
     the code looked right. `src/messages-stream.ts` reads the same name. */
  output_tokens_details?: { thinking_tokens?: number | null } | null;
};

export interface Observer {
  /**
   * An Anthropic `Message` (or anything with its `usage`). Priced from
   * `ANTHROPIC_PRICES`, because there is nobody to ask — the call did not go
   * through OpenRouter and Anthropic charges no per-call figure back.
   */
  anthropic: (message: {
    usage?: ObservedAnthropicUsage | null;
    model?: string | null;
  }) => void;
  /** An OpenRouter JSON body. Its own `usage.cost` is settled; ours is not. */
  openRouter: (body: {
    usage?: (OpenRouterUsageLike & { cost?: number | null }) | null;
    model?: string | null;
    provider?: string | null;
  }) => void;
}

export interface DeclaredCall<T> {
  (arg: { observe: Observer }): Promise<T>;
}

/**
 * Make one declared call, and write one row for it whatever happens.
 *
 * `recordSpend` runs in a `finally`, exactly once, so a throw is a row with
 * `outcome: "error"` rather than an absence. An error with no usage is
 * `cost_source: "none"` — the report then says the total is short by an unknown
 * amount, which is the truth, where a zero would be a lie in the direction that
 * looks like success.
 */
export async function withDeclaredExternalCall<T>(
  id: string,
  spec: { model: string },
  fn: DeclaredCall<T>,
): Promise<T> {
  const declaration = declarationFor(id);
  /* **A collector that will actually write, checked before the money is spent.**
     `beginSpend` returns `null` outside one and `recordSpend` then warns and
     drops the row, so the failure mode is a bypass that spends and records
     nothing — the exact thing a bypass is only permitted because it does not do.
     `collectingSpend()` is not the right question: a collector with no sink
     reports to its opener and writes nothing durable. GPT Sol drove this path
     and got a completed declared call with `unscopedCalls() === 1`. */
  if (!persistingSpend()) {
    throw new Error(
      `${id} is a declared bypass and there is no ledger open to write its row. Wrap the run in withLedger("eval", …) — evals/declared-spend.ts.`,
    );
  }
  const startedAt = Date.now();
  /* Before the request, so a call that never comes back is a `pending` entry
     rather than nothing at all. The id it mints is the row's, and threading it
     back into `recordSpend` is what clears the call out of `pending` — omitting
     it leaves a phantom in-flight call behind for ever. */
  const callId = beginSpend(declaration.job, spec.model);

  /* **One object rather than seven `let`s**, and not for tidiness: TypeScript
     narrows a `let` that is only ever assigned inside a closure back to `null`
     at the read, so every use downstream needed a cast — and a cast is exactly
     how a field ends up read off the wrong wire's usage shape. Properties of an
     object keep their declared type. */
  const seen: {
    costNanos: number | null;
    computedCostNanos: number | null;
    priceVersion: string | null;
    anthropicUsage: ObservedAnthropicUsage | null;
    openRouterUsage: OpenRouterUsageLike | null;
    answeredBy: string | null;
    upstream: string | null;
    observed: boolean;
  } = {
    costNanos: null,
    computedCostNanos: null,
    priceVersion: null,
    anthropicUsage: null,
    openRouterUsage: null,
    answeredBy: null,
    upstream: null,
    observed: false,
  };

  /**
   * **One observation, from the provider this declaration actually names.**
   *
   * Both methods used to be available on every call, and a second call
   * overwrote the first. GPT Sol drove that too: `observe.openRouter` twice
   * under the *Anthropic* declaration produced one accepted row saying
   * `provider_account=anthropic, cost_source=provider` — a settled figure
   * attributed to a bill that never saw it. So the wrong one throws, and so does
   * a second observation: two answers to "what did this cost" is a bug in the
   * caller, and silently keeping the last one is how it stays a bug.
   */
  const wrongProvider = (which: ProviderAccount) => (): never => {
    throw new Error(
      `${id} is declared against ${declaration.account}; observe.${which === "anthropic" ? "anthropic" : "openRouter"}() is not the observer for it.`,
    );
  };
  const once = () => {
    if (seen.observed) {
      throw new Error(
        `${id} observed its usage twice. One declared call is one row; a second observation would silently replace the first.`,
      );
    }
    seen.observed = true;
  };

  const observe: Observer = {
    anthropic:
      declaration.account !== "anthropic"
        ? wrongProvider("anthropic")
        : (message) => {
            once();
            seen.answeredBy = message.model ?? seen.answeredBy;
            if (!message.usage) return;
            seen.anthropicUsage = message.usage;
            const priced = priceAnthropicCall(
              message.model ?? spec.model,
              message.usage,
              new Date(startedAt),
            );
            /* `null` when the model is not in the table, and left `null` rather
               than made `0`. An unknown price and a free call are different
               facts and the report distinguishes them. */
            if (priced) {
              seen.computedCostNanos = priced.totalNanos;
              seen.priceVersion = priced.priceVersion;
            }
          },
    openRouter:
      declaration.account !== "openrouter"
        ? wrongProvider("openrouter")
        : (body) => {
            once();
            seen.answeredBy = body.model ?? seen.answeredBy;
            seen.upstream = body.provider ?? seen.upstream;
            if (!body.usage) return;
            seen.openRouterUsage = body.usage;
            seen.costNanos = providerCostToNanos(body.usage.cost);
          },
  };

  const call: ActiveCall = { declaration, attempts: 0, finished: false };
  let outcome: SpendRecord["outcome"] = "ok";
  let bodyThrew = false;
  /* **The attribution wraps the `finally`, not just the body.** It wrapped only
     the body until a test asked what `step_name` was on the row and got `null`:
     `recordSpend` runs in the `finally`, which is outside the overlay, so the
     declaration id never reached the row that exists to be traced back to it. */
  return withSpendAttribution({ stepName: declaration.id }, async () => {
    try {
      return await active.run(call, () => fn({ observe }));
    } catch (err) {
      outcome = "error";
      /* Set here and read after the row is written, so a retried call whose body
         *also* threw keeps its real error instead of a lecture about retries.
         GPT Sol found this flag never being assigned at all — the edit that was
         meant to add it had an anchor that had already moved, and a `replace`
         matching nothing says nothing. */
      bodyThrew = true;
      throw err;
    } finally {
      /* **Recorded first, and the retry complaint raised afterwards.** Throwing
         from a `finally` replaces whatever the body threw, so a genuine provider
         error would come back as a lecture about retries and the row would never
         be written. The money was spent either way; the row goes down first. */
      /* **Attempts settled before the row is built, not after it.** A retried
         call spent about N times what one attempt reports, and the first
         version wrote `outcome: "ok"` with one attempt's figure and *then*
         threw — a row that is confidently wrong, which is worse than a row that
         says it does not know. GPT Sol, twice. So the figure is dropped and the
         outcome is `error`: the report then counts it under "short by an unknown
         amount", which is exactly the truth. */
      const retried = call.attempts > 1;
      if (retried) outcome = "error";
      call.finished = true;
      recordSpend(
        {
          job: declaration.job,
          wire: declaration.wire,
          model: spec.model,
          answeredBy: seen.answeredBy,
          costNanos: seen.costNanos,
          upstreamCostNanos: null,
          providerAccount: declaration.account,
          /* **Never both.** OpenRouter's figure is settled and ours is an
             estimate; a row carrying the two would invite a reader to pick, and a
             `SUM` over both would double-count. The 0023 `CHECK` refuses it at the
             database as well, so a future caller cannot quietly do it either. */
          computedCostNanos:
          retried || seen.costNanos !== null ? null : seen.computedCostNanos,
          priceVersion:
          retried || seen.costNanos !== null ? null : seen.priceVersion,
          generationId: null,
          upstream: seen.upstream,
          isByok: null,
          credentialFingerprint: fingerprintFor(declaration.account),
          /* **Read off whichever wire actually answered.** The two disagree about
             what an input token is — the Messages shape reports cache reads and
             writes outside `input_tokens`, the chat shape reports them inside — so
             these are never merged, and `wire` on the row says which is which. */
          inputTokens:
            seen.anthropicUsage?.input_tokens ??
            seen.openRouterUsage?.prompt_tokens ??
            null,
          outputTokens:
            seen.anthropicUsage?.output_tokens ??
            seen.openRouterUsage?.completion_tokens ??
            null,
          cacheReadTokens: seen.anthropicUsage?.cache_read_input_tokens ?? null,
          cacheWriteTokens:
            seen.anthropicUsage?.cache_creation_input_tokens ?? null,
          /* The split matters because a 1-hour write costs 1.6x a 5-minute one,
             which is why one `cache_write_tokens` total will not do — the same
             reason both seams keep these apart. */
          cacheWrite5mTokens:
            seen.anthropicUsage?.cache_creation?.ephemeral_5m_input_tokens ?? null,
          cacheWrite1hTokens:
            seen.anthropicUsage?.cache_creation?.ephemeral_1h_input_tokens ?? null,
          reasoningTokens:
            seen.anthropicUsage?.output_tokens_details?.thinking_tokens ?? null,
          webSearches:
            seen.anthropicUsage?.server_tool_use?.web_search_requests ?? null,
          serviceTier: seen.anthropicUsage?.service_tier ?? null,
          /* **Where the inference actually ran.** I had written that a direct
             call cannot know; GPT Sol checked the installed SDK, where
             `Usage.inference_geo` is declared. It matters because US inference
             is priced above the standard rate, so on a US call the computed
             figure is a floor. The multiplier is not applied here — see
             `ObservedAnthropicUsage` — and this column is what makes the
             affected calls findable rather than guessed at. */
          inferenceGeo: seen.anthropicUsage?.inference_geo ?? null,
          ms: Date.now() - startedAt,
          outcome,
        },
        callId,
      );
      if (retried) {
        /* Not a warning: one logical call that made three HTTP requests spent
           about three times what any single figure would say. Raised only when
           the body itself did not fail, so it can never mask a real provider
           error — the row above has already recorded the unknown-amount fact
           either way. */
        if (!bodyThrew) {
          throw new Error(
            `${id} made ${call.attempts} HTTP attempts for one declared call — no trustworthy amount was recorded for it. Set maxRetries: 0 (see anthropicForDeclared).`,
          );
        }
      }
    }
  });
}

/** Which key paid, as a fingerprint — never the key. */
function fingerprintFor(account: ProviderAccount): string | null {
  const key =
    account === "anthropic"
      ? process.env.ANTHROPIC_API_KEY
      : process.env.OPENROUTER_API_KEY;
  return key ? keyFingerprint(key) : null;
}

/**
 * An Anthropic client that can only be used inside a declaration.
 *
 * `maxRetries: 0` is the load-bearing option and the reason this is a function
 * rather than a note in a comment — see the header. `fetch` is the guard.
 */
export function anthropicForDeclared(): Anthropic {
  return new Anthropic({ maxRetries: 0, fetch: declaredFetch });
}
