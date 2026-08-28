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
- **`describeAdminMiss`.** It **worked**. The server wrote *"the administrator's email arrived on an
  account id we do not recognise — see src/admin.ts"* into the log on every attempt for a day. It was
  written for the recreated-account case, which was imagined as a future event; the same failure
  arrived on the first deploy instead, and nobody was reading the log. **A mitigation that only
  writes something down is not a mitigation until something reads it.**
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

**It widens nothing.** Each id names an account that exists on exactly one project, so on either
database the other entry names nobody: production has no `f4d08b58…`, and nothing can be issued a
`sub` that already exists elsewhere.

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

Greg's call, because it is a privilege change on the real database. See
[admin.md](../project/admin.md).
