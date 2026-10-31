You are reviewing built code in the Spideryarn repo (current directory, a git worktree), before it is pushed.

Plan: docs/plans/261031c-archiving-leaves-a-public-article-on-the-public-list.md (read it whole, including "After the plan review").
Your earlier plan review: docs/plans/261031c-archiving-leaves-a-public-article-on-the-public-list-plan-review-sol.md.
The diff: `git diff HEAD` in this worktree (uncommitted; also `git status` for new files).

Rule now: archiving is one person's shelf only. A shared (visibility = 'public') article stays on /read/public, in Bibliography's cited candidates and in the public-copy offer whether or not it is archived. Archive / Put back / an open never refresh the public topic pills. Opening an archived article still un-archives it.

Please check, with file:line evidence:
1. Correctness of the new `recordOpen` single UPDATE in src/store/pg-shelf.ts (the `case when archived_at is not null then clock_timestamp() else updated_at end` reads the OLD row value in Postgres UPDATE SET? confirm), its not-found path, and that the open-times insert still behaves.
2. The Include public gate in src/web/Library.tsx (`wantsPublic`, `ownKnown`, `archiveWanted`, the effect) and src/web/ShelfPublicSection.tsx: no fetch loop on failure, no regression for Include archived (ArchiveStatus, topics via useShelfTopics, search key), no stale state across reader change, and the count beside a search (ShelfSearchAlso) waits correctly. Also: loadArchived's failure sets a shelf notice — is that notice now shown to a reader who only turned on Include public or typed a search, and is its wording then confusing? Fix if so, simply.
3. The cited-candidate `archived` column is never true for a stranger's article; nothing else in that query or src/cited-in-spideryarn.ts / src/public-copy.ts leaks a stranger's archive state.
4. Anything still encoding the old rule (grep src, tests, docs, evals for archiv near public/listed/listing), and any test that now passes vacuously.
5. tests/billing-admission.test.ts: the archived case moved from "never offered" to a positive offer test — right?
6. Anything else wrong.

You may edit files to fix what you find inside this change's scope. Do not commit, do not push, do not touch .env*, infra/, systemd, or any database other than the local test one. Run `npm run typecheck` and the tests you touch (`npx vitest run <files>`).

Finish with: a numbered list of findings (each: severity, file:line, what you changed or why you did not), the list of files you edited, and a one-line verdict: "VERDICT: ship", "VERDICT: ship after my fixes", or "VERDICT: do not ship".
