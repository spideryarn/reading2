# A mark at the top of the article saying who can read it

**Status:** in progress, 2026-09-04.

> Make it a bit clearer at the top of an article page with an icon if it's public or not -
> actually, make that a clickable button with clear tooltip that takes you to the profile to
> change whether the article is private/public
>
> — Greg, 2026-09-04

## What is missing

An owner can tell whether an article is shared from **the shelf** — `SharedBadge` in
[`ShelfEntry.tsx`](../../src/web/ShelfEntry.tsx) draws a globe on the public ones — and from
**the metadata page**, where `AccessSharing` is the switch itself. The page they spend all
their time on says nothing at all.

That is the one place the answer matters most: an owner reading their own article, deciding
whether to paste a link to it, has to leave the page to find out whether the link would work
for anybody else.

## What lands

A single icon in the masthead, beside the title and the origin mark:

- **globe** — anyone with the link can read this;
- **lock** — only you can read this;
- **nothing at all** — we could not say (see *Absence is an answer* below).

It is a `Link` to `/read/<slug>/metadata`, carrying the reader's view state the way the
dock's Metadata button does, so leaving and coming back lands on the same paragraph. The
hover/focus tooltip says which state it is in and that pressing it goes to the switch.

**It stops at the page rather than aiming at the section**, and that is the one thing here
that was cut rather than forgotten. Aiming needs a place in the address for *which section*,
and this app took the fragment out on purpose —
[url-state.md § Why the query string and not the hash](../project/url-state.md#why-the-query-string-and-not-the-hash),
*one query string, one listener*. Either spelling is a new piece of URL state, a row in that
doc's table, and a scroll that has to wait for a page which renders after its own fetch — to
save the reader half a screen on arrival. *Access & sharing* is the third section of eight and
Greg had it moved up already. Worth building if the landing turns out to feel wrong.

"The profile" in Greg's brief is the article's **Metadata** page — `AccessSharing` is the
only control in the app that changes an article's visibility, and it lives in that page's
*Access & sharing* section (third of eight, near the top).

**Owner only.** A visitor on a shared link gets nothing: the fact is the owner's, the
destination is a page they cannot open, and `PublicChrome`'s `ViewOnlyChip` already tells
them the different thing they need to know.

## Absence is an answer

`AccessSharing` refuses to guess when it cannot read the state, and this mark inherits that
rule rather than restating it — [AccessSharing.tsx](../../src/web/AccessSharing.tsx) has the
long version, and [silent-success.md](../reusable/silent-success.md) has the class. The
filesystem store has no `visibility` column and cannot answer, so on that store the mark is
simply not drawn. **A lock is a claim**, and drawing one over a store that was never asked
would be the sentence this control must never get wrong, printed on every article in
development.

## Where the fact comes from

`visibility` rides on the owner's article payload — `Article.visibility`, filled by
`src/store/pg.ts` § `loadArticle` from the `articles` row it already has in hand, and absent
from the filesystem store's.

**The simpler option passed over** was a `GET /api/article/:slug/visibility` beside the
existing `PUT`. It is a tidier resource — the route file already calls visibility a singleton
sub-resource — and it needs a `VisibilityStore.get`, a filesystem refusal, a route, and one
more network round trip on every article open, to carry one enum that the Postgres store
already has on the wire. The field is free at runtime; the endpoint is not.

**What the field costs** is an exemption in `tests/store-parity.test.ts`, whose `loadArticle`
comparison is a whole-object `toStrictEqual`. That is the same exemption `LibraryEntry.visibility`
already has there, paid the same way: the field is dropped from the cross-store comparison and
asserted positively on the Postgres side instead, against a known public row and a known
private one. Parity between two stores could never have checked a field only one of them can
answer.

**Not** `GET /api/metadata/:slug`, which already returns a richer `sharing` block: that
endpoint stats every file of every stage, and `routes.ts` says in as many words that it is off
the article payload so that every reader does not pay for a page almost nobody opens. Fetching
it to draw one glyph would put that cost on every article open.

## The second fact drawn from a payload nobody refetches

The mark reads `Article.visibility`, and `ArticlePage` fetches that payload **once for all three
of an article's views** and does not refetch when the view changes — deliberately, so stepping out
to the metadata page and back is free rather than 150KB and a spinner
([`App.tsx`](../../src/web/App.tsx) says so at length).

Which means the first version of this had a bug in it, and it was the exact bug this control
exists not to have: **publish the article on the metadata page, press Back, and the masthead is
still drawing a lock over a document anyone with the link can read.** The payload correct, the card
correct, and the two disagreeing with nothing in the app in a position to notice. It was found by
writing the review prompt, not by looking at the page.

So `AccessSharing` reports the flip upwards — `onVisibility`, threaded through `Metadata` and
`SharingSection` — and `OwnedArticle` layers it over the fetched payload, beside the rename it
already layers there for the same reason.

**Three values, not two.** A write that fails after the server committed leaves the card in
`WRITE_UNCERTAIN`: it does not know what is true, and neither does anybody else. So the callback's
`null` means *we no longer know*, and `OwnedArticle` turns it into a **deleted** `visibility` key —
which is already the spelling of *nobody could tell us*, because it is what the filesystem store
says. The mark then draws nothing, which is exactly what the card is saying two words away.

## Stages

1. **Carry the fact.** `Article.visibility` in `src/types.ts`; fill it in `src/store/pg.ts`;
   the parity exemption and its compensating assertion.
2. **Draw the mark.** The tooltip copy in `src/messages.ts`, the component in
   `src/web/Masthead.tsx`, a test that pins all three states and the visitor's nothing.
3. **Stop it going stale.** `onVisibility` from the card to `OwnedArticle`, and five cases in
   `tests/access-sharing.test.tsx` — see above.

## Checked in a browser

2026-09-04, Playwright against system Chrome on the box, article `fowler-phrenology`:

- desktop 1280 — the lock sits in its 28px box beside the upload glyph, both at `top: 48.8px`,
  level with the title's first line; no wrap, no overlap;
- the tooltip reads *"Only you can read this. Share it with anyone."*;
- the click lands on the metadata page. **The *Access & sharing* heading is at `top: 833px` on a
  1280×900 viewport** — just inside it, with about one row of scrolling needed to reach the switch
  itself. That is the cost of not deep-linking, measured rather than guessed;
- mobile 390 — the title wraps to four lines and both marks stay level with the first;
- publishing from the card and returning turns the lock into a highlighted globe and changes the
  tooltip with it (this is the section above, working);
- no new console errors.

## Follow-up

- Nothing here changes what a *shared* article's reader sees.
- The two marks beside each other now behave differently on hover: `OriginMark` has a bare
  `title` and this one has a real `Tooltip`. That is a real inconsistency, and the pair is
  worth levelling *up* — a `title` waits a second, is unreachable by touch, and a keyboard
  reader never sees it.
- The mark is in the masthead, which scrolls away by design (Masthead.tsx says why). If it
  turns out to be wanted while reading, the dock is where a permanent version would go.
