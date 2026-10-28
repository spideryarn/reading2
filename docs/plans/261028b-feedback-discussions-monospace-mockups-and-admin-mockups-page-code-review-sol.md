No P0/P1 findings. I fixed two in-scope issues; the deployment path, admin gates, parser agreement, draft restore, closed kind lists, and mockup-link generation otherwise look sound.

## Findings

- **C1 — P2 — fixed:** The mockup list used `checkContent: false`, so HTML renamed as `.png` was advertised even though the image route refused it. The list now validates image signatures at [src/routes.ts:11618](/var/tmp/spideryarn-worktrees/fbzytb0g-feedback-discussions-mockups/src/routes.ts:11618), with the contract clarified at [src/mockups-dir.ts:100](/var/tmp/spideryarn-worktrees/fbzytb0g-feedback-discussions-mockups/src/mockups-dir.ts:100).
  - Red: the new fixture at [tests/admin-mockups-route.test.ts:105](/var/tmp/spideryarn-worktrees/fbzytb0g-feedback-discussions-mockups/tests/admin-mockups-route.test.ts:105) appeared unexpectedly in the catalogue.
  - Green: `tests/admin-mockups-route.test.ts` — 8/8 passed.

- **C2 — P3 — fixed:** Stage 1 left closed-list prose saying feedback had only problem/suggestion/null. Corrected at [src/store/contracts.ts:2977](/var/tmp/spideryarn-worktrees/fbzytb0g-feedback-discussions-mockups/src/store/contracts.ts:2977), [src/types.ts:9554](/var/tmp/spideryarn-worktrees/fbzytb0g-feedback-discussions-mockups/src/types.ts:9554), and [docs/project/feedback.md:655](/var/tmp/spideryarn-worktrees/fbzytb0g-feedback-discussions-mockups/docs/project/feedback.md:655). Prose-only; no red→green test applies.

- **C3 — P2 — wider workspace issue, not fixed:** The untracked feedback note for `spya-zytb0g` makes `src/feedback-endings.generated.ts` stale. The assertion at [tests/feedback-endings.test.ts:48](/var/tmp/spideryarn-worktrees/fbzytb0g-feedback-discussions-mockups/tests/feedback-endings.test.ts:48) fails until that concurrent work regenerates the map. All other 64 tests in that file pass.

## Deployment review

The brace glob at [vercel.json:19](/var/tmp/spideryarn-worktrees/fbzytb0g-feedback-discussions-mockups/vercel.json:19) matches both `certs/**` and `docs/mockups/**` with the installed glob matchers. `.vercelignore` keeps `certs/supabase-ca.crt` and mockups while excluding other docs. The `docs/* → docs` mapping at [scripts/deploy.ts:935](/var/tmp/spideryarn-worktrees/fbzytb0g-feedback-discussions-mockups/scripts/deploy.ts:935) leaves the build-gate roots unchanged: `docs`, `evals`, `tests`, `example`, and `supabase`. No other functional reader of `.vercelignore` was found under `scripts/` or `tests/`.

## Verification

- Clean applicable suite: 7 files, 166 tests passed.
- Exact requested suite: 221 passed, 1 failed, 1 skipped; only C3 failed.
- Focused discussion/mockup tests: 11 passed.
- `npm run typecheck` itself hit sandbox `EPERM` creating the tsx IPC socket. Running its underlying command directly passed all projects and covered all 4,069 source files.
- Scoped lint: no errors; seven pre-existing informational complexity warnings in `src/routes.ts`.
- `git diff --check`: passed.
- PostgreSQL-backed `tests/feedback-store.test.ts` and `tests/admin-feedback-store.test.ts` were not run, as requested.
- No commit made.

Files changed:

- `docs/project/feedback.md`
- `src/mockups-dir.ts`
- `src/routes.ts`
- `src/store/contracts.ts`
- `src/types.ts`
- `tests/admin-mockups-route.test.ts`