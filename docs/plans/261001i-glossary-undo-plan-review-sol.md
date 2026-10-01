1. **P1 — `expectEntries` is not a sufficient compare-and-swap guard.** The plan treats an equal count as proof that the displayed list is still current ([plan:119](</home/greg/code/spideryarn2/.claude/worktrees/fu-metadata-glossary-rerun/docs/plans/261001i-glossary-undo-find-more-and-say-append-or-rewrite-in-metadata.md:119>)). A stale client can undo somebody else’s later pass:

   - client A sees pass 2 with 12 entries;
   - another client undoes it to pass 1 with 10;
   - a new append produces a different pass 2 with 12;
   - A’s request still matches the count, source, version, profile, pass increment and ancestor-id checks, so it undoes the new pass.

   Concrete fix: return an opaque hash of the stored glossary from `GET /api/glossary/:slug`, send it as `expectGlossary`, and compare it under the article lock. Hashing the glossary already in memory adds no ancestry query. Keep `expectEntries` only for the displayed removal count.

2. **P2 — entry counts cannot establish that this session watched its own Find-more pass.** `useStepJob` announces every newly completed job for the slug and step, including one started in another tab ([useStepJob.ts:308](</home/greg/code/spideryarn2/.claude/worktrees/fu-metadata-glossary-rerun/src/web/useStepJob.ts:308>), [useStepJob.ts:353](</home/greg/code/spideryarn2/.claude/worktrees/fu-metadata-glossary-rerun/src/web/useStepJob.ts:353>)). Therefore the plan’s “count before and after is all it needs” rule ([plan:89](</home/greg/code/spideryarn2/.claude/worktrees/fu-metadata-glossary-rerun/docs/plans/261001i-glossary-undo-find-more-and-say-append-or-rewrite-in-metadata.md:89>)) can show Undo after a rewrite, first run, or another tab’s job merely because the count increased; the server then answers 409.

   Concrete fix: bind the offer to the exact job returned by this tab’s `more()` call. Expose that job ID from `useStepJob.start`, remember the pre-run glossary token, and offer Undo only after that ID finishes and the refreshed glossary has the expected compatible pass. Counts should determine “Found N”, not eligibility.

3. **P2 — the Metadata verdict is identical only for the same snapshot; it is not guaranteed to match the eventual job.** The source calculation is correctly identical: Metadata and generation both call `articleFingerprint` ([pg.ts:2862](</home/greg/code/spideryarn2/.claude/worktrees/fu-metadata-glossary-rerun/src/store/pg.ts:2862>), [glossary.ts:1335](</home/greg/code/spideryarn2/.claude/worktrees/fu-metadata-glossary-rerun/src/glossary.ts:1335>)). The profile rendering is also identical while the fields remain unchanged ([pg.ts:3257](</home/greg/code/spideryarn2/.claude/worktrees/fu-metadata-glossary-rerun/src/store/pg.ts:3257>), [routes.ts:5779](</home/greg/code/spideryarn2/.claude/worktrees/fu-metadata-glossary-rerun/src/routes.ts:5779>)), and `existingFor` uses the same `PROMPT_VERSION` within one deployment ([glossary.ts:105](</home/greg/code/spideryarn2/.claude/worktrees/fu-metadata-glossary-rerun/src/glossary.ts:105>), [glossary.ts:407](</home/greg/code/spideryarn2/.claude/worktrees/fu-metadata-glossary-rerun/src/glossary.ts:407>)).

   Concrete divergences remain:

   - the article, global profile or purpose changes after Metadata loads;
   - another queued job publishes before this glossary job opens its draft;
   - `resolveProfileParts` transiently fails its shelf read and deliberately drops the purpose ([routes.ts:5819](</home/greg/code/spideryarn2/.claude/worktrees/fu-metadata-glossary-rerun/src/routes.ts:5819>));
   - a rolling deployment changes `PROMPT_VERSION` between the GET and job execution.

   Concrete fix: describe `glossaryRun` as a current-state prediction, not a guarantee, and make the note say “With the article and profile as they are now…”. A strict guarantee would require the POST to bind the job to the predicted revision/profile/prompt snapshot or reject when they differ, which is disproportionate here.

4. **P2 — the ancestry predicate is sound, but restoring the ancestor’s run row needs validation and publication failure handling.** Same `sourceHash`, `version` and `profileHash`, a one-step `passes` increment, retained ancestor IDs and a new ID are sufficient under the generator’s contract to prevent redo and cross-source/profile restoration. A second Undo fails because the restored list’s `passes` is lower than its appended parent’s. Note that “pure append” is not literal: deduplication can rewrite an incumbent entry while preserving its ID ([glossary.ts:488](</home/greg/code/spideryarn2/.claude/worktrees/fu-metadata-glossary-rerun/src/glossary.ts:488>), [glossary.ts:617](</home/greg/code/spideryarn2/.claude/worktrees/fu-metadata-glossary-rerun/src/glossary.ts:617>)).

   The missing guard is the ancestor run row. `stampForStep` rejects disagreement between the artefact and row ([artifacts-pg.ts:680](</home/greg/code/spideryarn2/.claude/worktrees/fu-metadata-glossary-rerun/src/store/artifacts-pg.ts:680>)), while `publishRevisionIn` checks blocks, tree and hierarchy—not glossary consistency ([pg-revisions.ts:2210](</home/greg/code/spideryarn2/.claude/worktrees/fu-metadata-glossary-rerun/src/store/pg-revisions.ts:2210>)). A missing or legacy-mismatched ancestor row could therefore be published as an inconsistent current revision.

   Concrete fix: refuse unless the ancestor has a `done` glossary row whose input hash, prompt version and model agree with its glossary; restore its carried columns with `attempt_id = null`. Also document and test that `publishRevisionIn` may refuse for missing blocks/tree or a non-current hierarchy row ([pg-revisions.ts:1811](</home/greg/code/spideryarn2/.claude/worktrees/fu-metadata-glossary-rerun/src/store/pg-revisions.ts:1811>), [pg-revisions.ts:1885](</home/greg/code/spideryarn2/.claude/worktrees/fu-metadata-glossary-rerun/src/store/pg-revisions.ts:1885>)). Capture its result and call `logPublication` after the transaction commits, as the existing wrapper does ([pg-revisions.ts:2059](</home/greg/code/spideryarn2/.claude/worktrees/fu-metadata-glossary-rerun/src/store/pg-revisions.ts:2059>)).

5. **P2 — I would defer Undo unless there is evidence readers need it.** The existing foot already replaces the button with progress and offers cancellation while the long-running pass is active ([GlossaryPanel.tsx:1970](</home/greg/code/spideryarn2/.claude/worktrees/fu-metadata-glossary-rerun/src/web/GlossaryPanel.tsx:1970>)). The result is additive, the threshold can hide noise, and the plan itself characterises accidental use as rare. Exact post-publication Undo adds an endpoint, ancestry traversal, revision copy, run-row surgery, concurrency rules and substantial tests.

   Concrete fix: ship the truthful Metadata verdict plus a transient “Found N more terms” receipt, relying on the existing Stop control for an immediate accident. Build exact Undo only after a reader demonstrates that post-completion reversal matters. If Undo remains in scope, retain the revision-based design; it is safer than mutating the published revision in place.

6. **P3 — test coverage needs the concurrency and consistency cases above; Stage 1 itself is sound.** The Retry latch sets the ref and visible state before awaiting, adopts the returned job, and releases only on refusal or when polling sees it ([ResetArticle.tsx:227](</home/greg/code/spideryarn2/.claude/worktrees/fu-metadata-glossary-rerun/src/web/ResetArticle.tsx:227>), [ResetArticle.tsx:276](</home/greg/code/spideryarn2/.claude/worktrees/fu-metadata-glossary-rerun/src/web/ResetArticle.tsx:276>)). Its double-click and refusal tests exercise the right gaps ([metadata-reset-section.test.tsx:708](</home/greg/code/spideryarn2/.claude/worktrees/fu-metadata-glossary-rerun/tests/metadata-reset-section.test.tsx:708>)); the focused suites passed, 54/54 tests.

   Add tests for:

   - a different same-count glossary replacing the one the client observed;
   - another tab’s completion and a rewrite increasing the count without offering Undo;
   - an append whose richer duplicate mutates an incumbent, then exact restoration;
   - missing/mismatched ancestor glossary run rows;
   - publication refusal rolling the entire Undo back;
   - a job attempting to open a draft while Undo holds the article lock;
   - the 50-ancestor boundary;
   - invalid Undo bodies and the authenticated-route inventory;
   - an integration test proving `articleMetadata` and a Metadata-style `POST /api/jobs` render the same profile from both global profile and purpose. The current helper test only proves `glossaryRunKind` itself.

**Verdict: revise.**