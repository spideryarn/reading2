# Re-review: every blocker from your NO-SHIP, answered

You returned **NO-SHIP** on `docs/plans/ai-spend-outside-the-gateway-code-review-sol.md` a few
minutes ago. This is the same work with all four blockers fixed and most of the other findings taken.
Please look for what I broke fixing them, and for anything the fixes made worse.

## Blocker 1 — the wrapper could spend without a persistent collector. Fixed.

New `persistingSpend()` in `src/ai-spend.ts` — `store.getStore()?.box.sink != null`, deliberately not
`collectingSpend()`, for exactly the reason you gave. `withDeclaredExternalCall` throws **before**
`fn` runs. Two tests: no collector at all, and a collector with no sink; the second asserts the body
never ran, so the money is not spent. Mutating the guard back to `collectingSpend()` goes red.

## Blocker 2 — declarations granted blanket file permission. Fixed, three ways.

- The exemption is now `isExempt(file, scan)`, exported and unit-tested: a **metered** declaration
  covers its file only while that file actually passes its id to `withDeclaredExternalCall`. Mutating
  it back to "any declaration, any file" goes red.
- A new test fails if any file uses an id declared for a different file, or an id in no declaration.
- A new test fails if a metered declaration's id appears nowhere.
- `Declaration` gained `kind: "bypass" | "unscoped"`. You were right that
  `bench-vocabulary-sources.ts` was stale — it calls `transcribeWith`, which goes through the seam,
  and only lacks a collector. It is now `kind: "unscoped"`, and the "really does bypass" test
  requires a **transport** capability rather than any capability, which is what let the stale entry
  survive. `unscoped` + `metered: true` is refused by a test.
- `Declaration` also gained `since`, and `npm run cost` prints each open entry's **age** and whether
  it skips the gateway or merely opens no ledger. No build fails on a date — a gate that trips on the
  calendar gets muted rather than fixed — but "open today" and "open 90 days" now read differently.

**Where I did not follow you:** the root `scratch-*` exemption stays. It is exempt only while
untracked; `git ls-files --cached` lists it the moment it is added, which is before it can be
committed. Making every agent's suite red for a colleague's afternoon spike is how a gate gets muted.
`scratch-tok2.mts` is somebody else's file and calls `countTokens`, which is free. Tell me if you
still think this is wrong.

Tests are no longer wholly skipped: they may name an endpoint or a credential (a test that could not
write `openrouter.ai` could not check the seam sends there) but **may not construct a client or call
a guarded transport**. That immediately caught `tests/declared-spend.test.ts`, which is now
allow-listed by name with the reason (it stubs global `fetch`).

## Blocker 3 — computed spend read as zero in the CLI's own line. Fixed.

`totalSpend` now counts `computedCostNanos`, second only to the BYOK branch. Proved by a live probe:
the same command that used to print `Spent: $0.0000` now prints `Spent: $0.00003200`. Also fixed:
`undeclared()` moved **before** the empty-range return, and the failed-call subtotal now includes
computed.

## Blocker 4 — the observer could underprice and corrupt provenance. Fixed.

- **Account-specific.** The wrong provider's method throws. Your exact attack —
  `observe.openRouter` twice under the Anthropic declaration — now throws rather than producing
  `provider_account=anthropic, cost_source=provider`.
- **Once only.** A second observation throws instead of replacing the first.
- The row now keeps `cache_creation` 5m/1h split, `service_tier` and `server_tool_use.web_search_requests`.
- `inference_geo` is left null **with a comment saying it is unknowable from a direct call**, and
  that a US-defaulting workspace therefore makes `computed_cost_nanos` a floor. I did not invent a
  multiplier. Say if you think the row should instead refuse to carry a figure at all.
- I did **not** take "when attempts exceed one, do not persist a trusted numeric amount." The row is
  still written and the error is still raised. My reasoning: the money was spent, and refusing to
  record it turns an understatement into an absence, which the whole design says is worse. Argue me
  out of it if you disagree.

## Finding 5 — the SQL constraints. Partly taken, partly disputed.

**Taken:** the filesystem store now enforces the same three cases by *reading* them — `agrees()` in
`ai-calls-fs.ts` — plus `price_version` present iff `computed`. That store has no database, and
`totalRows` adds `computed` in one branch and `credits` in another, so a line carrying both is
counted twice. Tested, including that an honest computed line still gets through.

**Disputed, and I want you to push back if I am wrong:** I did not add account/source cross-checks.
`openrouter + computed` is a legitimate future row (OpenRouter reporting no cost while we price it
ourselves), and `anthropic + provider` would be legitimate the day Anthropic reports a figure. A
constraint that forbids a state the design permits is a migration somebody has to undo. I also did
not add a new migration for the `price_version` checks, because `cost_source='computed'` implies
`priceAnthropicCall` returned a version — unreachable from code — and the JSONL store is the one with
nothing else enforcing it, which is where I put the check.

**Agreed and not done:** `price_version` is `model@effective-date` and does not identify the rate
values, so editing a price row in place gives two calculations the same version. Recorded, not fixed.

## Finding 6 — outcome recorded too early. Half taken.

`rescue.mts` now **awaits** `withLedger` rather than discarding the promise — that one was a real
bug. I did not change the seam so that a 200-carrying-an-`error` records `outcome: "error"`:
`openRouterJson` cannot know what its caller will consider a refusal, the transport genuinely
succeeded, and the call genuinely cost money. Tell me if you think `outcome` should mean something
else.

## Finding 7 — the hand-written stripper. Taken in full.

`@babel/parser` is now an explicit `devDependency`, and you are right that this answers the
objection: the risk was never the parser, it was depending on one nobody had declared. The scanner
walks the AST — namespace and renamed imports, member-expression constructors, template quasis,
destructured credentials, regex literals — and skips comment keys. Four new matcher cases, including
**the nested template literal that broke the stripper**, plus `import * as SDK`, a renamed default,
and a destructured credential. Parse errors are collected and a separate test fails on any file the
parser could not read, so an unparseable file cannot make the gate pass.

## Verification

- **15 mutations** total across this work, each applied, confirmed red, reverted. The five new ones:
  the sink guard weakened to `collectingSpend()`; `totalSpend` dropping computed; the observer's
  provider check; the observer's once-only check; the filesystem `agrees()` check; and the exemption
  rule loosened back to whole-file.
- One restore of mine clobbered `collectingSpend`, and the pre-existing test for it caught that.
- **Live probe**, one real Haiku call end to end, after the fixes: `computed: 32000` nanos, and the
  command's own line now reports it.
- `npm test`: 249 of 250 files pass. The one failure (`store-job-draft`) passes in isolation and is
  another agent's file, mid-edit during the run.
- `npm run typecheck`: clean apart from two other agents' files (`inventory.mts` referencing an
  `unhide` that does not exist yet, and an untracked `rename-preview.tsx` in no project).

## What I want from you now

1. Anything the fixes broke, especially in the wrapper's control flow — the guard now runs before
   `beginSpend`, and `withSpendAttribution` still wraps the `finally`.
2. Whether the two places I pushed back (scratch exemption; recording the row on a retried call) are
   defensible.
3. Whether the AST walk has a hole the text version did not.
4. Is this shippable now? If not, name the blocker.

---

# The new and rewritten files


## `src/spend-declarations.ts`
```ts
/**
 * **The register of calls allowed to skip the gateway** — data only, no way to
 * make one.
 *
 * Split from [`evals/declared-spend.ts`](../evals/declared-spend.ts), which
 * holds the wrapper and the guarded `fetch`. The wrapper lives under `evals/`
 * so that nothing in `src/` can reach a second way of calling a model; but the
 * *list* has to be readable from `src/` and from `scripts/`, because
 * [`npm run cost`](../scripts/ai-cost.ts) prints the still-unmetered entries by
 * name every run and
 * [`tests/no-undeclared-spend.test.ts`](../tests/no-undeclared-spend.test.ts)
 * checks the list is complete. A table of facts is safe to share; the thing
 * that can spend money is not.
 *
 * Why any of this exists: docs/plans/ai-spend-outside-the-gateway.md.
 */

import type { ProviderAccount } from "./ai-spend.js";
import type { AiJob, Wire } from "./models.js";

export interface Declaration {
  /** Stable id. Appears on the row's `step_name`, so a row can be traced here. */
  readonly id: string;
  /** Which bill it lands on. */
  readonly account: ProviderAccount;
  /** The one file allowed to use it — checked by the scan, not at run time. */
  readonly file: string;
  /**
   * **What kind of hole this is**, which turned out to be two things wearing one
   * name.
   *
   * `"bypass"` — the file talks to a provider itself, round the outside of both
   * seams. `"unscoped"` — it uses the seam perfectly well and simply never opens
   * a collector, so `recordSpend` warns and drops the row on the floor.
   *
   * The distinction is not bookkeeping. A bypass needs a *reason* the seam is
   * wrong for it; an unscoped file needs one line. GPT Sol found the entry that
   * proved they are different: `bench-vocabulary-sources.ts` was declared as a
   * bypass and had by then been rewritten to call `transcribeWith`, so the
   * declaration was standing permission for something that no longer happened
   * and the test meant to catch that could not, because "names a credential"
   * looked like capability.
   */
  readonly kind: "bypass" | "unscoped";
  /** Which job the call is doing, in the ledger's vocabulary. */
  readonly job: AiJob;
  /** What shape of API it speaks. */
  readonly wire: Wire;
  /**
   * **Whether it actually writes a row yet.**
   *
   * `false` is not a to-do marker that can be ignored: `npm run cost` prints
   * every `false` row by name, every run, as the spend it knows it cannot see.
   * That is the whole difference between this table and the sentence it
   * replaced — *"Not counted here: anything evals/ spends"* — which named
   * nothing and so could never be finished.
   */
  readonly metered: boolean;
  /**
   * Why the seam is wrong for this call — or, for an `"unscoped"` entry, why the
   * one line has not been written. Not "it was easier".
   */
  readonly why: string;
  /**
   * When this entry was opened, `YYYY-MM-DD`.
   *
   * There is no expiry and no build that fails on an old date, because a gate
   * that breaks on a calendar boundary gets muted rather than fixed. What this
   * buys is that `npm run cost` prints the age, so an admission that has been
   * open for three months reads differently from one opened this morning — which
   * is the whole of what GPT Sol was asking for when he called `metered: false`
   * a loophole with no expiry.
   */
  readonly since: string;
}

export const DECLARATIONS: readonly Declaration[] = [
  {
    id: "bakeoff-anthropic-transport",
    kind: "bypass",
    since: "2026-08-28",
    account: "anthropic",
    file: "evals/pdf/bakeoff/bakeoff.mts",
    job: "pdf",
    wire: "messages",
    metered: true,
    why: "The bake-off's whole question is which transport wins. Routing its `transport: \"anthropic\"` arm through OpenRouter would leave it comparing OpenRouter with OpenRouter and reporting a winner.",
  },
  {
    id: "bakeoff-openrouter-transport",
    kind: "bypass",
    since: "2026-08-28",
    account: "openrouter",
    file: "evals/pdf/bakeoff/bakeoff.mts",
    job: "pdf",
    wire: "chat",
    metered: true,
    why: "The other half of the same comparison, and it cannot go through `openRouterJson` either: the seam owns the `provider` block per job, and this bake-off's arms deliberately differ from each other — the model arms forbid fallback, the Mistral OCR arm allows it. One policy imposed on both would change what two of the arms measure.",
  },
  {
    id: "embedding-eval-judge",
    kind: "bypass",
    since: "2026-08-28",
    account: "anthropic",
    file: "evals/embedding-retrieval.ts",
    job: "eval",
    wire: "messages",
    metered: true,
    why: "The judge picks its own model per run, and `streamMessage` owns the model on purpose so a stage cannot quietly switch one. Converting it to the chat wire would mean losing `thinking: {type: \"adaptive\"}`, which changes the judgements — and the judgements are cached on disk under a rubric version, so changing them costs a full re-judge in real money.",
  },
  {
    id: "dictation-bench-audio",
    kind: "bypass",
    since: "2026-08-28",
    account: "openrouter",
    file: "evals/dictation/bench-transcribers.mjs",
    job: "dictation",
    wire: "chat",
    metered: false,
    why: "Posts to `/v1/audio/transcriptions`, which the seam deliberately does not serve — `OpenRouterPath` is a closed union of the two paths the app uses, and widening the app's surface for an eval is the wrong trade. Wiring it needs a fourth `Wire` (`audio`), and that file is being rewritten by another agent as of 2026-08-28.",
  },
  {
    id: "dictation-bench-vocabulary-sources",
    kind: "unscoped",
    since: "2026-08-28",
    account: "openrouter",
    file: "evals/dictation/bench-vocabulary-sources.ts",
    job: "dictation",
    wire: "chat",
    metered: false,
    why: "Not a bypass at all — it calls `transcribeWith`, which goes through the seam and is metered. It simply never opens a collector, so every call warns \"no spend collector open\" and the row is dropped. One `withLedger(\"eval\", …)` fixes it, in a file another agent was actively writing on the day this was found.",
  },
  {
    id: "dictation-bench-vocabulary",
    kind: "bypass",
    since: "2026-08-28",
    account: "openrouter",
    file: "evals/dictation/bench-vocabulary.mjs",
    job: "dictation",
    wire: "chat",
    metered: false,
    why: "Ordinary chat/completions and could go through `openRouterJson` today — the only reason it has not is that a successor (`bench-vocabulary-sources.ts`) was being written in the same directory on 2026-08-28 and re-plumbing a file mid-rewrite loses somebody's work.",
  },
];

export function declarationFor(id: string): Declaration {
  const found = DECLARATIONS.find((d) => d.id === id);
  if (!found) {
    throw new Error(
      `${id} is not a declared bypass. Add it to DECLARATIONS in evals/declared-spend.ts, with the reason the seam is wrong for it.`,
    );
  }
  if (!found.metered) {
    throw new Error(
      `${id} is declared as not metered, so it must not be used through this wrapper. Flip metered to true in the same change that wires it up.`,
    );
  }
  return found;
}

```

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

  const call: ActiveCall = { declaration, attempts: 0 };
  let outcome: SpendRecord["outcome"] = "ok";
  /* **The attribution wraps the `finally`, not just the body.** It wrapped only
     the body until a test asked what `step_name` was on the row and got `null`:
     `recordSpend` runs in the `finally`, which is outside the overlay, so the
     declaration id never reached the row that exists to be traced back to it. */
  return withSpendAttribution({ stepName: declaration.id }, async () => {
    try {
      return await active.run(call, () => fn({ observe }));
    } catch (err) {
      outcome = "error";
      throw err;
    } finally {
      /* **Recorded first, and the retry complaint raised afterwards.** Throwing
         from a `finally` replaces whatever the body threw, so a genuine provider
         error would come back as a lecture about retries and the row would never
         be written. The money was spent either way; the row goes down first. */
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
          computedCostNanos: seen.costNanos === null ? seen.computedCostNanos : null,
          priceVersion: seen.costNanos === null ? seen.priceVersion : null,
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
          reasoningTokens: null,
          webSearches:
            seen.anthropicUsage?.server_tool_use?.web_search_requests ?? null,
          serviceTier: seen.anthropicUsage?.service_tier ?? null,
          /* **Not available, and left null rather than guessed.** A direct
             Anthropic call does not report where it ran, and US inference is
             priced above the standard rate — so a workspace defaulting to US
             makes `computed_cost_nanos` a floor rather than an estimate. Said
             here because a null meaning "we cannot know" and a null meaning
             "nothing to report" are different, and only one of them is a reason
             to distrust the number. */
          inferenceGeo: null,
          ms: Date.now() - startedAt,
          outcome,
        },
        callId,
      );
      if (call.attempts > 1) {
        /* Not a warning. One logical call that made three HTTP requests spent
           about three times what the row above says, and a cost table that is
           wrong by a factor is worse than no cost table at all. Raised only when
           the body itself did not throw, so it can never mask a real failure. */
        if (outcome === "ok") {
          throw new Error(
            `${id} made ${call.attempts} HTTP attempts for one declared call — the row understates what it spent. Set maxRetries: 0 (see anthropicForDeclared).`,
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

/** The packages whose default (or namespace) export can make a client. */
const SDKS = ["@anthropic-ai/sdk", "openai"];

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
  const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return out
    .split("\0")
    .filter((f) => /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(f))
    .filter((f) => !f.startsWith("node_modules/"))
    /* **`scratch-*` at the root is exempt while it stays untracked.** The
       convention already exists here — `.gitignore` covers `scratch-bakeoff` —
       and these are one-afternoon spikes that nobody intends to keep. Making
       every agent's suite red for a colleague's throwaway file is how a gate
       gets muted. `git ls-files --cached` still lists one the moment it is
       added, which is before it can be committed. */
    .filter((f) => !/^scratch-[^/]*$/.test(f));
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
    if (n.type !== "ImportDeclaration") return;
    const spec = (n.source as { value?: string } | undefined)?.value;
    if (!spec || !SDKS.includes(spec)) return;
    if (n.importKind === "type") return;
    for (const sp of (n.specifiers ?? []) as Record<string, unknown>[]) {
      /* A named import of an error class cannot construct a client, and
         `src/anthropic-call.ts` does exactly that. Only the default and the
         namespace get a client out. */
      if (sp.type === "ImportDefaultSpecifier" || sp.type === "ImportNamespaceSpecifier") {
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
      const callee = n.callee as { type?: string; name?: string } | undefined;
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
    }
  });

  return { findings: found, declarationIds, parseErrors: ast.errors?.length ?? 0 };
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
      /* Tests may name an endpoint or a credential: a test that could not write
         `openrouter.ai` could not check that the seam sends there. They may not
         *construct a client*, which is the one capability with nothing to do
         with asserting on a string. */
      const caps = file.startsWith("tests/")
        ? scan.findings.filter(isTransport).filter((f) => !f.what.startsWith("names "))
        : scan.findings;
      if (caps.length === 0) continue;
      if (ALLOWED[file]) continue;

      /* **A declaration is not a licence for a file.** A metered one exempts its
         file only while that file actually uses its id — otherwise the entry is
         standing permission for something that no longer happens, which is how
         `bench-vocabulary-sources.ts` kept an exemption after being rewritten to
         use the seam. GPT Sol. */
      if (isExempt(file, scan)) continue;

      offenders.push(`${file} — ${[...new Set(caps.map((c) => c.what))].join(", ")}`);
    }

    expect(
      offenders,
      "These files can reach a paid provider and are neither a seam nor declared.\n" +
        "Route the call through src/ai-call.ts or src/messages-stream.ts, or — if the\n" +
        "transport is the thing being measured — add it to DECLARATIONS in\n" +
        "src/spend-declarations.ts with the reason the seam is wrong for it.\n",
    ).toEqual([]);
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
          },
        });
      }),
    );
    /* A 1-hour write costs 1.6x a 5-minute one, so one total will not do. */
    expect(rows[0]?.cacheWrite5mTokens).toBe(60);
    expect(rows[0]?.cacheWrite1hTokens).toBe(30);
    expect(rows[0]?.serviceTier).toBe("standard");
    expect(rows[0]?.webSearches).toBe(2);
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

---

# The scoped diff against HEAD

```diff
diff --git a/evals/embedding-retrieval.ts b/evals/embedding-retrieval.ts
index 6722201..986e05d 100644
--- a/evals/embedding-retrieval.ts
+++ b/evals/embedding-retrieval.ts
@@ -66,12 +66,22 @@
 import { createHash } from "node:crypto";
 import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
 import path from "node:path";
-import Anthropic from "@anthropic-ai/sdk";
+/* **`import type`, so this file cannot construct a client at all.** It is used
+   only for `Anthropic` and `Anthropic.TextBlock` in signatures now; the one
+   client here comes from `anthropicForDeclared()`. A value import would leave
+   `new Anthropic()` one keystroke away and the scan unable to tell the
+   difference. */
+import type Anthropic from "@anthropic-ai/sdk";
 import PQueue from "p-queue";
 import { loadEnvLocal } from "../src/env.js";
 import { CAPABLE_MODEL } from "../src/models.js";
 import { cosine, type EmbeddingUsage, type EmbedResult, embedAll } from "../src/embeddings.js";
 import type { Block } from "../src/types.js";
+import {
+  anthropicForDeclared,
+  withDeclaredExternalCall,
+} from "./declared-spend.js";
+import { withLedger } from "../src/cli-ledger.js";
 
 const ROOT = path.resolve(import.meta.dirname, "..");
 const RESULTS = path.join(ROOT, "evals", "results");
@@ -456,18 +466,32 @@ async function judgeQuery(
     .map((p, i) => `<passage id="${letters[i]}">\n${p.text}\n</passage>`)
     .join("\n\n");
 
-  const response = await client.messages.create({
-    model: judgeModel,
-    max_tokens: 4000,
-    thinking: { type: "adaptive" },
-    system: JUDGE_SYSTEM,
-    messages: [
-      {
-        role: "user",
-        content: `Reader's question: ${query.text}\n\n${body}`,
-      },
-    ],
-  });
+  /* **A declared bypass, not an oversight.** The judge speaks the Messages
+     shape and chooses its own model per run, and `streamMessage` owns the model
+     on purpose — see `embedding-eval-judge` in evals/declared-spend.ts for why
+     it is not simply moved onto the seam. The wrapper is what makes the money
+     appear in `npm run cost` anyway, priced from ANTHROPIC_PRICES because this
+     call does not go through OpenRouter and so has nobody to ask. */
+  const response = await withDeclaredExternalCall(
+    "embedding-eval-judge",
+    { model: judgeModel },
+    async ({ observe }) => {
+      const message = await client.messages.create({
+        model: judgeModel,
+        max_tokens: 4000,
+        thinking: { type: "adaptive" },
+        system: JUDGE_SYSTEM,
+        messages: [
+          {
+            role: "user",
+            content: `Reader's question: ${query.text}\n\n${body}`,
+          },
+        ],
+      });
+      observe.anthropic(message);
+      return message;
+    },
+  );
 
   const text = response.content
     .filter((b): b is Anthropic.TextBlock => b.type === "text")
@@ -930,7 +954,10 @@ async function judgeAll(
   );
   if (needed.length > 0) {
     console.log(`\nJudging ${needed.length} queries (cached: ${QUERIES.length - needed.length})…`);
-    const client = new Anthropic();
+    /* `maxRetries: 0` and a guarded `fetch` — a default client turns one call
+       into up to three billable attempts and the row would then understate the
+       spend by a factor. See evals/declared-spend.ts. */
+    const client = anthropicForDeclared();
     const queue = new PQueue({ concurrency: 4 });
     await Promise.all(
       needed.map((q) =>
@@ -1245,4 +1272,7 @@ async function main(): Promise<void> {
   console.log(`\nWrote ${path.relative(ROOT, out)}`);
 }
 
-await main();
+/* See the note in evals/review-stances.ts. The embedding calls here are metered
+   by src/ai-call.ts and only ever needed a collector; the judge is a declared
+   bypass and records itself. */
+await withLedger("eval", main);
diff --git a/evals/extraction/rescue.mts b/evals/extraction/rescue.mts
index f11af6b..1d5e6a4 100644
--- a/evals/extraction/rescue.mts
+++ b/evals/extraction/rescue.mts
@@ -29,6 +29,8 @@ import { loadEnvLocal } from "../../src/env.js";
 import { inventory } from "./inventory.mjs";
 import { QUICK_MODEL_OPENROUTER } from "../../src/models.js";
 import { writeFile } from "node:fs/promises";
+import { openRouterJson } from "../../src/ai-call.js";
+import { withLedger } from "../../src/cli-ledger.js";
 
 /* `loadEnvLocal()`, not a bare `import "../../src/env.js"`. The import has no
    side effect — the module exports a function and calls nothing — so the bare
@@ -92,38 +94,47 @@ interface Answer {
 }
 
 async function ask(prompt: string): Promise<{ answer: Answer; usage: { input: number; output: number }; ms: number }> {
-  const key = process.env.OPENROUTER_API_KEY;
-  if (!key) throw new Error("OPENROUTER_API_KEY is not set — see docs/project/setup-dev.md.");
   const started = performance.now();
-  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
-    method: "POST",
-    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
-    body: JSON.stringify({
-      model: MODEL,
-      max_tokens: 8000,
-      messages: [
-        { role: "system", content: SYSTEM },
-        { role: "user", content: prompt },
-      ],
-      response_format: {
-        type: "json_schema",
-        json_schema: { name: "triage", strict: true, schema: SCHEMA },
-      },
-      /* Both, for the reason src/pdf-read.ts gives: OpenRouter may silently drop
-         a parameter a provider does not take, and structured output is exactly
-         the one whose absence looks like a model that suddenly writes prose. */
-      provider: { require_parameters: true, allow_fallbacks: false },
-      usage: { include: true },
-    }),
+  /* **Through the seam, since 2026-08-28.** This used to be a hand-rolled
+     `fetch` with its own key lookup and its own `provider` block, which is how
+     an eval spends real money that appears in no total — see
+     docs/plans/ai-spend-outside-the-gateway.md. Nothing about the request
+     changed: `AI_JOB_ROUTE.eval` sets the same `require_parameters` and
+     `allow_fallbacks: false` this passed by hand, and the seam adds
+     `usage: { include: true }` itself.
+
+     `job: "eval"` rather than borrowing `pdf`. This is a triage pass over a
+     mangled HTML extraction and stands in for nothing the app does; filing it
+     under a real job to save inventing one would put eval money into the number
+     that answers "what does the PDF reader cost". */
+  const { json } = await openRouterJson("eval", {
+    model: MODEL,
+    max_tokens: 8000,
+    messages: [
+      { role: "system", content: SYSTEM },
+      { role: "user", content: prompt },
+    ],
+    response_format: {
+      type: "json_schema",
+      json_schema: { name: "triage", strict: true, schema: SCHEMA },
+    },
   });
-  const body = await res.text();
-  if (!res.ok) throw new Error(`OpenRouter answered ${res.status}: ${body.slice(0, 300)}`);
-  const json = JSON.parse(body);
-  if (json.error) throw new Error(`OpenRouter refused: ${json.error.message}`);
-  const content = json.choices?.[0]?.message?.content ?? "";
+  const body = json as {
+    error?: { message?: string };
+    choices?: { message?: { content?: string } }[];
+    usage?: { prompt_tokens?: number; completion_tokens?: number };
+  } | null;
+  /* A 200 carrying an `error` — the seam throws on a non-2xx, but OpenRouter
+     also answers 200 with a refusal in the body, and treating that as an empty
+     transcript is how a rescue run scores a model at zero for being unavailable. */
+  if (body?.error) throw new Error(`OpenRouter refused: ${body.error.message}`);
+  const content = body?.choices?.[0]?.message?.content ?? "";
   return {
     answer: JSON.parse(content) as Answer,
-    usage: { input: json.usage?.prompt_tokens ?? 0, output: json.usage?.completion_tokens ?? 0 },
+    usage: {
+      input: body?.usage?.prompt_tokens ?? 0,
+      output: body?.usage?.completion_tokens ?? 0,
+    },
     ms: Math.round(performance.now() - started),
   };
 }
@@ -254,4 +265,10 @@ async function main(): Promise<void> {
   console.log(`\nWritten to ${out}`);
 }
 
-void main();
+/* The ledger scope. Without it every call above warns "no spend collector open"
+   and leaves no row — see docs/plans/ai-spend-outside-the-gateway.md.
+
+   **`await`, not `void`.** `collectSpend` awaits its sink writes before it
+   returns, and discarding that promise throws the guarantee away: the process
+   can reach the end of the module and exit with rows still in flight. GPT Sol. */
+await withLedger("eval", main);
diff --git a/evals/pdf/bakeoff/bakeoff.mts b/evals/pdf/bakeoff/bakeoff.mts
index 88b84bb..bef83ed 100644
--- a/evals/pdf/bakeoff/bakeoff.mts
+++ b/evals/pdf/bakeoff/bakeoff.mts
@@ -20,7 +20,13 @@
  * transports (the Anthropic SDK, and OpenRouter) are one function each.
  */
 import "../../../src/env.js";
-import Anthropic from "@anthropic-ai/sdk";
+import type Anthropic from "@anthropic-ai/sdk";
+import {
+  anthropicForDeclared,
+  declaredFetch,
+  withDeclaredExternalCall,
+} from "../../declared-spend.js";
+import { withLedger } from "../../../src/cli-ledger.js";
 import { mkdir, writeFile } from "node:fs/promises";
 import { createHash } from "node:crypto";
 import { PDFDocument } from "pdf-lib";
@@ -217,7 +223,15 @@ const READERS: Reader[] = [
   { label: "mistral-ocr", transport: "mistral-ocr", model: "anthropic/claude-haiku-4.5", scanOnly: true },
 ];
 
-const anthropic = new Anthropic();
+/* **Declared, not incidental.** This file is the one place in the repo that
+   talks to `api.anthropic.com` on purpose: `transport: "anthropic"` versus
+   `transport: "openrouter"` is the comparison, and forcing both onto one
+   transport would leave it reporting a winner between OpenRouter and itself.
+   `anthropicForDeclared()` keeps the money visible anyway — `maxRetries: 0`, a
+   guarded `fetch`, and a row per attempt priced from ANTHROPIC_PRICES, because
+   a call that skips OpenRouter has nobody to ask what it cost.
+   See evals/declared-spend.ts. */
+const anthropic = anthropicForDeclared();
 
 async function viaAnthropic(reader: Reader, doc: Doc, i: number, baseline: PageText[]): Promise<Result> {
   const chunk = doc.chunks[i]!;
@@ -242,14 +256,22 @@ async function viaAnthropic(reader: Reader, doc: Doc, i: number, baseline: PageT
   }
   const t0 = performance.now();
   try {
-    const stream = anthropic.messages.stream({
-      model: reader.model,
-      max_tokens: MAX_TOKENS,
-      system: reader.noCover ? SYSTEM_NO_COVER : SYSTEM,
-      messages: [{ role: "user", content }],
-      output_config: { format: { type: "json_schema", schema: SCHEMA as never } },
-    });
-    const msg = await stream.finalMessage();
+    const msg = await withDeclaredExternalCall(
+      "bakeoff-anthropic-transport",
+      { model: reader.model },
+      async ({ observe }) => {
+        const stream = anthropic.messages.stream({
+          model: reader.model,
+          max_tokens: MAX_TOKENS,
+          system: reader.noCover ? SYSTEM_NO_COVER : SYSTEM,
+          messages: [{ role: "user", content }],
+          output_config: { format: { type: "json_schema", schema: SCHEMA as never } },
+        });
+        const message = await stream.finalMessage();
+        observe.anthropic(message);
+        return message;
+      },
+    );
     const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
     return {
       reader: reader.label,
@@ -268,21 +290,43 @@ async function viaAnthropic(reader: Reader, doc: Doc, i: number, baseline: PageT
   }
 }
 
-async function openrouter(body: unknown): Promise<any> {
-  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
-    method: "POST",
-    headers: {
-      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
-      "Content-Type": "application/json",
+/**
+ * The OpenRouter arm — still a hand-rolled request, and declared as such.
+ *
+ * It does not go through `openRouterJson` because the seam owns the `provider`
+ * block per job, and this bake-off's arms deliberately disagree with each other:
+ * the model arms forbid fallback, the Mistral OCR arm allows it. One policy
+ * imposed on both would silently change what two of them measure.
+ *
+ * `declaredFetch` is the guard: outside `withDeclaredExternalCall` it throws
+ * rather than spending money with nothing to show for it.
+ */
+async function openrouter(model: string, body: Record<string, unknown>): Promise<any> {
+  return withDeclaredExternalCall(
+    "bakeoff-openrouter-transport",
+    { model },
+    async ({ observe }) => {
+      const res = await declaredFetch("https://openrouter.ai/api/v1/chat/completions", {
+        method: "POST",
+        headers: {
+          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
+          "Content-Type": "application/json",
+        },
+        body: JSON.stringify(body),
+      });
+      const text = await res.text();
+      let json: any;
+      try {
+        json = JSON.parse(text);
+      } catch {
+        return { error: { message: `${res.status}: ${text.slice(0, 400)}` } };
+      }
+      /* Before the caller gets a chance to return early on `json.error`: a
+         refusal that still reports usage still cost money. */
+      observe.openRouter(json);
+      return json;
     },
-    body: JSON.stringify(body),
-  });
-  const text = await res.text();
-  try {
-    return JSON.parse(text);
-  } catch {
-    return { error: { message: `${res.status}: ${text.slice(0, 400)}` } };
-  }
+  );
 }
 
 async function viaOpenRouter(reader: Reader, doc: Doc, i: number): Promise<Result> {
@@ -290,7 +334,7 @@ async function viaOpenRouter(reader: Reader, doc: Doc, i: number): Promise<Resul
   const all = chunk.context ? [chunk.context, ...chunk.pages] : chunk.pages;
   const { data, sha256 } = await cut(doc.file, all);
   const t0 = performance.now();
-  const json = await openrouter({
+  const json = await openrouter(reader.model, {
     model: reader.model,
     max_tokens: MAX_TOKENS,
     messages: [
@@ -333,7 +377,7 @@ async function viaMistralOcr(reader: Reader, doc: Doc, i: number): Promise<Resul
   const all = chunk.context ? [chunk.context, ...chunk.pages] : chunk.pages;
   const { data, sha256 } = await cut(doc.file, all);
   const t0 = performance.now();
-  const json = await openrouter({
+  const json = await openrouter(reader.model, {
     model: reader.model,
     max_tokens: 64,
     messages: [
@@ -393,9 +437,16 @@ function safeRecords(text: string): unknown[] | undefined {
 const only = process.argv[2];
 const onlyChunk = process.argv[3] === undefined ? undefined : Number(process.argv[3]);
 const onlyReaders = process.env.READERS?.split(",").map((s) => s.trim());
-await mkdir(OUT, { recursive: true });
 const results: Result[] = [];
 
+/* **The whole run inside one ledger scope.** Both transports above are declared
+   bypasses, and a declared bypass still needs a collector open or its row has
+   nowhere to go — `recordSpend` warns and drops it. This file's header says it
+   "spends real money every time it runs"; now it says how much, and
+   `npm run cost` can see it. */
+async function run(): Promise<void> {
+await mkdir(OUT, { recursive: true });
+
 for (const doc of DOCS.filter((d) => !only || d.name === only)) {
   const { pages: baseline, isScan } = await pass0(doc.file);
   await writeFile(
@@ -433,3 +484,6 @@ for (const doc of DOCS.filter((d) => !only || d.name === only)) {
 
 await writeFile(`${OUT}/results${process.env.RUN ? "." + process.env.RUN : ""}.json`, JSON.stringify(results, null, 2));
 console.log(`\n${results.length} results → ${OUT}/`);
+}
+
+await withLedger("eval", run);
diff --git a/evals/prompt-caching.ts b/evals/prompt-caching.ts
index 31c97d2..8d7c1a6 100644
--- a/evals/prompt-caching.ts
+++ b/evals/prompt-caching.ts
@@ -31,6 +31,7 @@ import { loadEnvLocal } from "../src/env.js";
 import { articleWithIds, estimateTokens } from "../src/article-prompt.js";
 import { findPassages } from "../src/search.js";
 import { converse } from "../src/converse.js";
+import { withLedger } from "../src/cli-ledger.js";
 import type { Block, ChatMessage, Meta } from "../src/types.js";
 
 /**
@@ -339,7 +340,8 @@ const invokedDirectly =
   path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
 
 if (invokedDirectly) {
-  main().catch((err) => {
+  /* See the note at the foot of evals/review-stances.ts. */
+  withLedger("eval", main).catch((err) => {
     console.error(err);
     process.exit(1);
   });
diff --git a/evals/review-stances.ts b/evals/review-stances.ts
index ddedfd4..025f23d 100644
--- a/evals/review-stances.ts
+++ b/evals/review-stances.ts
@@ -47,6 +47,7 @@ import { readFile, writeFile, mkdir } from "node:fs/promises";
 import path from "node:path";
 import { loadEnvLocal } from "../src/env.js";
 import { converse } from "../src/converse.js";
+import { withLedger } from "../src/cli-ledger.js";
 import type { Block, ChatMessage, Meta, ReviewStance } from "../src/types.js";
 import { REVIEW_STANCES } from "../src/types.js";
 
@@ -337,4 +338,9 @@ async function main(): Promise<void> {
   console.log(`\nWritten to ${path.relative(process.cwd(), out)}`);
 }
 
-await main();
+/* **`withLedger`, not a bare `main()`.** These calls already go through the
+   gateway and are already metered — what they lacked was a collector, so every
+   one of them warned "no spend collector open" and left no row. `"eval"` is the
+   scope kind, so `npm run cost` can keep this out of the number Greg sets a
+   price against while still counting it. */
+await withLedger("eval", main);
diff --git a/scripts/ai-cost.ts b/scripts/ai-cost.ts
index 3f38e28..4be9ae5 100644
--- a/scripts/ai-cost.ts
+++ b/scripts/ai-cost.ts
@@ -35,6 +35,7 @@ import { formatNanos } from "../src/ai-spend.js";
 import type { AiCallRow } from "../src/ai-spend.js";
 import { loadEnvLocal } from "../src/env.js";
 import { costStore, totalRows } from "../src/store/ai-calls.js";
+import { DECLARATIONS } from "../src/spend-declarations.js";
 
 interface Args {
   since?: string;
@@ -106,7 +107,9 @@ export function parseArgs(argv: string[]): Args {
 }
 
 /** Sum by one facet, biggest first. One implementation for every breakdown. */
-function by(
+/* Exported for tests/ai-cost-cli.test.ts: the two bugs this file has had were
+   both in what a number *includes*, and neither showed up in a type. */
+export function by(
   rows: readonly AiCallRow[],
   key: (r: AiCallRow) => string | null,
 ): { name: string; calls: number; nanos: number }[] {
@@ -119,8 +122,15 @@ function by(
   }
   return [...groups.entries()]
     .map(([name, list]) => {
-      const { credits, upstream } = totalRows(list);
-      return { name, calls: list.length, nanos: credits + upstream };
+      /* **All three pockets, not just `credits`.** The first version summed
+         credits alone, so every breakdown printed `$0.0000` for the declared
+         bypasses — money really spent, itemised by day and by model, showing as
+         nothing. Found by running the report after a live probe rather than by
+         an assertion, which is the same way `formatNanos` was caught rounding a
+         real cost to zero. The pocket lines above keep them apart; a *breakdown*
+         wants the whole of what a job or a day cost. */
+      const { credits, upstream, computed } = totalRows(list);
+      return { name, calls: list.length, nanos: credits + upstream + computed };
     })
     .sort((a, b) => b.nanos - a.nanos);
 }
@@ -222,6 +232,65 @@ async function reconcile(): Promise<void> {
   );
 }
 
+/**
+ * One pocket's worth of money, with the three kinds of figure kept apart.
+ *
+ * `credits` is what OpenRouter deducted and can be checked against their own
+ * running total. `upstream` is BYOK, where their charge is legitimately zero and
+ * somebody else's key was billed. `computed` is **our arithmetic**, for the
+ * declared bypasses that do not go through OpenRouter and so have nobody to ask
+ * — it is labelled every time, because a price table drifts silently and the
+ * day a rate changes every computed figure after it is wrong with nothing
+ * failing.
+ */
+function pocket(label: string, rows: readonly AiCallRow[]): void {
+  const { credits, upstream, computed, unpriced } = totalRows(rows);
+  console.log(
+    `\n${label}:  ${formatNanos(credits + upstream + computed)} over ${rows.length} call(s)`,
+  );
+  console.log(`  credits consumed   ${formatNanos(credits)}`);
+  if (upstream > 0)
+    console.log(`  billed upstream    ${formatNanos(upstream)}  (BYOK — a different pocket)`);
+  if (computed > 0)
+    console.log(
+      `  computed by us     ${formatNanos(computed)}  (not through OpenRouter; priced from ANTHROPIC_PRICES, never reconciled)`,
+    );
+  if (unpriced > 0)
+    console.log(`  ${unpriced} call(s) reported no cost, so the figure above is short by an unknown amount.`);
+}
+
+/**
+ * **What is knowably still missing** — by name, every run.
+ *
+ * This replaced the sentence *"Not counted here: anything evals/ spends"*,
+ * which was true, useless and unfinishable: it named nothing, so no amount of
+ * work could ever delete it. Every entry below is one file with a reason, and
+ * the list empties as they are wired up. `tests/no-undeclared-spend.test.ts`
+ * fails if a way of reaching a provider exists that is not in that table, so
+ * this cannot go quietly out of date.
+ */
+function undeclared(): void {
+  const open = DECLARATIONS.filter((d) => !d.metered);
+  if (open.length === 0) {
+    console.log("\nEvery known way of spending money in this repo writes a row.");
+    return;
+  }
+  console.log(`\nNot counted here — ${open.length} known way(s) of spending that write no row:`);
+  const today = Date.now();
+  for (const d of open) {
+    /* The age, not just the entry. An admission opened this morning and one
+       that has been open since the spring read the same in a list and are not
+       the same thing at all — which is what GPT Sol meant by calling
+       `metered: false` a loophole with no expiry. No build fails on a date,
+       because a gate that trips on the calendar gets muted rather than fixed. */
+    const days = Math.floor((today - Date.parse(`${d.since}T00:00:00Z`)) / 86_400_000);
+    const age = days <= 0 ? "today" : days === 1 ? "1 day" : `${days} days`;
+    const how = d.kind === "unscoped" ? "no ledger open" : "skips the gateway";
+    console.log(`  ${d.file}\n      ${d.id} — ${how}, open ${age}`);
+  }
+  console.log("  src/spend-declarations.ts says why each one is still open.");
+}
+
 async function main(): Promise<void> {
   loadEnvLocal();
   const args = parseArgs(process.argv.slice(2));
@@ -246,16 +315,39 @@ async function main(): Promise<void> {
     /* **Not the same as "nothing was spent", and it must not read as it.** An
        empty ledger is what a misconfigured store looks like too. */
     console.log("(An empty range and an unwired ledger look identical from here.)");
+    /* **Before the early return, for the same reason the unreadable count is.**
+       A report with no rows is exactly when somebody is asking "is anything
+       being recorded at all", and the list of things that are knowably *not*
+       is the most useful thing on the page. It was after the return until GPT
+       Sol reproduced the output. */
+    undeclared();
     if (args.reconcile) await reconcile();
     return;
   }
 
-  const { credits, upstream, unpriced } = totalRows(rows);
-  console.log(`\nTotal:  ${formatNanos(credits + upstream)} over ${rows.length} call(s)`);
-  console.log(`  credits consumed   ${formatNanos(credits)}`);
-  if (upstream > 0) console.log(`  billed upstream    ${formatNanos(upstream)}  (BYOK — a different pocket)`);
-  if (unpriced > 0)
-    console.log(`  ${unpriced} call(s) reported no cost, so the total above is short by an unknown amount.`);
+  /* **Product and eval are printed apart, and there is no line called
+     "Total".** Greg's use for this number is to set a price, and a bake-off
+     over forty PDF pages landing in the figure he prices against is how a price
+     gets set wrong. Storing eval rows and separating them at the report is the
+     right way round: a scope can always be excluded from a total, and a row
+     that was never written cannot be recovered. GPT Sol, 2026-08-28, on the
+     open question Greg has not answered (ai-cost-tracking.md, question 4). */
+  const product = rows.filter((r) => r.scopeKind !== "eval");
+  const evals = rows.filter((r) => r.scopeKind === "eval");
+  /* An empty pocket is not printed as `$0.0000 over 0 call(s)`: a zero with a
+     label reads as a measurement, and "we recorded nothing here" is the one
+     thing it is not. */
+  if (product.length > 0) pocket("Product spend", product);
+  else console.log("\nProduct spend:  no calls recorded in this range.");
+  if (evals.length > 0) pocket("Eval spend", evals);
+  if (evals.length > 0 && product.length > 0) {
+    const a = totalRows(product);
+    const b = totalRows(evals);
+    console.log(
+      `\nAll recorded:  ${formatNanos(a.credits + a.upstream + a.computed + b.credits + b.upstream + b.computed)} over ${rows.length} call(s)`,
+    );
+  }
+
 
   const failed = rows.filter((r) => r.outcome !== "ok");
   if (failed.length > 0) {
@@ -265,7 +357,7 @@ async function main(): Promise<void> {
        at the last step. GPT Sol. */
     const w = totalRows(failed);
     console.log(
-      `  ${failed.length} call(s) ended in error or a cancel, having spent at least ${formatNanos(w.credits + w.upstream)}.`,
+      `  ${failed.length} call(s) ended in error or a cancel, having spent at least ${formatNanos(w.credits + w.upstream + w.computed)}.`,
     );
   }
 
@@ -284,11 +376,7 @@ async function main(): Promise<void> {
         "\n  A read that falls to zero is the cache silently switching off — docs/project/prompt-caching.md.",
     );
 
-  /* Said every time rather than only when it looks wrong. `evals/` calls models
-     outside the two gateways, so nothing it spends reaches this — and a report
-     that is silently partial is the failure this whole ledger is arranged
-     against. docs/plans/ai-cost-tracking.md, question 4. */
-  console.log("\nNot counted here: anything evals/ spends — it does not go through the gateways.");
+  undeclared();
 
   if (args.reconcile) await reconcile();
   else console.log("\n(--reconcile asks OpenRouter what it thinks this key has spent.)");
diff --git a/src/ai-call.ts b/src/ai-call.ts
index 3f3e3d8..ca717ec 100644
--- a/src/ai-call.ts
+++ b/src/ai-call.ts
@@ -155,9 +155,21 @@ export const AI_JOB_ROUTE: Record<
     provider: { require_parameters: true, allow_fallbacks: false },
   },
   embeddings: { path: "/v1/embeddings", provider: {} },
-  /* **Pins nothing, on purpose.** An eval that pinned an upstream would be
-     measuring the pin as much as the model, and none of them wants that. */
-  eval: { path: "/v1/chat/completions", provider: {} },
+  /* **Forbids fallback — and my first reason for it was wrong.** I wrote that a
+     silent fallback would substitute a different *model*; GPT Sol corrected it:
+     provider fallback picks a different **upstream** for the model you asked
+     for, and without `order` or `only` the first one is load-balanced anyway.
+     The real reason is narrower and still good: an eval reports a latency and a
+     quality number, both of which vary by upstream, so a silent backup attempt
+     makes a number belong to a provider the write-up never names.
+     `require_parameters` is the load-bearing half — it means "only upstreams
+     that support the parameters actually sent", and a provider that quietly
+     drops a JSON schema answers with prose, which every eval here scores as the
+     model having a bad day. */
+  eval: {
+    path: "/v1/chat/completions",
+    provider: { require_parameters: true, allow_fallbacks: false },
+  },
 };
 
 /**
diff --git a/src/ai-spend.ts b/src/ai-spend.ts
index 34396a4..d6b3874 100644
--- a/src/ai-spend.ts
+++ b/src/ai-spend.ts
@@ -821,6 +821,20 @@ export function collectingSpend(): boolean {
   return store.getStore() !== undefined;
 }
 
+/**
+ * **True only while a collector is open that will actually write rows.**
+ *
+ * `collectingSpend()` is not enough for a caller that wants a guarantee: a
+ * collector with no `sink` reports its calls to whoever opened it and writes
+ * nothing durable, which is exactly the shape most tests use. GPT Sol drove the
+ * path — a completed declared call with `unscopedCalls() === 1` — and it is the
+ * one failure mode a declared bypass must not have, because the whole reason a
+ * bypass is allowed at all is that it still writes a row.
+ */
+export function persistingSpend(): boolean {
+  return store.getStore()?.box.sink != null;
+}
+
 /**
  * What the open collector has recorded **so far**, or `null` outside one.
  *
@@ -935,6 +949,19 @@ export function totalSpend(calls: readonly SpendRecord[]): {
       else nanos += c.upstreamCostNanos + (c.costNanos ?? 0);
       continue;
     }
+    /* **Our own arithmetic, for a declared bypass.** Second only to the BYOK
+       branch because a computed call has no `costNanos` at all and would
+       otherwise fall through to `unpriced` — which is precisely what it is not.
+
+       This was missed once already. The persistent report was corrected and
+       *this* function was not, so the line `npm run toc` and every eval prints
+       at the end of its own run said `$0.0000` about money it had just spent.
+       GPT Sol found it: the command that made the spend was the one output that
+       could not see it. */
+    if (c.computedCostNanos !== null) {
+      nanos += c.computedCostNanos;
+      continue;
+    }
     /* Not BYOK: `cost` and `cost_details.upstream_inference_cost` are the same
        money — a live probe on 2026-08-27 had them equal to seven decimal places
        — so adding both would double it. */
diff --git a/src/pricing.ts b/src/pricing.ts
index 82fd5fe..1035c77 100644
--- a/src/pricing.ts
+++ b/src/pricing.ts
@@ -152,6 +152,26 @@ export const ANTHROPIC_PRICES: Readonly<Record<string, readonly PriceRow[]>> = {
   "claude-haiku-4-5": [{ from: "1970-01-01", price: anthropicPrice(1.0, 5.0) }],
 };
 
+/**
+ * **Dated spellings of a model already in the table.**
+ *
+ * Anthropic's SDK takes `claude-haiku-4-5-20251001`; OpenRouter takes
+ * `anthropic/claude-haiku-4.5`; the table above is keyed on the undated name.
+ * The bake-off uses the dated one because that is what the SDK answers to, and
+ * a live probe on 2026-08-28 came back `cost_source: "none"` for a call whose
+ * token counts were sitting on the same row — the price lookup had simply
+ * missed, and nothing failed.
+ *
+ * **An explicit map, not a regular expression that strips a trailing date.**
+ * GPT Sol asked for exactly this, and the reason is worth keeping: a stripper
+ * would silently price any snapshot — including one released *after* a price
+ * change — as if it were the current model. Every line here is a claim that two
+ * names are the same thing, and adding one is a decision somebody made.
+ */
+export const MODEL_ALIASES: Readonly<Record<string, string>> = {
+  "claude-haiku-4-5-20251001": "claude-haiku-4-5",
+};
+
 /**
  * A price, and the instant it started applying. **Dates are UTC**, and the row
  * applies from that instant until the next row's.
@@ -198,7 +218,11 @@ export function priceAt(model: string, startedAt: Date): ModelPrice | null {
 }
 
 function rowAt(model: string, startedAt: Date): PriceRow | null {
-  const rows = ANTHROPIC_PRICES[model];
+  /* The alias first, so both spellings of one model land on one row. Applied
+     here rather than at each caller, because `priceAt`, `priceAnthropicCall`
+     and `effectiveFrom` all go through this and any one of them left out would
+     be a price that is right in the report and absent on the row. */
+  const rows = ANTHROPIC_PRICES[MODEL_ALIASES[model] ?? model];
   if (!rows) return null;
   let found: PriceRow | null = null;
   for (const row of rows) {
diff --git a/src/store/ai-calls-fs.ts b/src/store/ai-calls-fs.ts
index aac780b..9720941 100644
--- a/src/store/ai-calls-fs.ts
+++ b/src/store/ai-calls-fs.ts
@@ -98,11 +98,44 @@ function looksLikeRow(v: unknown): v is AiCallRow {
     typeof r.ownerId === "string" &&
     typeof r.startedAt === "string" &&
     typeof r.job === "string" &&
+    /* Added with the 0023 columns. A line written before them is not a row this
+       code can read: it has no `cost_source`, so `totalRows` cannot tell a
+       computed figure from an absent one, and counting it either way is a
+       guess. Rejected and counted as unreadable, which is what that counter is
+       for — the alternative is a total that is quietly wrong. */
+    (r.providerAccount === "openrouter" || r.providerAccount === "anthropic") &&
+    (r.costSource === "provider" ||
+      r.costSource === "computed" ||
+      r.costSource === "none") &&
     money(r.creditsUsedNanos) &&
-    money(r.upstreamInferenceNanos)
+    money(r.computedCostNanos) &&
+    money(r.upstreamInferenceNanos) &&
+    /* **The exclusivity the database enforces with a CHECK, enforced here by
+       reading it.** This store has no database, and `totalRows` adds
+       `computed` in one branch and `credits` in another — a line carrying both
+       would be counted twice, and one carrying neither while claiming a source
+       would be counted as money that arrived. There is nothing else standing
+       between a hand-edited JSONL line and a wrong total. */
+    agrees(r)
   );
 }
 
+/**
+ * A row's `cost_source` against the two numbers it is a claim about, and
+ * `price_version` against whether we did the arithmetic.
+ *
+ * The same three cases as `ai_calls_one_cost_source` in migration 0023, so the
+ * two stores cannot disagree about what a valid row is.
+ */
+function agrees(r: Record<string, unknown>): boolean {
+  const credits = r.creditsUsedNanos !== null && r.creditsUsedNanos !== undefined;
+  const computed = r.computedCostNanos !== null && r.computedCostNanos !== undefined;
+  const version = typeof r.priceVersion === "string";
+  if (r.costSource === "provider") return credits && !computed && !version;
+  if (r.costSource === "computed") return !credits && computed && version;
+  return !credits && !computed && !version;
+}
+
 export const fsCostStore: CostStore = {
   describe: () => ledger(),
 
diff --git a/src/store/ai-calls.ts b/src/store/ai-calls.ts
index 17ea359..680039c 100644
--- a/src/store/ai-calls.ts
+++ b/src/store/ai-calls.ts
@@ -33,7 +33,7 @@ export const costStore: CostStore =
   STORE === "postgres" ? guardDbStore("ai-calls", pgCostStore) : fsCostStore;
 
 /**
- * **What a set of ledger rows cost**, and the three ways the answer can be
+ * **What a set of ledger rows cost**, and the four ways the answer can be
  * short. One implementation, so the two stores cannot disagree.
  *
  * `credits` and `upstream` are two different pockets and are kept apart: under
@@ -42,16 +42,34 @@ export const costStore: CostStore =
  * what it is a number *of*. `unpriced` is the count of calls that reported no
  * money at all — the total is short by an unknown amount, which is a different
  * statement from "it cost nothing".
+ *
+ * **`computed` is a third pocket**, and it is not the same kind of fact as the
+ * other two. `credits` is what OpenRouter deducted and can be checked against
+ * their own running total; `computed` is our arithmetic over
+ * [`ANTHROPIC_PRICES`](../pricing.ts) for a call that went straight to Anthropic
+ * and has nobody to ask. Adding them would produce a number no reconciliation
+ * can ever match, and the day it failed to match nobody would know which half
+ * was wrong. Callers that want one figure add them deliberately and say they
+ * did.
  */
 export function totalRows(rows: readonly AiCallRow[]): {
   credits: number;
   upstream: number;
+  computed: number;
   unpriced: number;
 } {
   let credits = 0;
   let upstream = 0;
+  let computed = 0;
   let unpriced = 0;
   for (const r of rows) {
+    /* First, because a computed row has no `credits_used_nanos` at all and
+       would otherwise be counted as unpriced — which is the one thing it is
+       not. The database `CHECK` in 0023 makes these three cases exclusive. */
+    if (r.costSource === "computed") {
+      computed += r.computedCostNanos ?? 0;
+      continue;
+    }
     if (r.isByok === true) {
       if (r.upstreamInferenceNanos === null) unpriced += 1;
       else upstream += r.upstreamInferenceNanos;
@@ -61,5 +79,5 @@ export function totalRows(rows: readonly AiCallRow[]): {
     if (r.creditsUsedNanos === null) unpriced += 1;
     else credits += r.creditsUsedNanos;
   }
-  return { credits, upstream, unpriced };
+  return { credits, upstream, computed, unpriced };
 }
diff --git a/tests/ai-cost-cli.test.ts b/tests/ai-cost-cli.test.ts
index 047a4b4..e27e2d0 100644
--- a/tests/ai-cost-cli.test.ts
+++ b/tests/ai-cost-cli.test.ts
@@ -9,7 +9,8 @@
  * what makes the reconciliation comparable at all.
  */
 import { describe, expect, it } from "vitest";
-import { parseArgs } from "../scripts/ai-cost.js";
+import type { AiCallRow } from "../src/ai-spend.js";
+import { by, parseArgs } from "../scripts/ai-cost.js";
 
 describe("--month", () => {
   it("runs from the first instant of the month to the first instant of the next", () => {
@@ -77,3 +78,43 @@ describe("--month", () => {
     expect(() => parseArgs(["--last-week"])).toThrow("Unknown flag");
   });
 });
+
+describe("the breakdowns", () => {
+  /** The four fields `by` actually reads; the rest of a row is irrelevant here. */
+  const row = (over: Partial<AiCallRow>): AiCallRow =>
+    ({
+      job: "pdf",
+      isByok: false,
+      costSource: "provider",
+      creditsUsedNanos: 0,
+      upstreamInferenceNanos: null,
+      computedCostNanos: null,
+      ...over,
+    }) as AiCallRow;
+
+  it("counts our own arithmetic, and not only OpenRouter's figure", () => {
+    /* **The bug this pins.** `by` summed `credits + upstream`, so every
+       breakdown printed `$0.0000` for a declared bypass — money really spent,
+       grouped by day and by model, showing as nothing at all. Found by running
+       `npm run cost` after a live probe, not by any assertion. The pocket lines
+       keep the three kinds apart deliberately; a breakdown wants the total. */
+    const groups = by(
+      [
+        row({ creditsUsedNanos: 1_000 }),
+        row({ costSource: "computed", creditsUsedNanos: null, computedCostNanos: 32_000 }),
+      ],
+      (r) => r.job,
+    );
+    expect(groups).toHaveLength(1);
+    expect(groups[0]?.nanos).toBe(33_000);
+    expect(groups[0]?.calls).toBe(2);
+  });
+
+  it("counts BYOK, whose credits are legitimately zero", () => {
+    const groups = by(
+      [row({ isByok: true, creditsUsedNanos: 0, upstreamInferenceNanos: 4_000 })],
+      (r) => r.job,
+    );
+    expect(groups[0]?.nanos).toBe(4_000);
+  });
+});
diff --git a/tests/ai-spend.test.ts b/tests/ai-spend.test.ts
index 92f2a8d..ed4e66e 100644
--- a/tests/ai-spend.test.ts
+++ b/tests/ai-spend.test.ts
@@ -42,6 +42,9 @@ function call(over: Partial<SpendRecord> = {}): SpendRecord {
     generationId: "gen-1787844432-JKwGQebcNXfkCfTX5mUq",
     upstream: "Anthropic",
     isByok: false,
+    providerAccount: "openrouter",
+    computedCostNanos: null,
+    priceVersion: null,
     credentialFingerprint: "abcdef012345",
     wire: "messages",
     inputTokens: 13,
@@ -377,6 +380,28 @@ async function rowsFrom(
 }
 
 describe("the sink", () => {
+  it("calls a BYOK zero a reported cost, because a zero is an answer", async () => {
+    /* **The mutation that found this:** `costSourceOf` asking `if (costNanos)`
+       instead of `if (costNanos !== null)` passed every test in the suite. It
+       would have put `cost_source: "computed"` on a BYOK call whose credits are
+       legitimately `0`, and migration 0023's CHECK then *rejects the insert* —
+       so the loudest symptom of a one-character slip would be a row that never
+       arrives, on exactly the traffic a per-user spend limit is made of. */
+    const rows = await rowsFrom({}, () => {
+      recordSpend(call({ costNanos: 0, upstreamCostNanos: 4_000, isByok: true }));
+    });
+    expect(rows[0]?.costSource).toBe("provider");
+    expect(rows[0]?.creditsUsedNanos).toBe(0);
+    expect(rows[0]?.computedCostNanos).toBeNull();
+  });
+
+  it("says a call nobody could price is `none`, not `computed`", async () => {
+    const rows = await rowsFrom({}, () => {
+      recordSpend(call({ costNanos: null, upstreamCostNanos: null, isByok: null }));
+    });
+    expect(rows[0]?.costSource).toBe("none");
+  });
+
   it("gets one row per recorded call, with the collector's attribution on it", async () => {
     const rows = await rowsFrom({
       attribution: {
diff --git a/tests/pricing.test.ts b/tests/pricing.test.ts
index 4993dab..8e8216e 100644
--- a/tests/pricing.test.ts
+++ b/tests/pricing.test.ts
@@ -296,3 +296,57 @@ describe("costDrift", () => {
     expect(costDrift(500, null)).toBeNull();
   });
 });
+
+describe("dated model spellings", () => {
+  /* Found by a live probe, not by reading: one real Haiku call through the
+     declared bypass came back priced at nothing, with its token counts sitting
+     on the same row. The SDK's id carries a release date and the table is keyed
+     on the undated name. */
+  it("prices the SDK's dated Haiku id the same as the undated one", () => {
+    const usage = { input_tokens: 1_000_000, output_tokens: 1_000_000 };
+    const at = new Date("2026-08-28T00:00:00Z");
+    const dated = priceAnthropicCall("claude-haiku-4-5-20251001", usage, at);
+    const plain = priceAnthropicCall("claude-haiku-4-5", usage, at);
+    expect(dated).not.toBeNull();
+    expect(dated?.totalNanos).toBe(plain?.totalNanos);
+    /* $1 in + $5 out per million. */
+    expect(dated?.totalNanos).toBe(6_000_000_000);
+  });
+
+  it("refuses an undeclared snapshot of a model that IS in the table", () => {
+    /* **The one the map exists to get right, and the case a stripper gets
+       wrong.** `claude-haiku-4-5-20991231` is a release nobody here has looked
+       at; a regular expression that cut the date off would price it at today's
+       Haiku rate and the row would look completely normal. GPT Sol asked for an
+       explicit map for exactly this. `null` means `cost_source: "none"`, which
+       is the report saying it does not know — the only honest answer. */
+    expect(
+      priceAnthropicCall(
+        "claude-haiku-4-5-20991231",
+        { input_tokens: 10, output_tokens: 10 },
+        new Date("2026-08-28T00:00:00Z"),
+      ),
+    ).toBeNull();
+  });
+
+  it("still refuses a model nobody has put in the table at all", () => {
+    expect(
+      priceAnthropicCall(
+        "some-vendor/some-model",
+        { input_tokens: 10, output_tokens: 10 },
+        new Date("2026-08-28T00:00:00Z"),
+      ),
+    ).toBeNull();
+  });
+
+  it("stamps the price version with the name the table actually used", () => {
+    const v = priceAnthropicCall(
+      "claude-haiku-4-5-20251001",
+      { input_tokens: 10, output_tokens: 10 },
+      new Date("2026-08-28T00:00:00Z"),
+    )?.priceVersion;
+    /* The id as *sent*, so a row leads back to the request; the date is the
+       price row's, so it leads back to the table. */
+    expect(v).toBe("claude-haiku-4-5-20251001@1970-01-01");
+  });
+});
diff --git a/tests/store-ai-calls.test.ts b/tests/store-ai-calls.test.ts
index 14135c0..dbabba7 100644
--- a/tests/store-ai-calls.test.ts
+++ b/tests/store-ai-calls.test.ts
@@ -41,6 +41,10 @@ function row(over: Partial<AiCallRow> = {}): AiCallRow {
     requestedModel: "anthropic/claude-sonnet-5",
     answeredModel: "anthropic/claude-sonnet-5",
     upstream: "Anthropic",
+    providerAccount: "openrouter",
+    costSource: "provider",
+    computedCostNanos: null,
+    priceVersion: null,
     credentialFingerprint: "abcdef012345",
     startedAt: "2026-08-15T10:00:00.000Z",
     finishedAt: "2026-08-15T10:00:01.200Z",
@@ -66,6 +70,38 @@ function row(over: Partial<AiCallRow> = {}): AiCallRow {
 /* ------------------------------------------------------------ the sums -- */
 
 describe("totalRows", () => {
+  it("keeps our own arithmetic in its own pocket, and out of `unpriced`", () => {
+    /* A declared bypass does not go through OpenRouter, so there is nobody to
+       ask what it cost and the figure is ours. Two things must not happen to
+       it: being added to `credits`, which is the number `--reconcile` compares
+       against OpenRouter's own running total and would then never match; and
+       being counted as `unpriced`, which it is the opposite of. */
+    const t = totalRows([
+      row(),
+      row({
+        costSource: "computed",
+        creditsUsedNanos: null,
+        computedCostNanos: 7_000_000,
+        providerAccount: "anthropic",
+        priceVersion: "claude-sonnet-5@2026-08-01",
+      }),
+    ]);
+    expect(t.credits).toBe(21_523_500);
+    expect(t.computed).toBe(7_000_000);
+    expect(t.unpriced).toBe(0);
+  });
+
+  it("counts a declared call that reported nothing at all as unpriced", () => {
+    /* `cost_source: "none"` — the call happened, it may well have been billed,
+       and we cannot say for how much. Distinct from `computed`. */
+    const t = totalRows([
+      row({ costSource: "none", creditsUsedNanos: null, computedCostNanos: null }),
+    ]);
+    expect(t.credits).toBe(0);
+    expect(t.computed).toBe(0);
+    expect(t.unpriced).toBe(1);
+  });
+
   it("counts a call that reported nothing as unpriced rather than as free", () => {
     const t = totalRows([row(), row({ creditsUsedNanos: null })]);
     expect(t.credits).toBe(21_523_500);
@@ -189,6 +225,58 @@ describe("the filesystem ledger", () => {
     expect(after.rows.some((r) => r.id === "x")).toBe(false);
   });
 
+  it("refuses a row whose cost_source disagrees with its two numbers", async () => {
+    /* **The check the database does with `ai_calls_one_cost_source`, done by
+       reading.** This store has no database. `totalRows` adds `computed` in one
+       branch and `credits` in another, so a line carrying both is counted twice
+       and a line claiming `provider` with nothing in it is counted as money that
+       arrived. Nothing else stands between a hand-edited JSONL line and a wrong
+       total. */
+    const ok = JSON.stringify(
+      row({
+        id: "00000000-0000-4000-8000-00000000f001",
+        /* Its own job id: these lines land in the shared fixture ledger, and the
+           by-job test below counts rows. */
+        jobId: "job-cost-source",
+        costSource: "computed",
+        creditsUsedNanos: null,
+        computedCostNanos: 7_000,
+        priceVersion: "claude-sonnet-5@1970-01-01",
+      }),
+    );
+    const both = JSON.stringify(
+      row({
+        id: "00000000-0000-4000-8000-00000000f002",
+        /* Its own job id: these lines land in the shared fixture ledger, and the
+           by-job test below counts rows. */
+        jobId: "job-cost-source",
+        costSource: "computed",
+        creditsUsedNanos: 5,
+        computedCostNanos: 7_000,
+        priceVersion: "claude-sonnet-5@1970-01-01",
+      }),
+    );
+    const noVersion = JSON.stringify(
+      row({
+        id: "00000000-0000-4000-8000-00000000f003",
+        /* Its own job id: these lines land in the shared fixture ledger, and the
+           by-job test below counts rows. */
+        jobId: "job-cost-source",
+        costSource: "computed",
+        creditsUsedNanos: null,
+        computedCostNanos: 7_000,
+        priceVersion: null,
+      }),
+    );
+    const before = (await store.read()).unreadable;
+    await writeFile(store.describe(), `${ok}\n${both}\n${noVersion}\n`, { flag: "a" });
+    const after = await store.read();
+    expect(after.unreadable).toBe(before + 2);
+    /* And the honest one still gets through, so this is not simply rejecting
+       everything. */
+    expect(after.rows.some((r) => r.id === "00000000-0000-4000-8000-00000000f001")).toBe(true);
+  });
+
   it("does not interleave two writes racing each other", async () => {
     /* Append-only is not the same as atomic — Node says plainly that its
        promise-based fs calls are not synchronised, and nothing established that
@@ -217,10 +305,11 @@ describe("the filesystem ledger", () => {
     const found = await store.forJob("job-parted");
     expect(found.rows.map((r) => r.stepName).sort()).toEqual(["arc", "toc"]);
     /* Carried through rather than dropped: a damaged line belonging to this job
-       would otherwise make a short job total look confident. The lines the two
+       would otherwise make a short job total look confident. The lines the three
        tests above appended are still in this file, which is what makes this
-       assertion mean something. */
-    expect(found.unreadable).toBe(3);
+       assertion mean something — one unparseable, two that parse but are not
+       rows, and two whose `cost_source` disagrees with their own numbers. */
+    expect(found.unreadable).toBe(5);
   });
 });
 
```
