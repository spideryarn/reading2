# Review request: the admin page

You are reviewing a **plan**, before the code lands, for the Spideryarn repo (TypeScript + ESM,
React on the client, Drizzle ORM over Supabase Postgres, deployed to Vercel).

Read `docs/plans/admin-page.md` — that is the plan. Also worth reading, in this order:

- `docs/project/auth.md` — especially § Whose data is it and § What is still shared. Everything
  built on 2026-08-27 was about making sure no signed-in reader can see another's data; this plan
  deliberately opens one route that can.
- `src/auth.ts` — the gate. `requireUser`, and `isAllowed()` which currently returns `true` for
  anybody Supabase will vouch for.
- `src/owner.ts` — the request-scoped owner, and why `currentOwnerId()` throws rather than falls
  back.
- `src/routes.ts` around line 2560-2760 — `serveApi`: where the gate sits inside the `try`, and how
  routes are matched (exact `path ===` or a regex on `url`).
- `src/db/schema.ts` header — why `auth.users` is deliberately absent from the Drizzle schema.
- `src/web/lib/DataTable.tsx` and `src/web/library-columns.tsx` — the existing TanStack seam the
  new page reuses.
- `src/web/router.ts` — the hand-rolled router, and its "anything unknown is the library" rule.
- `docs/reusable/silent-success.md` — the house rule about checks that pass while doing nothing.

## Context you should trust rather than re-derive

Measured on this laptop today, against the local Supabase stack:

- `DATABASE_URL` connects as `postgres`; `select id, email, created_at, last_sign_in_at from
  auth.users` succeeds. Nine rows.
- `drizzle.config.ts` has `schema: "./src/db/schema.ts"` and no `dbCredentials`, so `drizzle-kit`
  cannot see a table declared in a sibling file and cannot connect to introspect.
- `tests/helpers/authed.ts` already authenticates every route test as `greg@gregdetre.com` with
  Greg's real `sub`.
- Six `spideryarn` tables carry `owner_id` (`articles`, `comments`, `uploads`, `jobs`,
  `chat_threads`, `search_runs`, `glossary_lookups`); on the child tables it has never been read.

## What I want from you

Be concrete and skeptical. Specifically:

1. **Is one path-prefix check the right shape for the gate?** The plan puts a single
   `if (path.startsWith("/api/admin/") && !isAdmin(user.email)) throw 403` above the route table in
   `serveApi`, on the theory that a future admin route cannot then be added without a gate. What
   goes wrong with that? Case sensitivity, `//api/admin`, percent-encoding, a route that matches on
   `url` rather than `path` and so sees the query string, `handleApi` being reached by any path
   that does not start with `/api/`.

2. **The cross-owner query.** This route deliberately runs `group by owner_id` with no owner
   filter, inside a request where `setRequestOwner` has run. Is there a way that habit leaks —
   e.g. does anything in the store layer assume a query without `ownedSlug()` is a bug, and should
   there be a test that greps for cross-owner queries the way `tests/owner-isolation.test.ts`
   greps for `eq(articles.slug, …)`?

3. **`auth.users` as a Drizzle table in a sibling file.** Is "not imported by schema.ts, so
   drizzle-kit cannot see it" actually true and actually durable, or is it a property that quietly
   breaks the day someone adds a glob to `drizzle.config.ts`? Is there a better way to read four
   columns of a table we must never manage — raw `sql` template, a view, a Supabase admin API call
   with the service role key?

4. **What the page shows.** The plan says counts and dates only, never titles or filenames. Is
   *email* itself a step too far? Is there anything in the seven counts that leaks more than it
   looks like it does?

5. **Anything the plan has not thought of.** Particularly: the `501 under SPIDERYARN_STORE=files`
   branch, whether the client-side `isAdmin` check can be made to look like security by accident,
   and what happens on the day the production runtime role loses `select` on `auth.users`.

Give findings as a numbered list, each with a severity (blocker / should-fix / consider) and a
concrete suggested change. If the plan is wrong in its bones, say so plainly.
