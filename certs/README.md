# Certificates

## `supabase-ca.crt` — not here yet

Supabase's CA certificate, for **verifying** the remote database server rather than merely
encrypting the connection to it. Download it from the project dashboard:

> Settings → Database → SSL Configuration → **Download certificate**

...and save it here under exactly that name. [`scripts/db-migrate.ts`](../scripts/db-migrate.ts)
picks it up automatically, so nothing needs configuring once the file exists. `PGSSLROOTCERT`
overrides the path if you ever need a different one.

**Committing it is correct.** It is a public CA certificate — the same file every Supabase customer
gets, containing no secret — and committing it means a fresh clone gets verified connections with no
setup step. It is not a credential; the password in `DATABASE_URL` is, and that lives in `.env.prod`,
which is git-ignored.

## Why this directory rather than `supabase/`

`supabase/` is the CLI's, and `supabase init --force` rewrites what is in it
([supabase-local.md](../docs/project/supabase-local.md#the-ports-and-the-postgres-version) records
that trap for `config.toml`). A certificate quietly disappearing on a CLI upgrade would show up as a
TLS failure weeks later, in something nobody had touched.

## What happens while it is missing

The connection still works and is still **encrypted** — but `rejectUnauthorized` goes to `false`,
which accepts whatever certificate the server offers. That is no protection against a
man-in-the-middle, and it looks exactly like a secure connection from the outside, so
`db-migrate` prints a warning rather than doing it quietly.

SSL enforcement itself is already **on** for the remote project
([the plan](../docs/plans/postgres-migration.md#the-project-we-are-actually-using)); this file is the
second half of that.
