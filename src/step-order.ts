/**
 * **The order the steps run in, and the two types read off it.**
 *
 * This is `src/pipeline.ts`'s ordering, moved out into a module that imports
 * nothing but types — and it moved for a rule rather than for tidiness.
 *
 * `StepRun.precededBy` in `src/web/useStepJob.ts` is checked against this order
 * at compile time, so `StepBefore` has to be reachable from the browser's code.
 * `pipeline.ts` is a server module: it opens the database, hashes with
 * `node:crypto` and pulls in every stage behind it. `tests/client-imports.test.ts`
 * refuses a `src/web/` file that names it **even through an erased `import type`**,
 * and deliberately — the header of that test says the fix is to *move the shared
 * thing into a module that imports nothing*, which `public-types.ts`,
 * `referee-mirror-types.ts` and `injection-scan-types.ts` were each written for
 * before this one. The import was type-only from the start (commit `a9fd3197`)
 * and the test was red on `dev` from then until 2026-09-04; nothing shipped
 * wrong, because an erased import really does cost the bundle nothing. What was
 * wrong was a standing exception to a rule that only works when it has none.
 *
 * `pipeline.ts` re-exports every name below, so nothing that imported them from
 * there had to change, and nothing should be moved to import from here for its
 * own sake. The one caller that must is the browser's.
 */
import type { StepName } from "./types.js";

export type { StepName };

/**
 * Every step there is, in pipeline order.
 *
 * This constant does two jobs and both need every name: `orderSteps` sorts by
 * `indexOf` here (a name that is missing gets `-1` and sorts to the **front**,
 * so it would run before `fetch`), and `isStepName` — which stayed in
 * `pipeline.ts` — is what decides which names the API will accept at all.
 *
 * It used to do a third — being the default for a job that named no steps — and
 * that is `DEFAULT_INGEST_STEPS` now, because `tweets` was the first step that
 * belongs in the order and not in the default. `glossary` is the second, and
 * the pair of them is what turned that from an exception into the shape of the
 * list: everything up to `arc` makes the article readable, and everything after
 * it is a thing somebody asks for. See
 * docs/plans/260825g-tweet-thread-page.md#the-one-real-snag-stated-precisely and
 * docs/project/glossary.md.
 */
export const STEP_ORDER = [
  "fetch",
  "extract",
  "blocks",
  "hierarchy",
  /* After `hierarchy` because it reads stage 4's `blocks.json` — the copy the reader
     will actually render, and the one `inputHashFor` already hashes, so
     freshness comes free from the machinery that is here rather than from a
     second one invented for this step. Before `arc` because everything up to
     `arc` is what makes the article readable, and an article whose figures are
     still being fetched from the publisher is not finished being ingested.
     docs/plans/260829b-hosting-the-articles-images.md#the-step. */
  "assets",
  "arc",
  "tweets",
  "glossary",
  /* Straight after `glossary`, and that is not cosmetic: the two send
     byte-identical article bytes at the same effort, so a job asking for BOTH
     pays for the article once (src/models.ts § ARTICLE_RENDERER). Two separate
     jobs share nothing — `cacheArticle` below only marks a prefix another step
     of the SAME job will read — so this buys the reader who asks for both at
     once and nobody else. And it bought nobody anything at all until 2026-09-03,
     when `quotes` started sending a breakpoint of its own: see
     `cacheArticleForStep`. docs/project/quotes.md. */
  "quotes",
  "ideas",
  /* Beside `ideas`, and that is the same argument `quotes` makes two rows up:
     the two send byte-identical article bytes at the same effort and the same
     `ids` renderer, so a job asking for BOTH pays for the article once
     (src/models.ts § ARTICLE_RENDERER, § STAGE_EFFORT). `ideas`, `timeline` and
     `sketch` are one cache group and are contiguous for that reason.

     Off `DEFAULT_INGEST_STEPS`, like the four before it: it costs a model call
     over the whole article and it is a mode somebody goes to. */
  "timeline",
  /* Beside `timeline`, for the third time and the same argument: `high` effort
     and the `ids` renderer, so `ideas`, `timeline`, `quiz` and `sketch` are one
     cache group and this list keeps them contiguous. A `quiz` placed anywhere
     else in this array would still work and would quietly stop sharing the
     cached article prefix with the three stages it is identical to — the
     failure `sharesArticleCache` exists to prevent, and the one nothing throws
     about (tests/article-cache-group.test.ts).

     Off `DEFAULT_INGEST_STEPS`, like the five before it: it costs a model call
     over the whole article and it is a thing somebody asks for.
     docs/plans/260831al-review-quiz-sub-mode.md. */
  "quiz",
  /* Off `DEFAULT_INGEST_STEPS`: nothing reads what it writes except the one
     below, and it is the slowest single model call in the app at 121–194
     seconds measured. docs/project/diagram.md § Sketch. */
  "sketch",
  /* **Last, and after `sketch` for a reason no other pair here has**: this is
     the only step whose input is another step's artefact. The order does not
     *pull* the Sketch in — `useStepJob` posts `steps: [step]` and nothing puts
     a prerequisite in front of it — so the step refuses instead. What the order
     buys is that a run naming both draws before it paints.
     docs/project/diagram.md § Illustrated. */
  "illustrated",
] as const satisfies readonly StepName[];

/**
 * **Every `StepName` that `STEP_ORDER` above does not list.** Always `never`.
 *
 * Add a step to `StepName` (src/types.ts) and forget the row above, and this
 * line goes red naming the step you forgot: `T extends never` is a constraint,
 * and the default it is checked against stops being `never` the moment a name
 * is missing. That is the check the plain `StepName[]` annotation could not
 * make — it widened the tuple away and said only that each entry *is* a step,
 * never that every step *is* an entry.
 *
 * The consequences of a gap are not cosmetic: `orderSteps` sorts by `indexOf`,
 * so an unlisted step gets `-1` and runs before `fetch`; `isStepName` rejects
 * it over HTTP; and tests/db-step-constraint.test.ts derives the SQL CHECK from
 * this array, so a name missing here is a name the database refuses to store.
 *
 * **Exported only so it survives.** `noUnusedLocals` deletes an unreferenced
 * type alias, which would take the check with it; nothing imports this and
 * nothing should — which is why it is tagged `@public`, so knip does not list
 * it as an unused export and nobody tidies the check away.
 *
 * tests/jobs.test.ts is the runtime half, and it is the one that catches a
 * duplicate or a wrong order — a union discards both.
 *
 * @public
 */
export type StepsMissingFromOrder<
  T extends never = Exclude<StepName, (typeof STEP_ORDER)[number]>,
> = T;

/**
 * **Every step the array above runs before `S`**, as a union. `never` for
 * `fetch`, which nothing precedes.
 *
 * Read off `STEP_ORDER` itself rather than written out, so there is one
 * ordering here and not two: move a name in the array and this answers
 * differently on the next compile.
 *
 * **What it is for**: `StepRun.precededBy` in src/web/useStepJob.ts, where a
 * caller names the steps that have to run before its own inside one job. The
 * server does not honour that word — `orderSteps` (src/jobs.ts) sorts whatever
 * arrives by `STEP_ORDER` and nothing else — so `precededBy: ["assets"]` on
 * `hierarchy` would come back as `["hierarchy", "assets"]`, a "preceding" step
 * that runs afterwards, with nothing anywhere saying so. GPT Sol reproduced
 * exactly that on 2026-09-03; the one caller in the tree is safe, so what this
 * closes is the next caller rather than a live bug.
 *
 * The check has to be a type rather than a `STEP_ORDER.indexOf` comparison at
 * the call site, because the call site is in the browser and **nothing under
 * `src/web/` may import `src/pipeline.ts`**: that is a server module, and the
 * client's answer to needing part of it has twice been a shape rather than a
 * copy (src/web/feedback-diagnostics.ts § `WORD`, *"why a third copy of
 * `STEP_ORDER` would be worse than a shape"*). Splitting this file out is what
 * made the check legal rather than merely erased.
 *
 * `useStepJob.ts` still takes it `import type`, and that is now a preference
 * rather than a load-bearing rule: a value import from here would cost the
 * bundle nine short strings, not the pipeline. It stays type-only because
 * nothing in the browser needs the array at runtime.
 *
 * `[S] extends [Head]` rather than `S extends Head`, so a union `S` — which is
 * what the defaulted `StepJob<StepName>` supplies — fails every branch and
 * widens to the whole list instead of distributing into nonsense. That is the
 * one hole: a caller who passes a `StepName`-typed variable rather than a
 * literal gets no check. All nine callers pass literals.
 */
export type StepBefore<
  S extends StepName,
  T extends readonly StepName[] = typeof STEP_ORDER,
> = T extends readonly [infer Head extends StepName, ...infer Rest extends readonly StepName[]]
  ? [S] extends [Head]
    ? never
    : Head | StepBefore<S, Rest>
  : never;
