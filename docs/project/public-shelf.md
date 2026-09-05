# The public shelf

`/read/public` — every article anybody has shared, listed for anybody, signed in or not.

> create a `/read/public/` page that lists Public-readable pages (reusing some of the
> article-listing machinery from Homepage), and pick a few of those to link to from various places
> to showcase what Spideryarn is capable of.
>
> — Greg, 2026-09-04

**It is not the owner's shelf narrowed**, and that distinction is the whole of this page. The shelf
([library.md](library.md)) is *your articles*; this is *what anybody has shared*, and there is no
view of anybody's private reading anywhere in it. The decision that the owner's shelf gets a Shared
**badge and not a filter** is unchanged and still stands —
[library.md § The Shared badge](library.md#the-shared-badge) reconciles the two.

## What it changed about sharing

Sharing used to promise *reachable by anyone with the link*. Listing every public article makes it
also mean **discoverable**, so the owner-facing copy says the wider thing — `SHARING_ON` in
[`src/messages.ts`](../../src/messages.ts), which the shelf badge's hover and the masthead's mark are
both built from, and which [privacy.md](privacy.md) is the reader-facing account of.

That change was applied retroactively to every already-shared article, with no grandfathering and no
notice, on the ground that there is exactly one account holder. **That reason is a fact about today
rather than a judgement that the exposure does not matter**, and it stops holding the moment there is
a second — [260904b-pricing-page-and-public-showcase.md](../plans/260904b-pricing-page-and-public-showcase.md)
§ 1 is the decision and the argument.

## The parts, and why each is its own

Four pieces, none of them a widening of the article-reading path beside it. The reasoning for keeping
them apart is in [security-map.md § the unauthenticated namespace](security-map.md#the-unauthenticated-namespace-and-the-tripwire-under-it),
and it comes down to a listing being a sharper risk than a lookup: a wrong predicate on a lookup
leaks the article somebody was already asking for, and a wrong predicate here publishes the shelf.

| | |
|---|---|
| [`src/store/public-library.ts`](../../src/store/public-library.ts) | the closed query — `publicLibraryQuery`, plus three ceilings (`PUBLIC_LIBRARY_LIMIT`, `PUBLIC_CARD_CHARS`, a partial index) |
| [`src/public-library-types.ts`](../../src/public-library-types.ts) | the wire — `PublicLibraryEntry` and `PublicLibrary`, deliberately **not** a widened `LibraryEntry` |
| [`src/web/public-api.ts`](../../src/web/public-api.ts) | the client's half — `loadPublicLibrary`, a bare anonymous `fetch` and never `apiFetch` |
| [`src/web/PublicLibraryPage.tsx`](../../src/web/PublicLibraryPage.tsx) | the page, and its own `PublicCard` |

**The card is its own component rather than `ShelfCard` with the owner's verbs switched off.** That
option was weighed and rejected: `ShelfCard` takes the whole `useShelf` hook — rename, archive, undo,
`apiFetch` — so sharing it would mean six optional branches inside one component, of which a stranger
exercises one arm and the owner the other, and it would put an owner-scoped hook in the import graph
of a page mounted for people with no account. The file's own header has the full argument.

## Three things the page has to say

- **An empty shelf is a page, not a 404.** *"Nobody has shared anything"* is an answer about the
  world, so the route answers 200 with an empty list and the page draws a real empty state over it.
- **The cap is visible.** The listing is bounded, and `truncated` on the wire exists for one
  sentence. Nothing can reach it today; it is drawn anyway, because a cap that reports nothing is a
  list that quietly stops being the list — [silent-success.md](../reusable/silent-success.md).
- **What the page holds, and never how much of the world it holds.** The lede opens with a bare
  plural — *"Articles people using Spideryarn have chosen to make public"* — and says nobody's
  private reading is on the page. Neither can be falsified by the query. Two earlier drafts could
  be: *"an article that is not listed here is one nobody has shared"*, and then *"Every article
  somebody … has made public"*, which is the same completeness claim read from the other end and
  survived the first fix. A shared article that is archived, or whose revision has no tree or no
  blocks, or that falls past the row cap, is shared and absent.

Every sentence is in [`src/messages.ts`](../../src/messages.ts) § the shelf of public articles.

## What a card says, and the one line under the list

A card is the title, the piece's **byline**, where it was published, how long it is and when it was
shared — the byline first, which is the order the owner's own shelf card and the article's masthead
both use. It is *the article's* author, off the publisher's page, and never the reader who shared it;
[`src/public-library-types.ts`](../../src/public-library-types.ts) § `byline` says at length why that
distinction is worth writing down, and the listing's projection still names no column about an owner.
Greg, asked on 2026-09-04 whether a public article should show whose it is, said yes — the article
page already did, through `PublicMeta.byline`, and this shelf did not.

Under the list, outside all three state arms so an empty shelf and a failed read keep it, is one
quiet line: **if something here is yours, ask us to take it down**. The shelf is where a stranger
*finds* a republished article, so it is one of the two places that link has to be — the other is the
visitor's own details page for one article. It is not on a card: a card is an offer to read, and a
report link on every one of them would read as a warning about each article.
[privacy.md § If something here is yours](privacy.md#if-something-here-is-yours) is the section it
points at, and why it is a section rather than a route.

## The address, and the three enforcers of it

`public` is reserved as an article slug, because `/read/public` is otherwise an address two things
claim. One rule — `isReservedSlug` in [`src/ingest.ts`](../../src/ingest.ts) — and three places that
would each fail differently: `parseRoute` ([`src/web/router.ts`](../../src/web/router.ts)),
`decidePublicPage` ([`src/public/page.ts`](../../src/public/page.ts)), and `lockOrCreateArticle`
([`src/store/pg-revisions.ts`](../../src/store/pg-revisions.ts)), which is the one line in the repo
that brings an article address into existence. They are tested against one constant in one run, in
`tests/reserved-article-address.test.ts`, because the failure being guarded is *disagreement* — three
assertions in three suites each pass while the trio drifts.

The edge answers this address 200 with the **unmodified default head**. A `PublicHead` is composed
from one article's title and gist ([`src/public/page-head.ts`](../../src/public/page-head.ts)), and
there is no article here, so a preview card built for this page could only be a made-up one.

## The chrome, which is half of one family and half of another

The page carries `SiteNav` — the same top bar as `/`, `/features` and `/pricing`
([marketing-pages.md](marketing-pages.md)) — because it is somewhere a stranger is *sent*, and the
furniture it wants is a way to the rest of the site. It carries **no** `SiteFooter`, because Greg's
rule for the row is about the path and this is a `/read/` address;
[`src/web/SiteFooter.tsx`](../../src/web/SiteFooter.tsx) records the day that exclusion was read as
being about the reading *view* instead, and had it called rationalising.

## Who sends people here

Two marketing pages, `/` and `/features`, each draw the same block — a heading, a sentence, up to
three real shared articles, and a link back to this shelf.
[`src/web/PublicShowcase.tsx`](../../src/web/PublicShowcase.tsx) is the component and carries the
argument; [marketing-pages.md](marketing-pages.md) is the pages it sits on.

**Every link in it is derived from this shelf's own listing**, and that is the whole design rather
than a convenience. Greg flips an article's visibility in the production UI whenever he likes and
nobody redeploys afterwards, so a marketing page naming a slug in its source is a page that will one
day hand a stranger a 404. `tests/public-showcase.test.tsx` proves the property — an article that
stops being public leaves no link behind — by mounting each page twice against two different
listings, because a test that only found the articles it seeded would be green for a hardcoded list.

Two consequences worth knowing before changing it:

- **The listing cannot *pick*.** It is ordered by `public_at` descending, so the three shown are the
  most recently shared rather than the three best — a real gap against Greg's *"pick a few of those
  to link to"*, left open because picking means naming and naming is the failure above. The honest
  next step is a column the flip owns, not a list in a component.
- **`/pricing` does not get the block**, and that is a constraint rather than a preference:
  `tests/pricing-page-current-plan.test.tsx` asserts a signed-out `/pricing` makes no network request
  at all.

## What is deliberately not here

- **No search indexing.** `robots.txt` is `Disallow: /` and stays that way for now.
- **No artefact flags on a card** — no "has a diagram", no "has a glossary". That would be a second
  projection to keep in step with what the reader actually gets.
- **No cursor.** The row cap is a ceiling rather than a page size, so there is nothing to paginate
  through. The ordering is total on `(public_at, slug)` precisely so that a cursor is possible the
  day it starts biting.
