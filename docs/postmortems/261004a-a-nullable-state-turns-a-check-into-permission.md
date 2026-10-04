# A nullable state turns a CHECK into permission

Code review on 2026-10-04 found that a bibliographic claim could hold a publication day despite
the new constraint claiming otherwise. No reader impact was established: the current cache writer
does clear the day on a not-found answer. The gap was the table's protection against other writers.

Introduced by `c0e992349634382bf0331713fcd15fc419f2e4c6`, whose intent was to show registry dates
and journals after import. See the [plan's F5 response](../plans/261004a-metadata-page-shows-publication-date-and-journal-from-crossref-at-import.md#gpt-sols-plan-review-and-what-changed).

## The class: SQL unknown treated as refusal

The new predicate in [schema.ts](../../src/db/schema.ts), `bibliographic_records_published_day`,
was:

```sql
published_day is null or (state = 'found' and published_day ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
```

For a claim with `state = NULL` and `published_day = '2024-05-31'`, this evaluates to SQL NULL.
Postgres CHECK rejects only false; NULL passes. The older shape constraint's claim branch did not
include the new column, so neither constraint rejected the row.

The root cause was substituting a new constraint for the plan review's requested extension of the
shape check without testing the nullable claim state. Found-row round trips exercised the happy
path; the writer itself supplied null on other states, hiding the constraint's failure.

A sibling already documents the same mechanism: `citation_investigations_counts` in
[schema.ts](../../src/db/schema.ts) uses `coalesce(paper_state = 'read', false)` specifically because
a NULL CHECK passes.

## Fix and evidence

Use `state is not distinct from 'found'`: the comparison returns false for NULL. The first
migration had already been applied to the box's shared local database, so its file was left as
applied and [a second migration](../../drizzle/20261004001803_registry_published_day_only_on_found.sql)
drops the check and adds the corrected one. Neither had been pushed. The regression in [bibliographic-pg.test.ts](../../tests/bibliographic-pg.test.ts) inserts
the original claim-with-day shape and requires the named CHECK to reject it.

The regression passes against a database built from both migrations. **It was not seen red**: the
reviewer's sandbox had no database, and by the time it ran the corrected check was in place.

## Countermeasures, ranked by effort against value

1. **Insert forbidden rows directly, including NULL states** — cheap and added here. Writer round
   trips cannot demonstrate that a constraint refuses what that writer never emits.
2. **Make cross-field state comparisons return a boolean for every state** — the durable fix here;
   `IS NOT DISTINCT FROM` or explicit `coalesce` expresses the intended refusal.
3. **Ban nullable state columns throughout the schema** — rejected. A pending claim is legitimately
   different from both found and not-found; changing the state model costs more than making its
   constraint total.

The same review exposed another misleading test: [article-registry-pipeline.test.ts](../../tests/article-registry-pipeline.test.ts)
ran the real extract step, but its memory store treated `has` as presence. Postgres's
`hasArtefacts` in [artifacts-pg.ts](../../src/store/artifacts-pg.ts) requires a completed run, and
the runner had already marked extract running. The revised test models that false result; carrying
metadata checks `read(extractedHtml)` instead. A real call site still proves only the dependency
behaviour the test supplies.

Up: [Postmortems](../project/postmortems.md).
