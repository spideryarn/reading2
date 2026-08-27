# The admin page

**Greg, 2026-08-27:**

> Set up an /admin/ page that only user `greg@gregdetre.com` sees a link for or is allowed to
> access.
>
> Then link to /admin/users/ that shows a list of users (using Tanstack Table), when they signed
> up, when they last logged in (in human-readable format), how many docs they've uploaded, etc etc.

Two pages, one endpoint, one new idea: **there is now a person who is allowed to see across
owners.** Everything else in this repo since 2026-08-27 has been about making sure nobody can
([auth.md § Whose data is it](../project/auth.md#whose-data-is-it)), so this plan is mostly about
keeping that hole exactly one route wide.

## What it must not become

- **No prose, no titles, no URLs, no filenames.** The users table shows **counts and dates**, and
  an email address. How many articles a reader has is a fact about the account; *which* articles
  they are is their reading. Nothing on this page names another person's document.
- **One route, one gate.** `GET /api/admin/users` is the only endpoint that is allowed to run a
  query without an owner filter, and it is the only path in the `/api/admin` namespace. The refusal
  is a single check in `handleApi`, above the route table, so a second admin route added later
  cannot be added *without* the gate — **and it is two comparisons rather than one**, because
  `startsWith("/api/admin/")` alone would leave a future endpoint at exactly `/api/admin` outside
  it and make that whole claim false. Sol found that.
- **The client check is cosmetic and is not a gate.** `isAdmin()` in the browser decides whether a
  link is drawn. The server decides everything else, and would refuse the request identically if
  the browser had never heard of admin.

## Who is the admin

**Greg's account id, not his email address** — and that is a change the review made. The plan as
written compared `greg@gregdetre.com`; Sol led with it:

> A signed JWT makes the email trustworthy, but not stable. Changing or recreating the account can
> remove or transfer admin power.

It is right. The escalation is somebody with an account on this Supabase project changing their own
email to Greg's — blocked today because production requires a confirmation sent to the *new*
address, which is a setting on a dashboard rather than anything in this repo. An id needs no such
argument.

So [`src/admin.ts`](../../src/admin.ts) holds `ADMIN_USER_ID`, a uuid, compared exactly, in a pure
module the browser and the server both import. Not an environment variable: an unset env var read
as "allow everyone" is the canonical fail-open
([silent-success.md](../reusable/silent-success.md)), and a constant has no unset state. The id is
not a secret — it travels in every JWT that account holds, and it identifies rather than authorises.

**What it costs is a silent lockout.** A recreated account is a different administrator, and
App.tsx would simply show Greg the shelf. So `describeAdminMiss` logs one fixed sentence when the
administrator's own address arrives on an unrecognised id, which turns a baffling silence into a
line that says what to edit.

## Where the data comes from

`auth.users` — Supabase's own table, in the `auth` schema. Two columns are the whole reason this
page exists: `created_at` ("when they signed up") and `last_sign_in_at` ("when they last logged
in"). Nothing in `spideryarn` records either.

**Declared in [`src/db/auth-users.ts`](../../src/db/auth-users.ts), deliberately *not* in
[`src/db/schema.ts`](../../src/db/schema.ts).** The schema file's own header says why: declaring an
Auth-owned table there invites `drizzle-kit generate` to treat it as ours to manage, and "drizzle
dropped auth.users" is not a mistake anyone gets to undo. `drizzle.config.ts` points at
`schema.ts` alone, so a table declared in a file beside it is invisible to migration generation and
still perfectly usable by a query. Four columns, read-only, and a comment saying all of this.

**The runtime role must be able to read it.** Locally `DATABASE_URL` connects as `postgres` and
can, measured rather than assumed. In production it is the same role today; when the
least-privilege runtime role of
[postgres-migration.md](postgres-migration.md) arrives it will need `usage` on schema `auth` and
`select` on `auth.users`, and this page is the thing that will notice. The failure is a Postgres
permission error, which `guardDbStore` turns into a 500 with our own sentence — not a silent empty
list.

### The counts

Seven small queries rather than one clever one, run in parallel:

| Column | Query |
|---|---|
| Articles | `articles` where `archived_at is null`, grouped by owner |
| Archived | `articles` where `archived_at is not null` |
| Uploads | `uploads` where `status = 'verified'` |
| Questions | `comments`, joined to `articles` |
| Chats | `chat_threads`, joined to `articles` |
| Searches | `search_runs`, joined to `articles` |
| Opens / Last read | `sum(opens)`, `max(last_opened_at)` over `articles` |

`group by owner_id` on a table that already has an owner index, joined to the user list in
TypeScript by a `Map`. Not an N+1: it is a fixed six statements however many users there are.

**`status = 'verified'`, and the plan first said `'complete'`, which is not one of the five states
and which — the column being `text` — would have returned a convincing zero rather than throwing.
Sol caught it.**

**The three child counts group through `articles.owner_id`, not through the child row's own.** Sol
asked for the choice to be made rather than left implicit, and this is it: nothing enforces that a
child's owner equals its article's, the isolation reaches every one of those rows *through* the
article, and a count that disagreed with the isolation would describe a world the reader cannot
see. It also leaves
[auth.md § What is still shared](../project/auth.md#what-is-still-shared-and-what-is-still-open)
true — the owner column on the child tables is still written and never read.

**Postgres only.** The filesystem store has no users and no owner column at all, so under
`SPIDERYARN_STORE=files` the endpoint answers 501 with a sentence saying so, rather than an empty
table that reads as "you have no users".

## The pages

`/admin` is an index — a heading and a list of links, with `Users` the only entry today. It exists
rather than redirecting straight to `/admin/users` because Greg asked for it and because the next
admin page has somewhere to go.

`/admin/users` is a [`DataTable`](../../src/web/lib/DataTable.tsx) with sort chips, exactly as the
shelf's table is: the columns live in `admin-columns.tsx`, the sort state round-trips through the
URL by the same `?by=`/`?dir=` parsers, and nothing page-specific goes into `lib/`.

Dates are rendered by [`relative-time.ts`](../../src/web/relative-time.ts) — *"3 days ago"*, with
the exact timestamp on the `title`. That is the "human-readable format" asked for, and it is the
same function the shelf uses, so the two pages cannot come to disagree about what "yesterday"
means.

**A route a non-admin types lands on the shelf**, exactly as `/nonsense` does, because
[router.ts](../../src/web/router.ts) has no 404 page by design. There is nothing to hide — the
page's code is in the bundle either way — so this is consistency rather than concealment.

## Tests

Sol's third blocker was that the tests as planned *"could all pass while the feature never
succeeds"* — every one of them was about a refusal, so an endpoint that always answered 501 would
have been green. What was built:

- `tests/admin.test.ts` — `isAdmin`, and the case that is the whole point of using an id: the right
  email on the wrong account is refused.
- `tests/routes.test.ts` — the namespace, five ways: a stranger at `/api/admin/users`, at the bare
  `/api/admin`, at a path that does not exist yet, with a query string, and `/api/administer`
  which is somebody else's route and must stay a 404. Plus **the administrator reaching the
  route**, which under `files` is an exact 501 — the store refusing after the gate let them
  through.
- `tests/admin-users-merge.test.ts` — the arithmetic, with no database: two owners' counts kept
  apart, an owner with nothing getting a zero rather than a missing field, an account that cannot
  sign in left out.
- `tests/admin-store.test.ts` — the real query against a real Postgres, asserting *runtime types*.
  It is the only thing that could catch what it did catch: `sql<number>` was a claim about a string
  and `sql<Date>` a claim about `"2026-08-27 16:19:31.779+00"`.
- `tests/auth-users-fence.test.ts` — both halves of the fence below.
- `tests/router.test.ts` — both spellings of both addresses, and the ones that must fall through to
  the shelf.
- `tests/admin-page.test.tsx` — the page **rendered**, against a stubbed `fetch`: a row per
  account, an account with nothing in it drawing something in every cell (no blank, no `NaN`, no
  `Invalid Date`), a first-load failure that still offers Refresh, a failed refresh saying the
  numbers are stale, an empty list refusing to draw an empty grid, and a sort chip that really
  reorders and really writes `?by=`. **It found a bug nothing in it was aiming at**: every case
  timed out, because `rawDir ?? []` above the sorting memo made a fresh array every render and so a
  render loop — which `act()` waits out for ever rather than failing. The same line was on the
  shelf; another agent found it there and fixed both. It also now pins row count against the
  account count, after a browser screenshot showed "6 accounts" above five rows during a spell of
  another agent's hot-reloads. Six accounts draw six rows; the picture was the casualty.
- `tests/owner-isolation.test.ts` — the narrow grep you suggested instead of a general one: no store
  module but `pg-admin.ts` may write `groupBy(….ownerId)`, and `pg-admin.ts` must still contain it.
- And the decoding step none of the others can see: production rewrites every `/api/*` request to
  one function as `/api/index?__spy_path=…`, so the address the gate matches on is the *output* of
  `originalUrl`. One case composes the two — restore the rewritten form, assert it, hand that exact
  string to `handleApi`, expect 403. Sol asked for it.

Every one of these was watched failing against the broken state before being kept.

And a browser pass, in a Sonnet subagent: the table scrolls inside its own box rather than moving
the page, the numeric columns are right-aligned, `/admin` and the shelf's Admin link are there, and
the console carries nothing but Vite's own HMR noise. It could **not** check a narrow window — the
automation reported a resize it had not performed — and that is left as untested rather than
assumed.

## What the second review changed

The code went back to Sol (`docs/plans/admin-page-code-review-sol.md`) and came back **no blocker,
no gate bypass, five should-fix**. Four were real defects rather than notes:

1. **"Articles" counted rows that are not on any shelf.** `beginRevision` writes the `articles` row
   before there is anything in it, so a failed first ingest leaves a slug with no current revision —
   invisible on the shelf, counted here for ever. The shelf's own eligibility rule is now
   `onTheShelf()` in [`pg.ts`](../../src/store/pg.ts), exported and used by both, so the two cannot
   disagree about what an article is. It also brought the `_`-slug exclusion with it.
2. **`confirmed_at` is not what the page said it was.** Supabase's `confirmed_at` is a
   backwards-compatibility column meaning "email *or* phone", and the page prints "unconfirmed"
   beneath an **email address** — so a phone-confirmed account with an unconfirmed email would have
   been labelled the opposite of the truth. Now `email_confirmed_at`, renamed through the type, the
   column and the cell. My comment claiming Google accounts never set it was also wrong; they do.
3. **The database tests proved shapes, not meanings.** Four regressions would have stayed green:
   `verified` changed back to any other valid string, the child counts regrouped through their own
   `owner_id`, two of the three child queries swapped, and finding 1 itself. So `adminQueries(db)`
   now returns the six statements as **builders**, and `tests/admin-queries.test.ts` reads
   `.toSQL()` off each one. No database, so it never skips.
4. **A first load that failed had no Refresh button**, because the controls were drawn only once
   there were rows — leaving the reader with a message and nothing to press, which is the exact
   thing `reload` exists to prevent. Always drawn now, and when stale rows are still on screen the
   error says so rather than sitting above a table that looks current.
5. **The docs overstated three things**, all fixed: six columns for seven; "widening the glob would
   put `auth.users` into the snapshot" when `schemaFilter` is a second, independent barrier; and
   "counts and dates and an email address", which omitted the account id and the provider list.
   The fence test's column check was a **blacklist** of five credential names — a check that passes
   for every sensitive column nobody thought of — and is now an exact allowlist read off the table
   with `getTableColumns`.

Sol also confirmed what the first review had asked for: no encoded, double-encoded, query-bearing,
slash or prefix-adjacent request reaches `listUsersAcrossOwners()` without `isAdmin`; `mergeUsers`
is tested for what would actually go wrong; and the sorting round-trip copied the parts that matter
rather than the shape. On the typed Drizzle table it said the decision was fine and my argument for
it was *"only slightly overstated"* — raw SQL can carry an explicit decoder, it just does not get
one for free.

## The fence around `auth.users`

Sol's sixth point: the plan named one protection and there are two. `drizzle.config.ts` names one
file rather than a glob, *and* `schemaFilter` is pinned to `spideryarn`, so even a table that
reached the serializer would be filtered by schema. Either alone is enough today, which is exactly
why a test pinning one would go green through the change that removed the other.

Sol would have preferred a raw `sql` template with a runtime-checked row type over a Drizzle table
declaration. Kept the declaration, for a reason the build then demonstrated: the column mappers are
what make `max(last_opened_at)` a `Date` rather than a non-ISO string, and a raw template is
precisely what has none.

## Not now

- **No writes.** Nothing on this page can delete a user, ban one, or spend anything. It reads.
- **No model spend column**, though `ai_calls` is right there. It carries no `owner_id` (it hangs
  off a revision), so per-user spend is a join through revisions and articles and is a page of its
  own the day a spend limit exists — [auth.md § Still open](../project/auth.md#still-open).
- **No pagination.** Nine users. When there are hundreds this becomes a server-side sort and the
  URL state already says what to sort by.
- **No privilege probe in `/api/health`.** Sol asked for one — `has_schema_privilege` and
  `has_column_privilege` — on the grounds that an infrequently visited admin page is a poor alarm
  for a lost grant. Fair, and it belongs with the schema-drift work rather than here; the exact
  grant and the probe are written down in
  [admin.md § Where the numbers come from](../project/admin.md#where-the-numbers-come-from).
- **The interaction counts are Greg's call to keep.** Sol would ship email, sign-up, last sign-in
  and document counts, and hold back questions/chats/searches/opens until it is written down that
  cross-reader engagement telemetry is wanted. They are in, because "etc etc" asked for them and
  every account today is Greg's or a test fixture — but it is one line to remove them, and this
  bullet is the record that it was noticed rather than missed.
