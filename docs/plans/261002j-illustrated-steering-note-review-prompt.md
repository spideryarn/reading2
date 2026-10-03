# Review request: plan 261002j (Illustrated steering note)

You are reviewing a PLAN, read-only. Repo: Spideryarn (TypeScript, Postgres). Read
`docs/plans/261002j-illustrated-steering-note.md` first, then check its claims against the code:

- `src/illustrated.ts` (`inputFingerprint`, `isStale`, `renderPrompt`, `figuresSection`, `imagePrompt`, header on author influence)
- `src/pipeline.ts` § the `illustrated` step (`stamp`, `run`), `StepContext`, `stepIsDone`
- `src/store/pg.ts` § `illustratedIsCurrent`, `loadIllustrated`
- `src/jobs.ts` § `enqueue`, `sameWork`, `retryJob`, `cascadeForce`; `src/store/jobs.ts` § `workKeyFor`; `src/store/pg-jobs.ts` row mapping; `src/store/pg-successor.ts`
- `src/routes.ts` § `parseJobRequest`, the `POST /api/jobs` handler, `publicJob`
- `src/types.ts` § `Job`
- `src/web/useIllustrated.ts`, `src/web/useStepJob.ts` (`jobBody`), `src/web/IllustratedView.tsx`
- `docs/project/dictation.md` § Adding it to a box; `docs/user-feedback/260904_1244-illustrated-plates-have-no-text.md` § Deferred

Questions I most want answered:
1. Is job-scoped (request field frozen on the job) actually sound against the four failure modes the deferred note named (retry-after-restart, dedupe, freshness, run-from-a-slug)? Any job-construction path that would drop the note (successors, retry, requeue, the client's own dedupe/`watches-queue` matching in useStepJob)?
2. The freshness rule: note in the step stamp (job's note) but read sites use the artefact's own note. Does this create a loop, a never-done state, or a mismatch between the stamp written after the run and the stored `sourceHash`? Where is the post-run stamp written, and does it re-call `stamp(ctx)`?
3. Is the untrusted-input bounding adequate and correctly placed? Anything that lets the note bypass the lettering/quote gates or reach the image call directly?
4. Is anything the plan names as simpler actually wrong, or anything missing (admin views, export, logs, Sentry breadcrumbs carrying request bodies, client-side matching of jobs by body)?
5. Any reason the article-scoped alternative is clearly better?

Write your findings, ranked P0/P1/P2 with file:line evidence, to the output file. Be concrete; say
"no finding" for a question if you have none. Also say whether you agree with the plan's conclusion.
