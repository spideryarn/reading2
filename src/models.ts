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
 * | `CAPABLE_MODEL` | Anthropic's own spelling — sent by nothing, kept for reference | `claude-sonnet-5` |
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
 * what we show, and nothing outside this file should be choosing between the
 * two.** `modelFor(task)` gives the first, `displayName(id)` the second, and
 * `wireFor(task)` says which protocol a task speaks — which is what stopped
 * src/routes.ts keeping its own copy of the request-path list.
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
 * explain sends `max_tokens: 1500`, chat 4,000, search 4,000, and those were
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
/* ^ **Nothing puts this on the wire any more — and it is still load-bearing.**
   Since 2026-08-27 the seven stages send `CAPABLE_MODEL_OPENROUTER`, which is
   literally this string with a vendor prefix. But this one stayed, because the
   two spellings answer different questions and only one of them moved.

   On the wire, a model id is an **address**: it has to say which gateway, so it
   carries `anthropic/`. In a stored artefact's `generator` field it is a
   **name**: it says which model wrote this, and that is what every staleness
   check compares against — `glossary.ts`, `summarise.ts` and `tweets.ts` each
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

/**
 * **The model that transcribes a PDF** — its own line, because it is its own
 * decision and it is not on either tier above.
 *
 * The two tiers are about *writing*: how well a model turns an article into a
 * gist, a thread, a glossary. This one is about *reading*, and the two do not
 * predict each other. It was chosen by measurement rather than by argument —
 * ninety-odd calls over three fixture PDFs, in evals/pdf/, with the result and
 * the caveats in docs/plans/pdf-ingestion.md. It is deliberately not
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
 */
export const PDF_READER_MODEL = "openai/gpt-5.6-luna";

/**
 * **What turns a dictation into text.** Not on a tier, for the same reason the
 * PDF reader is not: a tier is a judgment about how much reasoning a job needs,
 * and this one needs none — it needs ears and a vocabulary list.
 *
 * A *chat* model rather than one of OpenRouter's nineteen dedicated
 * speech-to-text models, and that is the whole finding of
 * docs/plans/dictation-two-pass.md. Measured on 2026-08-27, one 22-second
 * sample, three runs each:
 *
 * | | latency | word errors |
 * |---|---|---|
 * | this model, vocabulary in the system prompt | 2.4s | 0.0% |
 * | this model, bare prompt | 3.3s | 3.6–7.3% |
 * | `openai/gpt-transcribe` (dedicated) | 1.6s | 3.6% |
 * | `deepgram/nova-3` (dedicated) | 1.0s | 18.2% |
 *
 * Every dedicated model got `Spideryarn` and the block id `spya-k3m9qt` wrong.
 * This one, *told what the words might be*, got them right every run. The
 * dedicated endpoint cannot be told: `POST /api/v1/audio/transcriptions`
 * accepts OpenAI's `prompt` parameter, returns 200, and ignores it — verified
 * by sending a field called `wibble_not_a_real_field` and getting the same 200.
 * docs/reusable/silent-success.md, with a status code on it.
 *
 * **Do not add `provider: { order: ["anthropic"] }` to this call.** See the
 * warning under `CAPABLE_MODEL_OPENROUTER`: pointed at a Gemini model that
 * preference is wrong, and wrong quietly.
 */
export const DICTATION_MODEL = "google/gemini-3.1-flash-lite";

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
  | "toc"
  | "labels"
  | "arc"
  | "tweets"
  | "glossary"
  | "summarise"
  | "ideas"
  | "explain"
  | "chat"
  | "search";

/**
 * **The three model calls that are not a `Task`** — and the type exists so that
 * "not on a tier" cannot go on meaning "not counted".
 *
 * `Task` is a judgment about how much reasoning a job needs, which is why
 * transcribing a PDF, turning a paragraph into a vector and turning a reader's
 * voice into words are all excluded from it; the comment on `Task` argues that
 * at length and it is still right. But **the bill does not care about tiers.**
 * Every one of these three spends real money, and a spend record keyed on `Task`
 * would have had nowhere to put them — which is exactly how they would have
 * stayed missing from a total that looked complete.
 *
 * `NON_TASK_MODELS` below is typed against this rather than against `string`, so
 * the inventory the profile page shows and the jobs the meter can name are the
 * same three by construction.
 */
export type NonTaskAiJob = "pdf" | "embeddings" | "dictation";

/**
 * **Every model call this app pays for**, whether or not it is a tier decision.
 *
 * The unit of the cost record — see [`src/ai-spend.ts`](ai-spend.ts). Adding a
 * member here without giving it a wire in `AI_JOB_WIRE` and a routing policy in
 * `AI_JOB_PROVIDER` is a compile error, which is the whole reason those are
 * exhaustive records rather than lists.
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

export type AiJob = Task | NonTaskAiJob | EvalAiJob;

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
 * list of what has to move with the model first. For the seven pipeline tasks it
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
  ideas: "capable",
  explain: "capable",
  chat: "capable",
  search: "capable",
};

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
function openRouterIdForTier(tier: Tier): string {
  return tier === "quick" ? QUICK_MODEL_OPENROUTER : CAPABLE_MODEL_OPENROUTER;
}

/**
 * **Who serves every model call in this app — all of them.**
 *
 * Was a two-member union (`"anthropic" | "openrouter"`) until 2026-08-27, when
 * the seven pipeline stages moved off the Anthropic SDK's own endpoint and onto
 * OpenRouter's Anthropic-compatible one. One member is not a mistake: it is the
 * decision, written where a future reader will trip over it. See
 * docs/plans/ai-cost-tracking.md and src/messages-stream.ts.
 */
export type Provider = "openrouter";

/** The one gateway. Every paid call in this app goes through it. */
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
 */
export type Wire = "messages" | "chat" | "embeddings";

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
  toc: "messages",
  labels: "messages",
  arc: "messages",
  tweets: "messages",
  glossary: "messages",
  summarise: "messages",
  ideas: "messages",
  explain: "chat",
  chat: "chat",
  search: "chat",
};

/** Which protocol this task's model call speaks. */
export function wireFor(task: Task): Wire {
  return TASK_WIRE[task];
}

/**
 * **Which protocol each paying job speaks** — `TASK_WIRE` plus the three that
 * are not tasks.
 *
 * Spread rather than retyped, so the ten rows have one home and cannot drift
 * from it. `Record<AiJob, Wire>` again, for the reason `TASK_WIRE` gives: a job
 * nobody assigned fails to compile rather than quietly getting a default and
 * then being reported however the default implies.
 */
export const AI_JOB_WIRE: Record<AiJob, Wire> = {
  ...TASK_WIRE,
  pdf: "chat",
  dictation: "chat",
  embeddings: "embeddings",
  /* **What an eval would use if it went through the gateway** — and `rescue`,
     the only one that does, posts to chat/completions. The declared bypasses in
     `evals/declared-spend.ts` do not consult this table at all: they say which
     wire they actually used, because they are the thing that knows. */
  eval: "chat",
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
  toc: null,
  labels: null,
  arc: null,
  tweets: null,
  glossary: null,
  summarise: null,
  ideas: null,
  explain: "SPIDERYARN_EXPLAIN_MODEL",
  chat: "SPIDERYARN_CHAT_MODEL",
  search: "SPIDERYARN_SEARCH_MODEL",
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
export function resolveModel(task: Task): ResolvedModel {
  const wire = TASK_WIRE[task];
  const envVar = MODEL_ENV_VAR[task];
  const override = envVar ? process.env[envVar] : undefined;
  if (override) return { id: override, provider: GATEWAY, wire, source: "override" };
  /* One spelling now, for every task on either wire: OpenRouter's. The Skin
     wants `anthropic/claude-sonnet-5` exactly as chat/completions does. */
  return { id: openRouterIdForTier(TASK_TIER[task]), provider: GATEWAY, wire, source: "default" };
}

/**
 * **The model id a task actually sends** — the whole of it, environment
 * included. This is the only task-level model question with a public answer.
 */
export function modelFor(task: Task): string {
  return resolveModel(task).id;
}

/**
 * **One human-readable name per model, whichever wire it went down.**
 *
 * The bug this exists for, 2026-08-27: `/profile` listed ten jobs and printed
 * each one's raw wire id, so seven rows said `claude-sonnet-5` and three said
 * `anthropic/claude-sonnet-5`. Every one of those strings was correct. The page
 * was still wrong, because a reader looking at ten rows reads two names as two
 * models, and the question the page exists to answer — *which model writes
 * what* — got a different answer depending on which transport the code happened
 * to use. The provider prefix is an addressing detail; it is not part of the
 * model's name.
 *
 * **Literals, not `id.split("/").pop()`**, and for the same reason the header
 * gives for not deriving one wire spelling from the other. Stripping the prefix
 * works for exactly the current pair and would have failed for the pair before
 * it: `anthropic/claude-sonnet-4.5` strips to `claude-sonnet-4.5`, which is not
 * what the Anthropic SDK calls that model (`claude-sonnet-4-5`) — so the two
 * rows would have gone on disagreeing while looking like they had been fixed.
 * A table cannot be wrong that way; it can only be incomplete, and
 * `displayName` says so out loud when it is.
 *
 * **Every id this app can send belongs here**, tier or no tier — which is why
 * `PDF_READER_MODEL` and `EMBEDDING_MODEL` are in it. That sentence was here
 * before either of them was, and was therefore false; a GPT-5.6-sol review
 * caught it on 2026-08-27. An inventory that quietly means "the ones that were
 * easy to enumerate" is worse than no inventory, because the next person trusts
 * it. `tests/models.test.ts` checks the claim rather than repeating it.
 */
export const DISPLAY_NAME: Record<string, string> = {
  "claude-sonnet-5": "claude-sonnet-5",
  "anthropic/claude-sonnet-5": "claude-sonnet-5",
  "openai/gpt-5.6-luna": "gpt-5.6-luna",
  "voyageai/voyage-4": "voyage-4",
  "google/gemini-3.1-flash-lite": "gemini-3.1-flash-lite",
};

/**
 * **The model calls this app makes that are not a `Task`**, in the shape the
 * profile page wants them.
 *
 * Three of them, and none belongs on a tier — a tier is a judgment about how
 * much *reasoning* a job needs, and these transcribe a PDF, turn a paragraph
 * into a vector, and turn a reader's voice into words. `PDF_READER_MODEL`,
 * `EMBEDDING_MODEL` and `DICTATION_MODEL` say why, each where it lives.
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
];

/**
 * A model id as a person should read it — the id itself if we have no better
 * name for it.
 *
 * The fallback is the raw id rather than `"unknown"` on purpose: an unlisted
 * model is a table somebody forgot to extend, and the honest thing then is the
 * string that was really sent. Ugly on screen, which is the point — it is the
 * only way anyone finds out.
 */
export function displayName(modelId: string): string {
  return DISPLAY_NAME[modelId] ?? modelId;
}

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

/** The reasoning levels `output_config.effort` accepts. */
export type Effort = "low" | "medium" | "high";

/** The four stages that read the whole article and could share one cached copy of it. */
export type ArticleStage = "arc" | "tweets" | "glossary" | "ideas";

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
 * **This table is HALF the cache grouping**, and it was the whole of it until
 * 2026-08-27. Two stages share a cached article only if they share a value here
 * *and* send the same bytes — see `ARTICLE_RENDERER` below, which became a
 * second table the day `ideas` arrived and had to send block ids where the
 * other four deliberately send none. Effort alone was a correct grouping for
 * exactly as long as every article-reading stage happened to use one renderer,
 * which is the kind of true-by-accident that reads as true-by-design.
 * `sharesArticleCache` in src/pipeline.ts reads both.
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
  /* `high`: finding an unstated premise and then arguing that the piece
     collapses without it is the hardest judgment any stage here makes — harder
     than the glossary's "is this word obvious", which is what `medium` was
     measured to be enough for.

     **It buys no cache share, and an earlier version of this comment claimed
     it did.** Matching arc and tweets on effort is necessary for a shared
     prefix and nowhere near sufficient: ideas sends `articleWithIds` and those
     three send `articleText`, which are different bytes for the same article.
     See `ARTICLE_RENDERER` below, which is what stops that mistake being made
     by the code as well as by the comment. */
  ideas: "high",
};

/**
 * **Which rendering of the article each stage sends** — and therefore the other
 * half of "can these two share a cached prefix".
 *
 * A cache matches a byte-exact prefix. `STAGE_EFFORT` above is one thing that
 * has to agree; this is the other, and it was invisible until `ideas` arrived,
 * because until then every article-reading stage sent `articleText` and the
 * renderer could not be the thing that differed.
 *
 * `ideas` sends `articleWithIds`, because every occurrence it returns is a block
 * id and the ids therefore have to be on the page (src/article-prompt.ts says
 * why the other four deliberately omit them). So it can never share a prefix
 * with arc, tweets, glossary or summary however its effort is set — and
 * `sharesArticleCache` in src/pipeline.ts reads both tables rather than the one,
 * so nothing pays a 1.25x cache *write* premium for a read that cannot happen.
 *
 * The stages that send `articleWithIds` in the request path — search, explain,
 * converse — are not pipeline stages and do not appear here; they also go
 * through OpenRouter rather than the Anthropic SDK, so they share nothing with
 * this stage in practice either.
 */
export const ARTICLE_RENDERER: Record<ArticleStage, "text" | "ids"> = {
  arc: "text",
  tweets: "text",
  glossary: "text",
  ideas: "ids",
};

/** One stage's effort, with the whole-run environment override applied. */
export function effortFor(stage: ArticleStage): Effort {
  return (process.env.SPIDERYARN_PIPELINE_EFFORT as Effort | undefined) ?? STAGE_EFFORT[stage];
}
