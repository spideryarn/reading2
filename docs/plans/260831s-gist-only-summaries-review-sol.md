NO-SHIP as written. The product decision is coherent, but the plan misses compile failures, a deploy-gate failure, public/shelf behavior, and—most importantly—contradicts the database’s revision carry-forward design.

I reviewed committed `HEAD`; relevant files were changing concurrently during the review.

## Blocking findings

1. The retained database column is not dormant

[`src/db/schema.ts:556`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/db/schema.ts:556) types the retained column as `Summaries`. Deleting that type without changing the declaration will not compile. The column should remain declared, using an explicit legacy/opaque JSON type.

More importantly, [`src/store/pg-revisions.ts:246`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-revisions.ts:246) classifies `summary` as `"carry"`. [`carriedColumns()` at line 285`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-revisions.ts:285) derives copied columns from the schema, and [`beginDraftIn` at line 595`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-revisions.ts:595) copies them with `INSERT … SELECT`.

Therefore every new revision currently reads and writes the legacy column. The plan’s “Nothing will read or write it after this” is false.

The safe policy is:

- Keep `article_revisions.summary` declared as legacy opaque JSON.
- Keep `REVISION_CARRY_POLICY.summary = "carry"`.
- Retain a regression test proving new revisions preserve the legacy bytes.
- Stop serving, inspecting, regenerating, or interpreting those bytes.

Removing it from the carry policy would either make `carriedColumns()` throw or require classifying it as non-carried. The latter strands the data on old revisions, which is semantic data loss even without dropping the column.

Historical summary step rows are also copied at [`src/store/pg-revisions.ts:650`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-revisions.ts:650). The database CHECK still permits `"summary"` at [`src/db/schema.ts:1327`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/db/schema.ts:1327), while [`tests/db-step-constraint.test.ts:82`](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/db-step-constraint.test.ts:82) insists the constraint exactly equals `STEP_ORDER`. Removing summary from `STEP_ORDER` will fail that test. Narrowing the CHECK would also fail against existing rows.

Introduce an explicit legacy-step allowance in the persistence layer/test rather than pretending historical rows are live `StepName`s.

I found no `select *` over `article_revisions`; ordinary reads use explicit projections. Once the summary entries are removed from those projections, normal reader paths will not pull the legacy JSON.

2. The plan misses definite compile/test/deploy failures

These are not named in the plan:

- [`src/ai-call.ts:200`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/ai-call.ts:200) excludes `"summarise"` from `AiJob`. Once that task disappears, the exclusion becomes invalid.
- [`tests/stop-details.test.ts:204`](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/stop-details.test.ts:204) dynamically imports `src/summarise.ts`; its summary-specific repair-leak test begins at line 332.
- [`tests/parse-json.test.ts:171`](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/parse-json.test.ts:171) imports `parseJson` from the deleted module.
- [`scripts/deploy-checks.ts:611`](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/deploy-checks.ts:611) requires `data/writes/summary.json`. Leaving this makes the deploy gate fail.
- [`tests/deploy-checks.test.ts:837`](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/deploy-checks.test.ts:837) asserts that requirement.
- `tests/paid-cli-ledger.test.ts` and `tests/public-imports.test.ts` also name `src/summarise.ts`.

Thus the plan’s statement that six incidental tests reach for `summarise.ts` is incomplete.

3. Summary presence is reader-visible outside the Summary panel

The shelf displays it:

- [`src/web/ShelfEntry.tsx:222`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/ShelfEntry.tsx:222) prints “summaries” in the Built row.
- [`src/types.ts:1416`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/types.ts:1416) exposes `LibraryEntry.has.summary`.
- The filesystem shelf probes `summary.json` at [`src/api.ts:1170`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/api.ts:1170).
- Postgres computes `hasSummary` at [`src/store/pg.ts:585`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg.ts:585) and returns it at line 1679.

Public sharing also exposes and gates on it:

- [`src/public-types.ts:230`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/public-types.ts:230)
- [`src/public/dto.ts:340`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/public/dto.ts:340)
- [`src/store/public-reader.ts:256`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/public-reader.ts:256)
- [`src/web/public-artefacts.ts:57`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/public-artefacts.ts:57)
- [`src/web/visitor.ts:119`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/visitor.ts:119)
- [`src/web/PublicPages.tsx:143`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/PublicPages.tsx:143)

In the new design Summary mode is free and always derives from the tree. It must no longer be treated as a generated public artefact or show a “nobody has built a summary” visitor gap.

4. The offline-store file named by the plan is not the functional location

`src/web/lib/offline-store.ts` mostly contains explanatory text. The actual cache allowlist is [`src/web/lib/api.ts:511`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/lib/api.ts:511), including `/api/summary/` at line 514.

Removing that entry is sufficient. Existing URL-keyed cached responses become unreachable and can expire through normal eviction; no IndexedDB migration appears necessary.

5. Removing the `buildSummaryTree` argument has many unlisted callers

For example, [`src/web/preview-diagram-wait.tsx:56`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/preview-diagram-wait.tsx:56) passes the obsolete `null` argument.

The same applies across:

- `tests/diagram-force-links.test.ts`
- `tests/diagram-graph.test.ts`
- `tests/diagram-panel-hover.test.tsx`
- `tests/diagram.test.ts`
- `tests/outline-panel.test.tsx`
- `tests/outline.test.ts`
- `tests/supplement.test.ts`

All calls must be updated if [`src/web/tree.ts:499`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/tree.ts:499) loses its summaries parameter.

## The six proposed test substitutions

| Test | Verdict |
|---|---|
| `block-policy-prompts` | Do not re-point. The cases at [`tests/block-policy-prompts.test.ts:285`](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/block-policy-prompts.test.ts:285) specifically test summary range slicing and supplement omission. Glossary/ideas coverage already exists. Delete the summary cases with the stage. |
| `job-failure` | Do not re-point. [`tests/job-failure.test.ts:218`](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/job-failure.test.ts:218) tests this stage’s “nothing to summarise” failure. A preceding remaining-stage case already covers classification as a bug. |
| `profile-prompts` | Re-pointing to `ideas` is sound for profile-present/profile-absent coverage. Remove summary-specific wording/assertions rather than transplanting them. See [`tests/profile-prompts.test.ts:108`](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/profile-prompts.test.ts:108). |
| `store-carry-forward` | Do not wholesale re-point. [`tests/store-carry-forward.test.ts:552`](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/store-carry-forward.test.ts:552) protects the retained column’s carry policy. Remove product staleness/read assertions, but retain an opaque legacy-value carry test and, if intended, historical step-run preservation. |
| `pipeline-artifact-store` | Remove summary rows instead of duplicating glossary/ideas cases. Its summary cases, including [`tests/pipeline-artifact-store.test.ts:390`](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/pipeline-artifact-store.test.ts:390), test the artifact kind and stage being deleted. |
| `supplement` | Split it. Delete the stored-summary join and `targetsOf` suite beginning at [`tests/supplement.test.ts:391`](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/supplement.test.ts:391). Keep the gist-only apparatus/numbering test at line 680 and update its `buildSummaryTree` call. |

Only `profile-prompts` is a clean re-point.

## STEP_ORDER and operational effects

Removing summary from `STEP_ORDER` has no downstream pipeline dependency: nothing consumes its output.

It does require removing its entries from:

- `FORCE_ONLY_WHEN_NAMED` at [`src/pipeline.ts:298`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:298)
- `LEGACY_UNCONVERTED_STEPS` at [`src/pipeline.ts:445`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:445)
- `STEP_BUDGET_MS` at [`src/jobs.ts:287`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:287)
- metadata storage mappings at [`src/store/pg.ts:955`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg.ts:955)

`STEP_BUDGET_MS` is lease budgeting, not a reader-facing cost estimate. I found no separate progress percentage or aggregate cost calculation based on the number of `STEP_ORDER` entries. Job progress uses the job’s actual step list, so it should simply have one fewer step.

The metadata/admin view currently reads summary for staleness at [`src/store/pg.ts:1834`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg.ts:1834), and the publication warning treats it as personalized at line 1559. Those reads should disappear because the artefact is no longer served—not because the legacy column disappears.

## Import/export and retained data

Current round trips deliberately include the artifact:

- Import reads `summary.json` at [`src/store/import.ts:670`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/import.ts:670), inserts it at line 1116, and creates its step row at line 1423.
- Export writes it at [`src/store/export.ts:452`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/export.ts:452).
- [`tests/store-roundtrip.test.ts:67`](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/store-roundtrip.test.ts:67) and [`tests/store-artefact-manifest.test.ts:95`](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/store-artefact-manifest.test.ts:95) enforce that contract.

Full removal can intentionally end import/export support, but the plan should say explicitly that legacy summaries will remain preserved inside Postgres while no longer being portable through `db:export`/`db:import`.

## Do not delete this similarly named field

[`TreeNode.summary` at src/types.ts:110`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/types.ts:110) is distinct from stage 5e’s `SummaryEntry.short/long`.

It remains load-bearing as a legacy fallback:

- [`src/library-scalars.ts:121`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/library-scalars.ts:121) uses `root.gist ?? root.summary ?? excerpt`.
- [`src/web/Metadata.tsx:623`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Metadata.tsx:623) displays it.
- [`src/public/dto.ts:225`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/public/dto.ts:225) publishes it.

Keep it in this change unless Greg separately chooses to remove legacy tree summaries.

Finally, [`src/web/LandingPage.tsx:275`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/LandingPage.tsx:275) still promises “Summaries at the length you pick.” That copy becomes false and is not named in the plan.