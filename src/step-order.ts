/**
 * **The order the steps run in, and the two types read off it.**
 *
 * Its own module, and a leaf, for one reason: `src/web/useStepJob.ts` needs
 * `StepBefore` to hold a caller's `precededBy` to steps that really do precede,
 * and `src/pipeline.ts` — where all of this lived until 2026-09-04 — is a
 * server module the client may not import.
 *
 * **`import type` was tried first and is not the exemption it looks like.** The
 * import is erased, so nothing reaches the browser bundle; but the rule
 * `tests/client-imports.test.ts` enforces is *shared modules stay leaves*, and
 * a type-only edge is a real dependency in the source. That test's own header
 * records the same relaxation being written and reverted inside a day
 * (`src/messages.ts` → `embeddings.ts`, 2026-08-28), and the better outcome
 * both times was to move the shape into a module that imports almost nothing.
 * This is that module.
 *
 * `src/pipeline.ts` re-exports `STEP_ORDER`, so every file that has always
 * imported it from there still can, and there is one ordering in the repository
 * rather than two. The other two names are not re-exported: `StepBefore`'s only
 * importer is the client, which now says `from "../step-order.js"`, and
 * `StepsMissingFromOrder` is checked here, beside the array it guards, by
 * nobody importing it at all.
 */
import type { StepName } from "./types.js";

/**
 * Every step there is, in pipeline order.
 *
 * This constant does two jobs and both need every name: `orderSteps` sorts by
 * `indexOf` here (a name that is missing gets `-1` and sorts to the **front**,
 * so it would run before `fetch`), and `isStepName` (src/pipeline.ts) is what
 * decides which names the API will accept at all.
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
  /* **Immediately after `hierarchy`, and its position here is not load-bearing
     the way `quotes`, `timeline`, `quiz` and `illustrated` are.** It is in no
     article-cache group — the label prompt sends an outline and a batch of
     paragraphs, not the article the way `articleText` or `articleWithIds` do —
     so it breaks no contiguity wherever it goes, and it is here because it is
     the second half of stage 4 and reads the tree that step just cut.

     **Not in `DEFAULT_INGEST_STEPS`** (src/pipeline.ts), which is the entire
     point of the split: `hierarchy` writes a pending manifest and the labels
     are bought later by a free successor job, so pasting a URL no longer waits
     on the 79.5–92% of stage 4 that this pass was.

     **And not in `FORCE_ONLY_WHEN_NAMED`** either, which is the opposite
     decision from the one `arc` made in the same position — see the note there.
     docs/plans/260906a-labels-leave-the-blocking-hierarchy-step.md. */
  "labels",
  /* After `hierarchy` because it reads stage 4's `blocks.json` — the copy the reader
     will actually render, and the one its own freshness stamp is computed from
     (`assetsInputHash`, src/collect-assets.ts), so freshness comes from the
     machinery that is here rather than from a second one invented for this
     step. Before `arc` because everything up to
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
     jobs share nothing — `cacheArticle` (src/pipeline.ts) only marks a prefix
     another step of the SAME job will read — so this buys the reader who asks
     for both at once and nobody else. And it bought nobody anything at all
     until 2026-09-03, when `quotes` started sending a breakpoint of its own:
     see `cacheArticleForStep` (src/pipeline.ts). docs/project/quotes.md. */
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
  /* **Last, and it depends on nothing in this list.** Every other name here
     reads an artefact something before it wrote; this one goes to the open web
     and comes back with pages that answer the piece. It is last because it has
     no place it must be — putting it between `quiz` and `sketch` would break the
     `ideas`/`timeline`/`quiz`/`sketch` cache group's contiguity for nothing, and
     putting it before `illustrated` would separate that step from the `sketch`
     it paints.

     Off `DEFAULT_INGEST_STEPS`, like the seven before it, and in
     `FORCE_ONLY_WHEN_NAMED` (src/pipeline.ts) — this is the second dearest
     thing in the app at up to ~$0.27 a run, and a positional cascade that swept
     it in would spend that on somebody who pressed a button one band along.
     docs/plans/260905f-debate-mode-what-the-web-says-about-this-piece.md. */
  "debate",
  /* **After `debate`, and like it in no cache group**: it sends `articleWithIds`
     over every block, notes and bibliography included, so its bytes match no
     other stage's and its position breaks no contiguity. Off
     `DEFAULT_INGEST_STEPS` and in `FORCE_ONLY_WHEN_NAMED` — a model call over
     the whole article that a reader asks for by pressing the mode.
     docs/plans/260911g-citations-mode.md. */
  "citations",
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
 * **A type rather than a `STEP_ORDER.indexOf` comparison at the call site**,
 * because a wrong `precededBy` should fail the build rather than a test, and
 * because the check is then erased: `verbatimModuleSyntax` makes that a rule
 * rather than an optimisation, so the browser pays nothing for it.
 *
 * That argument used to have a second half — that a value import would drag
 * `src/pipeline.ts`, a server module, into the client bundle — and since the
 * array moved into this leaf on 2026-09-04 it no longer holds: a value import
 * here would pull in this file and nothing else. Keep it type-only anyway. The
 * client's answer to needing part of the server has twice been a shape rather
 * than a copy (src/web/feedback-diagnostics.ts § `WORD`, *"why a third copy of
 * `STEP_ORDER` would be worse than a shape"*), and a shape that costs the
 * bundle nothing is the cheapest version of that answer.
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
