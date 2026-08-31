# Review prompt — bottom-bar readiness dots, and auto-running a mode on click

You are reviewing a **plan**, before any of it is built. Read-only: do not edit files.

## The plan

`docs/plans/260831ai-which-modes-are-ready-in-the-bottom-bar-and-running-one-by-clicking-it.md`

Read it first, in full. Then read the code it names — at minimum:

- `src/web/Dock.tsx` (the bar; `MODES_UI`, `DockModes`, `MARKED`, `nextModeIndex`)
- `src/web/useArc.ts` (the existing auto-run precedent)
- `src/web/useStepJob.ts` (the shared job half)
- `src/web/useGlossary.ts`, `useIdeas.ts`, `useQuotes.ts`, `useTimeline.ts`, `useSketch.ts`
- `src/web/useJobs.ts` (the poller and its visibility gate)
- `src/web/public-artefacts.ts`, `src/web/visitor.ts`, `src/web/reader-capability.ts`
- `src/types.ts` § `Article`, `src/api.ts` § `loadArticle` and § `articleMetadata`,
  `src/store/pg.ts` § the article projection and § `articleMetadata`
- `src/pipeline.ts` § `STEP_ORDER`, `DEFAULT_INGEST_STEPS`, `FORCE_ONLY_WHEN_NAMED`, `stepIsDone`
- `src/web/styles.css` § the modes segment, § a narrow window
- `AGENTS.md` and `docs/project/reading-view-overview.md` for the house rules this must not break

## What Greg decided (do not re-litigate these; do tell me if one of them is unsafe as specified)

1. A small **hollow dot** marks a mode with nothing generated; a **filled, pulsing** dot marks one
   whose job is running; a ready mode carries nothing.
2. Clicking a mode with nothing in it **starts its job automatically** — for all five triggers,
   **including the sketch** (2–3 minutes, ~$0.20), which fires when the reader selects the Sketch
   view inside Diagram.
3. A **stale** artefact counts as ready: no dot, no auto-run, existing banner unchanged.

## What I most want from you

Rank your findings, most serious first, and say for each whether it is a **correctness** problem, a
**cost/spend** problem, a **design** disagreement, or a **nit**.

Specific things to attack:

- **The money.** The plan claims the only path that turns one keypress into several paid model calls
  is `DockModes.onKey`, which selects as it traverses, and that a ~600ms settle delay inside the
  panel's hook closes it. Is that the only such path? Check the URL layer too — `?mode=` is a
  nuqs param with `history: "push"`, so browser Back/Forward walks modes; check whether anything
  else writes `mode` (deep links, `withMode`, chat handoff, keynav, touch/swipe, the metadata and
  thread pages' links back into the reading view). Is 600ms the right instrument, or is there a
  cheaper one that cannot be got wrong — e.g. requiring an explicit user gesture rather than a
  mount?
- **Double-spend.** Two tabs open on the same article; `<StrictMode>`'s double effect; a job started
  from the CLI while the page is open; `enqueue`'s dedupe in `src/jobs.ts`. Does the per-slug ref
  guard plus an unforced start actually make this idempotent, or is there a window?
- **The seam for the readiness fact.** The plan puts five booleans on the owner's `GET
  /api/article/:slug` payload rather than adding a new endpoint or reusing `/api/metadata/:slug`.
  Read what building an `Article` currently costs in each of the two stores and say whether that is
  right. Is there a cheaper or more honest source I have missed? Does it force the Postgres
  projection to read anything it does not already read?
- **The live update.** The bar's readiness is seeded from the payload and then flipped by a second
  `useJobs` poller. `useJobs` treats its first poll as a baseline and does not announce jobs that
  had already finished (see the comment in `useGlossary.ts` § revalidate on mount). Does that break
  the flip in any ordering — e.g. a job that finishes between the payload being built and the
  poller's first poll? What is the failure a reader would actually see?
- **The visitor.** `tests/visitor-gaps.test.ts` asserts a signed-out browser issues no POST at all.
  Does anything in this plan risk one? Does adding a field to `Article` leak anything into the
  public DTO path (`src/public/dto.ts`, `src/public-types.ts`)?
- **Silent success.** Per `docs/reusable/silent-success.md`: where in this design does something
  report success while doing nothing, with the obvious check agreeing? I am most worried about a
  dot that says *ready* over an artefact that is absent or unreadable, and about an auto-run that
  fires, is deduped away, and leaves a spinner that never resolves.
- **Whether the four decisions above are actually what the code can deliver.** In particular: is
  "stale counts as ready" cleanly separable from "exists" in **both** stores, given that the
  Postgres `articleMetadata` computes currency and the filesystem one does not?
- **The empty-state copy.** Four panels and `SketchView` currently read as *press this to begin*.
  Say what they should say once the job is already running, and flag anything in
  `docs/project/copy.md` this would violate.
- **Anything the plan does not mention at all** that it should.

Be concrete: name files and functions. If you think a stage is in the wrong order, or that a stage
should be cut, say so.
