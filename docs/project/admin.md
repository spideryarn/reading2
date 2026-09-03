# The admin page

**`/admin`, with `/admin/users` and `/admin/feedback` under it.** One person can see them. The
first shows who has signed up and how much each of them has read — counts and dates. The second
shows the bug reports readers filed with the Feedback button, in their own words.

Greg, 2026-08-27:

> Set up an /admin/ page that only user `greg@gregdetre.com` sees a link for or is allowed to
> access. Then link to /admin/users/ that shows a list of users (using Tanstack Table), when they
> signed up, when they last logged in (in human-readable format), how many docs they've uploaded,
> etc etc.

Built the same day. The plan, the options weighed and the review are in
[260827z-admin-page.md](../plans/260827z-admin-page.md).

## Why this doc is filed under security

Because of the one thing it introduces: **there is now a request that reads across owners.**
Everything else built on 2026-08-27 was about making sure no signed-in reader can see another's
anything — [auth.md § Whose data is it](auth.md#whose-data-is-it) is the whole design, and
[`ownedSlug()`](../../src/store/pg.ts) is the predicate that carries it. This page is the exception,
so the interesting question is not what it shows but **how narrow the exception is**.

One route. One prefix. One address.

## The three refusals, and only one of them is a gate

| Where | What it does | Is it a gate? |
|---|---|---|
| [`src/routes.ts`](../../src/routes.ts) | anything in the `/api/admin` namespace, from anybody but one account id → **403** | **Yes.** This is the whole of it |
| [`src/web/App.tsx`](../../src/web/App.tsx) | renders the shelf instead, for anybody else | No — a courtesy |
| [`src/web/Library.tsx`](../../src/web/Library.tsx) | draws the Admin link, or does not | No — a courtesy |

The two courtesies are worth having and worth being honest about. The admin components are in the
JavaScript bundle every signed-in reader downloads; hiding a link hides nothing. If the client half
were deleted tomorrow the server would refuse exactly the same requests.

**The gate guards the namespace rather than the route.** It sits above the route table, so an admin
endpoint added later is behind it whether or not whoever adds it remembers — which is the only
version of this that stays true. `tests/routes.test.ts` asks for `/api/admin/anything-at-all` and
expects a 403 rather than a 404, which is what proves the order.

**It is two comparisons, and the second one is the point.**

```ts
const adminNamespace = path === "/api/admin" || path.startsWith("/api/admin/");
```

`startsWith("/api/admin/")` alone would leave a future endpoint at exactly `/api/admin` — no
trailing slash — outside the gate, and so would make the paragraph above false. GPT Sol found it in
review. The namespace is a **path segment**: `/api/administer` is somebody else's route and stays a
404, which is its own test.

Matched on `path` rather than `url`, because `url` carries the query string and a check that reads
one is a check a `?` can be hidden behind. `serveApi` has already refused anything not beginning
`/api/`, so there is no second spelling to get past.

**403, not 404**, against the house rule that a thing you may not see does not exist. That rule is
right for another reader's article — a 404 refuses even to confirm it is there — and buys nothing
here, where the page's existence is in everybody's bundle already. What it would cost is a real
refusal that reads as a missing route in a log.

## Who the administrator is

**Greg's account id — `ADMIN_USER_IDS` — and not his email address**, even though the email is what
he asked for. The difference is worth being plain about, because the code says a uuid where the
request said an address.

A signed token makes an email *trustworthy*. It does not make it *stable*: an email is a property
of an account that the account holder can change, and an id is the account. The escalation that
buys is somebody with an account on this Supabase project changing their own address to Greg's.
Today that is blocked, because production requires a confirmation sent to the **new** address
(`mailer_autoconfirm` is false — [auth.md](auth.md)). But that is a checkbox on a dashboard, in a
project this repo shares with an older app, and an authorisation decision resting on it is one
click from gone. Nothing can be issued a `sub` that already exists. GPT Sol led its review with
this, 2026-08-27.

**What it costs is a silent lockout**, and that is dealt with rather than accepted. A recreated
account is a different administrator, and `App.tsx` would simply show Greg the shelf with no
explanation. So `describeAdminMiss` writes one fixed sentence to the log when the administrator's
own address arrives on an id we do not know — which is either Greg on a new account, or somebody
who has taken his address, and both are things to find out immediately. Fixed prose, nothing
interpolated: a message is the one field redaction cannot reach ([logging.md](logging.md)).

[`src/admin.ts`](../../src/admin.ts) is one constant, one three-line function and one log sentence,
with no imports at all — so the browser and the server ask the *same* function rather than two
spellings of one idea. It is on the shared-module allowlist in `tests/client-imports.test.ts`
because it qualifies, not because it was convenient. The id is not a secret: it travels in every
JWT that account holds, and it identifies rather than authorises.

### One account per Supabase project, which is why it is a list

**`ADMIN_USER_IDS` holds two ids and they are both Greg** — one on the laptop stack, one on the
production project. Sign-up happens per project, GoTrue mints a fresh uuid each time, and the two
have nothing in common. So a single constant is necessarily right in one place and wrong in the
other.

It was wrong in production for a day. The id was read off the local database when the page was
built on 2026-08-27, the page was checked on a laptop where it worked, and on spideryarn.com the
Admin link did not draw and `/api/admin/*` answered Greg 403 — the *silent lockout* this design
names as its own cost, arriving on the first deploy rather than on some future recreated account.
[260828f-admin-id-was-the-local-one.md](../postmortems/260828f-admin-id-was-the-local-one.md).

**What the second entry costs**, stated accurately — an earlier version of this said "widens
nothing", and GPT Sol refused the reason. OIDC guarantees uniqueness for *(issuer, subject)*, not for
a subject alone, and GoTrue's admin create-user API takes an explicit id, which
[`scripts/db-seed-owner.ts`](../../scripts/db-seed-owner.ts) already uses. So:

- **The issuer is pinned one layer up.** [`src/auth.ts`](../../src/auth.ts) verifies every token
  against the project named by `SUPABASE_URL`, so a laptop-minted token does not verify on
  production. The local id cannot arrive on a production request unless that account exists there.
- **Creating one there needs the service-role key** — total compromise already. Nothing an attacker
  reaches.
- **It does widen what our own mistake can do.** A seed or a restore pointed at production could
  mint that id, and it would be an administrator.

Comparing *(project, id)* rather than id closes it outright, at a signature change in three call
sites. Not done, and recorded rather than left implicit.

The test spells both uuids out rather than importing the constants. Asserting
`isAdmin(ADMIN_USER_ID_PROD)` passes for whatever the constant happens to say, which is the mistake
itself — the value is a fact about an external system, so the check has to carry its own copy.

**A constant, not an environment variable.** An unset env var read as "allow everyone" is the
canonical fail-open ([silent-success.md](../reusable/silent-success.md)); a constant has no unset
state and nothing to forget to configure on Vercel. Adding a second administrator is an edit in one
place.

`ADMIN_EMAIL` is still in the file, for people rather than for code: it makes the uuid legible, and
`describeAdminMiss` needs it. [`tests/admin.test.ts`](../../tests/admin.test.ts) asserts that
`isAdmin(ADMIN_EMAIL)` is **false**, so nobody can quietly start passing the wrong one.

## What it deliberately does not show

**Limited account metadata, counts, and dates — and, on `/admin/feedback` only, the support
report a reader chose to send us. Never a title, a URL, a filename, or a sentence of anybody's
reading.**

### The second clause, added 2026-09-02, and why it is not a widening

`/admin/feedback` shows prose, which the rule above otherwise forbids. What makes that legitimate
is **consent, and only consent**: the reader typed those words into a box labelled with what
happens to them, and one of the things that happens is that Greg reads them. So the boundary is
drawn in full rather than left as "words the reader typed", which was the first draft's wording
and was not truthful — GPT Sol, 2026-09-02:

> The admin pages may show the explicitly enumerated account metadata documented for
> `/admin/users`, and the support report the reader submitted: their answers, an attachment they
> deliberately added, diagnostics they explicitly opted into, and Spideryarn's fixed correlation
> metadata. Identifiers may not be followed into articles, comments or notes.

Two things that boundary is honest about, rather than quiet about:

- **A screenshot is pixels, and pixels can be article prose.** Re-encoding
  ([`src/feedback-image.ts`](../../src/feedback-image.ts)) strips hidden metadata; it cannot strip
  what is visible. The reporter pasted it deliberately, which is what makes it a support
  attachment rather than a leak — but if the article on screen was *shared with them by somebody
  else*, the reporter's consent is not that owner's. That is accepted as narrowly-scoped support
  processing, and it is written down here rather than hidden inside the word "consent".
- **The `slug` travels whether or not the diagnostics box is ticked**, while the dialog's tick-box
  copy talks about "which article and passages" as the *extra* thing. Those two do not quite
  agree, and the copy is the half that should change. Open, 2026-09-02.

The rule is written in three places — here,
[`src/store/pg-admin-feedback.ts`](../../src/store/pg-admin-feedback.ts) and
[`src/types.ts`](../../src/types.ts) § `AdminFeedbackReport` — and **nothing enforces it
mechanically**. What the code does instead is refuse to make widening automatic: the cross-owner
projection is written out by hand rather than sharing `REPORT_COLUMNS` with the reader's own
report, so a field added to a report does not reach this page until somebody decides it should,
and `tests/admin-feedback-store.test.ts` pins the exact set of keys that comes back.

The metadata is exact and worth listing rather than gesturing at: the account **id**, the **email
address**, the **providers** GoTrue records for it (`google`, `email`), whether that address is
**confirmed**, and — since 2026-09-03 — whether the account **can reach these pages**, which is
`isAdmin(id)` computed in the browser from the id already in the row rather than anything new from
the server. Everything else on the page is a number or a date.

**Money is the one thing on the page that is not a count of the reader's own things**, and it is
still a fact about the account rather than about their reading: what their model calls cost us, over
a stated month, with no article, model or job named. See
[The spend column](#the-spend-column-and-the-two-things-that-keep-it-honest).

How many articles somebody has is a fact about their account. *Which* articles they are is their
reading, and it does not leave their session. That line is the one paragraph to re-read before
adding a column, and it is written into
[`src/store/pg-admin.ts`](../../src/store/pg-admin.ts) and
[`src/web/admin-columns.tsx`](../../src/web/admin-columns.tsx) as well as here, because it is the
kind of rule that gets eroded a column at a time by people who never saw it.

Email addresses are shown, because a list of accounts that cannot name them is not a list of
accounts.

## The accounts come from the Auth service, not from a query

**This is the one part of the page that does not touch our database**, and the reason is worth
knowing before changing it.

`auth.users` belongs to Supabase. It is owned by `supabase_auth_admin`, in a schema our application
role has no grants into — and `spideryarn_app` is what the deployed server connects as. The first
version of this page queried it anyway, which worked on a laptop, where `DATABASE_URL` is the
`postgres` superuser, and could never have worked in production:

```
$ psql "$DATABASE_URL" -c "select id from auth.users limit 1"
ERROR:  permission denied for schema auth
```

**And it was already known.** The header of
[`scripts/check-owner-identity.ts`](../../scripts/check-owner-identity.ts), written the day before
this page was built, says it outright:

> `auth.users` is not readable by the application's database user. Measured, not assumed: the first
> version of this script ran that query against production and got `42501 permission denied for
> schema auth` … it is why this reaches for `SUPABASE_SERVICE_ROLE_KEY` from `.env.prod`.

Measured against production, written down, worked around — and nothing connected it to the new page.
[260828f-admin-id-was-the-local-one.md](../postmortems/260828f-admin-id-was-the-local-one.md).

### Why the API rather than a grant

Four options were weighed. The Admin API won on two counts that are not close.

| | Cost |
|---|---|
| **The Admin API** ✓ | no DDL, and no new credential — `SUPABASE_SERVICE_ROLE_KEY` is already in the production environment for Storage ([`blobs.ts`](../../src/store/blobs.ts), checked by [`vercel-health.ts`](../../src/vercel-health.ts)). Needs pagination handled, which is the next section |
| Column grants on `auth.users` | one migration as `postgres`; keeps the query code — but the application role can then see into `auth`, which the split existed to prevent |
| A view over `auth.users` | the same, and one more object. The mechanism is *view-owner permissions*, **not** `SECURITY DEFINER` — Postgres says those are not equivalent |
| `grant select on auth.users` | works, and the running server can then read every column of every account |

**The deciding argument is that only the API is a contract.** Supabase's own guidance is that the
`auth` schema is not a thing to build on:

> Primary keys are guaranteed not to change. Columns, indices, constraints or other database objects
> managed by Supabase may change at any time and you should be careful when referencing them
> directly.

Only the primary key is promised. Every database-side option builds on columns we were told may
move. The Admin API is the documented, versioned surface for exactly this question, and this repo
already reaches for it in `check-owner-identity.ts` for the same reason.

The `profiles`-table-and-trigger pattern, which is what most Supabase advice points at, solves a
different problem: joining identity to your own tables. A trigger copies what it copied at signup,
so `last_sign_in_at` would have to be re-implemented — and this page is mostly live auth state.

### The 50-row default, which truncates silently

**The service pages, defaults to fifty an answer, and says nothing when it cuts you off.** No error,
no flag on the response — just fewer accounts than exist. Somebody with seventy users saw fifty and
had nothing to tell them (`supabase/auth-js#538`). A page listing "everyone" while missing people is
not a visibly broken page.

So [`admin-accounts.ts`](../../src/store/admin-accounts.ts) does two things rather than one:

- **follows the pages**, deciding by what came back rather than by what was asked for, so a service
  that quietly clamps the page size still yields everybody;
- **checks its own answer against `x-total-count`**, the service's count, taken from the first
  response — and *throws* rather than returning a short list.

The second is the one that matters. A loop cannot check itself, and the count is the only number
here that comes from outside it ([silent-success.md](../reusable/silent-success.md)). It throws only
on a **shortfall**: someone signing up mid-listing makes the real total larger, and that is an
ordinary event rather than a fault.

`tests/admin-accounts.test.ts` runs a fake service holding 120 accounts that hands back 50 at a time
however many are asked for. The obvious one-request implementation returns 50 and reports success;
that test, and three others, were watched failing against it before the real one was written.

### Deleted accounts, which the API hands back

**The query said `where deleted_at is null`. The API has no such filter**, so moving to it would have
put deleted people back on the page — and nothing in a healthy project would have shown it, because
GoTrue **omits `deleted_at` entirely on a live account**. Every row of every real response looks the
same whether or not the code handles this.

Settled by experiment on the local stack, 2026-08-28: create an account, soft-delete it through
`DELETE /admin/users/:id` with `should_soft_delete: true`, and the listing still returns it, with
`deleted_at` set. Reading the response of a project that has never deleted anybody could not have
answered this, and neither could reading the docs.

**It also sets a trap for the count check above.** `x-total-count` counts the deleted rows too — the
same measurement showed 8 listed and `X-Total-Count: 8` with one of them deleted. So the shortfall
check compares **what arrived** against that total, never what survived filtering: comparing kept
rows would take the whole page down with "the account list is short" the first time anybody deleted
an account, on a page that was entirely correct.

Two clauses, so two probes — `tests/admin-accounts.test.ts` was watched failing with each of them
removed separately, because a test that only redddens for one is protecting one.

### The fence moved, and it had to

The old query could only return the columns the table *declared* — six of them, pinned by
`tests/auth-users-fence.test.ts`, which was the ceiling on what a mistake could hand to a route.

**An API response has no such ceiling.** It carries `phone`, `user_metadata`, `identities`, and
whatever is added upstream next. So the fence is now `accountFrom`, which names the fields it keeps
one at a time, and the test feeds it a payload containing a phone number, a full name, a password
hash and two tokens and asserts that none of them survives.

**`app_metadata` is narrowed here rather than carried.** The first version passed the whole object
through as an opaque `meta` and let `providersOf` narrow it a layer later — and claimed in a comment
that this was the boundary, which it was not. That object is writable by anyone with the
service-role key, and Supabase's own examples put roles, plans and team ids in it. `AccountRow` now
carries `providers: string[]` and nothing else from it, so the rule does not depend on every later
reader remembering to narrow. Sol, 2026-08-28, who also noticed the test said it put a secret inside
`app_metadata` and did not. It does now.

`src/db/auth-users.ts` is gone, and with it the risk it carried: the reason that file needed two
independent guards was that declaring a Supabase-owned table invites `drizzle-kit` to manage it, and
*"dropping it is not a mistake we would get to undo"*. Nothing declares it now.
`tests/auth-users-fence.test.ts` still pins both drizzle guards and now asserts the stronger thing —
that **no** file under `src/db/` declares an `auth`-schema table — with a control that has been seen
to fail.

### The pagination is not offset arithmetic, and here is why

**Offset pagination has no snapshot.** A sign-up landing between two requests shifts every later
page by one: page two repeats the last row of page one, and the account that should have been at
the boundary is never served. The arrival count then *matches* — the duplicate made up the number —
so a loop that stops when enough rows have arrived stops one account short and reports success. GPT
Sol reproduced it on 400 accounts, 2026-08-28: `rows=400, unique=399, u400 missing, u200
duplicated`.

So three signals, each doing one job:

- **`Link … rel="next"` decides when to stop.** It is the service's own answer, and it is believed
  when present. A response with no `Link` is not "no more" — the listing then runs until an empty
  page, which costs one extra request and cannot end early.
- **Distinct ids decide what is kept.** A row seen twice does not become two lines and does not
  count twice.
- **`x-total-count` audits the result and never terminates it.** That is the whole repair: using it
  as a stopping condition is what the duplicate defeated.

Exhausting the page cap throws, rather than returning what was collected. So does a response whose
envelope has no `users` array — that read as an empty list before, which turns a changed API, an
error body served with a 200, or a proxy's HTML into a working page saying nobody has signed up.

### One thing that must stay true

**The Auth project and the database must be the same project.** They are named by two independent
environment variables and nothing else compares them: point `SUPABASE_URL` at one and
`DATABASE_URL` at another and this page lists one project's accounts beside the other's article
counts, giving everybody a row of zeros, with nothing raised. `listUsersAcrossOwners` reuses
`projectMismatch` from [`blobs.ts`](../../src/store/blobs.ts) — the same check that guards the
Storage pair — rather than growing a second opinion about what a project ref is.

## Where the numbers come from

**Two sources, joined in TypeScript.** The people come from the Auth service — it is the only place
either of the two dates Greg asked for exists, since nothing in `spideryarn` records a sign-up or a
sign-in — and every number beside them comes from our own tables.
[The section above](#the-accounts-come-from-the-auth-service-not-from-a-query) is why the first half
is an HTTP call rather than a join.

The seam between them is `AccountRow` ([`src/store/account-row.ts`](../../src/store/account-row.ts)),
and it is deliberately the same shape it was when the accounts came out of a `select()`. `mergeUsers`
and its tests never learned that the source moved, which is the point of putting it in a file of its
own.

`email_confirmed_at`, deliberately **not** `confirmed_at` — Supabase's backwards-compatibility field
means "email *or* phone was confirmed", and the page prints "email unconfirmed" beneath an email
address, so the wrong one labels a phone-confirmed account the opposite of the truth. Sol found that
in the query; it is pinned again against the API.

The counts are **six grouped aggregates, run together and joined by a `Map`** — one per table, not
one per user. A fixed six statements however many accounts there are, issued alongside the account
listing rather than after it, and the join is a pure function (`mergeUsers`) so the arithmetic can
be tested with two owners and no database. The sixth is money, and it came with the spend column
below.

**One grep guards the exception.** `tests/owner-isolation.test.ts` asserts that no file under
`src/store/` except `pg-admin.ts` writes `groupBy(….ownerId)` — the shape of a question asked
*across* owners rather than within one. Narrow on purpose: it is not "find every query missing a
`where`", which no grep can do and which would overclaim, but one syntactic shape with one
legitimate home. It also asserts that `pg-admin.ts` still contains it, so a rule whose one allowed
case has quietly moved fails rather than protecting nothing.

**Whose comment is it?** Comments, chat threads and searches each carry an `owner_id` of their own,
and this page does not use it: it groups them through `articles.owner_id`, one join each. The two
answers are the same number unless something is wrong, and the article's is the authoritative one —
the isolation reaches every one of those rows *through* the article, and nothing in the database
enforces that a child's owner matches its article's
([auth.md § What is still shared](auth.md#what-is-still-shared-and-what-is-still-open), which stays
true: that column is still written and never read). Sol asked for the choice to be made rather than
left implicit.

**"Articles" means what the shelf shows.** `beginRevision` writes the `articles` row before there
is anything in it, so a first ingest that failed leaves a slug with no current revision — one the
shelf never displays and which the first version of this counted for ever. Both aggregates now use
`onTheShelf()` in [`pg.ts`](../../src/store/pg.ts), the same predicate `listArticles` uses, so a
count of the shelf and the shelf cannot come to disagree about what an article is. Sol found it in
the built code.

**Uploads are `status = 'verified'`**, the terminal success in [`src/source.ts`](../../src/source.ts).
The plan said `'complete'`, which is not one of the five states — and because the column is `text`,
that would have returned a convincing zero rather than throwing. Sol caught it in the plan.

**Two runtime traps, both measured rather than reasoned about**, and both in
[`tests/admin-store.test.ts`](../../tests/admin-store.test.ts) because nothing else could catch
them:

- A `sql` fragment carries a TypeScript type and **no runtime conversion**. `count()` is `bigint`
  and `sum()` is `numeric`, and node-postgres returns both as *strings*, so `sql<number>` was a
  claim about a string that would have sorted 10 below 9 in the browser with nothing looking wrong.
- The same fragment returned a timestamp as `"2026-08-27 16:19:31.779+00"` — not ISO-8601 — because
  Drizzle's column mappers are what normally convert one, and a raw fragment has none.

`.mapWith()` fixes both, and the second one reuses the column's own mapper rather than a second
parse. The test asserts `typeof` and an ISO round-trip, because `"3" > 2` is true in JavaScript and
`Date.parse` succeeds on the broken string.

**The response says `Cache-Control: private, no-store`.** The offline cache in
[`api.ts`](../../src/web/lib/api.ts) keeps to an allowlist this route is not on, so nothing of ours
would store it — but a page listing other people's accounts should not rest on our own cache's good
manners, and an intermediary cannot know the policy unless the response states it.

**Postgres only.** There are no user accounts on a filesystem — `data/` is one directory per slug —
so under `SPIDERYARN_STORE=files` the endpoint answers **501** with its own sentence.
[`src/store/index.ts`](../../src/store/index.ts) has the refusal, and the alternative it exists to
avoid: an empty array, which looks exactly like a working page saying *you have no users*.

**The fence around that table has three halves now, and all of them are pinned.**
[`tests/auth-users-fence.test.ts`](../../tests/auth-users-fence.test.ts) asserts that
`drizzle.config.ts` names one file rather than a glob, *and* that `schemaFilter` is `["spideryarn"]`
— so even a table that reached the serializer would be filtered out by schema. Either alone is
enough, which is exactly why a test pinning only one would go green through the change that removed
the other. Sol pointed out that the plan named only the first.

The third is new and is the strongest: **nothing under `src/db/` declares an `auth`-schema table at
all**, so there is no object for migration tooling to find. It is a recursive sweep matching every
spelling of `pgSchema("auth")` — quotes, whitespace, a trailing comma — because the first version
read one directory and one spelling, which is a guard that reports an empty list while being walked
past. Sol again, 2026-08-28.

Sol originally preferred a raw `sql` template over a table declaration, since a template creates no
metadata for migration tooling to find. The declaration stayed at the time, for a real reason —
Drizzle's **column mappers** are what turn `max(last_opened_at)` into a `Date` rather than a non-ISO
string. That argument still holds for the five count queries, which is where the mappers are now;
the accounts no longer come from a query at all, so the declaration is gone and the tooling risk
with it.

**The production role must never need to read `auth.users`, and that is now the design.** This
paragraph used to say the opposite — that the least-privilege runtime role would need
`grant usage on schema auth` and a column-level `grant select` — and it survived the change that
made it wrong. Following it would have widened exactly the privilege this repair exists to avoid.
GPT Sol caught it on the second review, 2026-08-28.

There is nothing to grant. The accounts come over HTTP
([above](#the-accounts-come-from-the-auth-service-not-from-a-query)), and the five count queries
touch only `spideryarn`. A future runtime role narrower than `spideryarn_app` needs no `auth` grants
at all.

What *is* still written down rather than done: **a deploy-time check that the administrator resolves
to a real account on the project being deployed to.** That is the gap the account-id bug went
through — the only mitigation for a silent lockout turned out to be unreachable from the failure it
was written for ([260828f-admin-id-was-the-local-one.md](../postmortems/260828f-admin-id-was-the-local-one.md)) —
and it is the check that would make the id-versus-email question stop mattering.

## The spend column, and the two things that keep it honest

Added 2026-09-02, because Greg is setting a subscription price and could not see what an account
costs. GPT Sol had argued against putting money on this page and withdrew the objection when Greg
made the product call, on two conditions:

> It does need a defined period — e.g. "current UTC month" — and a visible partial/unpriced marker.
> A bare currency number would overclaim.

Both are behaviour rather than prose, and both are in
[`tests/admin-spend-column.test.tsx`](../../tests/admin-spend-column.test.tsx):

- **The period is on every cell**, from the row's own `spendMonth` rather than the browser's clock,
  so a page left open across a month boundary says which month the server actually measured. The
  period is the current UTC month — `currentUtcMonth()` in
  [`src/store/ai-calls-spend-pg.ts`](../../src/store/ai-calls-spend-pg.ts), the same definition
  `npm run cost` uses, because a column headed "this month" that meant something else from the CLI
  is a discrepancy nobody would chase. It is **not** a Stripe billing period, which starts on the
  day somebody subscribed.
- **A `· N unpriced` line** under the figure whenever any call behind it reported no cost. Not an
  edge case: on 2026-09-02 the local ledger had 207 of 243 rows reporting nothing, and a confident
  `$1.63` drawn over that would be the page lying quietly.

Two more choices worth knowing:

- **Eval and dev-CLI spend is excluded** (`productSpendByOwner` filters on `scope_kind`). That money
  is ours rather than a reader's, and on a per-account page it would draw whoever's owner id the
  environment was carrying as costing far more than anybody else.
- **An account with no calls draws an em dash, not `$0.0000`.** A zero with a currency sign reads as
  a measurement, and "we recorded nothing for this person" is the one thing it is not. The sort still
  treats it as zero, because for ranking who is expensive it genuinely is one.

The wider version of the same numbers — by category, with a median/p95/max spread across every
account — is `npm run cost -- --owners`:
[ai-gateway.md § The pricing report](ai-gateway.md#the-pricing-report-per-owner-by-category-with-the-spread).

## The page itself

`/admin` is an index with one entry. It exists rather than redirecting straight to the users table
because Greg asked for the address, and because the second admin page then has somewhere to be
listed rather than somewhere to be remembered.

`/admin/users` is [`DataTable`](../../src/web/lib/DataTable.tsx) with sort chips — the same seam the
shelf's table uses, which is what Greg meant by *"using Tanstack Table"*: the columns are the page's
own ([`admin-columns.tsx`](../../src/web/admin-columns.tsx)) and everything else is shared. The sort
lives in the address bar like every other view state ([url-state.md](url-state.md)), sharing the
`dir` parser with the shelf and having a `by` default of its own — newest sign-up first, because a
list of accounts is a list of things that arrived.

Dates read as *"3 days ago"* with the exact timestamp on hover, through
[`relative-time.ts`](../../src/web/relative-time.ts) — the same function the shelf uses, so the two
pages cannot come to disagree about what "yesterday" means. That is the "human-readable format"
asked for.

There are two date columns and they are not the same question: a session lasts weeks, so **a recent
sign-in is not evidence anybody has read anything**. `Last read` is the most recent open across
their own articles.

### The count above the table counts the table

Greg, 2026-09-03, of production:

> it says "2 accounts", but only lists one! … whatever the answer is, the number of rows and the
> number in the text above should match! And also indicate if a row is an admin user or not.

So the number is now counted off `sorted` — the list the table is drawn from — rather than off the
list the request returned. There is no second number left to disagree with it.

**No mechanism was found by which the old page could print a number larger than its rows.** The
investigation is in [260903c](../plans/260903c-admin-users-count-disagrees-with-rows.md): a real
browser eight times over, React measured to render every row even on a duplicate or missing key,
TanStack's row models read rather than assumed, production's own bundle fetched and found to hold
this same logic, and a cross-family review sent looking for a path and finding none. **No root cause
is claimed**, and the report has not been explained.

Two things follow from that. `sorted.length` is what is handed to the renderer and not what the DOM
holds, so the invariant is asserted a step further out as well — a test reads the number back out of
the rendered words and compares it with the `<tr>` count. That covers structure, not visibility;
nothing here can see a row that renders and cannot be seen. And the administrator's own row now
carries an `admin` marker, which is the other half of what Greg asked for: it is `isAdmin`, the
gate's own question, so an unmarked row is an account this page would refuse.

Fixed on the way, on its own merits: the line under an address no longer hides `email unconfirmed`
when no provider is recorded — it used to sit behind `providers.length > 0`, which hid it on exactly
the account with least else to say.

## How it is checked

Five suites, and the split is deliberate — no one of them could catch what the others catch.

| | What only it can see |
|---|---|
| `tests/admin.test.ts` | who the administrator is, including the right email on the wrong account |
| `tests/routes.test.ts` | the namespace, six ways, including through production's URL rewrite |
| `tests/admin-users-merge.test.ts` | the arithmetic: two owners kept apart, zeros rather than gaps |
| `tests/admin-queries.test.ts` | what the SQL **means** — `verified`, the joins, `onTheShelf()` — read off `.toSQL()`, so it never skips |
| `tests/admin-store.test.ts` | what the driver really returns, against a real database. Skips loudly without one |
| `tests/admin-page.test.tsx` | the page drawn: the empty account's row, the error states, a sort chip that really reorders |
| `tests/auth-users-fence.test.ts` · `tests/owner-isolation.test.ts` | the two static guards |

Every one of them was watched **failing** against the broken state before it was kept — commenting
out the gate, removing `.mapWith`, widening `drizzle.config.ts`, deleting the em-dash fallback,
putting the Refresh button back behind a list. A check nobody has seen fail is not evidence
([silent-success.md](../reusable/silent-success.md)).

**The page test caught a bug nothing in it was aiming at**, which is the argument for having one.
When it was first written, every case in it timed out: `act()` waits for React to go quiet, and the
page never went quiet, because one line copied from the shelf — `rawDir ?? []` above the memo that
builds the sorting state — made a fresh array every render and so a changed dependency every
render. A render loop. It surfaced as a **timeout with no error**, which reads like a broken test
rather than like broken code, and the shelf had the same line; another agent found it there and
fixed both. The shelf's own postmortem has the mechanism.

**And a browser pass found the layout right and one thing it could not check.** The table scrolls
inside its own box rather than moving the page sideways, the numeric columns are right-aligned, the
shelf's Admin link is there, and the console is clean. A narrow window could not be tested: the
automation reported a resize it did not perform. Written down rather than assumed.

That pass also photographed *"6 accounts"* above five rows — during a spell when another agent's
hot-reloads were breaking the page mid-render. The honest answer to a screenshot is a test, so
there is now one: six accounts, one of them with no sortable date, must draw six distinct rows. It
passes, so the page was right and the picture was blamed on the reload.

**That conclusion was too comfortable, and it was worth exactly one week.** On 2026-09-03 Greg saw
the same shape on production, where nothing hot-reloads. The re-investigation
([260903c](../plans/260903c-admin-users-count-disagrees-with-rows.md)) still found no way for the
page to draw fewer rows than it counts — this time by measuring React, TanStack and the deployed
bundle rather than by trusting a passing test — and the count now comes off the list the table is
built from, which removes the divergence a *source* reading could have. It does not make the
symptom impossible: a CSS problem, a transient render or anything else visual could still put a
number over a table that does not look like it. The lesson is the smaller one: *"the test passes, so
the screenshot was wrong"* explains a screenshot away rather than explaining it, and the same
picture came back.

## What it cannot do, and what is not built

- **Nothing on this page writes.** No delete, no ban, no spend. An admin page that can only look is
  a much smaller thing to get wrong, and there is no request behind it that could do anything else.
- **No model spend per user**, though `ai_calls` is right there. It carries no `owner_id` — it hangs
  off a revision — so per-user spend is a join through revisions and articles, and it is a page of
  its own the day a spend limit exists ([auth.md § Still open](auth.md#still-open)).
- **No pagination.** Nine accounts. When there are hundreds this becomes a server-side sort, and the
  URL state already says what to sort by.
- **Soft-deleted accounts are filtered out**, on `auth.users.deleted_at`. The row survives a
  deletion in Supabase's schema; a deleted user in a list of users is wrong in the direction nobody
  checks.
- **Accounts with no email address are filtered out.** They cannot sign in here — the gate refuses
  them by name, `[auth-noemail]` — and a row whose first column is blank is a blank line rather than
  a fact, on a table led by the address. **It does not follow that they own nothing**: this is a
  Supabase project shared with an older app, so such an account may belong to a person and have rows
  against its id, and this page would not count them. GPT Sol, 2026-09-03.

## See also

- [auth.md](auth.md) — the first gate, and whose data is whose
- [security-map.md](security-map.md) — where every defence physically lives
- [library.md](library.md) — the shelf, whose table this one copies
- [260827z-admin-page.md](../plans/260827z-admin-page.md) — the plan, and the review
