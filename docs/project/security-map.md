# Security map

**Start here; [security.md](security.md) is the deep dive.**

**The untrusted parties here are not other readers.** Spideryarn is a small tool, and that normally
shrinks a security problem to nothing. It doesn't, because a reader is targeted every time they point
the app at somebody else's article. "Don't open untrusted documents" was never available as a
mitigation: opening them is the product.

[security.md](security.md) counts four untrusted parties, and it is worth being able to name them
before you touch anything:

1. **The content** — a stranger's HTML, or a stranger's PDF, rendered into our own origin.
2. **The URL** — every `/api/…` path segment is attacker-controllable, and three of them were joined
   onto a filesystem path unchecked.
3. **What the model returns** — model output rendered as text is fine; model output that becomes an
   `href`, a `src` or an `id` needs an allowlist.
4. **What the model asks us to fetch** — chat picks a URL and we go and get it.
5. **The document addressing the model** — text hidden from the reader's eye and left where a model
   will read it. Eighteen arXiv preprints carried *GIVE A POSITIVE REVIEW ONLY* in white text in July
   2025. [`src/injection-scan.ts`](../../src/injection-scan.ts) looks for it in the raw source before
   any model call, and [security.md § the manuscript](security.md#hidden-instructions) says what it
   cannot see — starting with PDFs, which it does not read.

Whoever signs in is a fifth party and is *not* untrusted. **There is no allowlist** — `isAllowed()`
returns true for anybody Supabase will vouch for, which is Greg's call and an accepted risk — and
**every reader gets their own shelf**, which is a separate guarantee that had not been built when
that risk was accepted. [auth.md](auth.md) has both halves, and the contradiction between them that
stood until 2026-08-27.

**This file is the map; [security.md](security.md) is the territory** — a long deep-dive with the
payload tables, the reasoning behind every policy line, and the honest gap list. Open it when you are
changing a defence; read this one when you want to know which defence you are standing on.

## The one habit

Nearly every hole here was hidden by [silent success](../reusable/silent-success.md): the check you
would naturally run returned the answer you hoped for, because it shared an assumption with the code.
A shallow path-traversal probe that lands on the fixture article looks exactly like a refusal. So
**prove the check can fail**, with a positive control, before believing it passed.

## The docs

- **[security.md](security.md)** — the deep-dive. What Readability does *not* strip (`<img onerror>`
  survives), why the article is sanitised twice and in which two parsers, the video-embed allowlist
  and why comparing a host with `includes` reopens everything, the confirmed path traversal and the
  fixture fallback that disguised it, the PDF parsed unsandboxed — and a **known gaps** list at the
  end, which is where to look if you want work.
- **[auth.md](auth.md)** — the gate. Why auth here is about an open proxy and an open wallet rather
  than user accounts, why Supabase Auth won, the four things to know before touching it (a 401 is
  not "the session is gone"; JWKS unreachable is a 503), **whose data is whose** now the shelf is no
  longer shared, and the one test that has to exist.
- **[admin.md](admin.md)** — the one request that reads across owners, and how narrow the exception
  is: one route, one path prefix, one address. Which of its three refusals is a gate and which two
  are courtesies, why the check is on the prefix rather than the route, and what the page
  deliberately does not show.
- **[billing.md](billing.md)** — money, and the two things it is really about here. Card details
  never reach this server at all (hosted Checkout and Portal, opaque ids only), and the ingest
  quota is an **abuse boundary against model spend** rather than an invoice — so the interesting
  part is what stops a script firing twenty concurrent requests at a free account, which turns out
  to be one `insert … on conflict do nothing` in front of a `for update`. Also where test and live
  mode are kept apart, in three places, all keyed on the credential's own prefix.
- **[deployment.md § Who can reach it](deployment.md#who-can-reach-it)** — the app is readable by
  anybody with the address, deliberately, and it was an accident first: Vercel's protection setting
  reports itself as enabled while serving the world.
- **[chat-tools.md § Security](chat-tools.md#security-a-tool-result-is-data-and-one-of-them-is-a-strangers)**
  — the fence around a stranger's web page, and the claim that was wrong: a read tool can still
  *send*, because a GET's URL is a channel.

Each of these owns a defence too: [fetching.md](fetching.md) (the scheme allowlist, the address
guard, the redirect limit, the size cap — everything else borrows them),
[content-extraction.md](content-extraction.md) (what stage 2 does and does not promise),
[ingest-queue.md](ingest-queue.md) (`/add/<url>` makes us fetch on arrival, not on a click),
[logging.md](logging.md) (never log prose, never log a secret),
[block-ids.md](block-ids.md) (the `id` attribute the sanitiser must not touch).

## Where the defences physically live

An agent about to edit one of these is editing a defence, not a helper.

| | |
|---|---|
| [`src/sanitize-policy.ts`](../../src/sanitize-policy.ts) | **one policy**: DOMPurify config, embed allowlist, hooks. Node-free, so both bindings share it |
| [`src/sanitize.ts`](../../src/sanitize.ts) | the server binding, called from stage 3 in [`src/blocks.ts`](../../src/blocks.ts) — cleans the stored artefact |
| [`src/web/sanitize.ts`](../../src/web/sanitize.ts) | the browser binding, at article ingress in [`article/access.ts`](../../src/web/article/access.ts) § `resolveAccess` — guards the render. **Policy only**: it must stay byte-for-byte what the server binding produces, and `tests/sanitize-client.test.ts` says so |
| [`src/web/external-links.ts`](../../src/web/external-links.ts) | not a defence, but it *rests* on one: `target="_blank" rel="noopener noreferrer"` on every outbound link, written at ingress **after** the sanitiser has stripped the author's own `target`. It lives outside the sanitiser for the reason in the row above |
| [`src/routes.ts`](../../src/routes.ts) | `slugPart()` for every capture that becomes a directory name; the one `requireUser` call |
| [`src/slug.ts`](../../src/slug.ts) | what a slug may be — two rules, one per question (mint? read?) |
| [`src/auth.ts`](../../src/auth.ts) | the gate: `requireUser`, and `isAllowed` |
| [`src/store/pg.ts`](../../src/store/pg.ts) | `ownedSlug()` — keeps one reader's shelf out of another's |
| [`src/asset-delivery.ts`](../../src/asset-delivery.ts) | `storedAssetFor()` — **the storage key is rebuilt from this article's own manifest entry, never from the caller's string.** The bucket is content-addressed and shared by every article and every reader, so a route that concatenated a caller's hash into a key would be an arbitrary-object read. A hash absent from this article's manifest is a 404 **even for its owner**. Both `GET /api/asset/…` and its public twin go through it. See below |
| [`src/fetch.ts`](../../src/fetch.ts) | scheme allowlist, `isBlockedAddress`, redirect limit, size cap |
| [`src/ingest.ts`](../../src/ingest.ts) | `normaliseUrl` — refuses literal private and loopback hosts before queueing |
| [`src/chat-tools.ts`](../../src/chat-tools.ts) | `isSlug` on the model's slug, URL-length cap on the model's URL |
| [`src/urls.ts`](../../src/urls.ts) | `isWebUrl` — what model output must pass to become an `href`; `carriesCredential` — what may not be written into an ownerless cache; `requestTarget` — what a GET actually asks for, and never `urlKey` |
| [`src/link-previews.ts`](../../src/link-previews.ts) | **the one endpoint a reader's *pointer* can make us fetch a stranger's page with.** Its defence is not the gate but the scope: the caller must own the article *and* the article's own extracted links must contain the URL, before anything is fetched or spent. Authentication alone would make it an open proxy. Plus `fetchDocument`'s complete envelope, a credential refusal, and a per-owner limiter. [links.md](links.md#what-our-own-server-can-reach) |
| [`src/link-summary.ts`](../../src/link-summary.ts) | **the one place a stranger's page reaches a model.** Same scope as the row above — own the article, and the URL must be in it — plus the fencing: explicit untrusted-content markers, a system rule that the page is data and never a request, a reminder on the far side of it, every run of `===` rewritten so a page cannot close its own fence, and **no tools on the call**, so there is nothing for an injected instruction to reach. Its own limiter bucket, with a day and a global fuse, because this one spends money. [links.md](links.md#and-what-it-has-to-do-with-the-piece-in-your-hands) |
| [`src/injection-scan.ts`](../../src/injection-scan.ts) | hidden text in the raw source, found before the model reads it. It reports and decides nothing, and it does not read PDFs |
| [`src/public/routes.ts`](../../src/public/routes.ts) | **the one namespace with no gate in front of it** — dispatched before `requireUser`, read-methods only, no owner ever set. See below |
| [`src/public/dto.ts`](../../src/public/dto.ts) | **the allowlist, as code** — every key a stranger receives, constructed rather than filtered. See below |
| [`src/store/public-slug.ts`](../../src/store/public-slug.ts) | `publicSlug()` — slug **and** `visibility = 'public'`, the one ownerless *lookup* |
| [`src/store/public-library.ts`](../../src/store/public-library.ts) | `publicLibraryQuery()` — the one ownerless *listing*. See below |
| [`src/web/PublicLibraryPage.tsx`](../../src/web/PublicLibraryPage.tsx) | the page that draws it — **the only defence it holds is which route it asks**. See below |

The tests are the specification: `tests/sanitize.test.ts`, `tests/sanitize-client.test.ts`,
`tests/routes.test.ts`, `tests/slug.test.ts`, `tests/owner-isolation.test.ts`,
`tests/public-dto.test.ts`.

### The unauthenticated namespace, and the tripwire under it

Everything else on this page is a defence in front of a gate. `/api/public/` is the one surface
**dispatched before the gate**, so a stranger reaches it with no token at all
([260827ai-public-read-only-access.md](../plans/260827ai-public-read-only-access.md) is the plan; the code documents
itself thoroughly and is worth reading before touching). Four things keep it a closed room, and each
was checked against the source rather than taken on trust:

- **No fallthrough into the authenticated table.** An unknown path or a wrong method inside the
  namespace is answered *here*. The file names this as "the single most likely way this feature
  grows a hole", and the bare path is inside the namespace too — otherwise it would fall through and
  answer 401 where it should answer 404.
- **Read methods only**, via `requireReadMethod`.
- **No owner is ever set in that scope.** `setRequestOwner` is not called, so `currentOwnerId()`
  *throws* rather than quietly returning somebody. That is a **runtime tripwire**, not a
  convention — a stray owner-scoped read on this path fails loudly instead of succeeding against
  the wrong person's data. Compare `src/owner.ts`, where the environment variable deliberately
  "does not get a vote" inside a request, which closed a real historical hole and is pinned by
  `tests/owner-isolation.test.ts`.

  **A scope has to be open for that to be true, and until 2026-09-02 one was not on the HTML
  page.** The tripwire needs `runInRequest`, and `handleApi` opens it for `/api/public/` only;
  `/read/:slug` was served beside it, where `currentOwnerId()` finds no box and returns the
  *environment* owner instead of throwing. Both doors are wrapped now, both in `src/vercel.ts` —
  there rather than in `src/public/page.ts`, which would pull `src/owner.ts` into the import graph
  `tests/public-imports.test.ts` keeps closed. `tests/public-page-request-scope.test.ts` is the
  page's half.
- **Hand-built allowlist DTOs**, below.

#### And since 2026-09-04 there is a second ownerless query, which enumerates

`GET /api/public/library` lists every public article, for somebody who has named nothing. That is a
different risk from `publicSlug`, and the difference is worth stating rather than assuming: a lookup
hands one article to a caller who already knew its slug — and every slug minted since 2026-08-31
ends in an unguessable short id — while a listing answers *what is there*. A wrong predicate on the
lookup leaks the article somebody was already asking for; a wrong predicate on the listing publishes
the shelf.

`publicLibraryQuery` ([`src/store/public-library.ts`](../../src/store/public-library.ts)) is
therefore a **closed query rather than a reusable predicate** — there is no exported
*"visibility is public"* clause for anybody to bolt onto another query — and it carries the same
readability bar as `loadArticle`/`loadHead` (a tree and at least one block), so a damaged revision
cannot become a card whose destination 404s. It selects eight named columns, orders totally, and is
bounded. Every one of the eight is a fact about the *document* — the eighth, added the same day, is
`byline`, the author the publisher's own page declared. Nothing in the projection names the reader
who shared it.

**The existing static guard could not have caught a bad one.** `tests/owner-isolation.test.ts` greps
`src/store/` for `eq(articles.slug, …)`, and a listing has no slug in it. That file now has a second
section, *ownerless enumeration*, which inventories every query naming the `articles` table
reachable from the public import graph, permits exactly two, reads the listing's **generated SQL**
for the public predicate and the absence of `owner_id`, pins its eight columns, and runs it against
two owners over private, public-readable and public-but-unreadable rows. Each of those was watched
failing against a deliberately broken query before it was believed.

**And the guard covers the corridor as well as the room, since 2026-09-04.** A GPT Sol review of the
built code found the hole one level up: a request runs the transport before either public door, so a
query written into `serveApi`'s pre-auth dispatch or `serve`'s wrapper would be reachable by a
stranger and invisible to a graph rooted at `src/public/`. So the guard also cuts each transport's
**anonymous region** — the dispatcher minus the one call that hands off to the authenticated half,
which keeps the `catch` and the `finally` inside it — and asserts that region names no table and
imports nothing outside a short pinned list. The list of transports is *derived* by asking which
modules import a public entry point, so a third one fails the guard rather than escaping it. The
detector parses ([`tests/helpers/article-queries.ts`](../../tests/helpers/article-queries.ts)) rather
than matching `.from(articles)`, because a table alias, a relational query and raw SQL all walked
past the regex it replaced.

**A row bound is not a byte bound**, and the same review said so. Nothing constrains a title or an
`<h1>`, so the listing's projection caps every text column it returns with `left()` **in the SQL** —
after the rows are built it is too late, the bytes have crossed. `PUBLIC_CARD_CHARS` in
[`src/store/public-library.ts`](../../src/store/public-library.ts) holds the numbers, and a fixture
with a 5,000-character title, gist, site name, byline and `<h1>` measures them. A partial index
(`articles_public_listing`, `drizzle/20260904175802_*`) covers `visibility = 'public'` in the
listing's exact order, so `limit` bounds the database's work and not only the reply.

It also refuses to work at all on the filesystem store — `requirePostgres()` answers 501 — so a
misconfigured dev server cannot serve a half-implemented public path.

#### And since 2026-09-06 there is a third ownerless read, which hands back bytes

`GET /api/public/asset/:slug/:hash.:ext` serves the pictures a shared article came with —
its own images and, on a paper, the figures recovered from the PDF
([article-images.md](article-images.md#delivery-and-what-is-actually-switched-on)). It is the first
thing in this namespace that answers with **bytes from a bucket** rather than a projection of a row,
so the allowlist-DTO discipline above has nothing to say about it and a different rule carries the
weight:

- **The key is rebuilt from the manifest entry**, per the `src/asset-delivery.ts` row above. The
  bucket is content-addressed and shared, so the caller's hash is used to *look up* and never to
  *build*. Without that rule, a visitor naming any hash they had ever seen would read the object.
- **`null` is the same 404 as an article nobody shared.** A visitor who names a real hash belonging
  to somebody's private article must not be able to tell it from a hash of nothing — content
  addressing puts both in one bucket, and which of the two it is, is exactly the fact worth hiding.
- **Un-sharing takes effect on the next request**, because the visibility question is re-asked per
  request and `serveApi` has already set `no-store` across the namespace. The owner's twin caches
  `private, max-age=31536000, immutable` instead; the objects are content-addressed, so the two
  answers are the same bytes under different rules about who may keep them.
  `tests/asset-route.test.ts` fetches one slug, un-shares it and fetches again, which is the shape a
  memoised public projection would have quietly broken.

#### And since 2026-09-04 there is a page over it, which holds one defence

`/read/public` ([public-shelf.md](public-shelf.md), `PublicLibraryPage` in
[`src/web/PublicLibraryPage.tsx`](../../src/web/PublicLibraryPage.tsx)) is now the **third**
signed-out surface, after `/read/<slug>` and the marketing pages. A page is not where the predicate
lives and it must not become one, so the only thing it can get wrong is worth naming exactly: **a
page can leak a private article in one way, by asking for one.** The listing route cannot answer with
one whatever happens to it later; an owner-scoped route asked from this page would.

So the guard is an inventory rather than an absence — `tests/public-shelf-page.test.tsx` records the
page's whole conversation with the server and asserts it is one request, to `/api/public/library`,
with `credentials: "omit"`, no `Authorization`, and **no call into the auth module at all** (that
module is stubbed wholesale, because a mount effect reaching for a session would make no request and
leave a URL list looking clean). It asserts the same request signed in as signed out, which is the
rule the whole namespace follows and is the property the obvious "improvement" — enrich the page for
somebody who has an account — would break. A test that seeded a private article and looked for its
title in the DOM would have gone green the day somebody swapped the loader for `useShelf`.

**The inventory is of the page's requests, not of the tab's, and that is a known hole rather than an
oversight.** Production mounts `App`, which initialises a session and starts the job service before
it reaches this branch, so an `App` arm that later wrapped this page in something owner-scoped would
leave every assertion green. GPT Sol raised it reviewing the built page, 2026-09-04; closing it needs
a suite that renders `<App />` and **nothing in `tests/` does**, so it is recorded as the next guard
rather than half-built. It is a gap in the guard and not a disclosure: today's branches render this
page and nothing else.

**The page shows the shelf is not the catalogue**, which is a smaller point and still worth one
sentence: its own copy says an article that is not listed is one nobody has shared, so a reader
cannot mistake absence for concealment. [privacy.md](privacy.md) is what an owner is told.

**Diagram used to be deliberately *not* here, and since 2026-09-04 it is.** `POLICY` marked it
owners-only unconditionally, because its pictures POST for embeddings and spend money. What changed
is not the cost of those pictures but that the panel now takes a `DiagramAccess` union
([`DiagramPanel.tsx`](../../src/web/DiagramPanel.tsx)): a visitor's arm pins `?diagram=` to the free
picture and disables **three** fetching hooks. The third, `useSketchCaption`, had no `enabled`
argument at all — for an owner there is no purchase to gate — so it was an unconditional GET to an
authenticated route on every mount, and an audit of the other two would have missed it.
[260904c](../plans/260904c-more-modes-on-a-shared-link.md) § Stage 2.

**The server-side gate is unchanged and is still the defence**: `/api/similar/:slug` and
`/api/projection/:slug` sit behind `requireUser`, and the sketch and illustrated jobs behind it too.
What has changed is that the **client-side pin is now load-bearing rather than a courtesy** — it is
what stops a pasted `?diagram=trail` mounting a picture that would buy something, and
`tests/public-network-trace.test.tsx` asserts once per picture that arriving at each of the five
spends nothing. Removing the pin turns two of those red, which was checked rather than assumed.

**The experimental-features switch is not a gate of any kind**, and must never be relied on as one.
Since 2026-09-04 it decides how many Diagram picture chips an *owner* is shown
([experimental-features.md](experimental-features.md)); nothing on the server reads it, a hidden
chip's picture is still reachable by URL on purpose, and no server handler consults it. It changes
discoverability, not authority.

> **The hazard this section is really about, restated now that the sharing is built.** Diagram is in
> every reader's bar since 2026-09-04, with only Sketch chipped for a reader who has not turned the
> switch on. That is an *owner* change: a visitor is still pinned to free Force, and
> `tests/public-network-trace.test.tsx` asserts an owner arriving at `?mode=diagram` POSTs nothing.
>
> The constraint the next person inherits is unchanged and is the important sentence here: **a
> Sketch shown to a visitor has to be a stored artefact in the payload, never a job a visitor can
> start.** Sketch reaches its ~$0.20 cost through `useSketch`'s auto-runner and `armActivation`,
> not through the two POSTs named above, so an audit that checks only those two would clear it
> wrongly — which is the same shape of mistake as `useSketchCaption` above.

**That was built later the same day, and this is where the boundary now is.** A visitor's picture is
the Sketch, out of the payload (`PublicSketch`), and `useSketch` is mounted in exactly one component
— `OwnerSketch` — which the visitor arm of `SketchAccess` never reaches, because that arm **has no
slug in it**. `SketchView` was split into that owner half and a presentational `SketchBody` for this
reason and no other: a `readOnly` prop would have left the auto-runner mounted for a stranger.
`profileHash` is the field to notice not crossing — it is who the drawing was made for.

The check that would fail if this were undone is
`tests/public-network-trace.test.tsx`: handing every reader `{ kind: "owner", slug }` turns eleven
of its tests red, and the failure output shows a visitor being offered *$0.20* and *Draw the
argument*. Verified by doing it, 2026-09-04.


### The owner is shown the inventory before they publish

The Access & Sharing confirmation lists **what a shared link carries, what would go out if it were
built, and what stays** — the third bucket being the honest one, because building a glossary later
on an already-shared article publishes it and asks nobody. The list is *derived*, not written:
[`src/web/shared-inventory.ts`](../../src/web/shared-inventory.ts) sweeps `MODES` through
`visitorGap`, the same function the reading view's dimmed buttons come from, so a mode added next
month appears on the withheld side whether or not its author opens the file. Only the rows that are
not modes at all are prose — the text, the pictures, the provenance and, since 2026-09-04, **the
owner's comments**; the lookups, profile, rename, uploaded file and the cost of it all; and the
**arc and the tweet thread**, which cross like an artefact but have no mode to be swept.

**The comments row moved from the withheld side to the shared side**, and it is the only row that
ever has ([260904c](../plans/260904c-more-modes-on-a-shared-link.md) § Stage 3). Two kinds of
comment still never cross, and both are refused **in SQL** — `PUBLIC_COMMENTS_WHERE` in
[`public-reader.ts`](../../src/store/public-reader.ts) — rather than dropped by the projection,
because a filter in a `map` is one satisfied typechecker away from being widened:

- a **referee's** note (`criterion_id is null`). Leaving `criterionId` and `valence` out of the DTO
  does not make the row a reading note; it publishes the body of a peer review with its context
  stripped off, which is worse than publishing it whole.
- an **unfinished or failed** model call. Published without its error, its retry and its polling, it
  is an item a visitor can neither act on nor understand.

The read is `publicCommentsQuery`, which names its columns and **repeats `publicSlug` in its own
`where`** — a naked `articleId` is not authority. `comments` is the fifth table in
`tests/public-imports.test.ts`'s allowlist and the first ever added to it; that test's own comment
says what a sixth would have to prove. `tests/shared-inventory.test.ts` holds
them to `PublicArticle`'s key set with a total record, so a new field on the wire fails to compile
until somebody decides which line covers it.

**`search_runs` is that sixth, hours later** ([260904c](../plans/260904c-more-modes-on-a-shared-link.md)
§ Stage 4), and it proves the same three things: `publicSearchesQuery` names its columns, repeats
`publicSlug` in its own `where`, and refuses unfinished and failed runs in SQL
(`PUBLIC_SEARCHES_WHERE`). Greg's line was at *making* one — *"Only owner can create new searches.
Everyone else can see the ones they have already created"* — so what stops a visitor spending is a
`SearchAccess` union whose visitor arm carries none of the four verbs, plus `useSearch` being mounted
in `SearchBand` alone.

**It has a fourth thing of its own, and it is the one to know: `source_hash` is selected and must not
cross.** `isStale` turns it into a derived `stale` boolean before the DTO sees it, which makes this
the only column in the whole public surface whose presence in a `select` is *not* a promise about the
payload. Getting its inputs wrong has no symptom but a warning on every row that reads as a fact
about the article, so `tests/public-visibility-pg.test.ts` asserts a run whose fingerprint matches
comes back **not** stale — the positive control, without which a derivation hardwired to `true`
passes.

**A row that is not swept is a row that can be forgotten, and one was.** `available.arc` was
computed, sent and read by nothing for the first day, so an article with no arc listed nothing under
*not built yet* — and the comment beside the tweets line said tweets were "the one artefact with no
mode of its own", which is the mistake written out and still not seen. GPT Sol's review found it.
The tests that missed it compared all-flags-false against all-flags-true, which agrees with a
function that ignores a flag entirely; the ones there now turn on **one flag at a time**.

**The tick-box is not a rights check, and the other half of the protection is a takedown route.**
It moves responsibility onto the owner; nothing verifies that they hold the rights, and nothing
could. So since 2026-09-04 there is one place a wronged rightsholder can write —
[privacy.md § If something here is yours](privacy.md#if-something-here-is-yours), a section rather
than a page, linked from the two surfaces a stranger meets a republished article on. There is
deliberately **no** administrator path that unpublishes anybody's article: the mechanism is the
owner's own sharing switch, and a person decides.

**`StageState.done` is the wrong signal, and this is the trap.** It is
`status === "done" && isCurrent(step)`, so a **stale** artefact reports `done: false` — while
`publicArticle` carries it, because the projection reads the column and never asks whether it is
current. An inventory built on `done` tells an owner nobody has built a glossary while every visitor
is reading one. So `ArticleSharing.available` carries presence directly, computed by
`shareableArtefacts` in [`src/store/pg.ts`](../../src/store/pg.ts) from the revision row.
[260902n](../plans/260902n-the-sharing-dialog-lists-what-goes-out-and-what-stays.md).

### The allowlist has two failure directions, and only one of them is loud

[`src/public/dto.ts`](../../src/public/dto.ts) constructs a public response field by field rather
than deleting fields from the owner's one, because a denylist has to stay right about a set that
grows. That makes **default-absent** the behaviour: a new field is not public until somebody names
it here. A new *required* field stops the file compiling, which is the loud version; a new
*optional* field is silently dropped, which is the safe one.

Safe is not the same as correct. On 2026-08-29 `publicTree` had never been given `TreeNode.treatment`
— the field that says a tree node is a footnote section rather than part of the argument — so a
reader following a shared link had the whole footnotes feature reverted: the notes numbered as a
part of the piece, one blank row per endnote, the diagram drawing them as argument. Measured through
the real DTO: 1 part and 1 section for the owner, 2 and 2 for a visitor of the same article. Nothing
on the owner's side could see it, because every test ran where the field exists.

**So when you add a field that a client branches on, come here and decide.** And a note left in
`tests/public-dto.test.ts` saying what a future author must decide is worth writing — that note is
the only reason this one was found.

**The idiom is `opt(source, "key")`, and not a conditional spread.** Until the same date, an optional
field crossed as `...(x.k === undefined ? {} : { k: x.k })`. That names the key but does not check
it: spelling it `treatmnt` inside the spread **compiles clean**, because TypeScript's
excess-property check does not inspect keys contributed through a spread, and an outer `satisfies`
does not repair it. In the one file where a mis-named field means "this silently stops crossing",
the compiler was blind to exactly that mistake. `opt<T, K extends keyof T>` makes the name a checked
literal. Do not reintroduce the spread form.

---

Up: [AGENTS.md](../../AGENTS.md)
