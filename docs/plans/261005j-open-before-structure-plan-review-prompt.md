Review this plan before it is built. Read-only: do not edit files.

Candidate: a pre-commit plan on base 03144f563. One untracked file:
docs/plans/261005j-open-the-article-before-structure-and-swap-the-real-tree-in-live.md

Background, in order: docs/investigations/261004e-open-the-article-before-structure-and-assets-where-the-import-s-time-goes-and-what-deferring-costs.md,
docs/plans/261004l-figures-arrive-after-a-paper-opens-and-an-open-article-re-reads-itself.md and its
plan-review-sol.md (your nine P1s on the neighbouring plan), and
docs/plans/260831ah-toc-on-request-and-the-tree-that-costs-nothing-review-sol.md (ten P0s on the
last attempt at this exact goal). This attempt has been stopped twice because the list of things
that assume a real tree was incomplete. Finding what the list still misses is the main job.

The code it would change (start here; this does not limit scope):
- src/store/pg-revisions.ts (`publishRevisionIn`, `reasonsNotToPublish`, `queueMainModesIn`), src/store/pg-successor.ts
- src/jobs.ts (`enqueue`, `retryJob`, the step walk near `stepIsDone`, `unrunnableStepPlan`), src/store/pg-jobs.ts (`blockedByAnother`)
- src/pipeline.ts (`STEPS.structure`, `stepIsDone`, `StepContext`), src/structure.ts (`generateStructure`, `fromHeadings`, `finishStructureRun`), src/heading-tree.ts (`buildBoundedHeadingTree`)
- src/store/artifacts-pg.ts (`writeArtefacts`, the pending labels manifest), src/store/pg-session.ts (`settleIn`)
- src/routes.ts (the add-by-URL and upload enqueues), src/types.ts (`Tree.provisional`, `JobStep`)
- src/web/article/access.ts, src/web/article/ArticlePage.tsx, src/web/useJobs.ts, src/web/jobEngine.ts, src/web/useArc.ts, src/web/useStepJob.ts, src/web/modes/structure (the band)

Do an independent pass first: read the code, do not take the plan's word. Then say for each of these
whether it holds, with file:line:

1. The stand-in is written by the `structure` step itself, in the import job, marked
   `provisional: "awaiting-structure"`, so the publication gate is untouched. Does anything between
   the step's return and the publication refuse or mis-handle that (`finishStructureRun`,
   `writeArtefacts`, `checkProduct`, `checkTree`, `structureCurrency`)? Anything that switches
   exhaustively on `provisional` or on `StructureSource`?
2. `JobStep.headingsFirst` kept in the job's `steps` JSON with no migration: does every reader and
   writer of that JSON round-trip an unknown field (pg-jobs.ts `toJob`, the fenced raw row, a claim
   handed back, `retryJob`, the client's Job type)? Is `allocation.kind === "minted"` plus
   `store.hasEarlierBlocks` the right test for "never published", including an adopted slug, a retry
   of a failed first import, and two tabs adding the same URL?
3. `STEPS.structure.isDone` answering no while the tree is awaiting: does the successor then really
   run the model, on a draft that carried the stand-in's `done` run row and labels manifest? Does a
   handed-back claim of the IMPORT job re-run structure because of it, and is that harmless? Does
   anything else read "structure is done" by existence (Metadata, `unrunnableStepPlan`, labels'
   prerequisites)?
4. The three publication triggers. Suppressing `labels` and the main modes at an awaiting
   publication and firing the modes at "previous revision awaiting, this one not": any path where
   the modes fire twice, or never (structure job fails then the reader presses Rebuild; structure
   retried from its card; `auto_modes_off_at`; the structure successor deduplicated or
   `boundToOlderBase`)? Is re-queuing `["structure"]` on every later awaiting publication safe?
5. Ordering: is it true that every job a reader or the client can start on the article in those
   seconds (arc, a mode press, a Metadata re-run, assets) waits behind the queued structure
   successor, and opens its draft on the revision the successor published? What does a mode job do
   if it was already RUNNING... can one be? What about the job the add page's own code posts after
   opening the article, if any?
6. The runner gate "any step after `structure` in STEP_ORDER except `assets` is `blocked` while the
   tree is awaiting": right place, right failure kind, right sentence? Does it wedge anything
   (a job with several steps, a reset regeneration, `labels` queued by an older publication)?
7. Billing: the import is charged at the awaiting publication. Any ledger rule, refund path or
   "first publication" hook (welcome state, shelf terms, link previews, public listing, sharing)
   that now fires on a stand-in or fires twice?
8. The client hook as a level check on the jobs snapshot. Is "the list has been read and shows no
   queued or running structure job for this slug" computable from what `useJobs` exposes, and is it
   ever true too early (before the successor is in the list: is the successor guaranteed visible in
   the same list that shows the import done?) or never (KEEP_FINISHED, a hidden tab, the engine
   asleep with only quiet subscribers: who wakes it)? Does the fetch hit `takePreloaded` and get the
   stale payload back?
9. Swapping only `tree`, `navLabelStatus` and `arc` into the held article: is anything else in the
   owner payload derived from the tree or changed by `structure` (it declares `produces: ["tree",
   "labels", "blocks"]`; what does it change in blocks?), and does any client state survive the swap
   holding something stale (geometry refs, `withChildLists`, Structure/Outline/Diagram, Skim, quiz
   tallies, `?at=` rewriting, last-view)?
10. What does a reader actually see for those seconds on (a) an article with good headings, (b) a
    headingless article (the bounded builder's windows and stock titles), (c) a PDF? Is any of it
    worse than waiting, and should Structure hide the stand-in rows rather than draw them?
11. The claim that route 1 (tree-only swap) is no more complex than route 2 (auto reload). Fair?
12. Anything in the "passed over" list that is actually the better design.

Give findings as F1..Fn with P0/P1/P2, each ESTABLISHED (you read the code that proves it) or
REASONED. End with a verdict: build as planned, build with changes, or do not build.
