# The admin id was the one on the laptop

**2026-08-28.** Reported by Greg: *"On spideryarn.com, I'm logged in as greg@gregdetre.com, but I
can't see the Admin link. I'm fairly sure we deployed recently…"*

The deploy was fine. The Admin link was gated on an account id that does not exist in production.

## What broke

[`src/admin.ts`](../../src/admin.ts) held one constant:

```ts
export const ADMIN_USER_ID = "f4d08b58-5573-4811-9887-e26c114fb324";
```

Its doc comment said, accurately and without noticing: *"the same one the **local** Supabase stack
holds for `greg@gregdetre.com`."*

Production's `auth.users` holds `001bb7a0-7720-4f1b-8b9d-1ee6e63d132a` for that address. Two
accounts, one person, one email, two uuids — because **sign-up happens per Supabase project** and
GoTrue mints a fresh uuid each time. There is nothing to make them agree.

So on spideryarn.com `isAdmin(user.id)` was false for Greg, in all three places at once:
[`Library.tsx`](../../src/web/Library.tsx) drew no link, [`App.tsx`](../../src/web/App.tsx) showed
the shelf if he typed the address, and the `/api/admin` namespace gate in
[`routes.ts`](../../src/routes.ts) answered 403.

## The root cause is not the uuid

The uuid is the symptom. The cause is that **the value is a fact about an external system, and it
was read from the wrong instance of that system and then never checked against the right one.**

Everything else about the design was argued carefully — id rather than email, constant rather than
env var, gate above the route table rather than on the route, 403 rather than 404 — and all of it is
still right. The one input nobody could get from reasoning was looked up on a laptop, in a database
where it happened to be a different number.

The commit that introduced it is
[`7f24fb0`](../plans/admin-page.md) *"One account can see who has signed up, and nothing
else about them"*, 2026-08-27, which built the whole feature in a day.

## Why nothing caught it

Four things could have and none did:

- **The tests.** `tests/admin.test.ts` asserted `isAdmin(ADMIN_USER_ID)` — a tautology. It passes
  for whatever the constant says. `tests/helpers/authed.ts` signs the suite's requests with the same
  constant, so every route test agreed with it too. A whole suite about the administrator, and not
  one assertion whose answer came from outside the file being tested.
- **The browser pass.** Done on `localhost`, where the constant is correct.
- **`describeAdminMiss`.** This is the interesting one, and the first version of this postmortem got
  it wrong — it said the sentence *"the administrator's email arrived on an account id we do not
  recognise"* was written to the log on every attempt for a day, and nobody read it. That was
  asserted without checking, and it is false. **The sentence was never written at all**, and it could
  not have been.

  `describeAdminMiss` runs inside the `/api/admin` namespace check in
  [`routes.ts`](../../src/routes.ts) — it needs a request to reach the server. But the client never
  sends one: `AdminUsersPage`, which holds the only `fetch` of `/api/admin/users`
  ([`useAdminUsers.ts`](../../src/web/useAdminUsers.ts)), mounts only after
  [`App.tsx`](../../src/web/App.tsx) has already asked `isAdmin` and got yes. A reader `isAdmin`
  refuses is shown the shelf and makes no admin request ever.

  So **the only mitigation for the silent lockout is unreachable from the failure it was written
  for.** It fires for a hand-written `fetch` and for nothing else. The two client "courtesies" that
  [admin.md](../project/admin.md) is careful to call cosmetic turn out to be load-bearing in one
  direction nobody looked at: they are what stops the diagnosis being logged. GPT Sol found this
  reviewing the fix, 2026-08-28.

  **A mitigation nothing can trigger is not a mitigation.** What would work is a check that runs at
  deploy time and asks the production project directly, rather than one that waits for a refusal
  that the client is built never to send.
- **The doc.** [admin.md](../project/admin.md) named the risk exactly — *"a recreated account is a
  different administrator"* — and the sentence directly above the constant said "local". The two
  paragraphs never met.

This is [silent-success.md](../reusable/silent-success.md) in a shape worth naming: **a check that
compares a value to itself**. `expect(isAdmin(ADMIN_USER_ID)).toBe(true)` cannot fail. It looks like
coverage and it is a restatement.

## The fix

`ADMIN_USER_IDS`, a list of two — one id per Supabase project the repo talks to — with
`ADMIN_USER_ID_LOCAL` and `ADMIN_USER_ID_PROD` named so that the difference is impossible to read
past. `isAdmin` searches the list. Still a constant, for the reason it always was: an unset env var
read as "allow everyone" is the canonical fail-open, and an array literal has no unset state either.

**What the second entry costs, stated accurately.** The first version of this said "it widens
nothing", on the grounds that "nothing can be issued a `sub` that already exists elsewhere". That
reason is false and GPT Sol said so: OIDC only guarantees uniqueness for the pair *(issuer,
subject)*, and GoTrue's admin create-user API takes an explicit id — which this repo already uses,
in [`scripts/db-seed-owner.ts`](../../scripts/db-seed-owner.ts). An id can be created deliberately.

What is actually true is narrower and worth writing down properly:

- **The issuer is pinned one layer up.** [`src/auth.ts`](../../src/auth.ts) verifies every token
  against the project named by `SUPABASE_URL`, so a token minted by the laptop stack does not verify
  on production at all. `f4d08b58…` cannot arrive on a production request unless an account with
  that id exists **in production**.
- **Creating one there needs the service-role key**, through the admin API or a restore. Anyone
  holding that key already owns the project, so this widens nothing an attacker could reach.
- **It does widen what a mistake of ours can do.** A seed or an import pointed at production could
  create that id, and it would then be an administrator. That is a small, real cost, and it is the
  price of one constant covering two projects.

The stronger version — comparing *(project, id)* rather than id, so that the local id is refused on
production even if it exists there — is a signature change at three call sites and would close it
outright. Not done, and recorded here rather than left implicit.

The new tests **spell both uuids out** rather than importing the constants:

```ts
// Read from production's `auth.users` on 2026-08-28, via the GoTrue admin API.
expect(isAdmin("001bb7a0-7720-4f1b-8b9d-1ee6e63d132a")).toBe(true);
```

That is the whole point of the fix's test. An assertion that imports the constant it is checking
passes again the moment somebody edits the constant wrongly, which is exactly what happened.

## What would have caught the class

**A value looked up in an external system needs a second copy, written down by hand, in the check.**
Not a reference to the same variable. That rule covers this, and it covers the next account id,
bucket name, project ref or price that gets pasted in from one environment and used in another.

The narrower version, worth having as a habit: **when a constant's doc comment says which
environment the value came from, that sentence is a bug report about every other environment.** The
word "local" was sitting three lines above the id for a day.

## The second bug: the page behind the link

Fixing the link exposed the next one. It is fixed too, and it turned out not to need the database
change it looked like it needed.

`GET /api/admin/users` read `auth.users` through `src/db/auth-users.ts` (since deleted)
on the ordinary application connection. In production that connection is `spideryarn_app`, and
[database.md](../project/database.md#the-migration-role-that-cannot-exist) records — as a *feature*,
verified deliberately — that the role "cannot read `auth`". Checked against production on
2026-08-28:

```
$ psql "$DATABASE_URL" -c "select id from auth.users limit 1"
ERROR:  permission denied for schema auth
```

Locally the same query works, because `DATABASE_URL` on a laptop is the `postgres` superuser. So the
admin page has never run against a role that resembles production's — **the same shape of mistake as
the uuid, one layer down**, and it was written in the same day by the same reasoning.

**And this one was already known.** The header of
[`scripts/check-owner-identity.ts`](../../scripts/check-owner-identity.ts), written 2026-08-26, says
it in as many words:

> `auth.users` is not readable by the application's database user. Measured, not assumed: the first
> version of this script ran that query against production and got `42501 permission denied for
> schema auth`. Supabase owns that schema and the app has no business in it — which is the right
> answer, and it is why this reaches for `SUPABASE_SERVICE_ROLE_KEY` from `.env.prod`.

So the fact had been measured against production, written down, and acted on — a day before the
admin page was built doing exactly the query it says does not work. **The finding was in the repo
and nothing connected it to the new code.** That is the more useful root cause than the privilege
itself, and the same sentence names the fix: the admin API, which the repo already uses for this
exact question.

The service-role key is already in the production server's environment — `blobs.ts` needs it for
Storage and `vercel-health.ts` checks it is set — so that route costs no new credential and no DDL.
[`src/store/admin-accounts.ts`](../../src/store/admin-accounts.ts) is the result;
[admin.md](../project/admin.md) has the four options and why this one.

**What the move brought with it**, because a fix that swaps one silent failure for another is not a
fix:

- **The service pages and truncates at fifty without saying so.** So the pagination checks itself
  against `x-total-count` — the service's own count, the one number that comes from outside the loop
  — and throws on a shortfall rather than returning a short list. The test runs a fake holding 120
  accounts that hands back 50 at a time; the obvious one-request implementation was watched failing
  it before the real one was written.
- **An API response has no column list.** The old query could return only what the table declared,
  which `tests/auth-users-fence.test.ts` pinned. `accountFrom` now names its six fields one at a
  time, and the test feeds it a phone number, a full name, a password hash and two tokens and
  asserts none of them survives.
- **Two environment variables now have to agree.** `SUPABASE_URL` and `DATABASE_URL` could name
  different projects, which would list one project's accounts beside another's counts and give
  everybody zeros. `projectMismatch` from `blobs.ts` is reused rather than a second one written.
- **The API returns deleted accounts**, where the query said `where deleted_at is null`. This one
  was nearly missed and is the most instructive of the four: GoTrue *omits* `deleted_at` on a live
  account, so inspecting a real response — which is what had been done — showed no such field on any
  row and gave no hint the case existed. It was settled by making one: create an account on the
  local stack, soft-delete it, list again. And it sets a trap, because `x-total-count` counts the
  deleted rows too, so the shortfall check has to compare what *arrived* rather than what survived
  filtering, or the first deletion takes the page down.

  **Reading a response tells you about the data that project happens to have.** The same lesson as
  the account id, arriving a third time in one day.
- **Offset pagination has no snapshot**, so a sign-up between two requests shifts every later page
  and the listing both repeats a row and loses one — while the arrival count comes out right,
  because the duplicate made up the number. GPT Sol reproduced it on 400 accounts and it defeated
  the first version of the count check outright. The repair is that `Link … rel="next"` decides when
  to stop, distinct ids decide what is kept, and `x-total-count` audits the answer and never
  terminates the loop.
- **A response with no `users` array read as an empty list**, which turns a changed envelope or a
  proxy's HTML into a working page saying nobody has signed up. It throws now, and so does
  exhausting the page cap.

Four of those six were found by review or by experiment rather than by the code failing, which is
the honest summary of this whole day: **every one of them would have shipped looking fine.**

## What is still open

**The gate compares an id, and an email would be simpler.** Greg raised it, and the objection
recorded against it is weaker than it reads: production has
`mailer_secure_email_change_enabled = true`, so taking his address needs a click on a link sent to
*his* inbox — and anyone with that inbox can sign in as him directly. `auth.users` also carries
`users_email_partial_key`, a unique index on `email` where `is_sso_user = false`, and SAML is off on
this project, so **addresses are unique across it**: an account that exists and is never deleted
cannot have its address taken by a second row.

Not changed, because the more useful fix is the one neither field gets for free — **a deploy-time
check that the administrator resolves to a real account on the project being deployed to.** Either
field can be silently wrong; only a check against the live project can say so.
