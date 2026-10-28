# Code review: 261028b, stages 1–3

You are reviewing and fixing code in this worktree. The diff is `git diff 843a6c019..64d84eadb` (three
commits: stage 1 an admin-only Feedback kind "discussion"; stage 2 fenced monospace blocks in
question bodies; stage 3 `/admin/mockups` read from `docs/mockups/` at runtime). The plan and its
plan review: docs/plans/261028b-feedback-discussions-monospace-mockups-and-admin-mockups-page.md and
…-plan-review-sol.md. Untracked and not yours to review: docs/user-feedback/questions/q-cgpett.md.

**Fix what is inside these stages, narrowly and red-first** (a failing test before the fix), and
**report, do not fix, anything wider**. Do not commit. Do not edit docs/project/overseer.md,
AGENTS.md/CLAUDE.md, anything under docs/reusable/, or the `/api/admin/` gate itself. You have no
network, so anything needing Postgres is mine to run: say which tests you could not run.

Where I most want eyes, highest stakes first:

1. **The deploy path (production, highest bar).** `vercel.json` `includeFiles` is now
   `{certs/**,docs/mockups/**}`; production's DB TLS needs `certs/supabase-ca.crt`
   (`PGSSLROOTCERT=certs/supabase-ca.crt`, docs/project/deployment.md ~888). `.vercelignore` changed
   `docs` to `docs/*` + `!docs/mockups`, and `scripts/deploy.ts` § `prunedRootsIn` now maps `docs/*`
   to `docs`. Is there any way this loses `certs/` from the function, uploads more of `docs/` than
   intended, or breaks the deploy's build gate? Check every other reader of `.vercelignore` in
   `scripts/` and `tests/`.
2. **The mockup routes** (`src/routes.ts`, `src/mockups-dir.ts`, `src/mockups.ts`): path handling
   from URL to disk (id, index, symlinks, `..`), content-type and first-bytes check, caps, a bad file
   left out of the list rather than failing it, admin-only (a non-admin refused on all three).
3. **Stage 2's parser** (`src/plain-text-blocks.ts`, `src/feedback-question-values.ts`
   `detailsLines`/`splitQuestionBody`/`publishedQuestionProblem`, `scripts/feedback-endings.ts`): that
   the compiler, the server's row check and the dialog agree, and that no already-published row can
   now fail the whole questions list.
4. **Stage 1**: `discussion` refused at the route for non-admins before diagnostics decoding;
   the draft restore for a non-admin; every closed list of kinds.
5. `src/web/PlainTextBlocks.tsx` `linkMockups`: can text produce a link anywhere but
   `/admin/mockups/<valid id>`?

Run what you can: `npx vitest run tests/plain-text-blocks.test.ts tests/plain-text-blocks-links.test.tsx
tests/mockups.test.ts tests/vercel-include-files.test.ts tests/feedback-question-values.test.ts
tests/feedback-endings.test.ts tests/router.test.ts` and `npm run typecheck`.

Severity: P0 (ships broken or unsafe), P1 (likely bug), P2 (worth changing), P3 (nit). Each finding
gets an ID (C1, C2…), file:line evidence, whether you fixed it, and the red→green test if so. End
with the list of files you changed. My suspicions: the brace glob in includeFiles, and whether
`prunedRootsIn`'s new mapping changes which roots the build gate renames aside.
