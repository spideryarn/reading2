Review this small change to scripts/db-migrate.ts (diff below), in the repo at /var/tmp/spideryarn-worktrees/migrate-lock-timeout. It makes the migration connection SET lock_timeout=15s and statement_timeout=10min on every pooled connection, because Supabase's session-mode pooler (port 5432) silently drops the startup 'options' parameter (measured: options '-c lock_timeout=15s' then SHOW lock_timeout → 0; with this SET through the same pooler, SHOW gives 15s / 10min).

Context: the next deploy applies 11 pending migrations in one drizzle transaction, including CREATE INDEX on a 144 MB table (SHARE lock) and ACCESS EXCLUSIVE on several small tables; the plan docs/plans/261007c-seventh-sweep-schema-declare-and-enforce-what-the-data-already-satisfies.md § Before applying to production asks for finite lock and statement timeouts on the migration connection.

Questions: (1) is pool.on('connect') + an unawaited client.query guaranteed to run before migrate()'s queries and the advisory-lock queries on that client (pg's per-client query queue)? (2) Could an error in that SET be swallowed and leave the timeouts unset silently (an unhandled rejection?) — should it be handled differently? (3) Is 10 min too short for CREATE INDEX on ~106k rows / 144 MB, or 15 s too short given the plan? (4) Anything else that makes this unsafe for tomorrow's production run. You may fix what you find in place (write-capable) and say what you changed; keep it minimal. End with a one-line verdict: SAFE or NOT SAFE.

diff --git a/scripts/db-migrate.ts b/scripts/db-migrate.ts
index 82070da5f..526efe0d9 100644
--- a/scripts/db-migrate.ts
+++ b/scripts/db-migrate.ts
@@ -142,6 +142,25 @@ const ssl = sslDecisionFor(url);
  */
 const pool = new Pool({ connectionString: url, max: 2, ssl: ssl.ssl });
 
+/**
+ * A migration waits at most 15 s for a lock, and no statement runs past ten minutes.
+ *
+ * Every pending file runs in one transaction, so a lock taken early (an index build's SHARE on
+ * `revision_blocks`, say) is held while a later statement queues behind somebody's long
+ * transaction, blocking the app's writes for as long as that wait lasts. Production's own
+ * default `lock_timeout` is 0, which waits for ever. Hitting either limit rolls the whole run
+ * back, which is the safe failure: nothing applied, run it again.
+ *
+ * A `SET`, not the `options` startup parameter or `PGOPTIONS`: Supabase's pooler drops startup
+ * options without saying so (measured 2026-10-07: `options: "-c lock_timeout=15s"`, then
+ * `SHOW lock_timeout` → `0`). Port 5432 is its session mode, so a `SET` lasts the connection.
+ * docs/plans/261007c-seventh-sweep-schema-declare-and-enforce-what-the-data-already-satisfies.md
+ * § Before applying to production, item 1.
+ */
+pool.on("connect", (client) => {
+  void client.query("set lock_timeout = '15s'; set statement_timeout = '10min'");
+});
+
 /** The ledger, or an empty one when the bookkeeping table does not exist yet. */
 async function readLedger(client: PoolClient): Promise<LedgerRow[]> {
   const there = await client.query<{ oid: string | null }>(
