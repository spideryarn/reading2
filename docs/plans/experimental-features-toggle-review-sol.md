## Findings

### High — rapid toggles can leave the switch opposite to the database

[useExperimental.ts:101](/home/greg/code/spideryarn2/src/web/useExperimental.ts:101) starts every PATCH immediately; the generation counter only orders their responses.

Sequence:

1. Stored state is off.
2. Click on: request A sends `true`.
3. Click off: request B sends `false`.
4. B reaches Postgres first and returns off.
5. A reaches Postgres afterwards and stores on.
6. A’s response is ignored as the older generation.

The UI remains off while the database is on.

Fix: serialize writes, or disable and guard the checkbox while saving. If rapid changes must remain possible, queue the newest desired value and send it only after the previous PATCH settles. Add a test with independently controlled PATCH promises and server execution order; the current mock at [profile-settings.test.tsx:30](/home/greg/code/spideryarn2/tests/profile-settings.test.tsx:30) cannot express this race.

### Medium — a combined PATCH is not atomic

[routes.ts:2946](/home/greg/code/spideryarn2/src/routes.ts:2946) performs two store operations.

`{profile: "A physicist", experimental: true}` can save the profile, then fail saving the switch—for example because the database lacks the new column. The response is an error although half the request committed. Concurrent requests can also interleave between the two operations, making the returned pair a mixed-time snapshot.

Fix: add one store operation that patches both fields atomically: one queued merge for filesystem and one transaction/upsert for Postgres. At minimum, reject combined requests until that exists.

### Medium — `now()` can give a false “since” time under contention

[pg-reader.ts:91](/home/greg/code/spideryarn2/src/store/pg-reader.ts:91) uses `now()` in both branches. The qualification is fine: Drizzle emits:

```sql
coalesce("spideryarn"."reader_profiles"."experimental_since", now())
```

The target table names the existing row; `excluded` would name the proposed row. PostgreSQL explicitly permits the existing row to be referenced by the target table name in `DO UPDATE`. [PostgreSQL INSERT documentation](https://www.postgresql.org/docs/current/sql-insert.html)

The final on/off value is linearizable, so no update is lost. The timestamp has a subtle race:

1. An off transaction updates the row but still holds its lock.
2. An on transaction begins and waits for that lock.
3. Off commits.
4. On sees `null` and evaluates `now()`.

PostgreSQL’s `now()` is the transaction start, so the new spell is stamped before the off transaction committed. [PostgreSQL date/time documentation](https://www.postgresql.org/docs/current/functions-datetime.html)

Fix: use `clock_timestamp()` when minting a new date, in both insert and update branches. Keep `coalesce` for reassertions.

### Medium — an offline copy is treated as authoritative

[useExperimental.ts:79](/home/greg/code/spideryarn2/src/web/useExperimental.ts:79) ignores the `x-spideryarn-offline: copy` header that [api.ts:391](/home/greg/code/spideryarn2/src/web/lib/api.ts:391) adds.

If the cached value is off, another device has since turned it on, and this device opens `/profile` offline, the hook sets `loaded=true`, enables the checkbox, and confidently displays off while Postgres says on.

Fix: detect the offline-copy header. Show it only as “last known”, keep the control disabled, and offer retry when connectivity returns.

The cache also has an invalidation race: mutation invalidation is fire-and-forget at [api.ts:419](/home/greg/code/spideryarn2/src/web/lib/api.ts:419), while a preceding GET may finish writing its stale clone at [api.ts:461](/home/greg/code/spideryarn2/src/web/lib/api.ts:461) after invalidation. A resource-generation/tombstone guard is needed to prevent an older GET repopulating invalidated data.

### Medium — missing successful fields silently mean “off”

[useExperimental.ts:83](/home/greg/code/spideryarn2/src/web/useExperimental.ts:83) and [useExperimental.ts:126](/home/greg/code/spideryarn2/src/web/useExperimental.ts:126) use `experimentalSince ?? null`.

A successful `{ profile: "…" }` or `{}` response therefore becomes a successful off state. That conceals exactly the variable-response-shape defect the route is designed to prevent.

Fix: validate that `experimentalSince` is an own property and is either `null` or a valid timestamp; otherwise throw and preserve the previous state.

### Low — failed loading is mislabeled and has no recovery

The decision not to enable an unknown value is correct. However, [useExperimental.ts:90](/home/greg/code/spideryarn2/src/web/useExperimental.ts:90) leaves it disabled permanently, and [SettingsSection.tsx:95](/home/greg/code/spideryarn2/src/web/SettingsSection.tsx:95) says “Not saved” even though loading—not saving—failed.

Fix: separate load and save errors and provide “Couldn’t load setting — Retry”.

### Low — the claimed request reuse does not exist

[useExperimental.ts:10](/home/greg/code/spideryarn2/src/web/useExperimental.ts:10) says it rides an already-made request. `apiFetch` has an offline cache, not an online memoization/deduplication cache. Each hook instance performs another network GET, and separate instances do not share updates.

It is harmless with the current single consumer, but the documented `useExperimental()` recipe will create one request and one independent state per gated control.

Fix before the first gate: expose shared reader state through a provider or small external store.

### Low — the backfill explanation is factually overstated

[sql.md:47](/home/greg/code/spideryarn2/docs/project/sql.md:47), [schema.ts:1973](/home/greg/code/spideryarn2/src/db/schema.ts:1973), and [0032_experimental_features.sql:4](/home/greg/code/spideryarn2/drizzle/0032_experimental_features.sql:4) claim a constant-default boolean would have to write every row. Modern PostgreSQL can add a constant default without rewriting the table.

The timestamp remains the better design because it records more information. Fix the wording to distinguish logical defaulting from physically rewriting rows.

## Tests

The confirmed-red restamping and clobbering tests are valuable. Exact route-response assertions and strict boolean validation are also good. The loud Postgres skip is fine.

Missing coverage:

- Concurrent on/off requests with reversed execution order.
- Filesystem `Promise.all(profile write, switch write)`, which detects reading outside the queue.
- Postgres concurrent profile/switch writes.
- Combined PATCH success, partial failure, and atomicity.
- The blocked-`now()` timestamp case.
- Offline cached GET and stale cache repopulation.
- Missing/malformed successful response fields.
- Initial GET failure and retry.
- Unmount during PATCH.

## What is fine

The filesystem queue, merge, `undefined` key removal, temp-file rename, and failure recovery are correct under the stated one-process contract. Neither profile nor switch saves can clobber the other there.

The intended route-field validation is strict; ignored extra keys are permissive but not dangerous. Returning both fields does not break existing clients, which ignore the added property.

`localStorage` would be wrong. The setting belongs to the reader across devices and may later be needed server-side. One nullable column on the existing one-row-per-reader table is the right home. Nothing is gated yet, and the URL-reachability rule is documented correctly.

I could not rerun Vitest because this review environment is read-only and Vite attempted to create `node_modules/.vite-temp`.