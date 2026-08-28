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

## Postgres is the destination, and this feature cannot work without it

> We were using flat JSON files initially, but we're moving everything to Postgres/Supabase to run
> across Vercel webservers that don't have a shared filesystem.
>
> — Greg, 2026-08-28

That is the context this whole plan sits in, and it is why nothing here has a filesystem answer.
[postgres-migration.md](postgres-migration.md) is the parent piece of work; `SPIDERYARN_STORE` still
defaults to `files` and [`src/store/index.ts`](../../src/store/index.ts) already **refuses to boot on
`files` in production**, for a reason that is this feature's reason too — the filesystem store has no
owner column, so it has no second reader, and therefore no notion of somebody who is not the owner.

**Public reading is Postgres-only by nature, not by preference.** `data/` is one directory per slug
and there is nowhere in it to record who may read what. So the three filesystem branches this work
has had to write are **transitional scaffolding around a store that is going away**, and each of them
should be read that way:

| Branch | What it does today | When `files` goes |
|---|---|---|
| `requirePostgres()` in [`src/public/routes.ts`](../../src/public/routes.ts) | 501 with its own sentence, rather than a 404 | dead code, delete it |
| the visibility store's refusal in [`src/store/index.ts`](../../src/store/index.ts) | a write refuses loudly rather than pretending | dead code, delete it |
| `visibility?` **optional** on `ArticleMetadata` | absent means *this store cannot say*, and the sharing card draws "we could not check" | the field becomes required and that card state disappears |

Each is a **refusal rather than a default**, and that is the load-bearing choice. The tempting
version — answer `private` on a store with no column — would make the sharing card say *"Only you can
read this"* confidently and falsely on every article in dev. That is the failure this repo keeps
writing up ([silent-success.md](../reusable/silent-success.md)), and it is the same reasoning
`src/store/index.ts` already gives for refusing to fall back from Postgres to files: *"Do not catch a
Postgres error and fall back to files."*

One consequence, and it is worse than the one this paragraph claimed until 2026-08-28. The claim was
that `tests/store-parity.test.ts` compares the two stores' `articleMetadata`, so the divergence would
surface there once a parity fixture was published. **That file does not mention `articleMetadata` at
all.** The only cross-store comparison of it is in
[`tests/store-carry-forward.test.ts`](../../tests/store-carry-forward.test.ts), which reads
`stages[].done` and nothing else.

So the honest statement is: **the two stores now answer this differently and no test can see it.**
Postgres says `private` or `public`; the filesystem says *cannot answer*. That divergence is the
feature working rather than a regression — but nothing checks it either way, and a whole-object
comparison written later would go red on a published fixture and look like a bug. The seam carries a
comment saying exactly that.

Worth noticing how this nearly went wrong: an agent reported the parity test as covering it, I
endorsed writing a comment about when it would fire, and neither of us opened the file. **Asserting a
check that was never written, while introducing the divergence it was supposed to cover**, is the
purest form of the thing [silent-success.md](../reusable/silent-success.md) is about. It was caught
because the agent went back to check its own claim before building on it.

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
// src/store/owned-slug.ts
export function ownedSlug(slug: string) {
  return and(eq(articles.slug, slug), eq(articles.ownerId, currentOwnerId()));
}
```

**It moved on 2026-08-28, the day after this plan was written.** `ownedSlug` used to live in `pg.ts`
and now lives in [`src/store/owned-slug.ts`](../../src/store/owned-slug.ts), because `pg.ts` imports
`src/api.ts` and so put the whole read layer behind a one-line predicate. `pg.ts` re-exports it, so
no caller changed — but the guard below now exempts **two** files by name rather than one, and
anything this plan says about "beside `ownedSlug` in `pg.ts`" is stale.

[`tests/owner-isolation.test.ts`](../../tests/owner-isolation.test.ts) asserts that **no file under
`src/store/` writes `eq(articles.slug, …)` outside the sanctioned leaves**, precisely because five
near-identical lookups once existed and there was no way to tell by looking whether all five had been
fixed. The worst possible version of this feature is an `or(visibility === 'public')` bolted onto
that predicate — one edit, in the one place, that quietly widens every read in the app. **We are not
doing that.**

Sol found the sharp edge in the obvious alternative, too: that test used to **exempt the whole of
`pg.ts`**, so simply adding `publicSlug()` there would have weakened the guard rather than extending
it.

**Built 2026-08-28, and it went one step further than the plan asked.** The guard names three
sanctioned lookups — `ownedSlug`, `publicSlug`, and the boolean-only `slugIsTaken` — and rejects a
fourth. But naming them is not enough on its own, which was Sol's finding 4 on the built code:

> It verifies that `slugIsTaken` is safe, but not that it is the only bare slug lookup in `pg.ts`.
> Adding a fourth unfiltered lookup anywhere in an exempt file stays green.

So each of the three now lives in **its own one-function leaf** —
[`owned-slug.ts`](../../src/store/owned-slug.ts),
[`public-slug.ts`](../../src/store/public-slug.ts),
[`slug-is-taken.ts`](../../src/store/slug-is-taken.ts) — and the guard insists each file holds
*exactly one* bare lookup, *inside the function it is named for*. `slugIsTaken` moving out is what
let `pg.ts` lose its exemption entirely: the exemption existed for that one function, and fourteen
hundred lines were being trusted to protect six.

**2. `articles.slug` is globally unique.** One row per slug, for everybody:

```sql
CONSTRAINT "articles_slug_unique" UNIQUE("slug")
```

So two people cannot both hold the same article. `slugIsTaken()`
([`src/store/slug-is-taken.ts`](../../src/store/slug-is-taken.ts)) exists specifically so
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
   │   no session                               a session                 │
   │       │                                        │                     │
   │       │                                        ▼                     │
   │       │                                 ask the OWNED route          │
   │       │                                   200 → the reading view     │
   │       │                                   404 → not mine, so ↓       │
   │       ▼                                        ▼                     │
   │   ─────────────  ask the PUBLIC route  ─────────────                 │
   │     200 → the reader, public data sources, read-only chrome          │
   │     404 → no session: LandingPage (as today)                         │
   │           a session:  "this document isn't shared"                   │
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

**But the tripwire is not the defence, and an earlier draft of this section said it was.** Sol's
review of the built code, 2026-08-28, put the correction plainly: `currentOwnerId()` throwing would
**not** stop a future call that hands an explicit owner to `ownedSlug`, that queries a child table
directly by `article_id` or `revision_id`, or that spends money — **because a paid call does not need
an owner at all.** What actually keeps the public path safe today is two other things: the **closed
import graph** ([`tests/public-imports.test.ts`](../../tests/public-imports.test.ts) starts at
`src/public/routes.ts` and refuses any path to the owner stores, the writers or the gateway) and the
**hardwired reader** that accepts no predicate. The tripwire is the third line, not the first. Any
future work here that weakens either of the first two has removed the protection whatever
`currentOwnerId()` still does.

**And there is a whole class of read none of that catches, demonstrated rather than argued.** After
the review, the agent that built this slice put a function on the public reader that selects the
owner's `glossary_lookups` — their requested answer, its citations, its search count, its model, its
exact time — keyed only by `article_id`, which a public read legitimately holds. **Typecheck clean.
All five guards green. Eighty-three tests passing.** Then it took the function out again.

Every defence misses it, each for its own reason, and none of the misses is a bug in that defence:

| Defence | Why it does not see this |
|---|---|
| the owner-isolation grep | looks for `eq(articles.slug, …)`; the query never mentions `articles` |
| the closed import graph | forbids `api.ts`, `pg.ts`, `owner.ts`, the writers, the gateway — but `db/schema.ts` is legitimately in the public graph and it exports every table |
| the DTO allowlist tests | only ever see what a projection was handed |
| the zero-spend sweep | is about money, and this costs nothing |
| `currentOwnerId()` throwing | never runs |

Even the hardwired reader does not help, because **a child table needs no predicate**: it is keyed by
an id the public read already holds by right. So the answer is a sixth guard, and it is the same move
that worked three times already in this feature — enumerate the safe set, so widening it is
deliberate. **A public module may reference `articles`, `article_revisions`, `revision_blocks` and
`block_identities`, and no other table.** A denylist of reader-owned tables would have to be updated
by whoever adds the ninth one, and they will be thinking about their own feature.

This is not hypothetical. Sol's design input named `glossary_lookups` as the thing a public glossary
read must never join, and **the public glossary read is the first endpoint stage 1b adds.**

**The public namespace is a closed room.** Once a request is inside `/api/public/`, an unknown path
or a wrong method **terminates there**. It never falls through into the authenticated table. That
fallthrough is the single most likely way this feature grows a hole.

**The public routes ignore `Authorization` completely, and the client uses a plain `fetch`.** Same
projection for everybody, signed in or not — which is what makes the signed-in-stranger case above
fall out for free, and what lets a public response be cached one day without a `Vary`. `apiFetch`
attaches a bearer token and refreshes on 401. If the public path used it, the whole feature would be developed and tested by people who
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

### The odd spellings, and which of them are ours to decide

The first version of this paragraph said case variants and `//api/public` "either miss `/api/`
entirely or land on the authenticated gate". A black-box spike checked it on 2026-08-28 and
**neither happens**. They are still safe; the reason given was the wrong reason, and a safety
argument that names the wrong mechanism is worth less than no argument at all.

The honest split is that **`/api/` is the platform's decision and everything after it is ours**, and
only the second half is testable here.

**Everything after `/api/` — ours, decided, and pinned by
[public-dispatch.test.ts](../../tests/public-dispatch.test.ts):**

| Request | What happens | Why |
|---|---|---|
| `/api/public/article/x` | the public handler | the one spelling that is in the namespace |
| `/api/PUBLIC/article/x` | **401 from the gate** | `isPublicNamespace` is a case-sensitive `startsWith`, so this is not in the namespace at all and the authenticated half owns it |
| `/api//public/article/x` | **401 from the gate** | same — the doubled slash means the prefix does not match |
| `/api/public/ARTICLE/x` | **404 from the closed room** | this one *is* in the namespace; what it misses is the route, so it gets the room's own refusal and never reaches the gate |

Those last two rows are different mechanisms, and the first draft of the test asserted the wrong one
for the third row and was red. Both are refusals and neither serves anything, but writing "they fail
closed" without saying *which* closure is how the previous version of this paragraph went wrong.

**The `/api/` prefix itself — the platform's, and it differs by environment:**

- **In dev**, Vite mounts the API as connect middleware with no path, so it sees everything;
  `handleApi` returns `false` for any URL not starting with a literal lowercase `/api/`, and Vite's
  SPA fallback then answers with raw `index.html` at **200**. So `/API/public/…` and
  `//api/public/…` never reach an API handler *at all* — no data, no handler, inert. That is not
  "missing `/api/`" and it is not "landing on the gate"; it is a third thing the paragraph did not
  have.
- **On Vercel**, [`vercel.json`](../../vercel.json) decides before our code runs, and it has two
  rewrites: `/api/(.*)` to the function, and `/((?!api/).*)` to `index.html`. Read the second one
  carefully — **its negative lookahead is a literal lowercase `api/`**. So whichever way Vercel's
  matcher treats case:
  - if the match is **case-sensitive**, `/API/public/…` misses the first rewrite, matches the
    second, and is served `index.html` — the same inert outcome as dev;
  - if it is **case-insensitive**, `/API/public/…` matches the first rewrite with `$1` =
    `public/article/x`, and [`originalUrl`](../../src/vercel.ts) rebuilds the path with a **literal
    lowercase `/api/`** prefix — so `handleApi` sees `/api/public/article/x` and serves the article
    normally. Same predicate, same projection, same answer as any other reader.

  Both branches are safe, by different routes, and **which one is real is untested** — it needs a
  deployment, and neither the Vercel documentation nor the config settles it. The same uncertainty
  covers whether the edge collapses `//api/…` to `/api/…` before routing. Worth resolving the next
  time anything is deployed; not worth a deployment of its own, because there is no branch in which
  a private article is served.

The genuinely dangerous three are unchanged: whole-path decoding, public-handler fallthrough, and a
slug capture that does not reuse `slugPart`.

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

**"Visitor" means anyone who does not own the document** — signed out, or signed in and reading
somebody else's. They get the same thing, which is the point of the rule below the diagram.

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
| Chat | **no, and carved out by hand** | Costs money — and a conversation does not inherit a document's visibility just because it hangs off it. The predecessor wrote a checklist item to keep it out. |
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

## The original version shipped this, and it is not in `original-version/`

Greg asked for `docs/project/original-version/` to be mined for prior thinking. **Those twenty files
say nothing about it** — grepping all of them for *public*, *anonymous*, *logged-out*, *share*,
*world-readable* and *visibility* turns up one row, in [metadata-page.md](metadata-page.md)'s table
of what the old Metadata tab held: *"Access & Sharing | public/private toggle, owner's email |
**drop** — no accounts here."*

**The predecessor repo itself is a different story.** It is on disk at
`/Users/greg/dev/spideryarn/reading`, it built this feature in June, and the write-ups are still
there:

| | |
|---|---|
| `docs/planning/finished/250613a_remove_share_route_implement_public_document_access.md` | the feature |
| `docs/planning/finished/250618a_database_rls_security_comprehensive_review.md` | the RLS review that hardened it |
| `docs/planning/finished/250622b_improve_document_access_control.md` | the follow-up |
| `components/tools/MetadataPanel.tsx:1207` | the toggle and its copy |

What it was: a per-document `is_public` boolean, toggled from the metadata panel, enforced by RLS on
the *same* `/documents/[slug]` route. No share token, no second URL. The owner saw
*"🌐 Anyone can access this document with the link"* against *"🔒 Only you can access this
document"*. Five things it teaches, and each of them changes something above.

**1. It reached Greg's cost rule first, and stated it better than this plan did.**

> **Core Principle**: If a tool requires LLM calls, it should be blocked for anonymous users with a
> "pro" badge and paywall redirect. If a tool only retrieves from the database (including
> pre-generated AI content), it should work for anonymous users.
>
> — `250613a`, June 2025

That is Greg's 2026-08-27 paragraph, a year earlier, and it is the same line this plan draws. Worth
knowing it is a settled position rather than a new one.

**2. "A pro badge", not a hidden button.** Their UX section: *"Clear 'pro' badges on unavailable
features"*, and the tool list is explicit — headings, summary, glossary, tweet thread, chat,
semantic search, and ToC tooltip summaries *when generating new ones*. This is better than hiding a
control and better than a generic banner: the reader sees the whole tool, marked. We already own the
right visual convention for it — the dimmed row with a tooltip that says *not built yet* — and this
is the same shape saying *not yours yet*.

**3. Chat was carved out by hand, and they wrote a checklist item to make sure it stayed out.**

> **Chat threads/messages**: NEVER visible for public documents — require authentication
>
> …
>
> **IMPORTANT**: Ensure NO public document exception for chat

Two reasons, and only one of them is cost: a chat thread is a conversation, and conversations do not
inherit a document's visibility just because they hang off it. Our tables are the same shape. It
matches Greg's *"none of it — an opt-in later"* exactly.

**4. The landmine, and it is the best argument in this document for the closed namespace.** The
thing `250613a` existed to delete was a *second route to the same content*:

> **Current Issue**: `/share` route bypasses all security and RLS policies, allowing access to any
> document by slug regardless of `is_public` status.

A second access path is how the hole got in, and the fix was **deleting the second path**, not
patching it. The `/api/public/` namespace proposed here is a second access path. What keeps it from
being that bug is that it has its own predicate, its own projections and its own closed table — and
that it is the *only* one. If a third way to read an article ever appears, this is the paragraph to
re-read.

**5. Visibility does not cascade for free — it has to be threaded through everything hanging off the
document.** Flipping it on `documents` was not enough. Enhancements needed their own migration
(`20250618000002_update_document_enhancements_public_access.sql`) and **storage needed a third**
(`20250618000004_update_storage_rls_public_documents.sql`). We have the same shape: `revision_blocks`,
`block_identities`, `raw_sources` and `uploads` all hang off an article, and this plan's
[§ What a public visitor gets](#what-a-public-visitor-gets-feature-by-feature) declines
`/api/source` for stage 1 partly on that reasoning.

**One correction to a claim above.** Their slugs were title-derived, so *"anyone with the link"*
overstated it: a public document's address is guessable. Ours are derived too. That does not matter
given Greg's decision — a marketing surface is meant to be reachable — but **the copy must not
promise link-secrecy**, in the toggle or anywhere else. "Anyone with the link" is a description of
who *may* read it, not a claim about who *can find* it.

**No prior art at all on:** per-user or per-prompt-variant artefacts (theirs were per-document too,
and their one multi-axis attempt — three lengths × three expertise levels — went unused and their
own notes advise against reviving it as a per-artefact control); rate limits or quotas (gating was
binary, authenticated or not); and any browse-or-discover page for public documents (there was
none — link only).

### The case this plan had missed

Their UX section lists three situations, and the plan above had only thought about two:

> **Authenticated User Experience**: … Read-only access to others' public documents with all
> pre-generated content

**A signed-in reader who follows a shared link gets a 404 today.** `ownedSlug()` matches on owner,
so the friend Greg sends a link to — who happens to have an account — hits exactly the same wall as
a stranger, and gets the worse experience for having signed up. That is not a rare edge: it is the
likeliest first use of the feature.

The fix is small and it falls out of the design already here, provided one rule holds: **the public
routes ignore the `Authorization` header entirely and return the same projection to everybody.** Sol
asked for that on caching grounds — *"Do not make one public URL return personalised responses"* —
and it pays for itself twice. Then the client's rule is one sentence in both directions: *ask the
owned route first if there is a session; on 404, ask the public route; on 404 again, say the
document is not shared.* One extra request, only on the miss, and the reader gets the article rather
than a wall.

The read-only chrome is then keyed on **"is this mine"**, not on **"am I signed in"** — which is the
right question anyway, and the one the signed-in-stranger case would otherwise have forced us to
retrofit.

---

## What other people have already learned

Greg asked for a look at how analogous products draw this line. The working is in
[public-access-how-others-do-it.md](../research/public-access-how-others-do-it.md); four findings
change something here, and three confirm a decision already made.

**Indexability must be a separate switch from shareability, and it is stage 2's biggest trap.**
OpenAI shipped shared ChatGPT links with a *"make this chat discoverable"* checkbox. People read it
as *"share this with one person"*, thousands of conversations carrying names, emails and medical and
business detail were indexed by Google, and OpenAI withdrew the feature outright. Notion keeps the
two apart — *"Share to web"* is one control and search-engine indexing is a second, explicit one.
So when stage 2 arrives, **`indexable` is a new column, not a third value of `visibility`**, and the
two sentences in the UI have to be impossible to mistake for one another. This plan already defers
indexing, which is the right order; the mistake would be to arrive there and overload the flag we
already have.

**There is a clean precedent for exactly what Greg asked for, and it is ChatGPT's share link:**
freeze the output at share time, serve that snapshot to anybody, require an account for anything that
would call the model again. Ours reads live rather than freezing, which is better — an owner who
regenerates a summary wants the shared link to show the new one — but it is worth knowing the
snapshot design exists and is the one documented answer to *"how do you show AI output to a stranger
without paying for it again"*.

**The call to action is "make a free account", not "unlock this page".** The New York Times' own
reported figure is that free registration on its own lifted paid conversion by more than 40%, ahead
of any change to the meter. Substack pitches the ongoing free thing rather than the one document.
That settles the wording in [`src/messages.ts`](../../src/messages.ts): the ask is to join, placed
next to the specific thing the visitor just found they could not do.

**Nobody can tell us about the canonical tag.** No source specific to reader or annotation products
was found either way, so [§ The one tension](#the-one-tension-in-that-list-said-out-loud) rests on
general SEO practice and should be revisited once a document or two is actually public. Likewise the
copyright posture: nothing found says whether a Readability-extracted rehost sits where an ordinary
user upload sits, and [§ Rights](#rights-and-takedown-the-thing-a-canonical-tag-does-not-fix) wants a
real legal read rather than an inference from Instapaper's policy.

**Three sentences, and Notion is the worked example of collapsing them into one.** Unpublishing a
Notion page makes every old link land on a plain 404 — *"page could not be found"* — with no
distinction drawn between never existed, was unshared, and you may not see it. The products that get
it right **name the cause**: Loom says *"Due to the privacy settings for this video, it cannot be
played here at this time"* and offers Request Access, which tells you the thing exists and the
boundary is permission; Google Docs pairs *"View only"* with *"Request edit access"*, which is the
same move. That is the model for
[§ "Not generated yet" is a real screen](#not-generated-yet-is-a-real-screen-not-a-gap). Our third
sentence — *nobody has built a glossary for this piece yet* — has **no precedent at all**, because
none of these products has a pipeline that can simply not have run. We are writing that one from
scratch.

**Our confirmation dialog is deliberately stricter than anybody else's, and that is a choice worth
naming.** No product researched gates the moment you flip a document public behind an interstitial.
Google Docs discloses inline — *"When you share a link to a file, your name and email will be visible
as the owner of that file"* — and Notion, Figma and Readwise show no warning at all; Readwise's whole
control is a menu item reading *"Enable public link on web"*. The reason we are stricter is that they
are all publishing **the owner's own document** and we are republishing **somebody else's article**.
The rights question in [§ Rights](#rights-and-takedown-the-thing-a-canonical-tag-does-not-fix) is
ours and not theirs, so the norm does not transfer.

**And one place we would be more candid than the whole field.** Not one product, to either the owner
or the visitor, says that unsharing cannot claw back a page already loaded in somebody's browser.
Every one of them describes revocation purely as the next request being refused. Saying it plainly is
not copying a pattern — it is going further than the precedent, which is the right call and should be
recognised as a decision rather than a default.

And three that confirm rather than change:

- **Do not gate the prose.** Every product that hard-walled logged-out reading either reversed it or
  kept paying for it. Twitter's 2023 login wall took its Google index from 471 million pages to 180
  million and it was quietly reversed within days; Quora never reversed and is still complained
  about. Greg's first decision — the full article, same as the owner — is the one with the evidence
  behind it.
- **Nothing about the owner.** No researched product puts the owner's identity in front of an
  anonymous viewer by design. Google Docs is the exception and only because the document *is* the
  owner's own file being handed over.
- **Opt-in, per document, before the public surface exists.** Bluesky's 2023 backlash was not about
  being public by default; it was shipping the logged-out web view *before* giving existing users the
  toggle. Ours is off by default and ticked by hand, which is the other order.

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

It becomes a two-step, in both directions: with a session, ask the owned route and fall back to the
public one on 404; with no session, ask the public route directly. A public 200 renders the reader
against public data sources with read-only chrome. A public 404 renders `LandingPage` for a stranger,
exactly as now, and *"this document isn't shared"* for somebody signed in — who has already proved
they are a person, so there is nothing left to protect by showing them the pitch instead of the
answer.

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
things you cannot do and why; sign up.

**Mark the controls, do not hide them — but the reason cannot live only in a tooltip.** The
predecessor's *"clear 'pro' badges on unavailable features"* is the better pattern and we already own
the visual convention for it: the dimmed row that `Dock.tsx` and `Metadata.tsx` use for *not built
yet*, saying *not yours yet* instead. A hidden button teaches a visitor nothing about what they would
be signing up for.

**The tooltip half of that convention does not carry over, and the research says so plainly.**
Nielsen Norman's rule is that a tooltip must never be the only place information a person needs
lives — *"Important information should always be on the screen; therefore, tooltips shouldn't be
essential for the tasks users need to accomplish."* And the specific case of a disabled control is
worse: a hover tooltip is not reachable by touch or by keyboard at all, so on a phone the dimmed
control would simply be a dead thing with no explanation. For a signed-in reader meeting *not built
yet*, a tooltip is a supplement to something they already understand. For a stranger meeting *not
yours yet*, it is the entire message. So the reason goes in **visible text beside the control**, and
the tooltip, if it stays, adds to it rather than carrying it. Each one routes to signup with its own
reason, so the pitch is specific — *"Chat with this article — make a free account"* rather than a
banner the eye stops seeing.

**Keyed on "is this mine", not on "am I signed in".** A signed-in reader on somebody else's public
document sees the same read-only chrome as a stranger.

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
| **A signed-in reader who does not own a public doc gets the article**, not a 404 and not a personalised response. Byte-identical to what a stranger gets. | Serve it through the owned path by mistake; the two responses must differ, and the test must catch it. |
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
- **Not a third way to read an article.** `/api/public/` is a second path and that is one more than
  is comfortable — the predecessor's `/share` route was exactly this and it bypassed everything.
  Two, both audited, and no more.
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

## Progress

**Stage 1a, the server half, is built and committed** — 2026-08-28, nineteen files, nine commits
from `f6d5d98` to `4bbed5d`. What exists: the migration, `PUT /api/article/:slug/visibility`,
`publicSlug()`, a hardwired public reader, the closed `/api/public/` namespace with
`GET article/:slug` and `GET metadata/:slug`, allowlist DTOs, the branded `VerifiedUser` and the
`serveApi` split, and seven test files. Typecheck is clean across all three projects.

### What the build changed about the plan

**The slices were cut the wrong way, and Sol recut them.** This plan proposed server-then-client.
That would have shipped 1a as a live public namespace and a visibility switch with no UI to set it —
infrastructure, not a feature, and a dark deployment rather than a shippable slice. The cut is
**vertical** now: 1a is article and metadata end to end, including the client, so the thing that
ships is *send someone a link and they can read it*. Glossary, summaries, ideas and tweets become 1b,
each landing with its own projection and its own tests. Do not land six DTOs behind an unused
namespace for symmetry.

**A required `user` parameter is not a boundary.** The plan asked for `serveAuthenticatedApi` to be
callable only after `requireUser`. A required parameter prevents *omission* but accepts any object of
the right shape, which does not encode *"came from the gate"*. What was built is a branded
`VerifiedUser` whose private symbol `requireUser` alone can add, plus a runtime assert at the
boundary so a JavaScript caller or an `as never` fails there rather than three layers down.

**Five modules, not one `src/public.ts`.** [`src/store/public-slug.ts`](../../src/store/public-slug.ts),
[`src/store/public-reader.ts`](../../src/store/public-reader.ts),
[`src/public/routes.ts`](../../src/public/routes.ts), [`src/public/dto.ts`](../../src/public/dto.ts),
[`src/public-types.ts`](../../src/public-types.ts). `publicSlug` gets its own file for a better reason
than tidiness: putting it beside `ownedSlug` would make the public leaf import `currentOwnerId`,
which is exactly the dependency public reads must not have.

**The public reader takes no predicate, and that is the point.** `ownedSlug` and `publicSlug` have
the same Drizzle type, so a shared helper that accepts a `where` — or a `scope`, or a
`{kind: "owned" | "public"}` — compiles perfectly with the wrong one passed in, and one careless call
site becomes an authorization decision. The public reader hardwires `publicSlug` and accepts nothing.
The cost is some duplication between the two readers, which is the failure mode that fails locally
rather than silently.

**The public dispatcher is never handed the request object** — an improvement on what Sol specified,
which was one shared envelope carrying `req` for both halves. It gets `{res, path, method}`. So
*"the public routes ignore `Authorization`"* stops being a rule somebody has to remember and becomes
a thing with no way to be expressed: there is no header to read, no body to parse, no cookie in
scope. This is the shape to preserve if the namespace ever grows.

**Public blocks need their own column list, not a projection afterwards.** `blocksQuery` in
[`pg.ts`](../../src/store/pg.ts) selects per-block `note`. Projecting it away after fetching it is
strictly weaker than never selecting it.

**And two hazards of this tree, both hit rather than predicted.** The migration lane is busy: 0023
was taken by another agent fourteen minutes before this work needed a number, while the journal was
mid-update, so the number has to be re-checked immediately before writing *and* again before
committing. And `src/routes.ts` turned out to be a file two agents needed at once — an error-monitoring
change was written against this dispatcher split and could not compile without it, so it committed
the file, carrying 338 lines of this work under its message. Nothing was lost and the attribution is
recorded in the next commit, but the working agreement only covers one direction: it protects a peer
from your commit message and says nothing about your finished work landing under theirs. Whoever
takes 1b will meet it on the same file.

### The client half, built 2026-08-28 in `3120d71`

Eleven files of source and seven of tests. The two-step fetch, the capability seam, the read-only
chrome, the four sentences, and the owner's Access & Sharing card. What it changed about the plan:

**A `readOnly` prop was never going to work, and the seam is three component boundaries.** Sol's
answer 8 said so and was right about the size of it. `useComments`, `useChatAnchors` and
`useGlossaryRead` now mount in [`OwnedReader`](../../src/web/App.tsx); the record-open POST and the
rename overlay in `OwnedArticle`; and `Reader` takes a discriminated
[`ReaderCapability`](../../src/web/reader-capability.ts) whose visitor arm has **no `comments` field
to be empty** — there is nothing there for a later edit to read. `Metadata` and `Tweets` are
unreachable from the visitor path; [`PublicPages.tsx`](../../src/web/PublicPages.tsx) stands in.

**`resolveAccess` is split in two so `sanitizeArticle` is called exactly once**, on both paths. A
public payload is the same extracted HTML reaching `innerHTML` by the same route, and the guard in
`tests/sanitize-client.test.ts` had been reading a setter's name — which had already gone stale once
and went stale again here. It reads the doorway now.

**A marked control opens its band, and the band carries the reason in visible text.** NN/G's rule is
that a tooltip may never be the only carrier of information somebody needs, and a hover tooltip is
out of reach of touch and keyboard entirely — so a dimmed button whose only explanation is a `title`
is, on a phone, a dead thing with no explanation. The four sentences are decided by one pure
function, [`visitorGap`](../../src/web/visitor.ts), so that they can be tested apart; the marked set
is derived from `MODES`, so a ninth mode is marked whether or not whoever adds it remembers.

**A fourth sentence was needed and the plan had three.** `PublicMetadata.available` tells *nobody
built one* apart from *we do not carry it on a shared link yet*, and collapsing those would either
libel somebody's article or promise that an account fixes something only slice 1b can. The sign-up
line is withheld on the second, for the same reason.

**Two gaps, both server-side, both for 1b.** The confirmation dialog cannot *name* which artefacts
were personalised: `profileHash` is stored on every one of them and no owner endpoint exposes it
(`ArticleMetadata` is stages, timings and byte counts). And there is no way to *read* an article's
visibility — the sharing card asks `GET /api/public/metadata/:slug` anonymously, which is the only
non-mutating question available and is also the honest one, but it cannot see `public_at`.

**Diagram is marked whole**, though its default picture is free and drawn from the tree already on
the page: `DiagramPanel` mounts `useSimilar` and `useProjection` for its other two, both POSTs that
spend. Carving the free picture out of a 1700-line panel is not this slice's work.

### The browser pass, 2026-08-28 — and what only eyes could find

A Sonnet agent drove the finished slice in Chrome: published a real article through the real
endpoint, read it signed out, signed in as a second unrelated account, and looked at it at phone
width. **Verdict: it reads right to a human.** The judgement that mattered most was the one no test
can make — *does a dimmed control read as deliberately unavailable, or as broken?* Honest first read,
before reasoning: **deliberate**, because the marked modes keep the same shape and icon at reduced
opacity and a first press explains rather than doing nothing. That is the payoff for keeping them
pressable rather than disabling them, and for moving the reason out of a hover tooltip.

Four things it found that every test had passed over, all of them **silent gaps rather than visibly
broken UI** — the kind that look fine in a screenshot:

- **A drawer heading that contradicted its own body.** A visitor saw *"Your comments"* directly above
  *"Comments belong to whoever added this article."* Fixed by making the title depend on the same
  capability everything else does: `Your` is the word that does not survive the visitor arm.
- **Copy drift between a tooltip and the band it opens.** Two sentences for one fact, a few words
  apart, in two places. The fix removed the second string rather than aligning it — the tooltip is
  now a preview of the band's own sentence, and a test pins them equal.
- **The call to action offered a free account to somebody already signed in.** The chrome keys on
  *is this mine*; the **call to action** is the one place where *am I signed in* is the right
  question. The *reason* is still shown to everybody, because it is a fact about the page; only the
  ask is conditional.
- **The "nobody has built one yet" state had never been rendered by anything but a unit test**,
  because the test article had every artefact. Its fixture is now asymmetric on purpose — one
  artefact present, one absent, in one article in one run — which is the only arrangement in which
  *"these two blurred into one"* is visible at all.

**And a fifth that was a real bug when the pass ran and had been fixed an hour earlier.** *"Shared
since"* rendered only after the toggle and vanished on reload. The commit that fixed it landed at
13:41; the pass had published at 13:34. Worth recording anyway, because the finding paid for itself:
the card's own test mounted the component and **passed `sharing` in by hand** — which is exactly what
the broken version could not do for itself. So the whole class of wiring bug between the page and the
card was untested. There is now a test that mounts the page, stubs its fetch, and asserts the line on
**the first paint after the fetch with nothing pressed** — the state a reload produces.

**The open decision, and it is Greg's.** The masthead — title, byline, the `VIEW ONLY` chip, the mode
switcher — is `display:none` below about 900px. That is the pre-existing limit
[browser-testing.md](../project/browser-testing.md) already records rather than anything this feature
broke. But a shared link is opened on a phone more than anywhere else, and the chip is **the only
piece of that chrome that is a statement about permission** rather than a control reachable another
way. The shared-article notice card still carries the fact, so nothing is lost outright — but it
scrolls away, and the chip was put in the controls bar precisely because that bar is sticky. So the
question is narrower than "is the mobile masthead acceptable": **does *this page is not yours to
change* need to be visible at every scroll position, or only on arrival?** If arrival is enough,
nothing needs building.

### The client half went to Sol and came back BLOCKED

The server half was reviewed and returned no blockers. The client half returned **three**, and they
are worth reading because all three came from the same place, which the agent that built it named
better than the review did:

> The seam is right in the components I was thinking about, and leaks in the ones I was not.

**One reader's article on another reader's screen.** `useArticleAccess` keyed its answer by slug and
by the *boolean* `signedIn` rather than by *who*. Owner A signs out, reader B signs in, and A's
private article stays mounted — the key never changed. Every server-side guard in this feature is
blind to that, because it happens after the data has arrived.

**A hover left the namespace.** Every visitor mounted `ProseHoverCard`, four lines below the
carefully-built capability union; it mounts `useLinkFacts`, which calls `apiFetch("/api/library")` and
Wikipedia. So *"a signed-out browser issues no request outside `/api/public/`"* — the acceptance
criterion of the whole client half — **was already false on the most ordinary interaction there is.**
The trace missed it because the trace never hovers, which is the answer to the question the review was
asked: *what can this test not see?*

**A lost response was reported as no change.** The card's catch correctly admitted a write might have
committed before its reply was lost, and then drew *"Whatever it was before is unchanged"* — telling
an owner their public article is private. The route writes and then reads back to build its reply, so
**every failure mode after the write leaves the write standing**. The fix splits *unknown* by whether
we asked at all. And `readJson` returns `{}` for a 204, so an unparseable success was reaching
`visibility === "public"` as `undefined` and coming out `private`.

**The fifth state.** Three of the four visitor sentences turned out untruthful at the edges: a failed
metadata fetch rendered *"There is…"*, `/tweets` announced a thread the wire said was absent, and a
signed-in non-owner was told chat is *"for signed-in readers"*. There are five states now, and the
test does **not** assert the union has five members — a union can grow a member that says nothing new
— it compares the sentences and asserts only the knowing one claims *"There is"*.

**And the copy now survives stage 3.** *"Chat is for whoever added this article"* stays true when a
second reader holds the same document; *"for signed-in readers"* would not have. The account pitch
stopped promising this article's chat, glossary and shelf entry, none of which an account provides
until [§ Stage 3](#stage-3-one-article-many-readers).

**One finding of the review was wrong**, checked rather than accepted: `%2F` in a slug is not a
traversal. `URL` leaves an encoded slash in the pathname, so the path reaches `isPublicNamespace`
unchanged and stays in the closed room. `../` really does escape — `/api/public/../article/x`
normalises to `/api/article/x` — and that one is refused. Rejecting `%2F` would refuse a slug that
legitimately carries one, so it is kept as a **passing** case with the reasoning attached, precisely
so nobody defends against it later.

### Three more things the build taught us

**A network trace tests where the hooks are, not what the component believes.** The client half's
acceptance test is a network trace, and it is the right test — but when the agent building it handed
`OwnedReader` a *visitor* capability as a red-first check, **every trace assertion still passed**,
because the hooks are called in `OwnedReader` either way. The trace can prove no private request went
out; it cannot prove the component knows which mode it is in. That needs a second assertion on what
is rendered — *"View only"* appearing on the owner's page is the break that fires. Any future
capability seam wants both.

**A control can be dead on both sides of the comparison.** The acceptance criterion was *"leave
`useJobs` mounted and watch the trace show the polling"*. `useJobs` lives inside the glossary, summary
and ideas bands; the default address is the table of contents, which mounts no band. So the control
ran on neither side and proved nothing, and it took a second look to notice. The fix was to open
`?mode=glossary` as the owner and require `GET /api/jobs` in the trace. **The check that guards a
check needs its own positive control**, which is [silent-success.md](../reusable/silent-success.md)
one level up.

**A table can be reached three ways, and only one of them is an import.** The
[§ child-table gap](#the-seam-a-second-predicate-not-a-wider-one) above is closed by a guard over
`src/public/` and `src/store/public-*.ts` naming the four tables a public module may touch. Building
it turned up a third route neither the plan nor the review had named: `src/db/client.ts` does
`import * as schema` because `drizzle(pool, { schema })` needs it, so
`getDb().query.glossaryLookups.findMany()` reaches any table **with no import at all**. Raw SQL is the
second. All three are now matched, by their *qualified* spellings — `spideryarn.comments` and
`.query.comments` rather than bare `comments`, because `jobs`, `comments` and `uploads` are ordinary
English words and a guard with known false positives is one people learn to wave through.

And the way it was found is worth as much as the guard: not by thinking harder, but because exempting
`db/client.ts` forced somebody to explain *why* that file needs the whole schema. **An exemption that
makes you justify it is worth more than one that just unblocks the run.**

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
- [public-access-how-others-do-it.md](../research/public-access-how-others-do-it.md) — how X, Bluesky,
  Notion, Figma, Readwise and ChatGPT draw this same line, and what it cost the ones who got it wrong
- [public-read-only-access-review-sol.md](public-read-only-access-review-sol.md) — the review in full
- [public-read-only-stage1-input-sol.md](public-read-only-stage1-input-sol.md) — Sol's design input
  for the build, which is the specification stage 1 is being written against
