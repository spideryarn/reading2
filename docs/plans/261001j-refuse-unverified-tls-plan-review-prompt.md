Review a plan before it is built. Read-only: do not edit files.

Plan: docs/plans/261001j-refuse-unverified-tls-to-the-remote-database.md
Code it changes: src/db/ssl.ts (sslDecisionFor), src/db/client.ts (getDb), callers listed by
`grep -rn sslDecisionFor src scripts`, src/vercel-health.ts (SSL_URL_KEYS), scripts/deploy-checks.ts
(migratorUrlFrom), scripts/feedback-reporter.ts (TLS_URL_KEYS).
The red-first tests already written: tests/db-ssl.test.ts, the final describe block. They currently
fail 13 for the right reason (the refusal does not exist yet).
Installed: node_modules/pg (8.23.0), node_modules/pg-connection-string (2.14.0).

Greg's constraint: "as long as the cure isn't worse than the disease". Production must not break.

Please check, against the installed pg source rather than from memory:
1. Is the list of paths complete? Any other way a remote connection ends up unverified despite
   sslDecisionFor returning "verified" — other query keys, env vars, `options`, URL-encoded key
   spellings, `postgres:` vs `postgresql:` vs a non-URL libpq "key=value" string, a socket path?
2. Is refusing in sslDecisionFor the right single place, or does some caller build a Pool/Client
   without going through it (grep for `new Pool(` and `new Client(` in src/ and scripts/)?
3. Is there any working production or deploy path this breaks? The evidence is in the plan's
   "Will the cure break what works today" section — challenge it.
4. Is throwing from getDb() on first use the right failure for the runtime, or worse than the
   warning it replaces?
5. Do the tests prove the claims, and is there a way they could pass while the defence is absent?

And the conclusion itself: is "refuse as a class" right, versus stripping the keys?

Answer with numbered findings, each P0/P1/P2, with file:line and the evidence. End with a one-line
verdict: build as planned / build with changes (list them) / do not build.
