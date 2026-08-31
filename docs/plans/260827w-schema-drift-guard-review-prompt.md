# Review request: schema drift guard

You are reviewing a **plan**, before any code is written, for the Spideryarn repo
(TypeScript + ESM, Drizzle ORM on Postgres/Supabase, deployed to Vercel).

Read `docs/plans/260827w-schema-drift-guard.md` — that is the plan. Also worth reading:

- `scripts/db-migrate.ts` — the existing migration runner, and the shell-vs-`.env.local`
  precedence trap documented in its header.
- `src/vercel-health.ts` — the health endpoint the plan wants to extend (573 lines; the `warnings`
  contract is what matters).
- `drizzle.config.ts` — why `schemaFilter` is pinned and why there are no `dbCredentials`.
- `docs/postmortems/260827c-unguarded-job-store-and-the-migration-that-migrated-the-laptop.md` — the
  earlier incident in this same class.
- `docs/reusable/silent-success.md` — the house rule the plan leans on.

## Context you should trust rather than re-derive

Verified against the live remote today:

- `spideryarn_app` (the role Vercel runs as) gets `permission denied for schema
  spideryarn_migrations`, so the health endpoint **cannot** read the Drizzle ledger.
- The same role **can** read `information_schema.columns` for schema `spideryarn`.
- All 19 migrations are currently applied; production is healthy as of this writing.

## What I want from you

Be concrete and skeptical. Specifically:

1. **Is the column-comparison approach right?** The plan rejects "compare applied migrations
   against `drizzle/meta/_journal.json`" partly on a permissions constraint and partly on
   directness. Is that reasoning sound, or is it rationalising around the grant? What does
   comparing columns miss that comparing the ledger would catch, and vice versa?

2. **Failure modes of the check itself.** This is a guard whose whole value is being trustworthy.
   Where can `getTableColumns()` vs `information_schema.columns` disagree *spuriously* — views,
   generated columns, case folding, quoted identifiers, `information_schema` hiding columns the
   role lacks privileges on (this one worries me: could a privilege gap make a column look
   *missing* and produce a false alarm?), Drizzle constructs that are not plain columns?

3. **The three open questions** at the end of the plan — give me a recommendation on each, not a
   survey.

4. **Anything the plan has not thought of.** Especially: is `/api/health` the right place at all,
   given it is polled by uptime monitors and a warning there pages someone? Is there a better
   moment — build time, deploy time, first request, a Vercel build step?

5. **Does this actually prevent the incident?** Walk the timeline: code with `raw_source_sha256`
   merged to `main`, migration not applied, deploy happens. At which point would this guard have
   spoken, and would anyone have been listening?

Please give findings as a numbered list, each with a severity (blocker / should-fix / consider) and
a concrete suggested change. If you think the plan is wrong in its bones, say so plainly.
