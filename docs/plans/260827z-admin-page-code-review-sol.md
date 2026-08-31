No blocker or admin-gate bypass found. I found four should-fix issues and one testing gap.

1. **Should-fix — “Articles” counts rows that are not on the shelf.**

   The aggregate counts every `articles` row based only on `archived_at` ([pg-admin.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-admin.ts:233)). But a new ingest creates that row before publishing anything ([pg-revisions.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-revisions.ts:507)); a failed first ingest leaves `current_revision_id` null, and the draft sweeper deletes only the revision. The shelf excludes such rows through its inner join to the current revision and its tree/block checks ([pg.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg.ts:462)).

   Consequently, a failed ingest can permanently increase “Articles” even though no article appears on that owner’s shelf. The query also omits the shelf’s `_`-slug exclusion.

   Concrete change: factor the shelf’s article-eligibility rule into a shared SQL predicate/query seam and use it for these aggregates. Add a regression case containing an unpublished first draft and an `_` slug.

2. **Should-fix — `confirmedAt` does not mean what its type and UI say.**

   The code selects `auth.users.confirmed_at` ([auth-users.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/db/auth-users.ts:53)), while the type says it represents email confirmation and is “never set for a Google account” ([types.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/types.ts:1052)). Supabase defines `confirmed_at` as confirmation of either email or phone, and calls it a backward-compatibility field. [Supabase’s user documentation](https://supabase.com/docs/guides/auth/users) confirms that distinction.

   The client uses its absence to print “unconfirmed” beneath an email address ([admin-columns.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/admin-columns.tsx:126)). A phone-confirmed account with an unconfirmed email would therefore be mislabeled. The Google claim is also contradicted by the merge fixture itself, which gives its Google account a confirmation date.

   Concrete change: select `email_confirmed_at`, rename the field to `emailConfirmedAt`, and update the grant, client, types, and tests. If generic account confirmation was intended, keep the column but remove the email-specific label and comments.

3. **Should-fix — the database tests prove shapes, not the SQL’s meanings.**

   `mergeUsers` is tested well: distinct numbers for every field and owner will catch wrong maps, cross-owner leakage, field cross-wiring, and missing zero defaults ([admin-users-merge.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/admin-users-merge.test.ts:43)). The weakness is before `mergeUsers`.

   The real-database test checks only runtime types and uniqueness ([admin-store.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/admin-store.test.ts:72)). These regressions would all remain green:

   - changing `verified` back to any other valid string;
   - grouping children through their own `owner_id`;
   - swapping which SQL query feeds questions and chats;
   - counting unpublished article rows, as finding 1 currently does.

   Concrete change: add exact-value database fixtures or transaction-scoped baseline deltas for active/archived articles, every upload state, and the three child joins. At minimum, add query-builder tests pinning `verified` and the joins while retaining the runtime shape test.

4. **Should-fix — an initial load failure has no Refresh button.**

   The hook behaves correctly on a failed refresh: it preserves the old rows, sets an error, resolves rather than rejects, and clears the error after a later success ([useAdminUsers.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useAdminUsers.ts:45)).

   But the Refresh button is rendered only when `users` is already non-null ([AdminPage.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/AdminPage.tsx:185)). If the first request fails, the page shows the error with no way to invoke `reload`; the user must reload the browser, contrary to the hook’s stated reason for exposing it.

   Concrete change: always render Refresh, rendering only the account count conditionally. When old rows remain after failure, prefix the error with “Refresh failed; showing the previous numbers.”

5. **Should-fix — the permanent docs and fence test overstate several facts.**

   There are seven declared columns, not six. More importantly, [admin.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/admin.md:119) says widening the schema path to a glob would put `auth.users` into the snapshot, but its own later explanation correctly says `schemaFilter: ["spideryarn"]` would still exclude it ([admin.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/admin.md:179)). The same stale claim appears in [auth-users.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/db/auth-users.ts:19).

   The fence test titled “declares only the columns the admin page reads” merely blacklists five credential fields ([auth-users-fence.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/auth-users-fence.test.ts:79)); adding another sensitive `auth.users` column would pass. Also, the docs’ “counts and dates and an email address” boundary omits the returned account ID and displayed provider metadata.

   Concrete change: correct six to seven; describe widening the glob as removing one of two independent barriers; assert the exact declared column-name allowlist using Drizzle’s table metadata; and describe the response as limited account metadata, counts, and dates.

The typed Drizzle declaration was not a bad decision. Reusing the timestamp column’s mapper makes the runtime `Date` conversion easy and testable. The argument is only slightly overstated: raw SQL can also attach an explicit decoder or runtime parser; it simply does not receive that conversion automatically.

On the gate itself: `adminUsers` necessarily implies `adminNamespace`, the namespace check precedes the only store call, and the only production caller restores `req.url` before `handleApi`. I found no encoded, double-encoded, query-bearing, slash, or prefix-adjacent request that reaches `listUsersAcrossOwners()` without `isAdmin`. The production-specific composition is not directly tested, however; add one encoded-admin case passing `originalUrl()`’s result into `handleApi`.

The sorting round-trip copied the important pieces correctly: `sinkLast`, per-column natural directions with `isAllNatural`, and `functionalUpdate` against the exact `sorting` array supplied to TanStack.

I reran the deterministic relevant suites, including the existing guarded-store and Vercel URL tests: 7 files and 164 tests passed. The sandbox could not connect to local Postgres, so I did not independently repeat the database-backed test.