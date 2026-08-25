# Certificates

## `supabase-ca.crt`

Supabase's CA certificate, for **verifying** the remote database server rather than merely
encrypting the connection to it. Downloaded from the project dashboard on 2026-08-25
(Settings → Database → SSL Configuration → **Download certificate**), where it arrives named
`prod-ca-2021.crt`.

Nothing needs configuring: [`scripts/db-migrate.ts`](../scripts/db-migrate.ts) resolves this exact
path, so the filename is the contract. `PGSSLROOTCERT` overrides it if a different one is ever
needed.

| | |
|---|---|
| Subject / issuer | `CN=Supabase Root 2021 CA, O=Supabase Inc` — self-signed root |
| Valid | 2021-04-28 → **2031-04-26** |
| Size | 1,367 bytes, 23 lines of PEM |

## Why it is committed rather than git-ignored

**Because it is not a secret.** It is Supabase's public root CA — the same file every customer
downloads, containing no project identifier (checked, not assumed:
[tests/db-tls.test.ts](../tests/db-tls.test.ts) asserts the project ref does not appear in it). A
public key that vouches for a server is meant to be distributed; that is the entire idea.

Committing it means a fresh clone gets verified connections with no setup step, which is the
difference between a safe default and a safe option.

**The credential is the password**, in `DATABASE_URL`, and that lives in `.env.prod`, which is
git-ignored along with every other `.env*`.

If Supabase ever issues a *project-scoped* certificate, that reasoning stops holding — which is why
the no-project-identifier assertion is a test rather than a sentence here.

## Why this directory rather than `supabase/`

`supabase/` belongs to the CLI, and `supabase init --force` rewrites what is in it
([supabase-local.md](../docs/project/supabase-local.md#the-ports-and-the-postgres-version) records
that trap for `config.toml`). A certificate quietly disappearing on a CLI upgrade would surface as a
TLS failure weeks later, in code nobody had touched.

## What happens if it goes missing

The connection **still works**, and is **still encrypted** — but `rejectUnauthorized` drops to
`false`, which accepts whatever certificate the server offers. That is no protection against a
machine-in-the-middle, and from the outside it looks exactly like a secure connection. Only a
warning on stderr distinguishes them.

That is a [silent success](../docs/reusable/silent-success.md), so it is guarded by tests rather
than by this paragraph: [tests/db-tls.test.ts](../tests/db-tls.test.ts) fails if the file is absent,
is not a PEM certificate, is not Supabase's root CA, or expires within 90 days. Those five tests were
checked by deleting the file and confirming all five fail — a guard nobody has watched fail is not
yet a guard.

## Verified against the real server

Confirmed 2026-08-25, not merely assumed: a migration attempt against
`db.alschkahzfagtppxspfq.supabase.co:5432` with a deliberately wrong password reached
**"password authentication failed"**. Reaching a password error means the TLS handshake completed —
so this certificate really does verify Supabase's server, with `rejectUnauthorized: true` and no
warning printed.

Two things that run showed incidentally: the direct IPv6 host resolves from Greg's laptop, and
[the plan's note](../docs/plans/postgres-migration.md#the-project-we-are-actually-using) that it will
*not* resolve from an IPv4-only host such as Vercel is still the constraint that decides which
connection string production uses.
