Fixed three server issues. Two remain. Evidence below refers to candidate `2a56e2ea8`.

| ID | Severity | Finding | Status |
|---|---|---|---|
| C1 | P0 | Ownership could change between authorisation and brief access, disclosing private sentences across a transfer. `src/store/pg-skim-briefs.ts:103,136` | **Fixed:** owner-filtered locks for mutations; owner joins for reads. Wider existing transfer races remain outside this stage. |
| C2 | P1 | Brief persistence preceded publication and job completion. A failure could expose a route whose inputs never published; a forced requeue could buy it again. `src/jobs.ts:1738` | **Fixed:** brief output, prerequisite publication and job completion now share `StoreSession.commit`’s transaction. |
| C3 | P2 | Force bypassed the existence check, buying routes for briefs deleted while queued. `src/jobs.ts:1562` | **Fixed:** existence checked before honouring force. |
| C4 | P1 | Removing `skimBrief` makes default Skim/Metadata treat brief jobs as their own, including Retry. `src/routes.ts:8309`; `src/web/useStepJob.ts:510` | **Unfixed, stage 3:** expose safe target metadata and scope client matching. No early hold release or auto-run target switch demonstrated. |
| C5 | P2 | Deleting and recreating the same brief id lets an old job populate the replacement row. `src/store/pg-skim-briefs.ts:247` | **Unfixed:** needs a durable row-incarnation token carried with the job. |

The freshness extraction preserves default behaviour. Unplanned-brief `200 null` is deliberate; missing briefs still return 404. No additional findings in migration/cascade, export/transfer wiring, visitor projection or logging.

Validation: **1,414 unit tests passed**, 18 skipped, across 13 files. Full typecheck passed using `node --import tsx scripts/typecheck.ts`; scoped lint and cycle checks passed.

Postgres regressions were written before fixes, but database access failed before collection: **their assertion-red and assertion-green runs remain unverified for all three fixes**. Please run:

```bash
npm test -- --project private-postgres tests/skim-briefs-pg.test.ts tests/article-transfer.test.ts tests/jobs-walk.test.ts tests/store-pg-session.test.ts
```

Changes, plan-log corrections and two postmortems are left uncommitted in the worktree.