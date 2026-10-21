# The administrator sees a private link's owner, and who opened it

The deferred half of report `spya-cf30ac` (#622, `SPIDERYARN-READING2-KF`), from Greg (admin).
Question [q-agbc89](../user-feedback/questions/q-agbc89.md), queue item `qi-pf9h5nps`. The built
half is [261020j](261020j-say-who-owns-an-article-on-its-details-page.md), which this extends.

Greg's reply `spya-xug3kf`, 2026-10-20 21:41 UTC:

> As an admin, I want to be able to see anything. Because after all, I've got access to the
> database anyway. And it may be useful for debugging. And yes, I'm interested to know and store
> which users open which articles.

So he chose **1B** (on an article read through a private link, the administrator sees whose it
is) and **2C** (record the signed-in accounts that open a private link, plus a count of signed-out
opens). His reply is the authority for exactly those two, and nothing wider: no key-less lookup of
somebody else's private article, no owner (non-admin) view of who opened, no record of public
reads.

## After GPT Sol's plan review

[The review](261021d-admin-sees-a-private-link-s-owner-and-who-opened-it-plan-review-sol.md)
found no way for a non-admin to read an owner, an opener or a count, and confirmed the admin
lookup admits exactly the administrator's own, public, or correctly keyed article. All seven
findings taken; the design below is the draft as reviewed, and these override it:

- **F1 (P1): two writers, not one file.** The public graph gets a leaf that can write only the
  signed-out count: `src/store/private-link-signed-out-opens.ts`, importing the schema and
  `public-access.ts`. The signed-in writer, which takes a reader id, is
  `src/store/pg-private-link-openers.ts`, outside the public graph, beside the admin read.
  `tests/public-imports.test.ts` allows the one table and forbids `private_link_openers`.
- **F2 (P1): the anonymous write is bounded, and called approximate.** The increment saturates
  (`least(opens + 1, 2147483647)`) and is throttled in the upsert itself: at most one per article
  per two seconds (`on conflict … do update … where last_opened_at < now() - interval '2
  seconds'`), so a loop can raise it by at most ~43,000 a day and two genuine signed-out opens in
  the same two seconds count once. Each request is still one indexed write, comparable to the
  reads every public route already lets a key-holder repeat; there is no per-IP limiter in this
  app to reuse, and a Vercel firewall rule is infra this session may not touch. Entered as
  [R31](../project/security-risks.md#r31), *known*, for Greg to accept or ask for the rule. The
  admin line says *about N signed-out opens*.
- **F3 (P1): the Help page.** `src/web/help/pages/sharing.md` says *"We cannot tell you who has
  opened it"*; rewritten (owners still cannot; the administrator can), and the Help corpus
  regenerated.
- **F4: the client cannot know "has been link-shared".** The route returns `privateLink` (a link
  is on now: `share_token_at is not null`, the boolean `/api/admin/articles` already carries), and
  the openers line is drawn when a link is on or any open is recorded.
- **F5: a dedicated client helper.** `publicFetch` stays path-and-signal only; a new
  `notePrivateLinkOpened(slug, key)` in `public-api.ts` hardcodes `POST`, `credentials: "omit"`,
  no body, no headers, after the same namespace guard.
- **F6: the exact predicate.** `public-access.ts` gains `privateLinkWhere(slug, key)` —
  `linkSharedSlug(slug, key) and visibility = 'private'` — rather than `publicAccessWhere` with
  its public arm cancelled. In that file because it is the one file allowed to import
  `link-shared-slug.ts` (`tests/owner-isolation.test.ts`), and it is still not imported by the
  listing.
- **F7: Active days.** `activitySources` (`src/store/pg-admin.ts`) does not count opener rows;
  its comment says so. Counting them is a separate decision.

## What there is today

- A visitor's details page (`PublicPages.tsx` § `PublicMetadataPage`) has an *Access* section.
  For the administrator, `AdminOwnerLine` (`src/web/Ownership.tsx`) reads `GET /api/admin/articles`
  and matches by slug; that list carries a slug only for the administrator's own and public
  articles, so a private-link article cannot match, and the line says its owner is not shown.
- Nothing records an open of a private link. The visitor's article is read through
  `/api/public/…?key=`, which carries no credentials by design, and the public namespace refuses
  every method but GET and HEAD (`src/public/routes.ts` § `requireReadMethod`).
- The privacy page says *"We cannot tell you who has read it"*, and privacy.md § A private link
  says *"We record nothing about who opens one."*

## The design

### 1. One admin route for both questions

```
GET /api/admin/articles/:slug/access[?key=<key>]
  → 200 { ownerId, ownerEmail: string | null, emailsAvailable: boolean,
          opens: { accounts: [{ readerId, email | null, opens, firstOpenedAt, lastOpenedAt }],
                   signedOut: { opens, firstOpenedAt, lastOpenedAt } | null } }
  → 404 for anything else
```

Under `/api/admin/`, so the namespace gate (`src/routes.ts`, one account id) refuses everybody
else before it runs. **It answers only for an article the administrator can already read**:

```
where ownedSlug(slug)  OR  publicAccessWhere(slug, accessFor(parseShareKey(key)))
```

— their own (for the owner's card, below), or one a visitor holding this request's key could
read: public, or private with the right key. A private article named without its key is the
ordinary 404, so the route cannot be used to learn whose a slug is without the link. That is 1B
as asked: *on an article you are reading through somebody's private link*. Both predicates are the
existing exported ones; no new `eq(articles.slug, …)`, no change to `publicSlug`,
`linkSharedSlug`, `publicAccessWhere` or the public DTO. `share_token` is never selected.

The owner's address comes from the Auth service by the same `listAccounts` call
`/api/admin/articles` makes, and the openers' addresses from the same listing, joined in memory;
a failed listing costs the addresses, not the answer (`emailsAvailable: false`), as there.
`Cache-Control: private, no-store`.

**`AdminOwnerLine` moves to this route**, for public articles as well as private links, and stops
reading the whole list. One way to ask whose an article is, not two.

### 2. Recording who opens a private link

Two tables, each saying one thing:

| `private_link_openers` | |
|---|---|
| `article_id` | `uuid not null` → `articles(id)` on delete cascade |
| `reader_id` | `uuid not null` → `auth.users(id)` on delete cascade (by hand, as every owner key) |
| `opens` | `integer not null default 1` |
| `first_opened_at`, `last_opened_at` | `timestamptz not null default now()` |
| PK | `(article_id, reader_id)` |

| `private_link_signed_out_opens` | |
|---|---|
| `article_id` | `uuid` PK → `articles(id)` on delete cascade |
| `opens` | `integer not null default 1` |
| `first_opened_at`, `last_opened_at` | `timestamptz not null default now()` |

Both written by one upsert (`insert … select id from articles where … on conflict do update set
opens = opens + 1, last_opened_at = now()`), so there is no read-then-write and two tabs at once
make two increments on one row. The `where` is **`publicAccessWhere(slug, {kind:"link", key})
and visibility = 'private'`** — exactly *private, and this key matches*. A public article read
with a key is a public read and is not recorded; a wrong key, an unknown slug and a link turned
off write nothing. The signed-in arm also requires `owner_id <> reader` (an owner is never shown
the visitor page, but the server does not rely on that).

*Why not one table with a nullable `reader_id`?* A primary key cannot hold a null, so it would
need `UNIQUE NULLS NOT DISTINCT` and a reader of the table would have to know that a null means
"everybody signed out". Two tables say it in their names.

*Why a counter, not a row per open?* Greg asked which users open which articles, and when
(CLAUDE.md: store when it happened). First and last open per account answers that; a row per
open grows with every reload, and for the signed-out arm it would be a table anybody with the
link can grow without bound. The counter is bounded at one row per article.

**Not reset when the owner makes a new key** — the record is about the article, and it cascades
with it. **Not retroactive** — it starts empty on the day it ships.

### 3. Who writes it: one call per visitor page, from the page

Following `recordOpen` (`ArticlePage.tsx` § `OwnedArticle`): **from the page, once per slug per
mount** (a ref, because StrictMode runs effects twice), not from inside a GET — a GET that writes
is one a prefetch, retry or unfurler's HEAD inflates. It lives in `VisitorArticle`, so it runs on
both views and only for a visitor, and only when `sharedBy === "link"` and the address has a key:

- **Signed in, session confirmed** (`readerId` set, not `sessionUnconfirmed`):
  `POST /api/private-link-opens/:slug?key=` through `apiFetch(…, readerId)`, behind `requireUser`.
  Records the account.
- **Signed out** (`readerId === null`): `POST /api/public/private-link-opened/:slug?key=`,
  through the same credential-less `fetch` the visitor's other public requests use
  (`src/web/public-api.ts`). Bumps the count.
- **Session unconfirmed**: nothing. It may be the owner's own session.

Both answer **204 whatever happened**, so neither tells a caller more than the article GET it has
just made already did.

### 4. The one change to the closed room: a single POST in `/api/public/`

The signed-out count is the part of 2C that cannot be built without a write a stranger can reach:
the public namespace cannot see who is asking, and an authenticated route cannot be called by
somebody signed out. Two ways to do it:

- **A. Count inside the public article GET.** Keeps *public routes are GET and HEAD*, breaks
  *every GET is a pure read*. It would count every payload fetch — signed-in visitors' too, since
  that request carries no credentials — plus HEADs, retries and re-reads after a session event. It
  is option 2B (loads, not opens) wearing 2C's name.
- **B. One POST route, its own branch** — **chosen.** `servePublicApi` gets one write route
  matched before the read loop, with its own method check (POST only; `Allow: POST`), that reads
  no body and no header (the handler still has no `req`), writes one counter, and answers 204 with
  no body. `requireReadMethod` keeps guarding every read route; *"every public route refuses every
  non-read method"* becomes *"every read route; and one write route, which reads nothing back"*,
  and `tests/public-dispatch.test.ts` sweeps both.

The write's code lives in its own store file, `src/store/private-link-opens.ts`, importing only
the schema and `public-access.ts`, so the public import graph gains one leaf with no owner in it
(`tests/public-imports.test.ts`). The signed-in write lives in the same file with the reader id
as an argument (never `currentOwnerId()`); the admin read, which needs `ownedSlug`, is in
`src/store/pg-private-link-opens-admin.ts`, outside the public graph.

Abuse: anybody holding a link can inflate its signed-out count by calling the POST in a loop. It
grows one integer on a row that already exists; nothing is returned; only the administrator ever
sees the number. Accepted, and said where the number is shown ("signed-out opens, counted per page
load").

The invariant *"a signed-out browser issues no POST whatever"* (`tests/visitor-gaps.test.ts`,
`useArc.ts`) becomes *"…except this one, on a private link"*, and those tests stay as they are:
they read public articles, where nothing is sent.

### 5. Where the administrator sees it

- **A visitor's details page, *Access* section** (`AdminOwnerLine`): *Admin: it belongs to
  &lt;address&gt;.* — now for a private link too. Then, when the article is or has been
  link-shared, the openers: *Opened through its private link by a@…, 3 times, last 21 Oct; b@…,
  once, 20 Oct. 4 signed-out opens, last 21 Oct.* or *Nobody has opened it through its private
  link since we started recording on 21 October 2026.*
- **The owner's *Access & sharing* card**, only when the reader is the administrator: the same
  openers line, under the private-link switch. That is Greg's own case (his starter articles sent
  by voucher). A non-admin owner sees nothing new: whether owners should see who opened their link
  is a separate product and privacy call nobody has made.

Both through one component (`PrivateLinkOpens` in `Ownership.tsx`) reading the route once.

### 6. Privacy

The page (`src/web/PrivacyPage.tsx`, `LAST_UPDATED` → 21 October 2026):

- *Who can see your shelf*, the private-link sentences: *"We cannot tell you who has read it"*
  becomes: when somebody signed in opens it, we record their account and when (first and last
  open, and how many times); when somebody signed out opens it, we count it. Only the
  administrator can see that — not you, and not other readers. It goes when the article does, or
  when the opener's account does.
- *What we keep*: a bullet, **When you open somebody's private link while signed in** — the
  account, the article, when, and how many times; seen only by the administrator; goes with your
  account or the article.
- The admin paragraph already says an administrator may read anything to fix a bug; this adds the
  owner's address next to a private-link article, which privacy.md records.

docs/project/privacy.md § A private link gains the two tables and drops *"We record nothing about
who opens one"*.

### 7. Docs that move with it

- **admin.md § Whose article it is**: rewritten for the route; § What it deliberately does not
  show gains the exception, with Greg's words, for an article the administrator can already read.
- **security-map.md**: the defences table's `src/public/routes.ts` row (*read-methods only* → plus
  one write route); the key's travel paragraph (two more requests carry it: the signed-in POST,
  through `apiFetch`, and the signed-out one); the new store file as the one public writer.
- **public-readable-sharing.md** if it claims nobody records opens.

## Defence files touched (security-map's table), for the reviews

| File | Change |
|---|---|
| `src/public/routes.ts` | **one POST route** before the read loop, its own method check; nothing else in the dispatcher changes |
| `src/public/route-names.ts` | the route's name and pattern |
| `src/routes.ts` | two authenticated routes: the signed-in POST, and the admin GET under the namespace gate. No change to the gate itself |
| `src/web/lib/api.ts` | none expected; the signed-in POST goes through `apiFetch` bound to `readerId` |
| `src/store/public-access.ts`, `link-shared-slug.ts`, `public-slug.ts`, `owned-slug.ts` | **unchanged**; called from two new files |
| `src/public/dto.ts` | **unchanged**. Nothing is added to any public payload |
| `src/share-key.ts` | unchanged; both new routes run `?key=` through `parseShareKey` |

New: `src/store/private-link-opens.ts` (public-reachable writer), `src/store/pg-private-link-opens-admin.ts`
(admin read), the migration.

## Simpler options passed over

- **Count inside the GET** (§ 4 A) — fewer parts, wrong number.
- **Show the owner via the existing list** by adding private-link slugs to `/api/admin/articles` —
  that would list every private article's slug and title to the administrator, key or none:
  wider than 1B.
- **Key-less admin lookup by slug** — Greg's *"I want to be able to see anything"* would allow it,
  but q-agbc89 asked about articles read through a link, and the brief holds him to what he chose.
- **A row per open** — § 2.

## Tests (each watched red first)

- Store (Postgres): signed-in open writes one row; a second open bumps `opens` and
  `last_opened_at`; concurrent opens make one row and N increments; wrong key, no key, public
  article, link turned off, owner's own id → nothing written; signed-out arm likewise.
- Public dispatch: the POST answers 204 with no body; GET/HEAD on it 405; POST on every read route
  still 405; the handler receives no `req`.
- Admin route: non-admin 403; admin + own private article (no key) → 200; admin + someone else's
  private article without key / wrong key → 404; with key → owner + openers; public → owner; the
  answer has no `title`, `slug`, `shareToken` key.
- Client: `VisitorArticle` on a link with a key sends exactly one POST (signed-in → authed path,
  signed-out → public path, unconfirmed → none); a public article sends none; StrictMode once.
- Guards: `public-imports` (the new leaf), `owner-isolation` (no new sanctioned lookup; the
  ownerless enumeration counts the new write if it inventories writes),
  `action-tables-have-created-at`, `store-export-covers-tables` (not exported: the opener's
  identity is not the owner's to take away), `article-transfer` (`history`: kept with the article),
  `db-schema`/drift, privacy-page.

## Stages

1. Schema, migration, `private-link-opens.ts`, both write routes, the client call; store and
   dispatch tests.
2. The admin route, `AdminOwnerLine` and `PrivateLinkOpens`, the owner's card line; route and
   component tests.
3. Privacy page and docs; GPT Sol code review; gates; push to `dev`; bookkeeping.
