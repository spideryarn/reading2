# Refuse unverified TLS to the remote database

Greg approved this on 2026-10-01:

> as long as the cure isn't worse than the disease

**The gap.** [`sslDecisionFor`](../../src/db/ssl.ts) decides what every Postgres connection passes
as `pg`'s `ssl` option. Against the remote it can end up encrypted but **not verifying who the
server is** — the one outcome that looks identical to the safe one — and the runtime
([`src/db/client.ts`](../../src/db/client.ts)) only logs a warning and carries on.

## The paths, established

Measured against the installed `pg` 8.23.0 / `pg-connection-string` 2.14.0 by handing a URL and our
decision to `pg`'s own `ConnectionParameters` — [tests/db-ssl.test.ts](../../tests/db-ssl.test.ts),
"the remote is verified or refused".

1. **The CA file is absent** (and `PGSSLROOTCERT` unset). `sslDecisionFor` returns
   `encrypted-unverified`, `rejectUnauthorized: false`. Every caller connects; the app warns, the
   scripts print to stderr.
2. **The URL carries a TLS setting.** `pg` merges the parsed connection string *over* the config it
   is given, and `pg-connection-string` builds a fresh `ssl` object whenever the URL has
   `sslmode`, `sslrootcert`, `sslcert` or `sslkey` (and `ssl=` / `sslnegotiation=direct` set it too).
   Our `ca` is dropped while we report "verified". Silent-unverified outcomes: `sslmode=no-verify`,
   `sslmode=prefer`, `uselibpqcompat=true&sslmode=require`, `ssl=no-verify`. Plaintext:
   `sslmode=disable`, `ssl=0` (Supabase enforces TLS, so refused loudly by the server). The others
   drop our CA and fall back to Node's public roots, which fail loudly — or, with `sslrootcert`,
   use whatever file the URL names.
3. **A connection that never asks.** `pg` reads `PGSSLMODE` only when `ssl` is undefined — which
   the plan first said never happens. It did, in four constructors (Sol, plan review; below).
4. **Not a path:** a `?host=` override (already makes the URL non-local, so it takes the remote
   branch).

Some callers already guard path 2 for themselves: `migratorUrlFrom` strips four of the keys,
`scripts/feedback-reporter.ts` refuses seven, `/api/health` warns about four. The runtime pool and
the ordinary scripts do not.

## The fix

In `sslDecisionFor`, for any non-local URL (there is exactly one remote, production):

- **the URL carries any of** `ssl`, `sslmode`, `sslrootcert`, `sslcert`, `sslkey`,
  `sslnegotiation`, `uselibpqcompat` → **throw**, naming the keys and saying to remove them; the
  committed CA is what verifies. Refused as a class rather than sorted, because which of them are
  safe is `pg-connection-string`'s to change between versions.
- **no CA file** → **throw**, saying where it looked and how to get it back.

The list is complete for `pg-connection-string` 2.14.0 only, so `sslDecisionFor` **also asks that
parser**: if it turns the URL into any `ssl` value, that is refused too, whatever the key was
called. The list goes first because it names the key and because parsing a URL that names a
certificate file reads the file.

`encrypted-unverified` leaves the `SslDecision` union, so the compiler finds every caller that
handled it; their warn branches go. Local URLs are untouched (`disabled`, whatever they carry).
The key list is exported once and `feedback-reporter.ts` uses it instead of its own copy;
`/api/health` drops its narrower four-key warning, because the refusal now covers it.

**Every connection has to ask.** A `Pool` or `Client` built without `ssl` takes `pg`'s defaults —
`PGSSLMODE` and the URL's own keys. Four did: the local-database gate in `scripts/deploy.ts`, two
spikes, and `db-reown` (fenced to local, but cheaper to make uniform than to argue). All four now
pass `sslDecisionFor(url).ssl`, and a test scans `src/` and `scripts/` for any constructor without
an `ssl` option.

**The migrator refuses rather than strips.** `migratorUrlFrom` used to delete four TLS keys,
quietly repairing `sslmode=no-verify` while `ssl=no-verify` went through. It keeps them now, and
`sslDecisionFor` refuses all spellings alike before `npm run deploy` connects.

Where the refusal lands: `getDb()` throws on first use. A reader gets the ordinary generic failure
(the route handlers log it and send it to Sentry); the reason itself is in the logs and on
`/api/health`, as `ssl.error` plus a warning, which makes it a 503 and fails `npm run deploy`'s
health judgement.

**The simpler option passed over:** strip the keys from the URL instead of refusing. It never
breaks anything, but it silently overrides what an operator wrote, and it only knows the spellings
it lists. A refusal says what happened.

## Will the cure break what works today

Checked 2026-10-01, before building:

- **Production** — `https://www.spideryarn.com/api/health` reports `ssl.mode: "verified"`,
  `why: "verified against certs/supabase-ca.crt"`, no URL-override warning, `PGSSLROOTCERT` set.
  `vercel.json` ships `certs/**` with the function.
- **`.env.prod` and `.env.local` on the box** — `DATABASE_URL` has no query string at all.
- **`npm run deploy`** — reads `.env.prod`, strips the TLS keys in `migratorUrlFrom`, and already
  refuses anything but `verified`.
- **The certificate** is committed; [tests/db-tls.test.ts](../../tests/db-tls.test.ts) asserts it
  is present, a CA, and unexpired.
- **Local** — loopback URLs never reach the new branches.
- **Greg's Mac** — not checkable from here; its `.env` files would need a TLS key in a remote URL to
  be affected, and the error says exactly what to remove.

## Tests

Red first, both arms: the 12 URL settings and the missing CA throw (13 red before the change); a
plain remote URL hands `pg` our CA with `rejectUnauthorized: true`; local stays `disabled`. Then,
after the plan review: a percent-encoded key and the `postgres:` scheme; the migrator keeping the
keys (2 red before); and the constructor scan.

Mutation checks, run once by hand: removing `ssl` from one spike's constructor turns the scan red
and names the line; emptying the key list leaves every `ssl`-producing spelling refused by the
parser check alone (12 of 13 — bare `uselibpqcompat`, which changes nothing on its own, needs the
list).

## Reviews

- Plan: [261001j-refuse-unverified-tls-plan-review-sol.md](261001j-refuse-unverified-tls-plan-review-sol.md)
  — build with changes. All five findings taken: the four unguarded constructors, the migrator
  stripping, the overclaimed future-proofing (now a parser check), the extra test cases, and the
  runtime wording.
