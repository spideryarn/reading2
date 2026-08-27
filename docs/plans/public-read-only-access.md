# Public read-only access

**Planned 2026-08-27. Nothing is built.** This is the doc Greg asked for before any code: the
long-term shape, and four stages that each stand on their own.

> I'd like users to be able to send other non-users a link to a Spideryarn doc (and as long as they
> have marked the doc in Metadata as "world-readable"), for non-logged-in users to be able to get
> all the read-only benefits … to see all the already-generated AI output, but not to incur any new
> AI costs. In other words, if the logged-in user has generated the Summary but not the Glossary,
> then the non-logged-in users would be able to view the Summary but be told that the Glossary
> hasn't been generated yet. This would be great for marketing, and is cost-efficient (because it
> means that we don't need every user to repeat the same computation for docs that we've already
> processed).
>
> — Greg, 2026-08-27

**GPT Sol reviewed the first draft the same day and returned BLOCKED**, with four blockers and five
more findings, and this version is written against them. What it changed, and the two sentences of
the first draft that were simply false, are in
[§ What the review changed](#what-the-review-changed) at the bottom. Its verdict on the one thing
this plan is most exposed on:

> The ownerless `/api/public/` seam is the right design. Do not impersonate the owner and do not
> widen `ownedSlug()`.

Read this beside [auth.md](../project/auth.md), which is the gate this feature has to make a hole
in, and [security-map.md](../project/security-map.md), which names what that hole must not let out.

---

## The eight calls Greg made before this was written

Asked as questions, answered as decisions, all on 2026-08-27. They are here at the top because
every stage below follows from them.

| | Decision |
|---|---|
| **The prose** | A public visitor sees **the full article, same as the owner**. Not a scaffold with the paragraphs cut out. Principle 1 in [vision.md](../project/vision.md#principles) says the text is the destination; a public page without it would be advertising a product we are not shipping. |
| **What a link is worth** | A **marketing surface** — real link previews when pasted into Slack or Twitter, and pages a search engine may index. Not a private one-to-one handoff. |
| **AI spend** | **Zero, for now.** No logged-out visitor causes a paid call. A small metered budget is a later stage, deliberately, not a thing we quietly leave the door open for. |
| **Prompt variants** | Storing the default-prompt *and* the personalised version of an artefact side by side, switchable, is the **long-term goal and not v1**. |
| **Your annotations** | A public visitor sees **none** of the owner's comments, chats or searches. "Share this along with my questions" is a separate, later, opt-in switch. |
| **Attribution** | The public page says **nothing about the owner**. No name, no email, no "shared by". |
| **What we tell Google** | `<link rel="canonical">` points at **the original article**, not at us. |
| **The switch** | **Off by default, per document, ticked by hand** in Metadata. |

### The one tension in that list, said out loud

"Marketing surface" and "canonical points at the original" pull against each other, and it is worth
being honest about which one wins where. A canonical tag pointing elsewhere is the standard way of
saying *the real version is over there*, and a search engine that believes it will mostly decline to
rank our copy. So the marketing value of a public link is **not** ranking for somebody else's essay.
It is:

- **Link previews.** A Spideryarn URL pasted into Slack, WhatsApp, Twitter or iMessage unfurls into
  a card with the article's title, its one-line gist and our name on it. This is the bulk of the
  value and it is entirely within our gift.
- **Word of mouth.** Somebody reads a piece here because a friend sent this link rather than the
  original, and the reading view is the pitch.
- **Our own pages.** The landing page, and later an index of what has been shared, are ours to
  write and ours to have indexed.

If we ever decide we want the article-search traffic too, that is a deliberate later decision with a
publisher-complaint risk attached — see [§ Rights](#rights-and-takedown-the-thing-a-canonical-tag-does-not-fix),
which Sol raised and the first draft had not thought about at all.

---

## What the code already gets right

Three things, found by reading rather than assumed. Together they make this feature smaller than it
sounds — though not as small as the first draft claimed.

**1. Every GET is a pure read. Everything that spends money is a POST.** That split already exists
and it is enforced by comment and by review — `POST /api/similar/:slug` says so at length in
[`src/routes.ts`](../../src/routes.ts), and the reason given is exactly ours:

> a GET that does that is wrong in a way that is easy to miss — GET is supposed to be safe, so a
> link prefetcher, a proxy retry, a crawler or a double-tap on Back can all pay for it again, none
> of them having asked anybody. GPT Sol's finding, 2026-08-27.

That was written about crawlers hitting an authenticated route. It is the same sentence this feature
needs, so **the set of things a public visitor could be shown is already carved out**. What is *not*
carved out is the shape of those responses — see [§ The payload](#the-payload-an-allowlist-projection-not-a-denylist),
which is the biggest single piece of work in stage 1.

**2. The shared half and the private half are already in different tables.** Everything the pipeline
generates *about the article* is a JSONB column on `article_revisions`: `tree`, `arc`, `summary`,
`glossary`, `ideas`, `tweets`. Everything a reader *does* has its own table keyed by `article_id`:
`comments`, `chat_threads`, `chat_messages`, `search_runs`, `glossary_lookups` — plus
`articles.purpose`, the "why you're reading this one" box. The line Greg drew between what a
stranger sees and what they don't is a line the schema already draws.

**But the read seams deliberately cross it.** `loadGlossary` attaches the reader's own lookups to
the glossary at the read seam, on purpose and with a comment saying why
([`src/store/pg.ts`](../../src/store/pg.ts)); `loadArticle` runs the meta through `titleFor()` so the
masthead shows the reader's private rename ([`src/api.ts`](../../src/api.ts)). Those are correct for
the owner and are exactly the leaks a public route must not inherit.

**3. There is a precedent for a rule above the route table.** The admin check is a prefix test on
`path`, placed above every route rather than inside the one handler it guards, and
[`src/routes.ts`](../../src/routes.ts) says why in a comment worth copying:

> so an admin route added later is behind this check whether or not whoever adds it remembers, which
> is the only version of this that stays true.

The public namespace gets the same treatment, in the other direction.

## And four things it makes hard

**1. `ownedSlug()` is the whole of the isolation, and it is not optional.**

```ts
// src/store/pg.ts
export function ownedSlug(slug: string) {
  return and(eq(articles.slug, slug), eq(articles.ownerId, currentOwnerId()));
}
```

[`tests/owner-isolation.test.ts`](../../tests/owner-isolation.test.ts) asserts that **no file under
`src/store/` writes `eq(articles.slug, …)` outside `pg.ts`**, precisely because five near-identical
lookups once existed and there was no way to tell by looking whether all five had been fixed. The
worst possible version of this feature is an `or(visibility === 'public')` bolted onto that
predicate — one edit, in the one place, that quietly widens every read in the app. **We are not
doing that.**

Sol found the sharp edge in the obvious alternative, too: that test **exempts the whole of `pg.ts`**,
so simply adding `publicSlug()` there weakens the guard rather than extending it. The guard has to be
tightened to name the three sanctioned lookups by name — `ownedSlug`, `publicSlug`, and the
boolean-only `slugIsTaken` — and reject a fourth.

**2. `articles.slug` is globally unique.** One row per slug, for everybody:

```sql
CONSTRAINT "articles_slug_unique" UNIQUE("slug")
```

So two people cannot both hold the same article. `slugIsTaken()` exists specifically so
`beginRevision` can refuse the second person by name. **This does not block stage 1** — Greg's
cost-efficiency point is delivered by public reading itself, where nobody needs a second copy. It
blocks exactly one thing, and it is the best conversion moment we have: *"sign up and this lands on
your shelf."* That is [§ Stage 3](#stage-3-one-article-many-readers).

**3. `article_revisions.status` already has a value called `published`,** and it means *the pipeline
finished*, not *anybody may read this*. Two meanings of one word, three tables apart, is how a
mistake gets made at three in the morning. **The new column is `visibility` and its values are
`private` / `public`.** Never `published`, never `is_public` alongside a `published` that means
something else.

**4. There is no route table.** `serveApi` declares a pile of regex matches and then runs a long
imperative `if` chain. The first draft proposed a test that enumerates the routes and proves each
one refuses an anonymous caller; Sol called that wishful, and it is —
[§ How we prove it](#how-we-prove-it) replaces it with something structural that actually holds.

---

## The seam: a second predicate, not a wider one

```
   a stranger's browser                              a reader's browser
            │                                                 │
            │  GET /read/noema-mythology-of-conscious-ai      │  same URL
            ▼                                                 ▼
   ┌──────────────────────────────────────────────────────────────────────┐
   │  index.html  →  boot.tsx  →  App.tsx                                 │
   │                                                                      │
   │   useSession(): no user                    useSession(): a user      │
   │            │                                          │              │
   │            ▼                                          ▼              │
   │   ask the public API                            the reading view     │
   │     200 → the reader, public data sources                            │
   │     404 → LandingPage  (exactly as today)                            │
   └──────────────────────────────────────────────────────────────────────┘
            │                                                 │
            │  plain fetch(), no Authorization header         │  apiFetch(), bearer
            ▼                                                 ▼
   ┌───────────────────────────────┐          ┌───────────────────────────────┐
   │  GET /api/public/article/:slug│          │  GET /api/article/:slug       │
   │  dispatched before requireUser│          │  dispatched after it          │
   │  INSIDE handleApi's try       │          │  setRequestOwner(user.id)     │
   │  no owner is ever set         │          │                               │
   └───────────────────────────────┘          └───────────────────────────────┘
            │                                                 │
            ▼                                                 ▼
      publicSlug(slug)                                  ownedSlug(slug)
      slug = ? AND visibility = 'public'                slug = ? AND owner_id = ?
            │                                                 │
            ▼                                                 ▼
      a PUBLIC DTO, built by                            the response as it is
      allowlist projection                              today
            │                                                 │
            └───────────────────────┬─────────────────────────┘
                                    ▼
                        ┌───────────────────────────────────────┐
                        │  article_revisions                    │  ← the shared half.
                        │  tree · arc · summary · glossary      │    about the ARTICLE.
                        │  ideas · tweets · blocks              │    both paths may read it
                        └───────────────────────────────────────┘

                        ┌───────────────────────────────────────┐
                        │  comments · chat_threads              │  ← the private half.
                        │  chat_messages · search_runs          │    about the READER.
                        │  glossary_lookups · articles.purpose  │    no public route exists
                        │  reader_profiles · uploads · jobs     │    that can reach any of it
                        │  articles.title_override              │
                        └───────────────────────────────────────┘
```

### The three properties that are the design

**The public routes never set an owner.** The tempting shortcut is: resolve the slug, find whose it
is, `setRequestOwner(thatPerson)`, and reuse every existing handler unchanged. It would work, it
would be a fraction of the code, and it would mean **an anonymous request is running as a real
person** for the rest of its life. One route added later on the wrong side of the `if`, one early
`return` missed, and a stranger is writing to somebody's shelf. `currentOwnerId()` throws when there
is no owner ([`src/owner.ts`](../../src/owner.ts) reads before the gate rather than falling back to
the environment, for the same reason) — so on the public path it **stays** throwing, and any handler
that reaches for an owner blows up loudly instead of quietly succeeding as the wrong person.

**The public namespace is a closed room.** Once a request is inside `/api/public/`, an unknown path
or a wrong method **terminates there**. It never falls through into the authenticated table. That
fallthrough is the single most likely way this feature grows a hole.

**The client uses a plain `fetch`, not `apiFetch`.** `apiFetch` attaches a bearer token and refreshes
on 401. If the public path used it, the whole feature would be developed and tested by people who
were signed in, and the anonymous case — the only case that matters — would be exercised for the
first time by a stranger. This is [silent-success.md](../reusable/silent-success.md) with a
predictable ending. Sol found a second, nastier version of the same trap in the caching decision:
Vercel does not cache a request carrying an `Authorization` header, so a developer testing through
`apiFetch` sees revocation work perfectly while the real anonymous path is served from a cache.

### The control flow, spelled out

Sol's finding 5, checked against the code and adopted whole:

- Compute `path` without the query string, as `serveApi` already does.
- Treat **both** `/api/public` and `/api/public/…` as the namespace — the admin check's own lesson.
- Dispatch the public table **inside `handleApi`'s `try`**, before `requireUser`. Not above the
  `try`: a throw from there escapes the catch, returns a blank 500 on Vercel, and the `finally`
  never runs so **the refusal is never logged**. `routes.ts` documents that exact failure for the
  gate itself.
- Match public routes on `path`, never on `url`. Several existing routes match on `url` and so see
  the query string; a check a `?` can hide behind is not a check.
- Decode **only the captured slug, exactly once**, then run it through the existing `slugPart`
  validation. Never decode the whole path. There was a confirmed traversal here once and `slugPart`
  is what fixed it.
- Drive the tests through production's `originalUrl()` restoration in
  [`src/vercel.ts`](../../src/vercel.ts), not through a hand-built path, so what is tested is what
  ships.

Sol checked the obvious bypasses and they already fail closed: case variants, `//api/public` and
percent-encoded spellings either miss `/api/` entirely or land on the authenticated gate, and
`handleApi` returns false for any path not starting with `/api/`. The dangerous three are
whole-path decoding, public-handler fallthrough, and a slug capture that does not reuse `slugPart`.

---

## The payload: an allowlist projection, not a denylist

**This is the largest single piece of stage 1**, and the first draft got it wrong. It proposed
serving today's responses through a key denylist. Sol's answer:

> A recursive key denylist is insufficient: it misses innocently named fields such as `title`,
> `guidance`, `comments`, `generatedAt`, `lookup`, and future aliases such as `owner`, `createdBy`,
> or snake-case keys.

So: **new wire types, built by naming what goes in.** A field that nobody adds to the public DTO
cannot leak, and a field added to an internal type next month is absent by default rather than
present by default. Every row below was checked against the code; the citations are Sol's and they
hold.

| Endpoint | What must not cross unchanged |
|---|---|
| `article` | **`meta.title` may be the owner's private rename** — both stores run it through `titleFor()` before returning it. Also `meta.url` is the *final fetched* URL and can carry credentials or signed query parameters; `fetchedAt`; the extraction `note`; per-block `note`; the comment count; and the PDF/upload provenance block (`source`, `method`, `pages`, `rawSha256`, `unverified`, `recall`, `pagesChecked`). |
| `metadata` | `profile`, `purpose`, `comments`, `archivedAt`, `dir`, and effectively the whole of `stages` — internal paths, column names, completion state, run times, byte counts. Replace it with a small `availableKinds` shape: which artefacts exist, and nothing about how they were made. |
| `summary` | `profileHash`, `profileChanged`, and **especially `guidance`**, which is the owner's free-text steer. Also `generatedAt`, `elapsedMs`, `generator`, `version`, `sourceHash`. |
| `glossary` | `profileHash`, `profileChanged`, `passes`, `generatedAt`, `elapsedMs`, and **every `entry.lookup`** — a lookup is the owner's requested answer, its citations, its search count, its model and its exact time, and the Postgres read seam attaches them deliberately. |
| `ideas` | `profileHash`, `profileChanged`, `generatedAt`, `elapsedMs`, generator/source provenance. |
| `tweets` | the same six. |

Two consequences worth stating separately:

**`profileChanged` cannot even be computed on the public path.** `withProfileChanged()` calls
`resolveProfile(slug)`, which needs a reader. On an ownerless request it throws. The field simply
does not exist in a public response — which is the right answer anyway, since it is a property of
the artefact against a *person*.

**None of the six responses currently carries an `ownerId` or an email**, and the public query
results should be shaped so that a future one cannot. The danger Sol names is a public query that
one day selects an `articles` row wholesale.

### The leak that no projection fixes

The prose itself. A glossary written for *"cognitive scientist, twenty years, rusty on transformer
internals"* does not quote that sentence — [`src/profile.ts`](../../src/profile.ts) forbids it and
carries a verbatim forbidden example — but which terms it *skipped* is inferable, and a prompt is
not an enforcement mechanism. Stage 1 publishes whatever the owner has, personalised or not.

Sol's improvement on the first draft's vague clause: **the confirmation dialog should name which of
this document's artefacts were generated with a profile**, rather than warning in general. We know
which — `profileHash` is on every artefact and is non-null exactly when one was used. That turns a
sentence nobody reads into a specific fact about the thing being shared. The real fix is stage 4.

---

## What a public visitor gets, feature by feature

The rule Greg gave: *see what has been generated; be told plainly about what hasn't.* The second
half is as much of the work as the first.

| Feature | Public visitor | Note |
|---|---|---|
| The prose, at every zoom level | **yes** | The whole point. Blocks, tree, gists, spine. |
| Table of contents | **yes** | Derived from the same tree. |
| Granularity zoom | **yes** | Client-side; costs nothing. |
| Summaries | **yes, if generated** | Without the steer that shaped them. |
| Glossary | **yes, if generated** | The list. Never the per-term lookups. |
| Ideas | **yes, if generated** | |
| Arc, tweets | **yes, if generated** | |
| Metadata page | **a different, smaller page** | Not the owner's. Which artefacts exist, and nothing about paths, timings or the pipeline. |
| Keyboard, tooltips, touch, URL state | **yes** | All client-side. |
| Search within the article | **no in stage 1** | `POST /api/search` spends. |
| "Find similar" / projection | **no** | POSTs that embed. |
| Chat | **no** | Costs money, and it is the strongest signup CTA we have. |
| Comments / explain-this-sentence | **no** | Both reader state and paid. |
| Glossary term lookup | **no** | Paid, and it is the owner's. |
| The original PDF (`/api/source`) | **no in stage 1** | Serving somebody's uploaded bytes to the world is a separate decision from serving the extracted text. Hide the link rather than 404 it. |
| Anything on the shelf, profile, jobs, admin | **no** | No public route exists. |

### "Not generated yet" is a real screen, not a gap

There is already a convention for *this is a real intention, not an oversight*: the dimmed row with
a tooltip, `SOON` in [`Dock.tsx`](../../src/web/Dock.tsx) and in
[`Metadata.tsx`](../../src/web/Metadata.tsx), where the tooltip carries a blurb and a "learned" line.
Reuse it. A public visitor pressing **Glossary** on a doc that has none should get a sentence in the
app's own voice — the four rules in [copy.md](../project/copy.md) apply, and every string goes in
[`src/messages.ts`](../../src/messages.ts) and nowhere else.

Three distinct sentences are needed and they must not be one sentence:

- **Not generated.** *"Nobody has built a glossary for this piece yet."* Followed by the signup
  pitch, because signing up is genuinely the way to get one.
- **Not available to visitors.** *"Chat is for signed-in readers."* Different thing entirely —
  it exists, you just can't have it.
- **This document isn't shared.** The 404 case, which a visitor reaches by guessing or by following
  a link that has since been switched off. It must not confirm that the document exists. That rule
  already holds for signed-in readers — *a slug you do not own is 404, not 403* — and it holds here
  for the same reason.

---

## The original version had almost nothing on this

Greg asked for `docs/project/original-version/` to be mined for prior thinking, on the principle in
[CLAUDE.md](../../CLAUDE.md) that we should check before rebuilding something the previous version
already solved. **It is not there.** Grepping all twenty of those files for *public*, *anonymous*,
*logged-out*, *share*, *world-readable*, *unlisted* and *visibility* turns up nothing about letting
a stranger read a document. Written down so the next person does not repeat the search.

The one trace of it in this repo is a row in [metadata-page.md](metadata-page.md)'s table of what
the original's Metadata tab held:

| Their section | What was in it | Ours |
|---|---|---|
| Access & Sharing | public/private toggle, owner's email | **drop** — no accounts here |

So the original had a toggle and we know two things about it: it was public/private, and it sat
beside the owner's email address. Nothing about what it actually did, whether it ever shipped, or
what a logged-out visitor saw. It is a name for the card and no more than that.

There is **no prior art at all** on: keying an artefact by prompt variant (the original stored one
of each, exactly as this one does), read-only UI modes, signup calls to action, or gating model
calls behind auth. Everything in this plan is being invented here.

One adjacent thing from that folder *is* worth carrying: `structure-panel.md` records why per-node
open/closed state is deliberately **not** in the URL, while the depth cut-off is —

> node ids here are positional — a re-run of `npm run toc` renumbers them, so a shared link would
> open a set of sections that are no longer the ones you opened. The depth is the stable half.

That reasoning was about a shared link before there was any way to share one. It still holds, and it
is the argument for why [block-ids.md](../project/block-ids.md)'s stable ids matter more once links
leave the building: everything a URL carries has to survive a re-extraction on somebody else's
machine, weeks later.

---

## The stages

Four of them. Each is shippable on its own and each leaves the app in a coherent state.

### Stage 1 — send someone a link

*A stranger can read a doc you turned on. Nothing about search engines yet.*

**Database.** One migration:

```sql
ALTER TABLE spideryarn.articles
  ADD COLUMN visibility text NOT NULL DEFAULT 'private',
  ADD COLUMN public_at timestamptz;
ALTER TABLE spideryarn.articles
  ADD CONSTRAINT articles_visibility CHECK (visibility IN ('private','public'));
```

`NOT NULL DEFAULT 'private'` plus the check is fail-closed, and Sol confirmed the shape: a `NULL`
cannot be stored, and even if one existed, `visibility = 'public'` would not match it. Prove it
against a real Postgres, not a mocked query builder.

`public_at` is not enough on its own for the audit question — see [§ Rights](#rights-and-takedown-the-thing-a-canonical-tag-does-not-fix).

**Server.** A new `src/public.ts` holding: `publicSlug(slug)` — the second predicate, beside
`ownedSlug` in `pg.ts`, **part of the query that returns the row**, never a preliminary boolean
followed by an unfiltered read — the public route table, and the DTO projections. Plus the tightened
`owner-isolation` guard that names the three sanctioned lookups.

**The visibility switch gets its own owner-only endpoint**, not a new field on
`PATCH /api/library/:slug`. Sol's reasoning, adopted: that route edits *shelf state* — the
relationship between a reader and a document — and visibility is a property of *the work*. Stage 3
splits exactly along that line, so putting them together now means moving the API twice.

**`Cache-Control: no-store` on every public response.** The first draft proposed CDN caching as a
free win. It is not free: a cached body outlives the switch being turned off, and a cached 404
outlives it being turned on. Caching comes back only with an invalidation tied atomically to the
visibility change, and with a deployed test that warms the edge, turns the document private, and
proves the next anonymous request cannot get the body. A manual global purge is not a privacy
control.

**Client.** `App.tsx:162` is the whole client gate today:

```tsx
if (!user) return route.kind === "login" ? <SignInPage /> : <LandingPage />;
```

It becomes: no user and a reading route ⇒ ask the public API. 200 renders the reader against public
data sources; 404 renders `LandingPage`, exactly as now.

**And this is bigger than a `readOnly` prop.** The first draft said "the real reading view with a
read-only prop", and Sol went and read the reading view:

- `ArticlePage` hardcodes `apiFetch()` and **records an open with a POST**.
- `Reader` always loads comments and chat anchors.
- It always fetches glossary terms through the private endpoint.
- Glossary, summaries, ideas and tweets all mount `useJobs`, which **polls the private job list
  indefinitely**.
- `Metadata` mounts editing, deletion, profile and authenticated provenance.

So a boolean would produce a page that renders correctly and fires a stream of 401s behind it. What
is needed is a **capability seam**: the presentation components stay shared — one reading view is
still the right goal and the reason for it has not changed — but the data sources and the
side-effecting hooks are injected. Public means: public data sources, no comments/chat/jobs/profile
hooks mounted at all, no record-open POST. **The acceptance test is a network trace, not a
screenshot**: a signed-out browser must issue no request outside `/api/public/` and no POST.

**The chrome.** A persistent bar — not a dismissible toast, since it is a statement about what this
page is rather than a notification. It says three things: you are reading a shared document; the
things you cannot do and why; sign up. Every disabled control routes to signup with its own reason
attached, so the pitch is specific — *"Chat with this article — sign up"* rather than a generic
banner the eye stops seeing.

**Metadata gets an Access & Sharing card.** This is the original version's own section name, which
[metadata-page.md](metadata-page.md) recorded and deliberately dropped — *"**drop** — no accounts
here"* — on the day there were no accounts. There are now. It holds the toggle, the link with a copy
button, and one line saying what a visitor will and won't see.

**Turning it on takes a confirmation**, which names the article, says plainly that this puts its full
text where anyone with the link can read it, lists which artefacts were personalised, and asks the
owner to confirm they have the right to share it.

**Robots stay off.** [`vercel.json`](../../vercel.json) sets `X-Robots-Tag: noindex, nofollow` on
`/(.*)`, site-wide. Stage 1 leaves it exactly as it is, which is the right rollout order — the
indexing decision should be made when the pages are worth indexing, not as a side effect of shipping
a toggle. **But `noindex` is not secrecy**, and the first draft's "no crawler finds it" was wrong:
it is a request about search *results*. A stage-1 link is unlisted only in the sense that we do not
publish an index of them.

**Also stage 1:** an explicit `Referrer-Policy`. The public slug is not a secret, but the page URL
carries reading state, and the original source URL can carry query data of its own.

### Stage 2 — the link looks like something

*Where the marketing value actually lives, and larger than the first draft said.*

Today `/((?!api/).*)` rewrites everything to a static `index.html` whose `<title>` is the bare word
*Spideryarn*, and every page title is set by [`page-title.ts`](../../src/web/page-title.ts) after
React mounts. A crawler and a link unfurler both read the first response and neither runs our
JavaScript, so **every shared link currently previews as nothing.**

Fixing that means a function serving the shell with its head filled in — `<title>`, `<meta
name="description">` from the root gist, `og:*`, `twitter:card`, and `<link rel="canonical">`. Sol's
list of what that actually entails, all of it adopted:

- **Route `/read/:slug` to the function ahead of the generic SPA rewrite.** The catch-all currently
  eats it.
- **Serve the real built shell**, with the hashed asset references Vite produced. Not a hand-written
  copy that goes stale on the next build.
- **Query only through `publicSlug`.** A private slug gets the default head — its title must not
  leak through a meta tag. Same 404-not-403 rule, in a place nobody thinks to look.
- **HTML-escape the extracted title and the model's gist.** Both are untrusted:
  [security-map.md](../project/security-map.md) counts the content and the model's output as two of
  the four untrusted parties, and this is a new sink for both.
- **Validate the canonical and image URLs.** `meta.url` is the final fetched URL and may carry
  credentials or signed parameters, so the canonical needs its own safe-URL policy —
  [`src/urls.ts`](../../src/urls.ts)'s `isWebUrl` is the existing gate for exactly this.
- **`X-Robots-Tag` becomes dynamic**, decided per request from the database. A static path rule
  cannot work: public and private documents share the same `/read/:slug` shape. And the deployed
  response has to be checked for a surviving or duplicated global `noindex`.

**The function must not become a second renderer.** It fills in a head and serves the same bundle.
The moment it produces body HTML we own two reading views.

**Also stage 2:** anonymous reader state in `localStorage` — scroll position, zoom depth, which panel
was open — so a visitor who comes back lands where they were. Client-only. The failure mode to watch
is the guarded read that silently does nothing: under vitest + jsdom, Node's own `localStorage`
shadows jsdom's and reads as `undefined`, so a `try`/`catch` around it passes every test while
storing nothing.

### Stage 3 — one article, many readers

*The structural stage, and the one that makes the cost-efficiency argument literally true.*

`articles.slug` being globally unique means an article belongs to exactly one person. Everything good
downstream of a shared link runs into that: forking a public doc onto your own shelf, two readers
each keeping their own notes on one article, never running the pipeline twice for one URL.

The shape this wants to become:

```
   articles            (the WORK: slug, revisions, artefacts, visibility,
                        and an explicit maintainer — see below)
      │
      └── shelf_entries (the RELATIONSHIP: owner_id, article_id, purpose,
                         title_override, archived_at, opens, last_opened_at)
                          ↑
                          └── comments, chats, searches, lookups hang off THIS,
                              not off the article
```

`articles.slug` stays globally unique — it is the URL contract and
[block-ids.md](../project/block-ids.md) depends on article identity being stable.

**Two things Sol added that the first draft had wrong.**

**Somebody still has to be in charge of the work.** It needs a party who can change visibility,
re-extract it, and run paid jobs on it. If `owner_id` simply moves to `shelf_entries`, either every
shelf holder can do those things or nobody can. So the article keeps an explicit `created_by` /
maintainer, and it is a different thing from "has this on their shelf".

**The child tables are a real migration, not a follow-on.** Today comments, chats, searches and
lookups are filtered by `article_id` alone; their `owner_id` column is written and never read, and
the isolation rests on the invariant that a child's owner equals its article's owner
([auth.md](../project/auth.md) says so and calls it out as unenforced). **The moment two readers
share one `article_id`, that invariant is gone** and those tables leak into each other. They must
move to a shelf-entry identity, or to enforced composite keys, in the same piece of work.

**The cheap interim.** Sol's suggestion and it is a good one: a `saved_public_articles(owner_id,
article_id)` bookmark table. A visitor who signs up gets the document on their shelf immediately,
read-only, with reads still going through the public API. Notes and chat wait for the full
migration. That turns the best conversion moment we have into a small table rather than a schema
rewrite. **Stage 1's visibility column does not obstruct any of this — putting visibility into the
library PATCH would.**

### Stage 4 — variants, and a taste of AI

Two independent pieces that both land late.

**Variants.** Today every artefact is one JSONB column on `article_revisions`, holding one value,
carrying a `profileHash`. Regenerating under a different profile **overwrites** the previous one:
`existingFor` in [`src/glossary.ts`](../../src/glossary.ts) refuses to merge across a profile
change, which is right, but the old list is gone.

Greg's ask is that both survive and both be switchable. The first draft proposed keying on
`(revision_id, kind, profile_hash)`. Sol showed that key is not enough, and every objection checks
out:

- **Summaries also vary by `guidance`**, the owner's free-text steer, which is not in the profile.
- **Tree and arc deliberately do not vary by profile at all** — structure stays shared, and
  [reader-profile.md](../project/reader-profile.md) is explicit that a reader-specific tree is one
  that shifts under a reader who edits their box.
- **`profileHash: null` already means something**: written deliberately without a profile, and
  *never stale*. Replacing it with an empty-profile hash changes that behaviour silently.
- The key says nothing about **which variant the owner currently sees**, which one a public visitor
  gets, or how legacy `undefined` provenance migrates.
- **Glossary entry ids** are referenced by `glossary_lookups(article_id, entry_id)` and by the
  reader's own `?term=` links. Variants need a cross-variant identity rule or a lookup attaches to
  the wrong list, or vanishes when you switch.

So: a non-null **`variant_key` derived from all of a kind's generation inputs**, with the existing
nullable `profileHash` kept inside the artefact as provenance. Selection rules, migration and an
explicit *no default variant exists yet* state all get decided before the table is written — and
`existingFor` operates on the row selected for the incoming variant, not on "the latest glossary".

**A taste of AI.** Greg's call was *zero now, a small metered budget later*. Later means: after the
spend limit that [auth.md § What is not done](../project/auth.md#what-is-not-done) has been calling
the missing control since the day the gate was built. A per-visitor allowance without a global
ceiling behind it is an open wallet with a slower leak. Order: global spend limit, then per-IP
metering, then one cheap action — a single glossary lookup is the best candidate, being fast,
self-contained and the most convincing demonstration of what the tool is for.

---

## Rights and takedown: the thing a canonical tag does not fix

Sol raised this and the first draft had not thought about it at all. Serving a third party's full
article text from our origin is reproduction, and **a canonical tag and a `noindex` header are not
permission**. Greg has decided to serve the prose, which is the right product call; what follows is
the minimum that makes it a considered decision rather than an unexamined one.

- **A takedown path**, and contact details for complaints, reachable from a public page.
- **Unpublish must be fast and must actually work** — which is the same requirement as
  [§ Stage 1](#stage-1-send-someone-a-link)'s `no-store`, arriving from a second direction.
- **A record of who enabled sharing, and when.** `public_at` alone is not an audit log: cleared on
  unshare it loses the history, kept on unshare it no longer says whether the document is public
  now. A small append-only visibility-change log is the honest version.
- **The owner confirms they have the right to share it**, in the confirmation dialog.
- **Paywalled pages, signed URLs and uploaded PDFs deserve special care.** An uploaded PDF is
  somebody's file, not a public web page, and stage 1 does not serve `/api/source` for that reason.

And one honest limit to state in the UI rather than paper over: **switching sharing off cannot claw
back what a browser already received.** Future requests are refused immediately; a page already
loaded keeps its bytes.

---

## How we prove it

The house rule is that a check nobody has watched fail is not evidence
([silent-success.md](../reusable/silent-success.md)). Every check below needs a positive control
before it is believed. Two of the first draft's six were not implementable, and Sol said so.

| Check | The control that proves it can fail |
|---|---|
| **The authenticated dispatcher cannot be reached without a user.** *Not* an enumeration of the route table — there is no route table, only an `if` chain. Split `servePublicApi()` from `serveAuthenticatedApi()` so the second is **callable only after `requireUser`**, and test that structural boundary. | Call the authenticated dispatcher with no user; it must throw rather than route. |
| **`/api/health` is a named exception, not an oversight.** It is answered in `src/vercel.ts` before `handleApi` and already returns the environment owner's article count. Any "everything else refuses anonymous callers" claim is false until health is listed. | State it; assert the list has exactly two entries. |
| **No public route spends money.** Not a static import test — `src/api.ts` imports `glossary.ts` and `summarise.ts`, which import the model machinery, so that test cannot pass. Instead: a public read module that does not import the writers, **plus a runtime gateway spy asserting zero calls** across the whole public surface. | Make a public handler call the gateway; the spy must fire. |
| **Every public route rejects every non-GET method.** A sweep, not a spot check. | Add a POST handler in the public table; red. |
| **A private doc's public URL is 404.** | Flip the fixture to `public`, watch 200; flip back, watch 404. Both readings in one run. |
| **The public DTO is an allowlist.** Assert the projection's output keys against an expected set, deep, including nested arrays. | Add `guidance` to the summary DTO; red. |
| **`currentOwnerId()` throws on the public path.** | Call it in a public handler; the request must 500, not succeed as somebody. |
| **The migration's constraint and default hold**, against a real Postgres. | Try to insert `NULL`; try `'world'`. Both must be refused. |
| **The visibility endpoint is owner-filtered.** | A second owner's PATCH must 404. |
| **Public and signed-in requests interleaved** under `AsyncLocalStorage` do not see each other's context. The keep-alive `enterWith` bug is on record; this is its sibling. | Run them interleaved on one connection. |
| **Cache revocation**, once caching exists at all. Warm the edge, unshare, request anonymously. | Must not get the body. |
| **A signed-out browser issues no private request and no POST.** A network trace, not a screenshot. | Leave `useJobs` mounted; the trace must show the polling. |

The last row is the one most likely to be skipped and it is the acceptance test for the whole client
half. **Not curl**: `curl` returned 200 with the right `<title>` for the entire afternoon the site
was a blank page — [auth.md](../project/auth.md) records it. Per [CLAUDE.md](../../CLAUDE.md) the
browser pass runs in a Sonnet subagent against [browser-testing.md](../project/browser-testing.md).

---

## What we are deliberately not doing

- **Not widening `ownedSlug()`.** A second predicate, in the same file, with the static guard
  tightened to name all three.
- **Not impersonating the owner** on an anonymous request, however much handler code it would save.
- **Not a share token in stage 1.** Visibility is a property of the document and the URL is the one
  the owner is already looking at. If unlisted-with-a-secret is wanted later it is an additional
  value of `visibility`, not a redesign.
- **Not public writes of any kind** — no anonymous highlights, no anonymous comments, nothing that
  needs a row.
- **Not an open shelf.** There is no public library page in stages 1–2. `GET /api/library` stays
  owner-filtered and always will.
- **Not caching in stage 1.** `no-store`, until revocation is designed and tested.
- **Not indexing in stage 1.** The site-wide `noindex` stays until stage 2 gives a crawler something
  worth reading.

## Open questions

- **What a public visitor sees when the owner turns a doc off** while they are reading it. The next
  fetch 404s mid-session. Probably: the read-only bar changes to say the document is no longer
  shared, rather than the app appearing to break.
- **Whether the public page should link to the original article prominently.** Argues for itself on
  every ground except the one where we want the reader to stay — and it argues much louder now that
  [§ Rights](#rights-and-takedown-the-thing-a-canonical-tag-does-not-fix) is on the table.
- **Rate limiting the public GETs.** No AI spend, but `/api/public/article/:slug` returns a whole
  article and caching is off in stage 1. Response-size limits, database timeouts, and a
  rate-limit-or-WAF decision are all undecided.
- **Whether `visibility` belongs on `articles` or on the revision.** On `articles` here, because
  sharing is about the document rather than about one extraction of it — and because a re-extraction
  must not silently unshare or silently share anything.
- **Whether the metadata page should exist publicly at all**, given it becomes a different, much
  smaller page. Possibly the two or three facts worth showing belong in the reading view instead.

---

## What the review changed

Run on 2026-08-27 against the first draft:

```
npx tsx scripts/run-codex.ts --model gpt-5.6-sol --effort high --timeout-minutes 45 \
  --prompt-file docs/plans/public-read-only-access-review-prompt.md \
  --output docs/plans/public-read-only-access-review-sol.md
```

**Verdict: BLOCKED**, four blockers, five further findings. Every citation was spot-checked against
the code and all of them held. What it changed:

1. **The payload became an allowlist projection.** The draft proposed a key denylist over today's
   responses. Six endpoints leak something — the owner's private rename through `titleFor()`, their
   summary steer, their glossary lookups, the whole `stages` block — and `profileChanged` cannot be
   computed at all without a reader.
2. **"A `readOnly` prop" became a capability seam.** The reading view records an open with a POST,
   loads comments and chat anchors, and mounts `useJobs` to poll the private job list. A boolean
   would have shipped a page that renders and then fires 401s for ever.
3. **CDN caching became `no-store`.** A cached body outlives the switch. And the trap that makes it
   invisible: Vercel does not cache requests carrying `Authorization`, so a developer testing while
   signed in watches revocation work perfectly.
4. **Two of six proofs were not implementable.** There is no route table to enumerate, `/api/health`
   is already an anonymous exception, and the static "no public file imports the gateway" test
   cannot pass because `src/api.ts` imports the writers.

And four smaller corrections that were simply wrong in the draft: `noindex` is not secrecy; adding
`publicSlug` to `pg.ts` *weakens* the owner-isolation guard rather than extending it, because that
test exempts the whole file; visibility does not belong on the shelf PATCH; and the stage-4 variant
key is missing the summary steer and quietly changes what `profileHash: null` means.

Plus [§ Rights](#rights-and-takedown-the-thing-a-canonical-tag-does-not-fix), which the draft had
not thought about at all.

## See also

- [auth.md](../project/auth.md) — the gate, and *whose data is it*
- [security-map.md](../project/security-map.md) — the untrusted parties, and where each defence lives
- [admin.md](../project/admin.md) — the other deliberate exception to owner filtering, and how narrow it is
- [metadata-page.md](metadata-page.md) — where the Access & Sharing card goes, and why it was dropped the first time
- [reader-profile.md](../project/reader-profile.md) — `profileHash`, and why a variant table is the honest shape
- [copy.md](../project/copy.md) — the rules for every sentence a visitor reads
- [public-read-only-access-review-sol.md](public-read-only-access-review-sol.md) — the review in full
