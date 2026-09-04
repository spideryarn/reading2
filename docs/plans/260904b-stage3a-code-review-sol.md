No private-article disclosure path emerged in the current implementation. I found two medium-severity hardening issues and two lower-severity test gaps.

## Findings

1. **P2 — The 200-row limit does not bound response size or processing cost.**

   The listing projects unrestricted `text` columns, including `title`, the H1 block’s full text, `root_gist`, and `site_name` ([public-library.ts](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/src/store/public-library.ts:99)). Extraction does not constrain document titles ([extract.ts](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/src/extract.ts:474)), while fetched documents may reach 32 MB ([fetch.ts](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/src/fetch.ts:683)).

   Consequently, one deliberately enormous public H1/title—or many moderately large ones—can make an anonymous request allocate and serialize a very large JSON response. The query also retrieves 201 full rows before slicing in JavaScript ([public-library.ts](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/src/store/public-library.ts:238)).

   This is distinct from the known missing namespace rate limit, although that makes it easier to exploit. Apply listing-specific length caps in the SQL projection or enforce bounded scalar lengths when writing them, and test an oversized H1/title.

2. **P2 — The ownerless-enumeration guard does not cover the public request’s entire reachable execution path.**

   Its import graph starts at only `src/public/routes.ts` and `src/public/page.ts` ([import-graph.ts](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/tests/helpers/import-graph.ts:67)). Actual requests first execute the pre-auth dispatch in `src/routes.ts` ([routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/src/routes.ts:5957)) or the edge wrapper in `src/vercel.ts` ([vercel.ts](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/src/vercel.ts:274)).

   Therefore, a future ownerless article query added directly to either wrapper—before or beside the call into the closed public modules—would be publicly reachable but invisible to the new guard. A second store query is caught only if imported downstream from one of those two chosen roots.

   The detector also recognizes only the literal Drizzle shape `.from(articles)` ([owner-isolation.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/tests/owner-isolation.test.ts:451)); a table alias, relational query, or raw SQL can bypass it. The generated-SQL check does call the correct builder, but its regex proves only that visibility and `"public"` occur somewhere in the statement/parameters—not specifically in its `WHERE`.

   I would either move the whole pre-auth branch into a minimal module used directly by the transport, then root the graph there, or add explicit assertions over the transport’s pre-auth dispatch plus stricter AST/SQL-shape checks.

3. **P3 — `LIMIT` bounds returned rows but not database work.**

   I found no listing-oriented index covering public visibility and the requested order. PostgreSQL can scan/filter and sort the public corpus before applying `LIMIT 201`; the limit is therefore not a dependable compute ceiling for an anonymous endpoint. The articles schema currently has the slug uniqueness and visibility check but no corresponding public-listing index ([schema.ts](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/src/store/schema.ts:275)).

   A partial index such as `(public_at DESC NULLS LAST, slug) WHERE visibility = 'public'` would make the claimed bound substantially truer.

4. **P3 — Two important boundary/equivalence claims lack behavioral tests.**

   - Nothing tests 200 versus 201 rows, so `truncated`’s exact boundary is unverified. The implementation itself is correct by inspection: fetch 201, report `rows.length > 200`, return the first 200.
   - The SQL H1 fallback duplicates public-page heading selection, but no test loads the listing for the headed fixture and compares it with the clicked article. Changing the listing predicate to H2, or changing its ordinal selection, appears capable of passing the current static projection test. The comment claiming the implementations are checked together is therefore stronger than the tests ([public-library.ts](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/src/store/public-library.ts:90)).

## Security conclusions

- The current query requires `articles.visibility = 'public'`, joins through `current_revision_id`, and applies the readability `EXISTS` to that same joined revision ([public-library.ts](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/src/store/public-library.ts:159)).
- The composite article/current-revision foreign key prevents `current_revision_id` from naming another article’s revision ([0001_auth_fks_and_guards.sql](/home/greg/code/spideryarn2/.claude/worktrees/pricing-and-public-showcase/drizzle/0001_auth_fks_and_guards.sql:33)).
- PostgreSQL statement snapshots keep the projection and readability test internally consistent. A later click rechecks visibility; unpublishing between listing and click produces a 404 rather than private content.
- The H1 fallback is already-public article prose. `root_gist` is generated without the reader profile and is already exposed in the public article/head metadata, so the listing introduces discoverability rather than a new private-data category.
- The discriminated route switches have genuine `never` arms, and unknown paths and wrong methods terminate within the public namespace. The malformed-slug explanation is correct: passing collection routes through the slug helper would generate the same `/api/public/library` constant repeatedly, creating illusory coverage.
- `lockOrCreateArticle` is the sole production `articles` insertion seam I found. URL jobs, uploads, retries, and CLI processing converge there. Existing reserved rows remain readable as intended. Client and edge both special-case `/read/public` before generic slugs and currently agree on 404.

I ran the requested security-related tests: **4 files passed, 72 tests passed, 20 skipped**. The skipped tests were the real-Postgres cases because this sandbox was denied access to `127.0.0.1:54362`; static, generated-SQL, dispatch, reservation, and client-fetch assertions ran successfully. I did not count either acknowledged outstanding issue as a finding.