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
  "interactive request work":
    "recognised jobs recorded in request scope: chat, explain, meaning search, " +
    "referee, quiz marking, dictation, embeddings, PDF transcription.",
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
 * **Request-scope jobs this classifier recognises**, enumerated rather than
 * inferred.
 *
 * The tempting shape is `if (scopeKind === "request") return "interactive …"`,
 * and it is wrong for the reason the header gives: a new job would be swallowed
 * silently by the category with the widest mouth. Listing them means adding an
 * `AiJob` shows up in `unknown` on the next report, which is a nuisance that
 * lasts one line of edit and is the entire point.
 *
 * `pdf` and `embeddings` sit here despite not being "text and search" in the
 * reading sense — a PDF transcription happens when somebody uploads one, and
 * embeddings are written so that meaning search can run. Both are request-scoped
 * reader-triggered work, which is what the category is actually named for.
 */
const INTERACTIVE_REQUEST_JOBS: ReadonlySet<string> = new Set([
  "chat",
  "explain",
  "search",
  "quiz-mark",
  "referee-mirror",
  "referee-criteria",
  "referee-claims",
  "referee-candidates",
  "dictation",
  "embeddings",
  "pdf",
]);

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
  if (facts.job === "live_conversation") return "voice";
  if (facts.scopeKind === "job_step") {
    /* The step, not the job. `labels` runs inside the `hierarchy` step and is
       recorded `job: "labels", step_name: "hierarchy"` — asking the job would
       put half of the default ingest in `unknown`. The step name is what says
       which pipeline slot was paid for. */
    if (facts.stepName === null) return "unknown";
    if (DEFAULT_STEPS.has(facts.stepName)) return "default-step work";
    if (KNOWN_STEPS.has(facts.stepName)) return "on-demand enrichment";
    return "unknown";
  }
  if (facts.scopeKind === "request" && INTERACTIVE_REQUEST_JOBS.has(facts.job)) {
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
