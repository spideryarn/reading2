# Input requested: the public read-only access feature, audited

**Date:** 2026-09-02. **Asked of:** GPT Sol, via `scripts/run-codex.ts`. **Mode:** read-only. Do not
edit files. Do not run git commands that change state. Do not run `npm run db:reset`.

## What I want from you

Greg asked for an inspection of the "public read-only" feature — an owner marks an article
`visibility='public'` in the sharing card; anyone can then open `/read/<slug>` and read it, with every
artefact the owner already generated, without logging in, without being able to change anything, and
without incurring any AI cost. He wants edge cases, bugs, improvements and **product trade-offs**,
and then a plan. Four audits (two Opus, one Sonnet, one live HTTP probe) have already run; their
findings are below with what I verified. I want from you:

1. **Which of the findings you disagree with, or would re-rank**, and why.
2. **What all four audits missed.** Read the code yourself — the files are listed at the end — and
   look especially for the runtime and ordering bugs a static sweep cannot see.
3. **Your view on the product questions** in the last section. Greg will decide them; I want your
   reasoning to put beside mine.
4. **The deletion test and the YAGNI test on every fix I am about to propose** (docs/reusable/improve-the-codebase.md).
   Tell me which of them is not worth its keep.
5. **Whether the overall approach is sound** — second predicate, closed namespace, allowlist DTO,
   capability union on the client — or whether one of those should be a Tier 3 rearchitecture
   instead of a set of patches. You reviewed the original plan and returned BLOCKED on it; you have
   reviewed each built slice since. Say whether the thing that has now been built is the thing you
   endorsed.

Be specific: `file:line`, how you know, and what the fix is. Findings ranked. Under ~2500 words.

## Context to read first

- `docs/plans/260827ai-public-read-only-access.md` — the plan. Long. Read the decisions table at the
  top, "What we are deliberately not doing", "Open questions", and the Progress subsections.
- `docs/project/security-map.md` § `/api/public/`, `docs/project/auth.md`.
- `docs/reusable/improve-the-codebase.md` — the bar the plan will be held to.

## Status, as established

| Stage | State |
|---|---|
| 1a article + metadata, server and client | built, two Sol reviews closed |
| 1b glossary / ideas / quotes / tweets in the payload | built, reviewed |
| 2 slice 1 link unfurls (`/read/:slug` serves an OG head, still noindex) | built, reviewed |
| 2 slice 2 crawlable (robots / X-Robots-Tag) | not built — site is `noindex, nofollow` everywhere |
| 2 slice 3 anonymous resume | not built |
| 3 one article, many readers (`shelf_entries`, or the `saved_public_articles` interim you suggested) | not built |
| 4 variants, metered AI taste | not built |
| the delivery half of `260829b-hosting-the-articles-images.md` (a public asset route) | not built |

Explicit rejections in the plan that I am not re-proposing: widening `ownedSlug`, a third read path,
impersonating the owner, a share token in v1, public writes, an open shelf, caching before revocation
is designed, indexing before there is something to index, `personalised: boolean` on artefacts,
`stale` flags on public artefacts, a key denylist, serving `/api/source` publicly.

## Findings so far, with my verification state

Severity is mine; "proved" means I re-read the code at that location today.

### Server

**S1. `assets` crosses the allowlist by reference.** `src/public/dto.ts:461` `assets: row.assets ?? undefined`
passes the whole `Assets` object through, one field below the comment that explains why
`BlockContext` must be rebuilt field by field. `tests/public-dto.test.ts:211` types the fixture as
`Assets`, not `Required<Assets>` with `Required<StoredAsset>` entries, so a field added to
`AssetEntry` (a storage key, a job id) reaches strangers with the suite green. Today's fields are a
URL, a hash, a format, a byte count, a failure reason — nothing private. *Proved. Latent.*

**S2. The `/read/:slug` page path runs outside `runInRequest`.** `src/vercel.ts:309` calls
`servePublicReadPage` directly; only `handleApi` wraps in `runInRequest` (`src/routes.ts:5330`). Outside
a request scope `currentOwnerId()` returns `environmentOwnerId()` (`src/owner.ts:240`) rather than
throwing, so the "runtime tripwire" security-map.md describes does not exist on the page path. It is
unreachable today because `tests/public-imports.test.ts:181` forbids `src/owner.ts` in that graph — a
static guard standing in for the runtime one. *Proved. Latent.* Fix is one line.

**S3. Nothing consumes `assets`; every public article hot-links the publisher.** No
`/api/public/asset/…` route (`PUBLIC_ROUTE_NAMES` is `article`, `metadata`), `assetIndex()` in
`src/assets.ts:308` has no caller in `src/web/`, the `sources` bucket is private. So a stranger's
browser fetches every image and every lazy YouTube/Vimeo iframe from the third party. The client
audit claimed the `/read/<slug>` URL goes out as `Referer`; that is wrong — `Referrer-Policy:
no-referrer` is both a Vercel header on `/(.*)` and a `<meta name="referrer">` in `index.html:69`,
and a document policy covers `<img>` subresources. What the publisher learns is the visitor's IP and
that *something* on our origin embeds their image. *Proved absence of the route; the leak is bounded
to that.* Greg already decided on 2026-08-28: "Yes, leave it, and ship `Referrer-Policy: no-referrer`".
So the question is only whether the manifest we send is worth the allowlist exposure (S1) when
nothing reads it, and whether the asset route is worth pulling forward.

**S4. No rate limit, no statement timeout, no response cap, `no-store` on everything.** Pool `max: 5`
(`src/db/client.ts:67`). One shared slug is a free uncacheable amplifier against a five-connection pool.
The zero-spend guarantee holds (public import graph cannot reach a model-calling module). *Proved from
code, not reproduced under load.* Undecided in the plan since 2026-08-27.

**S5. `article_visibility_changes` is write-only.** Inserted at `src/store/pg-visibility.ts:118`; read by
no code in `src/` or `scripts/`. Migration 0026 went to the trouble of making the rows outlive a
deleted article so a rights complaint could be answered, and nothing can look at them. *Proved.*

**S6. Sound, checked, nothing to fix:** `parseVisibilityRequest` (extra keys refused, `rightsConfirmed`
must be literally `true` on share and absent on unshare), the row lock, the three sanctioned
`eq(articles.slug` sites and the guard that counts them, 404 identical for private and nonexistent,
canonical refuses query strings, HEAD honest, `no-store` set before dispatch so it covers every
status.

### Client

**C1. A dead button on every paragraph.** `src/web/BlockGutter.tsx:305` renders the "Chat about this
paragraph" gutter button for a visitor; `src/web/App.tsx:2312` swallows the press with `if (!owner)
return;`. The comment calls it deliberate. It contradicts the rule two other files in the same feature
wrote down ("a button that can only fail is worse than no button", `Masthead.tsx:88`). *Proved.*

**C2. Referee's visitor sentence is built from the raw mode id.** `src/web/visitor.ts:220` fall-through
passes `mode` as `feature`; `ownersOnly()` at `src/messages.ts:1321` expects a capitalised product noun.
A visitor reads "referee is for whoever added this article…" in the band and the dock tooltip.
`tests/visitor-gaps.test.ts:233` knows referee reaches the fall-through and asserts nothing about
wording. *Proved.* One entry in `COSTS`.

**C3. An owner whose token cannot be refreshed is silently reclassified as a visitor.** `findArticle`
(`src/web/App.tsx:625`) falls back to the public route on 401 as well as 404. On a public article they
see "View only" and "Make a free account" over their own document; on a private one, "Not shared".
`useSession` still says signed in, so nothing re-asks. *Proved from code, not reproduced.* I want your
view on what the right behaviour is: a 401 after the one refresh is arguably "signed out", and the
honest UI is a sign-in prompt, not a visitor page.

**C4. The network-trace test's mode sweeps are literal lists** (`tests/public-network-trace.test.tsx:485`,
`:806`) omitting plain, hierarchy, outline, quotes, timeline, referee — the two newest modes have never
been pressed in a visitor trace. `markedModes` derives from `MODES` precisely so a new mode cannot be
missed; the test that guards it does not. *Proved.*

**C5. Owner turns it off mid-session: nothing happens.** There is no post-load fetch on the visitor
path, and the article is not re-fetched on a view change. The visitor keeps reading the payload in
their tab until reload, then gets `LandingPage`. Arguably fine; the plan's first open question, still
open. *Proved.*

**C6. Sharing-card copy.** `SHARING_UNKNOWN` says "reload the page to try again" for a state that on
the files store is permanent. `CopyLink` returns silently with no `navigator.clipboard`. *Proved. Low.*

**C7. A second definition of "visitor".** `src/web/Masthead.tsx:167,248` uses `onRenamed === undefined`
to mean visitor rather than reading the capability. Correct today by accident of `OwnedArticle` always
passing it. *Proved. Latent.*

**C8. Clean:** storage does not cross the login boundary (IndexedDB keyed on user id, purged at
sign-out, `publicFetch` never touches it); phone width shows the shared notice exactly once; no
perf/Sentry beacons on the visitor path; hover cards and glossary lookups are gated; a signed-in
reader on somebody else's public article is supported and gets the visitor view.

### The trap ahead of stage 3

`comments`, `chat_threads`, `chat_messages`, `search_runs`, `glossary_lookups` carry an `owner_id`
that is written and never read; isolation rests on the unenforced invariant that a child's owner equals
its article's owner (auth.md says so). The moment two readers share one `article_id` those tables
leak into each other. Any "save to my shelf" feature — even your `saved_public_articles` interim — has
to be built so it cannot become that.

## Product questions I intend to put to Greg

Give me your recommendation on each, and say which trade-off it rests on.

**P1. The pitch on the page.** A visitor sees "View only" and a shared-article notice. Is there a
call to action worth adding — "save this to your shelf" (stage 3 interim) — and if so, is the
bookmark table the right first cut, or does that recreate the child-table trap?

**P2. Indexing.** Stage 2 slice 2 would let Google index public pages. Canonical points at the
original, so ranking value is near zero and the rights exposure is real. Is there any reason to build
slice 2 at all, or should the plan delete it?

**P3. Images.** Greg chose hot-linking on 2026-08-28 with `no-referrer`. The asset-hosting plan exists
and is half-built (storage side). Is the public asset route worth building now, or is the
right move to stop sending `assets` to visitors until it is?

**P4. Rate limiting.** Vercel's own WAF / rate limit product versus a per-IP counter in
`servePublicApi` versus a short `s-maxage` with purge-on-unshare. Which is the boring one that
survives six months?

**P5. Unlisted.** The plan defers "unlisted with a secret" to a later `visibility` value. Is there
demand-side reason to pull it forward — a link that is not *public* is what most people mean by
"send a friend a link" — or does that change the marketing framing Greg chose?

**P6. Revocation UX.** C5 above. Do nothing, poll `HEAD /api/public/metadata/:slug` every few
minutes, or re-check on tab focus? What is the least machinery that honours "unshared a minute ago
must stop being served now"?

**P7. Attribution and "share my comments too".** Both explicitly deferred. Is there anything in
the current code that makes them harder later than they need to be?

**P8. The audit table.** One read on `/admin`, or a script, or nothing until a complaint arrives?

**P9. The shelf.** The owner's library does not show which articles are public. Worth a badge and a
filter, or noise until there are many?

## Files

Server: `src/public/routes.ts`, `src/public/route-names.ts`, `src/public/dto.ts`, `src/public/page.ts`,
`src/public/page-head.ts`, `src/public-types.ts`, `src/store/public-slug.ts`,
`src/store/public-reader.ts`, `src/store/pg-visibility.ts`, `src/store/owned-slug.ts`, `src/owner.ts`,
`src/vercel.ts` (`serve`), `src/routes.ts` (`handleApi`, `serveApi`, `parseVisibilityRequest`),
`src/urls.ts`, `src/db/schema.ts`, `drizzle/0024*`, `drizzle/0026*`, `vercel.json`, `public/robots.txt`.

Client: `src/web/visitor.ts`, `src/web/reader-capability.ts`, `src/web/public-api.ts`,
`src/web/App.tsx` (`findArticle`, `resolveAccess`, `ArticlePage`, `OwnedArticle`, `Reader`),
`src/web/AccessSharing.tsx`, `src/web/PublicChrome.tsx`, `src/web/PublicPages.tsx`,
`src/web/BlockGutter.tsx`, `src/web/Masthead.tsx`, `src/web/lib/api.ts` (`apiFetch`), `src/messages.ts`.

Tests: `tests/public-dispatch.test.ts`, `tests/public-imports.test.ts`, `tests/public-dto.test.ts`,
`tests/public-reads.test.ts`, `tests/public-network-trace.test.tsx`, `tests/visitor-gaps.test.ts`,
`tests/owner-isolation.test.ts`, `tests/access-sharing.test.tsx`.
