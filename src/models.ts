/**
 * **Which model each job uses.** One file, so changing it is one edit.
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
 * Then, 2026-08-26:
 *
 * > perhaps define constants for quick-model (GPT 5.6 Luna) and capable-model
 * > (Sonnet-latest), and then use your judgment about which tasks to use for
 * > which (default to capable-model for now).
 *
 * So there are now two tiers rather than one model. **Every task is on the
 * capable tier today** — see `TASK_TIER` below, which is where a task changes
 * tier and where the reasoning for each one is written down.
 *
 * ## The three literals
 *
 * | Constant | Reached through | The name |
 * |---|---|---|
 * | `CAPABLE_MODEL` | the Anthropic SDK — the pipeline stages | `claude-sonnet-5` |
 * | `CAPABLE_MODEL_OPENROUTER` | OpenRouter — the three request-path calls | `anthropic/claude-sonnet-5` |
 * | `QUICK_MODEL_OPENROUTER` | OpenRouter, and **only** OpenRouter | `openai/gpt-5.6-luna` |
 *
 * `claude-sonnet-5` is the current Sonnet, and that dateless string is the whole
 * id — a pinned model, not an alias for one. So there is no `-latest` to ask for
 * and nothing to append: a date suffix on the end of it is a model id that does
 * not exist. (The two OpenRouter slugs were checked against OpenRouter's live
 * model list on 2026-08-26; the Anthropic one against the current model table,
 * which is the only thing that can settle an Anthropic-SDK spelling — an
 * OpenRouter listing carries OpenRouter's slug and says nothing about it.)
 *
 * **Do not derive one spelling from the other.** It is tempting — add a prefix,
 * swap the dots for dashes — and it works for exactly the current pair. It did
 * not work for the pair before it: Anthropic wrote `claude-sonnet-4-5` and
 * OpenRouter wrote `anthropic/claude-sonnet-4.5`, dashes against a dot. A
 * derivation would have produced a model id that does not exist, and the failure
 * lands as an OpenRouter 400 at the moment a reader asks a question, which is
 * the worst place to discover a string-munging bug. Two literals cost one extra
 * line and cannot be wrong in a way that only shows up in production.
 *
 * ## Why the quick tier has no Anthropic-SDK spelling
 *
 * Not an omission. GPT-5.6 Luna cannot be reached through `messages.create` at
 * all, so the six pipeline stages — which talk to Anthropic directly — cannot
 * change tier by editing a table. Moving one of them to the quick tier means
 * moving it onto OpenRouter first, which is a rewrite of the call and not a
 * config change. The three request-path calls are already on OpenRouter, so for
 * those the table really is the whole switch.
 *
 * `TASK_TIER` therefore says something slightly different for the two groups: a
 * pipeline row records a decision, a request-path row also enacts it. A row that
 * only records one is a row that can quietly be wrong, so the six of them are
 * enforced at load instead — see the check under the table.
 *
 * ## What this is not, yet
 *
 * A model id is not the whole of what a tier decides. Effort, the completion
 * ceiling, the web-search cap and what gets replayed between turns all belong to
 * the same choice, and the list below says so. The honest shape for that is one
 * *call policy* per request-path task rather than one string — but there is one
 * policy in existence today, and a second tier nobody has switched to. A policy
 * object built now would be a guess at the shape of a change that has not
 * happened. `modelForOpenRouter` is where it grows from when it does.
 *
 * ## Two things that have to move with the model, and one that does not
 *
 * **The provider pin.** All three OpenRouter calls send
 * `provider: { order: ["anthropic"] }` (`PROVIDER_ORDER` in
 * src/openrouter-stream.ts) so repeat calls land on the upstream that holds the
 * cache. Pointed at an OpenAI model that preference is simply wrong, and because
 * it is an ordered preference rather than `allow_fallbacks: false` it is wrong
 * *quietly*: OpenRouter finds no Anthropic upstream, falls through to the real
 * one, and answers. Nothing raises. It has to become a function of the model id.
 *
 * **The cache breakpoint.** `cache_control` is Anthropic's mechanism, and
 * src/article-prompt.ts places one explicitly. OpenAI models cache a repeated
 * prefix automatically instead, so the breakpoint is expected to be ignored
 * rather than to break — **expected, not measured here.** Anything that moves a
 * request-path task to the quick tier should check
 * `usage.prompt_tokens_details.cached_tokens` — the normalised OpenRouter field
 * this app already reads, not Anthropic's `cache_read_input_tokens` — before and
 * after, because a cache that stops working returns exactly the right answer and
 * only costs more; see docs/project/prompt-caching.md.
 *
 * **The completion ceilings, and this is the one that would bite first.**
 * explain sends `max_tokens: 1500`, chat 2,000, search 4,000, and those were
 * sized for a model whose thinking is not billed against them the same way.
 * Luna reasons by default and OpenRouter documents a 1,024-token floor for that
 * allocation, so explain could be left with a few hundred tokens of visible
 * answer. And all three treat `finish_reason` only as evidence that *something*
 * arrived — `length` is not an error anywhere — so the failure is a truncated
 * answer written to disk as a finished one. Raise the ceilings before flipping a
 * row, not after. (Luna also advertises `max_completion_tokens` rather than the
 * deprecated `max_tokens` all three send; OpenRouter lets a provider ignore a
 * parameter it does not take, silently.)
 *
 * **`max_uses` on the web-search tool.** explain and chat cap searches with
 * `parameters: { max_uses: … }`, and OpenRouter says outright that native
 * providers other than Anthropic ignore it. The cap those comments describe
 * would stop existing. `max_tool_calls` is the model-neutral form.
 *
 * **The reasoning trace between chat turns.** chat stores and resends assistant
 * *text*; OpenRouter's guidance for these models is to carry `reasoning_details`
 * back too, and src/openrouter-stream.ts does not keep the field. Nothing breaks
 * — the answers just quietly get worse over a long conversation.
 *
 * Most of that was found by a GPT-5.6-sol review of this change, 2026-08-26.
 * **None of it is fixed here**, because nothing is on the quick tier and fixing
 * it now would be five changes justified by a switch nobody has made — each one
 * shaped by a guess at how the switch would go. It is written down so the switch
 * is not the moment somebody discovers them.
 *
 * The pipeline half of the table does not get that treatment, because its
 * failure is different in kind: not a setting that suits the other model, but a
 * row that cannot do anything at all. That one is enforced — see the check under
 * the table.
 *
 * **What does not move: `STAGE_EFFORT`.** Its values are the Anthropic effort
 * ladder for the three article-reading stages, all of which are on the capable
 * tier and staying there.
 *
 * ## Two ways this is quietly not what you think
 *
 * **Changing `CAPABLE_MODEL` marks stored artefacts stale.** Every pipeline
 * stage records the model that wrote its file, and src/tweets.ts § `isFresh`
 * compares that stored `generator` against this constant: a thread written by a
 * different model is treated as out of date. So editing this line marks every
 * article's tweet thread stale, and the metadata page will say so. That is the
 * intended behaviour — a thread written by a different model *is* a different
 * thread — but it is a change to what readers see, from a line that looks like
 * pure configuration. Renaming the constant, as 2026-08-26 did, changes no
 * stored string and marks nothing stale.
 *
 * **The environment still wins.** Each call site keeps its own
 * `SPIDERYARN_*_MODEL` override, so a one-off comparison run does not need a
 * code change. This file is the default, not the authority.
 */

/**
 * **The capable tier, in the Anthropic SDK's spelling** — the pipeline stages
 * (src/toc.ts, src/labels.ts, src/arc.ts, src/tweets.ts, src/glossary.ts,
 * src/summarise.ts) pass this straight to `messages.create`.
 *
 * They all ask for `thinking: { type: "adaptive" }`, which is the only on-mode
 * Sonnet 5 accepts, so moving down from Opus needed no other change. The
 * parameter that *would* have broken is `budget_tokens`, which Sonnet 5 rejects
 * with a 400 — this app has never used it.
 */
export const CAPABLE_MODEL = "claude-sonnet-5";

/**
 * **The capable tier, in OpenRouter's spelling** — the three calls that happen
 * while a reader waits (src/explain.ts, src/converse.ts, src/search.ts).
 *
 * OpenRouter, not the Anthropic SDK, because `OPENROUTER_API_KEY` is the key
 * this project's `.env.local` carries and because two of those three want the
 * `openrouter:web_search` server tool. See docs/project/setup-dev.md § Secrets.
 */
export const CAPABLE_MODEL_OPENROUTER = "anthropic/claude-sonnet-5";

/**
 * **The quick tier.** OpenRouter only — there is deliberately no Anthropic-SDK
 * spelling of this one, because there cannot be; see the header.
 *
 * $0.20 in / $1.20 out per million tokens against Sonnet 5's $2.00 / $10.00, so
 * roughly a tenth the price, with a 1.05M context window and `reasoning_effort`
 * and structured outputs both supported. What it does not take is `stop` or
 * `verbosity`, neither of which this app sends.
 *
 * **Nothing here has been measured against it.** The price is a reason to try a
 * task on it, not a reason to move one; the way to move one is an eval under
 * evals/ that says what was gained and what was lost, in the shape of
 * evals/results/effort-vs-quality.md.
 */
export const QUICK_MODEL_OPENROUTER = "openai/gpt-5.6-luna";

/** The two tiers a task can be on. */
export type Tier = "capable" | "quick";

/** Every job in this app that calls a model. */
export type Task =
  | "toc"
  | "labels"
  | "arc"
  | "tweets"
  | "glossary"
  | "summarise"
  | "explain"
  | "chat"
  | "search";

/**
 * **Which tier each task is on — and the file's actual decision, rather than its
 * constants, which are only the vocabulary for it.**
 *
 * Everything is `capable`, which is what Greg asked for ("default to
 * capable-model for now") and is also the honest state: no task here has been
 * measured on the quick tier, and a tier is not a preference to be guessed at
 * per task, it is a trade to be checked.
 *
 * **Flipping a row is not the whole of switching a task** — read the header's
 * list of what has to move with the model first. For the six pipeline tasks it
 * is not even the start of one, and the check below the table says so out loud
 * rather than letting the edit look like it worked.
 *
 * Where the judgment would go if the numbers existed, worth writing down now so
 * the next person starts from a shortlist rather than the whole list:
 *
 * - **`search`** is the best candidate. It reads an article and returns a JSON
 *   list of block ids with confidences — nothing it writes is prose a reader
 *   reads, so a weaker model shows up as worse *picks*, which
 *   evals/ can measure directly, rather than as flatter writing, which it
 *   cannot. It is also the one a reader waits on with nothing on screen.
 * - **`labels`** is the biggest bill in the app by a distance — one gist per
 *   gistable block, every article — so it is where the tenth-of-the-price would
 *   actually be felt. It is also the core of the product: the gist columns *are*
 *   granularity zoom. Cheapest to move, most expensive to get wrong.
 * - **`explain`, `chat`, `arc`, `tweets`, `glossary`, `summarise`, `toc`** all
 *   write something a person reads, or decide the shape of the whole article.
 *   These are the last places to economise, not the first.
 */
export const TASK_TIER: Record<Task, Tier> = {
  toc: "capable",
  labels: "capable",
  arc: "capable",
  tweets: "capable",
  glossary: "capable",
  summarise: "capable",
  explain: "capable",
  chat: "capable",
  search: "capable",
};

/**
 * The OpenRouter model id for a task, from its tier.
 *
 * Only the three request-path tasks (`explain`, `chat`, `search`) go through
 * this; the pipeline stages use `CAPABLE_MODEL` directly, because the Anthropic
 * SDK is the only thing they talk to. Asking for a pipeline task here is not an
 * error — the answer is a real model id — but it is not how any stage runs.
 */
export function modelForOpenRouter(task: Task): string {
  return TASK_TIER[task] === "quick" ? QUICK_MODEL_OPENROUTER : CAPABLE_MODEL_OPENROUTER;
}

/** The six tasks that reach a model through the Anthropic SDK rather than OpenRouter. */
const PIPELINE_TASKS: readonly Task[] = ["toc", "labels", "arc", "tweets", "glossary", "summarise"];

/*
 * **Six of those rows would otherwise be a lie, and this is what stops them.**
 *
 * A pipeline stage imports `CAPABLE_MODEL` and hands it to `messages.create`. It
 * never reads `TASK_TIER`. So writing `arc: "quick"` in a table that presents
 * all nine jobs identically would change nothing at all: no error, no warning,
 * arc still on Sonnet, and a config file confidently saying otherwise. That is
 * docs/reusable/silent-success.md with the config file playing the part of the
 * check — the file you would go and read to confirm it worked is the file that
 * is wrong.
 *
 * Prose in the docblock above is not enough, because the person who flips the
 * row is exactly the person who did not read it. So the row is enforced instead:
 * set a pipeline task to `quick` and the app refuses to load, with the reason.
 *
 * At module load, deliberately. This is a config file, the values are literals
 * in this repo, and the only person who can trip it is someone who just edited
 * the line above — so the earliest possible failure is the kindest one. It
 * cannot fire on a reader's request, because there is nothing here for a request
 * to vary.
 */
for (const task of PIPELINE_TASKS) {
  if (TASK_TIER[task] === "quick") {
    throw new Error(
      `src/models.ts: task "${task}" is set to the quick tier, but it runs through the ` +
        `Anthropic SDK and ${QUICK_MODEL_OPENROUTER} is only reachable through OpenRouter. ` +
        `Move the stage onto OpenRouter first — the tier table cannot do it alone.`,
    );
  }
}

/** The reasoning levels `output_config.effort` accepts. */
export type Effort = "low" | "medium" | "high";

/** The three stages that read the whole article and could share one cached copy of it. */
export type ArticleStage = "arc" | "tweets" | "glossary";

/**
 * **How hard each article-reading stage thinks — and it lives here because it is
 * part of the cache key, exactly like `CAPABLE_MODEL` above.**
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
