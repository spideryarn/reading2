# Seed the admin sign-in account, so a fresh box needs no Google

**Status: built 2026-08-31, reviewed by GPT Sol, and changed by that review.**

Greg, 2026-08-31:

> For the Hetzner remote box, it expects a `greg@gregdetre.com` admin user. I could try and use the
> VNC to sign in via Google on that box. But I'd prefer if there was a more automatic way. Could you
> create a user in that database with that email address (and make that be part of the setup)?

## The problem

The box runs its own local Supabase stack ([supabase-local.md](../project/supabase-local.md)), and a
fresh stack has no `greg@gregdetre.com` in `auth.users`. Two things follow, and only the first is
obvious:

1. **There is no session**, so every route past the gate refuses ([auth.md](../project/auth.md)).
   The only ways in today are a Google sign-in through a browser on the box — which means the noVNC
   tunnel, and Google Cloud Console blocks agents twice over — or minting a magic link by hand with
   [`scripts/seed-local-session.ts`](../../scripts/seed-local-session.ts).
2. **Even signing up by hand does not make him the administrator.** `/api/admin/*` gates on a
   *uuid*, not on the email address ([`src/admin.ts`](../../src/admin.ts), and the reasoning there is
   good). Signing up through the email form mints a random uuid, so the account holds the right
   address, is refused by `/admin`, and the client just draws the shelf instead. That is exactly the
   silent lockout `describeAdminMiss` was written for, and it already happened once in production
   ([260828f](../postmortems/260828f-admin-id-was-the-local-one.md)).

So "create a user with that email" is necessary but not sufficient: it has to be **that email at
that uuid**, with a way to sign in that needs no browser Greg cannot reach.

## What we will do

**Extend `npm run db:seed-owner`** ([`scripts/db-seed-owner.ts`](../../scripts/db-seed-owner.ts)) so
it seeds a second `auth.users` row: `ADMIN_EMAIL` at `ADMIN_USER_ID_LOCAL`, email confirmed, with a
password. Sign-in is then the email/password form that is already on the landing page
([`SignInControls.tsx`](../../src/web/SignInControls.tsx)) — no Google, no VNC, no dashboard.

Both constants are imported from `src/admin.ts`, which is already the one place that knows the id.
That inverts a fact that has been accidental: `ADMIN_USER_ID_LOCAL` was *read off* a laptop database
after a Google sign-in. After this, the seed **creates** it, so the constant and the database agree
by construction on every machine rather than on one.

Same shape as the existing owner block: local-only guard, GoTrue admin API rather than an `insert`,
idempotent, and loud when it finds the address on an id it did not expect.

### Why one command and not two

`db:seed-owner` is already the step every setup list names, and a second command is a step a fresh
box can skip — landing exactly back on the problem this fixes. The name stays (a rename is a
repo-wide sweep for no gain); its doc comment and the docs that name it say it seeds two rows now.

### Why a generated password in a file

Three options, and the first two were both rejected before the third was built.

**Not `SPIDERYARN_LOCAL_ADMIN_PASSWORD=` in `.env.local`.** An unset environment variable has to
mean something, and every meaning is bad: skip the account and a fresh box is back to the Google
problem with a green tick on the seed; generate one and a re-run rotates the password out from under
whoever wrote it down; hard-fail and every existing clone's `db:seed-owner` breaks. `src/admin.ts`
had already made this call about the id, for the same reason — an unset variable read as a
permission is the fail-open shape this repo keeps getting bitten by
([silent-success.md](../reusable/silent-success.md)).

**Not a constant in git either, though that is what was built first.** The argument for it was
decent: a local stack's service-role key and JWT secret are already fixed public strings, so a
password is no weaker a link than what sits beside it, and the firewall is the boundary either way.
GPT Sol agreed the incremental risk was small and still gave the better third option — the constant
puts **one permanent, universal credential for the privileged account into every clone and every
box**, one that rotation and secret-scanning can never help with because it is published on purpose.
Greg's call, 2026-08-31: generate it.

**So: generated per machine, `0600`, in `~/.config/spideryarn/local-admin-password`.** It has no
unset state, because the first seed makes it. It is outside the database, so `npm run db:reset` does
not change it — which matters more than it sounds, since changing it revokes every open session. It
is under `$HOME`, which on the box is bind-mounted from the persistent volume, so it survives a
rebuild. And each machine's is its own.

Two things it costs, both real. The password cannot be written down in a doc, so
`npm run db:admin-password` exists to print it and the seed prints it once on creation. And losing
the file means the next seed generates a new one and signs every open session out — recoverable, but
not free.

**Not in `.env.local`**, which would have been the obvious home: `gjd-remote push-env` *rebuilds*
that file from an allowlist, so a value written on the box is destroyed by the next push, and a value
pushed from the laptop would hand both machines one credential again — undoing the only thing this
design buys over the constant.

### Two things deliberately not done

- **Not a magic link per browser.** `seed-local-session.ts` already mints one, and it is right for
  what it does. But Playwright on the box runs `--isolated`, so every browser session starts signed
  out — a password can be typed by whoever needs it, a link has to be minted again each time. And it
  is a command to remember, not part of the setup.
- **Not making `DEV_OWNER_ID` *be* the admin id.** It would merge the two local identities and give
  the signed-in admin the shelf the CLI has been filling. It also repoints every existing row on
  Greg's laptop at an id that is not their owner. Not worth it for this.

## The consequence worth knowing about

**The admin's shelf on the box starts empty**, and that is not a bug in this change. Rows written
outside a request — the CLI, the pipeline, `db:import` — are owned by `DEV_OWNER_ID`
([`src/owner.ts`](../../src/owner.ts)), and rows written through the app are owned by whoever signed
in. They are two people.

The obvious fix is `SPIDERYARN_OWNER_ID=<ADMIN_USER_ID_LOCAL>`, and as first written **it does not
work** — Sol's fifth finding, and it is right. `gjd-remote push-env` *rebuilds* `.env.local` from an
allowlist ([`scripts/gjd-remote-env.ts`](../../scripts/gjd-remote-env.ts)) which did not include it,
so a line typed on the box disappears at the next push.

**Greg chose one shelf, 2026-08-31**, so the key is on the allowlist and set on the laptop — which
also changes who owns rows the *laptop's* CLI writes, and that was named at the point of choosing
rather than inherited. A new box is therefore right from its first ingest.

What it does not do is move rows that already exist, and both databases have some: 19 articles on
the laptop and 14 on the box, all on the row-owner's shelf. Measuring that is what showed this was
never box-specific — the signed-in library has been empty on the laptop all along. Re-owning them is
a one-off `UPDATE` per database and is **not** done here: it is a data migration on somebody else's
data, and it is worth doing deliberately rather than as a side effect of a convenience feature.

## What the review changed

GPT Sol reviewed this before it was built and returned **GO WITH CHANGES**
([the review](260831ab-seed-local-admin-user-for-remote-box-review-sol.md)). Three findings were
right and are built; two are decisions rather than code, and are below.

**1. Setting the password on every run signs every open browser out.** GoTrue's admin password
update calls `Logout` for that user. *Measured here rather than taken on trust*: a refresh token that
answered `200` before an unconditional `PUT` answered `400` after it. The docs tell you to run this
command after **every** `db:reset`, so as first written it was a setup step that quietly ended Greg's
session. It now **signs in first** and only writes when the password is actually wrong — and a reply
that is not a verdict on the password (a 500, a network wobble) aborts rather than overwriting.
Re-measured after the fix: `200` before, `200` after.

**2. A hostname check cannot tell the local stack from a tunnel to a real project.** Every step in
the run reads `SUPABASE_URL` — seed through it, sign in through it, verify through it — so all three
agree no matter what is on the other end of the port. That is the
[silent-success](../reusable/silent-success.md) shape exactly. So before it writes anything the seed
asks a **second source**: `supabase status -o env`, which reads *this repo's* containers, and the
URL and the service-role key must both be the ones it reports. A forwarded port cannot make the CLI
describe it. The old regex was weaker than a hostname check anyway —
`http://localhost:8000@evil.example/` satisfied it, because userinfo is not the host.

**3. Two agents can run the setup at once.** A create that comes back `409`/`422` re-reads by id and
succeeds if the account that now exists is the one we wanted.

### And what the review of the built code changed

Sol reviewed the code as well, and this repo weights that one higher — a plan-stage review reads
prose and cannot find a bug that does not exist until somebody writes it. **GO WITH CHANGES**
([the review](260831ab-seed-local-admin-user-for-remote-box-code-review-sol.md)), and it was right
about all four.

**A real bug I had introduced.** `refuseNonLocalSeed` accepts `localhost`, `127.0.0.1` and `[::1]`
as the same machine; `refuseMismatchedStack` compared URLs as *strings*, and the CLI always prints
`127.0.0.1`. So a perfectly ordinary `SUPABASE_URL=http://localhost:54361` passed the first gate and
was refused by the second, telling somebody that something other than the local stack was answering.
Compared as origins with loopback folded together now, and the port — which is what tells our stack
from the old app's — compared exactly.

**The decision that matters had no test.** Whether to overwrite the password lived inside a script
that does its work at import time, so nothing could reach it. It is now
`readPasswordVerdict` in [`scripts/seed-accounts.ts`](../../scripts/seed-accounts.ts), pure and
tested against the rate limit, `user_banned`, a 500, an HTML error page, and the right code on the
wrong status. It reads GoTrue's `x-sb-error-code` header first and the body second.

**The live suite skipped its own point.** The two `handleApi` cases required
`SPIDERYARN_STORE=postgres`, so under a plain `npm test` the real token never crossed the real gate —
the one joint the file exists for was the one it did not test. A 501 from the filesystem store is
*past* the gate, so that is now the assertion there, and both cases run either way. A second control
went in beside them: a well-formed token that is not ours must also be refused, which "no token at
all" does not prove.

**Three overclaims, removed.** Reaching the Supabase port does not let anyone read `.env.local`; the
sign-in check called the service-role key "the key the browser holds" when it fell back to it, and
now refuses to run without a real publishable/anon key; and this plan promised a warning in
`main.tf` that was not there, which is now written.

Two smaller things came out of building rather than reviewing: `supabase status` is invoked as
`supabase`, not `npx supabase`, because `npx` on a machine without it will *fetch* an unpinned CLI at
the exact moment we are establishing what to trust — and its stderr is kept, because "Docker is not
running", "no `supabase/config.toml`" and a timeout otherwise fail identically.

### What the review raised that is Greg's call, not built

**Gating admin on `(issuer, id)` rather than on `id`.** [`src/admin.ts`](../../src/admin.ts) already
names this as the version that closes the hole outright, and already declines to do it. Seeding the
id makes it slightly more concrete — a uuid that grants admin is now created by a script — though
the script now refuses anything but the verified local stack. Not done here: it changes production
authorisation, at three call sites, inside a change nobody asked to be about that. Worth doing on
its own.

## Checks, and what they said

Nothing here is trusted because an API returned 200 — the whole area is
[silent-success](../reusable/silent-success.md) territory.

**`npm test` is 385 files and 7089 tests, all passing.** Two files failed on an earlier run and both
passed alone: `store-parity` and `store-jobs-parity` contend for the global running-slot cap when the
suite runs beside another agent's, which is a shared-resource collision rather than anything here.

**The measurement that was not obvious, and the reason it had to be one.** On Greg's laptop
`greg@gregdetre.com` already existed with `providers: ["google"]` and no password at all. Whether
GoTrue issues a password token for an account whose only identity is Google is not something to
assume — Sol read the v2.195.0 source and said it does; the run says the same on the stack we
actually have. It signs in, and the token's `sub` is `ADMIN_USER_ID_LOCAL`. Setting the password
left `identities: ["google"]` untouched.

**The seed proves itself, every run.** `assertCanSignIn` is not a test — it is the last thing the
script does, so a setup that leaves an account nobody can sign in as fails *there* rather than being
discovered by a person in a browser. It reads the token's `sub`, because a token for the wrong
account is the failure that would satisfy a check that only looked for an `access_token`.

**[`tests/seed-accounts.test.ts`](../../tests/seed-accounts.test.ts)** — the rules, with no Supabase
and no database. It also covers the password file against a temp directory: created `0600`, the same
one given back on the next call (the property `db:reset` must not break), a file somebody has
loosened to `0644` tightened again, and an empty or truncated one replaced — with the replacement
locked down too, because `writeFileSync`'s `mode` applies only when it creates the file.
Every case here has been watched go red. The two worth naming: `http://localhost:8000@evil.example/`
satisfies the regex this replaced *and* is refused by what replaced it, asserted in the same test so
the contrast cannot rot; and pointing the seed at `127.0.0.1:54341`, which is the **old app's** local
Supabase and really does run on this machine, is refused — a hostname check cannot tell those apart.

**[`tests/seed-admin-signin.test.ts`](../../tests/seed-admin-signin.test.ts)** — the seam nothing
else crosses. `tests/admin.test.ts` asks whether `isAdmin` says yes to a constant;
`tests/routes.test.ts` drives `/api/admin/*` with a verifier that accepts the string `test-token`.
Both are green on a machine where nobody can sign in at all. This one mints a real token from GoTrue,
puts it through `verifyWithSupabase` against the live JWKS, and hands it to `handleApi` **with no
verifier argument**. The expected answer depends on the store — `200` under Postgres, `501` on the
filesystem, which is `adminOnFiles` refusing *past* the gate — and either way it is not a refusal.
Two controls, because one is not enough: no credential at all must be 401, and so must a well-formed
token that is not ours. The first proves the door is shut, the second proves it is shut against
arbitrary credentials rather than only against silence.

**Two mutation checks**, since a test that was never red proves nothing: pointing `SEEDED_ACCOUNTS`
at a different uuid reddens the drift case, and pointing the stack check at a directory with no
`supabase/config.toml` makes the script refuse to write rather than fall through.

**Session survival, before and after.** The thing finding 1 is about, measured both ways — see
[§ What the review changed](#what-the-review-changed).

`npm test`, `npm run typecheck` and `npm run check` all run.
