# Plan review: 261002j — Illustrated steering note

## Findings

**P0 — no findings.**

1. **P1 — The stored-artefact reader would silently discard the note.** `readStoredIllustrated` reconstructs `Illustrated` field-by-field and preserves only `generator`, `illustrator`, `slug`, `sourceHash`, and `profileHash` (`src/illustrated-plate.ts:787-798`). The browser uses that reconstructed value rather than the raw response (`src/web/useIllustrated.ts:232-257`). Merely adding `Illustrated.note`, as Stage 1 proposes (`docs/plans/261002j-illustrated-steering-note.md:118-123`), will not support prefill or provenance. Explicitly read and validate `note` only on the stored path—not from `readModelBrief`—and test legacy-absent and noted round trips.

2. **P1 — The claimed prompt boundary is false.** The plan says the note never reaches the image model “as its own words” and that `caption it ACME` meets the quote/lettering gates (`docs/plans/261002j-illustrated-steering-note.md:84-97`). But the brief’s free-form `plate.prompt` is only length/control bounded (`src/illustrated-plate.ts:850-866`) and passes verbatim into the image request (`src/illustrated.ts:851-887`, `:1307-1315`). Moreover, `lettersFor` intentionally constructs captions from raw model-written vignettes, including quote-invalid vignettes that were dropped from the reader-facing list (`src/illustrated-plate.ts:641-669`, `:900-967`). The code explicitly says dropped content can remain in the composition (`src/illustrated-plate.ts:911-929`) and calls the image envelope “a bar, not a boundary” (`src/illustrated.ts:798-813`).

   There is no direct raw-note-to-image-call path, but the brief model can copy note text into the composition or caption fields. Either describe this honestly as the existing accepted owner-only residual and add a hostile-note eval, or add structural validation if the literal guarantee is required.

3. **P1 — The work-key change must account explicitly for the successor caller.** `workKeyFor` is a positional API whose final argument is `WorkKeyExtras` (`src/store/jobs.ts:81-112`), and `enqueueSuccessorIn` calls it positionally to include reset scope (`src/store/pg-successor.ts:145-158`). The repository already documents the silent-shift class caused by adjacent optional parameters (`src/jobs.ts:3757-3761`), but the plan names `workKeyFor` without naming this caller or the signature design (`docs/plans/261002j-illustrated-steering-note.md:118-123`).

   Put `illustrationNote?: string` in `WorkKeyExtras`, conditionally spread it into the hashed object, and have ordinary `enqueue` supply it. This preserves old no-note hashes and leaves intentionally note-less successors correct. Extend the direct work-key grid with differing-note and successor-shaped calls.

4. **P2 — Job scope does not preserve the original run-from-slug property.** The deferred note says stored scope was needed so running from a slug retains the steer (`docs/user-feedback/260904_1244-illustrated-plates-have-no-text.md:94-101`). The new plan instead deliberately repaints a steered artefact plainly (`docs/plans/261002j-illustrated-steering-note.md:46-54`, `:105-112`). That is coherent, but it should not be presented as satisfying all four deferred invariants.

   The documented command is also wrong: there is no `npm run illustrated` script (`package.json:27-42`). The current generic command is `npx tsx scripts/stage.ts illustrated <slug>`, which enqueues no note (`scripts/stage.ts:277-310`).

5. **P2 — Freshness is sound, but the planned test does not prove the post-run stamp matches.** `stepIsDone` calls `stamp(ctx)` only before running (`src/pipeline.ts:1153-1165`). Afterward, the runner commits the returned parts without re-calling it (`src/jobs.ts:1133-1163`, `:1189-1196`; `src/store/pg-session.ts:759-790`). Illustrated manually assigns `sourceHash` through a second `inputFingerprint` call (`src/pipeline.ts:4380-4389`).

   Both that assignment and the preflight stamp at `src/pipeline.ts:4273-4289` must use the identical immutable `ctx.illustrationNote`, and the artefact must record that same note. Add a test that completes a noted run and then proves a second unforced run with the same note skips. The proposed “new note is not done” test checks only the mismatch case.

6. **P2 — Reuse the existing forbidden-character policy.** The plan refuses control characters except newline/tab (`docs/plans/261002j-illustrated-steering-note.md:77-81`), but Illustrated already also refuses zero-width and bidi-format characters because they can display differently from what was stored or sent (`src/illustrated-plate.ts:568-605`). The note is both displayed and forwarded, so apply the same policy and test a bidi or zero-width case. The route-level 400-character limit is otherwise correctly placed.

7. **P2 — Stage 2 names a nonexistent client seam.** There is no `jobBody`; the canonical request builder is `stepRunRequest` (`src/web/useStepJob.ts:309-339`), called by `start` at `src/web/useStepJob.ts:634-656`. Update the plan and test that function directly; changing `StepRun` alone could compile while omitting the note from the POST.

## Requested questions

1. **Job lifecycle:** Subject to finding 3, job scope is sound for restart/lease lapse, requeue, retry, and dedupe. Requeue retains the same row and uses the common mapper (`src/store/pg-jobs.ts:189-224`, `:1420-1436`). Retry reconstructs from the private stored job (`src/jobs.ts:4365-4400`). Successors are intentionally note-less labels or reset regenerations. `useStepJob` does not dedupe by body: it tracks the POST result by exact ID (`src/web/useStepJob.ts:594-605`, `:634-649`), while cross-tab display selects by slug, step, and queue order (`src/web/useStepJob.ts:443-485`). **No further finding** for retry, requeue, successors, `cascadeForce`, or client queue matching. Run-from-slug is the deliberate exception above.

2. **Freshness:** **No design finding beyond finding 5’s missing regression.** The post-run stamp is the manual assignment at `src/pipeline.ts:4380-4389`; `stamp(ctx)` is not called again. Using the job note on both write-side hashes and the artefact’s recorded note at read time creates neither a loop nor a never-done state.

3. **Untrusted input:** The route is the correct normal-ingress validation seam, and ownership remains enforced by `enqueue`. There is no direct raw-note-to-`draw` call. Findings 2 and 6 are the qualifications.

4. **Other surfaces:** **No finding** for admin, export, logs, Sentry, or body-based client matching. Both export paths serialize the complete Illustrated artefact (`src/store/export.ts:454-456`, `src/store/export-bundle.ts:477-503`). HTTP logs omit bodies (`src/routes.ts:6916-6965`), while Sentry drops request data and disables body/gen-AI capture (`src/monitoring-scrub.ts:112-190`, `src/monitoring.ts:180-199`). No admin job view needs the private field.

5. **Article scope:** **No finding that makes it clearly better overall.** It is specifically better for CLI and reset inheritance. Job scope otherwise fits a frozen per-run request and avoids mutable article state, another write route, and “edited since this picture” semantics.

## Verdict

I agree with the job-scoped conclusion, but not with the plan as written. Fix findings 1–3, state the CLI/reset trade-off honestly, and add the post-run freshness and hostile-note tests. With those amendments, job scope is the simpler sound choice.