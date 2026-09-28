No P0 findings. I fixed two P1 issues and left seven files modified, uncommitted.

### Findings

- **S2-1 — P1 — established:** skipped extractions counted as works, affecting the eight-work threshold, document-frequency band, IDF, and report coverage. The red test observed eight chooser inputs instead of seven. Fixed by excluding skipped runs before `chooseTerms`; the report now excludes them from chooser and coverage while retaining `scope.skipped`. `scope.articles` deliberately remains the whole visible shelf, including skipped and pending articles, so the shelf-size label stays stable. Evidence: [pg-shelf-terms.ts:270](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/src/store/pg-shelf-terms.ts:270), [shelf-terms-report.ts:88](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/scripts/shelf-terms-report.ts:88), [unit regression:51](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/tests/shelf-terms-warm-path.test.ts:51), [Postgres assertion:257](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/tests/shelf-terms-pg.test.ts:257).

- **S2-2 — P1 — established:** the terms set disagreed with `/api/library`. `listArticles` excludes revisions with no tree or no blocks, while `shelfRevisionsQuery` did not. The original Stage 2 fixtures themselves had no tree, meaning the test shelf could produce topics while `/api/library` displayed no cards. Fixed by mirroring the tree and block-count boundary, including the legacy null-scalar fallback, and making fixtures genuinely shelf-readable. Added SQL-shape and Postgres parity regressions. Evidence: [terms query:72](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/src/store/pg-shelf-terms.ts:72), [library boundary](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/src/store/pg.ts:2526), [unit regression:65](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/tests/shelf-terms-warm-path.test.ts:65), [Postgres regression:400](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/tests/shelf-terms-pg.test.ts:400).

- **S2-3 — P2 — reasoned, report only:** shelf membership still has two implementations. The terms query now matches the current library behavior, but a future change to `listArticles`’ post-query readability rules could diverge again. A truly shared predicate would require restructuring the library’s scalar-repair/post-filter path, which is wider than this review. The new parity regression protects the known boundary.

- **S2-4 — P2 — established:** the candidate tests covered same-version concurrent fills, sequential republication, and manually inserted alternate-version rows, but not a stale writer arriving after republication while another version already owns the current revision. Added a Postgres case through the real `writePhraseRun` seam proving that the stale row deletes itself, the current row survives, and both extractor versions can then coexist. Evidence: [shelf-terms-pg.test.ts:346](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/tests/shelf-terms-pg.test.ts:346). This changed Postgres test was not runnable in the sandbox.

- **S2-5 — P2 — reasoned, report only:** the low-level exported helpers accept caller-supplied revision objects and do not independently re-authorize them; a forged internal call could read or insert another owner’s row. The current production call graph is safe: the route obtains every object from `currentShelfRevisions`, and the report does the same before its read-only block calls. Adding another owner query to every per-article fill would tax the intended bounded path for defense against no current caller. Evidence: [readPhraseRuns](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/src/store/pg-shelf-terms.ts:124), [readRevisionBlocks](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/src/store/pg-shelf-terms.ts:170), [writePhraseRun](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/src/store/pg-shelf-terms.ts:208).

- **S2-6 — P3 — established:** the republication prose overstated `READ COMMITTED`. A publication committed after the cleanup statement’s snapshot can leave an old cache row until the new revision’s first fill. It cannot be selected because all reads start from current revisions, and the next fill removes it. Corrected the store comment and landed note. Evidence: [pg-shelf-terms.ts:194](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/src/store/pg-shelf-terms.ts:194), [plan:366](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/docs/plans/260928a-shelf-facet-terms.md:366).

- **S2-7 — P3 — established:** the route-order explanation was false. The dispatcher checks the HTTP method before the path, and `/api/library/:slug` only has PATCH/DELETE handlers, so it cannot capture `GET /api/library/terms` regardless of ordering. Corrected code and plan prose. Authentication and `private, no-store` are otherwise correct. Evidence: [routes.ts:7059](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/src/routes.ts:7059), [plan:235](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/docs/plans/260928a-shelf-facet-terms.md:235).

The report script has no database write path: it executes the target-identification SELECT, the owner-scoped set query, and block SELECTs only. `pending` remains conservative for the response being returned: two tabs can cause a temporary overcount and one extra poll, but not an early stop. I also reviewed the migration after its follow-up restamp from `20260928023038` to `20260928023409`; the DDL is unchanged.

### Test command endings

Red-first regression:

```text
Test Files  1 failed (1)
Tests  2 failed | 1 passed (3)
```

Final scoped run:

```text
Test Files  3 passed (3)
Tests  56 passed (56)
Duration  6.60s
```

Typecheck:

```text
✓ src/web/tsconfig.json
✓ tests/tsconfig.json
✓ tools/fleet/web/tsconfig.json
✓ tsconfig.json
✓ all 2241 source files are covered by some project
```

Biome:

```text
Checked 6 files. No fixes applied.
Found 4 pre-existing complexity infos in src/routes.ts.
```

Full suite:

```text
No test files found, exiting with code 1
Error: No database, and every test that touches the store needs one.
could not ask Docker which container serves port 54362: connect EPERM
```

The broader unit-only lane was interrupted without a verdict after several minutes in unrelated warning-heavy UI tests. The supplied Postgres transcript remains evidence for the original 10 cases, but not the modified skipped-work assertions or the two added Postgres cases.

**Verdict: Stage 2 is ready with the uncommitted fixes, contingent on the modified 12-case Postgres suite passing.**