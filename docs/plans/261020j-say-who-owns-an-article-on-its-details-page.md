# Say who owns an article, on its details page

Feedback report `spya-cf30ac` (#622, `SPIDERYARN-READING2-KF`), from Greg (admin;
`feedback-reporter.ts` exit 0), 2026-10-19 17:29 UTC, from
`/read/tinbergen1963onethology-spya-ks84se/metadata`. Overseer queue item `qi-kz4dtr4a`.

> It doesn't seem obvious who owns an article, so I'm lost track of whether this is an article that
> I own or whether it's an article that somebody else owned when I set up a gift voucher for them.
> Maybe it could be under the sharing section.
>
> I'm an admin, so I want all of the details that we have, e.g. Who owns it? Whether it's public?
> Whether there's a private link for it? How many people and who have opened the private link? Etc.
>
> But for a non-admin user, it should only tell them if they're the owner, or if it's public, or if
> it's a private link, etc.
>
> — Greg, 2026-10-19

Adjacent work, read first: [261019n](261019n-admin-sees-other-users-articles-and-views-as-them.md)
(view-as and Inspect, awaiting Greg as `q-kyhvkm`). Nothing here depends on its answer, and nothing
here pre-empts it: no title, prose or reading of another reader's article reaches an admin page.

## What there is today

The article's details page (`/read/<slug>/metadata`) is two different pages
([reader-capability.ts](../../src/web/reader-capability.ts) § What "visitor" means):

- **The owner's** (`Metadata.tsx`) — drawn only when the owned read answered, so its reader *is*
  the owner. Its *Access & sharing* card says "Only you can read this" / "…anyone who has the
  private link" / "Anyone can read this…". It never says the word *own*, nor which account.
- **A visitor's** (`PublicPages.tsx` § `PublicMetadataPage`) — anybody else, signed in or not.
  Its banner (`SharedNotice`) says public or private link. It has no sharing section, and never
  says *this is not yours*.

So both halves of the non-admin ask are nearly there; what is missing is the sentence about
ownership. For the admin, `/admin/articles` already lists every article's owner address by short
id, with its visibility — but not on the article's page, and not whether it has a private link.

## What was built, after GPT Sol's plan review

[The review](261020j-say-who-owns-an-article-on-its-details-page-plan-review-sol.md) changed part 3,
and the section below it is the draft as reviewed, kept for the reasoning.

- **Sol F1 (accepted): part 3 as drafted widened a defence.** Holding a private link's key lets you
  read the article; it does not let you learn whose account it is on, nor prove the owner handed you
  the key. `/admin/articles` keeps another reader's private article to an opaque id beside its
  owner, so joining that owner to a slug and a title in the admin's browser is new. So part 3 is
  **public articles only**, and the private-link half is asked (`q-agbc89`).
- **Which made the new route unnecessary** (Sol F7). `/api/admin/articles` already carries a slug
  only for the admin's own and public articles, so the visitor page reads that list and matches by
  slug: a private-link article *cannot* match, which is the rule held by the server rather than by
  the component. No route, no key handling, and F2 (the drafted `where` was looser than the public
  read) and F6 (`accountEmail`) do not arise. A private link gets one sentence saying its owner is
  not shown, and no request. *Has a private link* for another reader's public article is not shown:
  the list does not carry it, and on a public article it changes nothing about who can read.
- **F5 (accepted):** the page is handed the `readerId` access was resolved for. The admin line asks
  only for `isAdmin(readerId)`, a confirmed session and a public article, and is keyed on slug and
  reader. The account address is shown only when the session's id is that reader's.
- **F4 (accepted as ordinary staleness):** a transfer while the page is open leaves "You own this
  article" on the old owner's tab until reload, as it leaves the whole card. The gift-claim hook
  re-reads the article as the owner once the claim settles, which swaps the visitor page for the
  owner's; nothing new is needed for it.
- **F3 (accepted):** the link-open question is reframed (below, and in `q-agbc89`).

Built: `src/web/Ownership.tsx` (`Ownership`, `AdminOwnerLine`), its first line in the owner's
*Access & sharing* card (`Metadata.tsx`), an *Access* section on `PublicMetadataPage`, the strings
in `src/messages.ts` § Sharing a document, a line in the Help's sharing page, and
[admin.md § Whose article it is](../project/admin.md#whose-article-it-is-on-its-details-page).
Tests: `tests/article-ownership.test.tsx`.

## The draft as reviewed (simplest version)

**1. The owner's card says so.** A first line in *Access & sharing*: **"You own this article"**,
followed by the account it is on ("signed in as greg@…"), from the session's own `user.email`,
nothing fetched. Same for everybody; for the admin it answers the question fully, because on this
page the reader is the owner. Public and private-link state are the card's existing two switches.

**2. A visitor's page says so.** A small *Access* section on `PublicMetadataPage`:

- signed in, session confirmed: **"You don't own this article."** then the existing
  `sharedSentence(sharedBy)` ("public" / "private link").
- signed out: no ownership claim (we cannot say), just the shared sentence.
- session unconfirmed: no ownership claim; `SharedNotice` already says the session could not be
  confirmed, which is exactly the case where it might be theirs.

**3. An admin visitor also sees the owner.** On `PublicMetadataPage`, when `isAdmin(user.id)`, the
section adds: owner's address, public or not, private link on or off. From a new route

```
GET /api/admin/articles/:slug/ownership[?key=…]
  → { ownerEmail: string | null, mine: boolean, visibility: "public" | "private", privateLink: boolean }
```

behind the existing namespace gate. **It answers only for an article the asker could already read
as a visitor**: the lookup's `where` is `publicAccessWhere(slug, accessFor(key))`, the same predicate
the public read uses, so a slug that is private and comes without its key is the ordinary 404. No
key, no title and no prose in the answer; `share_token` is not selected (only `share_token IS NOT
NULL`), so `tests/share-link-token-stays-home.test.ts`'s rule holds. The address comes from the
Auth service for one id (the existing `listAccounts` path the list route uses, filtered, or a
single-user lookup if one exists — whichever is already shared code).

### Why this is not an edit to a defence

[admin.md § What it deliberately does not show](../project/admin.md#what-it-deliberately-does-not-show):
admin pages show account metadata, never "a title … or a sentence of anybody's reading", and
"identifiers may not be followed into articles". This route does not follow an identifier into an
article: the admin is already reading the article as a visitor, because it is public or because its
owner gave them the key. Everything it returns is already on `/admin/articles` for that short id
(owner address, visibility), except *has a private link*, a boolean about the article's sharing of
the same kind as visibility. The cost route's precedent ("only for an article the administrator
owns") is about *what somebody did with* an article; ownership is not that. If the reviewer
disagrees, part 3 drops to public articles only, or is deferred and asked, and parts 1–2 ship alone.

admin.md gets a short section saying what the route returns and why, beside § One article's cost.

## Deferred, and asked

**Who opened the private link, and how many.** Nothing records it: a link visit is an anonymous
read through `linkSharedSlug`, and nothing is written. Recording it is a new field stored about
readers (and, for a signed-out visitor, about somebody who has no account to attach it to), so per
the brief it is planned and asked rather than built. The shape, for the question:

- **Count only**: a counter on the article (`share_link_opens`, `share_link_last_opened_at`),
  bumped on each public read that matched by key. No person recorded. Cheap; says nothing about who.
- **Signed-in openers**: a row per (article, reader account, first/last opened) when the visitor is
  signed in; signed-out opens counted only. Tells the admin *who* among accounts; needs a privacy
  page line, and a decision on whether the owner sees it too.

Either resets when the owner makes a new key. Question file `q-…` under
`docs/user-feedback/questions/`; queued as its own Overseer item.

**Reframed after Sol F3.** A "read that matched by key" is not an open: the same predicate serves the
article, its head, assets, comments and searches, and reloads are loads, not people. The anonymous
read carries no credentials by design (`src/web/public-api.ts`), so knowing *who* needs a separate,
signed-in "I opened this" call from the page. And `privacy.md` says today that who opened a link is
not recorded, so any choice but nothing changes that page. The three options, as `q-agbc89` puts
them: nothing; a count of article loads per key, explicitly not people; or signed-in accounts
recorded by a separate call, signed-out visitors counted only. Nothing is retroactive.

**Simpler option passed over**: put the owner's address into the existing public payload when the
requester is the admin. Fewer parts, but it braids an admin-only field into the public DTO that
strangers' requests are built from, which `tests/public-dto-owner-only-fields.test.ts` exists to
keep clean.

## Tests

- owner card: renders "You own this article" and the account address (red first).
- visitor page: signed in → "You don't own"; signed out and unconfirmed → no ownership claim.
- route: admin on a public slug → owner/visibility/privateLink; private slug without key → 404;
  with the right key → 200; wrong key → 404; non-admin → 403 (the namespace gate); answer has no
  `title`, `slug` or token key.
- visitor page as admin: draws the owner line from the route; non-admin makes no request.
