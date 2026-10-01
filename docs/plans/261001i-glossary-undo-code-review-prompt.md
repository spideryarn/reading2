You are reviewing code in this worktree (Spideryarn: TypeScript, React, Postgres via drizzle), and you may FIX what you find inside this change's scope. Report anything wider for me to decide. Do not commit. Do not run `git` commands that discard work (no checkout/restore/stash/reset/clean).

The change is commit d4c29a3f (the diff from 596653d0 to d4c29a3f). The plan, with its outcome and the plan review it answered, is docs/plans/261001i-glossary-undo-find-more-and-say-append-or-rewrite-in-metadata.md; the plan review is docs/plans/261001i-glossary-undo-plan-review-sol.md.

What it does:
1. src/web/ResetArticle.tsx: `useResetJob.retry`, a single-flight latch copied from `useStepJob.retry` (src/web/useStepJob.ts).
2. src/glossary.ts: `glossaryRunKind` and `runProfileHash`; src/store/pg.ts `articleMetadata` returns `glossaryRun`; src/types.ts `ArticleMetadata.glossaryRun`; src/web/Metadata.tsx: the glossary RerunRow's label and note follow the verdict (`GLOSSARY_RUN`), and saving the purpose re-reads the metadata.
3. Undo (part 2) was deliberately NOT built. Do not build it.

Check in particular:
- Can the verdict disagree with what the job actually does, in a way the reader would plausibly hit? Trace POST /api/jobs (src/routes.ts, resolveProfile, useProfile) for the Metadata press, and generateGlossary's existingFor call.
- Does the label change on the glossary row break anything that keys on "Run it again" / "Run it" for that row: tests, aria descriptions, the `pressing` latch, `about`?
- The ResetArticle latch: is there any path that strands `starting` true or `inFlight` held — for example the confirm's `busy`/`pending` flow, unmount, or a retry whose new job is never listed?
- The new tests: would each go red if its code were reverted? The Postgres one is tests/store-glossary-run-kind-pg.test.ts.
- Copy: the two notes are reader-facing. Plain, accurate, short?

Run the focused gates after any fix:
  npx vitest run tests/metadata-rerun-section.test.tsx tests/metadata-reset-section.test.tsx tests/glossary-run-kind.test.ts tests/store-glossary-run-kind-pg.test.ts tests/glossary.test.ts
  npm run typecheck   (judge it by the exit code)

Answer with a numbered list of findings (P0–P3), each with file:line and what you changed (or why not). End with a verdict: ready / not ready.
