## Verdict

No—not quite ready as described.

The load-bearing product precondition is real, and `pgStoreSession` correctly covers both successful completion doors. D2/checkpoint migration is not a correctness prerequisite.

One blocker remains: an all-skipped publication that fails with anything other than `PublishRefused` can leave the job `running` until its lease expires. `publishingSession` currently handles that broader case; the proposed replacement does not. Fix and test that before deleting the decorator.

A purely mechanical one-line flip plus file deletion will also break tests and documentation that import or link to `publish-session.ts`.

## 1. The `parts` precondition is real

The current pipeline actually has 13 steps, not eleven; some comments still have the old count. [`STEP_ORDER`](</home/greg/code/spideryarn2/src/pipeline.ts:150>) contains:

| Step | Declared and returned parts | Postgres destination |
|---|---|---|
| `fetch` | `raw` | assembled raw-source fields |
| `extract` | `extractedHtml`, `meta` | revision column + assembled metadata |
| `blocks` | `blocks`, `stampedHtml` | block rows + revision column |
| `hierarchy` | `tree`, `labels`, `blocks` | two revision columns + block rows |
| `assets` | `assets` | revision column |
| `arc` | `arc` | revision column |
| `tweets` | `tweets` | revision column |
| `glossary` | `glossary` | revision column |
| `quotes` | `quotes` | revision column |
| `ideas` | `ideas` | revision column |
| `timeline` | `timeline` | revision column |
| `quiz` | `quiz` | revision column |
| `sketch` | `sketch` | revision column |

The declarations and returns are visible together from [`fetch`](</home/greg/code/spideryarn2/src/pipeline.ts:1358>) through [`sketch`](</home/greg/code/spideryarn2/src/pipeline.ts:2646>). I found no missing, extra, or differently named part:

- Both `fetch` branches return `raw`; both acquisition paths supply the additional `storedSha256` and `storedBytes` that the Postgres writer requires at [`artifacts-pg.ts:1054`](</home/greg/code/spideryarn2/src/store/artifacts-pg.ts:1054>).
- Both HTML and PDF extraction return `extractedHtml` and `meta`.
- `hierarchy` is especially sound: `HierarchyArtefacts` requires all three members at compile time in [`hierarchy.ts:1187`](</home/greg/code/spideryarn2/src/hierarchy.ts:1187>), and its returned object is built at [`hierarchy.ts:1633`](</home/greg/code/spideryarn2/src/hierarchy.ts:1633>).
- The Postgres mapping covers every `(step, kind)` pair at [`artifacts-pg.ts:194`](</home/greg/code/spideryarn2/src/store/artifacts-pg.ts:194>).

[`checkProduct`](</home/greg/code/spideryarn2/src/store/session.ts:357>) checks declared-key completeness, own properties, `undefined`, and extras. It is not itself a deep shape check, but the transaction then writes the parts and calls `assertProduced` against the same transaction at [`pg-session.ts:630`](</home/greg/code/spideryarn2/src/store/pg-session.ts:630>). Those reads apply the shared shape rules in [`artifacts.ts:239`](</home/greg/code/spideryarn2/src/store/artifacts.ts:239>). A rejected shape rolls the transaction back.

`LEGACY_UNCONVERTED_STEPS` being empty at [`pipeline.ts:483`](</home/greg/code/spideryarn2/src/pipeline.ts:483>) therefore reflects reality. I found no incorrectly converted step.

## 2. Both completion doors are covered, but one failure path is not

`pgStoreSession` routes both doors through the same `settleIn` state machine:

- Last step ran: `commit` writes the product and calls `settleIn` at [`pg-session.ts:616`](</home/greg/code/spideryarn2/src/store/pg-session.ts:616>).
- Every step skipped: `settleJob` calls `settleIn` at [`pg-session.ts:592`](</home/greg/code/spideryarn2/src/store/pg-session.ts:592>).
- A `done` settlement publishes the draft and finishes the job in that transaction at [`pg-session.ts:471`](</home/greg/code/spideryarn2/src/store/pg-session.ts:471>).

The all-skipped behavior has a meaningful test—not merely a byte-identical no-op. [`store-pg-session.test.ts:1632`](</home/greg/code/spideryarn2/tests/store-pg-session.test.ts:1632>) writes work into a draft in request one, releases it, skips every step in request two, and proves request one’s work is what gets published.

What the decorator does differently:

- `copyArtefacts` and its zero-copy refusal have no direct counterpart. They are obsolete after the flip: products are written directly, and `checkProduct` prevents a ran step from committing nothing.
- The decorator opens its draft lazily. `pgStoreSession` opens it eagerly and explicitly fails or publishes it. That is intentional, not a lost feature.
- Both have article identity checks, exact-base protection, stale-attempt translation, transaction-before-log ordering, and atomic publication/job finish.
- The decorator catches **every non-stale publication failure** on the all-skipped door, attempts to terminalize the job with a sanitized error, fails the draft, and then rethrows at [`publish-session.ts:377`](</home/greg/code/spideryarn2/src/store/publish-session.ts:377>).

The proposed `walkClaim` fix catches only `PublishRefused` at [`jobs.ts:1496`](</home/greg/code/spideryarn2/src/jobs.ts:1496>). A database or other `StoreFailure` from `pgStoreSession.settleJob(done)` therefore escapes the outer catch, which only handles `StaleAttemptError` at [`jobs.ts:1514`](</home/greg/code/spideryarn2/src/jobs.ts:1514>). The transaction rolls back, leaving the job `running` and still pointing at its draft until expiry.

That is the blocker. Before flipping, catch every non-stale all-skipped publication failure, expose only safe wording for non-`PublishRefused` errors, and attempt an `error` settlement. Add a regression test using a non-`PublishRefused` `StoreFailure`.

The assumed changes otherwise interact correctly:

- An exact-base refusal becomes a terminal `error`, and the restricted [`retryJob`](</home/greg/code/spideryarn2/src/jobs.ts:2097>) permits it.
- A generic all-skipped failure remains `running`, so the new restriction correctly—but unhelpfully—refuses Retry until lease expiry.
- [`forceForRetry`](</home/greg/code/spideryarn2/src/jobs.ts:2158>) currently preserves the whole originally forced set, including force-only late stages.

## 3. Laptop behavior and paths outside the session

With `STORE` unset, the filesystem session remains unchanged. The converted stages return products, and `fsStoreSession` writes those products to their old paths.

`StepContext.dir` and `htmlFile` are still constructed for every step at [`jobs.ts:483`](</home/greg/code/spideryarn2/src/jobs.ts:483>) through [`contextPaths`](</home/greg/code/spideryarn2/src/pipeline.ts:1118>). The live pipeline has only two remaining path-based working stores:

- PDF chunk checkpoints: `extract` passes `ctx.dir` at [`pipeline.ts:1481`](</home/greg/code/spideryarn2/src/pipeline.ts:1481>). `pdf-read.ts` creates `pdf-chunks`, reads keyed JSON files, and writes successful chunks at [`pdf-read.ts:1062`](</home/greg/code/spideryarn2/src/pdf-read.ts:1062>) and [`pdf-read.ts:1212`](</home/greg/code/spideryarn2/src/pdf-read.ts:1212>).
- Hierarchy label checkpoints: `hierarchy` passes `ctx.dir` at [`pipeline.ts:1741`](</home/greg/code/spideryarn2/src/pipeline.ts:1741>). `labels.ts` reads and writes `labels-progress.json` at [`labels.ts:2125`](</home/greg/code/spideryarn2/src/labels.ts:2125>).

The generic checkpoint seam exists, but explicitly has no callers at [`checkpoints.ts:11`](</home/greg/code/spideryarn2/src/store/checkpoints.ts:11>).

The remaining `outputs(ctx)` path declarations are not used by the job runner; production source reads, skip checks, stage inputs, and postconditions use the session store. `articleExists` and `urlForSlug` also branch to Postgres before touching files at [`pipeline.ts:1035`](</home/greg/code/spideryarn2/src/pipeline.ts:1035>).

Therefore the flip is safe without D2 for data correctness. Without D2, interrupted PDF transcription and label generation can be paid for again. A laptop running Postgres can mask this because its repository-root scratch survives across jobs.

## 4. What still goes to `/tmp` on deployment

[`dataRoot`](</home/greg/code/spideryarn2/src/store/data-root.ts:160>) resolves deployed work to:

`/tmp/spideryarn/<owner>/<job>/`

After the flip, the concrete pipeline reads/writes still under it are only:

- `/tmp/.../data/<slug>/pdf-chunks/<key>.json`
- `/tmp/.../data/<slug>/labels-progress.json`

`ctx.dir`, `ctx.htmlFile`, and every step’s legacy `outputs()` paths are still calculated, but no committed article product uses them.

Consequences:

- A later claim on a cold instance cannot resume either checkpoint.
- A retry is a new job id, so it cannot see them even on the same warm instance.
- Completed step products survive handback because they are in the draft, not `/tmp`.
- Raw document bytes go through the selected blob store. Postgres mode refuses to boot without a matching Supabase bucket configuration at [`store/index.ts:124`](</home/greg/code/spideryarn2/src/store/index.ts:124>).

So D2 is a cost and latency issue at the flip, not a publication-correctness issue.

One non-code readiness condition remains unverified because I did not inspect `data/` or production data: the plan requires eliminating imported revisions with `stamped_html` but no `extracted_html` before the flip at [`finish-the-database-move.md:726`](</home/greg/code/spideryarn2/docs/plans/260831b-finish-the-database-move.md:726>). Such a revision cannot support a later `blocks`-only job. That database readiness probe still needs an actual result.

## 5. Migration ordering is safe

The migration is additive and nullable: [`0047_based_on_revision_id.sql`](</home/greg/code/spideryarn2/drizzle/0047_based_on_revision_id.sql:1>) adds the column and its self-reference.

Migration-before-code is the safe order:

- Old deployed code does not select or name the column, so it continues working after the migration.
- If the push fails, the old deployment remains compatible.
- New code cannot run before the column exists because deployment follows successful migration at [`deploy.ts:1351`](</home/greg/code/spideryarn2/scripts/deploy.ts:1351>).

A draft minted by old code during the migration/push window gets `NULL`. New code reopens that draft and fails closed if the article already has a current revision, as documented at [`pg-session.ts:183`](</home/greg/code/spideryarn2/src/store/pg-session.ts:183>). That can cost one retry; it does not bury another revision.

One factual correction to the prompt: `REVISION_CARRY_POLICY` now lives in [`pg-revisions.ts:128`](</home/greg/code/spideryarn2/src/store/pg-revisions.ts:128>) and is an exhaustive typed policy map, not a fail-open denylist. `basedOnRevisionId` is `"mint"`, so a draft records its immediate source instead of inheriting its parent’s lineage.

## 6. What would prove the flip

Existing tests prove most pieces separately:

- A real `blocks` step through a direct Postgres session: [`pg-session-real-step.test.ts:354`](</home/greg/code/spideryarn2/tests/pg-session-real-step.test.ts:354>). It deliberately injects `openPgStoreSession`, so it does **not** prove `claimSession`’s production selection.
- Real all-skipped publication with earlier released work: [`store-pg-session.test.ts:1632`](</home/greg/code/spideryarn2/tests/store-pg-session.test.ts:1632>).
- A late stage with published storage visible and scratch empty: [`late-step-on-a-cold-instance.test.ts:110`](</home/greg/code/spideryarn2/tests/late-step-on-a-cold-instance.test.ts:110>).
- Exact-base all-skipped refusal and terminalization: [`all-skipped-publication-refusal.test.ts:467`](</home/greg/code/spideryarn2/tests/all-skipped-publication-refusal.test.ts:467>).
- Retry force selection is currently only a pure-function test; its header admits it does not prove the real Postgres consequence at [`retry-after-a-failed-refresh.test.ts:46`](</home/greg/code/spideryarn2/tests/retry-after-a-failed-refresh.test.ts:46>).

A cheaper deterministic proof of the core flip is possible locally:

1. Run through the actual `claimSession`, with `STORE=postgres`.
2. Use real Postgres and a real deterministic stage such as `blocks`.
3. Give successive claims/jobs different empty scratch roots—or use separate child processes—so filesystem persistence cannot help.
4. Exercise ingest/commit, an all-skipped second claim, a late single-step job, and a failed forced job followed through `retryJob`.
5. Assert the published revision, step-run rows, job terminal state, and cleared draft pointer.
6. Add the missing non-`PublishRefused` all-skipped failure case.

That proves the storage and lifecycle property more strongly than an ordinary laptop ingest. It does not prove Vercel bundling, production environment variables, Supabase Storage credentials, route/auth wiring, migration state, or real external calls. The deployed real-ingest/single-step/retry run is therefore still warranted as a release canary, but deployment is not the only way to prove that the session flip itself works.

Finally, deleting `publish-session.ts` without accompanying cleanup will fail the build/tests: [`jobs-publish-finalizer.test.ts:176`](</home/greg/code/spideryarn2/tests/jobs-publish-finalizer.test.ts:176>) and [`publish-session-cleanup-log.test.ts:109`](</home/greg/code/spideryarn2/tests/publish-session-cleanup-log.test.ts:109>) import it directly, and project docs link to it. `copyArtefacts` should remain; fixture/test loaders still use it.

This was a static review of the current shared worktree. I did not open `data/`, run mutating database tests, or inspect production data.