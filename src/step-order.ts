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
  /* **Straight after `fetch`, and only ever with it**: the minimal job is
     `["fetch", "metadata"]` and nothing else names it (`enqueue` refuses it in
     any other list). It reads stage 1's stored bytes, as `extract` does, and
     writes `meta`. Before `extract` so that a positional cascade from `extract`
     — *Read this*, Rebuild — can never reach it: forcing a step forces only the
     steps after it. Off `DEFAULT_INGEST_STEPS`.
     docs/plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md. */
  "metadata",
  "extract",
  "blocks",
  "structure",
  /* **After `structure`, because it reads the tree that step just cut.**
     Immediate adjacency is not required; this is the second half of stage 4.

     **Not in `DEFAULT_INGEST_STEPS`** (src/pipeline.ts), which is the entire
     point of the split: `structure` writes a pending manifest and the labels
     are bought later by a free successor job, so pasting a URL no longer waits
     on the 79.5–92% of stage 4 that this pass was.

     **And not in `FORCE_ONLY_WHEN_NAMED`** either, which is the opposite
     decision from `arc` — src/pipeline.ts § FORCE_ONLY_WHEN_NAMED.
     docs/plans/260906a-labels-leave-the-blocking-hierarchy-step.md. */
  "labels",
  /* After `structure` because it reads stage 4's `blocks.json` — the copy the reader
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
  /* **No two steps in this list share a cached article today, so no position
     here is about the prompt cache.** From here to `simple` the comments used
     to say otherwise — `glossary` with `quotes`, and `ideas` with `timeline`,
     `quiz`, `faq` and `simple`, each "one cache group". They were, while effort
     and article bytes were the whole cache key. The output schema is part of it
     too, every stage has had its own since they moved to structured output, and
     `sharesArticleCache` (src/pipeline.ts) now answers false for every distinct
     pair — tests/article-cache-group.test.ts asserts the list of pairs is
     empty, and is what goes red if two stages match on all three dimensions.
     That function is the policy; do not restate its membership here.

     So `quotes` is beside `glossary` because it always was: the same article
     bytes at the same effort, which is two of three dimensions a share would need.
     docs/project/quotes.md. */
  "quotes",
  "ideas",
  /* Beside `ideas`: the same article bytes, the same `ids` renderer and the
     same effort (src/models.ts § ARTICLE_RENDERER, § STAGE_EFFORT) — and a
     different output schema, so no shared cache; see the note above `quotes`.

     Off `DEFAULT_INGEST_STEPS`, like the four before it: it costs a model call
     over the whole article and it is a mode somebody goes to. */
  "timeline",
  /* Beside `timeline`, with the same rendering and effort and, like it, its
     own schema and no shared cache.

     Off `DEFAULT_INGEST_STEPS`, like the five before it: it costs a model call
     over the whole article and it is a thing somebody asks for.
     docs/plans/260831al-review-quiz-sub-mode.md. */
  "quiz",
  /* Beside `quiz`: `high` effort, the `ids` renderer and the body-only
     evidence, like `ideas`, `timeline` and `quiz` — and its own schema.
     Off `DEFAULT_INGEST_STEPS` and in `FORCE_ONLY_WHEN_NAMED` — a model call
     over the whole article that a reader asks for by opening the mode.
     docs/plans/260916d-faq-mode.md. */
  "faq",
  /* Straight after `faq`, whose article bytes it shares, at
     `low` effort (src/models.ts § STAGE_EFFORT).
     Its fingerprint also covers the ordered paragraph pairs, rather than
     FAQ's whole tree — src/relations.ts § inputFingerprint.
     Off `DEFAULT_INGEST_STEPS` and in `FORCE_ONLY_WHEN_NAMED`: one model call
     over the whole article, queued when an article is imported since
     2026-10-05 (src/auto-mode-steps.ts) and otherwise started by the owner's
     press that turns Marginalia on.
     docs/plans/261003f-marginalia-relation-words-and-timeline-events.md. */
  "relations",
  /* With the other body-only `ids` stages: `high` effort (measured against
     `medium` in stage 1, src/models.ts § STAGE_EFFORT) and its own schema.
     Off `DEFAULT_INGEST_STEPS`
     and in `FORCE_ONLY_WHEN_NAMED`: a model call over the whole article that a
     reader asks for through Summary's plain-words controls.
     docs/plans/260930i-simple-summaries-eli15-sub-mode.md. */
  "simple",
  /* Off `DEFAULT_INGEST_STEPS`: nothing reads what it writes except the one
     below. It sends the same bytes as `ideas` … `simple`, at `low` effort
     since 2026-10-01 (src/models.ts § STAGE_EFFORT). It was the slowest
     single model call in the app at 121–194 seconds measured at `high`; about
     42 s at `low`. docs/project/diagram.md § Sketch. */
  "sketch",
  /* **After `sketch`, because it paints that step's artefact.** The order does not
     *pull* the Sketch in — `useStepJob` posts `steps: [step]` and nothing puts
     a prerequisite in front of it — so the step refuses instead. What the order
     buys is that a run naming both draws before it paints.
     docs/project/diagram.md § Illustrated. */
  "illustrated",
  /* **After both of the things it reads — `quotes` and `ideas`** — the second
     step here whose input is other steps' artefacts. The order does not *pull*
     them in; what it buys is that a job naming all three (`precededBy:
     ["quotes", "ideas"]`, `StepBefore` below) chooses the quotes and finds the
     ideas before it routes through them. It sat straight after `quotes` until
     stage 6 of plan 260928a gave it the Ideas.

     It sends the quotes and never the article. After `illustrated` too, so
     that step stays beside the `sketch` it paints. Only named steps run, so this place
     never makes a job run the steps between.
     Off `DEFAULT_INGEST_STEPS` and in `FORCE_ONLY_WHEN_NAMED` (src/pipeline.ts).
     docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md. */
  "skim",
  /* **After `illustrated` and `skim`.** It reads the article and goes to the
     open web for pages that answer the piece. It has no prerequisite among the
     optional modes, and keeping it after `illustrated` leaves that step beside
     the `sketch` it paints.

     Off `DEFAULT_INGEST_STEPS`, like the seven before it, and in
     `FORCE_ONLY_WHEN_NAMED` (src/pipeline.ts) — this is the second dearest
     thing in the app at up to ~$0.27 a run, and a positional cascade that swept
     it in would spend that on somebody who pressed a button one band along.
     docs/plans/260905f-debate-mode-what-the-web-says-about-this-piece.md. */
  "debate",
  /* **Straight after `debate`**, the mode it serves: the article's claims,
     listed for Debate's Claims sub-mode to pick from. One Messages call over
     the body, `faq`'s bytes and effort and its own schema; no web search.
     Off `DEFAULT_INGEST_STEPS` and in `FORCE_ONLY_WHEN_NAMED` — a model call
     over the whole article that a reader asks for by pressing Claims.
     docs/plans/261008i-debate-claims-picked-by-the-reader.md § 2. */
  "debate-claims",
  /* **After `debate`**: it sends `articleWithIds` over every block, notes and
     bibliography included, so its bytes match no other stage's. Off
     `DEFAULT_INGEST_STEPS` and in `FORCE_ONLY_WHEN_NAMED` — a model call over
     the whole article that a reader asks for by pressing the mode.
     docs/plans/260911g-citations-mode.md. */
  "citations",
  /* **Last**: it sends Ideas' bytes and thinks at `medium`, which no other
     `ids` stage does. Off `DEFAULT_INGEST_STEPS` — Greg asked for import to
     be as fast as possible — and in `FORCE_ONLY_WHEN_NAMED`: a model call over
     the whole article, queued by the add page's after-import box or a press on
     Metadata. docs/plans/260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md. */
  "crossrefs",
] as const satisfies readonly StepName[];

/**
 * **Step names that were renamed, and the step each became.** A name here can
 * still arrive after the rename's deploy: a job row enqueued by old code in the
 * minutes between the migration and the new code going live, or a feedback
 * report from a tab loaded before it. Both readers translate through this one
 * table — `toJob` in src/store/pg-jobs.ts and src/feedback-payload.ts — so a
 * stale job runs under its new name (and a Retry copies the new name) rather
 * than meeting `registry[step.name] === undefined` and throwing outside
 * `runStep`'s catch. Plan 261002b § The deploy, for the Overseer.
 *
 * `trajectory` was Skim's step until 2026-10-01 (plan 261001r); `hierarchy` was
 * Structure's until 2026-10-02 (plan 261002b). The ledger has its own table,
 * `RENAMED` in src/cost-categories.ts, because it also renames jobs.
 */
export const RETIRED_STEPS: Readonly<Record<string, StepName>> = {
  trajectory: "skim",
  hierarchy: "structure",
};

/** A retired step name's successor, or the name as it came. */
export function currentStepName(name: string): string {
  return Object.hasOwn(RETIRED_STEPS, name) ? (RETIRED_STEPS[name] ?? name) : name;
}

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
 * `structure` would come back as `["structure", "assets"]`, a "preceding" step
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
