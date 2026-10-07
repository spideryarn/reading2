Fixed [scripts/db-migrate.ts:158](/var/tmp/spideryarn-worktrees/migrate-lock-timeout/scripts/db-migrate.ts:158) to use **awaited `onConnect` setup**.

1. **Ordering:** Yes, the original synchronous listener queues `SET` before either client’s subsequent queries. The queue guarantees ordering, but not successful initialization.

2. **Errors:** The original discarded promise creates an unhandled rejection. Default Node behavior terminates the process, but queued queries can proceed first; a rejection handler could also let execution continue with unset timeouts. The replacement waits for setup, destroys the client on failure, and rejects acquisition—the behavior documented by [node-postgres](https://node-postgres.com/apis/pool).

3. **Limits:** Keep **15 seconds / 10 minutes**. Based on the plan’s few-second local migration run on 233k rows, ten minutes looks ample for this index, though production contention remains unmeasured. Fifteen seconds deliberately favors rollback and retry over a prolonged lock wait. These limits apply **per lock acquisition and per statement**, not to the whole transaction or total write outage. [PostgreSQL timeout semantics](https://www.postgresql.org/docs/current/runtime-config-client.html).

4. **Before production:** The [preflight SQL](/var/tmp/spideryarn-worktrees/migrate-lock-timeout/docs/plans/261007c-seventh-sweep-schema-production-preflight.sql:197) still lists nine pending migrations, omitting `feedback_number` and `feedback_question_answers`. Update it for all eleven and rerun the long-transaction check immediately before applying. The corrected runner satisfies the plan’s timeout requirement.

Validation: injected setup failure reproduced the defect and passed after fixing; both-client initialization probe passed; 75 migration tests, typechecking and lint passed. Full `npm test` was blocked by missing local database configuration. Recorded the required short postmortem; no production queries ran.

SAFE