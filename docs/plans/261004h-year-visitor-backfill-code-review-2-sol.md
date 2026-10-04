Fixed five stage-local findings. No commit or production run.

| ID | Priority | Finding and fix | Test |
|---|---|---|---|
| F9 | P1 | Target omitted the username identifying a shared-pooler project. Added it; refused ambient connection defaults. | Target identity and old-plan rejection cases |
| F10 | P1 | Editable plan order could deadlock with app sweeps. Lock actual database slugs in `C` order first. | Offline ordering test; new PG overlap test |
| F11 | P1 | An unhandled idle database error could terminate planning. Added an error listener. | CLI preserves the plan despite idle error and failed rollback |
| F12 | P2 | PDF regrouping could manufacture identifiers. Added region boundaries and sideways adjacency checks. | Fragment counterexamples and real PDF fixture |
| F13 | P1 | Warnings and connection attempts preceded `Target:`. Print it first and read the local target directly from the file. | CLI output and connection ordering |

Regenerate old plans: their targets lack the username.

Apply preserves non-null values, keeps the revision current through commit, and exits nonzero when both written and already counts are zero. It **prevents introducing** a day/year pair; it doesn’t repair an existing invalid pair. Whole-row refusal on a conflicting column is intentional.

The shipped dry run makes no durable database writes. Its long transaction pins a pooler backend; a dead session now preserves the in-memory plan. Swallowing rollback failure is safe in that situation.

Hand-edited plans can substitute allowed values and IDs. Validation prevents other columns and SQL injection, but doesn’t prove registry agreement. Address candidates retain the unchanged title-and-author heuristic. Publication dates also affect Metadata, Shelf display/sort and Debate’s marker; they trigger no automatic paid regeneration.

**Verification:** 91 tests passed across six files, including both requested suites. Typechecking passed through `node --import tsx`; scoped lint had informational findings only. Broader checks encountered sandbox `EPERM` failures. PG tests remain unrun here.

Please rerun:

```bash
REQUIRE_POSTGRES=1 npx vitest run tests/backfill-registry-facts-pg.test.ts
npm test
npm run typecheck
```

Details are in the [review document](/home/greg/code/spideryarn2/.claude/worktrees/paper-year-visitor-backfill/docs/plans/261004h-year-visitor-backfill-code-review-2-sol.md).

Verdict: fixes are in place; production use awaits the author’s Postgres verification.