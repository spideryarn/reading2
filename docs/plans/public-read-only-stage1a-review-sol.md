The work is not wrong in its bones. I found no current route from `/api/public/` into an owner read or paid call, and no current DTO leak. No blockers.

1. **should-fix — `VerifiedUser` can be forged and its identity can be changed.** The private symbol check only reads a property ([auth.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/auth.ts:108)). A proxy returning `true` for symbol keys passes; an object inheriting from a real user also passes; and the real user’s `id` remains writable after branding ([auth.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/auth.ts:352)). The forged or modified id then reaches `setRequestOwner` ([routes.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:3294)). Use a module-private `WeakSet` for provenance and freeze the user before returning it. Test proxies, inherited objects, and post-verification mutation.

2. **should-fix — deleting an article deletes its audit history.** The FK uses `ON DELETE CASCADE` ([0024_article_visibility.sql](/Users/greg/Dropbox/dev/experim/spideryarn2/drizzle/0024_article_visibility.sql:32), [schema.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/db/schema.ts:270)). That defeats the log’s complaint/takedown purpose precisely after a document is removed. Make `article_id` nullable with `ON DELETE SET NULL`, retaining slug, actor, transition, confirmation and timestamp—or deliberately prevent deletion with `RESTRICT`. Add a publish/delete/audit-survives test.

3. **should-fix — the metadata SQL test does not test production’s metadata query.** The test builds `publicCurrentRevisionQuery(..., "metadata")` ([public-reads.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/public-reads.test.ts:26)), but `loadMetadata` contains a separate query ([public-reader.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/public-reader.ts:325)). Removing its actual visibility clause at line 337 passes that SQL test, and the integration suite only requests metadata after publication. Factor the real query through the tested helper and add a private-metadata-returns-404 test. Also assert that the blocks SQL retains its `revision_id` predicate; the current block tests only check selected columns and ordering.

4. **should-fix — the owner-isolation guard still trusts three entire files.** The sweep skips `pg.ts`, `owned-slug.ts`, and `public-slug.ts` wholesale ([owner-isolation.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/owner-isolation.test.ts:201)). It verifies that `slugIsTaken` is safe, but not that it is the only bare slug lookup in `pg.ts` ([owner-isolation.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/owner-isolation.test.ts:280)). Adding a fourth unfiltered lookup anywhere in an exempt file stays green. Reject every occurrence outside the exact named function bodies, or move `slugIsTaken` into its own leaf and remove the broad exemption.

5. **should-fix — two dispatcher controls can silently stop testing the claimed boundary.** The valid-user control catches every store error and never proves a handler ran ([public-dispatch.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/public-dispatch.test.ts:151)); inserting `return` immediately after `assertVerifiedUser` passes it. Exercise a deterministic route such as `/api/models` and assert the response. Separately, the non-GET sweep hardcodes two paths ([public-dispatch.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/public-dispatch.test.ts:223)), as does the zero-spend sweep ([public-visibility-pg.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/public-visibility-pg.test.ts:520)). A third public route is unchecked. Export one authoritative public-route inventory and drive both sweeps from it.

6. **should-fix — important database claims have not been watched fail.** The lifecycle header claims `NULL` is tested, but the below-route test only tries `"world"` ([public-visibility-pg.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/public-visibility-pg.test.ts:605)). Nothing tests concurrent publishing or rollback after an audit insertion failure; removing `.for("update")` at [pg-visibility.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-visibility.ts:75) remains green. Add a raw-SQL `NULL` refusal, two simultaneous publish requests with exactly one event, and a forced post-update failure proving both changes roll back.

7. **consider — malformed percent encoding becomes an internal 500.** `decodeURIComponent` is unguarded ([public/routes.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/public/routes.ts:122)); `/api/public/article/%` throws `URIError`, which the shared catch maps to 500. Catch decode failures and return the same fixed 400 as other malformed slugs. Add `%`, `%2`, and invalid UTF-8 cases.

The two endorsed departures were correct:

- Withholding `IncomingMessage` from the public dispatcher strengthens the boundary. Nothing needed today is lost; logging, spend collection, and request scope remain outside it. Future IP limiting or cancellation can be handled at `serveApi` or added explicitly.
- Setting `Allow` directly on `res` is correct. The shared catch only consumes `status` and `message`, and its JSON sender does not remove the existing header.

The present public trace is:

`serveApi` → closed public dispatcher → `pgPublicReader` → `publicSlug(slug)` → selected public columns → allowlist DTO.

No present import reaches owner stores, writers, or model code. The owner tripwire would not protect a future call that supplies an explicit owner to `ownedSlug`, queries a child table directly by `articleId`/`revisionId`, or makes a paid call—paid calls do not require an owner. The current safety comes from the closed import graph and hardwired reader, not from `currentOwnerId()` alone.

The visibility implementation itself serializes double-publish with a row lock, is idempotent, updates and logs in one transaction, survives re-extraction because visibility lives on `articles`, and returns 404 after deletion. Its defect is that deletion also erases the audit record.

Test blind spots by scoped file:

- `public-dto`: cannot detect private data placed under an allowed key.
- `public-imports`: misses computed dynamic imports or a newly named direct-network module.
- `public-reads`: finding 3.
- `public-dispatch`: finding 5.
- `public-visibility-pg`: findings 2, 3, 5 and 6.
- `owner-isolation`: finding 4.