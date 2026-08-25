# LLM plumbing — everything between "we want a generation" and "we know what it cost"

The layer we are most likely to rebuild something like, and the one where their choices split
cleanly into good, unnecessary, and actively wrong.

Reference docs: `docs/reference/LLM_PROMPT_TEMPLATES.md`, `NUNJUCKS_USAGE.md`,
`LLM_MODEL_CONFIGURATION.md`, `LLM_TRACKING_TOKEN_USAGE_LOGGING.md`, `AI_RESPONSE_LOGGING.md`,
`VERCEL_AI_SDK_REFERENCE.md`. Code: `lib/prompts/types.ts`, `lib/services/llm-provider.ts`,
`lib/config/models.ts`.

Caching gets its own page — [prompt-caching.md](prompt-caching.md) — because we intend to build it.

> Before writing any of this here, load the `claude-api` skill for current model ids and parameters.
> Their model ids are 2025-era and stale; nothing on this page should be copied as a current
> recommendation.

## Good: prompts as files, with a validated input type

Each prompt is a pair — a `.njk` template holding the words, and a sibling `.ts` holding a Zod
schema for its inputs. `executePrompt()` / `executePromptWithUsage()` in `lib/prompts/types.ts`
validates the inputs, renders the template, and makes the call.

A whole prompt module is two files and about three lines of glue:

```ts
// foo.ts
const fooSchema = z.object({ content: z.string().min(1) })
export const fooPrompt = loadPromptTemplateFromCaller('foo.njk', fooSchema, { maxTokens: 1024 })

// at the call site
const result = await executePromptWithUsage(fooPrompt, { content: documentText })
// → { text, usage: {promptTokens, completionTokens, totalTokens, reasoningTokens?},
//     finishReason, rawResponse }
```

Internally it validates the variables against the Zod schema, renders the template, resolves the
model, and calls `generateText`. That is the entire call path.

The value is not the templating engine. It is the **separation**: prompt wording lives in a file you
can read, diff and iterate on without touching TypeScript, and its inputs have a type so a missing
variable is an error rather than the string `undefined` appearing mid-prompt.

**One line of their config is worth copying on its own:** Nunjucks is configured with
`throwOnUndefined: true`. Without it, a renamed variable renders as empty string and the model
receives a prompt with a hole in it — which produces a plausible answer to the wrong question, and
nothing anywhere reports a problem. That is [silent success](../../reusable/silent-success.md) in
one config flag. Whatever we use for templating, a missing value must throw.

Two entry points per template: `executePrompt()` for text only, and `executePromptWithUsage()` when
the usage numbers are wanted for logging. Same pair again for multimodal inputs.

**Worth rebuilding, lighter.** Nunjucks is far more machinery than our prompts need. A template
literal in a dedicated module, with a typed argument object, gets the same two benefits and no
dependency. What we should copy exactly is the *discipline*: one module per prompt, its inputs
typed, and the words kept where a person can read them all at once. Our
[`src/toc.ts`](../../../src/toc.ts) and [`src/arc.ts`](../../../src/arc.ts) already lean this way;
[table-of-contents.md § The generation prompt](../table-of-contents.md#the-generation-prompt) keeps
the reasoning in the doc, which is better still.

**Their XML delimiter house style is worth keeping** — the article wrapped in a named tag, always.
It helps the model, and it is a precondition for caching a shared prefix.

But note that they did **not** actually keep it consistently: `summarise.njk` wraps the article in
`<text>`, `multi-summarise.njk` in `<document>`, `headings.njk` in `<html_content>`. Three tools,
three tags, one article — and that inconsistency is precisely what blocked their caching work
([prompt-caching.md § The prerequisite that killed it](prompt-caching.md#the-prerequisite-that-killed-it)).
Pick one tag here and use it everywhere, now, while there are five prompts.

## Good enough: model tiers

Models are named `provider:model:version[:thinking]` with tier aliases — `anthropic-cheap`,
`google-balanced` — resolved by `getModelForAICall()` and set by environment variable, so no call
site hardcodes a model.

The indirection is right and it is cheap: **a tier map, so the model is chosen in one place.** That
much is worth having here, and it pairs with the standing instruction to load the `claude-api` skill
rather than typing a model id from memory.

The multi-provider abstraction on top of it is not. They implemented OpenAI and never configured a
single model for it — dead code, carried for a year. Add a second provider the day there is a second
provider.

Note also that this design was itself a **rebuild**: it replaced an earlier scheme that looked up
models by UUID in the database, which was worse. Two goes to arrive at "a string in a map".

## Structured output: hand-rolled, and fragile

`grep -r "generateObject\|streamObject"` across their whole codebase returns **zero hits**, despite
the AI SDK providing exactly that. Instead every structured tool:

1. describes the JSON shape in the prompt,
2. gets plain text back from `generateText`,
3. strips ```` ```json ```` fences with a regex,
4. `JSON.parse()`s it,
5. validates with Zod — **after** generation, as a check rather than as a constraint.

And on failure, nothing. No retry, no repair, no partial salvage; the call is marked failed and the
handler throws. See
[summaries.md § What went wrong](summaries.md#what-went-wrong-all-or-nothing) for what that costs
when one call is carrying nine results.

**What to do instead**, in order of preference: use the SDK's schema-constrained generation where
available; failing that, **retry once with the parse error fed back to the model** before giving up;
and always validate the *semantics* separately from the *shape*. We already do the last part —
[`validate-tree.ts`](../../../src/validate-tree.ts) checks the partition invariant, which no JSON
schema could express
([granularity-zoom.md § Validate the tree, always](../granularity-zoom.md#validate-the-tree-always)).

## Logging: right shape, wrong storage for us

Every call writes a row to a Postgres `ai_calls` table: token counts, cost (joined against a pricing
table), latency, a correlation id, and the raw SDK response as JSONB.

The database is overkill for a filesystem app with one user. **The field list is not** — that is
what makes "what does a tree cost" answerable, and it is [Q7](../open-questions.md#q7).

Their minimal load-bearing set, which is a good sidecar shape as-is:

```ts
interface AiCallMetrics {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  reasoningTokens?: number
  latencyMs: number
}
```

The full row also carries `model_string` (e.g. `anthropic:claude-…`), `prompt_type`,
`prompt_template`, `status` (`pending` | `success` | `failed`), `finish_reason`, `error_message`,
and the **entire unmodified SDK response** as JSON. That last one is worth keeping: when something
comes back wrong, the raw response is the only thing that can tell you why, and it is gone by the
time you think to look.

Add one field they didn't have and we will need: **cached-read tokens**
([prompt-caching.md](prompt-caching.md)). A cache that stops hitting is otherwise invisible.

### One real gotcha, worth stealing outright

`AI_RESPONSE_LOGGING.md` records:

> Field testing in production showed the SDK currently omits `startTimestamp`/`finishTimestamp` in
> all responses.

So they stopped trusting the SDK's own timing fields and stamped `Date.now()` around every call
themselves. That is a textbook [silent success](../../reusable/silent-success.md): a field that
looks like it should be populated, isn't, and reads as zero-latency rather than as missing data. Do
the same — time the call yourself, from the outside.

## Error handling: don't copy this

Errors are categorised by string-matching the message — `error.message.includes('rate limit')`,
`.includes('401')`. It is the only error handling in evidence: no typed exceptions, no backoff for
model calls, no chunking strategy for long inputs.

String-matching a human-readable message is the same mistake as the tool framework's
`action.includes('ai')` ([tool-framework.md](tool-framework.md)): behaviour inferred from prose
nobody promised to keep stable, failing silently on the day it changes. Use the SDK's typed error
classes.

## Timeouts, and the numbers that exist

Their tiers (`lib/config.ts`):

```ts
export const TOOL_TIMEOUTS = {
  DEFAULT:  30_000,   // generic operations
  AI:       60_000,   // LLM-heavy operations
  ANALYSIS: 300_000,  // expensive analyses
  UPLOAD:   300_000,  // large file uploads / processing
}
```

Five minutes is also the platform's serverless ceiling, so `ANALYSIS` isn't a choice so much as the
wall. Timeouts return a 504 with `retryable: true` in the body — a good detail: the error says
whether trying again is worth it, rather than leaving the caller to guess.

**Two tiers is the right number for us too**, and our situation is easier: generation happens in a
CLI stage with no HTTP request waiting on it, so the only real deadline is the one on
[comments](../comments.md), where a reader is watching.

**On measured numbers: there are none.** No p50, no p95, no cost per document anywhere in that repo
— only pricing tables and estimates. The Grafana panels and latency SQL in their logging doc sit
under "Future Work". A year of production and the question "what does this cost us" was still
unanswerable, because the logging existed and nobody ever aggregated it.

That is the trap to avoid on [Q7](../open-questions.md#q7): logging the numbers is not the same as
knowing them. Print a total at the end of `npm run toc`.

## Streaming

Only non-streaming `generateText` for document analysis, which is correct — this is batch work done
ahead of time, and there is no reader waiting on it. Streaming was discussed only for chat.

Our pipeline is the same: generation happens in `npm run toc` / `npm run arc`, not while someone
reads. The one place it doesn't hold is [comments](../comments.md), where a reader *is* waiting —
and that is the one place streaming would be worth having.

## See also

- [overview.md](overview.md) — the map to that codebase
- [prompt-caching.md](prompt-caching.md) — the piece they designed and never built, and the one we should
- [summaries.md](summaries.md) — batching many results into one call, and its failure mode
- [tool-framework.md](tool-framework.md) — the layer above this, and why we're not building it
- [../open-questions.md#q7](../open-questions.md#q7) — which model, and what a tree costs
