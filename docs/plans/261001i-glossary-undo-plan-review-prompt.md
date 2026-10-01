You are reviewing a plan, read-only. Repo: this worktree (Spideryarn, TypeScript, Postgres via drizzle).

Read docs/plans/261001i-glossary-undo-find-more-and-say-append-or-rewrite-in-metadata.md, then check it against the code:
- src/glossary.ts (existingFor, generateGlossary), src/store/pg.ts (articleMetadata), src/routes.ts (resolveProfile, POST /api/jobs profile resolution, glossary routes), src/profile.ts (renderProfile, hashProfile)
- src/store/pg-glossary.ts (deleteGlossary, its lock and liveJobHoldingADraftQuery), src/store/pg-revisions.ts (beginDraftIn, publishRevisionIn, STEP_RUN_CARRIED_COLUMNS, rebaseSharingDraftIn), src/db/schema.ts (article_revisions.based_on_revision_id, glossary_lookups)
- src/web/Metadata.tsx (RerunRow, RERUN_COST_NOTE), src/web/GlossaryPanel.tsx (Foot), src/web/useGlossary.ts
- Stage 1 is already built, uncommitted: the diff of src/web/ResetArticle.tsx and tests/metadata-reset-section.test.tsx against HEAD.

Questions:
1. Is the verdict in part 3 guaranteed to equal what the next Metadata-triggered glossary job's existingFor will decide? Trace the sourceHash (articleHash in articleMetadata vs articleFingerprint in generateGlossary — same meta fingerprint?), the profile (resolveProfile vs renderProfile over articleMetadata's profile/purpose), and PROMPT_VERSION. Name any divergence concretely.
2. Part 2's Undo: is the "pure append on the nearest differing ancestor" rule correct and sufficient (no redo, no restoring a list written for another source/profile)? Is minting a draft via beginDraftIn inside a non-job transaction and publishing via publishRevisionIn sound — locks, lineage, publish checks, the run-row swap, interactions with jobs that open drafts later or with rebaseSharingDraftIn? Anything that would make publishRevisionIn refuse?
3. Is there a simpler design that gets the same reader value for meaningfully less code? Push back if the Undo is not worth it.
4. Anything missing from the tests. Is stage 1's latch correct?
Answer as a numbered list of findings with severity (P0-P3), each with file:line evidence and a concrete fix. End with a verdict: ready / revise.
