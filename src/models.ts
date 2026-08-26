/**
 * **Which model this app uses.** One file, so changing it is one edit.
 *
 * Greg, 2026-08-25:
 *
 * > update all our in-app model calls to use Sonnet. Ideally there should be a
 * > single config file that has this as a constant, so we can easily change it
 * > later.
 *
 * Before this, four files each declared `const MODEL = "claude-opus-5"` at the
 * top — src/toc.ts, src/arc.ts, src/tweets.ts and src/explain.ts — and the
 * fourth of them spelled it differently from the other three. Changing the
 * model meant finding all four and knowing which spelling each wanted.
 *
 * ## Why there are two constants and not one
 *
 * The same model has two names, because this app talks to it two ways:
 *
 * | | Who uses it | The name |
 * |---|---|---|
 * | `MODEL` | the pipeline stages, through the Anthropic SDK | `claude-sonnet-5` |
 * | `OPENROUTER_MODEL` | the two request-path calls, through OpenRouter | `anthropic/claude-sonnet-5` |
 *
 * **Do not derive one from the other.** It is tempting — add a prefix, swap the
 * dots for dashes — and it works for exactly the current pair. It did not work
 * for the pair before it: Anthropic wrote `claude-sonnet-4-5` and OpenRouter
 * wrote `anthropic/claude-sonnet-4.5`, dashes against a dot. A derivation would
 * have produced a model id that does not exist, and the failure lands as an
 * OpenRouter 400 at the moment a reader asks a question, which is the worst
 * place to discover a string-munging bug. Two literals cost one extra line and
 * cannot be wrong in a way that only shows up in production.
 *
 * Both were verified against OpenRouter's live model list on 2026-08-25.
 *
 * ## Two ways this is quietly not what you think
 *
 * **Changing `MODEL` marks stored artefacts stale.** Every pipeline stage
 * records the model that wrote its file, and src/tweets.ts § `isFresh` compares
 * that stored `generator` against this constant: a thread written by a
 * different model is treated as out of date. So editing this line marks every
 * article's tweet thread stale, and the metadata page will say so. That is the
 * intended behaviour — a thread written by a different model *is* a different
 * thread — but it is a change to what readers see, from a line that looks like
 * pure configuration.
 *
 * **The environment still wins.** Each call site keeps its own
 * `SPIDERYARN_*_MODEL` override, so a one-off comparison run does not need a
 * code change. This file is the default, not the authority.
 */

/**
 * The Anthropic SDK's spelling — the pipeline stages (src/toc.ts, src/arc.ts,
 * src/tweets.ts) pass this straight to `messages.create`.
 *
 * All three ask for `thinking: { type: "adaptive" }`, which is the only on-mode
 * Sonnet 5 accepts, so moving down from Opus needed no other change. The
 * parameter that *would* have broken is `budget_tokens`, which Sonnet 5 rejects
 * with a 400 — this app has never used it.
 */
export const MODEL = "claude-sonnet-5";

/**
 * OpenRouter's spelling — the two calls that happen while a reader waits
 * (src/explain.ts, src/chat.ts).
 *
 * OpenRouter, not the Anthropic SDK, because `OPENROUTER_API_KEY` is the key
 * this project's `.env.local` carries and because these two calls want the
 * `openrouter:web_search` server tool. See docs/project/setup-dev.md § Secrets.
 */
export const OPENROUTER_MODEL = "anthropic/claude-sonnet-5";

/** The reasoning levels `output_config.effort` accepts. */
export type Effort = "low" | "medium" | "high";

/** The three stages that read the whole article and could share one cached copy of it. */
export type ArticleStage = "arc" | "tweets" | "glossary";

/**
 * **How hard each article-reading stage thinks — and it lives here because it is
 * part of the cache key, exactly like `MODEL` above.**
 *
 * That is not obvious and it cost us. `arc`, `tweets` and `glossary` were made
 * to emit a byte-identical article so they could share one cached prefix, and
 * they still could not, because arc and tweets asked for `high` and glossary for
 * `medium`. Two stages can agree on every byte of a 47,000-token prompt and miss
 * anyway, over a number that is not in the prompt and says nothing about the
 * article.
 *
 * It was measured rather than argued: four calls, one identical 7,291-token
 * cached block, only `effort` varying — changing it paid a full write, changing
 * back read the original, and the two prefixes then coexisted. See
 * docs/research/prompt-caching-anthropic.md, which also corrects that doc's
 * earlier claim that generation parameters stay out of the key. `temperature`
 * and `max_tokens` do; this one does not, and nothing about "it's a generation
 * parameter" would have told you which.
 *
 * **So this table is also the cache grouping**: two stages share a cached
 * article if and only if they share a value here. src/pipeline.ts reads it that
 * way rather than keeping a second list that could disagree.
 *
 * **The values are not aligned, on purpose.** Aligning them would let all three
 * share, and it was tested on two articles rather than assumed: arc at `medium`
 * loses 11 points of vocabulary retention on one of them, and glossary at `high`
 * gets measurably more formulaic on the other while spending 4,558 more output
 * tokens. Neither trade is worth making to win a cache, so each stage keeps the
 * setting its writing wants and glossary is simply a second cache. The numbers
 * are in evals/results/effort-vs-quality.md.
 *
 * **The environment still wins**, like the models above:
 * `SPIDERYARN_PIPELINE_EFFORT=medium npm run arc -- data/<slug>` overrides all
 * three at once, which is how that comparison was run.
 */
export const STAGE_EFFORT: Record<ArticleStage, Effort> = {
  arc: "high",
  tweets: "high",
  glossary: "medium",
};

/** One stage's effort, with the whole-run environment override applied. */
export function effortFor(stage: ArticleStage): Effort {
  return (process.env.SPIDERYARN_PIPELINE_EFFORT as Effort | undefined) ?? STAGE_EFFORT[stage];
}
