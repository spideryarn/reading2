/**
 * **What kind of work a ledger row paid for** — named for what the schema can
 * actually prove, and not a word more.
 *
 * A total is not an answer to "what should we charge"; a *distribution by kind
 * of work* is, because the kinds have wildly different economics. One spoken
 * minute can cost most of an article's whole ingest
 * (docs/plans/260902g-cost-tracking-that-can-set-a-price.md § Tier 2), so a
 * report that folds voice into one grand total tells Greg nothing he can price
 * against.
 *
 * ## The trap this file is arranged around: **provenance is not in the row**
 *
 * The obvious five categories — "base upload", "reader-triggered rerun", and so
 * on — are **not derivable from `ai_calls`**, and GPT Sol caught the plan
 * claiming they were (2026-09-02). Two reasons, both structural:
 *
 * - **`scope_kind` does not separate ingest from reading.** A reader who opens
 *   Glossary posts `{ slug, steps: ["glossary"] }` to `POST /api/jobs`, which
 *   creates a job and is recorded `scope_kind: "job_step"` — *exactly* like the
 *   steps that ran when the article was added. The column says which machinery
 *   ran the call, never who asked for it.
 * - **A `hierarchy` row cannot say whether it was the first ingest or a rerun.**
 *   `job_id` is kept, but a finished job may be deleted, and even a live job
 *   records no "this was the initial upload" fact.
 *
 * So the categories here are named for **the mechanism**, which is what the row
 * knows: *default-step work* rather than *base upload*. That is a weaker claim
 * and it is a true one. Fixing it properly means durably recording the
 * initiating job kind, which is a schema change and out of this stage's scope.
 *
 * ## Why `unknown` is a category rather than a fallback
 *
 * Because the ledger holds **historical strings**, not today's unions.
 * `data/_ai-calls.jsonl` on this box carries `job: "summarise"` with
 * `step_name: "summary"` — a stage that was split into `hierarchy` and `labels`
 * long ago and exists in no type. A classifier that quietly folded those into
 * the nearest live category would be inventing provenance again, one rename
 * later. They land in `unknown`, the report prints the distinct
 * scope/job/step triples inside it, and a person decides.
 *
 * The same mechanism is the guard against the *future* version of that: a new
 * `AiJob` added next month reaches `unknown` and is visible, rather than being
 * absorbed into whichever category has the loosest `else`. That is why the
 * request-scope branch enumerates its jobs instead of catching everything left.
 *
 * ## The lists come from `src/pipeline.ts`, never from a copy here
 *
 * `DEFAULT_INGEST_STEPS` moves — `arc` came off it on 2026-08-29 — and a second
 * copy of it in this file would be a second copy of a fact nothing keeps in
 * step. Importing the pipeline from a leaf module is safe because nothing in
 * `src/` imports this one: the report and the tests do. `npm run cycles` is a
 * gate and agrees.
 */

import type { AiJob } from "./models.js";
import { DEFAULT_INGEST_STEPS, STEP_ORDER } from "./pipeline.js";

/**
 * The six kinds of spend, in the order a pricing conversation wants them.
 *
 * `unknown` is last and is **exhaustive**: every row reaches exactly one of
 * these, so a per-category breakdown can be checked against the row count and
 * nothing can go missing between the two. `assertCategoriesCoverRows` below is
 * that check.
 */
export const COST_CATEGORIES = [
  "default-step work",
  "on-demand enrichment",
  "interactive request work",
  "voice",
  "non-product",
  "unknown",
] as const;

export type CostCategory = (typeof COST_CATEGORIES)[number];

/** One line of prose per category, printed beside it so a number is readable. */
export const CATEGORY_MEANING: Record<CostCategory, string> = {
  "default-step work":
    "pipeline steps that are in DEFAULT_INGEST_STEPS — what adding a URL runs. " +
    "A rerun of one of those steps lands here too; the row cannot tell them apart.",
  "on-demand enrichment":
    "pipeline steps that are off the default — glossary, quotes, ideas, timeline, " +
    "quiz, sketch, tweets, arc. Somebody asked for each of these.",
  /* ⟨This said "…dictation, embeddings, PDF transcription" until 2026-09-07.
     PDF transcription was never in it: `pdf` runs inside the `extract` step and
     every one of its rows is `job_step`. The prose asserted a row shape the
     ledger has never held — GPT Sol, F4. The list now comes from
     `JOB_DISPOSITION` below, which is the thing that decides.⟩ */
  "interactive request work":
    "recognised jobs recorded in request scope: chat, explain, meaning search, " +
    "link hover cards, referee, quiz marking, dictation, embeddings.",
  voice: "live conversation — the realtime model and the separate transcriber.",
  "non-product": "eval and dev-CLI scope. Ours, not a reader's. Kept out of the per-owner spread.",
  unknown:
    "reached no rule above. Retired job or step names from old rows, and anything " +
    "added since this classifier was written. The report names them.",
};

/**
 * The three columns a category is decided from, as **strings**.
 *
 * Deliberately not `ScopeKind`/`AiJob`/`StepName`. The ledger is an append-only
 * historical record and its oldest rows name jobs and steps that no longer
 * exist; typing this against today's unions would either force a cast at every
 * call site or make the compiler assert something about the data that is false.
 * The honest signature takes what the column holds, and `unknown` is what
 * catches the ones the unions no longer cover.
 */
export interface CategoryFacts {
  scopeKind: string;
  job: string;
  stepName: string | null;
}

/**
 * **What each job is expected to do, decided one job at a time.**
 *
 * ## Why this is a `Record<AiJob, …>` and not a `Set<string>`
 *
 * It was a `Set` of the request-scope jobs, enumerated rather than inferred, so
 * that a new `AiJob` would reach `unknown` and be *visible* instead of being
 * swallowed by the widest `else`. The comment called that "a nuisance that lasts
 * one line of edit and is the entire point", and the design was right.
 *
 * **The delivery was not.** A `Set` you forgot to add to fails by printing a
 * line in a report, and that line only reaches somebody who runs `npm run cost`
 * and reads the `UNCLASSIFIED` block. `link-summary` — the hover cards on the
 * article's own links, docs/project/links.md, a live reader-facing feature —
 * sat in `unknown` from the day it shipped: 9 calls, $0.0030, found on
 * 2026-09-07. Trivial money, which is exactly why nobody looked at it, and the
 * mechanism rather than the amount is the point. The check existed, agreed with
 * itself, and was not read — docs/reusable/silent-success.md.
 *
 * A `Record<AiJob, …>` moves the same nuisance one step earlier, to a **compile
 * error in front of the person adding the job**, which is the only reader who is
 * certain to be looking. `MODEL_ENV_VAR` in [models.ts](models.ts) is the
 * precedent and says it in these words: *"`null` rather than a missing key, so
 * adding a `Task` is a compile error here too — 'this one has no override'
 * should be a decision somebody made rather than a line nobody wrote."*
 *
 * ## Four values, not two — GPT Sol, F4, 2026-09-07
 *
 * The obvious shape is a boolean: is this request-scope or not. It encodes the
 * wrong fact. `AI_JOB_WIRE` is **transport** inventory — which API shape a job
 * speaks — and says nothing about which collector is open when it runs. `pdf`,
 * `pdf-frontmatter` and `illustrate` all run *inside* pipeline steps and are
 * classified by `step_name`; `pdf` was in the interactive-request set anyway,
 * and there is not one `request / pdf` row in the ledger to justify it.
 *
 * ## This says what a job is *expected* to do. It never overrides a row.
 *
 * A disposition is a claim about the code, and `costCategoryOf` still decides
 * from the three columns the row actually carries. A `step-driven` job that
 * turns up in request scope lands in `unknown` and gets printed — which is the
 * design working, not a gap in it. Eval overlays are checked before the job for
 * the same reason: an eval that exercises `chat` is recorded `job: "chat"`.
 */
export type JobDisposition =
  /** A reader waits on it, in request scope. Its own category. */
  | "interactive request work"
  /** It runs inside a pipeline step; `step_name` says which, and decides. */
  | "step-driven"
  /** Live conversation — request scope, but priced and reported apart. */
  | "voice"
  /** Ours. A dev CLI or an eval, and no path a reader can reach. */
  | "no product path";

export const JOB_DISPOSITION: Record<AiJob, JobDisposition> = {
  /* The pipeline tasks. `labels` runs inside the `hierarchy` step, so the job
     and the step differ — which is why the classifier reads the step. */
  hierarchy: "step-driven",
  labels: "step-driven",
  arc: "step-driven",
  tweets: "step-driven",
  glossary: "step-driven",
  ideas: "step-driven",
  quotes: "step-driven",
  sketch: "step-driven",
  timeline: "step-driven",
  illustrated: "step-driven",
  quiz: "step-driven",
  debate: "step-driven",
  citations: "step-driven",
  /* Three tasks a reader waits on with the page open. */
  explain: "interactive request work",
  chat: "interactive request work",
  search: "interactive request work",
  /* **The fix this table was written for.** Hover a link in the article and this
     says how it stands to the piece being read — docs/project/links.md. It is
     request-scope, reader-triggered, and was in no category at all. */
  "link-summary": "interactive request work",
  /* Citations mode's *Find it*: one owner-pressed web search for one cited
     work, in request scope — src/citation-find.ts. */
  "citations-find": "interactive request work",
  /* Marking an answer the reader just typed. */
  "quiz-mark": "interactive request work",
  /* The word that decides how hard the reader's next question is, judged from
     the mark above and shown to nobody — docs/project/quiz.md. Request scope
     and reader-triggered like its neighbour, and it fires once per answered
     question *beside* a `quiz-mark` call, which is why it is billed separately:
     folded together, the cost of marking an answer would silently include a
     second call on a different tier. */
  "quiz-verdict": "interactive request work",
  /* The four referee stages. A peer reviewer is waiting on each —
     docs/project/referee-mode.md. */
  "referee-mirror": "interactive request work",
  "referee-criteria": "interactive request work",
  "referee-claims": "interactive request work",
  "referee-candidates": "interactive request work",
  /* Talking into a text box. Request scope, and on OpenRouter despite the model
     being called `openai/gpt-transcribe` — a model named after a vendor is not a
     bill from that vendor. docs/project/dictation.md. */
  dictation: "interactive request work",
  /* Written so meaning search can run. Reader-triggered, request scope. */
  embeddings: "interactive request work",
  /* **Step-driven, though it reads as interactive.** A PDF is transcribed by the
     `extract` step; `job_step / pdf / extract` is 269 rows in the dev ledger and
     `request / pdf` is none. `pdf` was in the interactive set until 2026-09-07
     and the category's own prose claimed "PDF transcription" for it, which was
     never true of a single row. GPT Sol, F4. */
  pdf: "step-driven",
  "pdf-frontmatter": "step-driven",
  /* The Illustrated sub-mode's plate, bought inside the `illustrated` step. */
  illustrate: "step-driven",
  /* Both halves of a live session, told apart by `requested_model`. Priced on
     two rate cards and reported apart from everything else, because one spoken
     minute can cost most of an article's ingest. */
  live_conversation: "voice",
  /* `gjd-remote push-env`'s key-name classifier — a developer at a terminal. */
  "env-proposal": "no product path",
  /* A bake-off. Recorded in `eval` scope, which is checked first anyway. */
  eval: "no product path",
};

/**
 * **What this build expects of a job, or `null` if it has never heard of it.**
 *
 * The `null` is the whole of the historical case, and it is why the ledger's
 * `job` column is typed `string` here rather than `AiJob`: `data/_ai-calls`
 * carries `summarise`, a stage that was split into `hierarchy` and `labels` long
 * ago and exists in no union. Those rows keep the old step-name treatment;
 * `costCategoryOf` holds only a job this build knows about to its disposition.
 *
 * ⟨There was a derived `INTERACTIVE_REQUEST_JOBS: Set<string>` here until
 * 2026-09-07. It made `"step-driven"` and `"no product path"` behaviourally
 * identical — three of the four values were "not in the set" — so the table
 * read as if it enforced something it did not. GPT Sol, F7: *"Changing `pdf` or
 * `debate` from step-driven to no-product would still pass the new tests and
 * leave production behavior unchanged."*⟩
 */
function dispositionOf(job: string): JobDisposition | null {
  return Object.hasOwn(JOB_DISPOSITION, job)
    ? JOB_DISPOSITION[job as AiJob]
    : null;
}

const DEFAULT_STEPS: ReadonlySet<string> = new Set<string>(DEFAULT_INGEST_STEPS);
const KNOWN_STEPS: ReadonlySet<string> = new Set<string>(STEP_ORDER);

/**
 * Which category one row belongs to. Pure, total, and the order of the branches
 * is the whole of the logic.
 *
 * **Non-product first**, before anything looks at the job: an eval that
 * exercises `chat` is recorded `job: "chat"`, and a bake-off over forty PDFs
 * landing in a reader-facing category is how a price gets set wrong. The same
 * argument `scripts/ai-cost.ts` already makes for printing eval spend apart.
 *
 * **Voice second**, because a live session is recorded in *request* scope
 * (`src/live.ts` § the accounting routes) and would otherwise disappear into
 * the interactive bucket — the one category whose figure it would dominate and
 * the one distinction the whole live-metering stage exists to make.
 */
export function costCategoryOf(facts: CategoryFacts): CostCategory {
  if (facts.scopeKind === "eval" || facts.scopeKind === "cli") return "non-product";
  /* `null` for a job no longer in `AiJob` — `summarise`, `summary` and the other
     names the ledger still holds from before a rename. Those keep the old
     step-name treatment below; only a job this build actually knows about is
     held to its disposition. GPT Sol asked for the two to stay separable (F7). */
  const disposition = dispositionOf(facts.job);
  /* **Voice before the step branch, and only in request scope.** A live session
     is recorded in *request* scope (`src/live.ts` § the accounting routes) and
     would otherwise land in the interactive bucket — the one category whose
     figure it would dominate, and the one distinction the whole live-metering
     stage exists to make. Read from the table rather than hard-coded against
     `live_conversation`, so `"voice"` is a value that does something.

     **The scope test is the F10 fix.** Without it this branch returned before
     anything looked at the scope, so `job_step / live_conversation / hierarchy`
     — a live conversation recorded as a pipeline step, which is nonsense —
     came back `voice` rather than `unknown`, and the mismatch rule three lines
     down did not apply to the one job whose figure it most matters for. GPT Sol
     found it in the round-two check, and noted it was true of the old classifier
     too. No producer writes that triple today. */
  if (disposition === "voice") {
    return facts.scopeKind === "request" ? "voice" : "unknown";
  }
  if (facts.scopeKind === "job_step") {
    /* **A job that says it is not step-driven, in step scope, is a mismatch.**
       Not an error and not a guess: `unknown`, printed, for somebody to look at.
       Before 2026-09-07 this branch asked only the step name, so an interactive
       or no-product job appearing here would have been quietly classified by
       whichever step it named — the table would have been describing something
       the classifier did not consult. GPT Sol, F7. */
    if (disposition !== null && disposition !== "step-driven") return "unknown";
    /* The step, not the job. `labels` runs inside the `hierarchy` step and is
       recorded `job: "labels", step_name: "hierarchy"` — asking the job would
       put half of the default ingest in `unknown`. The step name is what says
       which pipeline slot was paid for. */
    if (facts.stepName === null) return "unknown";
    if (DEFAULT_STEPS.has(facts.stepName)) return "default-step work";
    if (KNOWN_STEPS.has(facts.stepName)) return "on-demand enrichment";
    return "unknown";
  }
  if (facts.scopeKind === "request" && disposition === "interactive request work") {
    return "interactive request work";
  }
  return "unknown";
}

/** A row's category, and enough of it to name in the `unknown` block. */
export function describeFacts(facts: CategoryFacts): string {
  return `${facts.scopeKind} / ${facts.job} / ${facts.stepName ?? "—"}`;
}

/**
 * **Do the per-category counts add up to the number of rows classified?**
 *
 * Throws when they do not, and it is not a defensive nicety. Every figure in
 * the per-owner report is a fold over grouped rows, and a fold that drops a
 * bucket — a `switch` missing a case, a `Map` keyed on a name that got
 * renamed — produces a report that is *smaller* than the truth and looks
 * entirely plausible. Nothing about it is red. This is the one statement that
 * cannot be satisfied by a plausible-looking wrong answer, which is what
 * docs/reusable/silent-success.md asks for.
 *
 * It is deliberately **not** "unknown must be empty". `unknown` holding rows is
 * a real and expected state (retired job names), and a check that failed on it
 * would be muted within a week. The report prints what is in there instead.
 */
export function assertCategoriesCoverRows(
  counts: ReadonlyMap<CostCategory, number>,
  totalCalls: number,
): void {
  let summed = 0;
  for (const category of COST_CATEGORIES) summed += counts.get(category) ?? 0;
  /* Extra keys as well as a short sum: a `Map<string, number>` that has been
     handed a category name this file does not know would otherwise pass the
     addition above while its rows never appear on the page. */
  for (const key of counts.keys()) {
    if (!(COST_CATEGORIES as readonly string[]).includes(key)) {
      throw new Error(
        `the cost breakdown has a category this build does not know about (${JSON.stringify(key)}). ` +
          "Every row must land in one of COST_CATEGORIES — see src/cost-categories.ts.",
      );
    }
  }
  if (summed !== totalCalls) {
    throw new Error(
      `the cost breakdown covers ${summed} call(s) and the ledger returned ${totalCalls} for the ` +
        "same range, so at least one row is in no category. A per-owner report that is quietly " +
        "short is worse than none — see src/cost-categories.ts.",
    );
  }
}
