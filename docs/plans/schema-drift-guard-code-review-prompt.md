# Review request: schema drift guard, as built

You reviewed the **plan** for this earlier — `docs/plans/schema-drift-guard-review-sol.md` has your
seven findings. This is the second pass, on the code that came out of it. Weight this one higher
than the plan review: a plan-stage review cannot find a query that returns the wrong rows.

## What to read

The scoped diff is at the path given on the command line as the evidence file, and contains:

- `git diff` for `src/db/ssl.ts`, `scripts/db-migrate.ts`, `src/vercel-health.ts`, `package.json`
- the three new files in full: `src/db/schema-drift.ts`, `scripts/db-check.ts`,
  `tests/db-schema-drift.test.ts`

`docs/plans/schema-drift-guard.md` records what was built and what was deliberately deferred.

## How your plan findings were handled

1. **Not wired into the release path — blocker.** *Not fixed, deliberately.* The natural home,
   `scripts/deploy.ts`, is another agent's uncommitted work in this shared tree, and editing it
   would clobber theirs. Recorded as owed work in the plan. Tell me if you think shipping the
   guard without the gate is worse than not shipping it.
2. **Keep both guards.** Adopted in prose; only the column half is built.
3. **Identifier extraction — blocker.** Adopted in full, and measured: 21 of 39 columns on
   `article_revisions` have a TS key differing from the DB name. `BASE TABLE` join added, with a
   test that puts a view in the table's place.
4. **Privilege filtering.** Adopted: `has_schema_privilege(...,'USAGE')` is in the same query, the
   field is named `missingOrInaccessible`, and the production run went through `spideryarn_app`.
   I did **not** add per-table or per-column privilege assertions — tell me if that is a real gap.
5. **Required extra columns.** Adopted: `requiredButUndeclared`, filtered on
   `not nullable && no default && not generated && not identity`.
6. **Health: hard-fail plus cache.** Adopted, mirroring `cachedStoreCheck`'s cache *and* its
   `inFlight` coalescing.
7. **Transaction-based proof.** Adopted. One nuance: the "required extra" test adds the column
   `not null default 'x'` then drops the default, because a bare `not null` add fails once the
   table has rows — which it did.

## What I want from you

1. **Is the query right?** `ACTUAL_SCHEMA_SQL` interpolates the schema name rather than binding it,
   so one string serves both raw `pg` and Drizzle's `sql.raw`. Is that safe here, and does the
   `BASE TABLE` join actually exclude what I think it excludes? Any way it returns rows that make a
   broken database look healthy?
2. **`readActualSchema`.** `schemaUsable` is `rows[0]?.schema_usable === true`. If the schema has
   zero tables the query returns zero rows, so `schemaUsable` is false and the report says both
   "cannot USAGE" and "everything is missing". Is that the right failure, or is it misleading?
3. **The health integration.** Does the caching genuinely coalesce? Does an error really become
   `schema.error` plus 503 rather than an empty result that looks clean? Is `STORE === "postgres"`
   the right gate, and is omitting the key entirely (rather than `null`) on a filesystem store
   right?
4. **The tests.** Which of them would still pass if the thing they check were broken? That is the
   question I care about most. Be specific about which assertion is weak and what would make it
   real.
5. **Anything else you would not ship.**

Numbered findings, each with severity (blocker / should-fix / consider) and a concrete change.
