# Author gifts: a link to the draft, the article passing to its recipient, and `/admin/articles`

**Status as of 2026-10-11: planned, not built.** Up: [admin.md](../project/admin.md). Report
`spya-wqvxjv` (#550, SPIDERYARN-READING2-GZ, queue item `qi-nv3v2p2n`), an administrator's (provenance
proved, `feedback-reporter.ts` exit 0). Builds on
[261010r](261010r-mcp-gift-any-article-and-send-makes-the-link.md) (an agent drafts, *Send* makes the
link), [261010c](261010c-author-gift-draft-voucher-from-the-add-page.md) (author gifts) and
[261007j](261007j-gift-voucher-starter-article-by-private-link.md) (a voucher's starter article).

## What Greg asked for

> Can we create & return a URL for a draft author gift, that the harness can open in a browser for me?
>
> Also, it when the recipient of the gift voucher with an associated article signs in, we actually
> want to transfer ownership to the private link that we've sent them, so that they then own that
> article and can use chat and everything else fully.
>
> And more generally, we want a /admin/articles page, which includes a way for me to transfer
> ownership of an article from one user to another. I realise there are a bunch of potential
> complexities here. Like, what happens if I'd filled out though why you're reading this for the
> article? Use your judgement and just pick whatever is going to be good for the user but avoids too
> much complexity. Check it works with tests and/or browser automation.
>
> — Greg, 2026-10-11 (`spya-wqvxjv`, from `/admin/vouchers`)

## What is true today (the ground this stands on)

- **An article is one row of `articles`, and everything else hangs off its `id`.** No composite
  foreign key includes `owner_id`, there is no RLS and no update trigger on `articles`, and `slug` is
  globally unique. Every owner-scoped read goes through the article (`ownedSlug`,
  `articleIdForOwned`). So `UPDATE articles SET owner_id = B` breaks no constraint and **moves every
  child row with it**, including A's comments and chats, which B would then read. Storage keys are
  content-addressed, not per owner. (Map made by a subagent on 2026-10-11 against `src/db/schema.ts`
  and `drizzle/`.)
- **Nothing in `src/` changes an article's owner today.** The only precedent is
  `scripts/db-reown.ts`, a local-only whole-account tool.
- **The private link is `/read/<slug>?key=…`**, the same address the owner reads at, and the reading
  view asks the owner route first, falling back to the link only on a 404. So once the article is
  B's, the link in B's email opens it as B's own article, with chat and every mode.
- **A voucher is claimed when its recipient's plan is read** (`claimVouchersFor`, from
  `GET /api/billing/usage`), which the shelf and the profile do. The reading view does not.
- **The draft tool answers `review: <site>/admin/vouchers`**, the page, not the gift. The page
  already has an anchor per gift card (`authorGiftAnchor`) and scrolls to one it has highlighted.

## Decisions

### D1. A link to one draft: `/admin/vouchers?gift=<id>`

The page reads `gift` from its address once, highlights that card and scrolls to it, exactly as it
does today for a gift *Draft a gift* found already existing. `draft_author_gift` answers
`review: <site>/admin/vouchers?gift=<id>` (both when it made one and when one existed), and
`list_author_gifts` gives each gift its `url`. The harness opens it; the admin is signed in, so it
is just a page. The id is an opaque UUID behind the admin gate, so the address grants nothing.

### D2. Transferring an article: one store function, used by both callers

`transferArticle(tx, { articleId, from, to })` in a new `src/store/pg-article-transfer.ts`. Under a
lock on the article row, with `owner_id = from` rechecked:

1. **Refuses** (nothing changes) when: the article is not `from`'s any more; `from = to`; the
   target account is not a live account with a confirmed address (the Auth Admin API, as
   `/admin/users` reads it); a job on the slug is not terminal (`TERMINAL` in `pg-jobs.ts`), because
   its writes are fenced on the old owner; or `processing = 'minimal'` (added as an abstract only),
   because *Read this* charges and supersedes an `ingest_events` row by owner and would fail for the
   new owner — read it in full first.
2. **Moves the article**: `owner_id = to`. Everything the article *is* goes with it — its
   revisions, blocks, structure, summaries and every mode's model-made artefacts, its visibility,
   its private link and key (so the email's link keeps working, and the new owner can turn it off),
   High-powered AI.
3. **Resets the old reader's state on the row**: `purpose` ("why you're reading this", Greg's
   example), `title_override`, `archived_at`, `opens`, `last_opened_at`, the Skim notice's
   dismissal. They described A's reading, not the piece; B starts as if they had just added it.
4. **Deletes the old owner's own words and activity on it**: comments (highlights, bookmarks,
   notes), chat threads (and their messages), quiz attempts, Referee criteria (and what was found
   against them), searches, reading time, hidden glossary entries, dismissed notices and
   suggestions, link summaries. These are A's, and handing them to B would show B A's private notes
   — on an author gift, possibly what Greg wrote about the author. Deleting rather than keeping them
   orphaned is the only option that neither leaks nor leaves rows nobody can reach.
5. **Leaves history where it is**: `ingest_events`, `jobs`, `import_records`, `uploads`, `ai_calls`,
   the visibility and share-link audit rows. They record what A did and paid for; the transferred
   article does not count against B's allowance and keeps counting against A's.

It returns what it deleted, by kind, as counts. **Every table with a foreign key to `articles` is
named in one classification map in that file — moves, deleted, or history — and a test reads the
schema and fails when a table is in none**, so a table added next month cannot silently ride along
to the new owner (the silent-success class: the obvious test of a transfer would pass while leaking
the new table's rows).

**Passed over:**

- **Move everything** (one `UPDATE`). Simplest, but B reads A's private comments and chats.
- **Refuse while A has any words on it.** Safe, but on the sign-in path it would fail silently for
  any article Greg had chatted with or highlighted, and he would never know why.
- **Copy rather than move** (A keeps theirs). Far more machinery (every child table duplicated,
  block ids reminted or shared) for a case nobody asked for.

### D3. On sign-in, a gift's starter article becomes the recipient's

Inside `claimVouchersFor`'s transaction, for each voucher it claims that has a starter article, in
a savepoint: `transferArticle(starter, from: voucher.created_by, to: claimant)` — **only when** the
article still belongs to the voucher's creator, and **no other voucher that is not revoked names the
same article** (the voucher form lets one article be the starter of several; the first claimant
taking it would leave the others' links pointing at somebody else's article). A refusal is logged
(kind only) and the claim still commits: the voucher matters more than the move, the recipient can
still read through the link, and the admin can move it by hand on `/admin/articles`. Every voucher
with a starter, not only author gifts, because Greg's words are "the gift voucher with an associated
article".

**When it happens.** Today's claim runs only when the plan is read (shelf, profile). Recipients
arrive on the article itself, by the email's link, and sign in from there. So the reading view, for
a signed-in reader looking at an article **through a private link**, asks once
`POST /api/vouchers/claim` → `{ claimed, articles: [slug…] }` (the same `claimVouchersFor`), and if
this slug is among those that became theirs, reloads the article as its owner. That covers every
way of signing in, including a reader who was already signed in when they clicked.

**Passed over:** claiming in the sign-in callback (`AuthCallback.tsx`). It is listed as a defence
in [security-map.md](../project/security-map.md#where-the-defences-physically-live), and it misses
password sign-in, which happens in the page, and a reader already signed in.

**What the admin is told.** The *Send* confirmation for an author gift, and the voucher form when a
starter is chosen, say in one line that when they sign in the article becomes theirs and your
notes and chats on it are deleted. The Author gifts card and the voucher row say *Now theirs* once
the starter belongs to the claimant (derived, no new column): today the gift list resolves its
starter through the admin's own shelf and would otherwise say the article is gone.

### D4. `/admin/articles`: every article, and *Transfer*

A new admin page and two routes, behind the existing `/api/admin` gate:

- `GET /api/admin/articles` — every article, newest first: short id, owner's address, created,
  visibility, processing, and the **title only when the article is the administrator's own or
  public**; others are their short id. [admin.md § What it deliberately does not
  show](../project/admin.md#what-it-deliberately-does-not-show) holds that which articles a reader
  has is their reading and does not leave their session, and the slug carries the title's words, so
  no slug either. A reader's article is found by the short id they give you (it is in every
  address and on the metadata page). Showing every title would be a decision about that line, which
  Greg can make by saying so; it is a one-line change in the projection.
- `GET /api/admin/articles/:id/transfer` — what a transfer would delete, as counts, and whether it
  would be refused and why.
- `POST /api/admin/articles/:id/transfer` `{ to, expectedFrom }` — the transfer, with
  `expectedFrom` the owner the page showed (a 409 if it has changed). Answers the counts deleted.

The page: a table (filter by owner address or short id), and on each row *Transfer…*, which opens a
confirmation: pick the new owner from the accounts list, see what will be deleted, press *Transfer*.

**This is the second admin write across owners**, after the voucher claim's account binding; it is
behind the same gate (`routes.ts`, `isAdmin`), touches no defence, and is written into admin.md as
the page that writes another reader's article.

### Bounds

- **No defence is edited.** `ownedSlug`, the gate, the sign-in callback, the public and link
  lookups, and the sanitiser are as they were. The new routes are rows behind the `/api/admin`
  gate, and the claim route is an ordinary signed-in route that acts only on vouchers addressed to
  the caller's confirmed address.
- **No migration.** No new column: *Now theirs* is derived from the owner.
- No deploy, no production write.

## Tests (failing first)

1. `tests/article-transfer.test.ts` (database): a transfer moves the row and its artefacts (a
   summary, a revision), resets the reader columns, deletes A's comments, chat, quiz attempts and
   reading time, leaves `ingest_events` with A, and B then reads it through `ownedSlug` while A
   gets a 404. Refusals: not A's, a live job, `minimal`, same owner, unconfirmed target. The
   classification test: every table with a foreign key to `articles` is classified.
2. Claim (`tests/billing-vouchers.test.ts` or a new file): claiming a voucher with a starter moves
   the article to the claimant; a starter shared by two vouchers does not move; an article the
   creator no longer owns does not move; a refused transfer still claims the voucher.
3. Routes: `/api/admin/articles…` are 403 to a non-admin; the listing hides another reader's title
   and slug; a stale `expectedFrom` is 409. `POST /api/vouchers/claim` answers the moved slug.
4. MCP: `draft_author_gift` answers `?gift=<id>`; `list_author_gifts` has `url`.
5. Pages: `/admin/vouchers?gift=<id>` highlights that card; `/admin/articles` lists and confirms.
6. Browser (Sonnet subagent, Playwright on the box): the admin moves an article on
   `/admin/articles`; a second account opening a starter's private link while signed in sees it
   become theirs.

## Stages

1. **D1** — the gift link. Small; MCP and the vouchers page.
2. **D2 + D4** — the transfer function with its classification test, the admin routes and the page.
3. **D3** — transfer on claim, the claim route, the reading view's ask, the admin's warnings and
   *Now theirs*.
4. Docs (`admin.md`, `billing.md § Gift vouchers`, `marketing-author-gifts.md`, `mcp.md`), the
   browser check, the note and the bookkeeping.

GPT Sol on this plan before building (read-only); GPT Sol on the code before pushing
(write-capable).

## Deferred

- Showing every reader's titles on `/admin/articles` (D4) — Greg's call on admin.md's line; not
  queued unless he asks.
- A recipient who was signed in and never opens the article by its link gets it on their next visit
  to the shelf (the existing claim), which is fine.
