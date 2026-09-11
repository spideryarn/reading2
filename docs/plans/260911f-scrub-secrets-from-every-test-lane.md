# Scrub secrets from every test lane's environment

Queued item qi-xj735ng4, authorised by Greg on 2026-09-10 and dispatched by the Overseer on
2026-09-11. It builds the fix ranked first in
[260910d](../postmortems/260910d-an-assertion-over-a-whole-environment-prints-every-secret-when-it-fails.md):
a failing assertion over a test worker's environment printed four real keys into a subagent's
context, because every worker held every key in `.env.local`.

## What changes

- **[`tests/helpers/scrub-secrets.ts`](../../tests/helpers/scrub-secrets.ts)**: `scrubSecrets(env,
  keep)`. Every present variable that `isSecretName` (scripts/subagent-cli.ts, reused, not copied)
  calls a secret is replaced and its name added to `SPIDERYARN_ENV_PINNED`. A URL keeps its shape
  and loses its user, password, query and fragment. Anything else becomes `test-lane-scrubbed-secret`.
  `NO_PROXY` is left alone. Replaced rather than deleted, because a missing credential can pick a
  working fallback.
- **Each lane's setup calls it straight after `loadEnvLocal()`.**
  - `unit` keeps nothing.
  - `private-postgres` keeps `DATABASE_URL` (overwritten with the minted database anyway) and
    `SUPABASE_SERVICE_ROLE_KEY` (the shared local bucket).
  - `shared-services` keeps those two plus `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_ANON_KEY`,
    for GoTrue.
  - Both database lanes keep them only while `DATABASE_URL` and `SUPABASE_URL` are loopback
    (`keptOnlyIfLocal`, using `isLocalDatabaseUrl`). Otherwise the credentials are scrubbed too.
    A `.env.local` pointed at a hosted project would then leave the shared lane with a hosted
    `DATABASE_URL` that has no password in it, instead of one it could write through.
- **The probes**: `tests/test-workers-hold-no-secrets.test.ts` in the unit lane, one case in
  `tests/private-lane-survives-a-module-reset.test.ts`, and one in `tests/db-test-create.test.ts`.
  All of them compare names only.
- **Sites the scrub changed**:
  - `tests/run-codex.test.ts`'s environment test asserts booleans, and asserts the sentinel key
    rather than the real one read from `.env.local`.
  - `tests/store-boots-without-inherited-credentials.test.ts` and `tests/stage2c-raw-bytes.test.ts`
    narrow the pin rather than deleting or replacing it.
  - `tests/billing-usage-route.test.ts` sets its own `sk_test_…` key instead of relying on the
    real one.
- `docs/project/testing.md` § `.env.local` is loaded into tests now says what is true.

## The simpler option passed over

**One scrub in `vitest.config.ts`**, before any worker exists, where the account-routing variables
are already deleted. Rejected, and GPT Sol agreed. Each worker's own `loadEnvLocal()` would put the
values back unless the config also pinned every name. It could not give the database lanes their
local credentials. And the private lane's global setup, which runs in that same process, needs the
real `DATABASE_URL`.

## Evidence

- **Red first.** Before any setup called the scrub, the unit probe went red. Three of its
  cases named 11 or 12 real keys each: in a rendered `toEqual` failure over `process.env`, in the
  worker, and after a module reset. The child case went red once it was rewritten to check values
  rather than changes. Every red run was checked with a scratch script that looks for each real
  value in the captured output and prints names only. It found none. That script was itself shown
  to fire on a planted value.
- **Mutation.** With the unit lane's `scrubSecrets` call commented out, run-codex's rewritten
  assertion goes red. It prints `expected false to be true`, and no dump. With the call commented
  out in `private-db.ts` and `shared-db.ts`, each lane's probe goes red. They name 9 and 11
  variables, and print no values.

## Reviews

- **Design**, GPT Sol (findings only, 2026-09-11). It had eight findings.
  - Folded in: stage2c replaced the whole pin (P1); the billing test's mirror needed a real Stripe
    key (P1); per-lane probes, and constants rather than current values as the allowed poisons
    (P1); shape-valid sentinels for URL-like names and `NO_PROXY` (P2); setup-file placement,
    which Sol confirmed (P3).
  - P0, that the shared lane could write to a hosted database: closed as a side effect of the
    loopback gate, as described above. It is not a separate identity check.
  - P2, that `tools/fleet/transcribe.ts` reads `OPENROUTER_API_KEY` from `.env.local` itself: named
    in the helper's header and in testing.md, and not fixed.
  - P3, keep only whichever public client key a test selects: not taken. Both are public keys for
    the local stack, and choosing between them belongs to the test.
- **Code**: see the end-of-stage review below.
