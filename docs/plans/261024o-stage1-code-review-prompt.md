# Code review: Situate stage 1, the server step (261024o)

You are reviewing **uncommitted code** in this worktree for Spideryarn (an AI-assisted reading app).
Since 2026-09-09 the house rule is that **you fix what you find** inside this stage, directly in the
working tree, and report anything wider for me to decide. Do not commit, push, deploy, touch
production, `.env.local`, `infra/` or systemd, or make any paid model call. Never run git commands
that discard work (`checkout --`, `restore`, `stash`, `reset --hard`, `clean`).

**The plan** is `docs/plans/261024o-sources-situate-a-paper-in-the-literature-hands-free-with-margin-notes.md`
(read § the design and the Review table: your own plan review, `docs/plans/261024o-plan-review-sol.md`,
findings S1–S14, and how each was disposed). Stage 1 is the server step only; the client dossier,
privacy page and Marginalia come in later stages.

**The diff**: `git diff HEAD` plus the untracked files `src/situate.ts`, `src/situate-citers.ts`,
`tests/situate.test.ts`, `tests/situate-pg.test.ts`, `drizzle/20261024085240_situate.sql` and its
snapshot. Start with `src/situate.ts`, `src/situate-citers.ts`, the `situateStep` in
`src/pipeline.ts`, the route and store reads (`src/routes.ts`, `src/store/pg.ts`, `loadSituate`),
then the registrations.

The builder's notes on where it departed from the plan:
- Order when everything comes back empty: fewer than half searched (found-or-empty) fails; then if no
  query found anything the run is stored as `outcome: "nothing-found"` with no read; only then does
  "no `found` in the claim group" fail.
- No claim query at all fails before any search is bought.
- A search whose pages carry no extract counts as `empty`.
- A read whose findings all fail the checks is still stored, with its counts.
- No thinking on either call; the article cache breakpoint is always on.

## Look hardest at

1. **Trust boundaries.** Search extracts, citer abstracts and the article are untrusted. Are they
   fenced everywhere; can a model's output smuggle a URL, a block id or a source the run did not
   gather into what is stored and later shown? Is the read owner-only, and is `situate` absent from
   every public/visitor/shared path (`POLICY`, public DTO, export for non-owners, sharing)?
2. **The checks** (article quote in its block, source quote in that source's own text, the citation
   rule needing an `A` source cited in that block, per-block and overall caps, stable ids). Can any be
   satisfied vacuously (empty text, a 6-word quote that is boilerplate, whitespace normalisation)?
3. **Money**: `SITUATE_RATE_POLICY` taken before any paid call, freed in `finally` on every path,
   `oncePerJob`, `FORCE_ONLY_WHEN_NAMED`; can a client or the auto-mode/regenerate paths start a run
   without the owner's press; is cost recorded on the right jobs (`situate-plan`, `situate-search`,
   `situate`) in the ledger.
4. **Staleness/carry**: the stamp (fingerprint, prompt version, model, profileHash), carry policy
   on a new revision, `isCurrent`, `withProfileChanged`. Does a stale artefact behave like Skim's?
5. **Silent success**: anything that reports done while doing nothing (a search that returned
   nothing counted as found, an allowance check that always passes, a test that cannot fail).

Grade findings P0–P3 (P0 data loss/exploitable/incorrect charging; P1 user-visible wrong or a
contract violated; P2 design risk; P3 prose). For each: ID (`C1`…), evidence (file:line), what you
changed or why you didn't. Run `npm run typecheck` and `npx vitest run tests/situate.test.ts
tests/situate-pg.test.ts` after your fixes and say whether they are green. End with a one-paragraph
verdict.
