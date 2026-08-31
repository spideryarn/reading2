# Review: the declared bypass, the scan, and the cost provenance columns

This is the code built from your input this morning
(`docs/plans/260828g-ai-spend-outside-the-gateway-sol.md`). **Weight this higher than that one** — a
plan-stage review cannot find a `finally` that swallows the caller's error, and this one did have
that bug.

## What you told me, and what I did with it

1. **Not `recordExternalCall()` — a lifecycle wrapper.** Built as
   `withDeclaredExternalCall(id, {model}, fn)`: `beginSpend` before the network, `recordSpend`
   exactly once in a `finally`, `observe.anthropic()` / `observe.openRouter()`, the sole
   `AiCallRow` construction still in `src/ai-spend.ts`. `maxRetries: 0` **and** an attempt counter,
   so the setting has to keep working. The register is split into `src/spend-declarations.ts` (data,
   readable by the report and the scan) from the wrapper in `evals/declared-spend.ts` (the only
   thing that can make a call, and under `evals/` as you asked).
2. **The scan is capability-based, but it does not parse, and I want you on this.** Your design was
   a TypeScript AST walk. It is not available: this repo is on **TypeScript 7**, whose npm package
   exports `version` and `versionMajorMinor` and nothing else — `ts.createSourceFile` and
   `ts.ScriptTarget` are both `undefined`, which I found by having every matcher throw. Every JS
   parser installed (`@babel/parser`, `oxc-parser`, `esbuild`, `meriyah`) is somebody else's
   transitive dependency, and I judged that a gate which stops running when an unrelated package is
   bumped is worse than no gate. So it strips comments by hand and matches text.
3. **You were right that the price table survives**, and my plan was stale. `ANTHROPIC_PRICES` and
   `priceAnthropicCall` are intact, so a direct-Anthropic call is priced. Four columns rather than
   putting an estimate in `credits_used_nanos`: `provider_account`, `cost_source`,
   `computed_cost_nanos`, `price_version`, with three `CHECK` constraints (migration 0023, already
   committed and applied to a populated local database — I proved each CHECK rejects the row it is
   meant to, and that an honest row passes all three and is refused only by the owner FK).
4. **Product and eval printed apart**, no line called `Total`.
5. **Your inventory corrections:** the judge was miscategorised (it is not one of the transport
   experiments) — but I did *not* move it to a seam, and I want you to push on that; `embeddings` is
   the embeddings wire; the dated Haiku spelling got an explicit `MODEL_ALIASES` map with a test
   that a *stripper* would fail; `rescue` got a new `eval` job rather than borrowing `pdf`; the
   Mistral OCR arm goes through the bake-off's own OpenRouter helper.
6. **Yes, before phase 6/7.** Agreed and recorded.

## Where I departed from you, and why

- **The judge stayed a declared bypass.** You said "route it through a seam, or C has three
  declarations". `streamMessage` owns the model on purpose (a stage must not be able to switch it),
  the judge picks its own per run, and moving it to the chat wire loses
  `thinking: {type: "adaptive"}` — which changes judgements that are cached on disk under a rubric
  version, i.e. a full re-judge in real money. So: three declarations. Tell me if that is wrong.
- **The bake-off's OpenRouter helper is also a declared bypass**, not re-plumbed onto
  `openRouterJson`. The seam owns the `provider` block per job, and this bake-off's arms deliberately
  disagree — the model arms forbid fallback, the Mistral OCR arm allows it. One policy over both
  changes what two arms measure.
- **The two dictation benches are declared `metered: false`, not wired.** Another agent was
  rewriting that directory the same morning. `npm run cost` names them, every run.
- **No per-fingerprint reconciliation baseline yet**, and no Anthropic-side reconciliation. The
  report labels computed money "never reconciled".

## What I want from you

1. **The scan.** Is a hand-rolled comment stripper defensible given the parser situation, or should
   I take the transitive-dependency risk? What does my `stripComments` get wrong? I know I do not
   track regular-expression literals and I argue in the header that this cannot *hide* a match — is
   that argument sound? What else defeats the matchers that I have not already written down?
2. **The wrapper.** Look hard for a path where money is spent and no row is written, or where one
   row understates. Specifically: the `finally` ordering (record, *then* raise the retry error, and
   only when the body itself did not throw); `withSpendAttribution` wrapping the `finally` rather
   than only the body (a test caught `step_name` arriving null); `costSourceOf` deriving from the two
   number fields; and whether `observe` being callable more than once is a hazard.
3. **The `CHECK` constraints.** `ai_calls_one_cost_source` makes the three cases exclusive. Is there
   a legitimate row it refuses? A BYOK call has `credits = 0` and `cost_source = 'provider'`; I have
   a test pinning that, because the mutation `if (record.costNanos)` instead of `!== null` passed the
   whole suite and would have made every BYOK row fail to insert.
4. **Anything I have got wrong in the eval rewiring**, especially `AI_JOB_ROUTE.eval` forbidding
   fallback and requiring parameters, and `rescue.mts` now treating a 200-with-`error` as a throw.
5. **Is `metered: false` a loophole?** It is meant to be a named, printed admission. Argue that it
   will instead become a place to put things.

## Evidence

- **A live probe**, one real Haiku call through `withDeclaredExternalCall` end to end. It found two
  bugs the tests did not: the price lookup missed the dated model id (row came back
  `cost_source: "none"` with its token counts sitting on it), and every breakdown in the report
  printed `$0.0000` because `by()` summed `credits + upstream` only. After both fixes the row reads
  `computed: 32000` nanos for 12 in / 4 out on Haiku — $0.000012 + $0.000020, which is exact.
- **The scan went red on its first real run**, on two files I had not found by reading: a peer's
  `evals/dictation/bench-vocabulary-sources.ts`, created an hour earlier, and a root-level
  `scratch-tok2.mts` constructing an Anthropic client.
- **Eight mutations**, each applied, confirmed red, and reverted: `costSourceOf` truthiness,
  `totalRows` dropping the computed branch, the retry threshold, `declaredFetch`'s guard, the
  attribution scope, the scan's endpoint matcher, `by()` dropping computed, and the alias map
  becoming a date-stripper.
- `npm test`: 240 of 244 files pass. The four failures are other agents' (`db-schema-drift` counts a
  table a peer added this morning; `owner-isolation` names a peer's new `public-slug.ts`;
  `store-export-raw` and `store-jobs-parity` likewise).
- **`npm run cycles` crashes biome** with a stack overflow in this tree, on files I never touched
  (`src/log.ts` alone reproduces it), so the gate could not be run. I wrote a stand-in cycle detector
  instead: 547 files, 0 cycles. I saw it report a false positive first, so I have watched it fail.

---

# The plan, as it now reads

# The spend the ledger cannot see

**Status:** plan, 2026-08-28. Successor to
[260827q-ai-cost-tracking.md](260827q-ai-cost-tracking.md), which built the ledger and then said, on every single
run of the report:

```
Not counted here: anything evals/ spends — it does not go through the gateways.
```

Greg asked for *"careful, accurate, **comprehensive** cost-tracking (of all AI spend, including
embeddings, transcription, etc)"*. That line is the ledger admitting it is not comprehensive. This
plan is about deleting the line by making it false, rather than by making it quiet.

## The inventory, which is worse than the line admits

The line says "evals". It is right about the directory and wrong about the shape. Eight call sites
spend money that produces no row, in **three** different ways, on **two** different accounts.

| Where | How it calls | Account | Why there is no row |
| --- | --- | --- | --- |
| [`evals/review-stances.ts`](../../evals/review-stances.ts) | `converse` → chat wire | OpenRouter | metered, but no scope is open |
| [`evals/prompt-caching.ts`](../../evals/prompt-caching.ts) | `converse` → chat wire | OpenRouter | metered, but no scope is open |
| [`evals/embedding-retrieval.ts`](../../evals/embedding-retrieval.ts) | `embedAll` → chat wire | OpenRouter | metered, but no scope is open |
| [`evals/embedding-retrieval.ts:933`](../../evals/embedding-retrieval.ts) — the judge | `new Anthropic()` | **Anthropic** | outside both seams |
| [`evals/pdf/bakeoff/bakeoff.mts:220`](../../evals/pdf/bakeoff/bakeoff.mts) | `new Anthropic()` **and** a hand-rolled `fetch` | **both** | outside both seams |
| [`evals/extraction/rescue.mts:98`](../../evals/extraction/rescue.mts) | hand-rolled `fetch` | OpenRouter | outside both seams |
| [`evals/dictation/bench-transcribers.mjs:22`](../../evals/dictation/bench-transcribers.mjs) | hand-rolled `fetch`, key parsed out of `.env.local` by regex | OpenRouter | outside both seams |
| [`evals/dictation/bench-vocabulary.mjs:16`](../../evals/dictation/bench-vocabulary.mjs) | hand-rolled `fetch`, same regex | OpenRouter | outside both seams |

Three facts in that table matter more than the eight rows.

### 1. Three of them are already metered and only need a scope

`converse` and `embedAll` go through [`src/ai-call.ts`](../../src/ai-call.ts). The call is measured,
priced from OpenRouter's own `usage.cost`, and then dropped on the floor because no collector is
open — `recordSpend` warns and returns. The fix is the line that already exists for the seven
pipeline stages:

```ts
if (isMain) void withLedger("eval", main);
```

`withLedger`'s signature is `(scopeKind: "cli" | "eval", …)`. **The `eval` half has never been
called.** It was written for this and left unwired, which is exactly the sort of thing that reads as
finished.

### 2. Two accounts, and only one of them is reconciled

`--reconcile` reads `GET /api/v1/key` and compares our rows against OpenRouter's own running total.
`ANTHROPIC_API_KEY` is still live in `.env.local`, and two evals spend on it directly. Nothing in
this repo reads the Anthropic side of the bill, and [question 0 of the previous
plan](260827q-ai-cost-tracking.md#questions-for-greg) withdrew the only mechanism that could — the Admin
Cost API needs a credential this account may not be able to issue.

~~So a direct-Anthropic call cannot be priced at all any more. **The price table was deleted**~~
— **wrong, and GPT Sol caught it.** [`src/pricing.ts`](../../src/pricing.ts) is 406 lines and still
holds `ANTHROPIC_PRICES`, `priceAnthropicCall` and `crossCheckOpenRouter`. What changed when
`usage.cost` arrived is that the seams stopped *using* it, not that it went away — it is kept
precisely so the two can be compared. So a direct-Anthropic call **can** be priced; the figure is
just ours rather than settled, and the row has to say which.

That distinction is the whole of `cost_source`. `credits_used_nanos` means one thing — what
OpenRouter deducted — and an estimate must never land in it, because that column is what
`--reconcile` compares against OpenRouter's own running total.

### 3. Two of the eight are outside the gateway **on purpose**, and that has to be respected

The PDF bake-off's whole reason to exist is comparing transports — one reader is
`transport: "anthropic"`, another is `transport: "openrouter"`, and the point is which wins.
The dictation bench compares sixteen transcribers on OpenRouter's dedicated
`POST /v1/audio/transcriptions`, which is a different endpoint from the one `src/transcribe.ts`
uses for one chosen model.

Routing either through the seam deletes what it measures. So "make everything use the seam" is not
the design; it is a wish that would quietly break two evals.

### C. The ones that must stay raw get a *declared* bypass that still produces a row

**Built as (a)**, and GPT Sol sharpened it into something better than a `recordExternalCall()`:

> a completion-only function can be forgotten, misses throws, and mints the identifier after the
> request.
>
> — GPT Sol, 2026-08-28

So it is a **lifecycle wrapper**, not a report-afterwards call: `withDeclaredExternalCall(id, {model},
fn)` calls `beginSpend` before the network, `recordSpend` exactly once in a `finally`, and hands the
body an `observe` with one method per provider. The only `AiCallRow` construction stays where it
was, in `src/ai-spend.ts`.

Three things stop it becoming a second way to call a model:

- the wrapper lives under `evals/`, so nothing in `src/` reaches it without a relative import that
  stands out in a diff — the *register* is separate ([`src/spend-declarations.ts`](../../src/spend-declarations.ts))
  because the report and the scan both have to read the list;
- `declaredFetch` throws outside a declaration, which is the half with teeth;
- the scan in D fails on any way of reaching a provider that is not in the register.

**Retries were the trap, and I had not seen it.** A bare Anthropic client retries twice by default,
so one `messages.create` can be three billable attempts behind one row — a cost table wrong by a
factor, with nothing looking wrong. `anthropicForDeclared()` sets `maxRetries: 0`, and
`declaredFetch` counts attempts so that the setting has to keep working rather than having been
written down once.

## What was built, 2026-08-28

### A. Scope the four that were already metered — done

`converse` and `embedAll` were measured all along and dropped on the floor because no collector was
open. One line each at the entry point of
[`review-stances.ts`](../../evals/review-stances.ts), [`prompt-caching.ts`](../../evals/prompt-caching.ts),
[`embedding-retrieval.ts`](../../evals/embedding-retrieval.ts) and
[`rescue.mts`](../../evals/extraction/rescue.mts):

```ts
await withLedger("eval", main);
```

`withLedger`'s signature has been `(scopeKind: "cli" | "eval", …)` since the ledger landed and **the
`eval` half had never once been called.** It was written for this and left unwired, which is exactly
the sort of thing that reads as finished.

### B. Re-plumb where the raw call was incidental — done, for one of three

[`rescue.mts`](../../evals/extraction/rescue.mts) hand-rolled a `fetch` because it wanted a model,
not because it wanted its own transport. It now calls `openRouterJson("eval", …)` and nothing about
the request changed: `AI_JOB_ROUTE.eval` sets the same `require_parameters` and
`allow_fallbacks: false` it used to pass by hand.

`AI_JOB_ROUTE.eval` **forbids fallback, and that is the stronger case rather than a copy of `pdf`'s**
— an eval names a model and reports a number against that name, so an upstream substituted silently
means the number belongs to a model the write-up never mentions.

The two dictation benches were **not** re-plumbed, and the reason is not technical. Another agent was
rewriting that directory the same morning — `bench-vocabulary-sources.ts` and `make-clips.mjs` were
minutes old — and re-plumbing a file mid-rewrite loses somebody's work. They are declared instead,
which is the honest state and costs nothing to finish later.

### C — see above. Built as a lifecycle wrapper.

Three declarations are **metered** and write rows: the bake-off's two transports and the embedding
eval's judge. Three are **declared and not yet metered**: the two dictation benches and the
successor one of them is being replaced by.

The judge stayed a bypass rather than moving to the seam, and that is the weakest of the three:
`streamMessage` owns the model on purpose, the judge picks its own per run, and converting it to the
chat wire would lose `thinking: {type: "adaptive"}` — which changes the judgements, which are cached
on disk under a rubric version, which means a full re-judge in real money. Worth revisiting the day
the seam grows an explicit-model entry point.

### D. The scan — [`tests/no-undeclared-spend.test.ts`](../../tests/no-undeclared-spend.test.ts)

Every file git can see — **tracked and not-yet-added**, because listing only tracked files means a
new bypass passes on the machine that wrote it and fails for the first time on somebody else's.

It parses nothing. The obvious design was an AST walk, and it does not work here: this repo is on
TypeScript 7, whose package exports `version` and little else, and every JavaScript parser installed
arrived as somebody else's transitive dependency. **A gate that stops running when an unrelated
package is bumped is worse than no gate, because it goes quiet rather than red.** So it strips
comments itself — tracking the three kinds of string literal, so a `//` inside a URL is not a
comment — and matches the rest.

**It went red on its first real run**, on two files I had not found by reading: a peer's
`bench-vocabulary-sources.ts`, created an hour earlier, spending real money through its own
hand-rolled `fetch`; and a root-level `scratch-tok2.mts` constructing an Anthropic client. That is
the best evidence available that it works.

Six matchers, each proved against its broken state in the same file. What defeats it is written down
in its header rather than left to be discovered: a hostname built by concatenation, a base URL from
an unknown env var, a client from a factory, `curl` in a subprocess. It is a **tripwire, not a
boundary** — the boundary is `declaredFetch`.

### E. Eval rows are stored, and the report keeps them out of the headline

GPT Sol was right that *"you can never un-lose a row"* settles **storage** and not **reporting**:

> the number Greg will use for product pricing should not jump because somebody ran forty PDFs.

So there is no line called `Total`. There is `Product spend`, `Eval spend`, and — only when both
exist — `All recorded`. Each pocket keeps credits, BYOK and *computed* apart, and the computed line
says out loud that it was never reconciled.

## Two bugs the live probe found and the tests did not

Both were found by running one real Haiku call end to end and then reading `npm run cost`, which is
the same way the previous phase found `formatNanos` printing `$0.0000` for money really spent.

1. **The price lookup missed.** The bake-off sends `claude-haiku-4-5-20251001` — the dated spelling
   the SDK answers to — and `ANTHROPIC_PRICES` is keyed on `claude-haiku-4-5`. The row came back
   `cost_source: "none"` with its token counts sitting right there. Fixed with an explicit
   `MODEL_ALIASES` map, **not** a regular expression that strips a trailing date: a stripper would
   price an unreviewed future snapshot at today's rate and the row would look entirely normal. GPT
   Sol asked for exactly that, in advance, and the probe is what showed why.
2. **Every breakdown printed `$0.0000`.** `by()` summed `credits + upstream`, so the declared
   bypasses' money — itemised by day, by job, by model — showed as nothing at all. The pocket lines
   keep the three kinds apart deliberately; a *breakdown* wants the total.

## What this does not do

- **It does not read the Anthropic bill.** Two accounts, one reconciliation. Those rows are now
  visible and priced, and the report labels them *computed … never reconciled* every run. Anthropic's
  Admin Cost API is not available to an individual account, so the honest interim is a periodic
  manual look at the Console — recorded here rather than left as a silent gap.
- **It does not delete the bake-off's direct-Anthropic arm**, though it probably should be: the app
  cannot use that transport any more, so the bake-off is measuring a road we no longer drive on. That
  is the PDF stage's call, not this one's —
  [architecture.md § Stage ownership](../project/architecture.md#stage-ownership).
- **It does not wire the two dictation benches.** They are named, every run, by
  `npm run cost`.
- **It does not add a cap.** Still report-only, still Greg's decision.

## See also

- [260827q-ai-cost-tracking.md](260827q-ai-cost-tracking.md) — the ledger this depends on
- [ai-gateway.md](../project/ai-gateway.md) — the two seams
- [260828g-ai-spend-outside-the-gateway-sol.md](260828g-ai-spend-outside-the-gateway-sol.md) — GPT Sol's input on the
  plan, including the two premises of mine it corrected

---

# New files

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
 * Why any of this exists: docs/plans/260828g-ai-spend-outside-the-gateway.md.
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
  /** Why the seam is wrong for this call. Not "it was easier". */
  readonly why: string;
}

export const DECLARATIONS: readonly Declaration[] = [
  {
    id: "bakeoff-anthropic-transport",
    account: "anthropic",
    file: "evals/pdf/bakeoff/bakeoff.mts",
    job: "pdf",
    wire: "messages",
    metered: true,
    why: "The bake-off's whole question is which transport wins. Routing its `transport: \"anthropic\"` arm through OpenRouter would leave it comparing OpenRouter with OpenRouter and reporting a winner.",
  },
  {
    id: "bakeoff-openrouter-transport",
    account: "openrouter",
    file: "evals/pdf/bakeoff/bakeoff.mts",
    job: "pdf",
    wire: "chat",
    metered: true,
    why: "The other half of the same comparison, and it cannot go through `openRouterJson` either: the seam owns the `provider` block per job, and this bake-off's arms deliberately differ from each other — the model arms forbid fallback, the Mistral OCR arm allows it. One policy imposed on both would change what two of the arms measure.",
  },
  {
    id: "embedding-eval-judge",
    account: "anthropic",
    file: "evals/embedding-retrieval.ts",
    job: "eval",
    wire: "messages",
    metered: true,
    why: "The judge picks its own model per run, and `streamMessage` owns the model on purpose so a stage cannot quietly switch one. Converting it to the chat wire would mean losing `thinking: {type: \"adaptive\"}`, which changes the judgements — and the judgements are cached on disk under a rubric version, so changing them costs a full re-judge in real money.",
  },
  {
    id: "dictation-bench-audio",
    account: "openrouter",
    file: "evals/dictation/bench-transcribers.mjs",
    job: "dictation",
    wire: "chat",
    metered: false,
    why: "Posts to `/v1/audio/transcriptions`, which the seam deliberately does not serve — `OpenRouterPath` is a closed union of the two paths the app uses, and widening the app's surface for an eval is the wrong trade. Wiring it needs a fourth `Wire` (`audio`), and that file is being rewritten by another agent as of 2026-08-28.",
  },
  {
    id: "dictation-bench-vocabulary-sources",
    account: "openrouter",
    file: "evals/dictation/bench-vocabulary-sources.ts",
    job: "dictation",
    wire: "chat",
    metered: false,
    why: "Found by tests/no-undeclared-spend.test.ts on the day it was written — the file had been created an hour earlier by another agent and spends real money through its own hand-rolled fetch. Declared rather than re-plumbed because it belongs to work in progress; wiring it means one call to openRouterJson once that work has settled.",
  },
  {
    id: "dictation-bench-vocabulary",
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
export interface Observer {
  /**
   * An Anthropic `Message` (or anything with its `usage`). Priced from
   * `ANTHROPIC_PRICES`, because there is nobody to ask — the call did not go
   * through OpenRouter and Anthropic charges no per-call figure back.
   */
  anthropic: (message: {
    usage?: AnthropicUsageLike | null;
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
    anthropicUsage: AnthropicUsageLike | null;
    openRouterUsage: OpenRouterUsageLike | null;
    answeredBy: string | null;
    upstream: string | null;
  } = {
    costNanos: null,
    computedCostNanos: null,
    priceVersion: null,
    anthropicUsage: null,
    openRouterUsage: null,
    answeredBy: null,
    upstream: null,
  };

  const observe: Observer = {
    anthropic(message) {
      seen.answeredBy = message.model ?? seen.answeredBy;
      if (!message.usage) return;
      seen.anthropicUsage = message.usage;
      const priced = priceAnthropicCall(
        message.model ?? spec.model,
        message.usage,
        new Date(startedAt),
      );
      /* `null` when the model is not in the table, and left `null` rather than
         made `0`. An unknown price and a free call are different facts and the
         report distinguishes them. */
      if (priced) {
        seen.computedCostNanos = priced.totalNanos;
        seen.priceVersion = priced.priceVersion;
      }
    },
    openRouter(body) {
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
          cacheWrite5mTokens: null,
          cacheWrite1hTokens: null,
          reasoningTokens: null,
          webSearches: null,
          serviceTier: null,
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
 * no total at all — see docs/plans/260828g-ai-spend-outside-the-gateway.md.
 *
 * Repairing those was a one-off. This is the part that keeps them repaired. It
 * walks every tracked JavaScript and TypeScript file and asks a narrow question
 * — *does this file have the capability to spend money?* — then insists that
 * every file which does is either one of the seams, or an entry in
 * [`src/spend-declarations.ts`](../src/spend-declarations.ts), or on the small
 * allow-list below with a reason.
 *
 * ## Capability, not grep — and no parser
 *
 * The first version matched hostnames in raw text and lit up on three dozen
 * files that only *mention* `api.anthropic.com` in a doc comment. The obvious
 * fix was to parse, and it does not work here: this repo is on TypeScript 7,
 * whose package exports `version` and little else — `ts.createSourceFile` is
 * gone — and every JavaScript parser installed (`@babel/parser`, `oxc-parser`,
 * `esbuild`) arrived as somebody else's transitive dependency. A gate that stops
 * running when an unrelated package is bumped is worse than no gate, because it
 * goes quiet rather than red.
 *
 * So this strips comments itself and matches the rest. `stripComments` tracks
 * the three kinds of string literal and escapes, so a `//` inside a URL is not a
 * comment and a sentence about OpenRouter is not a request to it. What counts as
 * a capability is deliberately short —
 *
 * - **constructing** a provider client (`new Anthropic()`), rather than
 *   importing the package: `src/anthropic-call.ts` imports its error classes and
 *   can no more make a call than a type can;
 * - a provider hostname or a paid endpoint path, anywhere in the code;
 * - the name of an AI credential, which catches `process.env.OPENROUTER_API_KEY`
 *   and equally the regular expression both dictation benches use to pull the
 *   key out of `.env.local` by hand.
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

/** The client classes a provider SDK hands out, by the name they are bound to. */
const SDKS = [{ name: "Anthropic" }, { name: "OpenAI" }];

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

/**
 * **Comments out, code in.**
 *
 * Character by character rather than by regular expression, because the two
 * cases that matter are exactly the ones a regular expression gets wrong: a
 * `//` inside `"https://openrouter.ai"` is not a comment, and a `/*` inside a
 * string is not a block. Escapes are honoured so `"\\"` does not swallow the
 * rest of the file.
 *
 * Regular-expression literals are left alone deliberately. Distinguishing one
 * from a division needs a real parser, and getting it wrong in the unsafe
 * direction — treating a division as a regex — would swallow code and hide a
 * match. Not tracking them cannot hide anything: at worst their contents are
 * scanned as if they were code, which is what we want anyway.
 */
export function stripComments(source: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < source.length) {
    const c = source[i]!;
    const next = source[i + 1];
    if (quote) {
      out += c;
      if (c === "\\") {
        out += source[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 2;
      /* A newline in its place, so nothing on either side of a stripped block
         is joined into a token that was never written. */
      out += "\n";
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/**
 * What a single file can do. Exported so the matcher tests below can hand it
 * source text directly rather than writing files into the repo.
 */
export function capabilitiesOf(file: string, source: string): Finding[] {
  const code = stripComments(source);
  const found: Finding[] = [];

  for (const sdk of SDKS) {
    /* Construction, not import. `new Anthropic(` in a file that never imported
       the SDK is not a false positive worth avoiding — there is no other
       `Anthropic` in this repo, and a file that shadowed the name to get past
       this would be doing so on purpose. */
    const re = new RegExp(`\\bnew\\s+${sdk.name}\\s*\\(`);
    if (re.test(code)) found.push({ file, what: `constructs ${sdk.name}` });
  }
  for (const e of ENDPOINTS) {
    if (code.includes(e)) found.push({ file, what: `names ${e}` });
  }
  for (const c of CREDENTIALS) {
    if (code.includes(c)) found.push({ file, what: `names ${c}` });
  }
  return found;
}

describe("no undeclared spend", () => {
  const declaredFiles = new Set(DECLARATIONS.map((d) => d.file));

  it("finds every file that can reach a paid provider", () => {
    const offenders: string[] = [];
    for (const file of trackedSources()) {
      /* Tests may name anything: a test that could not write `openrouter.ai`
         could not check that the seam sends there. They spend no money — the
         suite makes no network call, which tests/*.test.ts collectively prove
         by passing with no key configured. */
      if (file.startsWith("tests/")) continue;
      const caps = capabilitiesOf(file, readFileSync(path.join(ROOT, file), "utf8"));
      if (caps.length === 0) continue;
      if (ALLOWED[file] || declaredFiles.has(file)) continue;
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

  it("every declaration names a file that exists and really does bypass the seam", () => {
    for (const d of DECLARATIONS) {
      const source = readFileSync(path.join(ROOT, d.file), "utf8");
      /* A declaration for a file that no longer bypasses anything is worse than
         no declaration: it is a standing permission nobody needs, and the next
         person reads it as evidence that the bypass is necessary. */
      expect(
        capabilitiesOf(d.file, source).length,
        `${d.id} declares ${d.file}, which no longer reaches a provider directly. Delete the declaration.`,
      ).toBeGreaterThan(0);
    }
  });

  it("no declaration is a duplicate, and every one says why", () => {
    const ids = DECLARATIONS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const d of DECLARATIONS) expect(d.why.length).toBeGreaterThan(40);
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
    ];
    for (const [name, source] of cases) {
      it(name, () => {
        expect(capabilitiesOf("scratch.ts", source).length).toBeGreaterThan(0);
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
      expect(capabilitiesOf("scratch.ts", source)).toEqual([]);
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
 * See docs/plans/260828g-ai-spend-outside-the-gateway.md.
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
        { attribution: { scopeKind: "eval", ownerId: "00000000-0000-4000-8000-00000000d001" } },
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
        { attribution: { scopeKind: "eval", ownerId: "00000000-0000-4000-8000-00000000d001" } },
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

# The scoped diff

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
index f11af6b..1e6712a 100644
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
+     docs/plans/260828g-ai-spend-outside-the-gateway.md. Nothing about the request
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
@@ -254,4 +265,6 @@ async function main(): Promise<void> {
   console.log(`\nWritten to ${out}`);
 }
 
-void main();
+/* The ledger scope. Without it every call above warns "no spend collector open"
+   and leaves no row — see docs/plans/260828g-ai-spend-outside-the-gateway.md. */
+void withLedger("eval", main);
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
index 3f38e28..053f8a2 100644
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
@@ -222,6 +232,54 @@ async function reconcile(): Promise<void> {
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
+  console.log(`\nNot counted here — ${open.length} declared bypass(es) that do not yet write a row:`);
+  for (const d of open) console.log(`  ${d.file}  (${d.id})`);
+  console.log("  src/spend-declarations.ts says why each one is still open.");
+}
+
 async function main(): Promise<void> {
   loadEnvLocal();
   const args = parseArgs(process.argv.slice(2));
@@ -250,12 +308,29 @@ async function main(): Promise<void> {
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
+     open question Greg has not answered (260827q-ai-cost-tracking.md, question 4). */
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
@@ -284,11 +359,7 @@ async function main(): Promise<void> {
         "\n  A read that falls to zero is the cache silently switching off — docs/project/prompt-caching.md.",
     );
 
-  /* Said every time rather than only when it looks wrong. `evals/` calls models
-     outside the two gateways, so nothing it spends reaches this — and a report
-     that is silently partial is the failure this whole ledger is arranged
-     against. docs/plans/260827q-ai-cost-tracking.md, question 4. */
-  console.log("\nNot counted here: anything evals/ spends — it does not go through the gateways.");
+  undeclared();
 
   if (args.reconcile) await reconcile();
   else console.log("\n(--reconcile asks OpenRouter what it thinks this key has spent.)");
diff --git a/src/ai-call.ts b/src/ai-call.ts
index 3f3e3d8..f1e1ba8 100644
--- a/src/ai-call.ts
+++ b/src/ai-call.ts
@@ -155,9 +155,17 @@ export const AI_JOB_ROUTE: Record<
     provider: { require_parameters: true, allow_fallbacks: false },
   },
   embeddings: { path: "/v1/embeddings", provider: {} },
-  /* **Pins nothing, on purpose.** An eval that pinned an upstream would be
-     measuring the pin as much as the model, and none of them wants that. */
-  eval: { path: "/v1/chat/completions", provider: {} },
+  /* **Forbids fallback, and that is not copied from `pdf` — it is the stronger
+     case.** An eval names a model and reports a number against that name; an
+     upstream substituted silently means the number belongs to a model the
+     write-up never mentions, which is worse than the eval failing. Same
+     reasoning for `require_parameters`: a provider that quietly drops a JSON
+     schema returns prose, and every eval here that asks for structure would
+     score it as the model having a bad day. */
+  eval: {
+    path: "/v1/chat/completions",
+    provider: { require_parameters: true, allow_fallbacks: false },
+  },
 };
 
 /**
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
index aac780b..e8fc1a2 100644
--- a/src/store/ai-calls-fs.ts
+++ b/src/store/ai-calls-fs.ts
@@ -98,7 +98,17 @@ function looksLikeRow(v: unknown): v is AiCallRow {
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
+    money(r.computedCostNanos) &&
     money(r.upstreamInferenceNanos)
   );
 }
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
index 14135c0..019eac4 100644
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
```

---

# Migration 0023 (already committed)

```sql
-- Say where a row's dollar figure came from, and which bill it lands on.
--
-- 0021 built this table on one true premise — every call goes through
-- OpenRouter, and OpenRouter tells us what it charged — and the premise is
-- still true of the *app*. It is not true of `evals/`, which spends real money
-- from a second live credential (`ANTHROPIC_API_KEY`) on calls that deliberately
-- do not use the gateway, because comparing transports is what those evals
-- measure. See docs/plans/260828g-ai-spend-outside-the-gateway.md.
--
-- Those calls can be priced — `ANTHROPIC_PRICES` in src/pricing.ts survived the
-- switch to OpenRouter's own number and is still checked against it — but the
-- figure is *our arithmetic*, not a settled charge, and it lands on an account
-- `npm run cost --reconcile` cannot read. Four columns rather than quietly
-- putting an estimate into `credits_used_nanos`, which means one specific thing.
--
-- Additive: no drops, no guard. Existing rows are all OpenRouter, and all of
-- them either carried a provider figure or carried nothing.
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "provider_account" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "cost_source" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "computed_cost_nanos" bigint;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "price_version" text;--> statement-breakpoint

-- Backfill from what the existing rows already prove about themselves: they
-- were written by a gateway that only talks to OpenRouter, and `provider` means
-- "OpenRouter answered at all" — a BYOK zero is an answer, not an absence, which
-- is why this tests for NULL rather than for a non-zero number.
UPDATE "spideryarn"."ai_calls"
   SET "provider_account" = 'openrouter',
       "cost_source" = CASE WHEN "credits_used_nanos" IS NULL THEN 'none' ELSE 'provider' END
 WHERE "provider_account" IS NULL;--> statement-breakpoint

-- `NOT NULL` and *no default*, deliberately. A default would make an INSERT that
-- forgot these columns succeed and be wrong, which is the failure this table
-- exists to prevent; without one it fails loudly at the one place that inserts
-- (src/store/ai-calls-pg.ts).
ALTER TABLE "spideryarn"."ai_calls" ALTER COLUMN "provider_account" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ALTER COLUMN "cost_source" SET NOT NULL;--> statement-breakpoint

-- Only three spellings each, and a typo in either is a row that silently drops
-- out of whichever half of the report filters on it.
ALTER TABLE "spideryarn"."ai_calls"
  ADD CONSTRAINT "ai_calls_provider_account_known"
  CHECK ("provider_account" IN ('openrouter', 'anthropic'));--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls"
  ADD CONSTRAINT "ai_calls_cost_source_known"
  CHECK ("cost_source" IN ('provider', 'computed', 'none'));--> statement-breakpoint

-- The two numbers are different claims and exactly one of them can be true of a
-- row: `credits_used_nanos` is what OpenRouter deducted, `computed_cost_nanos`
-- is what we worked out because nobody could be asked. A row carrying both would
-- invite a reader to pick, and a SUM over both would double-count.
ALTER TABLE "spideryarn"."ai_calls"
  ADD CONSTRAINT "ai_calls_one_cost_source"
  CHECK (
    ("cost_source" = 'provider'  AND "credits_used_nanos" IS NOT NULL AND "computed_cost_nanos" IS NULL)
 OR ("cost_source" = 'computed'  AND "credits_used_nanos" IS NULL     AND "computed_cost_nanos" IS NOT NULL)
 OR ("cost_source" = 'none'      AND "credits_used_nanos" IS NULL     AND "computed_cost_nanos" IS NULL)
  );--> statement-breakpoint

-- "What did the product cost, as opposed to the measuring of it" — the split the
-- report leads with, and the one Greg sets a price against.
CREATE INDEX IF NOT EXISTS "ai_calls_scope_started" ON "spideryarn"."ai_calls" ("scope_kind","started_at" DESC);
```

---

# `src/ai-spend.ts` (committed; the row and the collector)

```ts
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
  /** Which job made the call — `toc`, `chat`, `embeddings`, … */
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
```
