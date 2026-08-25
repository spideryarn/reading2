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
