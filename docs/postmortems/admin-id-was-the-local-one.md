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

## Still broken: the page behind the link

Fixing the link exposes the next one, and it is not fixed here because it needs a change to the
production database.

`GET /api/admin/users` reads `auth.users` through [`src/db/auth-users.ts`](../../src/db/auth-users.ts)
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
Storage and `vercel-health.ts` checks it is set — so that route costs no new credential. See
[admin.md](../project/admin.md) for the four options and the choice.
