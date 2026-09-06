# Claims shipped filesystem-only, and returned 501 in production

**2026-09-01.** Referee mode's Claims sub-mode was built, tested, reviewed, browser-checked and
committed, and it could not run in the only configuration it deploys in. Every test passed
throughout.

## What happened

Claims stores one run per article. It got a filesystem store —
`src/referee-claims-store.ts`, writing
`data/<slug>/referee-claims.json` — and no Postgres one. Under `SPIDERYARN_STORE=postgres` every
method refused through `notMigrated` with a 501.

Production has run `SPIDERYARN_STORE=postgres` since 2026-08-27. So on the deployed app, *"Pull the
paper's claims"* could not load a run, start one, or persist one.

It was found by a cross-family code review
([260831an-referee-mode-submodes-review-sol.md](../plans/260831an-referee-mode-submodes-review-sol.md),
finding 4), roughly four hours after the commit.

## The real cause

**Not the missing adapter.** That was a decision, taken deliberately and written down at the time in
[`src/store/contracts.ts`](../../src/store/contracts.ts) § `RefereeClaimsStore`, with two arguments
behind it. One was good and is still true: Claims' real home is a pipeline artefact, so a bespoke
table is one migration to a place already known to be wrong. The other was the blocking one:
`src/store/export.ts` was being rewritten by another session, and the export-coverage guard that had
landed hours earlier requires every article-scoped table to declare where it is exported. A table
could therefore only have landed *without* that entry — which is the exact shape of the bug that
guard was built for, two days earlier, when `referee_criteria` was dropped silently from every export
for a day.

So the decision was defensible on the day. **The cause is that nothing made its consequence
visible.** Specifically:

1. **`SPIDERYARN_STORE` unset means `files`** ([`src/store/live.ts`](../../src/store/live.ts)), so
   every test, every local run and every browser pass exercised the configuration that is not
   deployed.
2. **No test asserts that a store has both implementations.** `notMigrated` is a deliberate, loud,
   *runtime* refusal — and a refusal nothing ever calls is silent.
3. **`tests/store-parity.test.ts`**, which calls itself *"the test the whole migration rests on"*,
   covers comments, chat, searches and identities. It contains the string `referee` zero times, and
   has done since Criteria got its second implementation on 2026-08-31.

## Why the usual nets did not catch it

- **Unit tests**: passed, on files.
- **Route tests**: passed, on files. The 501 is reachable through `POST /api/referee/claims/:slug`
  and no route test runs against Postgres.
- **A browser pass**: passed. The dev server runs on the default too.
- **Typecheck**: cannot see it. `notMigrated` returns `never` and satisfies the interface, which is
  the point of it.

This is the same shape as the three other bugs found in this feature in two days — a check reporting
success while sharing an assumption with the code
([silent-success.md](../reusable/silent-success.md)). Here the shared assumption was the store.

## The fix that is right for the long term

Not "remember to write the adapter". Three things, in
[260901f](../plans/260901f-referee-mode-on-the-database-and-the-parity-that-would-have-caught-it.md):

1. **The Postgres store**, with its export-coverage entry — the immediate repair, and now possible
   because the reason it was not is gone.
2. **A parity suite for the Referee stores**, so two implementations that disagree are a red test
   rather than a production 501. This is what would have caught it, and it would have caught it on
   the day Criteria landed too.
3. **The default**: [AGENTS.md](../../AGENTS.md) now tells every agent to develop with
   `SPIDERYARN_STORE=postgres`, because the deeper fix — flipping the default — belongs to
   [260831b](../plans/260831b-finish-the-database-move.md) and is mid-flight.

## What would have caught the whole class

**A test that enumerates the store seams and asserts each has two implementations**, derived from
the contract rather than from a list somebody maintains — the same move
`tests/store-export-covers-tables.test.ts` makes for tables, which was written the day before this
and would have caught this if it had been pointed at stores instead of tables. A `notMigrated` that
is a deliberate, documented choice would then have to say so in a place the test reads, rather than
being indistinguishable from one nobody has got to yet.
