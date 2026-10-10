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
 * top — src/structure.ts, src/arc.ts, src/tweets.ts and src/explain.ts — and the
 * fourth of them spelled it differently from the other three. Changing the
 * model meant finding all four and knowing which spelling each wanted.
 *
 * Then, 2026-08-26:
 *
 * > perhaps define constants for quick-model (GPT 5.6 Luna) and capable-model
 * > (Sonnet-latest), and then use your judgment about which tasks to use for
 * > which (default to capable-model for now).
 *
 * So there are now two tiers rather than one model. **Three tasks are on the
 * quick tier**: `link-summary`, `quiz-verdict`, and `simple-check`. Each was
 * written and measured for that tier rather than moved onto it. See `TASK_TIER`
 * below, which is where a task changes tier and where the reasoning for each
 * one is written down.
 *
 * ## The three literals
 *
 * | Constant | Reached through | The name |
 * |---|---|---|
 * | `CAPABLE_MODEL` | Anthropic's own spelling — sent by nothing, kept for reference | `claude-sonnet-5-5` |
 * | `CAPABLE_MODEL_OPENROUTER` | OpenRouter — the three request-path calls | `anthropic/claude-sonnet-5.5` |
 * | `QUICK_MODEL_OPENROUTER` | OpenRouter, and **only** OpenRouter | `openai/gpt-6-luna` |
 *
 * `claude-sonnet-5-5` is the current Sonnet, and that dateless string is the whole
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
 * ## And a third spelling, which is the one a person reads
 *
 * The two above are addresses. Neither is the model's *name*, and on 2026-08-27
 * `/profile` proved the difference by printing ten rows of raw wire id: seven
 * saying `claude-sonnet-5` and three saying `anthropic/claude-sonnet-5`, every
 * string correct and the page as a whole misleading, because a reader counting
 * names counts two models. So there is now a `DISPLAY_NAME` table and a
 * `displayName()` beside it — a table rather than a `split("/")`, for the same
 * reason the paragraph above gives, and the reason is not hypothetical: the
 * previous pair would have stripped to `claude-sonnet-4.5` against Anthropic's
 * `claude-sonnet-4-5` and gone on disagreeing while looking mended.
 *
 * The rule that falls out of it: **a wire id is what we send, a display name is
 * what we show, and no caller should choose between the two itself.**
 * `modelFor(task)` gives the first, `displayName(id)` (owned by the client-safe
 * `model-names.ts`) the second, and `wireFor(task)` says which protocol a task
 * speaks — which is what stopped src/routes.ts keeping its own copy of the
 * request-path list.
 *
 * ## Why the quick tier has no Anthropic-SDK spelling
 *
 * Not an omission. GPT-5.6 Luna cannot be reached through `messages.create` at
 * all, so the seven pipeline stages — which talk to Anthropic directly — cannot
 * change tier by editing a table. Moving one of them to the quick tier means
 * moving it onto OpenRouter first, which is a rewrite of the call and not a
 * config change. The three request-path calls are already on OpenRouter, so for
 * those the table really is the whole switch.
 *
 * `TASK_TIER` therefore says something slightly different for the two groups: a
 * pipeline row records a decision, a request-path row also enacts it. A row that
 * only records one is a row that can quietly be wrong, so the seven of them are
 * enforced at load instead — see the check under the table.
 *
 * ## What this is not, yet
 *
 * A model id is not the whole of what a tier decides. Effort, the completion
 * ceiling, the web-search cap and what gets replayed between turns all belong to
 * the same choice, and the list below says so. The honest shape for that is one
 * *call policy* per request-path task rather than one string — and since
 * 2026-09-05 there is a second tier with exactly one task on it, which carries
 * its own ceiling and its own effort at its call site (src/link-summary.ts)
 * rather than in a table here. One task is not yet a shape; a policy object
 * built from it would still be a guess. `modelForOpenRouter` is where it grows
 * from when there are two.
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
 * On the standard model explain sends `max_tokens: 1500`, chat 4,000 and search
 * 9,750. Explain sends 4,000 and chat 6,000 on the high-power model since plan
 * 261009h (`chatCeiling` in src/converse.ts and the `max_tokens` line in
 * src/explain.ts). The original figures were sized for a model whose thinking
 * is not billed against them the same way.
 * Luna reasons by default and OpenRouter documents a 1,024-token floor for that
 * allocation, so explain could be left with a few hundred tokens of visible
 * answer. Explain and search can still store a `length` ending as finished;
 * chat marks it `truncated` and persists that warning. Size the ceilings before
 * flipping a row, not after. (Luna also advertises `max_completion_tokens` rather than the
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
 * **None of it is fixed here**, and that is still right: the list is about the
 * three Anthropic-bound request-path calls, and moving one of *those* remains a
 * switch nobody has made. `link-summary` did not move — it was born on the quick
 * tier — so rather than fixing these it answers them one at a time at its own
 * call site: its own ceiling, spelled `max_completion_tokens`; no provider pin
 * on its route; no `cache_control`; no web-search tool. The list stays here so
 * the switch is not the moment somebody discovers them, and so the next task to
 * move has a worked example.
 *
 * The pipeline half of the table does not get that treatment, because its
 * failure is different in kind: not a setting that suits the other model, but a
 * row that cannot do anything at all. That one is enforced — see the check under
 * the table.
 *
 * **What does not move: `STAGE_EFFORT`.** Its values are the Anthropic effort
 * ladder for the four article-reading stages, all of which are on the capable
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
 * **The environment still wins, and this file now knows which variable.** A
 * `SPIDERYARN_*_MODEL` override is still the way to run a one-off comparison
 * without a code change — but the override used to be read at the three call
 * sites and nowhere else, so `/api/models` could report a model the process was
 * not using while promising the reader it showed "what the server is configured
 * with". `MODEL_ENV_VAR` and `resolveModel` below are the one place that
 * question is answered now, for the callers and the report alike.
 */

/* The one import in this file, and it is here so that the display-name table
   can claim to hold every model this app sends without repeating anybody's
   literal. src/embeddings.ts owns that decision; this file only needs the
   string. */
import { EMBEDDING_MODEL } from "./embeddings.js";
import {
  HIGH_POWER_MODEL,
  HIGH_POWER_MODEL_OPENROUTER,
  isHighPowerModel,
} from "./high-power-model.js";

/**
 * **The capable tier, in the Anthropic SDK's spelling** — the pipeline stages
 * (src/structure.ts, src/labels.ts, src/arc.ts, src/tweets.ts, src/glossary.ts,
 * src/glossary.ts) pass this straight to `messages.create`.
 *
 * They all ask for `thinking: { type: "adaptive" }`, which is the only on-mode
 * Sonnet 5 accepts, so moving down from Opus needed no other change. The
 * parameter that *would* have broken is `budget_tokens`, which Sonnet 5 rejects
 * with a 400 — this app has never used it.
 */
export const CAPABLE_MODEL = "claude-sonnet-5-5";
/* ^ Sonnet 5 until 2026-10-09 (plan 261009a: always the latest of each family).
   Sonnet 5.5 is the same price and rejects what Opus 5.5 rejects — disabled
   thinking, sampling parameters, a forced `tool_choice` — none of which the
   capable tier sends, which is why High-powered AI already ran every capable
   task on Opus 5.5 through these same seams. Sonnet 5's two spellings stay
   in `generationKey` below, so nothing it wrote reads as stale. */
/* ^ **Nothing puts this on the wire any more — and it is still load-bearing.**
   Since 2026-08-27 the seven stages send `CAPABLE_MODEL_OPENROUTER`, which is
   literally this string with a vendor prefix. But this one stayed, because the
   two spellings answer different questions and only one of them moved.

   On the wire, a model id is an **address**: it has to say which gateway, so it
   carries `anthropic/`. In a stored artefact's `generator` field it is a
   **name**: it says which model wrote this, and that is what every staleness
   check compares against — `glossary.ts` and `tweets.ts` each
   have a `generator !== CAPABLE_MODEL` line that marks work stale and pays to
   redo it.

   Changing the *address* did not change the *model*, so the name must not move
   with it. Had the stamps been switched to the prefixed spelling in the same
   change, every article in the corpus would have gone stale at once and
   regenerated at full price — a large bill, for a migration whose entire purpose
   was to see the bill. Same reasoning as § the third spelling in
   docs/project/setup-dev.md: a provider prefix is an address, not a name. */

/**
 * **The capable tier, in OpenRouter's spelling** — the three calls that happen
 * while a reader waits (src/explain.ts, src/converse.ts, src/search.ts).
 *
 * OpenRouter, not the Anthropic SDK, because `OPENROUTER_API_KEY` is the key
 * this project's `.env.local` carries and because two of those three want the
 * `openrouter:web_search` server tool. See docs/project/setup-dev.md § Secrets.
 */
export const CAPABLE_MODEL_OPENROUTER = "anthropic/claude-sonnet-5.5";

/**
 * **The quick tier.** OpenRouter only — there is deliberately no Anthropic-SDK
 * spelling of this one, because there cannot be; see the header.
 *
 * $0.10 in / $0.50 out per million tokens (GPT-6 Luna; GPT-5.6 Luna until
 * 2026-10-09, at $0.20 / $1.20) against Sonnet 5.5's $2.00 / $10.00, so
 * roughly a twentieth the price, with a 1.05M context window and `reasoning_effort`
 * and structured outputs both supported. What it does not take is `stop` or
 * `verbosity`, neither of which this app sends.
 *
 * **Three jobs run on it, and no job has been *moved* to it.** `link-summary`,
 * `quiz-verdict`, and `simple-check` were each written for this tier. Their
 * evidence belongs to their own job: Simple's checker, for example, was
 * measured in plan 261001h. That is a reason to try another task on it and not
 * a reason to move one; moving one still needs an eval under `evals/` that says
 * what was gained and what was lost.
 */
export const QUICK_MODEL_OPENROUTER = "openai/gpt-6-luna";

/**
 * **The high-power model — the capable tier's stronger model.** Most tasks use
 * it when an article's owner has switched High-powered AI on; `powerFor` also
 * selects it for the few tasks deliberately run high on every article. Two
 * literals, like the capable tier's: the stored name (what a `generator` stamp
 * says) and the OpenRouter address (what goes on the wire). Not derived from
 * each other, for the reason § Do not derive one spelling from the other gives
 * — and this pair is the proof of it: dashes in the name, a dot in the slug.
 *
 * Opus 5.5, at $4 / $20 per million tokens against Sonnet 5's (and 5.5's) $2 / $10 —
 * exactly twice, which is what Greg asked for ("broadly double"). Checked for
 * request compatibility before it was chosen: it rejects `thinking: {type:
 * "disabled"}` and a forced `tool_choice`, and `src/` sends neither; and its
 * default effort is `medium` where Sonnet 5's is `high`, which is why the two
 * effort seams (`messagesWireBody`, and `outgoing` in src/ai-call.ts) send
 * `high` explicitly to it where a call would otherwise take the default.
 * docs/plans/260930f-high-powered-ai-per-article.md, decisions 1–2.
 *
 * The literals themselves sit in src/high-power-model.ts, a leaf, so the chat
 * wire's effort seam can ask `isHighPowerModel` without an import cycle.
 */
export { HIGH_POWER_MODEL, HIGH_POWER_MODEL_OPENROUTER, isHighPowerModel };

/**
 * **A choice between the two capable models.** `articlePower` returns `"high"`
 * only for an article whose `high_power_since` is set; `powerFor` may then
 * replace that article setting for a task with an explicit policy exception.
 *
 * **A required argument everywhere it is taken, never ambient state**
 * (decision 5): a call site that has not decided does not compile, where an
 * `AsyncLocalStorage` scope would have let a call outside it run Sonnet under a
 * switch that says Opus, silently.
 */
export type ModelPower = "standard" | "high";

/** The **name** a stage stamps into `generator` for the power it ran at. */
export function generatorFor(power: ModelPower): string {
  return power === "high" ? HIGH_POWER_MODEL : CAPABLE_MODEL;
}

/**
 * **The durable token inside stored citation fingerprints for this model
 * generation.** It is deliberately a literal rather than
 * `CAPABLE_MODEL_OPENROUTER`: the current capable model will change, while the
 * hashes already stored in Postgres cannot be passed back through
 * `generationKey`. Keeping the first generation's wire id preserves today's
 * hashes and lets a later capable-tier replacement join the same generation by
 * adding its spellings to `generationKey` without detaching those rows.
 */
export const CAPABLE_GENERATION_KEY = "anthropic/claude-sonnet-5";

/** Sonnet 5's two spellings, the capable model until 2026-10-09: one generation with its successor. */
const PREVIOUS_CAPABLE_MODEL = "claude-sonnet-5";
const PREVIOUS_CAPABLE_MODEL_OPENROUTER = "anthropic/claude-sonnet-5";

/**
 * **Which generation of work a model id belongs to, for freshness only.**
 *
 * The four spellings of the capable and high-power models — stored and wire,
 * standard and high — are one generation; every other id, an environment
 * override included, is its own. So switching an article's power in either
 * direction does not make what it already has look stale and pay to redo it
 * (Greg: *"a way to switch back again, though you wouldn't want to rerun
 * things"*), while a genuinely different model still does.
 *
 * **The canonical value is `CAPABLE_GENERATION_KEY` on purpose.** Two content
 * hashes put this key inside them (`lookupContextHash`, `investigateContextHash`)
 * and every stored row was hashed over that exact string, so choosing it keeps
 * every existing hash byte-identical. It must not follow the current capable
 * model constant: that constant will move, and an opaque stored hash cannot be
 * remapped afterwards. Equality is the only other thing anyone does with the
 * value.
 *
 * **Never a checkpoint key.** A checkpoint is reuse of a paid-for answer, and
 * reusing a Sonnet answer on an Opus run and calling it Opus is the lie this
 * must not tell — `labels.ts`'s `batchFingerprint` uses the real model.
 * Plan 260930f decisions 6–7.
 */
export function generationKey(modelId: string): string {
  switch (modelId) {
    case CAPABLE_MODEL:
    case CAPABLE_MODEL_OPENROUTER:
    /* Sonnet 5, the capable model until 2026-10-09. Its work is not stale
       for being Sonnet 5's: re-billing the corpus to rewrite it on the next
       Sonnet would be the "large bill" the header warns about (plan 261009a). */
    case PREVIOUS_CAPABLE_MODEL:
    case PREVIOUS_CAPABLE_MODEL_OPENROUTER:
    case HIGH_POWER_MODEL:
    case HIGH_POWER_MODEL_OPENROUTER:
      return CAPABLE_GENERATION_KEY;
    default:
      return modelId;
  }
}

/** Were `a` and `b` written by the same generation? `generationKey` says what that means. */
export function sameGenerator(a: string, b: string): boolean {
  return generationKey(a) === generationKey(b);
}

/**
 * **The power selected by an article's own switch**: high exactly when its
 * `high_power_since` is set. A task's effective power may differ; `powerFor`
 * applies those explicit exceptions.
 *
 * Until 2026-09-30 this also required the owner to be an administrator, because
 * only an administrator could set the column and nothing charged a reader for
 * it (260930f decision 4). Readers can now switch it on, and the one writer that
 * sets the column for them — `switchOnHighPower`, src/store/pg-billing.ts —
 * charges in the same transaction, so the column set is the charge paid. Nothing
 * copies the column onto another article. What is left is a hand-edit on
 * production, which spends our money rather than a reader's allowance.
 * docs/plans/260930k-high-power-for-readers-and-cost-only-for-admins.md, decision 6.
 *
 * One function, used by the job runner and by every request-path route, so the
 * rule has one spelling.
 */
export function articlePower(highPowerSince: string | Date | null | undefined): ModelPower {
  return highPowerSince != null ? "high" : "standard";
}

/**
 * **The model that transcribes a PDF** — its own line, because it is its own
 * decision and it is not on either tier above.
 *
 * The two tiers are about *writing*: how well a model turns an article into a
 * gist, a thread, a glossary. This one is about *reading*, and the two do not
 * predict each other. It was chosen by measurement rather than by argument —
 * ninety-odd calls over three fixture PDFs, in evals/pdf/, with the result and
 * the caveats in docs/plans/260826c-pdf-ingestion.md. It is deliberately not
 * `QUICK_MODEL_OPENROUTER` even though it is currently the same string: they
 * are the same by coincidence, and a future switch of the quick tier must not
 * silently re-decide which model reads PDFs.
 *
 * **Why this stage gets to leave Anthropic when the rest of the app does not.**
 * Greg's call, 2026-08-26, and the reasoning is specific to this stage: every
 * later stage inherits its mistakes and none of them can detect one. A ToC
 * built from a paragraph the transcriber dropped is a good ToC of the wrong
 * article. So this is the one place accuracy is worth a second vendor.
 *
 * Swapping it is a one-line change *here* and nowhere else — src/pdf-read.ts
 * reaches a model only through `PdfReader`. That seam exists because the
 * evidence behind this string is two documents and one comparison, which is
 * enough to start with and not enough to build around.
 *
 * Measured on GPT-5.6 Luna; moved to GPT-6 Luna, the same family, on
 * 2026-10-09 (plan 261009a), after all three fixture types were transcribed
 * and one scanned page was compared by eye.
 */
export const PDF_READER_MODEL = "openai/gpt-6-luna";

/**
 * **What finds a figure the PDF itself could not place** — the model shown a
 * refused figure's page and its neighbours and asked for the page and box of
 * the figure with this caption (src/pdf-figure-locate.ts). Not on a tier,
 * for the PDF reader's reason: a tier is a judgment about how much reasoning a
 * job needs, and this one needs eyes and a coordinate convention.
 *
 * Chosen by measurement, 2026-09-24 and 2026-09-28: a Sonnet subagent's
 * research found Gemini's `box_2d` convention the documented, trained one, and
 * of five models tried on the same page only this one and Luna returned the
 * right box (Claude's was too tall, Gemini 2.5 Pro's and Qwen's had x and y
 * swapped). Then 30 calls with the real acceptance rule: 21 right, 9 correctly
 * refused, none wrong, ~1.8 s and ~$0.002 a call. The table is in
 * docs/plans/260924e-a-pdf-figure-paired-to-the-wrong-caption.md § Stage 2.
 * It is a *preview* model; if OpenRouter retires the id, every call fails and
 * every figure it would have found stays caption-only — the state it was
 * already in.
 *
 * **Not moved to Gemini 3.8 Flash on 2026-10-09**, though "always the latest
 * of each family" is the rule (plan 261009a): 3.8 reasons on every call, so
 * 11 calls took ~5.5 s and ~$0.0045 each against ~1.8 s and ~$0.0015, with
 * 7 right, 3 correctly refused, 1 missed and none wrong — no gain to pay for.
 * evals/results/latest-models-smoke-2026-10-09.md. Worth retrying with its
 * reasoning off.
 */
export const PDF_FIGURE_LOCATOR_MODEL = "google/gemini-3-flash-preview";

/**
 * **What judges the shelf's candidate topics** — the model shown a reader's
 * shelf (titles and one-sentence gists, and their profile when they wrote one)
 * and the program's candidate topics, asked to score each 0–3 as a filter for
 * this reader. Our own greedy then chooses from the scores
 * (src/shelf-terms/model-scores.ts, docs/project/shelf-terms.md).
 *
 * Chosen by measurement, 2026-09-29: nine shelves, four arms, three runs each,
 * blind Opus judges. Luna's scores beat the program-only list 9–0 in both
 * rounds and were level with or ahead of Jev, a cheaper decisions model on an
 * alpha endpoint the gateway did not then speak (it has since 2026-10-02, for
 * quick search). About $0.001 and 6–20 s a call.
 * docs/plans/260929c-shelf-topics-chosen-by-a-model.md § Stage 1.
 *
 * The undated id, like every other Luna constant in this file. OpenRouter's
 * models list gives its canonical slug as `openai/gpt-6-luna-20260922`; the
 * listed id is this one, and it is the one the eval measured.
 */
export const SHELF_TOPICS_MODEL = "openai/gpt-6-luna";

/**
 * **What reads a paper's title, authors, abstract and DOI off its first two
 * pages** when it arrives in a batch and is not AI-processed
 * (src/paper-metadata.ts). Not on a tier: one cheap, fixed model chosen for
 * price and for a zero-retention route, not for how much it reasons.
 *
 * Greg's choice, 2026-10-01: *"use DeepSeek v4.1 Flash or similar (i.e. very
 * cheap, but still pretty modern and smart for its price) via OpenRouter for
 * this (but via a ZDR provider, e.g. Fireworks)."* Checked live that day: on
 * OpenRouter's ZDR list through `fireworks`, $0.22 in and $0.66 out per
 * million tokens. The route that keeps it on zero-retention upstreams is `paper-metadata` in
 * src/ai-call.ts, and only Fireworks, DeepInfra and Together may serve it, so a
 * model put here must be one they serve. The bar it was held to is Luna's, on the 13-PDF eval:
 * evals/pdf/minimal-metadata/score.mts, with the results in
 * evals/results/paper-metadata-2026-10-01.md.
 *
 * No `SPIDERYARN_*_MODEL` override, like every other model on no tier: the
 * eval passes its model directly, and an override naming a model those three
 * do not serve would only be refused by the route.
 */
export const PAPER_METADATA_MODEL = "deepseek/deepseek-v4.1-flash";

/**
 * **What rates how hard a piece is to read**, its language and its ideas each
 * 1 to 5, from a sample of it (src/reading-difficulty.ts). The same cheap model
 * as `PAPER_METADATA_MODEL` above, on the same zero-retention route
 * (`reading-difficulty` in src/ai-call.ts), chosen for plan
 * docs/plans/261005j-reading-time-knows-difficulty-a-model-rates-language-and-ideas-at-import.md.
 *
 * Its own constant, though the string is the same: the two jobs were chosen
 * separately, and moving one to another model must not move the other.
 */
export const READING_DIFFICULTY_MODEL = "deepseek/deepseek-v4.1-flash";

/**
 * **What lightly tidies an imported title** — its capitals, a site's name
 * stuck on the end, stray spacing (src/title-tidy-model.ts). Greg, 2026-10-05:
 * *"yes, a small model (e.g. GPT Luna or DeepSeek)"*. The same cheap model as
 * `PAPER_METADATA_MODEL` above, on a copy of its zero-retention route
 * (`title-tidy` in src/ai-call.ts), so a model put here must be one Fireworks,
 * DeepInfra or Together serves. Measured against the rule and against Luna:
 * docs/investigations/261005b-title-tidying-rule-against-a-small-model.md.
 *
 * Its own constant, though the string is the same: the two jobs were chosen
 * separately, and moving one to another model must not move the other.
 */
export const TITLE_TIDY_MODEL = "deepseek/deepseek-v4.1-flash";

/**
 * **What reads any web page's authors and affiliations off the top of the
 * page** (src/front-matter-authors.ts), held to the page's words by code.
 * Greg, 2026-10-09 (spya-vfk2zh): a cheap general pass rather than a rule per
 * site, *"especially a cheapish one like DeepSeek 4.1 Flash or Haiku 5.5"*.
 *
 * Haiku, not DeepSeek, though both cost about $0.0005 a page: on the
 * measurement DeepSeek twice split a shared, unmarked line of institutions
 * between authors by what it seemed to know about them, which the page did not
 * say; Haiku's misses were refusals. On no tier, so High-powered AI does not
 * move it. Route `front-matter-authors` in src/ai-call.ts.
 * docs/plans/261010d-a-general-authors-pass-for-every-web-page.md § Measured.
 */
export const FRONT_MATTER_AUTHORS_MODEL = "anthropic/claude-haiku-5.5";

/**
 * **What writes the one-line gist of a conversation** after each answer, so a
 * later conversation about the same article can see what an earlier one
 * covered (src/chat-gist.ts, plan
 * docs/plans/261008e-chat-knows-the-reader-s-other-conversations.md). Greg,
 * 2026-10-08: *"auto-generate a descriptive title for each chat thread with a
 * small model after each response"*. The same cheap model as
 * `PAPER_METADATA_MODEL` above, on a copy of its zero-retention route
 * (`chat-gist` in src/ai-call.ts): what it reads is the reader's own
 * conversation. Its own constant for the reason the two above have theirs.
 */
export const CHAT_GIST_MODEL = "deepseek/deepseek-v4.1-flash";

/**
 * **What scores every block for a quick search** — TypeSafe's Jev, a "decision"
 * model that answers typed questions with probabilities rather than writing
 * text (src/quick-search.ts, docs/plans/261002e-quick-search-v1.md). One `noul`
 * question per block, all in one request; about 0.4 s and $0.0004 a search on
 * a typical article, against 5–16 s for the meaning search.
 *
 * **Requests the versioned id, not `-latest`**, because the floor the hits are cut
 * at (`QUICK_FLOOR`) was measured on this model and means nothing on the
 * next one. The provider may return a dated id, which is stored as the model
 * that answered; the request itself names `typesafe/jev-1.13`.
 * docs/investigations/261002o-quick-search-spike.md.
 *
 * Served only on OpenRouter's alpha Decisions endpoint, so it has its own
 * gateway seam (`openRouterDecisions`, src/ai-call.ts) and its own wire. No
 * `SPIDERYARN_*_MODEL` override, like every other model on no tier: another
 * decisions model would need its own floor and, measured, bills the state per
 * question (`liquid/d1`, `upstage/solar-decide`), which the one-request shape
 * cannot afford.
 */
export const QUICK_SEARCH_MODEL = "typesafe/jev-1.13";

/**
 * **What picks a command from a sentence typed into the command bar** — Jev
 * again, asked one `choice` question over the bar's rows
 * (src/command-pick-call.ts, plan 261003k). About 0.3 s and $0.0002.
 *
 * Its own constant beside `QUICK_SEARCH_MODEL`, although today they are one
 * string, because each holds a threshold measured on its model:
 * **`RUN_AT_ONCE`, 0.95 (src/command-pick.ts), was measured on
 * `typesafe/jev-1.13`** and means nothing on the next version. Moving this is
 * a rerun of evals/command-pick/, not a bump
 * (docs/investigations/261003e-which-fast-model-turns-a-sentence-into-a-command-and-its-argument.md).
 *
 * The words of an argument command — what to look for, the tag — are copied
 * out by a second call on the quick tier's model, `QUICK_MODEL_OPENROUTER`
 * (job `command-pick-words`): Jev's own attempt at them failed 15 times in 48.
 */
export const COMMAND_PICK_MODEL = "typesafe/jev-1.13";

/**
 * **What answers a question asked on the Help pages** — *Ask about
 * Spideryarn* (src/help-chat-call.ts, plan 261007k). A cheap model, because
 * Greg asked for one (*"probably the help page agent uses a much dumber model,
 * so it's cheaper"*) and because the whole Help, about 28k tokens, is in every
 * request.
 *
 * **Measured for this job on 2026-10-07**, against DeepSeek V4.1 Flash, in
 * docs/investigations/261007b-help-chat-model-and-refusals.md: every
 * off-topic and jailbreak question declined, answers grounded in the pages,
 * about a second to the first word, and a prefix cache that reads across
 * different questions ($0.0068 cold, $0.0006 warm) — on GPT-5.6 Luna; GPT-6
 * Luna since 2026-10-09 (plan 261009a, re-run in its write-up). DeepSeek answered as
 * well but three to four times slower, on whichever small upstream OpenRouter
 * picked, with a cache that hit about half the time. Its own literal, though the
 * string is currently the same as `QUICK_MODEL_OPENROUTER`'s, so moving one job
 * does not move the other; and
 * not a `Task`, so no environment override can unpin it from what the eval
 * measured. Moving it to a non-OpenAI model is also a decision about caching:
 * `help-chat` in src/ai-call.ts says why.
 */
export const HELP_CHAT_MODEL = "openai/gpt-6-luna";

/**
 * **What turns a dictation into text.** Not on a tier, for the same reason the
 * PDF reader is not: a tier is a judgment about how much reasoning a job needs,
 * and this one needs none — it needs ears and a vocabulary list.
 *
 * **It is `openai/gpt-transcribe` on `/v1/audio/transcriptions`, since
 * 2026-09-07**, with the vocabulary in a `keywords` array. Everything between
 * here and § *Changed to an OpenAI transcriber* below is the history of how it
 * got there, and every claim in it is written in the past tense on purpose —
 * that section is the current state and this is the record of two earlier
 * answers to the same question. The short version of why it moved: the sentence
 * that ruled the dedicated transcribers out stopped being true when
 * `gpt-transcribe` grew a real biasing parameter.
 *
 * ---
 *
 * **2026-08-27 — a *chat* model rather than one of OpenRouter's nineteen
 * dedicated speech-to-text models**, which was the whole finding of
 * docs/plans/260827x-dictation-two-pass.md. Measured on one 22-second sample,
 * three runs each:
 *
 * | | latency | word errors |
 * |---|---|---|
 * | this model, vocabulary in the system prompt | 2.4s | 0.0% |
 * | this model, bare prompt | 3.3s | 3.6–7.3% |
 * | `openai/gpt-transcribe` (dedicated) | 1.6s | 3.6% |
 * | `deepgram/nova-3` (dedicated) | 1.0s | 18.2% |
 *
 * Every dedicated model got `Spideryarn` and the block id `spya-k3m9qt` wrong.
 * This one, *told what the words might be*, got them right every run.
 *
 * **The dedicated endpoint ignored the parameter OpenAI used for that**, and
 * this is the claim that eventually expired:
 * `POST /api/v1/audio/transcriptions` accepted `prompt`, returned 200, and
 * changed nothing — verified by sending a field called
 * `wibble_not_a_real_field` and getting the same 200.
 * docs/reusable/silent-success.md, with a status code on it. That is the
 * precise claim and it used to be written here as the broader one, that a
 * dedicated transcriber "cannot be told" its vocabulary at all — which a GPT
 * Sol review on 2026-09-03 pointed out is false: Deepgram's `keyterm` and
 * Groq's own `prompt` live under `provider.options` and were never tried. That
 * route was open and unmeasured; it was measured on 2026-09-07 and it is the
 * route this job now takes. See § Changed to an OpenAI transcriber.
 *
 * ## Re-opened and kept, 2026-09-03
 *
 * That table settled the *route* and left the *model* confounded — it gave the
 * Gemini models a vocabulary and everybody else none. Asked properly over every
 * audio-capable model OpenRouter lists, on this app's own request, in
 * docs/plans/260903i-which-model-transcribes-dictation.md. The plan owns the
 * numbers; three things belong here, beside the line they would change:
 *
 * - **Nothing reachable transcribes better.** Given its vocabulary, this model
 *   made zero word errors and found every hard term on every clip that had one.
 *   So did the two challengers. The differences that looked real all lived in
 *   clips whose words nobody had, and the honest conclusion is that model
 *   choice is not what limits this feature — the vocabulary is.
 * - **The newer sibling is worse**, which is worth knowing because a version
 *   bump is the change nobody benchmarks. `google/gemini-3.5-flash-lite` was
 *   the only arm to put word errors into the clip with no jargon in it.
 * - **The flash tier cannot be had at this latency**, whatever it is worth: it
 *   spends ~120 reasoning tokens before transcribing and that endpoint answers
 *   `400 Reasoning is mandatory for this endpoint and cannot be disabled`.
 *
 * ## Changed to an OpenAI transcriber, 2026-09-07
 *
 * Greg's call, and the whole of it is in
 * docs/plans/260907c-dictation-onto-an-openai-transcriber.md. Everything above
 * remains true of the **chat** endpoint, including that `openai/gpt-audio`
 * cannot be reached over it — its `input_audio.format` is a closed enum of
 * `wav` and `mp3` in OpenAI's own schema, so a browser's webm has never had a
 * way in.
 *
 * What changed is that the *other* endpoint turned out not to have the problem
 * this feature avoided it for. `POST /v1/audio/transcriptions` takes webm, and
 * `gpt-transcribe` takes a **`keywords` array** — a real biasing parameter,
 * where 260903i found only a `prompt` field that "answers 200 and changes
 * nothing". So the sentence that chose a chat model over a transcriber, *the
 * dedicated route has nowhere to put a vocabulary*, is no longer true, and the
 * vocabulary is the whole feature.
 *
 * Two things are worse and were accepted:
 *
 * - **Zero data retention is gone, and cannot be had here.** `zdr: true` is
 *   *ignored* on the transcription endpoint rather than refused: it answers 200
 *   for a model absent from OpenRouter's own ZDR list, and so does
 *   `only: ["anthropic"]`, for a transcript. That is why `AI_JOB_ROUTE` no
 *   longer sends a `provider` block for this job, and why /privacy no longer
 *   promises a reader their voice is unstored.
 * - **The bill comes back as zero.** `usage.cost` is `0` on this endpoint at 3
 *   seconds and at 22. The cap is at OpenRouter and holds regardless; our own
 *   ledger records these rows as *unpriced* rather than free, and
 *   `npm run cost --reconcile` can show the account-level gap but cannot
 *   attribute it back to a request.
 *
 * `npm run eval:dictation-gate` re-checks the chat endpoint and
 * `evals/dictation/probe-stt-routes.ts` the transcription one; run them before
 * believing any leaderboard about this feature.
 */
export const DICTATION_MODEL = "openai/gpt-transcribe";

/** The two tiers a task can be on. */
export type Tier = "capable" | "quick";

/**
 * **Every job in this app that calls a model *and is on a tier*.**
 *
 * That qualifier is load-bearing and used not to be here. The PDF transcriber
 * and the embedding model are model calls this app makes and are deliberately
 * on neither tier — a tier is a judgment about how much reasoning a job needs,
 * and neither of those is that kind of job. They are in `NON_TASK_MODELS`
 * below, so that "not a tier decision" stops meaning "invisible".
 */
export type Task =
  | "structure"
  | "labels"
  | "arc"
  | "tweets"
  | "glossary"
  | "ideas"
  /* The lines worth keeping, in the article's own words —
     docs/project/quotes.md. Article-reading like `glossary`, and like
     `glossary` it never names a block id: the model returns the words and
     `locate` in src/quotes.ts finds the block, so it renders with
     `articleText`. Its schema differs from Glossary's format, so
     matching article bytes no longer make the two cache-compatible. */
  | "quotes"
  /* The picture a model draws of the argument — docs/project/diagram.md
     § Sketch. Article-reading like `ideas`, and like `ideas` it names block
     ids, so it renders with `articleWithIds`. */
  | "sketch"
  /* When the piece says things happened, and how sure it is —
     docs/plans/260831i-timeline-mode.md. Article-reading like `ideas`, and like `ideas` it
     names block ids, so it renders with `articleWithIds`; Ideas' schema now
     keeps the two in different cache groups. It is the one stage that never asks the model for
     a date: src/timeline.ts § the header. */
  | "timeline"
  /* **Writing the brief an image model draws from** — the first call of the
     Illustrated sub-mode (docs/plans/260903c-illustrated-diagram-sub-mode.md).
     Not to be confused with `illustrate`, the `ImageAiJob` below, which is the
     *second* call: this one is words about a picture, that one is the picture.
     Article-reading like `ideas`, and like `ideas` every vignette names a block
     id, so it renders with `articleWithIds`. It is not an `ArticleStage`, so
     the cross-stage cache predicate deliberately excludes it.
     It also reads another stage's artefact — the Sketch —
     rather than deciding its own shape. src/illustrated.ts. */
  | "illustrated"
  /* The questions the piece can ask you back — docs/plans/260831al-review-quiz-sub-mode.md.
     Article-reading like `ideas`, and like `ideas` every piece of evidence names
     a block id, so it renders with `articleWithIds`. */
  | "quiz"
  /* The questions a careful reader would put to the piece, and the passages
     where it responds — docs/plans/260916d-faq-mode.md. Article-reading like
     `ideas`, naming block ids, so `articleWithIds`. */
  | "faq"
  /* How each paragraph bears on the one before it —
     docs/plans/261003f-marginalia-relation-words-and-timeline-events.md.
     Article-reading like `ideas`, answering block ids, so `articleWithIds`. */
  | "relations"
  /* The article's claims, listed for Debate's Claims to pick from —
     docs/plans/261008i-debate-claims-picked-by-the-reader.md § 2. Article-reading
     like `faq`, naming block ids and quotes, so `articleWithIds`. No web search. */
  | "debate-claims"
  /* Links between the article's own blocks —
     docs/plans/260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md.
     Article-reading like `ideas`, naming block ids, so `articleWithIds`. */
  | "crossrefs"
  /* Simple: a plain-words orientation, each paragraph naming its passages —
     docs/plans/260930i-simple-summaries-eli15-sub-mode.md. Article-reading like
     `ideas`, naming block ids, so `articleWithIds`. */
  | "simple"
  /* A route through the Quotes — docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md.
     **Not article-reading**: it sends the quotes and never the article, so it
     is no `ArticleStage` and its effort is a constant in src/skim.ts. */
  | "skim"
  | "explain"
  | "chat"
  /* **Marking a reader's answer, and its own job rather than a mode of `quiz`.**
     Generation is unwatched pipeline work on the Messages wire; marking happens
     in a request handler with a person waiting, on chat/completions. One `Task`
     cannot describe both wires — and calling `openRouterStream("explain", …)`
     because it is already there would attribute every mark to Explain in the
     cost report, quietly and for ever. GPT Sol's finding 9. */
  | "quiz-mark"
  /* **Did the reader get it right?** — the hidden half of the adaptive quiz,
     docs/plans/260907d-make-the-quiz-adaptive.md. It reads the question, the
     reader's answer and the mark that was just written for them, and answers in
     one word that nobody is ever shown; the ladder steps on it.

     Its own job rather than a mode of `quiz-mark`, for the reason this list
     keeps giving: a call billed under another job's name is spend nobody can
     find later. Sharper here than usual, because this one fires *once per
     answer, beside* a `quiz-mark` call — folded together, the mark's cost per
     answer would silently include a second call on a different tier.

     Quick tier, and it can be: it never sees the article. The mark it reads has
     already done the comparing, with citations. */
  | "quiz-verdict"
  /* **Simple's fidelity guard** (src/simple-check.ts, plan 261001i): each
     written level's paragraphs beside the passages they cite, one verdict
     each. Its own job so the ledger can count the checks, their failures and
     their cost apart from the writing — the step's spend would otherwise hide a
     second tier inside it. Quick tier, as measured in plan 261001h; it never
     sees the whole article. */
  | "simple-check"
  | "search"
  /* The model reading a referee's own notes rather than the paper —
     docs/plans/260831an-referee-mode-for-peer-reviewers.md § 3. It is the only
     paying job that never sees the article: its input is the referee's comments
     and the passages they are anchored to, so it renders neither `articleText`
     nor `articleWithIds` and shares no cached prefix with anything. Its own task
     rather than search's because a call billed under another job's name is spend
     nobody can find later — the mistake `quiz-mark` exists to have stopped
     making. */
  | "referee-mirror"
  /* Hidden text's Opus check — the scan's flagged rows, never the article, one
     opinion per row, only when the referee presses for it
     (docs/plans/261007l-hidden-text-an-opus-check-the-reader-asks-for-over-the-flagged-fragments-only.md,
     src/referee-hidden-check.ts). Its own task for `referee-mirror`'s reason:
     spend billed under another job's name is spend nobody can find later. */
  | "referee-hidden-check"
  /* One of the referee's own criteria, run over the paper —
     docs/plans/260831an-referee-mode-for-peer-reviewers.md § 1. Search's shape
     (one JSON object, passages by block id) and, on a `literature` criterion,
     explain's web search as well, which is why it cannot be either of them: it
     is the only job that sometimes sends tools and sometimes does not, and both
     halves have to bill under the name a referee would look for. Its own task
     rather than `search`'s for the reason `referee-mirror` above states, which
     is the reason `quiz-mark` exists to have stopped making: a call billed
     under another job's name is spend nobody can find later. */
  | "referee-criteria"
  /* The claims a paper makes about itself, and where it takes each one up —
     docs/plans/260831an-referee-mode-for-peer-reviewers.md § 2. Its own task
     rather than `referee-criteria`'s for the reason that one gives about
     `search`, which is the reason `quiz-mark` exists to have stopped making: a
     call billed under another job's name is spend nobody can find later. It is
     also the referee job with the biggest single answer — one read of the paper
     and up to twenty claims of quoted passages out of it — so a cost report that
     folded it into criteria would report the wrong shape as well as the wrong
     name. */
  | "referee-claims"
  /* Candidates — who could review this paper, for an editor —
     docs/plans/260831an-referee-mode-for-peer-reviewers.md § 4. **Chat's shape
     exactly**: a streamed multi-turn conversation with tools, answered by
     `converse` with a third system prompt. Its own task rather than `chat`'s all
     the same, and here the reason is sharper than the one `quiz-mark` and
     `referee-claims` give about naming. This is the only conversation in the app
     that runs a web search on nearly every turn, several per turn, over a whole
     paper — so its cost per turn does not look like chat's, and folding the two
     together would move the chat line in the cost report whenever somebody spent
     an evening hunting reviewers, with nothing saying why. It is also the one
     job whose model a person might reasonably want to change on its own, since
     what it is being asked for is a search rather than an explanation. */
  | "referee-candidates"
  /**
   * **Which of the first records are the article and which are the
   * publisher's** — the second look at a PDF's front matter, and the only
   * `Task` that reads a PDF at all.
   *
   * A `Task` rather than a `NonTaskAiJob` because it *is* a tier decision:
   * non-task jobs each have one fixed model for a reason
   * that is not about reasoning (vision, vectors, speech), and this one is a
   * judgment about a hard call on a page. It is on `chat`, not `messages`,
   * because it is a small structured call and joins the request-path group.
   *
   * It does not read the article — only the first three pages' records, as
   * text, and it answers with ids. src/pdf-frontmatter.ts.
   */
  | "pdf-frontmatter"
  /**
   * **What the rest of the web says about this piece** —
   * docs/plans/260905f-debate-mode-what-the-web-says-about-this-piece.md.
   *
   * **The odd one in this union, and the oddity is worth stating.** It is a
   * *pipeline step* (`StepName`, src/types.ts) that is on the **chat** wire, so
   * it is the one task that appears in `REQUEST_PATH_TASKS` below without a
   * reader sitting watching a stream. That list is derived from `TASK_WIRE`
   * rather than hand-kept, so it means exactly *"speaks chat/completions"* and
   * has never meant more; the sentence beside it is now half true and the
   * derivation is the thing to trust.
   *
   * Why the chat wire at all: this is the only call anywhere in the pipeline
   * that needs `openrouter:web_search`, which is a server-side tool on
   * chat/completions and does not exist on the Messages shape. `src/pdf-read.ts`
   * is the precedent for a pipeline call on that wire.
   *
   * It is **not** an `ArticleStage` (below): it shares no byte-exact cached
   * article prefix with the Messages-wire stages, so it takes no row in
   * `STAGE_EFFORT` or `ARTICLE_RENDERER`. src/types.ts § `StepName` says the
   * same thing where a reader of that union will trip over it.
   */
  | "debate"
  /**
   * **A reader's claim check in Debate's Claims** — the ticked claims and the
   * typed one, searched on the open web in one call (src/debate.ts §
   * `generateClaimCheck`; plan docs/plans/261008i-debate-claims-picked-by-the-reader.md
   * § 3). `debate`'s wire and model, its own job so the ledger files it as
   * interactive request work rather than a pipeline step.
   */
  | "debate-check"
  /**
   * **How the page on the far end of a hyperlink stands to the piece the reader
   * is holding** —
   * docs/plans/260905f-external-link-panel-add-to-spideryarn-and-server-side-preview.md
   * § Stage 3, and src/link-summary.ts.
   *
   * **The first task ever put on the quick tier**, so the two caveats in this
   * file's header stopped being hypothetical here: see `TASK_TIER` below for
   * what was actually measured. It is a request-path call with a reader hovering
   * a card, so it is on chat/completions — which is also the only wire
   * `QUICK_MODEL_OPENROUTER` is served on, so for this one task the tier and the
   * wire decide each other.
   *
   * Its own task rather than `explain`'s for the reason `quiz-mark` exists to
   * have stopped making: a call billed under another job's name is spend nobody
   * can find later. It is also the cheapest call in the app and the only one
   * whose input is somebody else's web page, so folding it into a Sonnet job's
   * line would misreport both the money and the shape.
   */
  /**
   * **Every work the piece cites** — src/bibliography.ts,
   * docs/plans/260911g-citations-mode.md. Messages wire, capable tier: the
   * links are code's, but relevance is a reading of the whole argument.
   */
  | "bibliography"
  /**
   * **One cited work's own page, found on the web** — Bibliography's *Find
   * it*, src/citation-find.ts. Chat wire because `openrouter:web_search` is a
   * server tool there and nowhere else; its own job rather than `bibliography`'s
   * because that one is a Messages-wire pipeline step over a whole article and
   * this is one reader-triggered search for one work, whose cost is billed
   * per search — folding them would hide the searches in the step's line.
   */
  | "citation-find"
  /**
   * **An uploaded paper's own page, found on the web** — the second caller of
   * `findWorkPage` (src/source-guess.ts). The same call as `citation-find`,
   * under its own name so the ledger can tell a reader pressing *Find it* from
   * an article opening and looking for itself.
   */
  | "upload-source-guess"
  /**
   * **One cited work, looked into on demand** — Bibliography's *Investigate*,
   * src/citation-investigate.ts. A streamed answer written with a few web
   * searches over the whole article, so explain's shape and explain's model;
   * its own job because one press reads the article about twice and runs its
   * own searches, and folded into `explain` it would move that line with
   * nothing saying why. docs/plans/260930a-citations-investigate-one-work-on-demand.md.
   */
  | "citation-investigate"
  /**
   * **The cited paper's own passages, picked** — one non-streamed JSON call
   * inside an *Investigate* press, sent the chunks of the paper code read and
   * confirmed (src/citation-paper-passages.ts, plan 261001a stage 3). Its own
   * job so the ledger shows what reading the paper adds to a press; no tools.
   */
  | "citation-paper-passages"
  /**
   * **A cited work's influence, read from the press's own search results** —
   * one non-streamed JSON call inside a *Dig deeper* press
   * (src/citation-influence.ts, plan 261003m stage 2). Its own job so the
   * ledger shows what it adds to a press; no tools.
   */
  | "citation-influence"
  /**
   * ***Dig deeper*'s forced search** (src/dig-deeper.ts, plan 261001p): one
   * web search with `tool_choice: "required"`, run before the answer because
   * the high-power model that writes the answer cannot be made to search. It
   * reads nothing back to the reader — it keeps the search's results and writes
   * a keyword query for the reader's library — so it is born on the quick tier.
   * Its own job so the ledger shows what forcing the search costs beside the
   * answer it feeds.
   */
  | "dig-deeper-search"
  /**
   * **Who wrote an article, and how to reach them** — the author gift's one
   * lookup (src/author-lookup.ts, plan 261010c D4). Admin-only, pressed by an
   * administrator for one article at a time, run after the response. Chat
   * wire because `openrouter:web_search` is a server tool there and nowhere
   * else; its own job so `/admin/costs` and the gift's row can say what a
   * lookup costs. **Always standard power**: it is not one of the article's
   * modes, so the article's High-powered AI does not move it — the caller
   * passes `"standard"` explicitly.
   */
  | "author-lookup"
  | "link-summary";

/**
 * **The model calls that are not a `Task`** — and the type exists so that
 * "not on a tier" cannot go on meaning "not counted".
 *
 * `Task` is a judgment about how much reasoning a job needs, which is why
 * transcribing a PDF, turning a paragraph into a vector and turning a reader's
 * voice into words are all excluded from it; the comment on `Task` argues that
 * at length and it is still right. But **the bill does not care about tiers.**
 * Every one of these spends real money, and a spend record keyed on `Task`
 * would have had nowhere to put them — which is exactly how they would have
 * stayed missing from a total that looked complete.
 *
 * `NON_TASK_MODELS` below is typed against this rather than against `string`, so
 * the inventory the profile page shows and the jobs the meter can name are the
 * same set by construction.
 */
export type NonTaskAiJob =
  | "pdf"
  | "embeddings"
  | "dictation"
  | "pdf-figure-locate"
  /* **The shelf's topics, judged** — src/shelf-terms/model-scores.ts. Not a
     `Task`, for the PDF reader's reason: a tier is a judgment about how much
     reasoning a job needs, and this job's model was chosen by an eval rather
     than by a tier (`SHELF_TOPICS_MODEL` below). */
  | "shelf-topics"
  /* **A batch-added paper's title, authors and abstract** —
     src/paper-metadata.ts, on `PAPER_METADATA_MODEL` below. */
  | "paper-metadata"
  /* **How hard a piece is to read, rated from a sample of it** —
     src/reading-difficulty.ts, on `READING_DIFFICULTY_MODEL` below. Not
     `difficulty`: that word is already a field on FAQ and glossary items. */
  | "reading-difficulty"
  /* **An imported title, lightly tidied** — src/title-tidy-model.ts, on
     `TITLE_TIDY_MODEL` below. */
  | "title-tidy"
  /* **Any web page's authors and affiliations, off the top of the page** —
     src/front-matter-authors.ts, on `FRONT_MATTER_AUTHORS_MODEL` below. */
  | "front-matter-authors"
  /* **A conversation's one-line gist**, written after each answer —
     src/chat-gist.ts, on `CHAT_GIST_MODEL` below. */
  | "chat-gist"
  /* ***Dig deeper*'s answer** — `explainStream` with a press's findings
     (src/dig-deeper.ts, plan 261001p). Not a `Task`, deliberately: its model
     is not a tier decision and must not be overridable. It is always the
     high-power model (`DIG_DEEPER_MODEL`), and a `Task` would bring a
     `MODEL_ENV_VAR` row that could quietly put it back on Sonnet — Sol's F2
     on the plan. Its own job, apart from `explain`, so the ledger can say
     what a dug answer costs; its search step is the `dig-deeper-search` task. */
  | "dig-deeper"
  /* **A quick search** — every block of the article scored by Jev for how well
     it matches what the reader typed (src/quick-search.ts, plan 261002e). Not
     a `Task`: its model was chosen by a spike, not a tier, and it speaks the
     Decisions wire, where a tier's reasoning effort means nothing. Its own job
     rather than `search`, so the ledger can say what the quick half costs. */
  | "search-quick"
  /* **A sentence in the command bar, turned into one of its rows** — Jev's
     one `choice` over the rows (src/command-pick-call.ts, plan 261003k). Not
     a `Task`, for `search-quick`'s two reasons. */
  | "command-pick"
  /* **And the words that sentence names**, when the pick is a command that
     takes some: a second, tiny call on `QUICK_MODEL_OPENROUTER`. Its own job,
     so the ledger can say what the two halves cost. Not a `Task`: it is the
     model the eval measured, not a tier, and an override would unpin it. */
  | "command-pick-words"
  /* **The bar's short list from why you are reading** — searches, modes and a
     lens proposed from the reader's profile, on `QUICK_MODEL_OPENROUTER`
     (src/command-suggest-call.ts, plan 261005k). Not a `Task`, for
     `command-pick-words`'s reason: it is the model the eval measured. */
  | "command-suggest"
  /* **A question asked on the Help pages, answered from them** — streamed on
     `HELP_CHAT_MODEL` (src/help-chat-call.ts, plan 261007k). Not a `Task`:
     its model is the eval's choice, not a tier, and an override would unpin
     it. */
  | "help-chat";

/**
 * **Every model call this app pays for**, whether or not it is a tier decision.
 *
 * The unit of the cost record — see [`src/ai-spend.ts`](ai-spend.ts). Adding a
 * member here without giving it a wire in `AI_JOB_WIRE` is a compile error,
 * which is the whole reason that is an exhaustive record rather than a list;
 * and unless the new job is one of the three kinds excluded from `ChatJob`
 * (a pipeline stage, live conversation, an image), `AI_JOB_ROUTE` in
 * [`src/ai-call.ts`](ai-call.ts) demands a route for it too.
 *
 * **`AiJob`, not `Job`.** `Job` is already taken, by the ingest queue's row in
 * [`src/types.ts`](types.ts) — a different, central thing, and two types with
 * one name in one codebase is a bug waiting for whoever imports the wrong one.
 * Caught by a GPT Sol review before it was written.
 */
/**
 * **A model call made to measure something**, rather than to do a job for a
 * reader — and its own category rather than a fourth `NonTaskAiJob`, because
 * those three each have one fixed model and appear on the profile page's
 * inventory, and an eval has neither.
 *
 * Most eval spend does *not* land here. An eval that exercises `converse` is
 * doing `chat`, and a PDF bake-off is doing `pdf`; recording those as `eval`
 * would throw away the one thing that makes eval spend worth keeping, which is
 * being able to ask what a job costs when somebody is measuring it properly.
 * `eval` is for the calls that stand in for nothing the app does — a judge
 * scoring two retrieval arms, a rescue pass over a mangled extraction.
 *
 * `scope_kind` is the column that says a row is eval spend, and it says so for
 * all of them. This one only says *what kind of work* the call was.
 */
export type EvalAiJob = "eval";

/**
 * **Talking to the article out loud** — and its own category rather than a
 * fourth `NonTaskAiJob`, for two reasons that are both about this file rather
 * than about the feature.
 *
 * 1. **A live session buys two models on two rate cards**, not one. The realtime
 *    model answers and a separate transcriber writes down what the reader said,
 *    billed per audio *minute* rather than per token (src/live.ts §
 *    `LIVE_TRANSCRIBER`). `NON_TASK_MODELS` is a list of one-model-per-job rows
 *    that the profile page renders, and a job with two models in it would either
 *    appear twice under one name or lose one of them.
 * 2. **Their ids cannot be named here.** `LIVE_MODEL` and `LIVE_TRANSCRIBER`
 *    live in src/live.ts, which imports src/converse.ts, which imports this
 *    file — so an import would close a cycle, and `npm run cycles` is a gate.
 *    Copying the two strings across would be the second copy of a fact that
 *    CLAUDE.md is explicit about, and this file has already been bitten by
 *    exactly that (see `TASK_WIRE`'s note about the duplicate in `modelsInUse`).
 *
 * So the *bill* knows the job by name — which is all `AiJob` is for — and the
 * two model ids stay where they are chosen. `displayName` falls back to the raw
 * id for them, which is the documented honest answer for a model this file has
 * no better name for.
 */
export type LiveAiJob = "live_conversation";

/**
 * **A model call made by a developer tool**, rather than for a reader or to
 * measure something.
 *
 * One member: `env-proposal`, which is `gjd-remote push-env` asking a model to
 * sort a repo's `.env.local` **key names** — never a value — into "safe on a
 * shared box" and "absolutely not", so the checklist it then shows starts
 * somewhere better than blank. It runs on `CAPABLE_MODEL_OPENROUTER`, which is
 * a measured choice rather than the obvious one for a classification this
 * small; the reasoning is beside the constant in
 * [`scripts/gjd-remote-envpolicy.ts`](../scripts/gjd-remote-envpolicy.ts).
 *
 * Its own category, and not a fourth `NonTaskAiJob`, for the reason `EvalAiJob`
 * gives about itself: those three have one fixed model each and are listed on
 * the profile page's model inventory, which is a page about the product. A
 * command Greg runs from a terminal is not part of that inventory and would be
 * a confusing row on it.
 *
 * It still spends real money and it still needs a row, which is the whole
 * reason it is in `AiJob` at all rather than being a call that happens to work.
 * `scope_kind` is `cli` — see [`src/cli-ledger.ts`](cli-ledger.ts).
 */
export type ToolAiJob = "env-proposal";

/**
 * **A model call whose answer is a picture** — one member, `illustrate`, which
 * is the Illustrated diagram sub-mode having an image model draw the argument
 * (docs/plans/260903c-illustrated-diagram-sub-mode.md).
 *
 * Its own category, and not a `Task`, for the reason that decides every other
 * line in this section: **a `Task` is a tier decision**, and there is no tier
 * to decide. `TASK_TIER` says quick or capable, `resolveModel` turns that into
 * `CAPABLE_MODEL`, and `messages.create` gets a `thinking` budget. An image
 * model has none of those — no reasoning effort, no quick sibling, no
 * `SPIDERYARN_*_MODEL` override that would mean anything. Putting it in `Task`
 * would have forced a row into three tables that could only ever be a lie.
 *
 * Not a fourth `NonTaskAiJob` either, for `EvalAiJob`'s reason: those three are
 * `NON_TASK_MODELS`, the inventory the profile page renders, and its model id
 * belongs beside the feature that chose it rather than being a second copy
 * here.
 *
 * It still spends real money — about $0.068 a plate at the 1K the feature buys,
 * measured 2026-09-04 — which is the whole reason it is in `AiJob` at all. The
 * $0.013 recorded here until then was `openai/gpt-image-2`, whose bill arrived
 * as a BYOK upstream figure rather than as a price; the model that replaced it
 * is priced on the wire.
 */
export type ImageAiJob = "illustrate";

export type AiJob =
  | Task
  | NonTaskAiJob
  | EvalAiJob
  | LiveAiJob
  | ToolAiJob
  | ImageAiJob;

/**
 * **Which tier each task is on — and the file's actual decision, rather than its
 * constants, which are only the vocabulary for it.**
 *
 * The capable default is what Greg asked for ("default to capable-model for
 * now"). The quick rows and their reasons are recorded beside the table;
 * changing a tier still needs evidence about the task, not just its price.
 *
 * **Flipping a row is not the whole of switching a task** — read the header's
 * list of what has to move with the model first. For Messages-wire tasks it
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
 * - **`labels`** writes one nav label per gistable block, in batches
 *   (src/labels.ts), so its cost grows with article length. Those labels help
 *   the reader find paragraphs in Structure. A cheaper tier would need an
 *   evaluation of that navigation quality before a switch.
 * - **`explain`, `chat`, `arc`, `tweets`, `glossary`, `structure`** all
 *   write something a person reads, or decide the shape of the whole article.
 *   These are the last places to economise, not the first.
 */
export const TASK_TIER: Record<Task, Tier> = {
  structure: "capable",
  labels: "capable",
  arc: "capable",
  tweets: "capable",
  glossary: "capable",
  ideas: "capable",
  quotes: "capable",
  sketch: "capable",
  timeline: "capable",
  illustrated: "capable",
  quiz: "capable",
  faq: "capable",
  relations: "capable",
  "debate-claims": "capable",
  crossrefs: "capable",
  simple: "capable",
  skim: "capable",
  explain: "capable",
  chat: "capable",
  "quiz-mark": "capable",
  "quiz-verdict": "quick",
  "simple-check": "quick",
  /* Quick by judgment, at birth (setup-dev.md § the quick tier): it writes a
     search query and a keyword line, never words a reader reads. Measured on
     2026-10-01 against Sonnet: the same five sources at a third of the price. */
  "dig-deeper-search": "quick",
  search: "capable",
  "referee-mirror": "capable",
  /* Capable, and on Opus for every article: `ALWAYS_HIGH_POWER` below. */
  "referee-hidden-check": "capable",
  /* Capable, like search — this reads a whole paper and answers with quoted
     block ids, which is the same job of work. */
  "referee-criteria": "capable",
  /* Capable, like the two beside it. This reads a whole paper, decides what it
     claims about itself, and answers with quoted block ids — the same job of
     work as a criterion, over more of the paper at once. */
  "referee-claims": "capable",
  /* Capable, like `chat`, which it is a second personality of. It reads a whole
     paper, decides what expertise judging it would take, and then weighs search
     results against that — and the whole feature is worthless if the weighing is
     shallow, because a shallow answer is a list of famous names. */
  "referee-candidates": "capable",
  /* Capable, and this one is worth stating rather than defaulting: the whole
     job is telling an article's title from a journal's on a page that sets
     the journal larger, and getting it wrong puts a wrong name on the shelf,
     the tab and the public shelf. src/pdf-frontmatter.ts. */
  "pdf-frontmatter": "capable",
  /* Capable, like `referee-candidates`, which is the closest job in the app:
     both weigh search results against a judgment about a text, and both are
     worthless if the weighing is shallow. Here a shallow answer is nine
     correctly-cited pages about sourdough starters presented as critical
     reception — the exact thing Stage 0 got back, and the thing every rule in
     src/debate.ts exists to refuse. */
  debate: "capable",
  /* The same weighing as `debate`, for the claims a reader picked. */
  "debate-check": "capable",
  bibliography: "capable",
  /* Capable, for `debate`'s reason: the whole job is weighing a handful of
     search results against one cited work and saying which, if any, is its
     own page. A shallow pick costs little here — code refuses a page whose
     title does not match — but a refusal is a work the reader goes without. */
  "citation-find": "capable",
  /* `citation-find`'s tier and its reason: the same prompt, the same pick. */
  "upload-source-guess": "capable",
  /* Capable, for `citation-find`'s reason: the job is weighing a handful of
     search results and saying which, if any, names the author and an address.
     Code checks every URL and the address against the results; a shallow pick
     is an empty draft Greg fills by hand. */
  "author-lookup": "capable",
  /* Explain's tier, because it is explain's kind of work: prose about the
     article, with web search, that a reader reads as it arrives. */
  "citation-investigate": "capable",
  /* The quick check's tier (`citation-find`), as plan 261001a says: weighing
     a few passages of a paper against one claim. Code checks every quote. */
  "citation-paper-passages": "capable",
  /* The tier of the press it runs inside. The press itself passes
     `DIG_DEEPER_MODEL`, as it does to every call whose output the reader reads. */
  "citation-influence": "capable",
  /**
   * **The first `quick` row in this table**, and the one place its two
   * unmeasured caveats got measured. `openai/gpt-5.6-luna` at roughly a tenth
   * Sonnet's price, on a job that runs once per cold link a reader rests on.
   *
   * Quick because of what the job is, not only because of what it costs: the
   * model is given the destination's opening, the paragraph the link sits in and
   * one sentence about the piece, and asked what the first has to do with the
   * others. That is a short piece of reading comprehension over material that is
   * all in front of it — not the multi-step inference `ideas` is paid `high`
   * for, and not prose anybody keeps.
   *
   * What the header warned about, checked rather than assumed (2026-09-05,
   * measurements in the plan): the reasoning floor is real, so the ceiling is
   * `max_completion_tokens` sized well clear of it and the parameter is spelled
   * the way this model advertises rather than the deprecated `max_tokens` the
   * other chat callers send. The Anthropic provider pin is **not** on this
   * job's route — see `AI_JOB_ROUTE` — because pointed at an OpenAI model it
   * is wrong quietly. There is no `cache_control` anywhere in the request, so
   * the breakpoint caveat does not arise.
   */
  "link-summary": "quick",
};

/**
 * **The tasks written on the high-power model for every article**, whatever
 * its High-powered AI setting. `powerFor` is the one place that applies it:
 * the pipeline step that runs the task and `GET /api/models`, which reports
 * it, both ask it, so the page cannot name one model while the call sends
 * another.
 *
 * `simple` (plan 261001p): measured on the PID paper with its fidelity guard
 * off, Sonnet named the paper's recurrent connections "feedback loops", the
 * paper's word for the kind with the opposite effect, in 5 levels of 18; Opus
 * in none of 36, and a blind read found 3 major faults in 27 Sonnet levels
 * against none in 27 Opus ones. About $0.05 a press more and ~2.5 s. The guard
 * stays: Opus still made a fault only it caught.
 * docs/plans/261001p-simple-on-opus-with-and-without-the-fidelity-guard.md.
 *
 * `referee-hidden-check` (plan 261007l): the feature is "hand it to Opus", so
 * it is Opus whatever the article's setting.
 *
 * **Membership alone does nothing at a call site**: `modelFor` does not apply
 * `powerFor`, so a caller that wants this has to resolve
 * `modelFor(task, powerFor(task, articlePower))` itself, as
 * src/referee-hidden-check.ts § `defaultModel` and the `simple` step do.
 *
 * Removing a task puts it back on the article's setting. A stored artefact
 * stays fresh either way, because `generationKey` treats the two models as one
 * generation.
 */
export const ALWAYS_HIGH_POWER: ReadonlySet<Task> = new Set<Task>(["simple", "referee-hidden-check"]);

/** The power `task` runs at on an article whose own setting is `articlePower`. */
export function powerFor(task: Task, articlePower: ModelPower): ModelPower {
  return ALWAYS_HIGH_POWER.has(task) ? "high" : articlePower;
}

/**
 * **The OpenRouter model id for a tier.** Private, and it is private on purpose.
 *
 * It used to be `modelForOpenRouter(task)` and exported, which put two
 * task-shaped functions in this file's public surface — one that knows which
 * wire a task is on and one that does not — and the one that does not would
 * cheerfully answer for `labels`, a stage that has never spoken to OpenRouter.
 * A caller reaching for the wrong one of a similarly-named pair gets a real
 * model id and a wrong answer, which is the shape of bug this whole file is
 * organised against. So the task-level question has exactly one public answer
 * now (`modelFor`), and this one takes a tier, which is the thing it actually
 * depends on.
 */
function openRouterIdForTier(tier: Tier, power: ModelPower): string {
  if (tier === "quick") return QUICK_MODEL_OPENROUTER;
  /* **Only the capable tier moves.** The quick tier's jobs were put there because
     they do not need reasoning, and doubling them buys nothing (plan 260930f
     decision 2). */
  return power === "high" ? HIGH_POWER_MODEL_OPENROUTER : CAPABLE_MODEL_OPENROUTER;
}

/**
 * **Who serves every model call in this app — all of them.**
 *
 * Was a two-member union (`"anthropic" | "openrouter"`) until 2026-08-27, when
 * the seven pipeline stages moved off the Anthropic SDK's own endpoint and onto
 * OpenRouter's Anthropic-compatible one. It was then a **one**-member union, and
 * that was not a mistake either: it was the decision, written where a future
 * reader would trip over it. See docs/plans/260827q-ai-cost-tracking.md and
 * src/messages-stream.ts.
 *
 * **`"openai"` arrived on 2026-09-02, and it is the first genuine exception.**
 * Live conversation talks to OpenAI's Realtime API directly, because OpenRouter
 * has no realtime API at all — checked 2026-08-31, its two audio endpoints are
 * batch speech and batch transcription, and there is no duplex speech-to-speech
 * to route to. So the choice was OpenAI directly or no live mode, and the
 * sentence this docstring used to open with ("who serves every model call in
 * this app — all of them") stopped being true the day that shipped.
 *
 * Widening it here is not a licence: `src/live.ts` is still the only file in
 * `src/` allowed to name OpenAI, and `tests/no-undeclared-spend.test.ts` is what
 * keeps that so. This union exists so the *ledger* can say which bill a row
 * lands on — see `ProviderAccount` in src/ai-spend.ts, which is the same
 * distinction one layer down.
 */
export type Provider = "openrouter" | "openai";

/**
 * The one gateway. Every paid call in this app goes through it **except live
 * conversation's realtime session**, which has nowhere to be routed — see
 * `Provider` above and docs/project/ai-gateway.md.
 */
export const GATEWAY: Provider = "openrouter";

/**
 * **Which protocol a task speaks** — the axis that still varies now that the
 * vendor does not.
 *
 * `"messages"` is Anthropic's Messages shape, over
 * [`src/messages-stream.ts`](messages-stream.ts). `"chat"` is OpenAI's
 * chat/completions shape, over
 * [`src/openrouter-stream.ts`](openrouter-stream.ts). Both reach OpenRouter;
 * they differ in what the request and the response look like, which is a real
 * difference to a caller and none at all to the bill.
 *
 * The seven stages stayed on `"messages"` rather than being translated, because
 * `thinking: {type: "adaptive"}` does not exist on the other one — OpenRouter's
 * `reasoning.effort` takes `max|xhigh|high|medium|low|minimal|none` and answers
 * `adaptive` with a 400. All seven send it.
 *
 * `"embeddings"` is the third, and it is a wire rather than a flavour of `"chat"`
 * because it is a different endpoint (`/v1/embeddings`) with a different request
 * and a different response. Folding it into `"chat"` would have made the one
 * field that says *what this request looks like* say something untrue about the
 * only call in the app that does not carry messages at all.
 *
 * **`"realtime"` is the fourth, and it is the one that is not a request at
 * all.** Live conversation is a WebRTC session the *browser* holds open to
 * OpenAI: there is no request body this server sent and no response body it
 * received, and the usage arrives afterwards as events the tab forwards back
 * (docs/project/live-conversation.md). Every other wire's row is written by the
 * gateway that made the call; a realtime row is written by an acceptance
 * endpoint from a report. That is a large enough difference to deserve its own
 * value, and the `wire` column is exactly the field a reader should look at
 * before summing anything across it — a realtime `reported_input_tokens` counts
 * the whole conversation so far, rebilled every turn, which is not what any
 * other wire means by the name.
 *
 * **`"images"` is the fifth, and it is the one whose answer is not text.**
 * `POST /v1/images` on the same gateway, with the same `Authorization`, the
 * same attribution headers and the same `usage` block — so the *money* reads
 * exactly as it does on the chat wire, which is the whole reason the picture
 * goes through OpenRouter rather than round the outside of it. What differs is
 * the body: it comes back as `data: [{ b64_json, media_type }]` and there is no
 * `choices` array anywhere in it, so no chat parser can read it and none is
 * asked to.
 *
 * It is a wire rather than a flavour of `"chat"` for `"embeddings"`'s reason,
 * one notch stronger. A reader summing `output_tokens` across the two would be
 * adding a plate's `image_tokens` — a different unit, on a different rate card
 * — to a paragraph's words, and the `wire` column is exactly the field they are
 * told to check first. `openRouterImage` in [`src/ai-call.ts`](ai-call.ts) is
 * the seam, and `AI_JOB_ROUTE` there states this value per route rather than
 * deriving it from the path.
 */
export type Wire =
  | "messages"
  | "chat"
  | "embeddings"
  | "realtime"
  | "images"
  /**
   * **`POST /v1/audio/transcriptions`** — dictation, and nothing else
   * (2026-09-07).
   *
   * Its own value rather than `chat` for the reason the doc above gives about
   * summing across the column: the model we transcribe with reports **no tokens
   * at all** (`gpt-transcribe`, measured at 3 seconds of audio and at 22; the
   * protocol allows optional ones under different names, and `WireUsage` reads
   * those too). So every token column on such a row is null, and a
   * `SUM(reported_input_tokens)` that did not read `wire` would be quietly
   * counting a different population than it thought. It also reports `cost: 0`
   * on both calls anybody has measured, which is a second reason a row on this
   * wire should not be read like a chat row.
   */
  | "transcription"
  /**
   * OpenRouter's Decisions API. It returns named typed answers rather than a
   * chat completion. The product gateway speaks it since 2026-10-02, for
   * quick search (`search-quick`, `openRouterDecisions` in src/ai-call.ts);
   * the shelf-topics eval's declared Jev bypass speaks it too. Either way the
   * ledger row must name the protocol it actually used rather than calling
   * those tokens chat tokens.
   */
  | "decisions";

/**
 * **Which wire each task is on** — and the reason this is a `Record` rather
 * than the two lists it replaced.
 *
 * A list plus "everything else is the default" makes an unassigned task *work*:
 * it gets an answer, sends nothing different, and is reported with whichever
 * spelling the default implies however it really ran. A `Record<Task, Wire>` can
 * only be wrong by not compiling. `tests/models.test.ts` still checks the
 * derived lists, but the guarantee that matters is this type.
 *
 * This fact used to have a second copy — `task === "explain" || task === "chat"
 * || task === "search"` inside `modelsInUse` in src/routes.ts — and it was the
 * copy that decided what the profile page *claimed*, while this file decided
 * what ran. Two copies of that pair disagree silently.
 */
export const TASK_WIRE: Record<Task, Wire> = {
  structure: "messages",
  labels: "messages",
  arc: "messages",
  tweets: "messages",
  glossary: "messages",
  ideas: "messages",
  quotes: "messages",
  sketch: "messages",
  timeline: "messages",
  illustrated: "messages",
  quiz: "messages",
  faq: "messages",
  relations: "messages",
  "debate-claims": "messages",
  crossrefs: "messages",
  simple: "messages",
  skim: "messages",
  explain: "chat",
  chat: "chat",
  "quiz-mark": "chat",
  "quiz-verdict": "chat",
  /* Inside the `simple` step, but on the chat wire: the request plan 261001h
     measured, through the quick tier's only wire. */
  "simple-check": "chat",
  search: "chat",
  "referee-mirror": "chat",
  "referee-hidden-check": "chat",
  "referee-criteria": "chat",
  "referee-claims": "chat",
  "referee-candidates": "chat",
  "pdf-frontmatter": "chat",
  /* **The one pipeline step on this wire**, and the reason is `openrouter:web_search`:
     a server-side tool that exists on chat/completions and not on the Messages
     shape. Every other artefact-producing step is `"messages"`. See `Task`
     above, and src/pdf-read.ts for the precedent. */
  debate: "chat",
  /* `debate`'s reason: the web search is a chat/completions tool. */
  "debate-check": "chat",
  bibliography: "messages",
  /* Chat, because `openrouter:web_search` is a server tool on chat/completions
     and does not exist on the Messages shape — `debate`'s reason. */
  "citation-find": "chat",
  /* Chat, for `citation-find`'s reason: it is the same web-search call. */
  "upload-source-guess": "chat",
  /* Chat, for `citation-find`'s reason — the web-search server tool. */
  "author-lookup": "chat",
  /* Chat, for `citation-find`'s reason — the web-search server tool — and
     because a reader watches it stream. */
  "citation-investigate": "chat",
  /* Chat, the wire of the press it runs inside; no tools, one JSON answer. */
  "citation-paper-passages": "chat",
  /* Chat, for the same reason: no tools, one JSON answer, inside that press. */
  "citation-influence": "chat",
  /* Chat, for `citation-find`'s reason — the web-search server tool — and
     the quick tier's only wire. */
  "dig-deeper-search": "chat",
  /* Chat, and for this one task the wire is not a free choice: it is the only
     one `QUICK_MODEL_OPENROUTER` is served on, which is what the throw at the
     bottom of this file is about. A reader is watching it stream, so it would
     have been this wire anyway. */
  "link-summary": "chat",
};

/** Which protocol this task's model call speaks. */
export function wireFor(task: Task): Wire {
  return TASK_WIRE[task];
}

/**
 * **Which protocol each paying job speaks** — `TASK_WIRE` plus the jobs in the
 * other `AiJob` categories.
 *
 * Spread rather than retyping the task rows, so they have one home and cannot drift
 * from it. `Record<AiJob, Wire>` again, for the reason `TASK_WIRE` gives: a job
 * nobody assigned fails to compile rather than quietly getting a default and
 * then being reported however the default implies.
 */
export const AI_JOB_WIRE: Record<AiJob, Wire> = {
  ...TASK_WIRE,
  pdf: "chat",
  "pdf-figure-locate": "chat",
  /* A strict JSON schema back, on chat/completions like the eval that chose it. */
  "shelf-topics": "chat",
  /* A strict JSON schema back, on chat/completions. src/paper-metadata.ts. */
  "paper-metadata": "chat",
  /* A strict JSON schema back, on chat/completions. src/reading-difficulty.ts. */
  "reading-difficulty": "chat",
  /* A strict JSON schema back, on chat/completions. src/title-tidy-model.ts. */
  "title-tidy": "chat",
  /* A strict JSON schema back, on chat/completions. src/front-matter-authors.ts. */
  "front-matter-authors": "chat",
  /* A strict JSON schema back, on chat/completions. src/chat-gist.ts. */
  "chat-gist": "chat",
  /* Explain's wire: it is an explain call with a different job name. */
  "dig-deeper": "chat",
  dictation: "transcription",
  /* OpenRouter's Decisions API — typed probabilities, not a chat completion.
     src/quick-search.ts through `openRouterDecisions`. */
  "search-quick": "decisions",
  /* The command bar's sentence: Jev's `choice` on the Decisions wire, then a
     small JSON answer on chat/completions for the words. src/command-pick-call.ts. */
  "command-pick": "decisions",
  "command-pick-words": "chat",
  /* The bar's short list: one small JSON answer. src/command-suggest-call.ts. */
  "command-suggest": "chat",
  /* A streamed answer in prose, on chat/completions. src/help-chat-call.ts. */
  "help-chat": "chat",
  embeddings: "embeddings",
  /* **What an eval would use if it went through the gateway** — and `rescue`,
     the only one that does, posts to chat/completions. The declared bypasses in
     `evals/declared-spend.ts` do not consult this table at all: they say which
     wire they actually used, because they are the thing that knows. */
  eval: "chat",
  /* Both halves of a live session — the realtime model that answers and the
     transcriber that writes down what the reader said — arrive on the one
     WebRTC data channel, so they share a wire and are told apart by
     `requested_model` and by `ai_calls.event_kind`. See `Wire` above. */
  live_conversation: "realtime",
  /* `gjd-remote push-env`'s key-name classifier. chat/completions, because that
     is the only wire QUICK_MODEL_OPENROUTER is served on — the same fact the
     throw at the bottom of this file is about. */
  "env-proposal": "chat",
  /* The Illustrated sub-mode's plate. `POST /v1/images`, whose answer is
     `data[]` and not a chat completion — see `Wire` above. */
  illustrate: "images",
};

const ALL_TASKS = Object.keys(TASK_WIRE) as Task[];

/** The seven that speak Anthropic's Messages shape — the unwatched pipeline work. */
export const PIPELINE_TASKS: readonly Task[] = ALL_TASKS.filter(
  (t) => TASK_WIRE[t] === "messages",
);

/** The three on OpenAI's chat shape — the calls a reader sits and waits on. */
export const REQUEST_PATH_TASKS: readonly Task[] = ALL_TASKS.filter(
  (t) => TASK_WIRE[t] === "chat",
);

/**
 * **The environment variable that overrides each task's model, or `null` for
 * the tasks that have none.**
 *
 * `null` rather than a missing key, so adding a `Task` is a compile error here
 * too — "this one has no override" should be a decision somebody made rather
 * than a line nobody wrote.
 *
 * The seven pipeline stages have none because none of them reads one: they hand
 * `CAPABLE_MODEL` straight to `messages.create`. `SPIDERYARN_PIPELINE_EFFORT`
 * is not the counterexample — that overrides effort, not the model, and
 * `effortFor` is where it lives.
 */
export const MODEL_ENV_VAR: Record<Task, string | null> = {
  structure: null,
  labels: null,
  arc: null,
  tweets: null,
  glossary: null,
  ideas: null,
  quotes: null,
  sketch: null,
  timeline: null,
  illustrated: null,
  quiz: null,
  faq: null,
  relations: null,
  "debate-claims": null,
  crossrefs: null,
  simple: null,
  skim: null,
  bibliography: null,
  /* It has one because it is on the chat wire, and every chat-wire task does —
     `REQUEST_PATH_TASKS` is derived from `TASK_WIRE`, and tests/models.test.ts
     holds each of them to an override, `debate` included. 8d523739 took it out
     to quiet the environment inventory and turned this test red on `dev`
     instead; the inventory's answer is its group of comparison-run names, where
     it now sits (tests/env-names-are-inventoried.test.ts). The question it is
     for — does a cheaper model pick the right page as often — is answered by
     running the real feature against another model. */
  "citation-find": "SPIDERYARN_CITATION_FIND_MODEL",
  "upload-source-guess": "SPIDERYARN_UPLOAD_SOURCE_GUESS_MODEL",
  /* Every chat-wire task has one (tests/models.test.ts); for a comparison run
     of whether another model finds the author as often. */
  "author-lookup": "SPIDERYARN_AUTHOR_LOOKUP_MODEL",
  "citation-investigate": "SPIDERYARN_CITATION_INVESTIGATE_MODEL",
  /* Plan 261001a says this runs on the quick check's model, not merely its
     tier. Share the override too: otherwise setting the quick check's model
     would quietly make the two calls diverge while the UI and plan still said
     they were the same model. The spend row remains its own job. */
  "citation-paper-passages": "SPIDERYARN_CITATION_FIND_MODEL",
  /* Shares the press's own override rather than adding a name: the call is
     only ever made with `DIG_DEEPER_MODEL` passed in (src/citation-investigate.ts),
     so this entry is never what picks its model. */
  "citation-influence": "SPIDERYARN_CITATION_INVESTIGATE_MODEL",
  explain: "SPIDERYARN_EXPLAIN_MODEL",
  chat: "SPIDERYARN_CHAT_MODEL",
  "quiz-mark": "SPIDERYARN_QUIZ_MARK_MODEL",
  "quiz-verdict": "SPIDERYARN_QUIZ_VERDICT_MODEL",
  /* For a comparison run only: the checker's rates (plan 261001h) were
     measured on the quick tier's model, and a different one is a new
     measurement. */
  "simple-check": "SPIDERYARN_SIMPLE_CHECK_MODEL",
  /* For a comparison run: does another model write as good a search, for the
     price. The answer the reader reads is not this — it is `DIG_DEEPER_MODEL`. */
  "dig-deeper-search": "SPIDERYARN_DIG_DEEPER_SEARCH_MODEL",
  search: "SPIDERYARN_SEARCH_MODEL",
  /* It has one because comparing two models on the same cached transcriptions is
     exactly what `evals/pdf/titles.mts` does, and a code change to run an arm
     would make the arm and the shipped path different things. */
  "pdf-frontmatter": "SPIDERYARN_PDF_FRONTMATTER_MODEL",
  "referee-mirror": "SPIDERYARN_REFEREE_MIRROR_MODEL",
  "referee-hidden-check": "SPIDERYARN_REFEREE_HIDDEN_CHECK_MODEL",
  "referee-criteria": "SPIDERYARN_REFEREE_CRITERIA_MODEL",
  "referee-claims": "SPIDERYARN_REFEREE_CLAIMS_MODEL",
  "referee-candidates": "SPIDERYARN_REFEREE_CANDIDATES_MODEL",
  /* It has one because it is on the chat wire, where every other task does —
     and because the one comparison this stage will actually want is *kept
     verified rows per dollar* across models and engines, which the plan defers
     until there is a rate to compare. A code change to run an arm would make
     the arm and the shipped path different things. */
  debate: "SPIDERYARN_DEBATE_MODEL",
  /* Shares Debate's override rather than adding a name: a check is pass B's
     call on the reader's claims, and a comparison run of one should move
     both. */
  "debate-check": "SPIDERYARN_DEBATE_MODEL",
  /* It has one because "is the cheap model good enough for this" is a question
     somebody will want to answer by running the real feature against a capable
     model for an evening rather than by editing the tier table and rebuilding.
     The same goes for `quiz-verdict` above, the other quick-tier task — it was
     the only one until 2026-09-07. */
  "link-summary": "SPIDERYARN_LINK_SUMMARY_MODEL",
};

/** What a task will really send, and whether anything overrode the code to say so. */
export type ResolvedModel = {
  /** The wire id, in OpenRouter's spelling — which is now the only spelling. */
  id: string;
  /** Who serves it. Always OpenRouter; kept as a field so the page can say so. */
  provider: Provider;
  /** Which protocol it speaks — `"messages"` or `"chat"`. */
  wire: Wire;
  /** `"override"` when an environment variable put this id here. */
  source: "default" | "override";
};

/**
 * **What a task will actually send** — the one resolver, used both by the three
 * calls that send it and by the route that reports it.
 *
 * **It reads the environment, and an earlier version of this function
 * deliberately did not.** That was wrong, and a GPT-5.6-sol review of this
 * change said so on 2026-08-27. The reasoning had been that `/profile` should
 * show what the *code* says rather than what a machine is set to — but the page
 * says, in its own words, that it shows "what the server is configured with",
 * and with `SPIDERYARN_CHAT_MODEL` set it would have named a model chat was not
 * using. A page whose whole purpose is to answer *which model writes what* must
 * not have a second answer it cannot see. Overrides exist precisely so somebody
 * can run a comparison; the moment one is set is the moment the question gets
 * interesting.
 *
 * `source` is how it stays honest without lying in the other direction: the
 * page can say a row came from the environment rather than from this file, so
 * a reader is never told a one-off experiment is the app's configuration.
 *
 * Read at call time, not at module load, exactly like the code it replaced —
 * the three call sites had `process.env.SPIDERYARN_*_MODEL || DEFAULT_MODEL` as
 * a default parameter, which is evaluated per call. That matters here: several
 * modules call `loadEnvLocal()` inside a function rather than at import, so an
 * id captured at module load can be captured before `.env.local` has been read.
 */
/**
 * **A task held on a model its tier has moved past** — the exception to
 * "always the latest of each family" (docs/project/setup-dev.md § Which model
 * everything uses), and only where a measurement says the newer one is worse
 * at this job. Each entry says what was measured; an entry without that is a
 * task quietly left behind.
 *
 * `simple-check`, Summary's fidelity guard, stays on GPT-5.6 Luna (plan
 * 261009a): re-run on GPT-6 Luna over the 261001h labels it caught the same
 * 21 of 26 faults but raised 44 new alarms on faithful paragraphs — none of
 * them a real fault on a hand read — and every alarm makes Opus rewrite that
 * level. evals/results/fidelity-guard-luna6-new-alarms-2026-10-09.md.
 */
const PINNED_MODEL: Partial<Record<Task, string>> = {
  "simple-check": "openai/gpt-5.6-luna",
};

export function resolveModel(task: Task, power: ModelPower): ResolvedModel {
  const wire = TASK_WIRE[task];
  const envVar = MODEL_ENV_VAR[task];
  const override = envVar ? process.env[envVar] : undefined;
  /* **An override still wins at high power.** It is somebody running a
     comparison on purpose, and the comparison is what they asked for. */
  if (override) return { id: override, provider: GATEWAY, wire, source: "override" };
  const pinned = PINNED_MODEL[task];
  if (pinned !== undefined) return { id: pinned, provider: GATEWAY, wire, source: "default" };
  /* One spelling now, for every task on either wire: OpenRouter's. The Skin
     wants `anthropic/claude-sonnet-5.5` exactly as chat/completions does. */
  return {
    id: openRouterIdForTier(TASK_TIER[task], power),
    provider: GATEWAY,
    wire,
    source: "default",
  };
}

/**
 * **The model id a task actually sends** — the whole of it, environment
 * included. This is the only task-level model question with a public answer.
 *
 * `power` is required: the article a call is for decides it, and a caller that
 * has not asked would quietly send Sonnet on a high-powered article (plan
 * 260930f decision 5). Scripts and evals pass `"standard"`.
 */
export function modelFor(task: Task, power: ModelPower): string {
  return resolveModel(task, power).id;
}

/* **`DISPLAY_NAME` and `displayName` live in src/model-names.ts**, which
   imports nothing, so the browser can name a stored model id the way /profile
   does (a chat thread's (i), plan 261008c § 2). Re-exported here, where every
   server caller has always found them. */
export { DISPLAY_NAME, displayName } from "./model-names.js";

/**
 * **The model calls this app makes that are not a `Task`**, in the shape the
 * profile page wants them.
 *
 * None belongs on a tier — a tier is a reusable judgment about how much
 * *reasoning* a task needs, while each of these has a fixed model chosen for
 * its own protocol, latency, measurement or product constraint.
 *
 * They are here anyway, because "not a tier decision" and "not worth telling
 * the reader about" are different claims, and a page called *what's running*
 * was making the second one by accident: it listed ten Claude jobs and omitted
 * both of the app's calls to a model from somebody else. Sharing an inventory
 * does not merge the decisions.
 *
 * `EMBEDDING_MODEL` is imported rather than repeated. It lives in
 * src/embeddings.ts because it was chosen by a measurement that belongs beside
 * the code that ran it, and copying the string here to avoid one import is
 * exactly the two-copies-of-one-fact problem this whole change is about.
 */
export const NON_TASK_MODELS: readonly {
  job: NonTaskAiJob;
  id: string;
  provider: Provider;
}[] = [
  { job: "pdf", id: PDF_READER_MODEL, provider: "openrouter" },
  { job: "embeddings", id: EMBEDDING_MODEL, provider: "openrouter" },
  { job: "dictation", id: DICTATION_MODEL, provider: "openrouter" },
  { job: "pdf-figure-locate", id: PDF_FIGURE_LOCATOR_MODEL, provider: "openrouter" },
  { job: "shelf-topics", id: SHELF_TOPICS_MODEL, provider: "openrouter" },
  { job: "paper-metadata", id: PAPER_METADATA_MODEL, provider: "openrouter" },
  { job: "reading-difficulty", id: READING_DIFFICULTY_MODEL, provider: "openrouter" },
  { job: "title-tidy", id: TITLE_TIDY_MODEL, provider: "openrouter" },
  { job: "front-matter-authors", id: FRONT_MATTER_AUTHORS_MODEL, provider: "openrouter" },
  { job: "chat-gist", id: CHAT_GIST_MODEL, provider: "openrouter" },
  { job: "search-quick", id: QUICK_SEARCH_MODEL, provider: "openrouter" },
  { job: "command-pick", id: COMMAND_PICK_MODEL, provider: "openrouter" },
  { job: "command-pick-words", id: QUICK_MODEL_OPENROUTER, provider: "openrouter" },
  { job: "command-suggest", id: QUICK_MODEL_OPENROUTER, provider: "openrouter" },
  { job: "help-chat", id: HELP_CHAT_MODEL, provider: "openrouter" },
  /* `DIG_DEEPER_MODEL` in src/dig-deeper.ts is this same constant; named here
     by its source because that file imports this one. */
  { job: "dig-deeper", id: HIGH_POWER_MODEL_OPENROUTER, provider: "openrouter" },
];


/*
 * **Seven of those rows would otherwise be a lie, and this is what stops them.**
 *
 * A pipeline stage imports `CAPABLE_MODEL` and hands it to `messages.create`. It
 * never reads `TASK_TIER`. So writing `arc: "quick"` in a table that presents
 * all ten jobs identically would change nothing at all: no error, no warning,
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
      /* **The reason moved on 2026-08-27 and the wording had to move with it.**
         It used to say the stage "runs through the Anthropic SDK and
         ${QUICK_MODEL_OPENROUTER} is only reachable through OpenRouter" — a
         *vendor* fact, and true until the pipeline moved onto OpenRouter too.
         Left alone it would have gone on throwing at the right moment while
         giving a reason that is now true of every model in the app and
         therefore says nothing: the reader would go and check that OpenRouter
         was reachable, find that it was, and be no closer. What still separates
         them is the wire. */
      `src/models.ts: task "${task}" is set to the quick tier, but it speaks Anthropic's ` +
        `Messages shape and ${QUICK_MODEL_OPENROUTER} is only served on the chat/completions one. ` +
        `Both go through OpenRouter; the protocols are what differ, and all seven pipeline ` +
        `stages send thinking:{type:"adaptive"}, which chat/completions has no equivalent for. ` +
        `Moving the stage means rewriting its call onto the other wire — the tier table ` +
        `cannot do it alone. See docs/project/ai-gateway.md.`,
    );
  }
}

/**
 * The reasoning levels this app asks for in `output_config.effort`.
 *
 * A tuple with the type derived from it, so there is a list to check a string
 * against at run time (`pipelineEffortOverride` below). A bare union type is
 * gone by then, which is how a cast came to stand in for a check.
 */
export const EFFORTS = ["low", "medium", "high"] as const;
export type Effort = (typeof EFFORTS)[number];

/**
 * **`SPIDERYARN_PIPELINE_EFFORT`, checked.** The whole-run override, or
 * `undefined` when it is unset or empty.
 *
 * The one place the variable is read. `effortFor` below, src/bibliography.ts and
 * src/skim.ts each call this and supply their own fallback; until 2026-10-04
 * each of the three read `process.env.SPIDERYARN_PIPELINE_EFFORT as Effort |
 * undefined` for itself. A cast checks nothing, so a typo (`hgih`) went to the
 * provider as the effort, and so did an empty string, because `"" ?? fallback`
 * is `""`.
 *
 * **A value that is not one of the three throws**, naming the variable and the
 * three values. It does not fall back. This is a developer's knob, set on
 * purpose for an eval, and a run that silently used the default instead would
 * be a wrong measurement with nothing to say it was one. No deployment sets it
 * (tests/env-names-are-inventoried.test.ts), so no reader's request can meet
 * the throw.
 *
 * Empty is unset, not an error: `NAME= npm run …` is how a shell clears a
 * variable for one command.
 *
 * Read at call time, not at module load, like every other override in this
 * file: an eval sets it around one run and restores it (evals/prompt-caching.ts,
 * evals/thinking-effort/run.ts), and the message quotes the bad value, which is
 * a developer's own typing and never article text.
 */
export function pipelineEffortOverride(): Effort | undefined {
  const raw = process.env.SPIDERYARN_PIPELINE_EFFORT;
  if (raw === undefined || raw === "") return undefined;
  const known = EFFORTS.find((effort) => effort === raw);
  if (known === undefined) {
    throw new Error(
      `SPIDERYARN_PIPELINE_EFFORT is ${JSON.stringify(raw)}, which is not an effort. ` +
        `Set it to low, medium or high, or unset it to use each stage's own.`,
    );
  }
  return known;
}

/**
 * The stages that read the whole article and could share one cached copy of it.
 *
 * **Could, and today none does**: a share also needs the same effort and the
 * same output schema, and every stage here has its own schema.
 * `sharesArticleCache` in src/pipeline.ts is the policy, and
 * tests/article-cache-group.test.ts asserts that no distinct pair passes it.
 *
 * **`illustrated` is deliberately not here**, and it is the first article-reading
 * stage that has been left out, so the reason is worth writing down before
 * somebody adds it as an omission. This union is not "stages that read the
 * article" — it is stages that send a bare `articleText` or `articleWithIds`
 * block, grouped by `ARTICLE_RENDERER` below. `illustrated` sends
 * `articleWithIds` wrapped in an explicit ARTICLE / END ARTICLE fence,
 * because its answer is handed to a second model and
 * the fence is what says the page is data (src/illustrated.ts). Those are
 * different bytes from the bare rendering `ideas`, `sketch`, `timeline` and
 * `quiz` send, so treating it as a bare `ids` stage would misstate one cache
 * dimension — the exact mistake `sharesArticleCache` was made
 * to read explicit cache dimensions to avoid, and the one tests/article-cache-group.test.ts
 * exists for.
 *
 * `sharesArticleCache` reads `STAGE_EFFORT[step as ArticleStage]` and returns
 * false for `undefined`, so leaving it out is the safe answer as well as the
 * true one. **If the fence ever moves into the SYSTEM block** — which would
 * make the article block bare again — this is where the row goes, and
 * `ARTICLE_RENDERER` gets `"ids"`. That alone would buy no share: it would
 * still need a schema in common with another stage.
 */
export type ArticleStage =
  | "arc"
  | "tweets"
  | "glossary"
  | "quotes"
  | "ideas"
  | "sketch"
  | "timeline"
  | "quiz"
  | "faq"
  | "relations"
  | "debate-claims"
  | "crossrefs"
  | "simple";

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
 * docs/research/260826b-prompt-caching-anthropic.md, which also corrects that doc's
 * earlier claim that generation parameters stay out of the key. `temperature`
 * and `max_tokens` do; this one does not, and nothing about "it's a generation
 * parameter" would have told you which.
 *
 * **This table is one of three cache dimensions.** Two stages share a cached
 * article only if they share a value here, send the same article bytes (see
 * `ARTICLE_RENDERER` below), and send the same `output_config.format` (see
 * `ARTICLE_OUTPUT_FORMAT` in pipeline.ts). Effort alone was correct only while
 * every stage happened to share the other two values.
 *
 * **The values are not aligned, on purpose.** When this was written, aligning
 * them would have let all three share (it would not now: their schemas differ),
 * and it was tested on two articles rather than assumed: arc at `medium`
 * loses 11 points of vocabulary retention on one of them, and glossary at `high`
 * gets measurably more formulaic on the other while spending 4,558 more output
 * tokens. Neither trade is worth making to win a cache, so each stage keeps the
 * setting its writing wants. The numbers
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
  /* `medium`, and it is the same setting for the same reason the glossary's is:
     choosing the sentence a piece turns on is a judgment about *this* text with
     the text in front of it, not the multi-step inference `ideas` makes when it
     argues a piece collapses without an unstated premise.

     It used to be cache-compatible with Glossary: same model, effort, renderer
     and article bytes. Their distinct output schemas now keep them apart. GPT Sol,
     2026-08-31; plan 261001s, 2026-10-02.

     **And until 2026-09-03 it was not real even there**, which is worth leaving
     here because this comment was right in intent and the code did not deliver
     it: the predicate looked only at *later* steps, so `glossary` wrote the
     entry and `quotes` — last in the group, always — sent no breakpoint and read
     nothing. Measured at 25,428 wasted cached tokens on a 17,000-word article.
     docs/postmortems/260903c-the-conditional-article-cache-breakpoint-marks-the-writer-but-never-the-reader.md.

     Their schemas differ, so this historical pair is no longer compatible even
     though effort and article bytes still match.
     Untested, like every effort choice that has not been through
     evals/results/effort-vs-quality.md, and said out loud so the next person
     knows it is a guess rather than a measurement. */
  quotes: "medium",
  /* `high`: finding an unstated premise and then arguing that the piece
     collapses without it is the hardest judgment any stage here makes — harder
     than the glossary's "is this word obvious", which is what `medium` was
     measured to be enough for.

     **It buys no cache share.** Matching the other `ids` + `high` stages on
     effort and article bytes is no longer sufficient: every stage now sends a
     different schema. `ARTICLE_OUTPUT_FORMAT` in pipeline.ts records that
     third dimension. */
  ideas: "high",
  /* **`low`, MEASURED 2026-10-01, against the `high` it had shipped with.**
     Eight articles, two draws per arm, two blind judges — GPT Sol ranking,
     Opus scoring — and no visible loss: mean U 1.56 and 1.69, where 2.0 is no
     difference. Not "as good everywhere": the per-article verdicts point both
     ways, and no direction holds. It is 58% cheaper and about four times faster
     per call ($0.235 → $0.100, 176 s → 42 s), and validity was the same at both
     levels, 1 malformed draw in 16.
     docs/investigations/261001c-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md
     § Sketch.

     The argument this comment used to make for `high` — the stage has to hold a
     whole geometry in its head while deciding what the argument's shape is — is
     superseded by that measurement: it was a reason, never a number, and two
     blind judges did not find `low` worse. A loss too small for them to see on
     eight articles may still exist, and Opus (high-powered AI) runs at `low`
     too, untested — that doc's § What this does not show.

     Its `low` effort alone would keep it out of the former `ids` + `high`
     group; distinct schemas now separate every member anyway. It shares a
     cached article with nothing. That costs close to nothing today, because each
     mode is its own job and two jobs share no cache
     (docs/investigations/261001b-cost-per-article-and-the-cross-mode-article-cache/README.md).
     It is a constraint on plan 261001o's caching options, which assumed one
     effort per group. */
  sketch: "low",
  /* `high`. It matches `ideas`, `quiz`, `faq`, `simple` and `tweets` on effort
     and article bytes, but its event schema differs from all of theirs, so the
     former `ids/high` cache group has dissolved.

     The judgment it is being paid for is the sequence — putting a piece that
     recounts the same three months three times, once per participant, back into
     one order. That is multi-step inference over the whole article at once, and
     it is the ONLY ordering the mode has: Greg's call is that the dates label
     the rows and never sort them (docs/plans/260831i-timeline-mode.md § Ordering), so
     an `order` the model got wrong is a timeline that is wrong, with nothing
     downstream to correct it. Untested, like every effort choice that has not
     been through evals/results/effort-vs-quality.md. */
  timeline: "high",
  /* `high`. Its question schema differs from every other `ids/high` stage, so
     matching effort and article bytes buys no cache share.

     The judgment it is being paid for is the `hard` band — a question whose
     answer is a move the argument makes across several passages, which is
     multi-step inference over the whole article at once, and the same thing
     `ideas` is paid `high` for. An `easy` question needs none of it, and
     `medium` is what a model reaches for when it has stopped reading the
     argument, so a batch that skews there is the failure this stage has.
     Untested, like every effort choice that has not been through
     evals/results/effort-vs-quality.md. */
  quiz: "high",
  /* `high`. Its FAQ schema differs from every other `ids/high` stage, so it
     shares no cached article despite matching their effort and body rendering.
     What it is paid for is reading the
     argument closely enough to feel where a careful reader would push back.
     Untested, like every effort choice not yet through
     evals/results/effort-vs-quality.md. docs/plans/260916d-faq-mode.md. */
  faq: "high",
  /* `low`, the lowest value in this table (`sketch`'s, which was measured; this
     is NOT). What it is paid for is one word of ten per paragraph, each judged
     against the paragraph before it — the lightest judgment any stage here
     makes, lighter than the `medium` that `crossrefs` and `quotes` take for
     reading rather than inference. Its bytes are `faq`'s and its effort is
     `sketch`'s, but all three schemas differ, so it shares a cached article
     with nothing. Untested, like every effort choice not yet through
     evals/results/effort-vs-quality.md; the plan names the quick tier as the
     next thing to measure. docs/plans/261003f-marginalia-relation-words-and-timeline-events.md. */
  relations: "low",
  /* `high`, `faq`'s: what it is paid for is reading the argument closely
     enough to tell the claims it rests on from the ones it merely mentions,
     and which of those an outsider could dispute. Its own schema, so it shares
     no cached article. **NOT MEASURED**, like every effort choice not yet
     through evals/results/effort-vs-quality.md.
     docs/plans/261008i-debate-claims-picked-by-the-reader.md. */
  "debate-claims": "high",
  /* `medium`, the plan's call: matching a claim to the paragraph that backs it
     is reading, not the multi-step inference `ideas` and `quiz` are paid `high`
     for. **It therefore shares a cached prefix with nothing** — the same bytes
     as `ideas`, a different effort — and that costs nothing today, because the
     after-import box queues every mode as its own job and two jobs share no
     cache anyway. Untested, like every effort choice not yet through
     evals/results/effort-vs-quality.md.
     docs/plans/260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md. */
  crossrefs: "medium",
  /* **`high`, MEASURED 2026-09-30, against the plan's `medium`.** Three local
     articles at each (a dense paper, an essay, a talk), with the shipped
     prompt: the wall clock was the same (11–12 s at `high`, 10–12 s at
     `medium`) and so was the cost (2–5 cents), because an answer this short
     leaves adaptive thinking little to spend. What differed was fidelity: both
     `medium` runs on the paper turned its "recurrent connections" (which raise
     synergy) into "feedback loops" (which, in the same paper, lower it), and the
     `high` run kept the author's term. Evidence, not a distribution —
     evals/simple/results-260930.md. Its paragraph schema differs from every
     other `ids/high` schema, so it shares no cached article, and it sits after
     `faq` in `STEP_ORDER` (src/step-order.ts). */
  simple: "high",
};

/**
 * **Which rendering of the article each stage sends** — the second of the
 * three cache dimensions (effort, renderer, output format).
 *
 * A cache matches a byte-exact prefix. `STAGE_EFFORT` above is one thing that
 * has to agree; this is the other, and it was invisible until `ideas` arrived,
 * because until then every article-reading stage sent `articleText` and the
 * renderer could not be the thing that differed.
 *
 * `ideas` sends `articleWithIds`, because every occurrence it returns is a block
 * id and the ids therefore have to be on the page (src/article-prompt.ts says
 * why the stages that return no ids deliberately omit them). So it can never
 * share a prefix with arc, glossary or quotes however its effort is set. (This
 * said "arc, tweets or glossary" until 2026-10-01; `tweets` has sent the ids too
 * since `tweets/5` on 2026-09-29 — see its row below.)
 * And
 * `sharesArticleCache` in src/pipeline.ts reads all three values,
 * so nothing pays a 1.25x cache *write* premium for a read that cannot happen.
 *
 * The stages that send `articleWithIds` in the request path — search, explain,
 * converse — are not pipeline stages and do not appear here; they also go
 * through OpenRouter rather than the Anthropic SDK, so they share nothing with
 * this stage in practice either.
 */
export const ARTICLE_RENDERER: Record<ArticleStage, "text" | "ids"> = {
  arc: "text",
  /* `ids` since `tweets/5` (2026-09-29): each post names the blocks it came
     from, so the ids have to be on the page. It sends the body only,
     byte-identical to `ideas` and `faq`. docs/plans/260929f-tweets-become-a-mode-with-a-wide-band-and-block-links.md. */
  tweets: "ids",
  glossary: "text",
  /* The model returns the words and never a block id — src/quotes.ts § the
     header — so this sends the same bytes `glossary` does. Their schemas
     differ, so the two share no cached article all the same. */
  quotes: "text",
  ideas: "ids",
  /* Every node the picture draws may carry a block id for the reader to jump
     to, so the ids have to be on the page — the same reason `ideas` is `ids`,
     and the same consequence: different article bytes from the `text` stages. */
  sketch: "ids",
  /* Every occurrence names a block id, exactly as `ideas` does — and the
     publication date, which is the one thing this stage needs that the others
     do not, goes in the *user* prompt rather than into the head
     `articleWithIds` writes. That is deliberate: a date in the head would be
     different bytes for the same article, and would rule out a share with
     `ideas` on bytes as well as on schema, to save nothing.
     src/timeline.ts § `renderPrompt`. */
  timeline: "ids",
  /* Every piece of evidence names a block id — that is what ties a reference
     answer to the page rather than to the model's memory of it — so the ids
     have to be on the page. Different article bytes from the three
     `articleText` stages. */
  quiz: "ids",
  /* Every passage names a block id, so the ids have to be on the page — and it
     sends the body only, byte-identical to `ideas`. */
  faq: "ids",
  /* It answers block ids, so the ids have to be on the page — and it sends the
     body only, byte-identical to `ideas` and `faq`. `low` effort and its own
     schema, so no share. */
  relations: "ids",
  /* Every claim names a block id and quotes it, so the ids have to be on the
     page — and it sends the body only, byte-identical to `ideas` and `faq`.
     Its own schema, so no share. */
  "debate-claims": "ids",
  /* Two block ids a row, so the ids have to be on the page — and the body
     only, byte-identical to `ideas`. The effort differs, so no share. */
  crossrefs: "ids",
  /* Every paragraph names its passages' block ids, so the ids are on the page;
     the body only, byte-identical to `ideas`, at `high`. */
  simple: "ids",
};

/**
 * One stage's effort, with the whole-run environment override applied.
 *
 * Throws if the override is set to something that is not an effort; see
 * `pipelineEffortOverride`.
 */
export function effortFor(stage: ArticleStage): Effort {
  return pipelineEffortOverride() ?? STAGE_EFFORT[stage];
}
