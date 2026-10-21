# Code review: 261021d

You are reviewing the built code of plan
docs/plans/261021d-admin-sees-a-private-link-s-owner-and-who-opened-it.md (read it first, including
"After GPT Sol's plan review", which you wrote and which overrides the draft below it). The whole
change is in docs/plans/261021d-code-review.diff (generated files excluded); you are in the worktree
and may read and run anything.

Greg's reply `spya-xug3kf` to q-agbc89 chose exactly 1B (the admin sees the owner of an article read
through a private link) and 2C (record signed-in accounts that open a private link, plus a count of
signed-out opens). Nothing wider.

**This touches defences** (docs/project/security-map.md's table): `src/public/routes.ts` (a POST
route in the ungated namespace), `src/store/public-access.ts` (a new predicate), `src/routes.ts`
(two authenticated routes, one under the admin namespace gate), and the client's
`src/web/public-api.ts`. Look hardest at:

1. Whether any non-admin can now learn anything new — an owner, an opener, a count, whether a slug
   exists, whether a key is right — from any of the three new routes or the page.
2. `articleAccessForAdmin`'s `or(ownedSlug(slug), publicAccessWhere(slug, accessFor(key)))`: is it
   exactly "the admin's own, a public one, or a private one with its right key"? `ownedSlug` uses
   the ambient owner: is that the admin on that route?
3. The public write: method handling, the slug/key parse order, that it reads nothing from the
   request beyond `path`, `method` and `key`, the `insert … select` with `onConflictDoUpdate …
   where` throttle and the saturating `least(...)` (does the throttle `where` really skip the
   update? is `make_interval(secs => $1)` with a bound parameter valid?), and the guards in
   tests/public-imports.test.ts and tests/owner-isolation.test.ts — did my edits there weaken them?
4. The signed-in write: `recordOpener` with `ne(articles.ownerId, readerId)` and the `::uuid` cast
   of the reader id; concurrency; the route's 401 for signed-out.
5. The client: `usePrivateLinkOpen` (once per slug per mount; which request for which session
   state; a session switching mid-flight), `notePrivateLinkOpened`'s fixed shape, `Ownership.tsx`'s
   `useAdminArticleAccess` (stale answers, 404 vs failure, the key in the URL), the owner card's
   `ownerId` guard in Metadata.tsx.
6. Where the key now travels: query strings of three new requests. Any log, Sentry breadcrumb,
   offline store or error message that could now carry it? (src/web/lib/api.ts, src/log.ts)
7. The privacy page, Help page, privacy.md, admin.md, security-map.md and security-risks.md R31:
   do they say exactly what the code does — no more, no less?
8. tests/private-link-opens-pg.test.ts has **not run**: the shared local database's migration
   ledger is held by another tree's unlanded migration (do not touch the ledger, do not run
   `db:migrate` or any DDL). Read it for mistakes that would make it pass vacuously or fail for the
   wrong reason.

Since 2026-09-09 you **fix what you find** inside this change: edit the files directly, keep
fixes scoped, run `npm run typecheck` and the touched unit suites (`npx vitest run <files>`; not
the Postgres one). Report anything wider for me to decide rather than doing it.

Write your answer as: a numbered list of findings (severity P0/P1/P2, file:line, the concrete
failure, and what you changed or why you did not), then the list of files you edited, then a
one-line verdict.
