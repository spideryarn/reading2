# Security map

**Start here; [security.md](security.md) is the deep dive.**

**The untrusted parties here are not other readers.** Spideryarn is a small tool, and that normally
shrinks a security problem to nothing. It doesn't, because a reader is targeted every time they point
the app at somebody else's article. "Don't open untrusted documents" was never available as a
mitigation: opening them is the product.

[security.md](security.md) counts six untrusted parties, and it is worth being able to name them
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
6. **The bibliographic registries** — Crossref, DataCite and OpenAlex send titles, authors and
   venues that end up on the page. Rendered as text only, and every link is built by us from an
   identifier. Lower risk than the five above (Greg, 2026-10-04: *"probably they're slightly lower
   risk"*). [security.md § registries](security.md#registries).

Whoever signs in is a seventh party and is *not* untrusted. **There is no allowlist** — `requireUser`
admits anybody Supabase will vouch for, which is Greg's call and an accepted risk — and
**every reader gets their own shelf**, which is a separate guarantee that had not been built when
that risk was accepted. [auth.md](auth.md) has both halves, and the contradiction between them that
stood until 2026-08-27.

**This file is the map; [security.md](security.md) is the territory** — a long deep-dive with the
payload tables, the reasoning behind every policy line, and the honest gap list. Open it when you are
changing a defence; read this one when you want to know which defence you are standing on.

## In this doc

- [§ The one habit](#the-one-habit) — the rule to apply when no table row covers what you are doing
- [§ The docs](#the-docs) — which security doc to open: the deep dive, auth, admin, billing
- [§ Where the defences physically live](#where-the-defences-physically-live) — the file that enforces a given boundary, before you render, route, fetch or read on a stranger's behalf
- [§ The fleet dashboard, which is a different product on the same box](#the-fleet-dashboard-which-is-a-different-product-on-the-same-box) — touching the dashboard or anything else served from the box

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
  longer shared, and the one test that has to exist. And the browser half of that last one, for two
  accounts in one browser:
  [§ A request made for one reader is never sent as another](auth.md#a-request-made-for-one-reader-is-never-sent-as-another).
- **[admin.md](admin.md)** — the one request that reads across owners, and how narrow the exception
  is: one route, one path prefix, one address. Which of its three refusals is a gate and which two
  are courtesies, why the check is on the prefix rather than the route, and what the page
  deliberately does not show.
- **[security-risks.md](security-risks.md)** — the register: every risk we know of, levelled High,
  Medium or Low, with whether Greg has accepted it and what would fix it. Open it to see what is
  carried on purpose before reporting it again, or to work through the proposals.
- **[billing.md](billing.md)** — money, and the two things it is really about here. Card details
  never reach this server at all (hosted Checkout and Portal, opaque ids only), and the ingest
  quota is an **abuse boundary against model spend** rather than an invoice — so the interesting
  part is what stops a script firing twenty concurrent requests at a free account, which turns out
  to be one `insert … on conflict do nothing` in front of a `for update`. Also where test and live
  mode are kept apart, in three places, all keyed on the credential's own prefix.
  Since 2026-09-30 it also holds High-powered AI’s charge (one more row per article, once, never
  refunded), and the rule that AI *cost* is never shown to a non-admin lives in
  [cost-tracking.md](cost-tracking.md#only-the-administrator-ever-sees-a-figure).
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
| [`src/auth.ts`](../../src/auth.ts) | the gate: `requireUser`, which refuses an AI app's OAuth token (one with a `client_id`) everywhere. See [§ An AI app's token](#and-since-2026-10-07-an-ai-apps-token-which-opens-one-route) |
| [`src/mcp/remote.ts`](../../src/mcp/remote.ts) | **the second gate**: `POST /api/mcp`, dispatched before `requireUser` like the Stripe webhook, accepting only the one registered AI app's token, only the administrator's, and running the MCP tools through `handleApi` as that reader. See the same section |
| [`src/web/auth-return.ts`](../../src/web/auth-return.ts) + [`AuthCallback.tsx`](../../src/web/AuthCallback.tsx) | where a sign-in returns the reader to: same-origin only (no `//evil.example`), never the callback itself, ten minutes at most, and **forgotten on every callback failure** — AuthCallback has one `fail()` exit, the only caller of `setError`, and a test pins that ([261001i](../plans/261001i-password-reset.md)). The callback's own address is always the bare `/auth/callback`, so a one-time code cannot ride into another URL ([auth.md](auth.md), point 4) |
| [`src/web/lib/api.ts`](../../src/web/lib/api.ts) | `apiFetch` — every request is bound to the reader the tab held as it was made, and is not sent with a token known to be another reader's (`NotThisReader`). The server cannot see this one: reader B's token on reader A's words is a valid request. [auth.md § A request made for one reader is never sent as another](auth.md#a-request-made-for-one-reader-is-never-sent-as-another) |
| [`src/store/owned-slug.ts`](../../src/store/owned-slug.ts) (re-exported from `pg.ts`) | `ownedSlug()` — keeps one reader's shelf out of another's |
| [`src/asset-delivery.ts`](../../src/asset-delivery.ts) | `storedAssetFor()` — **the storage key is rebuilt from this article's own manifest entry, never from the caller's string.** The bucket is content-addressed and shared by every article and every reader, so a route that concatenated a caller's hash into a key would be an arbitrary-object read. A hash absent from this article's manifest is a 404 **even for its owner**. Both `GET /api/asset/…` and its public twin go through it. See below |
| [`src/db/ssl.ts`](../../src/db/ssl.ts) | `sslDecisionFor` — **the database connection verifies Supabase's certificate or does not happen.** Against the remote there is no unverified answer: a missing CA, or a TLS key in `DATABASE_URL` that `pg` would let override ours (`?sslmode=no-verify` turned checking off while we said "verified"), is a thrown error saying what to fix. Local is untouched. Every pool and script goes through it. [security.md § verified or refused](security.md#database-tls) |
| [`src/fetch.ts`](../../src/fetch.ts) | scheme allowlist, `isBlockedAddress`, redirect limit, size cap — 50 MiB, the upload's own `MAX_UPLOAD_BYTES`, counted off the stream and stopped on the first chunk over by [`src/read-capped.ts`](../../src/read-capped.ts), which the store's read shares. [fetching.md § Size](fetching.md#size-and-the-header-that-lies-about-it) |
| [`src/ingest.ts`](../../src/ingest.ts) | `normaliseUrl` — refuses literal private and loopback hosts before queueing |
| [`src/chat-tools.ts`](../../src/chat-tools.ts) | `isSlug` on the model's slug, URL-length cap on the model's URL; `runTool` refuses any tool not in `toolsFor(kind)`, so a conversation's tool list is a boundary and not a suggestion |
| [`src/web/chat-commands.ts`](../../src/web/chat-commands.ts) and [`src/web/command-proposal.ts`](../../src/web/command-proposal.ts) | `chipFor`: what a model's `[cmd:...]` token may become: an id on `CHAT_PROPOSABLE`, an argument its own command accepts, a mode the reader can open here now, checked at the draw and again at the press. A press is the only way any of it runs, with one exception: in the guide, the first chip of an answer that finished on screen runs itself if it only moves the reader — a jump, or a mode that makes and writes nothing ([`src/web/guide-acts.ts`](../../src/web/guide-acts.ts), [`src/acts-alone.ts`](../../src/acts-alone.ts)). Anything that writes, spends or leaves the article is still a press, so a planted instruction can at worst move the reader, undone by Back. |
| [`src/urls.ts`](../../src/urls.ts) | `isWebUrl` — what model output must pass to become an `href`; `carriesCredential` — what may not be written into an ownerless cache; `requestTarget` — what a GET actually asks for, and never `urlKey` |
| [`src/link-previews.ts`](../../src/link-previews.ts) | **the one endpoint a reader's *pointer* can make us fetch a stranger's page with.** Its defence is not the gate but the scope: the caller must own the article *and* the article's own extracted links must contain the URL, before anything is fetched or spent. Authentication alone would make it an open proxy. Plus `fetchDocument`'s complete envelope, a credential refusal, and a per-owner limiter. [links.md](links.md#what-our-own-server-can-reach) |
| [`src/link-summary.ts`](../../src/link-summary.ts) | **the one place a stranger's page reaches a model.** Same scope as the row above — own the article, and the URL must be in it — plus the fencing: explicit untrusted-content markers, a system rule that the page is data and never a request, a reminder on the far side of it, every run of `===` rewritten so a page cannot close its own fence, and **no tools on the call**, so there is nothing for an injected instruction to reach. Its own limiter bucket, with a day and a global fuse, because this one spends money. [links.md](links.md#and-what-it-has-to-do-with-the-piece-in-your-hands) |
| [`src/injection-scan.ts`](../../src/injection-scan.ts) | hidden text in the raw source, found before the model reads it. It reports and decides nothing, and it does not read PDFs |
| [`src/referee-hidden-check.ts`](../../src/referee-hidden-check.ts) + [`src/scan-groups.ts`](../../src/scan-groups.ts) | **the one place the hidden fragments reach a model**, on the referee's press: capped and fenced where the prompt is built, the answer validated and bound to the rows sent, and drawn as a line under a row that nothing ordering, counting or marking the rows can read. Kept since 2026-10-09, owner-only, and redrawn on reload through the same validator and renderer. [security.md § the manuscript](security.md#hidden-instructions) |
| [`src/public/routes.ts`](../../src/public/routes.ts) | **the one namespace with no gate in front of it** — dispatched before `requireUser`, read-methods only, no owner ever set. See below |
| [`src/public/dto.ts`](../../src/public/dto.ts) | **the allowlist, as code** — every key a stranger receives, constructed rather than filtered. See below |
| [`src/store/public-slug.ts`](../../src/store/public-slug.ts) | `publicSlug()` — slug **and** `visibility = 'public'`, the one ownerless *lookup* |
| [`src/store/link-shared-slug.ts`](../../src/store/link-shared-slug.ts) | `linkSharedSlug()` — slug **and** `share_token = ?`, the lookup for somebody holding a private link's key. Its own leaf, never OR-ed into `publicSlug`. See below |
| [`src/store/public-access.ts`](../../src/store/public-access.ts) | `publicAccessWhere()` — the one place the two ownerless lookups meet: public, or *public or this key*. Every read in `public-reader.ts` takes it; the listing does not import it |
| [`src/share-key.ts`](../../src/share-key.ts) | `parseShareKey()` — what counts as a key (22 base64url characters), so nothing else reaches a query or a request; `withoutShareKey()` — the key taken off an address before it is stored or sent |
| [`src/store/public-library.ts`](../../src/store/public-library.ts) | `publicLibraryQuery()` — the one ownerless *listing*. See below |
| [`src/store/public-topic-tree.ts`](../../src/store/public-topic-tree.ts) + [`src/public-library-topics.ts`](../../src/public-library-topics.ts) | the public shelf's topic pills: one row read by a fixed key, the site account's, and **withheld whole** while any article it names is no longer listed. Since 2026-10-09. See below |
| [`src/web/PublicLibraryPage.tsx`](../../src/web/PublicLibraryPage.tsx) | the page that draws it — **the only defence it holds is which route it asks**. See below |

The tests are the specification: `tests/sanitize.test.ts`, `tests/sanitize-client.test.ts`,
`tests/routes.test.ts`, `tests/slug.test.ts`, `tests/owner-isolation.test.ts`,
`tests/public-dto.test.ts`.

### And since 2026-10-07, an AI app's token, which opens one route

([261007p](../plans/261007p-mcp-remote-sign-in-with-oauth.md); Greg approved changing the sign-in
gate for it.) Supabase's OAuth server issues tokens to an AI app the owner approves on
`/oauth/consent`, so that Claude on the web or a phone and ChatGPT Desktop can use the MCP tools
([mcp.md](mcp.md)). Supabase's default issuance adds `client_id` to OAuth access tokens, not
browser sessions. ID tokens also carry it but fail `personFrom`'s authenticated-role check;
trusted custom token hooks can alter claims
([token-boundary review](../research/261009a-one-click-mcp-install-for-claude-and-chatgpt.md)).

- **`requireUser` refuses it**, 401 `[auth-oauth-token]`, so a connector's token cannot reach a
  route that is not a tool.
- **`POST /api/mcp` accepts only it**, and only when `client_id` is an entry in the comma-separated
  `MCP_OAUTH_CLIENT_ID` list, or the list contains `*`. No nonempty ids, the route refuses everyone,
  which is how it shipped. Then the administrator only (`isAdmin`), and an `Origin`, if sent,
  must be exactly ours, `https://claude.ai` or `https://chatgpt.com`.
- **Dynamic client registration is on** (Greg, 2026-10-09), with `*`, so any MCP app works with
  just the URL. So **anyone can register an app, under any name, with their own callback**, and
  ask the owner to press *Allow* (Sol F6). The consent page names the app and shows the callback's
  host, but neither is proof of the app's identity. Administrator-only limits the route's
  audience; it does not protect the administrator who approves a malicious app. Greg accepted
  this phishing risk while the route is administrator-only; revisit it before readers get access.
- **The tools run through `handleApi`** with a verifier that accepts one random per-request token
  and nothing else, so every route's own owner scoping and admin gate applies as it does to the local
  server. No OAuth token is forwarded anywhere.
- **The tools that send mail, publish or hand over a private link refuse here**: their approval is
  a dialog on the owner's Mac, which a server cannot show.

**What this cannot stop, and needs Greg's decision before switching on:** at Supabase itself the token is an
ordinary sign-in to the account. Supabase's Auth API (`PUT /auth/v1/user`, the MFA endpoints) does
not look at `client_id`, so whoever holds the token could, while it is valid, change the account's
password unless *secure password change* is on. The app receives the token and controls who sees it;
Spideryarn cannot guarantee that an arbitrary registered app keeps it from a model or another party.
Switching this on in production is Greg's decision with that written in front of him
([261007p § Questions](../plans/261007p-mcp-remote-sign-in-with-oauth.md#questions-for-greg-not-blocking)).
Revoking: with an explicit allowlist and no `*`, removing an id from `MCP_OAUTH_CLIENT_ID` refuses
that app's tokens at `/api/mcp` at once. While `*` remains, removing an id has no effect; replace
`*` with an explicit list to exclude an app, or unset the variable to refuse every app. Removing the app
in Supabase stops new ones, while an issued access token stays valid at Supabase until it expires
(an hour). `tests/mcp-remote.test.ts` and `tests/auth.test.ts` hold the gate.

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
who shared it. Since 2026-10-09 it also selects `articles.id`, **server-only**: the topic pills below
are keyed by it, the card is built without it, and the guard checks the JSON never carries it.

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

It used to refuse to work at all on the filesystem store — a `requirePostgres()` that answered 501.
That store was deleted on 2026-09-05 and the check went with it: there is one store now, so there is
no half-implemented public path for a misconfigured dev server to serve.

#### And since 2026-10-09 the listing carries topic pills a model named

> q-p5h2a7 A
>
> — Greg, 2026-10-09, approving this change to what a stranger's page receives
> ([the question](../user-feedback/questions/q-p5h2a7.md), plan
> [261008j](../plans/261008j-public-shelf-topic-pills-automatic-billed-to-the-site.md))

`GET /api/public/library` now also sends the public shelf's topic pills — each one's key, label,
breadth and broader topic — and on each card the keys of its topics. What changed, and what holds it:

- **Nothing is worked out or spent for the visitor.** The pills are a stored row of
  `shelf_topic_sets`, read by [`src/store/public-topic-tree.ts`](../../src/store/public-topic-tree.ts)
  by one fixed key, the **site account** ([`src/site-account.ts`](../../src/site-account.ts)): a real
  `auth.users` row that owns nothing and cannot sign in. That file imports no owner context, and
  `tests/public-imports.test.ts` § `ALLOWED_IN` lets it, and only it, name the table. The writer is
  the authenticated coordinator ([`src/public-shelf-topics.ts`](../../src/public-shelf-topics.ts)),
  run after a share, un-share, archive or delete, and it stays out of the public import graph with
  every model and gateway module.
- **The model's input is the listing itself** — the same closed query, so only what the page already
  shows, titles and one-line summaries. No reader profile, nothing private.
- **Withheld whole, not trimmed.** If any article the tree was made from is no longer listed, no
  topic is sent at all ([`src/public-library-topics.ts`](../../src/public-library-topics.ts)): a
  label may have been worded from an un-shared title, and un-sharing must take effect on the next
  request, as it does for the card. Below eight cards, none either.
- **The new risk, named.** A hostile shared title could already put its own words on its own card.
  Now it can also nudge the labels strangers see, and which other owners' articles sit under them.
  The bounds are every reader's pills': no tools on the call, a strict schema, articles named only by
  ids the prompt showed, a label of at most 40 characters, drawn as plain text.
- **For the first time a request records spend against an account other than its own**: the share
  request's model calls are booked to the site account with no article (`withSpendAttribution`), and
  its allowance (12 an hour, 40 a day) caps abuse at about 8¢ a day. Past 20 public articles a full
  rebuild waits for an administrator's button on `/admin`.

The page's one-request inventory below is unchanged: the topics arrive in the same response.

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

#### And since 2026-10-05 there is a second way in, which is a key

A **private link** is `/read/<slug>?key=<key>`: an article that is not public, readable by anybody
who holds the key its owner made. The plan is
[261005e](../plans/261005e-share-an-article-with-some-people-a-private-link-first.md). It is the
same three public routes and the same reads, with one more predicate, and no new path. A
link-shared article is a private article with a token on it: `visibility` keeps its two values.

Four things keep it closed:

- **Its own leaf, never OR-ed into `publicSlug`.** `linkSharedSlug` is the fourth sanctioned
  `eq(articles.slug, …)` in `tests/owner-isolation.test.ts`. The two leaves meet only in
  `publicAccessWhere`, which the listing does not import, so the shelf, and the examples the
  marketing pages draw from the same listing, cannot see a link-shared article.
  `tests/public-imports.test.ts` holds that.
- **Only a parsed key reaches a query.** The dispatcher hands a handler one named field, `key`,
  and bounds it with `parseShareKey` before any route is matched. A malformed key is no key. A
  wrong key, a revoked one, an absent article and a private one are the same 404.
- **Compared in the `where`, never fetched and compared.** One statement in `src/` selects
  `share_token`: the owner's read in [`pg-share-link.ts`](../../src/store/pg-share-link.ts), scoped
  by `ownedSlug`. `tests/share-link-token-stays-home.test.ts` greps for a second.
- **Public wins.** The link arm is *public or this key*, so a public article reads the same with
  any key or none, and `PublicArticle.sharedBy` says `"public"` of it. Turning a link off takes
  effect on the next request, as un-sharing does.

Since 2026-10-06 the article read has one answer that is not a 404 or a 200: 409
`still-being-added`, for a request that may read an article whose import has not published.
What it gives away and what it does not:
[public-readable-sharing.md § While the article is still importing](public-readable-sharing.md#while-the-article-is-still-importing).

**Where the key may travel, and where it may not.** It is in the page's address and in the query
string of the two public requests a visitor's page makes for that article, the payload and its
pictures ([`public-api.ts`](../../src/web/public-api.ts), [`rehost.ts`](../../src/web/rehost.ts)),
both still without a token or cookies. The owner's requests never carry it
(`tests/private-link-access.test.tsx`). It is in the owner's card, read from
`GET /api/article/:slug/share-link`, which answers `no-store` and is the one path under
`/api/article/` the browser's offline store never keeps (`lib/api.ts` § `NEVER_KEPT`).

It is not in our request log, which drops the query string, nor in a Sentry event. It is not in a
feedback report: the browser takes it off the address and the server takes it off again
(`withoutShareKey`). It is not in the remembered-view store, which writes an allowlist of
parameters (`last-view.ts`). It is not in the article payload, the shelf, or the page's `og:` tags:
the HTML page for a link share is the plain shell. **The reader's export drops the token**
([export.md](export.md)), because a zip gets forwarded. The audit table,
`article_share_link_events`, records who made or turned off a link and when, without the key.

What stage 1 accepts is in the plan: the key is in a URL, so it is in the browser history of
whoever opens it and in Vercel's own access log, and anyone who has the link can pass it on.

**And since 2026-10-07, a gift voucher's email**
([261007j](../plans/261007j-gift-voucher-starter-article-by-private-link.md)). A voucher may name one
of the administrator's own articles as a starter, and when it is private its email carries the
private link. The key is read through `shareLinkStore.read`, the owner's read, by a second caller
([`voucher-starter.ts`](../../src/store/voucher-starter.ts)), which never makes a link. It is then in
the kept copy of that email (`billing_voucher_emails.body_text` and `body_html`, so a retry sends the
same bytes; the admin page reads that table's status columns, never its bodies), in what Resend
keeps of what it sent, and in the recipient's inbox, which is the point. It is not in
`billing_vouchers`, which keeps the article's id and slug, nor in `GET /api/admin/vouchers`, a log
line or Sentry: the voucher writes go through `guardDbStore`, because a failed email insert puts
the whole email in Drizzle's error. `tests/share-link-token-stays-home.test.ts` pins the two
callers of the read, and `tests/voucher-starter.test.ts` the rest.

**And since 2026-10-07, an AI assistant's conversation**
([261007o](../plans/261007o-mcp-private-link-and-admin-user-tools.md)). The MCP server's
`create_private_link` ([mcp.md](mcp.md)) asks the owner's route for the link, making one only if
none is on, and hands it to the AI app that called it, where it stays in that conversation and in
whatever the app or its agent keeps. Greg accepted that (2026-10-07). It is the owner's own route
with the owner's own session, and **a dialog on the owner's screen approves every call**, naming
the article; the model cannot answer it. An existing link is handed over, never replaced: the
route's `keepExisting` decides under the row lock. `tests/share-link-token-stays-home.test.ts`
pins `src/mcp/tools.ts` as the one client outside the browser that asks for the key.

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
**arc**, which crosses like an artefact but has no mode to be swept. (The tweet thread is the second: a mode from 2026-09-29 to 2026-10-03, swept through `POLICY.tweets`, and now Summary's Thread view, with a fixed row of its own again — `SHARED_THREAD`.)

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

**`PublicMeta` has ten fields, and three of them were added on 2026-10-04.** It had seven: `slug`,
`title`, `byline`, `siteName`, `lang`, `excerpt` and `url`. (The type's own comment said six; `url`
arrived on 2026-08-30 and the count was not moved.) The three are where and when the piece was
published:

> Q-visitor-page yes
>
> — Greg, 2026-10-04

The question was whether a visitor's Metadata page should show the journal and the publication
date, those two facts only
([261004h](../plans/261004h-year-only-publication-dates-journal-and-date-for-visitors-and-the-registry-backfill.md)).
What crosses, and what does not:

- `journal`, copied from `article_revisions.journal` through `optNull`, which is `opt` for a row
  whose empty columns are `null`.
- `published`, **the calendar day and not the stored string**. The owner's `publishedAt` is the
  publisher's own text and may carry a time of day and an offset. `publicMeta` sends its first ten
  characters when they are a real day, and nothing otherwise. It has a different name from the
  owner's field so neither is mistaken for the other.
- `publishedYear`, for a paper whose registry record states a year and no whole day. It is the
  publication date at the precision we hold it, so it was treated as inside the same yes. It is
  sent only when there is no day.
- **`doi` and `abstract` do not cross.** They sit in the same row and were not asked for. The public
  projection in [`public-reader.ts`](../../src/store/public-reader.ts) does not select them, and
  `tests/public-visibility-pg.test.ts` reads the real response for both.

The public shelf's eight columns (`/read/public`) are a separate allowlist and were not changed.

## The fleet dashboard, which is a different product on the same box

`tools/fleet/` is the agent dashboard on port 8787, not Spideryarn, and its threat model is its own:
it has **no authentication**, it renders text written by agents that read hostile input, and it
can type into those agents. Reachability is the access control — the bind, and the reasoning for
deferring anything stronger, are in
[overseer-direction.md § Access](overseer-direction.md#access) and its A5 paragraph.

**What is proven at the HTTP boundary** — by
[`tests/fleet-composed-access.test.ts`](../../tests/fleet-composed-access.test.ts), which starts the
real `tools/fleet/server.ts` on a private loopback port and sends it real requests, each assertion
seen to fail when its guard is removed
([260910f](../plans/260910f-fleet-access-review-composed-server.md)). **The next test of the
composed server starts it with
[`tests/helpers/fleet-child-server.ts`](../../tests/helpers/fleet-child-server.ts)**, which keeps
the child off the live stores, the live tmux server and every paid call:

- it listens only where `FLEET_BIND` says, and refuses to start on a wildcard;
- every response class carries the CSP and anti-framing headers of
  [`headers.ts`](../../tools/fleet/headers.ts) — static files, 404s, refusals, the SSE stream;
- **a request whose `Host` is not a name this box is reached by is refused before routing**
  ([`origin.ts`](../../tools/fleet/origin.ts)) — the DNS-rebinding defence, which until 2026-09-10
  covered the routes that type and not the ones that read transcripts;
- every write route refuses a cross-origin, missing or `null` `Origin`;
- the read routes answer their exact path and `GET`/`HEAD` only.

**Still source-level:** that the action stores are open before the listener
(`tests/fleet-hold-restart.test.ts` reads the file), and that the page's queue is the one the
drainer delivers from. **Not a defence at all, and labelled so in the code:** the `speaker` a
receipt records is what the request *claims* (`parseSpeaker` in `routes-steer.ts`); anything that
can reach the port can claim to be Greg.

---

Up: [AGENTS.md](../../AGENTS.md)
