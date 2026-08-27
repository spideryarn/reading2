# Review request: the admin page, as built

You reviewed the **plan** for this a few hours ago (`docs/plans/admin-page-review-sol.md`). This is
the second pass, on the code, and it should be weighted higher than the first — a plan-stage review
cannot find a query that returns strings where the types say numbers.

**Read `docs/plans/admin-page.md` first.** Its § Who is the admin, § Tests and § The fence around
`auth.users` were rewritten to record what your review changed. `docs/project/admin.md` is the
permanent doc.

## What changed because of your first review

Say if any of these was applied badly, not just whether it was applied.

1. **Admin is now an account id, not an email.** `ADMIN_USER_ID` in `src/admin.ts`. `describeAdminMiss`
   logs one fixed sentence when the administrator's own address arrives on an unknown id, so that a
   recreated account is a line in the log rather than a silent lockout.
2. **The namespace check is two comparisons**: `path === "/api/admin" || path.startsWith("/api/admin/")`.
3. **Tests that can fail.** A pure `mergeUsers` unit-tested with two owners, a real-database shape
   test, an exact `501` for the administrator under the filesystem store, and the fence test.
4. **`status = 'verified'`**, not `'complete'`.
5. **Named `listUsersAcrossOwners`**, and behind `guardDbStore`.
6. **The child counts group through `articles.owner_id`**, not the child rows' own `owner_id`.
7. **`tests/auth-users-fence.test.ts`** pins both halves of the fence (one schema file, and
   `schemaFilter`). The typed Drizzle table was **kept** rather than replaced with a raw `sql`
   template — because Drizzle's column mappers are what make `max(last_opened_at)` a `Date` rather
   than the non-ISO string a raw template returned. Tell me if that reasoning is wrong.
8. **`Cache-Control: private, no-store`** on the response.
9. Docs: `docs/project/admin.md` is new, `auth.md` has a § The one deliberate exception, and
   `security-map.md` lists it.

Not done, deliberately, and both recorded in the plan's § Not now: the `has_schema_privilege`
deploy probe, and dropping the interaction counts.

## The code

**This working tree is shared with several other agents**, so `git diff` contains a lot that is not
mine. Review only:

New files, in full:

- `src/admin.ts`
- `src/db/auth-users.ts`
- `src/store/pg-admin.ts`
- `src/web/admin-columns.tsx`
- `src/web/AdminPage.tsx`
- `src/web/useAdminUsers.ts`
- `tests/admin.test.ts`
- `tests/admin-users-merge.test.ts`
- `tests/admin-store.test.ts`
- `tests/auth-users-fence.test.ts`
- `docs/project/admin.md`

`docs/plans/admin-page-scoped.diff` (a scratch artefact, deleted after the review) was `git diff`
restricted to the modified files that are wholly
or mostly mine (`src/store/contracts.ts`, `src/store/index.ts`, `src/types.ts`,
`src/web/page-title.ts`, `src/web/params.ts`, `src/web/router.ts`, `docs/project/auth.md`,
`docs/project/security-map.md`, and three test files).

Three modified files are shared with other agents and are **not** in that diff. In them, look only
at:

- `src/routes.ts` — the `adminNamespace` / `adminUsers` constants (around line 2600) and the two
  blocks just after `setRequestOwner(user.id)` (around line 2820). Nothing else in that file is
  mine.
- `src/web/App.tsx` — the `route.kind === "admin"` block and the `isAdmin` import.
- `src/web/Library.tsx` — the `useSession()` call and the `isAdmin(user?.id) &&` link.

## Evidence, rather than claims

- `npx vitest run tests/admin.test.ts tests/admin-users-merge.test.ts tests/admin-store.test.ts
  tests/auth-users-fence.test.ts tests/routes.test.ts tests/router.test.ts` — green here.
- Each new check was watched **failing** against the broken state before being kept: commenting out
  the namespace gate turns three route tests red; removing `.mapWith` turns both store tests red;
  widening `drizzle.config.ts` to a glob and importing `auth-users.ts` from `schema.ts` turns three
  fence tests red.
- `listUsersAcrossOwners()` was run against the local Supabase stack and returned nine accounts with
  real counts.
- `npx tsc --noEmit` is clean apart from another agent's in-flight `src/db/schema-drift.ts`.

## What I want from you

1. **Anything actually broken.** Wrong SQL, a count that means something other than its label, a
   type that is a claim rather than a fact, a React hook that will not do what it says.
2. **The gate, again, now that it is code.** Is there any request shape that reaches
   `adminStore.listUsersAcrossOwners()` without passing `isAdmin`? Consider `src/vercel.ts`'s
   `originalUrl()` decoding step, which runs in production and not in the tests.
3. **`mergeUsers`.** It is the only part with arithmetic. Is the test covering what would actually
   go wrong, or only what is easy to assert?
4. **The client.** `AdminPage.tsx` copies the shelf's sorting round-trip from `Library.tsx`; did it
   copy the parts that matter (`sinkLast` for missing values, `isAllNatural` for a short URL, the
   `functionalUpdate` against the same array) or only the shape? Is the `useAdminUsers` hook right
   about what it does on a failed refresh?
5. **Anything the docs now assert that the code does not do.** `docs/project/admin.md` is written to
   be believed by the next agent.

Findings as a numbered list, each with a severity (blocker / should-fix / consider) and a concrete
change. If something I did in response to your first review made it worse, say so plainly.
