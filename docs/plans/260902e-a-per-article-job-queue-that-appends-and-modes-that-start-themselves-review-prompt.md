# Review: a per-article job queue that appends, and modes that start themselves

You are reviewing a **plan, before any code is written**. Repository root is this working
directory (a git worktree of the Spideryarn repo, branch `worktree-article-job-queue`). Read-only:
do not edit anything.

## The plan

`docs/plans/260902e-a-per-article-job-queue-that-appends-and-modes-that-start-themselves.md`

Read it in full first. It is a **recut of two earlier plans that you yourself reviewed NO-SHIP**,
so please read those and your own reviews before judging whether the recut answers them:

- `docs/plans/260830ar-several-articles-at-once.md` and
  `docs/plans/260830ar-several-articles-at-once-review-sol.md` — stage 1 of that plan shipped; its
  **stage 2** is stage 1 of the new plan.
- `docs/plans/260831ai-which-modes-are-ready-in-the-bottom-bar-and-running-one-by-clicking-it.md`
  and `…-review-sol.md` — only the **auto-run half** is in scope now; the readiness dot is
  explicitly dropped.
- `docs/plans/260830aq-late-steps-read-the-store.md` and `…-review-sol.md` — the named prerequisite.
  The new plan claims it is **built**, and that its `Status: plan, unbuilt` line is stale. Please
  verify that claim independently rather than taking it: `src/jobs.ts` § `claimSession`,
  `src/store/pg-session.ts`, `src/pipeline.ts`'s late-step `run` functions,
  `tests/late-step-on-a-cold-instance.test.ts`, `tests/claim-session-postgres.test.ts` § *"runs a
  late single step that reads the article from the store, not from its empty root"*, and commit
  `c42c940`. **If it is not actually built, that is the most important thing you can tell me**,
  because the whole of stage 1 rests on it.

## The code the plan touches

`src/db/schema.ts` (the `jobs` table and `jobs_active_slug`), `src/store/jobs.ts` (the `JobStore`
contract), `src/store/pg-jobs.ts` and `src/store/jobs-fs.ts` (the two adapters — the filesystem one
is the local default, not a secondary), `src/jobs.ts` (`enqueue`, `claim`/`advanceJobWith`/
`walkClaim`, `freeSlug`, `JobConflict`), `src/routes.ts` (`POST /api/jobs` and `structuredDetail`),
`src/job-state.ts` (the reader-facing sentences), and on the client `src/web/jobEngine.ts`,
`useJobs.ts`, `useStepJob.ts`, `Dock.tsx`, `JobProgress.tsx` and the five panels
(`GlossaryPanel`, `IdeasPanel`, `QuotesPanel`, `TimelinePanel`, `SketchView`).

## What I most want from you

Answer the plan's four **Open questions for the review** explicitly, and then:

1. **Is the FIFO predecessor rule with no sweep sound?** You asked for the predecessor rule and,
   separately, refused the `last_seen_at` sweep. Put together they leave an abandoned `queued` row
   blocking one article's line indefinitely. § 1d argues the residue is small, visible and
   stoppable, and that a `cancelling` predecessor is skipped. Is that enough, or does FIFO need a
   way out that is not an age-based sweep?
2. **Is the three-index design right this time**, with the running mutex and the reservation global
   on `slug`, `jobs_active_work` owner-scoped and excluding `cancelling`, and the caller re-reading
   the slug's active rows rather than dispatching on a constraint name? Name any pair of rows that
   can violate two of them at once, and any state that now slips through all three.
3. **Is `reserves_name` = "`freeSlug` minted rather than adopted" the right narrowing** of your
   correction that "carried a URL or upload" is too broad? Check the upload path, which calls
   `slugWithShortId` directly rather than through `freeSlug`.
4. **What breaks that the plan has not noticed?** In particular anything else in the tree that
   assumes at most one active job per slug — the plan names `activeForSlug`,
   `inFlightSlugForUrlKey`, `useStepJob`'s `.find()`, and the upload repeat-claim recovery, and I
   expect there are more.
5. **Is deleting the whole `blocking`/`JobConflict`/`ARTICLE_IS_BUSY` path correct**, or does a
   reader lose a sentence they need once "waiting behind another job on this article" exists only
   in the server log? Greg has chosen "just show them as waiting" and no queue positions.
6. **Stage 2's activation token.** Greg has decided that only a click on the mode in the bottom bar
   auto-runs; a pasted `?mode=quotes` URL and Back/Forward must not spend. Is a one-shot token set
   by `Dock.tsx` and consumed after the panel's own GET returns `none` the right shape, and where
   would it leak — a click that navigates to a *different* article, a click on a mode whose panel
   is already mounted, two panels mounting from one token, React StrictMode's double invoke?
7. **The one-attempt-per-`(slug, step)`-per-session guard** is what replaces the button as the
   structural answer to the original version's generate-fail-generate loop. Is holding it in the
   module-scope job engine, marked before the request goes out, actually sufficient — and does it
   interact correctly with stage 1's de-duplication, where an auto-run may now collapse onto a job
   the reader started by hand a moment earlier?
8. **The test list.** Which of my stage 1g and 2e tests would pass while the feature was broken, and
   what is missing? I care most about the cases where a green suite proves nothing.

## Ground rules

- Be concrete and name files and lines. Say NO-SHIP if it deserves it.
- Where you disagree with a decision Greg has already made (serial within an article, no queue
  positions, click-only auto-run, no dot), say so once and then design within it.
- Do not propose work that belongs to the readiness dot, to within-article parallelism, or to the
  database move — all three are explicitly out of scope.
