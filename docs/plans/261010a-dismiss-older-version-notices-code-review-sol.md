## Findings

1. **P1** — [useStaleNotices.ts:61](/var/tmp/spideryarn-worktrees/fbmutgym-dismiss-stale-notices/src/web/useStaleNotices.ts:61): queued writes and recovery reads could outlive sign-out and run under another session. Captured the reader/epoch, pinned requests to that reader, and abort old-epoch work before and after network calls.

2. **P2** — [useStaleNotices.ts:146](/var/tmp/spideryarn-worktrees/fbmutgym-dismiss-stale-notices/src/web/useStaleNotices.ts:146): one mode’s failed-POST read-back could overwrite another mode’s newer successful dismissal. Added per-mode press/resolution clocks and overlay-aware reconciliation, with race tests.

3. **P2** — [useStaleNotices.ts:176](/var/tmp/spideryarn-worktrees/fbmutgym-dismiss-stale-notices/src/web/useStaleNotices.ts:176): an already-dismissed banner flashed while the initial GET was pending. Banners now wait until the read succeeds or fails; failure still shows the banner. Added both tests.

4. **P2** — [stale-notice.ts:98](/var/tmp/spideryarn-worktrees/fbmutgym-dismiss-stale-notices/src/stale-notice.ts:98): public Search omitted `finishedAt`, and visitor dismissals shared a constant cache slug. Public reads now expose `finishedAt`; identity is `<runId>@<finishedAt>`, and visitors use the real article slug.

5. **P2** — [sketch.ts:740](/var/tmp/spideryarn-worktrees/fbmutgym-dismiss-stale-notices/src/sketch.ts:740), [illustrated.ts:1415](/var/tmp/spideryarn-worktrees/fbmutgym-dismiss-stale-notices/src/illustrated.ts:1415): byte-identical regeneration produced the same hashed identity. Both stored artefacts now receive `generatedAt`, so regeneration changes the hash while ordinary reads remain stable.

6. **P2** — [schema.ts:5573](/var/tmp/spideryarn-worktrees/fbmutgym-dismiss-stale-notices/src/db/schema.ts:5573): a newline inside one array element could satisfy the database’s separator-based regex even though the route rejected it. Added an independent printable-ASCII check to the schema, migration, and snapshot, plus negative and exact-boundary database tests.

7. **P3** — [useStaleNotices.ts:74](/var/tmp/spideryarn-worktrees/fbmutgym-dismiss-stale-notices/src/web/useStaleNotices.ts:74), [glossary.css:297](/var/tmp/spideryarn-worktrees/fbmutgym-dismiss-stale-notices/src/web/styles/glossary.css:297): a failed-dismissal sentence could follow a regenerated artefact, and used subdued rather than failure colouring. Failure state is now identity-scoped and uses `--danger`.

8. **P3** — [stale-notice-guard.test.ts:127](/var/tmp/spideryarn-worktrees/fbmutgym-dismiss-stale-notices/tests/stale-notice-guard.test.ts:127): the job-progress gates were correct, but lacked regression coverage across all job-bearing panels. Added a guard ensuring they depend on “banner showing,” not raw staleness.

9. **P3** — [routes.ts:11571](/var/tmp/spideryarn-worktrees/fbmutgym-dismiss-stale-notices/src/routes.ts:11571): no further defect found in ownership, route validation, bounded replacement storage, export/registry wiring, or the 390px layout. Owner resolution returns 404 through `articleIdForOwned`; the close control remains fixed-width with a 40px coarse-pointer target and wrapping copy.

Verification:

- Direct underlying typecheck passed all four projects and covered all 3,632 source files. The requested `npm run typecheck` wrapper itself was blocked by sandbox IPC (`EPERM`).
- Requested non-database tests: 7 files, 699 tests passed.
- Expanded touched unit tests: 14 files, 957 tests passed.
- Focused final run: 3 files, 35 tests passed.
- `git diff --check` passed.
- The private-Postgres route test could not start because this sandbox cannot reach Docker/local Postgres; no database was modified.
- No commit, push, or remote database action performed.

land with fixes