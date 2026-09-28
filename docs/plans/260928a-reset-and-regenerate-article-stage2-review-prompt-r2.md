# Code review, stage 2 round 2 + merge: reset an article (plan 260928a)

Reviewer and fixer, narrowly. Repo root is the current directory. Round 2 closes discovery: look
only at what you have not seen.

1. **Your own round-1 fixes**, now committed in `d7c0aa68` (`git show d7c0aa68 -- src/web
   tests`): they are unreviewed code. Check them as if someone else wrote them — especially the
   job-recovery-after-reload logic and `ResetOnlyRegeneration` (duplicate Stop buttons, a job
   shown twice, a watcher that never ends).
2. **The merge of origin/dev**, `e7f41124` and `394390aa`: our migration was renumbered after
   `trajectory` (`drizzle/20260928020355_jobs_reset.sql`, journal entry 91), `STORAGE` gained
   dev's `trajectory` row in `src/store/artifact-storage.ts`, and `trajectory` was classified
   `extra`. Is the classification right (read dev's trajectory plan/doc)? Did the merge leave
   anything of ours or theirs wrong? `git show e7f41124 --stat`, `git diff d7c0aa68 e7f41124 --
   src/reset.ts src/store src/web/ResetArticle.tsx drizzle tests/reset-and-regenerate.test.ts`.
3. **F14**, `cfcd410c`: the classification moved to the client-safe leaf `src/reset-role.ts`.

You can run jsdom and pure tests (`npx vitest run tests/metadata-reset-section.test.tsx
tests/reset-extra-names.test.ts tests/client-imports.test.ts tests/jobs.test.ts
tests/migration-journal.test.ts`). Postgres tests I ran: 20 files, 748 tests, exit 0, and
`npm run typecheck` exit 0, on `cfcd410c`. Fix inside scope red-first; report wider. No commit,
no database, no dev server.

Severity P0–P3 as before; refuse only on an established P0/P1. IDs from F16. Verdict at the end.
