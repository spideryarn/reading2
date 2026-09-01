## Verdict

Not ready to describe as a faithful “everything” export. I found one serious data-loss bug, one concurrency bug, and two smaller contract/documentation defects.

### 1. High — the current revision is not serialized whole

This is a real bug and contradicts the central design claim.

`rowJson()` does serialize the article and child-table rows faithfully, but it is never applied to `rows.revision`. Instead, `manifestJson()` hand-picks seven values, collapses `finalUrl` and `requestedUrl` into one `url`, and the content/augmentation functions write only selected large fields ([export-bundle.ts:276](/home/greg/code/spideryarn2/src/store/export-bundle.ts:276), [export-bundle.ts:312](/home/greg/code/spideryarn2/src/store/export-bundle.ts:312), [export-bundle.ts:342](/home/greg/code/spideryarn2/src/store/export-bundle.ts:342)).

Consequently, the export loses substantial current-revision data, including:

- `status`, `basedOnRevisionId`, revision `createdAt`
- `lang`, `excerpt`, `publishedAt`, `note`
- the distinction between `requestedUrl` and `finalUrl`
- `fetchedAt`, `rawContentType`, `rawEncoding`, `rawSha256`, `rawByteCount`, `rawFilename`
- `rawSourceSha256`, `rawSourceKind`
- `source`, `extractMethod`, `pages`, `unverified`, `recall`, `pagesChecked`
- `wordCount`, `blockCount`, `partCount`, `sectionCount`, `rootGist`

Those are real columns on the selected row ([schema.ts:453](/home/greg/code/spideryarn2/src/db/schema.ts:453), [schema.ts:484](/home/greg/code/spideryarn2/src/db/schema.ts:484), [schema.ts:586](/home/greg/code/spideryarn2/src/db/schema.ts:586), [schema.ts:818](/home/greg/code/spideryarn2/src/db/schema.ts:818)). Byline and site name appear only in normalized, HTML-escaped form in `index.html`; that is not faithful machine-readable preservation.

The guard passes because its `article_revisions` sentinel is placed only in `title`, which does reach `manifest.json` ([store-export-covers-tables.test.ts:303](/home/greg/code/spideryarn2/tests/store-export-covers-tables.test.ts:303)). Thus it proves one column from the table survived, not the row.

This directly falsifies the plan and project-doc claims that the bundle “serialises whole rows” and automatically carries new columns ([plan:180](/home/greg/code/spideryarn2/docs/plans/260901h-export-article-data.md:180), [export.md:92](/home/greg/code/spideryarn2/docs/project/export.md:92)). It also makes the README/index statement “everything Spideryarn holds” false ([export-bundle.ts:414](/home/greg/code/spideryarn2/src/store/export-bundle.ts:414)).

### 2. Medium — this is not a consistent snapshot and can drop concurrent chat data

This is a real concurrency bug.

The parent row is read first, then nine independent queries run through the pool using `Promise.all`, explicitly without a transaction ([article-rows.ts:388](/home/greg/code/spideryarn2/src/store/article-rows.ts:388), [article-rows.ts:401](/home/greg/code/spideryarn2/src/store/article-rows.ts:401)). Each statement can therefore observe a different committed database state.

A concrete failure:

1. The threads query takes its snapshot before a new thread transaction commits.
2. That transaction commits its thread and message.
3. The messages query takes its snapshot afterwards and sees the message.
4. Bundle construction iterates only the older thread list, so the newly observed message is silently discarded ([export-bundle.ts:368](/home/greg/code/spideryarn2/src/store/export-bundle.ts:368)).

Concurrent deletion or updates can similarly produce a mixture of before-and-after state across comments, criteria, chats and lookups.

For a fixed database, the legacy projection’s ordering, `compact()` behavior, and absent-versus-null behavior are unchanged. But the rollback’s observable concurrency behavior did move: the old per-thread message reads were replaced with one eager parallel read, as the plan itself records ([plan:151](/home/greg/code/spideryarn2/docs/plans/260901h-export-article-data.md:151)). A static directory diff cannot detect that.

A read-only repeatable-read transaction around the complete walk would give the advertised snapshot semantics.

### 3. Medium — the coverage guard overstates what it proves

This is a real guard defect, not merely weak testing.

The sentinel check can pass while a projection:

- drops every column except the sentinel-bearing one;
- changes enums, booleans, numbers, dates or nulls;
- double-encodes a row as a JSON string—the sentinel substring still survives;
- duplicates or reorders rows;
- leaks `ownerId`;
- drops an entire logical relationship.

The current revision loss above is a live demonstration.

The schema collector also follows foreign keys in only the child-to-scoped-parent direction ([store-export-covers-tables.test.ts:118](/home/greg/code/spideryarn2/tests/store-export-covers-tables.test.ts:118)). It does not discover referenced parent tables such as:

- `raw_sources`, referenced by `article_revisions` ([schema.ts:850](/home/greg/code/spideryarn2/src/db/schema.ts:850));
- `uploads`, referenced by jobs and also loosely linked to the eventual article by `slug` ([schema.ts:1526](/home/greg/code/spideryarn2/src/db/schema.ts:1526), [schema.ts:1678](/home/greg/code/spideryarn2/src/db/schema.ts:1678)).

Whether those records belong in the export is a product decision. But the claim that the guard finds everything connected to an article is false, and the manifest cannot report those omissions because it derives table omissions only from this incomplete record. The plan says uploads are deliberately omitted, but that omission is absent from the manifest ([plan:280](/home/greg/code/spideryarn2/docs/plans/260901h-export-article-data.md:280)).

### 4. Low — `ArticleBundle.filename` is a broken internal contract

The interface says the route uses `filename`, and the builder returns `spideryarn-${slug}.zip` ([export-bundle.ts:90](/home/greg/code/spideryarn2/src/store/export-bundle.ts:90), [export-bundle.ts:266](/home/greg/code/spideryarn2/src/store/export-bundle.ts:266)). The route ignores it and independently emits `${slug}.zip`; the client independently repeats that filename again ([routes.ts:562](/home/greg/code/spideryarn2/src/routes.ts:562), [Metadata.tsx:1010](/home/greg/code/spideryarn2/src/web/Metadata.tsx:1010)).

Downloads work, so this is low severity. But one of the three definitions should own the name; currently the bundle’s documented value is dead.

### 5. Low — the source-of-truth docs still describe the feature as unbuilt

These are real documentation defects:

- `export.md` says the route and button do not exist and nothing calls the bundle ([export.md:18](/home/greg/code/spideryarn2/docs/project/export.md:18)).
- The completed plan still begins with “No code written yet” ([plan:3](/home/greg/code/spideryarn2/docs/plans/260901h-export-article-data.md:3)).

## Areas that are sound

- `rowJson()` itself is correct for every row on which it is actually used: top-level `Date`s become ISO strings, nulls survive, JSONB is not double-encoded, and the selected tables contain no current `bytea`. `fts` is explicitly stripped ([export-bundle.ts:108](/home/greg/code/spideryarn2/src/store/export-bundle.ts:108)).
- Current owner isolation is sound. Authentication fills the request owner before dispatch; the article lookup predicates on slug and owner; all child reads use the resulting article/revision IDs. Composite foreign keys prevent the current revision or blocks from belonging to a different article ([routes.ts:5543](/home/greg/code/spideryarn2/src/routes.ts:5543), [article-rows.ts:390](/home/greg/code/spideryarn2/src/store/article-rows.ts:390), [0001_auth_fks_and_guards.sql:18](/home/greg/code/spideryarn2/drizzle/0001_auth_fks_and_guards.sql:18)). Child `ownerId` columns need not be re-filtered because `articles.ownerId` is explicitly authoritative.
- `articleBundle()` is callable internally outside a request, where it uses the configured environment owner. That is intentional CLI/test behavior, not an unauthenticated HTTP path.
- The `index.html` escaping is sound. All untrusted leaf values are escaped, the one attribute value is escaped after an HTTP(S)-only gate, and the CSP’s `default-src 'none'` blocks script and network resources. Allowing the constant inline stylesheet does not open an external-fetch path.
- I found no serious client lifecycle bug. It waits for the complete blob before clicking, disables repeat presses, attaches/removes the anchor correctly, schedules revocation, and restores state through `finally`.
- The 4.5 MB response cap and 413 policy match the current [official Vercel limit](https://vercel.com/docs/functions/limitations).