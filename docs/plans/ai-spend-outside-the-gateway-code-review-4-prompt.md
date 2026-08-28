# Fourth pass — your three blockers, and how two of them got there

Short review please: does this ship?

## 1 & 2. `reasoningTokens: null`, `inferenceGeo: null`, and `bodyThrew` never set

You were right, and the cause is worth saying plainly: three of my edits **silently matched nothing**.
I had rewritten that block by line number first, so the later string replacements found no anchor,
and a `str.replace` that matches nothing succeeds. I reported them as done without re-reading the
file. Now applied, each verified by grep, and each with a mutation that goes red:

- `inferenceGeo: seen.anthropicUsage?.inference_geo ?? null`
- `reasoningTokens: seen.anthropicUsage?.output_tokens_details?.thinking_tokens ?? null`
- `bodyThrew = true` in the `catch`, read after the row is written — with a test that a retried call
  whose body *also* throws keeps its own error rather than the retry one.

## 3. `globalThis.fetch(endpoint)`

Matched now — a `MemberExpression` callee whose property is `fetch`, so `globalThis.fetch`,
`window.fetch` and any other qualification count.

**A second finding came out of mutating it**, which I want on the record because it was my test that
was wrong rather than the code: my matcher case asserted only `findings.length > 0`, and
`globalThis.fetch("https://openrouter.ai/…")` *also* trips the endpoint matcher — which is exactly
the finding a test is allowed to have. So the case passed with the fix reverted. It now asserts the
specific `raw fetch at a provider` finding.

## Pricing — still not applied, and I want your last word

`inference_geo` is on the row. The **1.1x is not applied**, and this is a deliberate refusal rather
than an oversight. `src/pricing.ts` carries `PRICE_CHECKED`, `PRICE_SOURCE`, and a paragraph arguing
that the table lives in git precisely so that no rate enters it without someone reviewing it —
*"a price that can change without anyone reviewing it is the problem, not the solution"*. Taking a
rate from a review's citation without opening the page is what that paragraph refuses.

The exposure is bounded and written into the plan: it applies only to the declared bypasses, which
are eval spend, and only to calls that actually ran in the US. Everything through either gateway
carries OpenRouter's own settled figure.

Tell me if you think that is the wrong call.

## Verification

- **26 mutations**, each applied, confirmed red, reverted. Four of them did not go red first time
  and each produced a test that did not exist: the named SDK import, the `declaredFetch` close, the
  closed-box check, and the qualified fetch.
- Live probe after the fixes: `cost_source=computed`, `computed=32000` nanos,
  `price_version=claude-haiku-4-5-20251001@1970-01-01`, `service_tier=standard`. `inference_geo` and
  the thinking tokens came back null from the real API for that call — a Haiku call with no thinking
  and no geo configured — so the assertions for them are unit tests against a synthetic usage object.
- All three TypeScript projects clean apart from other agents' files.

---

# The two files that changed


## `evals/declared-spend.ts`
```ts
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
```

## `tests/no-undeclared-spend.test.ts`
```ts
/**
 * **Nothing may spend money without saying so.**
 *
 * `npm run cost` claims to have seen every paid call. That claim was true on the
 * day it was written and had already stopped being true by the next morning:
 * eight sites in `evals/`, on two different accounts, spending real money into
 * no total at all — see docs/plans/ai-spend-outside-the-gateway.md.
 *
 * Repairing those was a one-off. This is the part that keeps them repaired. It
 * walks every tracked JavaScript and TypeScript file and asks a narrow question
 * — *does this file have the capability to spend money?* — then insists that
 * every file which does is either one of the seams, or an entry in
 * [`src/spend-declarations.ts`](../src/spend-declarations.ts), or on the small
 * allow-list below with a reason.
 *
 * ## Capability, parsed
 *
 * The first version matched hostnames in raw text and lit up on three dozen
 * files that only *mention* `api.anthropic.com` in a doc comment. The second
 * stripped comments by hand, to avoid depending on a parser that had arrived as
 * somebody else's transitive dependency — this repo is on TypeScript 7, whose
 * package no longer exposes `createSourceFile`. GPT Sol took that apart: a
 * hand-written stripper desynchronises on a nested template literal
 * (`` `a ${`b`}` ``), and the failure is a **false negative** — a `new
 * Anthropic()` after it lands inside what the stripper thinks is a string. A
 * gate that can go quiet is worse than one that can go red.
 *
 * So `@babel/parser` is now a **direct** dev dependency, which is the whole of
 * the objection answered: the risk was never the parser, it was depending on one
 * nobody had declared. What counts as a capability is deliberately short —
 *
 * - **constructing** a provider client, through whatever name the SDK was bound
 *   to — default, namespace or alias — rather than importing the package:
 *   `src/anthropic-call.ts` imports its error classes and can no more make a
 *   call than a type can;
 * - a provider hostname or a paid endpoint path in a string or a template;
 * - the name of an AI credential, which catches `process.env.OPENROUTER_API_KEY`
 *   and equally the regular expression both dictation benches use to pull the
 *   key out of `.env.local` by hand.
 *
 * ## A declaration is not a licence for a file
 *
 * It used to be: any capability in a declared file passed. GPT Sol pointed out
 * that this exempts every *future* call in that file too, and that another file
 * could import the wrapper and reuse an existing id. So a metered declaration
 * exempts its file only while that file actually uses that id, and an id used
 * anywhere else fails. The `unscoped` and unmetered entries are still whole-file
 * admissions — they are printed by name and by age on every `npm run cost`,
 * which is the point of them.
 *
 * ## What defeats it, said out loud
 *
 * A hostname built by concatenation. A base URL arriving in an env var it does
 * not know. A client made by a factory in another file. A provider nobody has
 * heard of. `curl` in a subprocess. It is a **tripwire, not a boundary** — the
 * same thing `src/ai-call.ts` says about its own unexported base URL. The
 * boundary with teeth is `declaredFetch` in evals/declared-spend.ts, which
 * refuses to run outside a declaration. This catches the ordinary case, which is
 * somebody in a hurry, and the ordinary case is the one that has happened.
 */

import { type ParseResult, parse } from "@babel/parser";
import type { File } from "@babel/types";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { DECLARATIONS } from "../src/spend-declarations.js";

const ROOT = path.resolve(import.meta.dirname, "..");

/** Hosts and paid endpoint paths. A literal containing one is a capability. */
const ENDPOINTS = [
  "openrouter.ai",
  "api.anthropic.com",
  "api.openai.com",
  "api.voyageai.com",
  "/v1/chat/completions",
  "/v1/audio/transcriptions",
  "/v1/embeddings",
];

/** The packages whose exports can make a client. */
const SDKS = ["@anthropic-ai/sdk", "openai"];

/** The names those packages export a client class under, besides the default. */
const CLIENT_EXPORTS = ["Anthropic", "OpenAI", "AnthropicBedrock", "AnthropicVertex"];

/**
 * The two ways a declared bypass is allowed to reach the wire. Calling either is
 * as much a capability as `new Anthropic()` — they exist so that a bypass keeps
 * an account, not so that it stops counting as one.
 */
const GUARDED_TRANSPORTS = ["anthropicForDeclared", "declaredFetch"];

/** The credentials that pay for inference. Not Supabase's, not the database's. */
const CREDENTIALS = ["OPENROUTER_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"];

/**
 * Files allowed to have the capability without being a declared bypass.
 *
 * Every line is a reason, and a file that is here for no reason is the failure
 * this test exists to make visible.
 */
const ALLOWED: Readonly<Record<string, string>> = {
  "src/ai-call.ts":
    "The chat/embeddings seam. One of the two places allowed to name OpenRouter.",
  "src/messages-stream.ts":
    "The Messages seam. The other one.",
  "src/env.ts":
    "Loads .env.local. It names the credentials; it never sends one anywhere.",
  "src/models.ts":
    "Names models and routing policy. No transport.",
  "src/auth.ts":
    "Reads Supabase credentials, and is caught only because the matcher is name-based.",
  "src/urls.ts": "URL handling for articles the reader pastes.",
  "src/log-redaction.ts":
    "Knows the credential names precisely so it can keep them out of logs.",
  "src/vercel-health.ts": "Reports which credentials are configured, never their values.",
  "scripts/ai-cost.ts":
    "Reads GET /api/v1/key to reconcile. Costs nothing and buys no inference.",
  "evals/declared-spend.ts":
    "The bypass wrapper itself, and the guarded fetch that makes one safe.",
  "src/spend-declarations.ts": "The register. Data, not transport.",
  "tests/public-visibility-pg.test.ts":
    "A positive control for its own fetch spy — `globalThis.fetch` is mocked for the length of the assertion, so no request leaves. Listed by name because a test that really did reach a provider is a thing worth being told about.",
  "tests/declared-spend.test.ts":
    "Exercises the guarded transport against a stubbed global fetch. Listed by name rather than by a blanket tests/ exemption, because a test that really did reach a provider is a thing worth being told about.",

  /* **Six that only ask whether the key is configured.** Each reads
     `OPENROUTER_API_KEY` to fail with a sentence a person can act on, and then
     makes its request through the seam; none of them names an endpoint. Listed
     one by one rather than exempted by a rule, because a *seventh* place
     learning to resolve credentials for itself is how the dictation benches
     came to parse `.env.local` with a regular expression, and that is worth
     one line of friction to find out about. */
  "src/converse.ts": "Presence check only; the call goes through openRouterStream.",
  "src/explain.ts": "Presence check only; the call goes through openRouterStream.",
  "src/search.ts": "Presence check only; the call goes through openRouterStream.",
  "src/transcribe.ts": "Presence check only; the call goes through openRouterJson.",
  "src/pdf-read.ts": "Presence check only; the call goes through openRouterJson.",
  "src/embeddings.ts":
    "Presence check, plus a settings URL in a help message. The call goes through openRouterJson.",
};

interface Finding {
  readonly file: string;
  readonly what: string;
}

interface Scan {
  readonly findings: Finding[];
  /** Declaration ids this file passes to `withDeclaredExternalCall`. */
  readonly declarationIds: Set<string>;
  readonly parseErrors: number;
}

/**
 * Every JS/TS file git can see — **tracked *and* not-yet-added**.
 *
 * `--others --exclude-standard` is the load-bearing half. Listing only tracked
 * files would mean a brand-new bypass passed this test on the machine that
 * wrote it and failed for the first time on somebody else's, after the commit —
 * which is exactly the wrong way round. Ignored paths stay out, so `data/` and
 * the scratch files the `.gitignore` already covers are not scanned.
 */
function trackedSources(): string[] {
  const ls = (args: string[]): string[] =>
    execFileSync("git", ["ls-files", "-z", ...args], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    })
      .split("\0")
      .filter((f) => /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(f))
      .filter((f) => !f.startsWith("node_modules/"));

  const tracked = ls(["--cached"]);
  /* **`scratch-*` at the root is exempt only while it is untracked**, which the
     first version claimed and did not do — it filtered the name unconditionally,
     so a *committed* `scratch-anything.ts` was invisible. GPT Sol.

     The exemption exists because these are one-afternoon spikes that nobody
     intends to keep, and making every agent's suite red for a colleague's
     throwaway file is how a gate gets muted. The moment one is `git add`ed it is
     scanned, which is before it can be committed. */
  const untracked = ls(["--others", "--exclude-standard"]).filter(
    (f) => !/^scratch-[^/]*$/.test(f),
  );
  return [...tracked, ...untracked];
}

/** Babel's own options, in one place — TS and TSX both. */
function parseFile(source: string): ParseResult<File> {
  return parse(source, {
    sourceType: "unambiguous",
    allowReturnOutsideFunction: true,
    /* Recovery rather than a throw: a file this cannot parse must not make the
       gate *pass*. Errors are collected and reported separately below. */
    errorRecovery: true,
    plugins: ["typescript", "jsx", "decorators-legacy", "explicitResourceManagement"],
  });
}

/** Every node, once. Comments live on `leadingComments` and friends, and are skipped. */
function walk(node: unknown, visit: (n: Record<string, unknown>) => void): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  const n = node as Record<string, unknown>;
  if (typeof n.type !== "string") return;
  visit(n);
  for (const [key, value] of Object.entries(n)) {
    if (SKIP_KEYS.has(key)) continue;
    walk(value, visit);
  }
}

const SKIP_KEYS = new Set([
  "loc",
  "range",
  "leadingComments",
  "trailingComments",
  "innerComments",
  "comments",
  "extra",
]);

/**
 * What a single file can do, and which declaration ids it uses.
 *
 * Exported so the matcher tests below can hand it source text directly rather
 * than writing files into the repo.
 */
export function capabilitiesOf(file: string, source: string): Scan {
  const ast = parseFile(source);
  const found: Finding[] = [];
  const declarationIds = new Set<string>();
  /** Local names bound to a provider SDK — default, namespace, or renamed. */
  const sdkNames = new Set<string>();

  /* Two passes: an import can be anywhere in the file, and a `new` above it
     would otherwise be missed. Cheap — these are single files. */
  walk(ast.program, (n) => {
    if (n.type === "VariableDeclarator") {
      /* `const { Anthropic } = require("@anthropic-ai/sdk")`, and the whole-module
         form. CommonJS is rare here and was a straight hole. */
      const init = n.init as Record<string, unknown> | undefined;
      const callee = init?.callee as { type?: string; name?: string } | undefined;
      const arg = (init?.arguments as Record<string, unknown>[] | undefined)?.[0];
      if (
        callee?.type === "Identifier" &&
        callee.name === "require" &&
        arg?.type === "StringLiteral" &&
        SDKS.includes(arg.value as string)
      ) {
        const id = n.id as Record<string, unknown>;
        if (id.type === "Identifier") sdkNames.add(id.name as string);
        for (const pr of (id.properties ?? []) as Record<string, unknown>[]) {
          const key = pr.key as { name?: string } | undefined;
          if (key?.name && CLIENT_EXPORTS.includes(key.name)) {
            sdkNames.add((pr.value as { name?: string }).name ?? key.name);
          }
        }
      }
      return;
    }
    if (n.type !== "ImportDeclaration") return;
    const spec = (n.source as { value?: string } | undefined)?.value;
    if (!spec || !SDKS.includes(spec)) return;
    if (n.importKind === "type") return;
    for (const sp of (n.specifiers ?? []) as Record<string, unknown>[]) {
      /* The default and the namespace both yield a client. So does a **named**
         import — `import { Anthropic } from "@anthropic-ai/sdk"` works, because
         the SDK exports the class by name as well, and missing it was a
         regression against the text matcher this replaced. GPT Sol.
         `src/anthropic-call.ts` imports `APIError` by name and is still clean,
         because only the client classes count. */
      if (sp.type === "ImportDefaultSpecifier" || sp.type === "ImportNamespaceSpecifier") {
        sdkNames.add((sp.local as { name: string }).name);
      }
      if (
        sp.type === "ImportSpecifier" &&
        sp.importKind !== "type" &&
        CLIENT_EXPORTS.includes((sp.imported as { name?: string } | undefined)?.name ?? "")
      ) {
        sdkNames.add((sp.local as { name: string }).name);
      }
    }
  });

  walk(ast.program, (n) => {
    if (n.type === "NewExpression") {
      const callee = n.callee as Record<string, unknown> | undefined;
      /* `new Anthropic()` and `new SDK.Anthropic()` alike: the root of the
         member chain is what the import bound. */
      const root =
        callee?.type === "Identifier"
          ? (callee.name as string)
          : callee?.type === "MemberExpression"
            ? ((callee.object as { name?: string } | undefined)?.name ?? "")
            : "";
      if (sdkNames.has(root)) found.push({ file, what: `constructs ${root}` });
    }

    if (n.type === "StringLiteral" || n.type === "TemplateElement") {
      const text =
        n.type === "StringLiteral"
          ? (n.value as string)
          : (((n.value as { cooked?: string; raw?: string }).cooked ??
              (n.value as { raw?: string }).raw) ??
            "");
      for (const e of ENDPOINTS) if (text.includes(e)) found.push({ file, what: `names ${e}` });
      for (const c of CREDENTIALS) if (text.includes(c)) found.push({ file, what: `names ${c}` });
    }

    /* `process.env.OPENROUTER_API_KEY` and `const { ANTHROPIC_API_KEY } = …` —
       an identifier, not a string, so the literal branch above misses both. */
    if (n.type === "Identifier" && CREDENTIALS.includes(n.name as string)) {
      found.push({ file, what: `names ${n.name as string}` });
    }
    if (n.type === "RegExpLiteral") {
      const pattern = n.pattern as string;
      for (const c of CREDENTIALS) if (pattern.includes(c)) found.push({ file, what: `matches ${c}` });
    }

    /* Which declaration ids this file claims — the first argument to the
       wrapper, which is the only way to use one. */
    if (n.type === "CallExpression") {
      const callee = n.callee as
        | { type?: string; name?: string; property?: { name?: string } }
        | undefined;
      if (callee?.type === "Identifier" && callee.name === "withDeclaredExternalCall") {
        const first = (n.arguments as Record<string, unknown>[])[0];
        if (first?.type === "StringLiteral") declarationIds.add(first.value as string);
      }
      /* **The guarded transports count as transport.** They are the whole point
         of the wrapper — `evals/embedding-retrieval.ts` builds its client with
         `anthropicForDeclared()` and names no host at all, and under a matcher
         that only knows about `new Anthropic()` its own declaration read as
         stale. Which is the correct behaviour of that check and the wrong answer
         from this one. */
      if (
        callee?.type === "Identifier" &&
        GUARDED_TRANSPORTS.includes(callee.name as string)
      ) {
        found.push({ file, what: `uses ${callee.name}` });
      }
      /* **A bare `fetch` at a provider — the one capability a declaration never
         covers.** GPT Sol found both holes it closes: a declared file could grow
         an unrelated raw request beside its declared call and stay exempt, and a
         test could make a real request while every endpoint finding in `tests/`
         was being discarded as "probably an assertion". A string in an
         assertion is not passed to `fetch`; this is. */
      /* `fetch(…)`, `globalThis.fetch(…)`, `window.fetch(…)` — a bare
         identifier was all the first version matched, and GPT Sol pointed out
         that the qualified form walked straight past it, inside a metered
         declared file and inside a test. */
      const fetchName =
        callee?.type === "Identifier"
          ? (callee.name as string)
          : callee?.type === "MemberExpression"
            ? (callee.property?.name ?? "")
            : "";
      if (fetchName === "fetch") {
        const target = JSON.stringify(n.arguments ?? []);
        if (ENDPOINTS.some((e) => target.includes(e))) {
          found.push({ file, what: "raw fetch at a provider" });
        }
      }
    }
  });

  return { findings: found, declarationIds, parseErrors: ast.errors?.length ?? 0 };
}

/**
 * **The whole per-file verdict**, as a function rather than a loop body.
 *
 * Extracted for the reason `isExempt` was: every rule left inline was a rule
 * nothing could prove. A mutation that let a metered declaration cover a raw
 * `fetch` passed the entire suite, because no file in this repo happens to have
 * that shape — so the only way to watch the rule fail is to hand it one.
 */
export function offenceFor(file: string, scan: Scan): string | null {
  /* A test may *name* an endpoint — one that could not write `openrouter.ai`
     could not check that the seam sends there — but it may not construct a
     client, reach a guarded transport, or hand the string to `fetch`. */
  const caps = file.startsWith("tests/")
    ? scan.findings.filter(isTransport).filter((f) => !f.what.startsWith("names "))
    : scan.findings;
  if (caps.length === 0) return null;
  if (ALLOWED[file]) return null;

  const say = () => `${file} — ${[...new Set(caps.map((c) => c.what))].join(", ")}`;

  /* **A *metered* declaration covers what the wrapper guards, and nothing
     else.** A raw request sitting next to a declared call is how a declared file
     would otherwise acquire unlimited new capability — GPT Sol's point, and the
     reason this is separate from `isExempt`.

     An **unmetered** entry is the opposite kind of statement: it claims nothing
     is accounted for, and a raw fetch is precisely what it admits to. Those are
     printed by name and by age on every `npm run cost` until somebody closes
     them. */
  const raw = caps.some((c) => c.what === "raw fetch at a provider");
  const admitted = DECLARATIONS.some((d) => d.file === file && !d.metered);
  if (raw && !admitted) return say();
  if (isExempt(file, scan)) return null;
  return say();
}

/**
 * **Whether a declaration still covers this file.**
 *
 * A function rather than three lines inside the assertion, so it can be given a
 * made-up file and checked. Left inline, the rule that matters most here — a
 * metered declaration covers its file *only while that file uses its id* — was
 * the one thing in this test that nothing could prove, and a mutation loosening
 * it back to "any declaration, any file" passed every case.
 *
 * `unscoped` and unmetered entries are still whole-file admissions. They are
 * printed by name and by age on every `npm run cost`, which is the point of
 * them: not a permission, a debt with a date on it.
 */
export function isExempt(file: string, scan: Scan): boolean {
  const mine = DECLARATIONS.filter((d) => d.file === file);
  if (mine.length === 0) return false;
  return mine.some((d) => (d.metered ? scan.declarationIds.has(d.id) : true));
}

/** A capability that is transport, as against merely knowing a credential's name. */
function isTransport(f: Finding): boolean {
  return (
    f.what.startsWith("constructs ") ||
    f.what.startsWith("uses ") ||
    f.what === "raw fetch at a provider" ||
    ENDPOINTS.some((e) => f.what === `names ${e}`)
  );
}

describe("no undeclared spend", () => {
  /** Scanned once — the whole repo, and every assertion below reads this. */
  const scans = new Map<string, Scan>();
  for (const file of trackedSources()) {
    scans.set(file, capabilitiesOf(file, readFileSync(path.join(ROOT, file), "utf8")));
  }
  const byId = new Map(DECLARATIONS.map((d) => [d.id, d]));

  it("finds every file that can reach a paid provider", () => {
    const offenders: string[] = [];
    for (const [file, scan] of scans) {
      const offence = offenceFor(file, scan);
      if (offence) offenders.push(offence);
    }

    expect(
      offenders,
      "These files can reach a paid provider and are neither a seam nor declared.\n" +
        "Route the call through src/ai-call.ts or src/messages-stream.ts, or — if the\n" +
        "transport is the thing being measured — add it to DECLARATIONS in\n" +
        "src/spend-declarations.ts with the reason the seam is wrong for it.\n",
    ).toEqual([]);
  });

  it("lets no metered declaration cover a raw request beside its declared call", () => {
    /* The hole GPT Sol named: a declared file could grow an unrelated
       `fetch("https://openrouter.ai/…")` and stay exempt, because the exemption
       was per file rather than per capability. No file here happens to have that
       shape, so the rule is handed one. */
    const metered = DECLARATIONS.find((d) => d.metered)!;
    const withRaw: Scan = {
      findings: [
        { file: metered.file, what: `uses declaredFetch` },
        { file: metered.file, what: "raw fetch at a provider" },
      ],
      declarationIds: new Set([metered.id]),
      parseErrors: 0,
    };
    expect(offenceFor(metered.file, withRaw)).not.toBeNull();
    /* The guarded call on its own is still fine. */
    expect(
      offenceFor(metered.file, { ...withRaw, findings: [withRaw.findings[0]!] }),
    ).toBeNull();
  });

  it("lets an unmetered admission own the raw request it is admitting to", () => {
    const open = DECLARATIONS.find((d) => !d.metered)!;
    expect(
      offenceFor(open.file, {
        findings: [{ file: open.file, what: "raw fetch at a provider" }],
        declarationIds: new Set(),
        parseErrors: 0,
      }),
    ).toBeNull();
  });

  it("lets no test make a real request, however freely it may name one", () => {
    const naming: Scan = {
      findings: [{ file: "tests/x.test.ts", what: "names openrouter.ai" }],
      declarationIds: new Set(),
      parseErrors: 0,
    };
    expect(offenceFor("tests/x.test.ts", naming)).toBeNull();
    expect(
      offenceFor("tests/x.test.ts", {
        ...naming,
        findings: [{ file: "tests/x.test.ts", what: "raw fetch at a provider" }],
      }),
    ).not.toBeNull();
  });

  it("stops covering a file that no longer uses its metered declaration", () => {
    /* The exemption GPT Sol took apart: it used to cover every present *and
       future* capability in a declared file, so a metered entry kept its licence
       long after the call behind it was gone — which is how
       `bench-vocabulary-sources.ts` held a bypass declaration after being
       rewritten to use the seam. */
    const metered = DECLARATIONS.find((d) => d.metered)!;
    const empty: Scan = { findings: [], declarationIds: new Set(), parseErrors: 0 };
    expect(isExempt(metered.file, empty)).toBe(false);
    expect(
      isExempt(metered.file, { ...empty, declarationIds: new Set([metered.id]) }),
    ).toBe(true);
    /* And no declaration covers a file it was not written for. */
    expect(isExempt("evals/somewhere-else.ts", { ...empty, declarationIds: new Set([metered.id]) })).toBe(
      false,
    );
  });

  it("lets no file use a declaration id that was not written for it", () => {
    /* The evasion this closes: import the wrapper somewhere else, pass an id
       that already exists, and every matcher is satisfied. GPT Sol. */
    const wrong: string[] = [];
    for (const [file, scan] of scans) {
      for (const id of scan.declarationIds) {
        const d = byId.get(id);
        if (!d) wrong.push(`${file} uses "${id}", which is in no declaration`);
        else if (d.file !== file) wrong.push(`${file} uses "${id}", declared for ${d.file}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("has no metered declaration that nothing uses", () => {
    /* The other direction. A metered entry whose id appears nowhere is a
       permission with no call behind it, and the next reader takes it as
       evidence that the bypass is necessary. */
    const unused = DECLARATIONS.filter(
      (d) => d.metered && ![...scans.values()].some((s) => s.declarationIds.has(d.id)),
    ).map((d) => d.id);
    expect(unused).toEqual([]);
  });

  it("every `bypass` declaration names a file that really does bypass the seam", () => {
    for (const d of DECLARATIONS) {
      if (d.kind !== "bypass") continue;
      const scan = scans.get(d.file) ?? capabilitiesOf(d.file, readFileSync(path.join(ROOT, d.file), "utf8"));
      /* **Transport, not merely a credential's name.** Checking for any
         capability at all is what let a rewritten file keep its bypass
         declaration: it still said `OPENROUTER_API_KEY` for a presence check,
         and that looked like reaching a provider. */
      expect(
        scan.findings.filter(isTransport).length,
        `${d.id} declares ${d.file} as a bypass, and it no longer reaches a provider directly. Delete the declaration, or change its kind to "unscoped".`,
      ).toBeGreaterThan(0);
    }
  });

  it("an `unscoped` declaration is never marked metered", () => {
    /* `unscoped` means "uses the seam, opens no collector". If it were metered
       there would be nothing to declare. */
    for (const d of DECLARATIONS) {
      if (d.kind === "unscoped") expect(d.metered).toBe(false);
    }
  });

  it("no declaration is a duplicate, and every one says why and when", () => {
    const ids = DECLARATIONS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const d of DECLARATIONS) {
      expect(d.why.length).toBeGreaterThan(40);
      expect(d.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("parses every file it scans, rather than passing one it could not read", () => {
    /* A file Babel cannot parse yields no nodes and therefore no findings —
       which reads exactly like a clean file. Recovery keeps the errors instead
       of throwing, and this is what stops them being ignored. */
    const broken = [...scans.entries()]
      .filter(([, s]) => s.parseErrors > 0)
      .map(([f, s]) => `${f} (${s.parseErrors})`);
    expect(broken).toEqual([]);
  });

  /**
   * **The matchers, proved against the broken state.**
   *
   * A scan nobody has watched fail is not evidence — docs/reusable/silent-success.md,
   * and the reason this block exists rather than a comment saying the matchers
   * look right. Each case is a way somebody has actually reached a provider in
   * this repo.
   */
  describe("the matchers catch what they claim to", () => {
    const cases: [string, string][] = [
      ["a constructed client", 'import Anthropic from "@anthropic-ai/sdk";\nconst c = new Anthropic();'],
      ["a hostname", 'await fetch("https://openrouter.ai/api/v1/key");'],
      ["a path on a variable host", "await fetch(`${BASE}/v1/chat/completions`);"],
      ["the audio endpoint", 'await fetch("https://openrouter.ai/api/v1/audio/transcriptions");'],
      ["an env credential", "const k = process.env.OPENROUTER_API_KEY;"],
      ["a hand-parsed .env.local", 'const k = /OPENROUTER_API_KEY\\s*=\\s*(.+)/.exec(env);'],
      [
        /* **The case that killed the hand-written stripper.** A nested template
           desynchronised its quote tracking, so everything after it read as a
           string and the constructor below vanished — a false *negative*, which
           is the direction that matters. GPT Sol. */
        "a constructor after a nested template literal",
        [
          'import Anthropic from "@anthropic-ai/sdk";',
          "const s = `outer ${`inner`} tail`;",
          "const c = new Anthropic();",
        ].join("\n"),
      ],
      [
        /* **The SDK exports its client by name as well as by default**, so this
           works — and the AST version missed it where the text matcher it
           replaced did not. GPT Sol. */
        "a named import of the client class",
        'import { Anthropic } from "@anthropic-ai/sdk";\nconst c = new Anthropic();',
      ],
      [
        "a CommonJS destructured require",
        'const { Anthropic } = require("@anthropic-ai/sdk");\nconst c = new Anthropic();',
      ],
      [
        "a raw fetch at a provider",
        'await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST" });',
      ],

      [
        "a namespace import of the SDK",
        'import * as SDK from "@anthropic-ai/sdk";\nconst c = new SDK.Anthropic();',
      ],
      [
        "a renamed default import",
        'import Claude from "@anthropic-ai/sdk";\nconst c = new Claude();',
      ],
      ["a destructured credential", "const { OPENROUTER_API_KEY } = process.env;"],
    ];
    for (const [name, source] of cases) {
      it(name, () => {
        expect(capabilitiesOf("scratch.ts", source).findings.length).toBeGreaterThan(0);
      });
    }

    it("calls a qualified fetch a raw fetch, not merely a mention", () => {
      /* **The mutation that found this test missing.** `globalThis.fetch(url)`
         still contains the hostname, so a matcher that only asked "did anything
         fire" was satisfied by the endpoint match — and the endpoint match is
         exactly the one a test is allowed to have. GPT Sol found the hole; the
         mutation found that asserting `length > 0` could not see it. */
      const found = capabilitiesOf(
        "scratch.ts",
        'await globalThis.fetch("https://openrouter.ai/api/v1/chat/completions");',
      ).findings;
      expect(found.map((f) => f.what)).toContain("raw fetch at a provider");
    });

    it("does not fire on a named import of something that is not a client", () => {
      /* `src/anthropic-call.ts` imports the SDK's error classes and can no more
         make a call than a type can. It must stay clean, or the allow-list
         grows an entry that means nothing. */
      const source = [
        'import { APIError, AnthropicError } from "@anthropic-ai/sdk";',
        "export const is = (e: unknown) => e instanceof APIError || e instanceof AnthropicError;",
      ].join("\n");
      expect(capabilitiesOf("scratch.ts", source).findings).toEqual([]);
    });

    it("does not fire on a comment, or on a type-only import", () => {
      const source = [
        "/* We used to post to https://openrouter.ai/api/v1/chat/completions with",
        "   process.env.OPENROUTER_API_KEY, and no longer do. */",
        '// api.anthropic.com is not reachable from here.',
        'import type Anthropic from "@anthropic-ai/sdk";',
        "export type T = Anthropic.Message;",
      ].join("\n");
      expect(capabilitiesOf("scratch.ts", source).findings).toEqual([]);
    });
  });
});
```

## `tests/declared-spend.test.ts`
```ts
/**
 * **The declared bypass** — the one way a call is allowed to skip both gateways
 * and still appear in `npm run cost`.
 *
 * What is worth testing here is not that a happy call produces a row. It is the
 * four ways this could quietly under-report, each of which was a real design
 * choice argued out with GPT Sol on 2026-08-28:
 *
 * 1. a call that **throws** must still leave a row, or a run of failures reads
 *    as a run of free calls;
 * 2. a call that reports **no usage** must be `cost_source: "none"`, never `0` —
 *    an unknown price and a free call are different facts;
 * 3. **retries** must not hide behind one row, because a bare Anthropic client
 *    makes up to three billable attempts by default;
 * 4. a `fetch` **outside** a declaration must not run at all.
 *
 * See docs/plans/ai-spend-outside-the-gateway.md.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { type AiCallRow, collectSpend } from "../src/ai-spend.js";
import {
  declaredFetch,
  withDeclaredExternalCall,
} from "../evals/declared-spend.js";
import { DECLARATIONS, declarationFor } from "../src/spend-declarations.js";

/* A real declared id, so the test cannot drift from the register. */
const METERED = DECLARATIONS.find((d) => d.metered)?.id ?? "";
const UNMETERED = DECLARATIONS.find((d) => !d.metered)?.id ?? "";

/** Sonnet 5's usage, in the shape the Anthropic SDK hands back. */
const USAGE = { input_tokens: 1_000, output_tokens: 100 };

async function rowsFrom(fn: () => Promise<unknown>): Promise<AiCallRow[]> {
  const rows: AiCallRow[] = [];
  await collectSpend(fn, {
    attribution: { scopeKind: "eval", ownerId: "00000000-0000-4000-8000-00000000d001" },
    sink: async (row) => {
      rows.push(row);
    },
  }).catch(() => undefined);
  return rows;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the register", () => {
  it("refuses an id nobody declared", () => {
    expect(() => declarationFor("no-such-bypass")).toThrow(/not a declared bypass/);
  });

  it("refuses an id that is declared but not yet metered", () => {
    /* The whole point of the `metered: false` rows is that they are named and
       *not* wired. Letting one through this wrapper would mean the report
       listing it as uncounted while it was quietly writing rows. */
    expect(() => declarationFor(UNMETERED)).toThrow(/not metered/);
  });
});

describe("withDeclaredExternalCall", () => {
  it("prices an Anthropic call from the table, and says the figure is ours", async () => {
    const rows = await rowsFrom(() =>
      withDeclaredExternalCall(METERED, { model: "claude-sonnet-5" }, async ({ observe }) => {
        observe.anthropic({ usage: USAGE, model: "claude-sonnet-5" });
        return "done";
      }),
    );

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.costSource).toBe("computed");
    /* Not in `credits_used_nanos`, which means one specific thing — what
       OpenRouter deducted — and this call never went near OpenRouter. */
    expect(row.creditsUsedNanos).toBeNull();
    expect(row.computedCostNanos).toBeGreaterThan(0);
    expect(row.priceVersion).toMatch(/claude-sonnet-5@\d{4}-\d{2}-\d{2}/);
    expect(row.providerAccount).toBe("anthropic");
    expect(row.scopeKind).toBe("eval");
    /* The declaration id travels on the row, so a surprising number leads back
       to the reason the call was allowed to skip the gateway. */
    expect(row.stepName).toBe(METERED);
    expect(row.outcome).toBe("ok");
    expect(row.reportedInputTokens).toBe(1_000);
  });

  it("writes a row when the call throws, and does not call it free", async () => {
    const rows = await rowsFrom(() =>
      withDeclaredExternalCall(METERED, { model: "claude-sonnet-5" }, async () => {
        throw new Error("upstream said no");
      }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome).toBe("error");
    /* **`none`, not a zero.** The money may well have been spent — an aborted
       or refused call is still billed for what it produced — and the report
       says the total is short by an unknown amount rather than adding nothing. */
    expect(rows[0]?.costSource).toBe("none");
    expect(rows[0]?.computedCostNanos).toBeNull();
    expect(rows[0]?.creditsUsedNanos).toBeNull();
  });

  it("lets the caller's error through rather than replacing it", async () => {
    /* The retry check used to live in the `finally`, where a `throw` silently
       replaced whatever the body threw — so a genuine provider failure came
       back as a lecture about retries and the row was never written at all. */
    await expect(
      collectSpend(
        () =>
          withDeclaredExternalCall(METERED, { model: "claude-sonnet-5" }, async () => {
            throw new Error("upstream said no");
          }),
        {
          attribution: { scopeKind: "eval", ownerId: "00000000-0000-4000-8000-00000000d001" },
          sink: async () => undefined,
        },
      ),
    ).rejects.toThrow("upstream said no");
  });

  it("takes OpenRouter's own figure when there is one, and never both", async () => {
    const or = DECLARATIONS.find((d) => d.metered && d.account === "openrouter");
    expect(or, "there should be at least one metered OpenRouter bypass").toBeDefined();
    const rows = await rowsFrom(() =>
      withDeclaredExternalCall(or!.id, { model: "google/gemini-3.7-flash" }, async ({ observe }) => {
        observe.openRouter({
          usage: { prompt_tokens: 900, completion_tokens: 12, cost: 0.000_18 },
          model: "google/gemini-3.7-flash",
          provider: "Google",
        });
      }),
    );

    expect(rows[0]?.costSource).toBe("provider");
    expect(rows[0]?.creditsUsedNanos).toBe(180_000);
    expect(rows[0]?.computedCostNanos).toBeNull();
    expect(rows[0]?.providerAccount).toBe("openrouter");
    expect(rows[0]?.upstream).toBe("Google");
  });

  it("refuses to report one row for two HTTP attempts", async () => {
    /* The bug this exists for: a default Anthropic client retries twice, so one
       `messages.create` can be three billable requests and one row. */
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));
    await expect(
      collectSpend(
        () =>
          withDeclaredExternalCall(METERED, { model: "claude-sonnet-5" }, async () => {
            await declaredFetch("https://example.test/one");
            await declaredFetch("https://example.test/two");
          }),
        {
          attribution: { scopeKind: "eval", ownerId: "00000000-0000-4000-8000-00000000d001" },
          sink: async () => undefined,
        },
      ),
    ).rejects.toThrow(/2 HTTP attempts/);
  });

  it("still writes the row before complaining about the attempts", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));
    const rows = await rowsFrom(() =>
      withDeclaredExternalCall(METERED, { model: "claude-sonnet-5" }, async ({ observe }) => {
        await declaredFetch("https://example.test/one");
        await declaredFetch("https://example.test/two");
        observe.anthropic({ usage: USAGE, model: "claude-sonnet-5" });
      }),
    );
    /* The money was spent twice over. Refusing to record it as well would be
       the worst of both. */
    expect(rows).toHaveLength(1);
  });
});

describe("a retried call", () => {
  it("records no amount at all, rather than one attempt's", async () => {
    /* Row-versus-no-row was a false choice, which is GPT Sol's phrase and it is
       right: the money was spent about N times over, so the honest row says the
       call happened and that we cannot say what it cost. The report then counts
       it under "short by an unknown amount". */
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));
    const rows = await rowsFrom(() =>
      withDeclaredExternalCall(METERED, { model: "claude-sonnet-5" }, async ({ observe }) => {
        await declaredFetch("https://example.test/one");
        await declaredFetch("https://example.test/two");
        observe.anthropic({ usage: USAGE, model: "claude-sonnet-5" });
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome).toBe("error");
    expect(rows[0]?.costSource).toBe("none");
    expect(rows[0]?.computedCostNanos).toBeNull();
  });

  it("keeps the body's own error rather than replacing it with the retry one", async () => {
    /* The flag that decides this was never assigned for a while — the edit that
       added it had an anchor that had already moved, and a `replace` matching
       nothing says nothing. GPT Sol read the file and found it. */
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));
    await expect(
      collectSpend(
        () =>
          withDeclaredExternalCall(METERED, { model: "claude-sonnet-5" }, async () => {
            await declaredFetch("https://example.test/one");
            await declaredFetch("https://example.test/two");
            throw new Error("upstream said no");
          }),
        {
          attribution: { scopeKind: "eval", ownerId: "00000000-0000-4000-8000-00000000d001" },
          sink: async () => undefined,
        },
      ),
    ).rejects.toThrow("upstream said no");
  });
});

describe("the guard against spending into nothing", () => {
  it("refuses to make the call when no ledger is open at all", async () => {
    await expect(
      withDeclaredExternalCall(METERED, { model: "claude-sonnet-5" }, async () => "never"),
    ).rejects.toThrow(/no ledger open/);
  });

  it("refuses a collector that reports but never writes", async () => {
    /* **The failure GPT Sol drove**, and the reason `collectingSpend()` is not
       the right question: a collector with no sink hands its calls to whoever
       opened it and writes nothing durable. A bypass is only permitted at all
       because it still writes a row, so running inside one of those is the one
       thing it must not quietly do. */
    let ran = false;
    await expect(
      collectSpend(
        () =>
          withDeclaredExternalCall(METERED, { model: "claude-sonnet-5" }, async () => {
            ran = true;
            return "x";
          }),
        { attribution: { scopeKind: "eval", ownerId: "00000000-0000-4000-8000-00000000d001" } },
      ),
    ).rejects.toThrow(/no ledger open/);
    expect(ran, "the body must not have run — the money is not spent").toBe(false);
  });
});

describe("the observer", () => {
  it("refuses the wrong provider's observer for the declaration", async () => {
    /* One accepted row saying `provider_account=anthropic, cost_source=provider`
       — a settled OpenRouter figure attributed to a bill that never saw it.
       GPT Sol produced exactly that against the first version. */
    const anth = DECLARATIONS.find((d) => d.metered && d.account === "anthropic")!;
    await expect(
      collectSpend(
        () =>
          withDeclaredExternalCall(anth.id, { model: "claude-sonnet-5" }, async ({ observe }) => {
            observe.openRouter({ usage: { cost: 0.5 } });
          }),
        {
          attribution: { scopeKind: "eval", ownerId: "00000000-0000-4000-8000-00000000d001" },
          sink: async () => undefined,
        },
      ),
    ).rejects.toThrow(/not the observer for it/);
  });

  it("refuses a second observation rather than keeping the last one", async () => {
    await expect(
      collectSpend(
        () =>
          withDeclaredExternalCall(METERED, { model: "claude-sonnet-5" }, async ({ observe }) => {
            observe.anthropic({ usage: USAGE, model: "claude-sonnet-5" });
            observe.anthropic({ usage: USAGE, model: "claude-sonnet-5" });
          }),
        {
          attribution: { scopeKind: "eval", ownerId: "00000000-0000-4000-8000-00000000d001" },
          sink: async () => undefined,
        },
      ),
    ).rejects.toThrow(/observed its usage twice/);
  });

  it("keeps the cache split and the service tier, which pricing does not read", async () => {
    const rows = await rowsFrom(() =>
      withDeclaredExternalCall(METERED, { model: "claude-sonnet-5" }, async ({ observe }) => {
        observe.anthropic({
          model: "claude-sonnet-5",
          usage: {
            input_tokens: 10,
            output_tokens: 2,
            cache_creation_input_tokens: 90,
            cache_creation: { ephemeral_5m_input_tokens: 60, ephemeral_1h_input_tokens: 30 },
            service_tier: "standard",
            server_tool_use: { web_search_requests: 2 },
            inference_geo: "us",
            output_tokens_details: { thinking_tokens: 40 },
          },
        });
      }),
    );
    /* A 1-hour write costs 1.6x a 5-minute one, so one total will not do. */
    expect(rows[0]?.cacheWrite5mTokens).toBe(60);
    expect(rows[0]?.cacheWrite1hTokens).toBe(30);
    expect(rows[0]?.serviceTier).toBe("standard");
    expect(rows[0]?.webSearches).toBe(2);
    /* **`inference_geo` matters to the money**: US inference is priced above the
       standard rate, so on a US call the computed figure is a floor. The
       multiplier is not applied; this column is what makes those calls findable.
       Both this and the thinking tokens were written as `null` for a while by an
       edit that silently matched nothing — hence the assertions. */
    expect(rows[0]?.inferenceGeo).toBe("us");
    expect(rows[0]?.reasoningTokens).toBe(40);
  });
});

describe("work that outlives the call", () => {
  /* **`AsyncLocalStorage` follows into anything created inside its callback**,
     so "a store exists" is not "the call is still running". GPT Sol drove both
     of these: a fetch scheduled inside `fn` and awaited after it returned went
     out against a row that was already written and closed; and a wrapper started
     from a callback retained past `collectSpend` ran its body and then had the
     row discarded as *late*. */
  it("refuses a fetch scheduled inside the call but run after it", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));
    let detached: Promise<unknown> | null = null;
    await rowsFrom(() =>
      withDeclaredExternalCall(METERED, { model: "claude-sonnet-5" }, async ({ observe }) => {
        /* Started, deliberately not awaited — the shape of a fire-and-forget
           log call, or a `Promise.all` somebody forgot to await. */
        detached = new Promise((r) => setTimeout(r, 0)).then(() =>
          declaredFetch("https://example.test/late"),
        );
        observe.anthropic({ usage: USAGE, model: "claude-sonnet-5" });
      }),
    );
    await expect(detached).rejects.toThrow(/already been recorded/);
  });

  it("refuses to start a declared call once the collector has closed", async () => {
    /* **Scheduled inside the collector, run after it.** Handing a closure out
       and calling it later does not restore the context — the first version of
       this test did that and passed for the wrong reason, because there was no
       store at all by then. `AsyncLocalStorage` propagates into async resources
       *created inside* the callback, so a timer started in `fn` still sees the
       box after `collectSpend` has returned and shut it. */
    let detached: Promise<unknown> | null = null;
    await collectSpend(
      async () => {
        detached = new Promise((r) => setTimeout(r, 0)).then(() =>
          withDeclaredExternalCall(METERED, { model: "claude-sonnet-5" }, async () => "x"),
        );
      },
      {
        attribution: { scopeKind: "eval", ownerId: "00000000-0000-4000-8000-00000000d001" },
        sink: async () => undefined,
      },
    );
    await expect(detached).rejects.toThrow(/no ledger open/);
  });
});

describe("declaredFetch", () => {
  it("refuses to run outside a declaration", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));
    await expect(declaredFetch("https://example.test/")).rejects.toThrow(
      /outside withDeclaredExternalCall/,
    );
  });

  it("runs inside one", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      seen.push(String(url));
      return new Response("{}", { status: 200 });
    });
    await rowsFrom(() =>
      withDeclaredExternalCall(METERED, { model: "claude-sonnet-5" }, async () => {
        await declaredFetch("https://example.test/inside");
      }),
    );
    expect(seen).toEqual(["https://example.test/inside"]);
  });
});
```
