## Verdict

Do not approve Part 3 yet. No current P0, but three P1s remain: the storage replacement removes the admin’s authentication, and the proposed database boundary can be escaped or leave pooled clients unusable after errors.

### Findings

**R2-1 — P1 — The empty `localStorage` also removes the admin’s Supabase session**

The F1 amendment replaces `window.localStorage` before `main.js` loads ([plan](/var/tmp/spideryarn-worktrees/admin-view-as/docs/plans/261019n-admin-sees-other-users-articles-and-views-as-them.md:500)). But the Supabase client is created later with `persistSession: true` and its default storage ([supabase.ts](/var/tmp/spideryarn-worktrees/admin-view-as/src/web/lib/supabase.ts:96)). Supabase captures `globalThis.localStorage` during construction. If that is empty, the view-as tab has no admin session and therefore no bearer token for `/current` or any allowlisted request.

Fix: before hiding real storage, copy only the project’s `sb-<project>-auth-token` entry into a private in-memory auth adapter, then configure Supabase explicitly to use that adapter. Everything else must begin empty. Test a signed-in admin whose session exists only in real `localStorage`: the first `/current` request must carry the admin JWT, while an unrelated sentinel key remains unreadable.

**R2-2 — P1 — `BEGIN READ ONLY` is not an unescapable write boundary**

The ordinary Drizzle path sends each prepared query directly to its client’s `query` ([session.js](/var/tmp/spideryarn-worktrees/admin-view-as/node_modules/drizzle-orm/node-postgres/session.js:100)). Wrapping that call as:

```text
BEGIN TRANSACTION READ ONLY
<original query>
COMMIT
```

does block ordinary inserts, updates, `nextval`, writable functions and CTEs. But a raw simple-protocol query can contain:

```sql
COMMIT; UPDATE spideryarn.articles SET ...;
```

or:

```sql
SET TRANSACTION READ WRITE; UPDATE ...;
```

PostgreSQL explicitly permits transaction-control commands inside a multi-statement simple query, and an explicit `COMMIT` changes which later statements belong to the transaction. [PostgreSQL protocol documentation](https://www.postgresql.org/docs/18/protocol-flow.html)

PostgreSQL read-only mode also deliberately permits writes to temporary tables; it is not equivalent to a permission boundary. [PostgreSQL `SET TRANSACTION`](https://www.postgresql.org/docs/15/sql-set-transaction.html)

I found no current allowlisted handler issuing such SQL, so this is P1 rather than P0. But the amendment’s claim that Postgres “refuses every write” is false, and this is meant to catch future missed writes.

Fix: use the SELECT-only database role from round 1. If the transaction design is retained, it additionally needs to reject all transaction-control SQL and force the protected statement through extended protocol—but that remains a text/parser defence, not equivalent to a role without write privileges.

**R2-3 — P1 — The per-query wrapper needs a mandatory rollback/release failure path**

Drizzle’s own transaction implementation checks out a client, rolls back on an error, and releases it in `finally` ([session.js](/var/tmp/spideryarn-worktrees/admin-view-as/node_modules/drizzle-orm/node-postgres/session.js:180)). The new ordinary-query wrapper must provide the same guarantees.

“BEGIN … query … COMMIT” does not specify what happens when the protected query, `COMMIT`, or `ROLLBACK` fails. Releasing a client still inside an open or failed transaction can poison its next borrower; failing to release it can exhaust this app’s five-connection pool.

Fix: specify and test `ROLLBACK` on every query/commit failure, unconditional release, and `release(error)`/client destruction when cleanup itself fails. Include five consecutive failing view-as queries followed by an ordinary successful write as the pool-reuse test.

**R2-4 — P2 — The override is portable, but it does not happen before all storage reads or module evaluation**

The property replacement itself is viable in Chromium, Firefox and Safari: `localStorage` and `sessionStorage` are ordinary readonly WebIDL attributes, not `[LegacyUnforgeable]`, so an own property can shadow their prototype getters. [HTML storage IDL](https://html.spec.whatwg.org/multipage/webstorage.html), [WebIDL’s unforgeable distinction](https://webidl.spec.whatwg.org/)

The timing claim is not true:

- The inline appearance script reads the real `localStorage` before `boot.tsx` starts ([index.html](/var/tmp/spideryarn-worktrees/admin-view-as/index.html:166)).
- `boot.tsx` statically imports monitoring, so monitoring and its dependency graph evaluate before any statement in `boot.tsx` ([boot.tsx](/var/tmp/spideryarn-worktrees/admin-view-as/src/web/boot.tsx:32)).

I found no current module-evaluation-time capture of a `Storage` object in `monitoring.ts` or its active Sentry integrations. Sentry’s linked-tracing code accesses `sessionStorage` only when called, and tracing is disabled here. Thus there is no current capture through that import, but the claimed ordering is not structurally enforced.

Fix: perform the view-as bootstrap in an inline script before `appearance-boot` and before any module script, or use a truly import-free first module that dynamically imports monitoring after isolation. This bootstrap should also implement R2-1’s selective auth-session transfer.

**R2-5 — P2 — View-as still mutates persistent IndexedDB**

Restricting routes and replacing Web Storage does not cover IndexedDB. `main.tsx` unconditionally schedules `sweepDictations()` five seconds after boot ([main.tsx](/var/tmp/spideryarn-worktrees/admin-view-as/src/web/main.tsx:212)); that routine opens the shared dictation database and deletes old tapes/chunks in read-write transactions ([dictation-keep.ts](/var/tmp/spideryarn-worktrees/admin-view-as/src/web/dictation-keep.ts:299), [dictation-keep.ts](/var/tmp/spideryarn-worktrees/admin-view-as/src/web/dictation-keep.ts:328)).

Fix: do not start the sweep while viewing as, and ensure article-page dictation controls cannot open or write that database. Test with an expired admin tape that remains byte-for-byte unchanged after a view-as visit.

**R2-6 — P2 — Stop’s network-failure state remains unspecified**

The F5 amendment says closing happens only “after 2xx or 410” ([plan](/var/tmp/spideryarn-worktrees/admin-view-as/docs/plans/261019n-admin-sees-other-users-articles-and-views-as-them.md:521)), but it drops round 1’s explicit requirement for the failure case.

Fix: on a transport failure, retain the nonce and subject-content barrier, show that Stop did not complete, and offer Retry. Test that the tab neither clears its nonce nor falls into an ordinary admin page after a failed end request.

## F1–F8 disposition

| Finding | Disposition |
|---|---|
| F1 | **Not closed:** R2-1 and R2-4. The browser override works as a mechanism, but it removes authentication and begins too late. |
| F2 | **Closed**, provided the server sets/overrides `Cache-Control` before headers are committed, including `/current` and binary responses. Keep the post-Stop network-hit browser test. |
| F3 | **Not fully closed:** route-level and external-network escapes are addressed, but R2-5 leaves persistent IndexedDB mutation. |
| F4 | **Closed.** Actor outside, `runViewingAs → runAsOwner(subject)` inside, plus refusal at `afterResponse` and the central job enqueue boundary is adequate for the audited handlers. |
| F5 | **Not fully closed:** successful Stop and expiry are fixed; R2-6 remains. |
| F6 | **Closed**, provided dispatch constructs `{ request }` at runtime for view-as handlers rather than merely giving `{ user, request }` a narrower TypeScript type. |
| F7 | **Not closed:** R2-2 and R2-3. |
| F8 | **Closed.** Removing obsolete aliases and naming Storage reads as outbound reads addresses it. |

## Drizzle and Supavisor conclusions

Drizzle 0.45.2 behaves exactly as the amendment assumes in two respects:

- Ordinary queries use the pool/client’s `query`.
- `db.transaction()` detects a pool, calls `pool.connect()`, sends `begin …`, then commits or rolls back and releases the client. Nested Drizzle transactions use savepoints rather than another `BEGIN` ([session.js](/var/tmp/spideryarn-worktrees/admin-view-as/node_modules/drizzle-orm/node-postgres/session.js:180), [session.js](/var/tmp/spideryarn-worktrees/admin-view-as/node_modules/drizzle-orm/node-postgres/session.js:203)).

Therefore:

- Rewriting the outer Drizzle `begin` to include `read only` protects its savepoints; nested transactions inherit read-only status.
- Preserve Drizzle’s existing isolation mode and refuse any explicit `accessMode: "read write"` rather than appending conflicting modes.
- An SSE response does not inherently hold a database client: per-query wrappers release after each query. A Drizzle transaction holds one only for its callback, as today. No proposed allowlisted SSE model-call handler needs such a transaction.
- Supavisor transaction mode is compatible with explicit `BEGIN … COMMIT`: the backend is retained for that transaction and returned afterward. It is session-level state and prepared statements that are unsupported. [Supabase transaction-mode documentation](https://supabase.com/docs/guides/database/connecting-to-postgres)

That makes the transaction approach operationally compatible with the pooler, but not a complete security boundary because of R2-2.

Read-only review; I changed no files.