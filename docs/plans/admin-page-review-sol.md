Verdict: **NO-SHIP as written, but it is not wrong in its bones.** A centralized server-side gate over an admin namespace, followed by a deliberately cross-owner aggregate query, is the right architecture. The administrator identity and the evidence plan need correction before implementation.

1. **Blocker — administrator power should belong to Greg’s immutable `sub`, not an email address.**

   A signed JWT makes the email trustworthy, but not stable. Changing or recreating the account can remove or transfer admin power. The plan already knows Greg’s actual stable subject ID, and the test helper records it ([admin-page.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/admin-page.md:31), [authed.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/helpers/authed.ts:19)).

   Suggested change: define `ADMIN_USER_ID = "f4d08b58-..."` and make `isAdmin(user.id)` an exact comparison. The browser can use `user.id` for cosmetics. Test that the same email with another `sub` is denied, while Greg’s `sub` remains admin if his email changes. The UUID being visible in the client bundle is harmless; it is an identifier, not a credential.

2. **Should-fix — one namespace gate is right, but the proposed prefix is incomplete.**

   `path.startsWith("/api/admin/")` does not cover a future exact `/api/admin` endpoint, so the claim that no future admin route can escape the gate is false. Use:

   ```ts
   const adminPath = path === "/api/admin" || path.startsWith("/api/admin/");
   ```

   Define `adminUsers` from the same `path`, with an exact `path === "/api/admin/users"` match. Do not gate on `path` and then match the admin route against `url`.

   Case variants, `//api/admin`, and percent-encoded spellings are not current bypasses: they either fail the initial raw `/api/` check or fail the exact route match ([routes.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:2577)). Query strings are safe when both decisions use the stripped `path`. Production’s one decoding step is separate and should be tested through `originalUrl()` as well as directly through `handleApi` ([vercel.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/vercel.ts:76)).

   Add a table-driven test covering `/api/admin`, `/api/admin/`, `/api/admin/future`, query strings, case variants, encoded variants, and `/api/administer`. Every path actually inside the namespace should give a non-admin 403 before route or method matching.

3. **Blocker — the proposed tests can all pass while the feature never succeeds.**

   The plan tests `isAdmin`, one 403, and client link visibility, but no successful Postgres response and no 501 branch ([admin-page.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/admin-page.md:109)). The endpoint could always return 501 or an empty list and every planned automated test would remain green.

   Suggested change: add a dedicated suite that sets `SPIDERYARN_STORE` before importing store-dependent modules, following the existing hoisted-env pattern ([store-guarded.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/store-guarded.test.ts:57)). It should prove:

   - non-admin under `files` gets 403, not 501;
   - admin under `files` gets the explicit 501;
   - admin under Postgres gets 200;
   - two seeded owners both appear with deliberately different non-zero counts;
   - absent activity becomes zero, not a missing row;
   - removing the server admin gate makes the denial test red;
   - replacing the aggregate implementation with an empty result makes the success test red.

4. **Blocker — `uploads.status = 'complete'` can never match.**

   The actual states are `pending`, `claimed`, `verified`, `rejected`, and `expired`; the database check enforces that list ([schema.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/db/schema.ts:675), [source.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/source.ts:208)). Because `status` is text, querying for `complete` returns a convincing zero instead of throwing.

   Suggested change: first define what “docs uploaded” means:

   - successful upload attempts: `status = 'verified'`;
   - uploads that became articles: probably `status = 'verified' and slug is not null`;
   - distinct resulting documents: count distinct `slug`, so retries do not inflate it.

   Pin that meaning with seeded rows in every terminal state.

5. **Should-fix — the cross-owner exception needs a structural seam and an observable test, not a generic grep.**

   `setRequestOwner()` does not inject a database filter. Filtering only happens where a query explicitly calls predicates such as `ownedSlug()` ([pg.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg.ts:112)). Therefore the aggregate works—but it becomes dangerous if reused from an ordinary route.

   Put all such queries in one plainly named module and method, for example `pgAdminStore.listUsersAcrossOwners()`, export it only through `guardDbStore`, and call it only after the namespace gate. Add it to the guarded-store test.

   A generic grep for “queries without an owner filter” would overclaim: the existing grep protects one precise syntactic mistake, `eq(articles.slug, …)`, not every possible missing `where` ([owner-isolation.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/owner-isolation.test.ts:169)). A narrow allowlist scan for `groupBy(...ownerId)` outside the admin module is useful, but the important evidence is a two-owner database test showing that the admin aggregate sees both while an ordinary route still sees one.

   Also, child `owner_id` is not enforced to equal its article’s owner ([auth.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/auth.md:317)). Using it is not load-bearing for isolation, but it is load-bearing for accurate attribution. Either group comments/chats/searches through `articles.owner_id`, or explicitly accept and test direct child attribution. The plan should not call those counts authoritative without choosing.

6. **Should-fix — the sibling Drizzle declaration is safe today, but the plan describes only half the protection.**

   It is true that `auth-users.ts` is invisible while `drizzle.config.ts` names only `schema.ts`. However, adding a glob alone would not currently expose `auth.users`: `schemaFilter` is pinned to `spideryarn` ([drizzle.config.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/drizzle.config.ts:30)), and the installed Drizzle serializer filters imported tables by schema ([Drizzle serializer](/Users/greg/Dropbox/dev/experim/spideryarn2/node_modules/drizzle-kit/api.js:22368)). Both settings—not merely the sibling file—are the fence.

   For four read-only columns, I would use a schema-qualified raw `sql` template plus a runtime-checked row type. It creates no table metadata for migration tooling to discover. If the typed table declaration is retained, add a test pinning all of:

   - `schema === "./src/db/schema.ts"`;
   - `schemaFilter === ["spideryarn"]`;
   - no `dbCredentials`;
   - `schema.ts` does not import `auth-users.ts`.

   A view is worthwhile only if you want a database-level projection with limited grants. The Supabase Admin API is worse here: it adds a network dependency and a service-role credential capable of managing users merely to read four columns.

7. **Should-fix — email is justified; the interaction telemetry is not yet justified.**

   Email is personal data, but an identifiable admin user list without an identifier is barely useful, and Greg explicitly requested users plus sign-up and login dates. I would keep it.

   Questions, chats, searches, opens, and “last read” are behavioral reading metadata. Beside an email and with nine users, they are not anonymous aggregates. “No titles” is a valuable boundary, but it does not make those fields innocuous.

   Suggested change: start with email, sign-up, last sign-in, active/archived document counts, and the precisely defined upload count. Add interaction counts only after the plan records that Greg deliberately wants cross-reader engagement telemetry. Treat `email` and `last_sign_in_at` as nullable; `auth.users` can contain accounts that do not fit this app’s current email-login assumptions.

8. **Should-fix — permission loss must become an explicit operational failure, not merely “the page will notice.”**

   The admin store must be behind `guardDbStore`, so SQLSTATE `42501` becomes the existing safe generic 500 rather than leaking database text ([db-errors.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/db-errors.ts:342)). The client must render that as an error state, never as an empty table.

   Grant only the required columns when the runtime role arrives:

   ```sql
   grant usage on schema auth to spideryarn_runtime;
   grant select (id, email, created_at, last_sign_in_at)
     on auth.users to spideryarn_runtime;
   ```

   Add a deployment or health privilege probe using `has_schema_privilege` and `has_column_privilege`; an infrequently visited admin page is a poor alarm. Also send `Cache-Control: private, no-store` on this response. The application’s IndexedDB cache currently uses an explicit allowlist that excludes admin routes ([api.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/lib/api.ts:427)), but the HTTP response should state the policy itself.

9. **Should-fix — keep the client decision visibly cosmetic, and update the security docs.**

   `parseRoute` should recognize `/admin` and `/admin/users` independently of who is signed in. `App` may render the shelf for a non-admin and hide links using `isAdmin(user.id)`, but no client outcome should be cited as authorization evidence. The server’s 403 test is the evidence.

   The plan must also include updates to `auth.md` and the security map. They currently promise that each reader gets their own shelf and identify `ownedSlug()` as the cross-reader defence ([security-map.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/security-map.md:20)). This route is a deliberate, privileged exception and should be named there, including exactly which metadata it exposes and why it exposes no content.

I kept this review plan-only and did not assess the uncommitted implementation files currently appearing in the shared tree.