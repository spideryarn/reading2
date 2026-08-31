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
    /* **The only `account: "anthropic"` entry in the table, and the only reason
       `ANTHROPIC_API_KEY` exists in this project at all.** Since 2026-08-31 that
       is pinned rather than merely true — `tests/no-undeclared-spend.test.ts`
       fails if a second one appears, because the whole app is on OpenRouter
       (docs/project/ai-gateway.md) and a second Anthropic-direct caller would be
       a second bill nobody is watching.

       The key is not in `.env.local` by default. Only this bake-off's four
       `transport: "anthropic"` arms need it, and the file skips them with a
       message rather than failing when it is absent. */
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
    /* **`openrouter` since 2026-08-31**, when the judge moved off
       `api.anthropic.com` onto the Skin. It was `anthropic` because the bypass
       was written the same week the pipeline migrated and the judge was left
       where it was; nothing about the judge needed a second vendor. The bypass
       itself did not go away — the reason below is unchanged — but the account
       did, which is why this row now takes a settled `cost` from OpenRouter
       instead of our arithmetic over `ANTHROPIC_PRICES`. */
    account: "openrouter",
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
  {
    id: "toc-structure-messages",
    kind: "bypass",
    since: "2026-08-30",
    account: "openrouter",
    file: "evals/toc-structure/model-arms.ts",
    job: "eval",
    wire: "messages",
    metered: true,
    why: "The structure eval's arms vary model and effort per call, and `streamMessage` owns both on purpose — `modelFor(task)` is applied after the spread precisely so a stage cannot quietly switch models, and src/toc.ts pins its effort. The prompt itself is shared (`structureRequest` in src/toc.ts, parity-pinned by tests/toc-structure-request-parity.test.ts); only the transport differs.",
  },
  {
    id: "toc-structure-chat",
    kind: "bypass",
    since: "2026-08-30",
    account: "openrouter",
    file: "evals/toc-structure/model-arms.ts",
    job: "eval",
    wire: "chat",
    metered: true,
    why: "The cheap arm's model (the quick tier) is served only on chat/completions, and the seam for that wire (`openRouterJson`) owns the per-job provider policy — this eval's arms deliberately differ from the app's policy and from each other, which is the same reason the PDF bake-off's OpenRouter arm is a declared bypass.",
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

