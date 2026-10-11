# Author gifts: a link to the draft, the article passing to its recipient, and `/admin/articles`

**Status as of 2026-10-11: revision 2; stage 1 (D1) built, stages 2–4 building.** Up: [admin.md](../project/admin.md). Report
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
- **The draft tool answered `review: <site>/admin/vouchers`**, the page, not the gift, until stage 1
  below. The page already had an anchor per gift card (`authorGiftAnchor`).

## Decisions (revision 2, after GPT Sol's plan review and Opus's arbitration)

Revision 1 was rejected by Sol ([261011n-plan-review-sol.md](261011n-plan-review-sol.md)); what
changed and why is under § Plan review, below.

### D1. A link to one draft: `/admin/vouchers?gift=<id>` — built (stage 1, `0bec3ac7c`)

The page reads `gift` from its address (a UUID or nothing), highlights that card and scrolls to it,
as it already did for a gift *Draft a gift* found existing. `draft_author_gift` answers
`review: <site>/admin/vouchers?gift=<id>` whether it made the gift or found one, and
`list_author_gifts` gives each gift its `url`; the MCP instructions tell the agent to hand it over or
open it. The address grants nothing: an opaque id behind the admin gate.

### D2. Transferring an article: one store function, used by both callers

`src/store/pg-article-transfer.ts`. The target account is checked **before** the transaction
(`confirmedAccountEmail`: live, with a confirmed address; Sol F11). Then, in one transaction, under
`SELECT … FOR UPDATE` on the article row with `owner_id = from` rechecked:

1. **Refuses**, changing nothing, when: the article is no longer `from`'s (stale); `from = to`; a job
   on the slug is not terminal; or `processing = 'minimal'` (abstract only; *Read this* supersedes
   by owner and would fail for the new owner — read it in full first). Sol agreed these are right.
2. **Moves the article**: `owner_id = to`. What the article *is* goes with it: revisions, blocks,
   structure, summaries, every mode's model-made artefacts, checkpoints.
3. **Makes it private** (Sol F2): `visibility = 'private'`, `public_at`, `share_token`,
   `share_token_at` cleared. A shared view carries the owner's marks, notes and searches, so a key
   A handed out must not open B's future notes. The recipient is already reading it as its owner by
   then (owner first, link second), and can share it again themselves.
4. **Resets A's state on the row**: `purpose` (Greg's "why you're reading this"), `title_override`,
   `archived_at`, `opens`, `last_opened_at`, the Skim notice's dismissal, `asked_url` (A's pasted
   string, which may carry a credential; Sol F4), `high_power_since` (Sol F5), `updated_at`.
5. **Deletes A's own words and activity on it**: comments, chat threads (messages cascade), quiz
   attempts, Referee criteria (with their claims and hidden checks), sources claim checks, searches,
   reading time, hidden glossary entries and glossary lookups (reader-added terms), citation finds
   and investigations, tags, dismissed notices and suggestions, link summaries (Sol F8).
6. **Freezes A's billing rows and unlinks them** (Sol F5): one `UPDATE ingest_events SET
   article_visibility_at_delete = <the visibility before step 3>, article_id = NULL WHERE article_id
   = X` — the shape the delete trigger already writes (`20260907200800`), so A's usage is priced as
   it was and no longer moves with B's choices, and the once-per-article High-powered charge is free
   for B to pay. `jobs`, `import_records`, `uploads`, `ai_calls` and the visibility and share-link
   audit rows stay as history.

It returns the counts it deleted, by kind. A **preview** (the same counts, and the refusal if one
would apply) is read without locking, for the confirmation.

**Every table with an `article_id` or `starter_article_id` column, and every table linked by owner
and slug, is named in one classification map — moves, reader state (deleted), history — and a test
reads `information_schema` and fails on a table in none** (Opus: the column scan, no FK-graph
traversal). A new table cannot then ride along to the new owner unnoticed.

**Residual, recorded rather than built (Sol F1, Opus ruling):** a write of A's that resolved the
article id before the transfer committed and inserts after it lands on B's article. It needs A to
be writing to that article in the milliseconds the admin's press runs; any later request of A's gets
a 404. The fix is to fence every owner-scoped write with the article lock and an owner recheck (about
71 `articleIdForOwned` sites) or an owner-coupled foreign key; queued. The same goes for Sol F7, a
voucher being created with an article as its starter at the instant that article is transferred:
both are the administrator's own presses.

### D3. On sign-in, a private gift article becomes the recipient's

Inside `claimVouchersFor`'s transaction, for each voucher it claims with a starter, in a savepoint,
**all or nothing**: the article moves to the claimant only when it is still the voucher creator's,
is **private** (Greg's words: "transfer ownership to the private link that we've sent them"; a public
starter moving would pull it off the public shelf; Opus), no other unrevoked voucher names it, and
**A has none of their own words on it** — only reading time, opens and the row's columns, which are
reset (Sol F3: nothing Greg wrote is deleted unattended). Otherwise the voucher is claimed as today,
the recipient reads through the link, and the admin sees *Transfer on /admin/articles*. A refusal is
logged by kind only.

**No migration** (Sol F3 asked for a per-voucher intent column; overruled by Opus: Greg's words
state the intent for every voucher with an article, and with the rule above nothing of his is
deleted).

**When it happens.** The claim runs on `GET /api/billing/usage` (shelf, profile). The reading view,
for a signed-in reader on a private link, calls that same route once (no new route; Sol F6), which
now answers `claimedArticles: [slug…]`, the starters this call moved; if this article's slug is
among them the view re-reads it as its owner. The effect lives in `ArticlePage.tsx`, not in
`article/access.ts`, which holds the sanitiser's ingress. The sign-in callback is not touched.

**What the admin sees.** The Author gifts card and the voucher row say *Now theirs* once the starter
belongs to the claimant, or *Claimed; the article is still yours — transfer it on /admin/articles*
when it did not move. Derived from the owner; no column. The *Send* confirmation says in one line
that when they sign in, a private article becomes theirs.

### D4. `/admin/articles`: every article, and *Transfer*

- `GET /api/admin/articles`: every article, newest first: the short id (the article id where it
  has none, Sol F9), the owner's address, created, visibility, processing, and the **title only for
  the administrator's own articles and public ones**; no slug for others (it carries the title's
  words). A row per article does tell the admin how many articles each reader has and when they
  were added, which admin.md already shows as counts; *which* articles stays hidden. Showing every
  title is Greg's call on admin.md's line, a one-line change.
- `GET /api/admin/articles/:id/transfer`: the preview (counts, or why it would be refused).
- `POST /api/admin/articles/:id/transfer` `{ to, expectedFrom }`: the transfer; 409 when the owner
  has changed. `:id` must be a UUID (400 otherwise).

The page: a table filterable by address or id, *Transfer…* on each row, a confirmation that picks
the new owner from the account list, shows what will be deleted and that it will be made private,
and re-reads the preview just before the press (Opus).

### Bounds

- **Defences.** `src/routes.ts` gains route rows only; its gate, `requireUser` and `slugPart` are
  unchanged (Sol F10 overruled by Opus: the defence named in security-map is those, and 261010c/r
  added rows the same way). `ownedSlug`, `article/access.ts`, the sign-in callback, the public and
  link lookups and the sanitiser are not touched.
- **No migration**, no deploy, no production write.

## Plan review (GPT Sol, read-only): REJECT → revised

[261011n-plan-review-sol.md](261011n-plan-review-sol.md). Opus arbitrated F1, F3 and F10.

- **F1 (P0) stale write lands on B's article** — reduced to a recorded residual with its fix queued
  (D2), per Opus: in flight in milliseconds of a rare admin press, and the cheap trigger would not
  cover the tables without an owner column.
- **F2 (P0) visibility and key kept** — adopted (D2.3).
- **F3 (P0) no recorded intent, unattended deletion** — the deletion half adopted (D3 moves only an
  article with none of A's words); the migration overruled (Opus); narrowed to private starters.
- **F4 (P0) `asked_url`** — adopted (D2.4).
- **F5 (P1) billing rows stay linked** — adopted (D2.6).
- **F6 (P1) a new claim route, and public starters** — adopted: the existing route; public
  starters no longer move at all.
- **F7 (P1) create-vs-transfer race** — recorded with F1.
- **F8 (P1) classification incomplete** — adopted (D2.5 and the column scan).
- **F9 (P1) short ids are nullable** — adopted (D4).
- **F10 (P1) routes.ts is a defence** — overruled (Bounds).
- **F11 (P2) Auth lookup inside the lock** — adopted.
- **F12 (P2) D1 already built** — yes, stage 1 landed while the review ran.

## Tests (failing first)

1. `tests/article-transfer.test.ts` (database): the move, privacy, row reset, deletion of every
   reader-state kind (seeded), ledger rows frozen and unlinked, B reads it through `ownedSlug` and A
   gets a 404. Refusals: stale owner, live job, minimal, same owner. The classification scan.
2. Claim: a private starter with no words of A's moves and is in `claimedArticles`; one with a
   comment of A's, a public one, one shared by two vouchers, and one A no longer owns do not, and
   the voucher is claimed every time.
3. Routes: 403 to a non-admin; another reader's title and slug absent from the list; a stale
   `expectedFrom` is 409; a non-UUID id is 400.
4. Pages: `/admin/articles` lists and confirms; the reading view re-reads when its slug moved.
5. Browser (Sonnet, Playwright on the box): the admin moves an article on `/admin/articles`.

## Stages

1. **D1**: done.
2. **D2 + D4**: the transfer, its classification test, the admin routes and the page.
3. **D3**: transfer on claim, `claimedArticles`, the reading view's call, the admin's labels.
4. Docs (`admin.md`, `billing.md § Gift vouchers`, `marketing-author-gifts.md`, `mcp.md`), the
   browser check, the note, the queue entries.

GPT Sol on the code before pushing (write-capable).

## Deferred, each to get a queue entry

1. Fence owner-scoped writes against a concurrent transfer (Sol F1/F7; D2 residual): `qi-3recafqm`.
2. Showing every reader's titles on `/admin/articles`: only if Greg says so (no entry).
