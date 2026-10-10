LAND AFTER FIXES

C1 — P1 — Fixed: stale tabs lost job progress after starting a renamed step. The old hook matches exact step names, while the new server stores canonical names. Added one-deploy aliases to `GET /api/jobs`, with current-client decoding and a contract-removal note: [step-order.ts](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/src/step-order.ts:232), [routes.ts](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/src/routes.ts:7733), [jobEngine.ts](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/src/web/jobEngine.ts:110), [job-step-wire-compat.test.ts](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/tests/job-step-wire-compat.test.ts:8). The old POST client reads only `started.id`, so its response needs no alias.

C2 — P1 — Reported, not fixed here: during migration-before-code deployment, a pre-rename sharing job can see the new `reception` or `sources-claims` mirrored run as an unrelated change and reject completed work with `step-runs-moved`. This is the Stage 3 extension of the already documented Bibliography race: [plan](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/docs/plans/261009w-peer-review-becomes-sources-all-the-way-down.md:432). It is rare and recoverable, but production deployment still needs Greg’s explicit acceptance or a quiesce/drain/compatibility deployment. Current code handles both spellings after deployment. I did not edit the protected migration.

C3 — P2 — Fixed: ten live command-pick gold labels named catalogue IDs that no longer exist. Updated them to `mode:sources`, `submode:sources:bibliography`, and `submode:sources:reception`, and added a guard against retired IDs: [phrases.ts](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/evals/command-pick/phrases.ts:152), [command-pick-catalogue.test.ts](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/tests/command-pick-catalogue.test.ts:328). Dated raw/results files remain frozen.

C4 — P2 — Fixed: the live Reception eval still wrote `output/debate-runs` and used Debate names in headings, cost diagnostics, schemas, and usage text. These now use Reception consistently, including [journal-rows.ts](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/evals/reception/journal-rows.ts:56) and [run.ts](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/evals/reception/run.ts:102).

C5 — P3 — Fixed: stale reader copy, authoritative docs, logs, and current-code comments. This includes “Reception in Debate”, visitor noun “a debate”, privacy wording, Sources route/origin documentation, URL parameters, setup environment variables, and “Debate, an angle”: [PrivacyPage.tsx](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/src/web/PrivacyPage.tsx:416), [visitor.ts](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/src/web/visitor.ts:98), [reception.md](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/docs/project/reception.md:14), [sources.md](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/docs/project/sources.md:160). Help and AGENTS signposts were already current. `liftLegacyDebateBy`, prompt versions, fences, hashes, historical results, and ordinary English uses of “debate” remain deliberately named.

The remaining compatibility matrix passed inspection: article columns and step runs mirror both spellings; job ingress canonicalizes old names; chat origins split old `debate` rows by shape; the old claim-check store’s SELECT/INSERT/UPDATE/DELETE work through the view; current rate limiting counts both buckets; stale notices accept both modes; and old route aliases preserve null responses, envelopes, headers, and SSE frames.

Validation:

- Targeted unit batch: 17 files, 547 passed, 2 skipped.
- Final focused rerun: 5 files, 90 passed, 2 skipped.
- Supplied PostgreSQL evidence: [8 files, 244 passed](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/docs/plans/261009w-stage-3-pg-tests-output.txt:8).
- All four TypeScript projects passed `tsc --noEmit`. The `npm run typecheck` wrapper itself could not create its `tsx` IPC socket in the sandbox.
- `git diff --check` passed.
- No commit made.

The protected migration acquired concurrent edits from its separate reviewer during this review; I neither authored nor reverted them.