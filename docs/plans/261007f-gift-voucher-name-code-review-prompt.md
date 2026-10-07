# Code review: 261007f stage 1, a gift voucher's recipient name

You are reviewing **code**, and you may fix what you find **inside this stage**, narrowly and
red-first (a failing test before the fix). Anything wider that you notice: report it, do not fix
it. Do not commit. Do not touch `.env.local`, `infra/`, `src/store/pg-share-link.ts`,
`src/share-key.ts` or `src/store/link-shared-slug.ts`.

**Candidate (committed):** exactly commit `e661a29d5` on top of `2f4a904eb` (the plan). Diff:
`git show e661a29d5`; paths: `git show --stat --format= e661a29d5`. The plan is
`docs/plans/261007f-gift-voucher-recipient-name-and-a-starter-article-written-up.md` § Stage 1,
and your own plan review is `docs/plans/261007f-gift-voucher-name-plan-review-sol.md` (F5 to F9
were to be built in). The code was written by a Claude subagent.

Start with `src/store/pg-vouchers.ts`, `src/store/pg-voucher-emails.ts`, `src/admin-vouchers.ts`,
`src/web/useAdminVouchers.ts`, `src/web/AdminVouchersPage.tsx`, `src/db/schema.ts`,
`drizzle/20261007053304_billing_voucher_recipient_name.sql`, `src/web/PrivacyPage.tsx` and the
tests beside them. That list does not limit scope.

You may run test files that need nothing outside the tree, for example
`npx vitest run tests/admin-vouchers-page.test.tsx tests/privacy-page.test.ts`. You have no
network, so anything touching Postgres is mine to run. I ran, on this commit:

```
npm run typecheck                    -> all projects ✓
npx vitest run (16 files: billing-vouchers, billing-voucher-emails, admin-vouchers-page,
  privacy-page, doc-links, what-the-enter-key-promises, authenticated-api-route-contract,
  db-schema-drift, db-schema, migration-snapshots, migration-journal, migration-digest,
  store-migration-registry, health-migrations, health-schema, client-imports)
                                     -> 16 passed, 750 tests passed
```

Known and accepted: the migration is not applied to the shared local dev database, because
`npm run db:migrate` refused over two ledger rows from other agents' unlanded migrations.

**What I want:** an independent attack. Wrong behaviour in create, replay, patch, readdress and
list; anything in the email (text or HTML) that a hostile or odd name could break, including
header or markup injection and bidirectional or zero-width characters; whether the no-name email
is truly unchanged; whether the tests would fail if the behaviour were broken, or only agree with
the code; the migration against a production table with rows in it; the React form and the Edit
row (does a save send the name only when it changed, does clearing it send null); and whether the
docs and the privacy sentence say what the code does.

Severity, by consequence: **P0** data loss, security, charging, service unusable. **P1**
user-visible wrong behaviour or a contract violated. **P2** design or maintainability risk, no wrong
behaviour today. **P3** prose. Give every finding an ID (`C1`…), a severity, the file and line, and
say for each whether you **fixed** it (and with which test) or are **reporting** it. End with a
one-line verdict: land, land with the fixes made, or do not land.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- The stored value is cleaned by `oneLine` at parse, and the replay comparison compares the stored
  value with the parsed input: is a replay of a name with a control character still `replayed`?
- A name of only spaces, or of 80 characters after trimming but 81 before.
