# Review: stage T-C, the lane manifest and the tail of state-assuming tests

You are reviewing **built code**. Weight this higher than a plan-stage review: a plan review cannot
find a guard that vouches for the empty set.

## What this is for

`docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md` deletes the
`SPIDERYARN_STORE` flag and the filesystem store. It absorbed
`docs/plans/260903e-a-private-test-database-so-the-suite-stops-racing-dev-servers.md` as stage T.
**Read 260903e § Stage C — it is the spec** — and your own earlier review of that plan,
`…-review-sol.md`. T-B (the database factory) is landed and reviewed:
`docs/plans/260903f-test-database-factory-review-sol.md`, which was yours.

**This stage is still opt-in and changes no default behaviour.** Three disjoint vitest projects and
the wiring into `npm test` are **T-D**, deliberately after this.

## The files

- `tests/store-migration-registry.ts` — stage A's store inventory (~94 entries, untouched by this
  stage) **plus** the new `TEST_LANES` (93 entries) and `UNSEEDED_OWNER_EXCEPTIONS` (9).
- `tests/store-migration-registry.test.ts` — stage A's guard, with three new cases appended.
- `tests/helpers/seed-local-accounts.ts` + `tests/seed-local-accounts.test.ts` — new.
- `tests/setup/spike-db.ts`, `tests/admin-feedback-store.test.ts` — modified.
- The plan doc.

## Context about this box

One local Supabase shared by every worktree and every other agent; no staging copy. Two Supabase
stacks on the host, on different ports. `.env.local` is applied **over** `process.env`. A red batch
of Postgres suites here is usually contention rather than a regression — re-run a file alone before
believing it.

## The headline finding, which I want you to attack

**54 of the 76 suites that ran against a bare clone went red, and 49 were one cause:**

```
insert or update on table "articles" violates foreign key constraint "articles_owner_fk"
Key (owner_id)=(f4d08b58-…) is not present in table "users".
```

That id is the **ambient owner** — what `currentOwnerId()` answers outside a request, from
`SPIDERYARN_OWNER_ID` — which `db:seed-owner` put in the shared database weeks ago and which ~50
suites have been borrowing without ever naming it.

The fix is one helper, `seedLocalAccounts`, rather than fifty calls to `seedAuthUser`. Its stated
reasoning: fifty copies of one fact would drift separately and bury the genuinely interesting
dependencies under fifty that are not. Its ids are **derived from `SEEDED_ACCOUNTS` in
`scripts/seed-accounts.ts`** rather than hand-copied, with the ambient owner added on top rather
than assumed to be in it.

Claimed proof that it is one cause: the three files 260903e named (`store-checkpoints`,
`store-artefacts-pg`, `blocks-baseline`) went red→green **with no edit to any of them**. After the
helper, 86 of 91 green.

Questions I most want answered:

1. **Is "one cause" right, or is it one *symptom* with several causes?** Fifty suites depending on an
   ambient row is itself a finding about the suite; does papering it into the lane hide something
   that should have been fixed in the code instead? Argue the other side of the fifty-edits decision.
2. **The stated cost is that a private database is no longer a bare clone**, so no suite can use it
   to prove "this works with no accounts at all". Is that cost bigger than it looks — does any
   *existing* suite's oracle silently depend on emptiness?
3. **`environmentOwnerId` is read at seed time.** On a machine whose `SPIDERYARN_OWNER_ID` differs
   from this one's, does this still do the right thing, and does it fail loudly if not?

## Two corrections T-C made to your earlier review, which I want checked

1. **Your proposed static scan misses the commonest case.** Of the 54 bare-clone reds, only 20 carry
   any of `DEV_OWNER_ID`, `ADMIN_USER_ID_LOCAL`, `auth.users`, `SUPABASE_URL`, `blobStore` or
   `new Pool`; **34 do not**, and 19 of those use `currentOwnerId()`, which names no id at all. So
   the scan as proposed would have vouched silently for most of the tail. Is that account right?
2. **"Every fixed owner must call `seedAuthUser` or be declared" is unusable literally** — it
   produces 50 identical declarations. The narrower rule built instead: the *lane* provides the
   accounts a local database is expected to have, and the guard covers only what it cannot, i.e. a
   **literal uuid on an owner line** (20 files, 9 declared exceptions). Is the narrower rule
   sufficient, or does it now miss a class the broad one caught?

Also: `new Pool` alone misses two files that use `new Client`; `admin-store`'s shared-lane reason in
260903e is wrong (a clone does *not* yield no accounts — they come from GoTrue over HTTP, so its
control still fires while every aggregate beside them is `?? 0`); and the shared lane has a fourth
member, `db-test-create`, chosen by contract rather than by a red.

## What I want from you

**Please run things — your sandbox allows it, and a finding you reproduced outranks one you reasoned
to.** `npx vitest run tests/store-migration-registry.test.ts` needs no database. The factory needs
docker and the local stack; if you cannot reach them, say so plainly rather than inferring.

Ranked by worry:

1. **Are the two completeness guards vacuous in any direction?** Every assertion in them is a set
   difference, and a set difference over an empty scan is green. The universe predicate is
   *code lines* (comments stripped) containing `pgReady(`, `new Pool(` or `new Client(`. What does
   that predicate miss — a helper that opens a connection on the suite's behalf, a dynamic import, a
   transitive `getDb()`?
2. **Lane assignments.** 89 `private-postgres`, 4 `shared-services` (`auth-user-seeding`,
   `seed-admin-signin`, `admin-store`, `db-test-create`). Is any of the 89 actually shared-lane —
   i.e. does its oracle depend on state only the shared stack has? Note `store-realtime-sessions` was
   deliberately **excluded** from the shared lane against 260903e's original list, verified green on
   a private database.
3. **The two remaining red shapes**, catalogued rather than fixed: `billing_tiers.stripe_price_id` is
   NULL in a clone (25 failing tests across three files — the tiers come from a migration, the price
   ids from `stripe-setup.ts --apply`), and boundary arithmetic that was only non-degenerate because
   a table was not empty (`admin-feedback-store`, fixed). Is deferring the Stripe family right, and
   is the proposed fix — backfill a fake price id **only when null**, because until T-D these run
   against the shared `postgres` where the id is real — safe?
4. **The 9 declared exceptions.** Each is a file with a literal owner uuid that deliberately does not
   seed. Read the reasons: is any of them wrong, and does any of them hide a test that would pass for
   a second reason? (One reason explicitly worries about this: an export 404 arriving because the
   owner does not exist rather than because they do not own the article.)
5. Anything you would not ship.

Say which findings you reproduced versus reasoned to, and which you are confident in. Some will be
wrong and I will check each one.
