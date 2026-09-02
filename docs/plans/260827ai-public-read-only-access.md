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
[260825f-postgres-migration.md](260825f-postgres-migration.md) is the parent piece of work; `SPIDERYARN_STORE` still
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
| `article` | **`meta.title` may be the owner's private rename** — both stores run it through `titleFor()` before returning it. Also `fetchedAt`; the extraction `note`; per-block `note`; the comment count; and the PDF/upload provenance block (`source`, `method`, `pages`, `rawSha256`, `unverified`, `recall`, `pagesChecked`). **`meta.url` was on this list and came off on 2026-08-30** — see § The source URL is published now, below. |
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
*world-readable* and *visibility* turns up one row, in [260825e-metadata-page.md](260825e-metadata-page.md)'s table
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
[260828a-public-access-how-others-do-it.md](../research/260828a-public-access-how-others-do-it.md); four findings
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
[260825e-metadata-page.md](260825e-metadata-page.md) recorded and deliberately dropped — *"**drop** — no accounts
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

### Slice 1b — the rest of what the owner already has

*Planned 2026-08-28, after 1a shipped. A visitor gets the glossary, the summaries, the ideas and the
tweet thread — the four artefacts the owner has and a shared link currently withholds.*

Today a visitor reads the prose, the tree, the spine, the table of contents and the granularity zoom,
and the arc rides along inside the article payload. Everything else is **marked** — dimmed but
pressable, opening a band that says why. One of the four sentences it can say is `not-yet-public`,
whose comment in [`visitor.ts`](../../src/web/visitor.ts) reads *"It exists, and slice 1b has not
shipped the public endpoint that would carry it."* **This slice is what deletes that sentence.**

#### Three decisions Greg made on 2026-08-28, and the design GPT Sol gave that two of them overruled

Sol's design input for this slice is in
[260828al-public-read-only-stage1b-input-sol.md](260828al-public-read-only-stage1b-input-sol.md). It is careful and
most of it is adopted. Two of its central recommendations were put to Greg as tradeoffs and he took
the simpler side of both, which is recorded here rather than in a commit message because
[CLAUDE.md](../../CLAUDE.md) asks for exactly this — the decisions that went **against** the
recommendation written down at the time.

| Question | Sol's answer | Greg's decision |
|---|---|---|
| How many new endpoints? | **Four** — `/api/public/glossary/:slug` and three siblings, so opening Summary never downloads a glossary | **None.** The four artefacts are four JSONB columns on the same `article_revisions` row the article read already fetches. They become four optional keys on the existing `GET /api/public/article/:slug` response. |
| Tell a visitor an artefact was written for somebody's reading profile? | **Yes** — a `personalised: boolean`, rendered as one line | **Not now.** One field and one sentence, addable any time. Nothing is lost by waiting. |
| Say who shared it? | not asked | **Not now, and recorded as a later stage** — see [§ Attribution](#attribution-is-open-again-and-it-is-not-a-display-change) below. |

**What "no new endpoints" removes, which is the point of it.** Sol's four-endpoint design needed a
tagged wire result (`{status: "ready" | "not-generated"}`), a four-state client type
(`PublicArtefactRead<T>` — loading, ready, not-generated, unavailable), four route-inventory entries,
four projections, four public reader methods, four client hooks, and twelve wire states to test.
Folding them into the payload the page already has removes **all** of it: an artefact that exists is a
key that is present, and one that does not is a key that is absent. There is no second request to be
in flight, to fail, or to disagree with the first.

The cost Greg accepted is that the reading page's first payload gets bigger. That is measured rather
than assumed, and the measurement corrected which artefact the cost is in — see
[§ What the payload actually costs](#what-the-payload-actually-costs).

**And it makes the slice one piece of work rather than three.** Sol proposed four independently
deployable vertical slices, summary first as the pattern-setter and glossary second because it
carries the hazard. That ordering was right for four endpoints and is moot without them: there is one
projection to write, four times, into one response.

#### `stale` and `outdated` do not cross, and that is mine rather than Greg's or Sol's

Sol's DTOs keep both, and then three sections later list *"freshness imports"* as the single most
likely thing to bite. Both readings are correct and they do not sit together. `stale` is computed by
`glossaryIsStale`, `summariesStale`, `tweetsStale` and `ideasAreStale`, and
[`pg.ts`](../../src/store/pg.ts) imports all four **from the writer modules** —

```ts
import { isStale as glossaryIsStale, PROMPT_VERSION } from "../glossary.js";   // pg.ts:44
import { isStale as summariesStale } from "../summarise.js";                   // pg.ts:58
import { isStale as tweetsStale } from "../tweets.js";                         // pg.ts:59
```

— which are exactly the modules [`tests/public-imports.test.ts`](../../tests/public-imports.test.ts)
forbids the public graph from reaching, because they pull in the model machinery. Carrying `stale`
publicly therefore means extracting four `isStale` functions and two version constants into
import-free leaves, across four writer modules, in a tree several agents are editing.

Not paying that here, for three reasons, in increasing order of how much they matter:

1. It removes Sol's own top-listed hazard outright rather than defending against it.
2. Ideas' freshness check also needs the revision's `tree`, so dropping it drops a read as well.
3. **A visitor cannot act on it.** `stale` and `outdated` both mean *the owner might want to
   regenerate this*, and the owner is the only person who can. It is a control surface rendered for
   somebody with no control.

If we later decide a visitor should be told *this summary may not describe the prose you are reading*
— which is the honest half of `stale` and is a real thing — it comes back as a deliberate decision
with its own sentence, not as a field inherited because the owner's response had one.

#### What lands

**Server.** Four allowlist DTO functions in [`src/public/dto.ts`](../../src/public/dto.ts), built the
way `publicArc` and `publicTree` already are — **constructed field by field, never filtered** — four
more columns in the public reader's `select`, and four optional keys on `PublicArticle`. No new
route, no new file, no change to [`route-names.ts`](../../src/public/route-names.ts).

The allowlists are Sol's, checked against the real types, minus the provenance it agreed to drop and
minus the freshness fields above:

| Artefact | What crosses | What must not |
|---|---|---|
| `glossary` | `entries[]`: `id`, `name`, `kind`, `aliases`, `senseHere?`, `background?`, `gloss?`, `detail?`, `url?`, `difficulty?`, `centrality?`, `fromOutside?`, `blocks` | `version`, `generator`, `slug`, `sourceHash`, `profileHash`, `passes`, `generatedAt`, `elapsedMs`, and **every `entry.lookup`** |
| `summary` | `entries[]`: `range`, `depth`, `short?`, `long?`; plus `missing` | the same six, and **`guidance`** |
| `ideas` | `ideas[]`: `id`, `name`, `provenance`, `statement`, `whyYouNeedIt?`, `analogy?`, `occurrences[]` (`blockId`, `quote`, `reasoning`, `start?`) | the same six |
| `tweets` | `limit`; `tweets[]`: `text`, `chars` | the same six |

Three of those need saying out loud because a reviewer will ask:

- **Entry ids cross.** `?term=` links, prose-to-entry selection and entry-to-block navigation all
  need a stable identity, and the client would otherwise invent an unstable one. Carrying an id does
  **not** carry its lookup: `glossary_lookups` stays unreachable, and the four-table guard is what
  makes that a fact rather than an intention.
- **The three superseded glossary fields — `gloss`, `detail`, `fromOutside` — stay**, because older
  stored artefacts still have them and the client still renders them.
- **`missing` crosses** on summaries. It is the reader's only sign that an apparently complete
  summary is partial, and withholding it would make a gap look like a whole.

**The one thing that cannot be fixed by a projection, restated.** Summary text is *derived* from
`guidance`. Dropping the field stops direct disclosure; it cannot make the prose neutral, because a
model may follow or even echo the steer. That is Greg's settled stage-1 position — publish the
artefact the owner has — and it is [§ The leak that no projection
fixes](#the-leak-that-no-projection-fixes), not a new problem. Stage 4 is the real answer.

**Client.** The bands stop being owner-only. What makes this small is that **there is no fetch to
add**: the artefacts arrive in the payload `VisitorArticle` already holds, so the visitor arm of
[`ReaderCapability`](../../src/web/reader-capability.ts) gains data rather than a loader, and the
four-state read union Sol specified is never needed.

The seam stays what 1a established and what Sol restated: **a hook cannot be called conditionally**,
so ownership is decided at a component boundary. But only the *hooks* need two components. One
presentational band per mode, with its data injected, is the version with fewer parts touching each
other — and it is what keeps the owner's band and the visitor's band from drifting into two designs
for one thing, which is the failure the browser pass caught in a drawer heading.

**And `not-yet-public` is deleted in the same slice** — the union member, its sentence in
`src/messages.ts`, its `FIXED_BY_AN_ACCOUNT` entry and its rendering branch. Every remaining cause is
one of the other four: `arc` is already public, `diagram` and Search and Chat and Review are
`owners-only`, comments are `readers-own`, a missing artefact is `not-built`, and a failed read is
`availability-unknown`. Nothing is left for it to describe, and a union member with no cause is a
sentence waiting to be shown by mistake.

`tests/visitor-gaps.test.ts` deliberately does not assert the union's member count — a union can grow
a member that says nothing new — so it asserts **policy** instead: an artefact the piece has returns
`null`, one nobody built returns `not-built`, a cost mode always returns `owners-only`, and
`markedModes()` excludes what a visitor can now have. *(Written before the build. The draft of this
sentence also said "an unknown one returns `availability-unknown`", which was a member the same slice
deletes — see [§ 1b, as built](#slice-1b-as-built-2026-08-28) for what the tests ended up asserting.)*

#### Attribution is open again, and it is not a display change

Greg's sixth decision was *the public page says nothing about the owner*. On 2026-08-28 he reopened
it as a **future** stage rather than this one:

> Maybe we might want to show who the owner is in future.
>
> — Greg, 2026-08-28

Nothing in this slice changes, and nothing built here blocks it. What it would cost, written down now
so the next person does not rediscover it:

- **We have no public name for anybody.** Readers are identified by email. Showing an owner means a
  display-name field on the profile first, and a decision about what a visitor sees for somebody who
  has not set one.
- **Opt-in per document, or per account?** Sharing an article and putting your name on it are two
  consents, and the research says so: no product surveyed puts an owner's identity in front of an
  anonymous viewer by design except Google Docs, where the document *is* the owner's own file.
- **It does not go in the public payload until something renders it.** Carrying an owner id or name
  ahead of a consumer is the leak the DTO rules exist to prevent — *a field nobody displays is a
  field nobody checks* — and the plan already names a public query that selects an `articles` row
  wholesale as the danger. Cheaper to add when there is a byline to fill.

#### What the payload actually costs

Measured on 2026-08-28 rather than argued, against the filesystem store in `data/`, which still holds
real articles from before the Postgres move. Raw JSON bytes on disk — so **before** the DTO strips
provenance and before gzip, both of which only help.

| Article | `blocks` + `tree`, shipped today | the four artefacts | new total | increase |
|---|---|---|---|---|
| `noema-mythology-of-conscious-ai` — the only one with all four | 204 KB | +67 KB | 271 KB | **+33%** |
| `constitution` — the largest | 483 KB | +21 KB | 504 KB | +4% |
| `writes` — a small one | 22 KB | +19 KB | 41 KB | +87% |

**The glossary is not the expensive one, and the tradeoff was put to Greg saying it was.** A glossary
runs 2.5–12 KB. **Summaries are the biggest addition at 37 KB**, because they carry a short *and* a
long text at every depth of the tree, and there are many nodes. The decision does not change — a
third larger, worst case, on a payload already dominated by `blocks`, which we ship either way — but
the reason given for the cost was the wrong reason and is corrected here.

The percentage is largest on the *smallest* article, which is the right way round: +87% of 22 KB is
19 KB, and the articles where a third matters are the ones where a third is 67 KB.

#### The second request disappears, and two sentences with it

`findArticle` in [`App.tsx`](../../src/web/App.tsx) makes **two** requests for a visitor today:

```ts
const read = await loadPublicArticle(slug);
if (read.kind === "not-shared") return { kind: "not-shared" };

const available = await loadPublicMetadata(slug)          // ← the second one
  .then((m) => (m.kind === "ok" ? m.body.available : null))
  .catch(() => null);
```

The second exists for one reason: the `available` flags decide which of two true sentences a marked
mode shows. **Once the artefacts are in the payload, the payload answers that** — an artefact that
exists is a key that is present. So the request goes, and its swallowed `catch` goes with it.

And that kills a second union member. `availability-unknown` was added on 2026-08-28 because a failed
metadata fetch was being rendered as a claim about somebody's article — *"There is…"* — which is the
right fix for the code as it stood. With no second fetch there is no failure to represent: either the
article payload arrived, and we know exactly what it holds, or it did not, and the reader never
reaches a mode because the page renders *this document isn't shared* instead.

So `visitorGap` loses **two** of its five members in this slice — `not-yet-public` because every
artefact is now public, and `availability-unknown` because the question it hedged can no longer fail.
What remains is `not-built`, `owners-only` and `readers-own`, and those three are causes rather than
uncertainties.

**Deleting a defensive state deserves more suspicion than adding one**, so the reasoning above is the
thing to attack in review, not the diff. The claim being made is narrow and checkable: *there is no
path on which a visitor is rendering a mode and does not know whether its artefact exists.*

**`GET /api/public/metadata/:slug` stays.** The client stops calling it; the endpoint is not deleted.
It is tested, it is in the route inventory, and it is the honest small answer to *what does this
article have* for any later consumer — stage 2's link-preview function among them. Removing a working
public endpoint to save nothing is churn, and the win here was never the route: it was the request.

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

#### The three slices, and why in this order

From [Sol's stage 2 design](260828ao-public-read-only-stage2-input-sol.md) § 9, adopted:

1. **Unfurls, still `noindex`.** The compiled shell, the `/read/:slug` rewrite ahead of the SPA
   catch-all, the public head query, safe tags, the 404 default shell, `no-store`, `HEAD`, a shell
   digest, and a deployed browser check. **The global `noindex` and `robots.txt` stay exactly as they
   are.**
2. **Public pages may be crawled.** Split the static headers, let the function own robots per
   request, and change `robots.txt`.
3. **Anonymous resume.** The visitor-only `localStorage` layer. Shares no server logic with the other
   two and must not hold them up.

The order is the point: slice 1 makes a shared link preview properly **without** changing crawler
exposure at all, so it is a complete user-visible result rather than build infrastructure sitting
unused waiting for a policy decision.

**Slice 2 was deleted on 2026-09-02**, not deferred. The canonical tag points at the original, so
the ranking value of a crawlable copy is near zero, the rights exposure of one is real, and the two
marketing surfaces that matter — link previews and word of mouth — already work under `noindex`.
Greg's decision, on GPT Sol's recommendation, in
[260902j-public-read-only-access-audit-and-improvements.md](260902j-public-read-only-access-audit-and-improvements.md).
If search traffic is ever wanted, that is a new decision with the publisher-complaint risk attached,
and the design notes below are still the starting point.

#### `robots.txt` says `Disallow: /`, and the plan had not noticed

Sol's largest finding, and it was missing from everything above. [`public/robots.txt`](../../public/robots.txt)
is `User-agent: * / Disallow: /`, and `vercel.json` sets a global `X-Robots-Tag: noindex, nofollow`.
The file's own comment already explains the pairing and the trap in it — *a crawler that obeys the
`Disallow` never fetches the page, so it never sees the header* — which means slice 2 is a change to
**two** things that do not reinforce each other, not one.

**That question was asked and answered before building anything, and the answer is *it depends on
the service*.** Whether slice 1 is worth building at all turns on whether a link-preview fetcher
obeys `Disallow: /`, and they do not agree with each other:

| | Under our current `Disallow: /` |
|---|---|
| **Slack** | **Fetches.** Slack's own robots page says plainly: *"We do not currently honor `robots.txt` files."* Their reasoning is that their robots act for a person who has just posted the link rather than crawling. |
| **Meta** — Facebook, Messenger, Instagram, WhatsApp | **Probably not.** `facebookexternalhit` accepts `robots.txt`, with an exception for security and integrity checks, and caches the file for up to 24 hours — so even after slice 2 the change would not take effect immediately. |
| **Twitter/X** | `Twitterbot` is documented as an ordinary well-behaved preview crawler; treat as respecting it until observed otherwise. |
| **Discord, iMessage** | Not established. Neither publishes a clear statement that was found. |

Sources: [Slack's robots page](https://api.slack.com/robots), and the vendor documentation summaries
for [`facebookexternalhit`](https://trakkr.ai/bots/facebookexternalhit/).

**So slice 1 is worth building, and it is worth less than it looks.** It delivers a working preview
in Slack on the day it ships and nowhere in Meta's apps until slice 2 lands and their cache expires.
Which is a question for Greg rather than a technical one: *where do you expect people to paste these
links?* If the answer is a group chat on WhatsApp, slices 1 and 2 should merge, because slice 1 alone
would be invisible there. If it is Slack and a DM, the order stands.

The general lesson, since it nearly went the other way: this was settled by reading what each vendor
says about its own bot, not by reasoning about what a preview fetcher *ought* to do. The two answers
would have been opposite, and "most preview fetchers are not crawlers" — which is what I believed
before looking — is right about Slack and wrong about Meta.

#### What already has a mutation that must make it red

Sol's § 7 gives a check and a mutation for each part, and the split between local and deployed is
the useful half. Local: head tags and escaping, body and asset references unchanged, a private title
never entering the output, the `root_gist` fallback, canonical query refusal, a stale client shell,
the API bundle carrying built assets, rewrite ordering as *written*. Only four genuinely need a
deployment: whether Vercel's rewrite actually matches in that order, whether the headers collide or
merge, whether the shell embedded equals the shell served, and whether `robots.txt` is served as
text/plain with the exact pair.

The one Sol flags as most important is the browser mutation: corrupt the compiled script URL, and
`curl` still returns 200 with the right title while the page is blank. A head test and a status code
cannot tell those apart.

#### Two constraints worth pulling out of the list

- **Never build `og:url` from `Host` or a forwarded header.** Use the fixed production origin, or an
  attacker-controlled host becomes public metadata.
- **`/read/:slug/metadata` and `/read/:slug/tweets` are separate live client routes.** The rewrite
  enhances the base reading URL only. Decide that deliberately rather than reaching for
  `/read/:path*` and capturing every nested route by accident.

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

**Stage 1a is built.** Two GPT Sol reviews of the built code, a black-box HTTP spike, and a browser
pass, all closed. Typecheck clean across three projects; `npm test` 4884 of 4891, the one failing file
belonging to another lane and passing in isolation. **The three decisions it raised were made on
2026-08-28 and all three are settled:**

| Question | Greg's answer |
|---|---|
| May a public page load the article's own third-party images and embeds, so those hosts learn somebody is reading? | **Yes, leave it**, and ship `Referrer-Policy: no-referrer` so they cannot learn *which* article. The exposure is what the reader would get visiting the original. No proxy, no placeholders — a visitor gets the full article, same as the owner, which is decision 1 at the top of this file holding under pressure. |
| Does the `VIEW ONLY` chip need a phone-width treatment, given the masthead is hidden below 900px? | **No. Arrival is enough.** The shared-article notice card renders at every width and tells a visitor once. Nothing to build. |
| Should `CLAUDE.md`'s commit recipe carry the pathspec caveat? | **Yes**, added — with the check that decides it (`git diff <file>`) and a pointer to the reproduction. |

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

**Two gaps were recorded here as 1b's work, and both were closed the same day** — this paragraph
said the confirmation dialog could not *name* which artefacts were personalised, and that nothing
let an owner *read* their own article's visibility. Both were fixed in `c2854f5` at 13:34, and this
sentence was written down as outstanding afterwards. `ArticleMetadata.sharing` now carries `visibility`,
`publicAt` and `personalised: StepName[]`, computed from non-null `profileHash` on the four
artefacts that can carry one, and listing only artefacts that actually exist. The stale version
survived one commit and is recorded here rather than quietly deleted, because **a plan that lists
work already done is worse than one that lists nothing**: the next agent believes it and builds it
twice.

**Diagram is marked whole**, though its default picture is free and drawn from the tree already on
the page: `DiagramPanel` mounts `useSimilar` and `useProjection` for its other two, both POSTs that
spend. Carving the free picture out of a 1700-line panel is not this slice's work.

### Slice 1b, as built, 2026-08-28

**Everything the section above specifies is built**, plus the two deletions. Fifteen files: five of
source on the server and client each, one new module, and the tests. `npm run typecheck` is clean
across all three projects for everything in this slice; the tree has other lanes' errors in it.

What the build changed about the plan, in the order it will matter to the next person:

**`tweetsGap` is gone, and `notBuiltGap` replaced it.** The plan has the tweets page asking a policy
function which of two sentences to show. That was right while the page only ever showed a sentence;
now it shows the **thread**, so it has to branch on whether the artefact is there — and TypeScript
will not narrow `artefacts.tweets` from the return value of a function. A `tweetsGap` beside that
branch would have been a second answer to a question already decided, which is exactly the shape Sol
caught in slice 1a when a constant claimed a thread the wire said was absent. So the page branches on
the payload key and takes its sentence from `notBuiltGap(what)`, whose noun table is shared with the
three modes. One fact, one wording, and the branch and the sentence are about the same object.

**The panels take a nullable `owner` group, and that is the whole client design.** The plan asked for
*"one presentational band per mode with its data injected"*. What that meant in practice: each of
`GlossaryPanel`, `SummaryPanel` and `IdeasPanel` now takes the list as one prop and an
`owner: UseX | null` as another. `null` is a visitor — no status, no job, no verbs, no lookup button —
and the same components draw the same list either way. `Thread` in `Tweets.tsx` went the same way,
split into a shared `ThreadCounts` and `ThreadPosts` with the owner's stale banner, provenance footer
and rewrite button left in the owner's page.

**But the bands really are two components each**, and the plan should have said so plainly rather than
leaving it to *"only the hooks need two components"*. `GlossaryBand` calls `useGlossary`;
`VisitorGlossaryBand` calls nothing. What stops them drifting is that everything between the hook and
the panel — three query parameters, the selection push, the resolved-occurrence effects — lives in a
`useGlossaryMode` / `useSummaryMode` / `useIdeasMode` hook that both bands call. The duplication is
six lines of wiring per mode, and the panel is one.

**A visitor's glossary terms are underlined in the prose.** Not called out anywhere in the plan, and
it falls straight out of the payload: `terms` in `Reader` reads the public glossary where the owner's
read would be, so a shared article carries its dotted underlines and its hover cards exactly as the
owner's does. It is the biggest visible win of the slice and nobody asked for it.

**An artefact that is empty needed a sentence.** *Absent* means nobody ran the step; a stored
`{entries: []}` means somebody ran it and it found nothing. Slice 1a could not reach that state —
everything was withheld — and slice 1b can, so `builtButEmpty` is a fifth reader-facing sentence in
[`src/messages.ts`](../../src/messages.ts). The rule that keeps the two apart is *presence of the
key*, never truthiness and never a length: a length test collapses them, and
`tests/visitor-gaps.test.ts` runs that mutation as its control.

**`availability-unknown` was checked before it was deleted, and the claim holds.** The narrow version
is: *there is no path on which a visitor is rendering a mode and does not know whether its artefact
exists.* A visitor reaches a mode only through `VisitorArticle`, which `ArticlePage` renders only for
`access.kind === "public"`, which requires the article payload to have arrived. A failed fetch is
`kind: "error"`; a 404 is `kind: "not-shared"`. Neither renders a mode. The two other visitor pages
take the same derived flags. `visitorGap` and `markedModes` take a non-optional `PublicArtefacts`
now, so the compiler asks the same question of every future caller.

**"Absent by default" is safe and it is not the same as correct, so both
projections grew a total-fixture guard.** `publicBlock` and `publicTree` drop
every field nobody named, which is why a field added to `Block` or `TreeNode`
next month cannot leak. What that reasoning does not cover is the field the
client *needs*: without `treatment` a visitor's copy numbers the apparatus as
part of the argument, so silently dropping it is wrong in a way "it fails
closed" cannot fix. `tests/public-dto.test.ts` now types its fixtures
`Required<Block>` and `Required<TreeNode>`, which stop compiling the moment
either type gains **any** field, optional or not, until somebody sets it — and
the recursive key-set assertion then says at once whether it crossed. The same
move `FIXED_BY_AN_ACCOUNT` makes in [`visitor.ts`](../../src/web/visitor.ts).

The `TreeNode` half looked impossible and is worth writing down. That type was
mid-flight in the footnotes lane — `treatment?` in the working tree, absent from
HEAD — so a `Required<TreeNode>` **literal** is red in both directions at once:
missing the field against one state of the repo, carrying an excess one against
the other. TypeScript's excess-property check fires on a fresh object literal
and not on a variable, so assigning the fields to a variable first keeps the
half that matters in both states: a new field not set is *missing* and is
refused; a stale name that the type no longer has is merely extra and passes.
That is the right way round — a stale fixture name is a tidy-up, an
unconsidered field in a public payload is a leak.

**One thing the slice fixed that was not in its scope.** `VisitorPage` passed `available={null}` to
its dock, hardcoded — so every dimmed button on the tweets page said *we could not check* about an
article the page had in hand. There is no `null` to pass now.

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

### Slice 1b, the server half, built 2026-08-28

Four allowlist projections — `publicGlossary`, `publicSummaries`, `publicIdeas`, `publicTweets` —
four more columns on the public reader's `select`, and four optional keys on `PublicArticle`. No new
route, no change to the route inventory, no new client fetch state, because there is no new request.

**The client half is written and is deliberately not in this commit.** It is entangled in
`src/web/App.tsx` with two other lanes' uncommitted work, and App.tsx imports two files —
`safe-area.ts` and `public-artefacts.ts` — that are untracked. See below: committing it would have
made the tree's existing breakage worse rather than better.

**Four controls run rather than reasoned about**, after the building agent went idle four times
without reporting and its checks had to be re-run rather than believed:

| Mutation | Result |
|---|---|
| `import { glossaryLookups }` in `public-reader.ts` | `public-imports` red — *"→ glossaryLookups"* |
| `sql\`… from spideryarn.glossary_lookups\`` | red — *"→ raw sql on glossary_lookups"* |
| `getDb().query.glossaryLookups` | red — *"→ db.query.glossaryLookups"* |
| `publicSlug(slug)` → `eq(articles.slug, slug)`, all five call sites | `public-reads` red on the missing `visibility = $2` |

All three routes to the owner's private lookups are caught **independently**, which is the property
the guard was built for and the first time all three have been watched firing in one run.

**A new guard, and the reason it exists.** `publicBlock` and `publicTree` drop what they are not
told about, which is the safe default and the reason they rebuild rather than pass through. But
*safe* and *correct* diverge for a field the client needs: without `Block.treatment` a visitor's copy
of an article numbers the apparatus as part of the argument. So the DTO fixtures are now typed
`Required<Block>` and `Required<TreeNode>` — a fixture that stops compiling the moment the type gains
**any** field, until somebody sets it and the key-set assertion tells them whether it crosses. Same
move as `FIXED_BY_AN_ACCOUNT` in [`visitor.ts`](../../src/web/visitor.ts), for the reason that file
gives: a new member should be a red compile rather than a silent default.

Watched failing three ways: dropping `treatment` from `publicBlock` reddens the key-set assertion,
copying `note` fires the canary, and adding a field to `Block` produces
`TS2741: Property 'spyaTempControlField' is missing … but required in type 'Required<Block>'`.

`Required<TreeNode>` is assigned through a named const rather than a fresh object literal, which
skips TypeScript's excess-property check and is what lets it compile against **both** HEAD and a
working tree in which the footnotes lane has added `TreeNode.treatment`. `publicTree` does not copy
`treatment`, and that omission is now an asserted decision — *"drops a tree node's treatment, which
is a decision rather than an oversight"* — so whoever lands the footnotes tree work meets it and
chooses.

### `npm run typecheck` cannot see that a commit is incomplete

Found while checking whether this slice was safe to commit, and it is much larger than this slice.
**HEAD did not compile**, with 16 errors across four files and three unrelated lanes:

| Broken at HEAD | Cause |
|---|---|
| `src/web/TableView.tsx` (11) | imports `./Lightbox.js` and `./zoomable.js`; neither file was committed |
| `src/web/App.tsx` (2) | imports `./safe-area.js`; not committed |
| `src/source-hash.ts` (2) | reads `TreeNode.treatment`; the `types.ts` hunk was not committed |
| `tests/block-roles.test.ts` (1) | passes `glossary` to `publicArticle`; `158467c` swept up this slice's test edit without the `dto.ts` change that makes it legal |

Every one is the same mistake and **every lane's gate was green when it committed**, because
`npm run typecheck` checks the *working tree*, and in a tree several agents share the working tree is
the union of everybody's unfinished work. The file a commit is missing is sitting untracked beside
it. So the gate agrees with the code for the same reason the code is wrong —
[silent-success.md](../reusable/silent-success.md) — and `git status` listing an untracked file is
the only signal, which is the line everyone is trained to scroll past.

This was found by checking HEAD out into a clean worktree and typechecking *that*, which is the only
version of the gate that answers the question actually being asked: **not "does my tree compile" but
"does what I am about to commit compile".**

The cheap check that would have caught three of the four, and that this commit was held against
before landing: for every file being committed, resolve its relative imports and refuse any that
`git ls-files` does not know. Run against `TableView.tsx` and `App.tsx` it names all three missing
modules immediately; run against this slice's server files it says nothing.

### The client half of 1b, and what waiting for a peer cost

Held back for most of a day, on one fact: `App.tsx` imported `./safe-area.js`, and `safe-area.ts`
was not in git. Committing would have named a file nobody else could resolve and re-broken `main` in
exactly the way [the section above](#npm-run-typecheck-cannot-see-that-a-commit-is-incomplete)
describes. So `src/web/public-artefacts.ts` went in **alone**, as `2f8439d` — a leaf with one
type-only import and nothing in `HEAD` referring to it, inert until the rest arrived, and, more to
the point, no longer sitting untracked where somebody else's `git add` could sweep it into their
message. That had already happened once this slice, to a test edit, in `158467c`.

The safe-area lane landed its own work in the meantime and the block dissolved on its own. By the
time the rest went in, `App.tsx`'s diff against `HEAD` contained **no** hunk that was not this
slice's: the peer work that had made it un-committable was committed, by the peer, under their
message. Greg had authorised sweeping their hunks in if it came to that; it did not come to that.

**The lesson is about the shape of the wait, not the wait.** A leaf can go early and should. What
cannot go early is the file that *names* the leaf, and in a shared tree the thing that decides when
it may go is somebody else's commit, not your own gate. The check that told us — resolve a file's
relative imports, refuse any `git ls-files` does not know — is what made the wait a decision instead
of a guess, and running it against the six files in this commit is what ended it.

#### What actually landed

| File | What changed |
|---|---|
| `src/web/App.tsx` | the second request and its swallowed `catch` deleted; three band hooks (`useIdeasMode`, `useGlossaryMode`, `useSummaryMode`) extracted so the owner's loader-fed path and the visitor's payload-fed path run the same code |
| `src/web/reader-capability.ts` | the visitor arm carries `artefacts` and a no-longer-nullable `available` |
| `src/web/visitor.ts` | `VisitorGap` loses `availability-unknown` — the state that existed only to hedge a request that no longer happens |
| `src/messages.ts` | `builtButEmpty(noun)`, because *ready and empty* and *never built* are different sentences |
| `tests/visitor-gaps.test.ts`, `tests/public-network-trace.test.tsx` | the gap table and the one-request assertion, both rewritten around the smaller union |

| `src/web/tree.ts` | `buildSummaryTree` now takes `{entries}` rather than a whole `Summaries`, because that is all it reads and a visitor's `PublicSummaries` has no generator, timings or steer |
| `src/web/IdeasPanel.tsx`, `GlossaryPanel.tsx`, `SummaryPanel.tsx`, `Tweets.tsx`, `PublicPages.tsx` | each panel's `Props` split so the artefact and the owner-only job controls are separate fields, and the visitor passes the first without the second |
| `tests/summarise.test.ts`, `tests/summary-expand.test.tsx` | follow the `Props` split |

`npm test` is green across 304 files and 5534 tests; all three typecheck projects are clean.

#### And then this slice made the mistake it had just written up

The first commit of the client half, `113ce17`, **did not compile at `HEAD`**, with nine errors — a
day after the section above was written about exactly this, by the person who wrote it. `App.tsx`
went in; the five panel files whose `Props` it had reshaped, and `tree.ts` whose signature it had
widened, stayed in the working tree. The gate was green here the whole time, for the documented
reason: this tree holds everyone's unfinished work, including my own.

The import check *passed*, correctly and uselessly — every file `App.tsx` imports was tracked. It
answers "can this file be resolved", and the question that mattered was **"can it be typechecked"**.
A reshaped `Props` in an already-tracked file is invisible to it.

So the check that actually works, and that both remaining commits were verified against, is neither
of those:

> Check `HEAD` out into a clean worktree, copy in the files you are *about* to commit, and typecheck
> that. Not "does my tree compile" and not "does `HEAD` compile", but **"does `HEAD` plus exactly
> this commit compile"** — which is the only version of the question with an answer you can act on
> before pushing rather than after.

Run that way it took two iterations to converge: five files fixed six errors and surfaced three more
in the summary tests, and `tree.ts` plus those two test files closed it. Both of those iterations
would otherwise have been a broken `main` that somebody else discovered.

### Mutation testing found the one state nothing had ever rendered

Run against the built slice on 2026-08-29, before the code review came back. Six mutations, each
applied in a throwaway worktree at `HEAD`, each reverted after the run.

| Mutation | Result |
|---|---|
| `artefactsIn` tests `?.entries?.length` instead of `!== undefined` | RED |
| `publicBlock` copies `Block.note` through | RED, 3 tests |
| `publicGlossary` drops `aliases` | RED |
| `publicSlug` drops the visibility predicate | RED, 6 tests |
| `builtButEmpty(noun)` returns `notBuiltYet(noun)` | **GREEN** |
| delete `IdeasPanel`'s built-but-empty branch | **GREEN** |

Four of the six are the guards doing their job. The two that stayed green are one finding: **the
built-but-empty state had never been rendered by any test**, so a visitor could have been told nobody
built a glossary that somebody had in fact built, and nothing would have gone red.

It is the same shape as the bug the browser pass found the day before — the "never built" case that
no test and no human had ever put on screen — one state along. And it is the state this slice's
central rule exists for: *presence, not truthiness, not length*. The rule was enforced at the flag
(`artefactsIn` goes red), and unenforced at the sentence.

Fixed by rendering it, in `tests/public-network-trace.test.tsx` — both artefacts that have the
branch, with the negative assertion as the load-bearing half. Three controls, each red and each red
*only on that test*: delete either panel's branch, or collapse the two sentences into one.

#### Two things the probe got wrong, which is why probes get re-run

Two more findings dissolved on inspection, and both are worth writing down because the first version
of this section had them as bugs.

**"An empty summary renders nothing."** The probe fixture was `{entries: []}`, cast past the
compiler. `PublicSummaries.missing` is **required**, so that fixture cannot occur — real data is
`{entries: [], missing: n}`, and `SummaryPanel` already draws "n sections got nothing back" for a
visitor. The cast is what made the invalid state look reachable.

**"`?mode=tweets` shows nothing."** Tweets is a *page*, `/tweets`, not a band mode. The probe opened
an address that does not exist. On the real page an empty thread reads "A thread, 0 posts", which is
honest, next to a "Copy the thread" button with nothing to copy — a dead button in a state the
pipeline may not be able to produce. Left alone deliberately: a branch guarding an unreachable state
is the kind of part Greg asked us not to add.

The general lesson is [reachability-is-not-handling](../reusable/silent-success.md) turned around.
A cast fixture can manufacture a state the type system forbids, and then the code's failure to handle
it looks like a bug rather than like a fixture that lied.

### The code review of the built slice, and the two guards that were not guarding

`docs/plans/260829c-public-read-only-stage1b-built-review-sol.md`, 2026-08-29. Five findings, every one
checked here by mutation before anything was changed, and four of the five confirmed as stated.

It cleared the part that matters most, and said so specifically rather than by silence: no DTO
disclosure — `Block.note`, glossary lookups, summary guidance, profile hashes, model and run
provenance, costs and timings are all excluded — the four new columns come from the same
`publicSlug`-filtered row with no new table route, and the extracted band hooks preserve the owner
path's ordering, dependencies and null handling.

**1 — the closed-import guard missed the spelling Drizzle actually writes.** The raw-SQL arm tested
`code.includes("spideryarn.glossary_lookups")`, and Postgres qualifies a table as
`"spideryarn"."glossary_lookups"`. The relational arm matched `.query.glossaryLookups` and not
`.query["glossaryLookups"]`. Both bypasses were confirmed green by mutation. This is the security
gate for the whole feature, and it was not enforcing what it says it enforces. Now matched in both
spellings, with the boundary after the name rather than after the closing quote, and verified against
six spellings — bare, quoted, spaced, dotted, bracket-double, bracket-single — all six red.

The one route left open is a computed key from a variable, `db.query[table]`. It cannot be closed by
reading the text, and it is written down in the guard rather than left for somebody to discover.

**2 — a summary that was run and came back empty was rendered as never written.** `hasLadder` is
`entries.length > 0`, so `{entries: [], missing: 0}` disabled the two longer rungs and titled them
*"not written for this article yet"* — the never-built sentence, about an artefact the payload was
carrying. The exact collapse this slice's rule exists to prevent, at the last rendering step.

Worth noting how it survived the pass above: [that section](#mutation-testing-found-the-one-state-nothing-had-ever-rendered)
concluded the summary case *dissolved*, because the probe fixture `{entries: []}` was cast past the
compiler and `missing` is required. The dissolution was right about the fixture and wrong about the
bug — the reachable state is `{entries: [], missing: 0}`, and it renders the wrong sentence. A
fixture that lies can hide a real bug as easily as it can invent one.

Fixed by saying it, the way `GlossaryPanel` and `IdeasPanel` say it, and by splitting the tooltip:
`summaries === null` is *not written for this article yet*, and a present artefact with no ladder is
*not in what was written for this article*. Two states, two sentences.

**4 — deleting the visitor's summary band left the suite green.** The fixture has no `summary` key on
purpose, so every summary assertion in the file exercised the *missing* branch and the band itself
was never mounted by anything. Confirmed by mutation. Now covered, at `len=long` — the gist rung
draws the tree's own `gist`, which is on screen whether a summary was ever fetched or not, so it
cannot be evidence that one was.

**5 — the empty-artefact test never mounted a panel.** Already fixed in `d6ddf5f`, from the mutation
pass, before the review came back. Two independent methods found the same hole, which is the most
reassuring thing in this section.

**3 — the panel props no longer make the bad combination impossible.** Fixed, 2026-08-29; Greg chose
it over leaving it as a tested-only invariant.
`GlossaryPanel`, `IdeasPanel` and `SummaryPanel` each took the public artefact and `owner: Use… | null`
as **independent** fields, so a visitor's glossary paired with a non-null owner was legal TypeScript
and would have rendered the authenticated lookup and regeneration controls. Every visitor caller
passed `owner={null}` and `tests/public-network-trace.test.tsx` asserts none of those controls is on
screen, so nothing was wrong at the time — what had gone was the *type* seam that made it
unwriteable.

That seam is the whole reason `ReaderCapability` is a discriminated union rather than a boolean, so
losing it one level down was a real loss. The fix is one tagged `access` prop per panel, replacing
both fields: `GlossaryAccess`, `IdeasAccess`, `SummariesAccess`, each
`{ kind: "owner"; owner; artefact | null } | { kind: "visitor"; artefact }`.

**Tagged, and not the untagged `{artefact, owner: null} | {artefact: null, owner}` this section
first proposed.** That shape says a visitor has no artefact, which is backwards: since slice 1b a
visitor's whole point is that they *do* have one, and it is the owner who can be looking at a piece
nobody has built anything for yet. So the nullability runs the other way round — nullable on the
owner's arm, where "not built yet" is an ordinary state and the offer to build one is what fills it,
and non-nullable on the visitor's, because `visitorGap` answers *not built* and the band says so
instead of mounting the panel at all. A `kind` tag rather than relying on the nulls to discriminate,
for the same reason `ReaderCapability` carries one.

The panel bodies are untouched: each destructures `access` and derives the two locals it already
used. The three `…Owner` aliases stay, because the tests and the bands name them.

### Eleven mutations, and two of them were wrong

Alongside the four above, the rest of the mutation pass. The guards that fired: a length test in
`artefactsIn`; `Block.note` copied through `publicBlock`; a dropped `aliases` in `publicGlossary`;
`publicSlug` without its visibility predicate; `publicSummaries` without `missing`; `artefactsOf`
returning the whole article rather than the four keys; all three arms of the closed-import guard
against a genuinely forbidden table; and a single `fetch("/api/library")` inside `VisitorArticle`,
which reddens **seven** tests.

Two mutations came back green and were *my* mistake rather than a hole: I had added `articles` and
`revision_blocks` to public files, and both are on the guard's allowlist on purpose. Written down
because "still green" in a mutation log reads as a finding, and the next person to skim this should
not spend an hour re-finding that the guard was right.

### What the payload actually costs, measured on a real article

The estimate this slice was approved against — glossary 2.5–12KB, summaries ~37KB — came from
sampling artefacts on disk. Checked against the wire on 2026-08-29, on
`noema-mythology-of-conscious-ai` served by the real endpoint from Postgres:

| | KB | share |
|---|---:|---:|
| `blocks` | 143.4 | 58% |
| `tree` | 40.0 | 16% |
| `summary` | 34.5 | 14% |
| `ideas` | 12.0 | 5% |
| `glossary` | 10.1 | 4% |
| `tweets` | 4.3 | 2% |
| `arc` | 1.5 | 1% |
| **total** | **246.2** | |

The estimate holds: summaries are 34.5KB against ~37KB predicted, glossary 10.1KB inside the 2.5–12KB
range. **The four artefacts together are 61KB, a quarter of the payload**, against a prose-and-tree
body of 183KB that a visitor was already being sent. So Greg's call trades a round trip for a third
more bytes, not for a different order of magnitude — which is the version of the tradeoff he agreed
to, now with a number behind it rather than a sample.

Checked for disclosure at the same time, against the real payload rather than a fixture: no `note`,
no `profileHash`, no `guidance`, no `sourceHash`, no lookups. Three words did match a grep and all
three were innocent — `model` and `cost` appear in the article's own prose, and `provenance` on an
idea is `"assumed"` or `"introduced"`, which is about the idea rather than about a run.

`arc.generator` and `tree.generator` do carry `claude-sonnet-5` to a visitor, and that is deliberate
and already argued in [`src/public/dto.ts`](../../src/public/dto.ts): it says which of *our*
generators wrote the tree, which is provenance about us and not about the owner. Recorded here
because it is the one thing in the payload that looks like a leak and is not.

### The panel props, and the `never` that makes the union worth having

Greg's call on [finding 3](#the-code-review-of-the-built-slice-and-the-two-guards-that-were-not-guarding):
do it. The three band panels now take one tagged `access` prop instead of two loose ones —

```ts
export type GlossaryAccess =
  | { kind: "owner"; owner: GlossaryOwner; glossary: { entries: GlossaryEntry[] } | null }
  | { kind: "visitor"; glossary: { entries: GlossaryEntry[] }; owner?: never };
```

— so the sentence from [reader-capability.ts](../../src/web/reader-capability.ts) holds one level
down: **the visitor arm has no `owner` field to be empty.** The asymmetry is deliberate. An owner can
be looking at a piece with no glossary yet, which is what the offer to build one is for; a visitor
never mounts the panel without the artefact, because `visitorGap` answers *not-built* and the band
says so instead.

**`owner?: never` is the half that matters, and the first version did not have it.** Without it the
union catches only a fresh object literal at the call site, because a literal is the only thing
TypeScript applies excess-property checking to. Build the same object in a variable and
`access={that}` compiles with an owner hook riding inside a visitor's arm:

```ts
const sneaky = { kind: "visitor" as const, glossary: visitorList, owner: ownerHook };
<GlossaryPanel access={sneaky} … />   // no error, before the `never`
```

Which is exactly how this kind of guard turns out to be worth nothing — and it would have shipped,
because every one of the six real call sites writes a literal and every one of them compiled. Both
forms were run through `tsc` before and after. Before: the literal errored, the variable did not.
After: all three panels reject both, `TS2322 … is not assignable to type 'GlossaryAccess'`.

The general lesson is worth more than the fix: **a type-level guard has to be tried against the
sneaky form, not the honest one.** The honest form is what your call sites already write, so it
proves nothing about a call site somebody writes next month.

#### The control set, and what each file is for

Six files, each compiled against `src/web/tsconfig.json` on its own. Four must fail and two must
pass, and the two that pass are the half that makes the four mean anything.

| File | Shape | Result |
|---|---|---|
| `good.tsx` | all three arms the app really writes, including an owner with no glossary yet | compiles |
| `bad.tsx` | visitor arm plus an owner hook, as a fresh literal | `TS2322` |
| `sneaky.tsx` | the same object through a named `const` | `TS2322` |
| `more-bad.tsx` | the old two-prop form; a visitor with `glossary: null`; an owner arm with no owner | `TS2322` ×3 |
| `without-never.tsx` | **the union as first written, minus `owner?: never`**, handed the sneaky shape | **compiles** |
| `limit.tsx` | owner arm, handed a visitor's projection | **compiles** — see below |

`without-never.tsx` is the one that earns the fix. It is not "the guard fires", it is *the guard
without this line does not fire on the same input* — which is the only thing that separates a strong
version from a weak one that looks identical from the call sites.

One trap on the way, and it is the same shape one level down: the first attempt ran all six through a
`tsconfig.json` whose `include` named a single file, so five of them were never compiled and every
one reported "clean". A control that is not in the compilation is indistinguishable from a control
that passed. The harness now gives each file its own config, treats TypeScript's `TS18003`
("no input files") as its **own** outcome rather than as zero errors, and asserts a *direction* per
file — three must error, three must be clean — because one compilation cannot say that and a count
of errors reads an empty run as a pass.

**And the harness was then run against the real broken state**, which is the only version of this
check worth having. Deleting `owner?: never` from the shipped `GlossaryPanel` — not from a copy —
makes exactly one file change verdict:

```
ok      bad.tsx errors (1)
FAILED  sneaky.tsx wanted errors, got 0 error(s)
```

`bad.tsx` still errors, because a fresh literal errors under both versions. Only `sneaky.tsx`
separates them, and it is the file that would not have existed if the control had been written
against the shape the call sites already use.

#### What the union does not forbid, and cannot

`{ kind: "owner", owner: <a real owner hook>, glossary: <a visitor's projection> }` still typechecks,
and `limit.tsx` confirms it. `PublicGlossaryEntry` is **deliberately** assignable to `GlossaryEntry`
([`src/public-types.ts`](../../src/public-types.ts)) — that is what lets one panel draw both readers'
lists without a cast and without a second component.

So the union forbids the direction that does harm, which is owner machinery reaching a visitor. It
cannot forbid an owner's panel being handed a projection of the owner's own data, and no type could
without giving up the one-panel design. Written down here rather than left implicit, because the next
person to read `GlossaryAccess` will otherwise assume it is stronger than it is.

### The state that cannot happen

Found on 2026-08-29 by asking a question I should have asked before writing any of it: **can the
pipeline actually produce an empty artefact?**

It cannot. All four builders throw rather than write one, and each says why beside the throw in
almost the same words:

| | |
|---|---|
| [`src/glossary.ts`](../../src/glossary.ts) | `if (previous.length === 0 && fresh.length === 0) throw new Error("The model returned no terms. Nothing to write.")` |
| [`src/ideas.ts`](../../src/ideas.ts) | `if (fresh.length === 0) throw` — with the four drop counts in the message |
| `src/summarise.ts` | `if (entries.length === 0) throw new Error("The model returned no usable summaries…")` |
| [`src/tweets.ts`](../../src/tweets.ts) | `if (texts.length === 0) throw` — *"An empty thread throws. A zero-post thread is not a degenerate success"* |

> Nothing to say is not a degenerate success — it is a model call that produced nothing, and writing
> it would make the step report done for ever after.
>
> — `src/glossary.ts`, and `src/ideas.ts` in the same words

Checked against the data as well as the code: every artefact in the local database is either absent
or non-empty. Nothing is `{entries: []}`.

**So the rationale this slice was carrying was false**, and it was written down in four places. It
said a stored `{entries: []}` *means somebody ran the step and it found no terms*. The step refuses
to record that. `builtButEmpty` renders a sentence no reader can reach; `SummaryPanel`'s new branch
guards a state no payload can be in; the mutation that made `artefactsIn` use `?.length` went red on
a fixture rather than on anything real.

**What is kept, and why.** The code stays and the comments are corrected to say what is true. The
cost is three lines of copy and one branch each; the benefit is that those four throws are one
refactor away from being relaxed — there is a real article somewhere with no jargon in it — and the
failure if they are is the client calling the owner a liar about their own pipeline. Insurance is
fine. **Insurance described as a live case is not**, because the next person reads the comment, not
the throw four files away.

Presence rather than length also survives on its own merit, which is narrower than what was claimed:
it asks the question `artefactsIn` is *for* — did the payload carry one — rather than a question
about the contents that happens to have the same answer while a distant throw holds.

**The lesson is the order.** The reachability question belongs *before* the handling, not after the
review. Two of the five findings in the code review above are about this state, and both were treated
as live bugs by me and by the reviewer, because the plan asserted the state occurred and neither of us
went and read the four builders. A rationale in a comment is not evidence; the throw is.

### The logo sat on the sentence

The browser pass, 2026-08-29, on the real article at 820px and 390px. One bug, and it is the kind
only eyes find: **the corner logo and the visitor's notice were drawn on top of each other**, both
illegible where they crossed, whenever a mode band was open.

| | logo | notice | overlap |
|---|---|---|---|
| 820px, `?mode=glossary` | `(0,0,136,44)` | `(32,0,768,66)` | **4,576px²** |
| 390px, `?mode=glossary` | `(0,0,42,44)` | `(12,0,378,106)` | **1,320px²** |

At `scrollY: 0`, so it is not content sliding under a fixed element — it is the top of the page.

**The cause is a rule that named one of the two things in a strip.** At iPad-portrait and below the
band goes full width, so `styles.css` hides the article's masthead while one is open, and the
reasoning there ends *"the controls bar sticks at zero immediately and the band sits exactly
underneath it"*. The controls bar **was** the next element when that was written. It is not, for a
visitor: `SharedNotice` sits between the two and nothing hid it, so it became the first thing on the
page at `y: 0` — under `.logo-home`, which is `position: fixed` at the same origin and cannot be
pushed by anything in flow.

The fix is the same rule, extended, and it is right on its own terms rather than merely expedient:
this is the half of the statement that belongs **with the title**, and the title is gone. The half
meant to survive is the `ViewOnlyChip` in the controls bar, which is sticky — that split is the whole
reason there are two of these. Confirmed in the browser across six cases (390 and 820 × plain,
glossary, summary): overlap zero everywhere, the notice visible in the plain view at both widths and
hidden under a band, and *"View only"* and *"Make a free account"* on screen in **all six**. The
visitor is never left without the statement.

Controlled by removing the rule and re-measuring: the overlap comes straight back at both widths, at
the numbers in the table. Red, green, red, green.

`tests/shared-notice-hides-with-the-masthead.test.tsx` holds the two halves together, and is honest
about which half is worth what: the class assertion runs the component, the CSS assertion reads the
file. Three controls, all red — drop the class, delete the rule, or move the rule out of the `@media`
block, which would hide the notice at every width including the reading view where it is the point.

**What the pass found by not finding it.** Everything else was clean, and two of them are worth
recording because they are regressions that had already been caught once: hovering the article's own
external links fired **no** request — neither the authenticated `/api/library` nor the off-origin
Wikipedia call — and no owner control appeared on any band, drawer or page. The server log agrees
from the other side: across 28 loads, `/api/public/article/…` and nothing else, plus two `404`s on
`/api/article/…`, which is the designed first step of the two-step. Two, not twenty-eight — the
client caches the *not yours* answer rather than re-probing an authenticated endpoint on every
navigation.

### Stage 2, the part that needed nobody's permission

Slice 1 opens with a `/read/:slug` rewrite that has to sit ahead of the SPA catch-all in
`vercel.json`, and a peer was mid-deploy through that same file. So the routing waited and the pure
half went first: [`src/html.ts`](../../src/html.ts) — `escapeHtml` and `headText` — plus
`safePublicCanonical` in [`src/urls.ts`](../../src/urls.ts). No routing, no build, no deploy.

`escapeHtml` existed twice already and **the two copies had drifted**: `src/extract.ts` escaped all
five characters, `src/pdf-read.ts` four, missing `'`. Nobody chose that; it is what happens to a
four-line helper written twice. `extract.ts` now imports the shared one — behaviour identical, so
zero risk.

**`pdf-read.ts` deliberately does not**, against the review's advice, and the reason is worth
recording. Its copy escapes four characters, so unifying it changes the generated HTML for every PDF
containing an apostrophe — which is nearly all of them. That HTML is stored, and re-extraction is not
free. `hashBlocks` reads `text` rather than markup so the fingerprint is probably unaffected, but
*probably* is the wrong standard for the file that mints block ids
([block-ids.md](../project/block-ids.md)). It is a separate piece of work with a re-extraction cost,
and it now has a comment at each end saying so.

#### Three tests that passed for the wrong reason, found by mutating

Every case has a mutation that must redden it, from the design's § 6. Running them found the tests
wrong three times, and each is a different way to be inert.

**The attribute test was checking the wrong rule.** It used the obvious payload — close the
attribute, close the tag, open a new `<meta>` — and counted elements. Mapping `"` to itself left it
**green**, because that payload also needs `<` and `>`, which a different entry escapes. The test was
passing on the `<` rule while claiming to cover the `"` one. The payload that needs `"` and nothing
else does not open a tag at all: it adds an **attribute** to the tag it is already inside,
`" onload="alert(1)`. So the assertion is now the attribute *list*, and it reddens on exactly that
mutation — as does its single-quote twin, which is why the table has five entries.

**The title test was reading through the escaping it was checking.** It asserted `doc.title`
contained `</title>`; `.title` returns *decoded* text, so `</title&gt;` decodes back and it passed
with `<` unescaped. Switching to `innerHTML` did not help either — that re-serialises, so both inputs
give byte-identical output. Measured both. **An assertion that reads through a normalising layer
cannot see the thing that layer normalises**, and every reader of a parsed DOM normalises something.

That one has a real conclusion rather than only a fix: escaping `>` alone already stops the title
payload, because `<title>` is RCDATA and breaking out needs the exact string `</title>`. `<` and `>`
are load-bearing **together** there. So the structural test now claims only what it proves — one
element in, one element out — and a blunt per-character assertion covers the mappings, because that
is the only shape a single-mapping mutation cannot survive.

**And the mutation harness itself reported green while the test was red.** Its
`grep -q "Tests .*failed"` missed vitest's coloured summary line, so two real failures were logged as
"STILL GREEN". Caught by re-running one of them by hand and seeing three tests fail. The check on the
check, again.

#### One assertion the code lost an argument to

`safePublicCanonical` was written to refuse any query string, and the test asserted that a trailing
bare `?` was refused too. It was not. The URL standard parses `https://example.com/a?` to an *empty*
query, so it never reaches the refusal — and on reflection it should not: a bare `?` carries no
information, which is exactly what distinguishes it from the `?id=123` case the rule exists for.
Refusing would have thrown away a good canonical. What it needed was `url.search = ""` to keep the
stray `?` out of the serialisation. The test was right to fail and wrong about which way.

### The head projection, and the bar the other two reads disagree about

The second piece of stage 2 that needs no routing: a `head` projection beside `article` and
`metadata` in [`public-reader.ts`](../../src/store/public-reader.ts), and `loadHead(slug)`.

Six values — `title`, the `<h1>` fallback, `root_gist`, `final_url`, `hasTree`, `hasBlocks` — and the
shape is the guard. **The function must not become a second renderer**, and the cheapest place to
hold that line is the `select`: it cannot render a body from a projection the blocks are not in.

**`final_url` was forbidden in the article read and required here**, which looked like a
contradiction and was not. There it was the masthead's provenance and a visitor had no business with
it. Here it never reaches a browser as data — it is the *candidate* canonical, and
`safePublicCanonical` decides whether any tag is published at all. The fixture's `final_url` carries
a signed query parameter on purpose, and the pg test asserts both halves of that seam in one line:
the reader hands the value across untouched, and the sanitiser returns `null`. Neither the SQL test
nor the unit tests can see that seam on their own.

The first half of that has since been reversed — see the section below — and the seam described here
is unchanged: a head still publishes nothing when the address carries a query.

### The source URL is published now

> I think Public-readable articles *should* show their provenance-url to all reader[s].
>
> — Greg, 2026-08-30

So `final_url` is selected in the **article** read too, and `meta.url` came off the forbidden list.
The column still does not reach the wire as itself: `publicMeta` in
[`dto.ts`](../../src/public/dto.ts) puts it through `publicSourceUrl`
([`src/urls.ts`](../../src/urls.ts)) and publishes the result as `PublicMeta.url`. That is the
"own named field" the projection's comment had asked for while it held the column back.

**One policy over one column, and it was nearly two.** `publicSourceUrl` was first written to differ
from `safePublicCanonical` in one clause — keep the query string, because a canonical is a machine's
claim about *which document this is* while a source link is a person clicking through, and on many
sites `?id=123` *is* the article.

**The canary in `tests/public-visibility-pg.test.ts` went red on that, and was right to.** Its
fixture's `final_url` is `…/piece?sig=SECRETSIGNATURE`, and *signed* is the case the argument skips:
a tracking parameter is noise, an id is the article, and a signature is a capability the owner holds
— very often their own paywall bypass. Publishing an essay is a decision about the essay; it does
not imply handing out the key that got us in, and from the DTO the three are indistinguishable. So
`publicSourceUrl` delegates, and the cost was measured rather than assumed: **of the twenty articles
in `data/` with a URL, none carries a query** (2026-08-30).

It keeps its own name and header because the two are one policy by coincidence of the current rules
rather than by definition — the query clause is the one that could ever come apart, and this is the
seam that argument would need.

What a reader sees is one glyph beside the title, `OriginMark` in
[`Masthead.tsx`](../../src/web/Masthead.tsx). **The link is for everybody; the word "uploaded" is
not** — an absent `PublicMeta.url` means *either* an upload *or* an address the policy withheld, and
only a reader who owns the article may read the absence as the first.

#### `hasBlocks` is where the two existing reads disagree

`loadArticle` refuses a tree with no blocks. `loadMetadata` checks only the tree. So a revision
exists that passes the metadata bar and is a page React cannot draw — and a head that answered 200
there would put a title and a description on a link to a blank screen, which is worse than no preview
because a preview is a claim. Sol found it by reading both readers.

**Deleting that bar left every assertion in the file green**, because the fixture has blocks: the
guard was unreachable from the corpus that existed. So there is now a second fixture — a genuinely
public article with a tree and no blocks — and with it the mutation goes red. The same test also
pins the disagreement rather than papering over it: `loadMetadata` still answers for that article,
deliberately, because a metadata page is a page about what exists and a head is a claim about
something readable.

#### And one assertion that could not fail

The test for *the head selects no document* looked for `"tree" as`, on the assumption that a selected
column is aliased. Drizzle does not alias a plain column, so the needle appeared nowhere and the test
passed with `tree: articleRevisions.tree` added to the projection — the exact mutation it existed to
catch.

`"tree"` is also genuinely present in the correct statement, inside
`"…"."tree" is not null as "has_tree"`, so the obvious repair — assert the string is absent — fails on
correct code. What separates the two is the punctuation: a select-list item is followed by `,` or by
` from`; a column inside an expression is followed by ` is not null`. Both forms are now asserted, and
there is a control on the control — the *article* read must contain the needle, or the loop passes on
a typo in the table name.

### Slice 1, built 2026-08-29 — the link previews

The whole of it: the `/read/:slug` rewrite ahead of the SPA catch-all, `__spy_read` beside
`__spy_path` in [`originalUrl`](../../src/vercel.ts), the built shell compiled into the API bundle
with a refusal if it is stale, a pure composer in [`page-head.ts`](../../src/public/page-head.ts),
and the transport in [`page.ts`](../../src/public/page.ts). Crawler exposure is unchanged: the
site-wide `X-Robots-Tag` is untouched, `robots.txt` still says `Disallow: /`, and the function sets
no robots header of its own.

Built by two agents against a seam fixed in advance — `composeShell(shell, head | null)` and the two
compiled-in constant names — so neither waited on the other. That worked, and it is worth repeating:
the alternative was one agent holding both halves, and the first attempt at that died on a transport
error with nothing to show.

#### The evidence that is worth more than the test count

Five and a half thousand tests passing says little on its own. These were run by hand:

- **The stale-shell refusal fires.** A wrong commit in `dist/build.json` fails the API build, naming
  both values. Without it, an API build alone compiles last week's page and says nothing —
  the worktree this design was written in was already in that state.
- **The compiled shell is the built shell.** SHA-256 of `dist/index.html` appears in
  `api-dist/vercel.js`, as does the hashed asset reference.
- **The compiled bundle, driven against a real Postgres** with a genuinely public article: 200 and
  the article's own title; 404 and a bare *Spideryarn* for an absent slug; 400 for a malformed one;
  `HEAD` returning the GET's status and `Content-Length` with a zero-byte body; `POST` giving 405
  with `Allow: GET, HEAD`; both captures together giving 400.
- **A browser, on a local stand-in for Vercel's rewrites.** A signed-out visitor sees real prose, and
  `performance.getEntriesByType('resource')` shows exactly one API call on the page —
  `GET /api/public/article/:slug` — with no POST and nothing private. **That is the acceptance test
  for the whole feature** ([§ How we prove it](#how-we-prove-it)) and nothing else has ever run it.

#### The blank page a status code cannot see

Sol's § 7 calls one mutation the important one: corrupt the compiled script URL, and `curl` still
returns 200 with the right title while the page is blank. It was worth the trouble it took.

**The first attempt could not have worked, and the agent running it worked out why rather than
reporting a failure.** It edited `dist/index.html` and nothing changed — because the shell is read at
*build* time and compiled in as a string constant, so the disk file is not what `/read/:slug` serves.
It confirmed that by searching the bundle for `readFile` and for the literal `index.html`, finding
neither. The instruction was wrong, not the code: the mutation has to be baked in, which means
editing the file **and rebuilding**.

Done properly, the two readings disagree exactly as predicted — `curl` 200 with
`<title>The Mythology Of Conscious AI · Spideryarn</title>`, and a browser showing an empty `#root`
with `/assets/missing.js` in the resource list. It then arrived a second time by an independent
route: `/read/:slug/metadata` falls through to the static branch, which does read the disk fresh, so
that route demonstrated the same thing while the file was mutated.

And the sentence worth keeping, which came from the agent rather than from me: **an empty console is
not evidence the page is healthy.** A module script that 404s does not reliably surface as a
`console.error` a tool can read. The empty `#root` is the evidence.

The header that made all this legible is `X-Spideryarn-Shell-SHA256`, which exists so a deployed
check can prove the shell compiled in is the shell being served. Its first real use was diagnosing
this, from outside, by a process that could not see the build.

#### Sol reviewed the code and blocked it, on the one thing I had overridden

[The review](260829j-public-read-only-stage2-slice1-review-sol.md). One blocker, and it was **the departure
from the design I had made deliberately and argued for at length**.

I had specified 200-with-the-default-shell where the design said 500, on the grounds that a 5xx would
replace our application with Vercel's error page and take down a reading view the client could have
loaded on its own. **The premise is simply false.** `servePublicReadPage` composes and writes the
shell body itself, whatever status it chose, so a 5xx carries our page exactly as a 200 does. The
whole argument rested on a fact I never checked.

And the 200 is worse than wrong, in two ways the file's own comments already knew about: an unfurler
may cache the resulting generic card in a card cache we cannot reach — the same cache the sharing
copy admits we cannot clear — and a status-based monitor reports success over a silently broken
preview. It is now **503** with `Retry-After`, which also says *transient* rather than *broken*.

The decision is robust even against the thing I was afraid of. If Vercel does substitute its own page
for a 5xx — not verified on a deployment — the outcome is still right, because a head read fails when
the database is unreachable, and then the client's own `/api/public/article/:slug` fails too. There
was no working page to protect. **The 404 stays a 404**: not shared is an answer, not a failure.

The general lesson is not "the reviewer was right". It is that the override was argued *well*, in
several paragraphs, from a premise of one sentence that nobody tested — and length of argument is not
evidence. The test would have been to send a 500 and look at what came back.

#### Three tests that could not fail, in the pass whose whole subject was tests that cannot fail

The rest of the review, and this is the uncomfortable part: every one of these was in code written to
a brief that named the mutation each assertion had to die to, by agents that reported 17 of 17 and 12
of 12 going red.

- **A literal regex asserted against a literal string.** The rewrite-ordering test compared a hand-written
  pattern to a hand-written path, so no change to `vercel.json` could redden it. It reads the file now.
- **A private-title canary the code never saw.** The fake reader threw before the canary title was
  ever returned, so `not.toContain` was asserting about a string that had not entered the subject.
  The real Postgres test was doing the work the whole time.
- **`composeShell`'s central invariant, documented and unenforced.** It checked that each sentinel
  appears once and that start precedes end — not that both sit above `<body`. Move the end marker
  below it and the replacement deletes body bytes. The build check had the identical hole.

Sol also found a real inconsistency a stranger can see: `__spy_read=a%2Fb` decodes to a two-segment
path, misses the read branch, and gets a generic JSON 404 instead of the default-shell 400 every
other malformed slug gets. Anything under `/read/` now goes to the page module — safe because the
only way such a path reaches this function is the rewrite, which Vercel applies to a single segment.

#### Two recorded rather than fixed

- **`status === 404` is correct today and not structural.** `scrubbed` passes through any numeric
  status, and `loadHead` reads any 404 as *the reader refused this*. A future fault carrying
  `status: 404` would be misclassified as "not shared" — a wrong answer that looks like a right one.
  A branded refusal type closes it; it is not urgent and it is not free.
- **`src/web/main.tsx`'s legacy `?slug=` rewrite** hands user-controlled text to `readHref`. Safe,
  because `parseRoute` now rejects it — but it can leave a malformed `/read/…` address in the bar.
#### And one that was for Greg, now settled — four ways the tab changed at mount

**Fixed 2026-08-30.** For a title containing a double space, a newline or a bidi control the tab
changed the moment React mounted: `documentTitle` normalised through `headText` and the client's
`pageTitle` only trimmed and clamped. Found sideways, by a test that claimed to compare the two
character for character and did not. It was pinned rather than fixed because which side is right
looked like a product decision; Greg had no view and left the call to the implementer.

**The server's normalising won and the client's clamp won**, and they are one function now —
`documentTitle` in [`src/title-text.ts`](../../src/title-text.ts), imported by both. Normalising is
not a preference (an RLO reverses display order, and there is no argument for the tab being the one
place one survives); a word-boundary cut with an `…` is what a reader wants in a bookmark and a
history entry, and the server only had the hard cut because `headText` also serves `og:title`, which
keeps it. The reasoning is in that file's header and in
[page-titles.md](../project/page-titles.md#the-server-writes-the-title-first-now-and-both-sides-use-one-function).

**Auditing for the same shape — two sources answering "what should the tab say" — found four more,
and every one of them was unreachable from the corpus that existed.** Two of the four were found by
GPT Sol rather than by me, and the second of those was on an axis I had checked and written off,
which is the part worth remembering.

1. **The fallback chain.** `loadHead` answered `title ?? headingTitle`; the payload's `metaFrom`
   answers `title ?? headingTitle ?? slug`. For an article with neither a title nor an `<h1>` the tab
   said `Untitled` and then changed to the slug. Every fixture had one or the other, so nothing could
   reach it. Found by GPT Sol; fixed, with a fixture that has neither.
2. **`Loading…`.** The one the server head *caused* rather than exposed: `ArticlePage` replaced the
   real title with `Loading…` past `SLOW_AFTER_MS` (600ms — a cold serverless start, routinely) and
   then put it back. `articleWaitTitle` in [`page-title.ts`](../../src/web/page-title.ts) is the rule
   — do not replace a title that is already right — with two guards, the second of which is the
   subtle one: the tab must *still be showing* the composed title, or a reader going a → b → a keeps
   b's title over a's loading page.
3. **The legacy metadata addresses.** `?about=1` and `?panel=about` are **one** path segment, so
   they reach the composer, and `main.tsx` rewrites them to `/read/x/metadata` before React draws.
   The direct two-segment route is never composed, which is why the view axis looked covered — a
   legacy address is a second door into the same view and does not look like the thing it becomes.
   Found by GPT Sol *after* I had checked the direct route and written down that the axis was safe.
4. **The mode.** `?mode=glossary` survives the rewrite; the transport dropped it. Found by GPT Sol
   reviewing the other three, and the reason it survived a 20,000-case fuzz is the lesson: every
   generated case fixed `view` and left `mode` absent, so the corpus was exhaustive along the axis it
   varied and blind along the one it held still. **The missing dimension was title state, not title
   characters.** The server reads the mode now, through the same `isMode` the client uses — and
   `modeParam` was changed to call `isMode` too, because until Sol's second round "one place decides
   what a mode is" was a claim rather than a fact: the client still had its own `MODES.includes`, and
   every test compared each side against literals rather than against the other.

**End to end through the compiled bundle**, which is the only evidence that survives the bundler:
`api-dist/vercel.js` driven against the real local Postgres for a genuinely public article answers

| address | `<title>` | `og:title` |
|---|---|---|
| `/read/<slug>` | `The Mythology Of Conscious AI · Spideryarn` | `The Mythology Of Conscious AI` |
| `?mode=glossary` | `… · Glossary · Spideryarn` | unchanged |
| `?mode=hierarchy` | `… · Spideryarn` — the default leaves no trace | unchanged |
| `?mode=toc` (retired 2026-08-29) | `… · Spideryarn` — degrades, as `modeParam` does | unchanged |
| `?mode=%zz%zz` | `… · Spideryarn` — a malformed escape is not a 500 | unchanged |
| a slug nobody has | `Spideryarn` | no `og:` tags at all |

`og:url` carries no mode in any row. Nothing in that harness imports `src/`; the point was to test
what the bundler emitted rather than what the source says.

Two mutations were run against the new test before it was believed: dropping `normaliseText` from the
shared function (both sides drift together — caught by the spelled-out literals) and putting the
client back to `clamp(title.trim())` (caught by the labelled client assertion). An equality check
between two callers of one function proves nothing on its own, which is why the expected strings are
written out rather than computed from either side.

## Open questions

- ~~What a public visitor sees when the owner turns a doc off while they are reading it.~~
  **Decided 2026-09-02: nothing.** There is no post-load fetch on the visitor path, so the tab keeps
  the payload it has until reload, and the next request 404s. Delivered bytes cannot be recalled and
  a focus-time re-check would be cosmetic rather than authorisation.
  [260902j](260902j-public-read-only-access-audit-and-improvements.md) § Decisions.
- **Whether the public page should link to the original article prominently.** Argues for itself on
  every ground except the one where we want the reader to stay — and it argues much louder now that
  [§ Rights](#rights-and-takedown-the-thing-a-canonical-tag-does-not-fix) is on the table.
- ~~Rate limiting the public GETs.~~ **Decided 2026-09-02: a Vercel WAF rate limit on `/read/*`
  and `/api/public/*`, log mode first**, configured by Greg. Not an in-process counter and not an
  edge cache. The 4.5 MB function-response ceiling is a separate, unmeasured item.
  [260902j](260902j-public-read-only-access-audit-and-improvements.md) § Tiers.
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
  --prompt-file docs/plans/260827ai-public-read-only-access-review-prompt.md \
  --output docs/plans/260827ai-public-read-only-access-review-sol.md
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
- [260825e-metadata-page.md](260825e-metadata-page.md) — where the Access & Sharing card goes, and why it was dropped the first time
- [reader-profile.md](../project/reader-profile.md) — `profileHash`, and why a variant table is the honest shape
- [copy.md](../project/copy.md) — the rules for every sentence a visitor reads
- [260828a-public-access-how-others-do-it.md](../research/260828a-public-access-how-others-do-it.md) — how X, Bluesky,
  Notion, Figma, Readwise and ChatGPT draw this same line, and what it cost the ones who got it wrong
- [260827ai-public-read-only-access-review-sol.md](260827ai-public-read-only-access-review-sol.md) — the review in full
- [260828h-public-read-only-stage1-input-sol.md](260828h-public-read-only-stage1-input-sol.md) — Sol's design input
  for the build, which is the specification stage 1 is being written against
