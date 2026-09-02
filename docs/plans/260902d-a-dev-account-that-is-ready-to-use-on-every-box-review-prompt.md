# Review prompt — a dev account that is ready to use on every box

You are reviewing a **plan**, before it is built, in the Spideryarn repo (TypeScript + ESM, `tsx`,
Postgres via Drizzle + local Supabase Docker stack). Read `CLAUDE.md` first for house rules —
especially "prefer simple over easy", "simplest version first", and
`docs/reusable/silent-success.md` (most of this repo's bugs are something reporting success while
doing nothing).

**The plan is `docs/plans/260902d-a-dev-account-that-is-ready-to-use-on-every-box.md`. Read it.**

## Context you should read

- `scripts/seed-accounts.ts` and `scripts/db-seed-owner.ts` — the existing account seed
- `scripts/setup-local.ts` — where the new step hooks in
- `tests/helpers/load-article.ts` — the loader the new script will call
- `tests/fixtures/data-root/README.md` — the committed fixture corpus
- `src/store/pg-reader.ts` — `writeExperimental`, whose semantics the seed mirrors
- `src/store/index.ts` — `SPIDERYARN_STORE` and its `files` default
- `src/admin.ts`, `src/owner.ts` — the uuid allowlist and the owner constants
- `docs/plans/260901j-a-signed-in-browser-on-the-box-with-no-human.md` — the neighbouring decision
- `docs/plans/260827aa-delete-the-importer.md` — why there is no files→Postgres importer in `src/`

## What I most want your judgement on

1. **The precedent of a `scripts/` command importing from `tests/helpers/`.** Nothing does this
   today. Is this the right call given the deleted-importer ruling, or does it erode the structural
   boundary that ruling created? If you think it is wrong, what is the cheapest alternative that
   does not resurrect a second files→Postgres implementation?
2. **The idempotency predicate** — "a published revision exists for this slug ⇒ skip; an `articles`
   row with no published revision ⇒ load; a different owner ⇒ report and continue". Is that right?
   What states does it get wrong? Note `articles.slug` is globally unique and this box already holds
   all five corpus slugs from test runs.
3. **Silent-success holes I have not named.** The plan has a table of them. What is missing? In
   particular: is reading back a `count(*)` of published articles for the admin owner actually
   sufficient evidence that the shelf will not be empty in a browser?
4. **The `SPIDERYARN_STORE` trap.** The dev server defaults to the filesystem store, so seeded
   Postgres rows are invisible. The plan's answer is a loud warning plus adding the name to
   `gjd-remote push-env`'s allowlist, and leaving the value for Greg to set on the laptop. Is that
   the right division, or should the seed refuse outright when the store is `files`? Consider that
   several agents share this one checkout and one dev server.
5. **Over-build.** What in this plan should be cut? Greg values the simplest version that works.
6. Anything factually wrong about the repo as I have described it.

Be concrete and cite file paths. Rank findings by severity. If you think the whole shape is wrong,
say so first.
