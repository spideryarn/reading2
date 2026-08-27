# The admin page

**`/admin`, and `/admin/users` under it.** One person can see them, and what they show is who has
signed up and how much each of them has read — counts and dates, and nothing else.

Greg, 2026-08-27:

> Set up an /admin/ page that only user `greg@gregdetre.com` sees a link for or is allowed to
> access. Then link to /admin/users/ that shows a list of users (using Tanstack Table), when they
> signed up, when they last logged in (in human-readable format), how many docs they've uploaded,
> etc etc.

Built the same day. The plan, the options weighed and the review are in
[admin-page.md](../plans/admin-page.md).

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

**Greg's account id — `ADMIN_USER_ID` — and not his email address**, even though the email is what
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

**A constant, not an environment variable.** An unset env var read as "allow everyone" is the
canonical fail-open ([silent-success.md](../reusable/silent-success.md)); a constant has no unset
state and nothing to forget to configure on Vercel. Adding a second administrator is an edit in one
place.

`ADMIN_EMAIL` is still in the file, for people rather than for code: it makes the uuid legible, and
`describeAdminMiss` needs it. [`tests/admin.test.ts`](../../tests/admin.test.ts) asserts that
`isAdmin(ADMIN_EMAIL)` is **false**, so nobody can quietly start passing the wrong one.

## What it deliberately does not show

**Limited account metadata, counts, and dates. Never a title, a URL, a filename, or a sentence of
anybody's reading.**

The metadata is exact and worth listing rather than gesturing at: the account **id**, the **email
address**, and the **providers** GoTrue records for it (`google`, `email`). Everything else on the
page is a number or a date.

How many articles somebody has is a fact about their account. *Which* articles they are is their
reading, and it does not leave their session. That line is the one paragraph to re-read before
adding a column, and it is written into
[`src/store/pg-admin.ts`](../../src/store/pg-admin.ts) and
[`src/web/admin-columns.tsx`](../../src/web/admin-columns.tsx) as well as here, because it is the
kind of rule that gets eroded a column at a time by people who never saw it.

Email addresses are shown, because a list of accounts that cannot name them is not a list of
accounts.

## Where the numbers come from

`auth.users` — Supabase's own table, and the only place either of the two dates Greg asked for
exists. Nothing in `spideryarn` records a sign-up or a sign-in.

It is declared in [`src/db/auth-users.ts`](../../src/db/auth-users.ts) and **deliberately not** in
[`src/db/schema.ts`](../../src/db/schema.ts), whose header says why: declaring an Auth-owned table
there invites `drizzle-kit generate` to treat it as ours to manage, and *"dropping it is not a
mistake we would get to undo"*. `drizzle.config.ts` names one file rather than a glob, so a table
beside it is invisible to migration generation and an ordinary table to any query.

**There are two independent barriers, and that is only one of them.** Widening the config to a glob
would put this module into the graph the serializer reads, but `schemaFilter: ["spideryarn"]` would
still drop an `auth`-schema table on the way out. Either alone is enough today, which is exactly why
removing one would look harmless — so both are pinned, and both are stated in the file itself. Sol
pointed out that an earlier version of this paragraph named the first and described the second as
if it did not exist.

Only seven columns are declared, and that is a ceiling rather than laziness: `select()` with no
argument returns every column a table *declares*, so no password, token or phone column is
reachable by a mistake. `tests/auth-users-fence.test.ts` pins that list **exactly**, read off the
table itself — it was a blacklist of five credential names first, which is a check that passes for
every sensitive column nobody happened to think of. Sol.

One of the seven is `email_confirmed_at` and deliberately **not** `confirmed_at`, which is
Supabase's backwards-compatibility column meaning "email *or* phone was confirmed". The page prints
"email unconfirmed" beneath an email address, so the wrong column would label a phone-confirmed
account the opposite of the truth.

The counts are **six grouped aggregates, run together and joined by a `Map`** — one per table, not
one per user. A fixed six statements however many accounts there are, and the join is a pure
function (`mergeUsers`) so the arithmetic can be tested with two owners and no database.

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

**The fence around that table has two halves, and both are pinned.**
[`tests/auth-users-fence.test.ts`](../../tests/auth-users-fence.test.ts) asserts that
`drizzle.config.ts` names one file rather than a glob, *and* that `schemaFilter` is `["spideryarn"]`
— so even a table that reached the serializer would be filtered out by schema. Either alone is
enough today, which is exactly why a test pinning only one would go green through the change that
removed the other. Sol pointed out that the plan named only the first.

Sol would have preferred a raw `sql` template over a table declaration, since a template creates no
metadata for migration tooling to find at all. The declaration stayed, and the build then made the
case for it: Drizzle's **column mappers** are what turn `max(last_opened_at)` into a `Date` rather
than a non-ISO string, and a raw template is precisely what has none.

**The production role has to be able to read `auth.users`.** Today it connects as `postgres` and
can. When the least-privilege runtime role that
[postgres-migration.md](../plans/postgres-migration.md) plans arrives, it will need:

```sql
grant usage on schema auth to spideryarn_runtime;
grant select (id, email, created_at, last_sign_in_at, email_confirmed_at,
              raw_app_meta_data, deleted_at)
  on auth.users to spideryarn_runtime;
```

Losing it surfaces as a permission error, turned into a safe generic 500 by `guardDbStore` and
rendered by the page as words — loud, rather than as an empty list. **An infrequently visited admin
page is still a poor alarm**, and Sol is right about that: the proper answer is a
`has_schema_privilege` / `has_column_privilege` probe at deploy time, which belongs with the
schema-drift work rather than here. Written down rather than done.

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
passes, so the page was right and the picture was a casualty of the reload.

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
- **Accounts with no email address are filtered out.** They cannot sign in here at all — the gate
  refuses them by name, `[auth-noemail]` — so they own nothing and have nothing to show.

## See also

- [auth.md](auth.md) — the first gate, and whose data is whose
- [security-map.md](security-map.md) — where every defence physically lives
- [library.md](library.md) — the shelf, whose table this one copies
- [admin-page.md](../plans/admin-page.md) — the plan, and the review
