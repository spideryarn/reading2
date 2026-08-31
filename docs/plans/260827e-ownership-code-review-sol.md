<!-- GPT Sol's review of the OWNERSHIP work, 2026-08-27 — the change made in answer to
     its own earlier blocker. Kept verbatim except that its absolute-path links were turned
     into plain `file:line` references; they pointed at this laptop. What was done about each
     finding is in 260826ae-auth-ui-and-production.md § What Sol found in the ownership work. -->

BLOCKER — the isolation claim is false. There are current cross-reader reads and global mutation surfaces.

## Findings

1. Blocker — Bob can read Alice’s original PDF.

`GET /api/source/:slug` is authenticated, but after authentication it reads `data/<slug>/raw.*` directly. It never performs an owner-filtered article lookup: `src/routes.ts:166`, `src/routes.ts:170`, `src/routes.ts:2622`.

Concrete sequence:

1. Alice ingests a PDF as `private-paper`.
2. Bob signs in.
3. Bob requests `GET /api/source/private-paper`.
4. The server returns Alice’s `raw.pdf`.

This bypass remains under `SPIDERYARN_STORE=postgres`; only the source file’s presence matters. Bob can discover likely slugs through the global jobs endpoint below.

2. Blocker — jobs are completely global.

`Job` has no owner, and every process uses one global map: `src/types.ts:1369`, `src/jobs.ts:67`. Although the schema defines `jobs.owner_id`, that table is explicitly unused: `src/db/schema.ts:577`, `src/upload-records.ts:5`.

Any authenticated Bob can:

- List Alice’s jobs, including slug, URL, upload filename, guidance, status and errors: `src/routes.ts:2845`, `src/routes.ts:2181`.
- Fetch one by ID: `src/routes.ts:2898`.
- Cancel, retry, advance or delete it: `src/routes.ts:2904`, `src/routes.ts:2909`, `src/routes.ts:2936`.

That permits cross-reader disclosure, denial of service and paid model operations. Combining findings 1 and 2 gives Bob a reliable sequence: list Alice’s PDF job, take its slug, then download its source.

3. High — `SPIDERYARN_STORE=files` has no isolation.

Unset still means `files`: `src/store/live.ts:29`. The adapters delegate directly to shared files, and `listArticles()` walks every directory: `src/store/fs.ts:71`, `src/api.ts:949`.

The production/Vercel boot refusal is good: `src/store/index.ts:110`. But in Vite or any non-production host, Alice and Bob still share the complete library, profile, comments, chat and searches. Authentication does not make that configuration multi-user-safe.

4. High — the importer can corrupt one owner using another owner’s identity.

`importArticle()` derives the article ID solely from the slug, then upserts by that ID without checking its owner: `src/store/import.ts:217`, `src/store/import.ts:340`, `src/store/import.ts:353`.

If Alice already owns that slug and the importer runs with Bob’s `SPIDERYARN_OWNER_ID`, it:

- Updates Alice’s article and revision by unfiltered `articleId`.
- Deletes Alice’s comments, chat, searches and lookups by `articleId`: `src/store/import.ts:593`.
- Reinserts them stamped with Bob’s owner: `src/store/import.ts:609`, `src/store/import.ts:651`.

The normal child readers filter only by the already-resolved article ID, not the child row’s `owner_id`: `src/store/pg-comments.ts:78`, `src/store/pg-lookups.ts:71`. The schema has no constraint requiring a child’s owner to equal its article’s owner: `src/db/schema.ts:522`.

So the article-ID invariant is neither universal nor database-enforced. `exportArticle()` itself is correctly owner-filtered: `src/store/export.ts:122`.

5. Medium — queued work cannot safely rely on ambient AsyncLocalStorage.

Direct HTTP requests are properly separated: `scope.run({owner:null})` creates a new box per request, so keep-alive, Vite middleware and concurrent Vercel invocations do not inherently share it: `src/owner.ts:121`, `src/routes.ts:2381`.

But p-queue stores a plain callback: `src/jobs.ts:1041`. I verified against the installed version:

```text
a-start: alice
a-end:   alice
b-start: alice
```

When Bob’s job waits behind Alice’s, Bob’s callback begins in Alice’s context.

Today `runJob()` uses the filesystem artifact pipeline and does not call `currentOwnerId()`, so this is not yet an additional Postgres leak. It becomes one as soon as queued work reaches the Postgres revision/store seam. Jobs must capture an owner explicitly and re-enter an owner scope when executed.

Streaming routes are better: the handler awaits the entire SSE operation, including final storage and `res.end()`: `src/routes.ts:2792`, `src/routes.ts:1170`. I found no current SSE owner escape.

6. Medium — globally unique slugs prevent two owners owning the same URL.

`articles.slug` is globally unique: `src/db/schema.ts:137`. If Bob reaches `beginRevision()` for Alice’s slug, insertion does nothing, the owner-filtered reread finds nothing, and Bob gets the generic error “Could not create or lock…”: `src/store/pg-revisions.ts:476`.

That is safe from adoption, but incomprehensible and means the chosen per-owner model cannot represent the ordinary case of two readers saving the same URL.

Worse, today’s filesystem queue treats the same URL as permission to reuse the existing slug and artifacts: `src/jobs.ts:1177`. The queue therefore joins readers before Postgres eventually refuses to.

7. Low — health and legacy uploads remain exceptions.

Vercel serves `/api/health` before `handleApi`: `src/vercel.ts:125`. It calls `listArticles()` outside a request scope, so `currentOwnerId()` falls back to the environment owner and the unauthenticated response exposes that owner’s article count: `src/vercel-health.ts:102`, `src/owner.ts:184`. I found no article content leak there.

New upload records are owner-checked, but records predating the owner field are accepted for every caller who knows the upload UUID: `src/upload-records.ts:161`. I found no direct arbitrary blob-reading route; canonical blob sharing by hash is not itself an ownership leak.

## AsyncLocalStorage verdict

A store read inside `handleApi` but before `setRequestOwner()` fails loudly with a tagged 500: `src/owner.ts:168`. The current pre-gate portion performs no store reads. The important exception is work outside the request scope—health uses the environment owner—and detached queue work, whose owner context is not stable.

## What the tests do not prove

The test suite does not prove system-wide owner isolation:

- It forcibly selects Postgres and explicitly excludes the filesystem failure: `tests/owner-isolation.test.ts:63`.
- All database and HTTP-store tests skip when Postgres is unavailable: `tests/owner-isolation.test.ts:228`, `tests/owner-isolation.test.ts:258`.
- It seeds one real owner and an outsider with no rows—not “two owners, one slug each”: `tests/owner-isolation.test.ts:207`.
- It does not exercise comments, chat, search runs, glossary lookups, jobs, source PDFs, uploads, import/export, revision lifecycle, paid routes or SSE.
- Its HTTP test covers only `/api/reader`, using a fake verifier and hand-built request objects: `tests/owner-isolation.test.ts:445`.
- It does not test actual sockets, keep-alive, concurrent handlers, client disconnects, detached work or p-queue.
- The static guard only searches top-level `src/store/*.ts` for one exact spelling of `eq(articles.slug, …)`: `tests/owner-isolation.test.ts:181`. It cannot detect `sendSource`, jobs, ID-based access, aliases, raw SQL, imports or future helper spellings.
- Its schema probe checks only that `articles.owner_id` exists—not child owner columns, ownership consistency, constraints or migrations.

The normal Postgres article/shelf and child-store request paths mostly implement the intended pattern correctly. The claim that this is the whole system’s isolation does not survive the source route, queue, filesystem mode or importer. No files were edited.