# Verdict: BLOCKED

The ownerless `/api/public/` seam is the right design. Do not impersonate the owner and do not widen `ownedSlug()`.

The plan is not ready to build, however. Stage 1 has three blockers: the payload boundary is denylist-based despite direct private fields in current responses; the existing React reader performs authenticated reads and writes even when merely viewing an article; and CDN caching would defeat the visibility switch.

## Ranked findings

### 1. BLOCKER — Current responses cannot cross the public boundary verbatim

Use new, explicit public DTOs built by allowlist projection. A recursive key denylist is insufficient: it misses innocently named fields such as `title`, `guidance`, `comments`, `generatedAt`, `lookup`, and future aliases such as `owner`, `createdBy`, or snake-case keys.

The actual leaks are:

| Endpoint | Fields that must not cross unchanged |
|---|---|
| `article` | `meta.title` can be the owner’s private title override: both stores apply `titleFor()` before returning it ([src/api.ts:809](/Users/greg/Dropbox/dev/experim/spideryarn2/src/api.ts:809), [src/store/pg.ts:483](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg.ts:483)). Also omit `fetchedAt`, extraction `note`, block `note`, and PDF/upload provenance: `source`, `method`, `pages`, `rawSha256`, `unverified`, `recall`, `pagesChecked` ([src/types.ts:815](/Users/greg/Dropbox/dev/experim/spideryarn2/src/types.ts:815)). `meta.url` is the final fetched URL and may contain credentials or signed query parameters ([src/store/pg.ts:324](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg.ts:324)); canonicalisation needs its own safe URL policy. |
| `metadata` | `profile`, `purpose`, `comments`, `archivedAt`, `dir`, and effectively all of `stages`: internal paths/column names, completion state, exact run times and byte counts. The filesystem response assembles them directly at [src/api.ts:644](/Users/greg/Dropbox/dev/experim/spideryarn2/src/api.ts:644) and [src/api.ts:661](/Users/greg/Dropbox/dev/experim/spideryarn2/src/api.ts:661); Postgres does the same at [src/store/pg.ts:688](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg.ts:688) and [src/store/pg.ts:714](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg.ts:714). Return a small `availableKinds` shape instead. |
| `summary` | `profileHash`, `profileChanged`, and especially `guidance`, which is the owner’s free-text steer. Also `generatedAt` and `elapsedMs` reveal generation activity; `generator`, `version` and `sourceHash` expose unnecessary internals ([src/types.ts:518](/Users/greg/Dropbox/dev/experim/spideryarn2/src/types.ts:518)). |
| `glossary` | `profileHash`, `profileChanged`, `passes`, `generatedAt`, `elapsedMs`, and every `entry.lookup`. A lookup contains the owner-requested answer, citations, search count, model and exact time ([src/types.ts:345](/Users/greg/Dropbox/dev/experim/spideryarn2/src/types.ts:345)). Postgres currently attaches those private rows to the returned glossary at [src/store/pg.ts:769](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg.ts:769). |
| `ideas` | `profileHash`, `profileChanged`, `generatedAt`, `elapsedMs`, and unnecessary generator/source provenance ([src/types.ts:737](/Users/greg/Dropbox/dev/experim/spideryarn2/src/types.ts:737)). |
| `tweets` | `profileHash`, `profileChanged`, `generatedAt`, `elapsedMs`, and unnecessary generator/source provenance ([src/types.ts:121](/Users/greg/Dropbox/dev/experim/spideryarn2/src/types.ts:121)). |

`profileChanged` cannot even be computed on the ownerless path: `withProfileChanged()` reads the current reader profile through `resolveProfile()` ([src/routes.ts:2224](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:2224)). It should simply not exist in public responses.

None of these six responses currently includes `ownerId` or email. The danger is a future public query serialising a selected `articles` row wholesale. Public query results and public wire types should both make that unrepresentable.

The generated prose itself may reveal the shape of a private profile even after the hashes are removed. That is the dangerous consequence of decision 4. The plan acknowledges it, but the confirmation should identify which existing artefacts were personalised—not merely include a vague clause.

### 2. BLOCKER — A `readOnly` prop does not make the existing reader publicly runnable

The current reading shell has network behaviour throughout it:

- `ArticlePage` hardcodes authenticated `apiFetch()` and records an open with a POST ([src/web/App.tsx:321](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/App.tsx:321), [src/web/App.tsx:366](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/App.tsx:366)).
- `Reader` always loads private comments and chat anchors ([src/web/App.tsx:649](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/App.tsx:649), [src/web/App.tsx:675](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/App.tsx:675)).
- It always fetches glossary terms through the private endpoint ([src/web/App.tsx:723](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/App.tsx:723)).
- Glossary, summaries, ideas and tweets mount `useJobs`, which polls the private job list indefinitely ([src/web/useGlossary.ts:163](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useGlossary.ts:163), [src/web/useSummaries.ts:121](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useSummaries.ts:121), [src/web/useIdeas.ts:118](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useIdeas.ts:118), [src/web/Tweets.tsx:132](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Tweets.tsx:132)).
- Metadata mounts editing, deletion, profile and authenticated provenance behaviour ([src/web/Metadata.tsx:283](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Metadata.tsx:283), [src/web/Metadata.tsx:297](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Metadata.tsx:297)).

Stage 1 needs an explicit access/capability layer: public data sources, no comments/chat/jobs/profile hooks, no record-open POST, and read-only presentation components shared with the real reader. “One reading view” remains correct; “one boolean prop” is not a sufficient plan.

### 3. BLOCKER — Stage-1 CDN caching defeats “turn sharing off”

The proposed `public, s-maxage=…` response can continue serving the article after `visibility` becomes private. It can also cache a 404 and delay a newly shared document becoming visible.

This risk is especially easy to miss because Vercel does not cache requests carrying `Authorization`; a developer testing through `apiFetch` may see revocation work while the real anonymous plain-fetch path remains cached. Vercel documents both that criterion and that expired `s-maxage` responses can be served stale while asynchronous revalidation happens. [Vercel cache documentation](https://vercel.com/docs/caching/cdn-cache)

Stage 1 should use `Cache-Control: no-store`. Add caching only with a specified invalidation mechanism tied atomically to the visibility PATCH, plus a deployed test that warms the edge, turns the document private, and proves the next anonymous request cannot receive the body. A global manual cache purge is not an adequate privacy control.

`Vary` is unnecessary if the public endpoint completely ignores authorization and cookies and always returns the same projection. Do not make one public URL return personalised responses.

### 4. BLOCKER — Two of the six proposed proofs are not currently implementable

“Enumerated from the route table” is wishful today. There is no route table: `serveApi` declares regex matches and then runs a long imperative `if` chain ([src/routes.ts:2673](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:2673), [src/routes.ts:2833](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:2833)). A source-code parser would be another fragile interpretation of routing.

Either:

- make a declarative route manifest the dispatcher’s source of truth; or
- structurally split `servePublicApi()` from `serveAuthenticatedApi()`, with the latter callable only after `requireUser`, and test that structural boundary.

Also, `/api/health` is already an intentional anonymous exception outside `handleApi` ([src/vercel.ts:187](/Users/greg/Dropbox/dev/experim/spideryarn2/src/vercel.ts:187)). It returns the owner’s article count plus extensive deployment diagnostics ([src/vercel-health.ts:647](/Users/greg/Dropbox/dev/experim/spideryarn2/src/vercel-health.ts:647)). Therefore “every route not on the public list refuses anonymous requests” is false unless health is explicitly listed as a separate exception.

The proposed static “no reachable public file imports the gateway” test also conflicts with current module boundaries: `src/api.ts` imports `glossary.ts`, `summarise.ts`, `tweets.ts` and `ideas.ts`; those modules import the model-call machinery ([src/api.ts:25](/Users/greg/Dropbox/dev/experim/spideryarn2/src/api.ts:25), [src/glossary.ts:40](/Users/greg/Dropbox/dev/experim/spideryarn2/src/glossary.ts:40)). Prefer:

- a public read module that does not import writers;
- a runtime injected gateway spy proving zero calls;
- a method sweep proving every public route rejects non-GET methods.

Missing tests include migration constraints/defaults, visibility PATCH ownership, public/signed-in requests interleaved under `AsyncLocalStorage`, deep nested projection keys, cache revocation, production URL restoration, and a browser assertion that no private endpoint and no POST is requested.

### 5. HIGH — The prefix seam is correct, but its exact control flow must be specified

The safe shape is:

- Calculate `path` without the query string as today ([src/routes.ts:2632](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:2632)).
- Treat both `/api/public` and `/api/public/…` as the namespace, following the admin lesson ([src/routes.ts:2656](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:2656)).
- Invoke the public dispatcher inside the existing `try`, before `requireUser`. Calling it above the `try` makes throws escape logging and response mapping, exactly the failure described at [src/routes.ts:2773](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:2773).
- Once inside the public namespace, unknown routes and wrong methods must terminate there. Never consult the authenticated table.
- Match public routes on `path`, not `url`, so `?` cannot change route identity.
- Decode only the captured slug, exactly once, then run the existing `slugPart` validation. Never decode the whole path. The confirmed traversal and its fix are at [src/routes.ts:1724](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:1724).
- Compose tests through production’s `originalUrl()` restoration ([src/vercel.ts:101](/Users/greg/Dropbox/dev/experim/spideryarn2/src/vercel.ts:101)).

Case variants, `//api/public`, and percent-encoded spellings currently fail closed: they either miss `/api/` entirely or reach the authenticated gate. `handleApi` being called with a non-`/api/` path returns false before any route executes ([src/routes.ts:2632](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:2632)). Those are not bypasses. The dangerous cases are whole-path decoding, public-handler fallthrough, and a slug capture that does not reuse `slugPart`.

Keeping the request ownerless is correct. `currentOwnerId()` then throws before it can fall back to the environment ([src/owner.ts:217](/Users/greg/Dropbox/dev/experim/spideryarn2/src/owner.ts:217)).

### 6. HIGH — The migration is fail-closed, but the predicate guard needs strengthening

`NOT NULL DEFAULT 'private'` plus the check constraint is the right migration. `NULL` cannot be stored; even if it somehow existed, `visibility = 'public'` would not match it. A fixed two-clause Drizzle `and()` will not drop the visibility clause merely because it uses `and()`.

Prove that with a real Postgres test and mutation control. Do not mock the query builder.

Adding `publicSlug()` inside `pg.ts` weakens the existing static guard because the test exempts that whole file ([tests/owner-isolation.test.ts:181](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/owner-isolation.test.ts:181)). Tighten it to recognise exactly:

- owner-filtered `ownedSlug`;
- visibility-filtered `publicSlug`;
- boolean-only `slugIsTaken`.

The public predicate must be part of the query returning the row, not a preliminary boolean check followed by an unfiltered read.

Use a separate owner-only sharing endpoint rather than adding visibility to `PATCH /api/library/:slug`. Visibility belongs to the shared work, while that route currently edits shelf state ([src/store/pg-shelf.ts:45](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-shelf.ts:45)). Keeping those apart avoids moving the API again in stage 3.

### 7. HIGH — Stage 3 has the right normalization, but the wrong ownership story

A shared `articles` work row plus per-reader shelf relationships is the correct long-term shape. It is not merely “change `ownedSlug()` to a join.”

The work still needs a controller who can change visibility, re-extract it and run paid jobs. If `owner_id` simply moves to `shelf_entries`, every shelf holder either becomes a work owner or nobody does. Retain a `created_by`/`managed_by` authority on the article, or introduce an explicit maintainer relationship.

Reader-state tables also require real migration. Today their queries resolve an owned article and then filter children by `article_id` alone; the stored `owner_id` is not read ([docs/project/auth.md:326](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/auth.md:326), [src/store/pg-comments.ts:47](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-comments.ts:47)). Once two readers share one article ID, that invariant disappears. Comments, chats, searches and lookups must reference a shelf-entry identity or use enforced composite owner/article keys.

The cheaper conversion step is a small `saved_public_articles(owner_id, article_id)` bookmark table. It can put the document on the new user’s shelf while keeping it read-only and sending reads through the public API. Notes and chats wait for the full stage-3 migration.

Stage 1’s visibility column and global slug do not obstruct this. Putting visibility into the library PATCH would.

### 8. HIGH — The stage-4 variant key is insufficient

`(revision_id, kind, profile_hash)` does not describe all generation inputs:

- Summaries also vary by the owner’s free-text `guidance` ([src/summarise.ts:717](/Users/greg/Dropbox/dev/experim/spideryarn2/src/summarise.ts:717)).
- Tree and arc deliberately do not vary by reader profile ([docs/project/reader-profile.md:88](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/reader-profile.md:88)).
- A plain artefact currently stores `profileHash: null`, which deliberately means “never profile-stale” ([src/profile.ts:236](/Users/greg/Dropbox/dev/experim/spideryarn2/src/profile.ts:236)). Replacing it with a non-null empty-profile hash changes that behaviour.
- The key does not say which variant the owner currently sees, which variant a public visitor gets, or how legacy `undefined` provenance migrates.
- `existingFor()` requires exact profile equality before appending glossary entries ([src/glossary.ts:359](/Users/greg/Dropbox/dev/experim/spideryarn2/src/glossary.ts:359)). It must operate on the row selected for the incoming variant, not on “the latest glossary.”
- Glossary entry IDs and `glossary_lookups(article_id, entry_id)` need a cross-variant identity rule. Otherwise a lookup may attach to the wrong variant or disappear when variants switch.

Use a non-null `variant_key` derived from all relevant generation inputs, while retaining the current nullable `profileHash` provenance inside the artefact. Define selection and migration rules before choosing the table key. Existing personalised rows cannot magically become the default variant; stage 4 needs an explicit “no default exists” state.

### 9. HIGH — Stage 2 is larger than “a small function”

Stage 1 is coherent with global `noindex`; that is the right rollout order. The statement that “no crawler finds it” is false: `noindex` is a request about search results, not secrecy or discovery.

Stage 2 must:

- route `/read/:slug` to a function before the generic SPA rewrite currently sending everything to static `index.html` ([vercel.json:23](/Users/greg/Dropbox/dev/experim/spideryarn2/vercel.json:23));
- load and serve the actual built shell and hashed asset references;
- query only through `publicSlug`;
- emit private/default head content for a private slug;
- HTML-escape untrusted extracted titles and model gists;
- validate canonical and image URLs;
- dynamically decide `X-Robots-Tag`.

A static “public reading path” header rule cannot work because public and private documents share the same `/read/:slug` path shape. The global header currently applies to everything ([vercel.json:16](/Users/greg/Dropbox/dev/experim/spideryarn2/vercel.json:16)). Robots policy therefore has to follow the database visibility decision, and the deployed response must be tested for duplicate or surviving `noindex` headers.

Stage 2 is not a prerequisite for basic sharing, but it is a prerequisite for the already-decided marketing/link-preview claim.

### 10. HIGH — Republishing full text is a material rights and source-confidentiality risk

Canonical tags and `noindex` do not provide permission to reproduce an article. EU law gives rights holders exclusive reproduction and public-making-available rights; US guidance likewise treats limited quotation and full reproduction very differently. [EU Directive 2001/29/EC](https://eur-lex.europa.eu/eli/dir/2001/29/2001-06-22/eng/pdf), [U.S. Copyright Office fair-use FAQ](https://www.copyright.gov/help/faq/faq-fairuse.html)

This does not make the product decision impossible, but it needs to be named before marketing/indexing:

- a takedown and rapid unpublish path;
- contact information for complaints;
- a record of who enabled sharing and when;
- explicit confirmation that the person has authority to republish;
- special attention to paywalled pages, signed URLs and uploaded/private PDFs.

`public_at` alone is not an audit log. If it is cleared on unshare, history disappears; if retained, it does not say whether the document is currently public.

### 11. MEDIUM — Remaining abuse and privacy controls

Public full-article GETs need response-size limits, database timeouts and a rate-limit/WAF decision. CDN caching cannot be the abuse control while revocation semantics remain undefined.

Add an explicit `Referrer-Policy`. The public slug is not secret, but the page URL may carry reading position and other query state; the original source URL may also contain sensitive query data. The claim that there is “nothing to leak in a referer” is too broad.

A document already delivered cannot be clawed back when sharing is switched off. The honest promise is: future requests are refused immediately; an already loaded page may retain bytes in memory. The UI can react to later 404s, but it cannot revoke what the browser already received.

## Stage-1 conclusion

After findings 1–4 are repaired, stage 1 can ship without stages 2–4:

- Keep global `noindex`.
- Use `no-store`, not CDN caching.
- Keep the public request ownerless.
- Use explicit public projections.
- Give the shared presentation a capability-aware public data source.
- Test the actual signed-out network trace.

No files were changed and no test suite was run; this was a read-only plan review.

