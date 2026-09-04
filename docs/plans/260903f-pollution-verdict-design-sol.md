Your re-derivation is substantially right. Do not close T‑E entirely as absorbed: keep a much smaller stage for private teardown integrity and shared-failure diagnostics. Delete the original `check.ts` requirements.

1. **Build (i), but name it narrowly. — Blocking**

Call it “unexpected live connections at private teardown,” not general database pollution. It is worthwhile because:

- `DROP … WITH (FORCE)` currently erases exactly this evidence.
- Vitest 4.1.11 runs global teardown before closing its worker pool, so an unclosed worker pool remains observable. [Vitest close ordering](</home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/node_modules/vitest/dist/chunks/cli-api.CnMVyzaz.js:14004>)
- Your zero measurements establish a clean baseline. The deliberate held connection supplies the required red-first evidence.

Query before ending the lease, always clean up afterward, and prove that the overall `vitest` process exits non-zero. A thrown global-teardown error is insufficient by inspection: Vitest catches teardown failures during `close()` and only logs them. Set a failing process verdict explicitly or provide another tested propagation mechanism.

2. **There are two unnamed escape paths. — Blocking documentation corrections**

The minted name is discoverable. It is printed by global setup, appears in `pg_database`/`pg_stat_activity`, is placed in worker environments, and is inherited by children. Every worktree has the same local superuser credential. The UUID prevents accidental guessing; it is not access control. The “no channel by which another process learns it” claim should go, including the equivalent claim in `dropTestDatabase`.

Also, the private lane does write to shared `postgres`: its six Storage tests call the shared Storage API, which writes `storage.objects` there. More generally, because `SUPABASE_URL` remains live, a misclassified private test could reach GoTrue or PostgREST too. No current such private path is documented, but nothing structurally forbids one.

The unit lane’s ordinary DB/Storage paths and inherited children are fenced correctly. It is not a capability sandbox: a hard-coded URL or an API deliberately recovering the original environment could bypass it.

3. **Replace (ii); a setup-time count is not useful. — Blocking**

Sample when a shared-lane test fails, using a `beforeEach` registration of `onTestFailed`, and print session identities—not merely a count. Optionally retain a file-start snapshot and print it only on failure.

`usename = postgres` is not the right durable discriminator. It is incidental configuration and already needs a `pg_net` exception. The better design is:

- Give this run’s shared-lane clients a unique `PGAPPNAME`.
- Give dev-server pools a `spideryarn…` application name containing an instance/worktree identifier; the main pool currently sets none. [client.ts](</home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/src/db/client.ts:109>)
- Report other `spideryarn…` sessions separately from blank-name `postgres` sessions, which should be labelled “unattributed probable application sessions,” not treated as exact.
- Print PID, application name, user, state, backend/query start and wait event. Avoid printing SQL text; it may contain article prose or secrets.

This remains diagnostic evidence, never a pollution verdict: a writer can commit and disconnect before the failure, while an unrelated idle connection can remain present.

4. **Bullet 1 is literally unbuildable in `check.ts`. — Blocking**

Before the test gate, the private database does not exist. After it, Vitest has dropped the database and has not returned its URL to `check.ts`. Moving the check into private global teardown is the only useful reading, but it changes the claim from “the database was never polluted” to “no unexpected connection remained at teardown.” That narrower claim is honest and buildable.

Bullet 2 is absorbed by the three lane controls and should be recorded as completed by T‑D.

5. **Use a non-forced drop as the atomic backstop. — Advisory, but strong**

After sampling and closing the lease, first attempt ordinary `DROP DATABASE`. If another connection appeared after the sample, PostgreSQL itself refuses atomically. Record/enumerate that as `POLLUTED`, then use `FORCE` only for cleanup. This closes the check-to-drop race and reuses the safety distinction already present in the factory.

I would therefore make T‑E:

- private teardown: enumerate, non-forced-drop backstop, explicit `POLLUTED` failing verdict, then cleanup;
- shared lane: attributed session snapshot only on failure;
- docs: mark the original location/refusal requirements absorbed or superseded.

Separately, serialising the four shared files would cheaply remove self-contention, though it cannot protect them from dev servers or other runs.

I ran the permitted focused unit-lane file. Three controls passed; the Storage and child-process cases were blocked by this execution sandbox (`EPERM` instead of the expected `ECONNREFUSED`, and denied `tsx` IPC), so that run adds no contrary product evidence. No files were changed.