# Review: Stage B — deleting an article must not change what its owner is charged

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently`, branch
`worktree-delete-article-permanently`. TypeScript + ESM, Postgres via Drizzle (schema `spideryarn`),
React web client. **This is a code review of implemented work**, and it is the second look at this
job — you reviewed the plan on 2026-09-06 and refused it.

## The candidate

**Live pre-commit.** Nothing here is committed yet; a `git diff <sha>...HEAD` returns nothing and
that will look exactly like a change with no diff. Read the working tree.

- base: `9f6090c452b6c5a0d51f0e0e2b9b1e0e00000000` is *not* it — use `git rev-parse HEAD`, which is
  the commit titled *"Decision 4 re-confirmed with the cost visible"*.
- scoped paths, modified:
  `src/db/schema.ts`, `src/store/pg-billing.ts`, `src/store/pg-admin.ts`,
  `drizzle/meta/_journal.json`, `docs/project/billing.md`,
  `docs/plans/260906h-delete-an-article-permanently.md`,
  `tests/billing-half-units.test.ts`, `tests/billing-quota-sql.test.ts`,
  `tests/admin-queries.test.ts`, `tests/db-schema.test.ts`
- **untracked, and therefore invisible to any pathspec** — these two are the heart of it:
  `drizzle/20260906193737_ingest_events_freeze_price_at_delete.sql`
  `drizzle/meta/20260906193737_snapshot.json`

`git diff -- <paths>` plus `cat` on the two untracked files is the whole candidate. I will write the
resulting commit SHA into the answer file once it lands.

Start with the migration and `src/store/pg-billing.ts`. That is where to begin, not the limit of
scope.

## What it is meant to do

`ingest_events.article_id` is `ON DELETE SET NULL`, and quota usage is recomputed **live**: a
currently-public article costs half a slot, a private one a full slot. So deleting a public article
turned its charged rows unresolvable, and an unresolvable row is charged full price — the owner's
usage went **up** for throwing something away. `src/db/schema.ts` has carried a note anticipating
exactly this since before the feature existed.

The fix: a nullable `ingest_events.article_visibility_at_delete`, stamped by a `BEFORE DELETE`
trigger on `spideryarn.articles`, read as
`coalesce(a.visibility, e.article_visibility_at_delete, 'private') = 'public'` through one exported
`isPublicPrice` shared by the quota wall and the admin split.

The invariants:

1. **Deleting must not change the bill in either direction.**
2. **Live re-pricing must go on working.** `docs/project/billing.md` requires that sharing an article
   lowers usage and unsharing raises it, *at any time after the charge*. This is the contract your
   own F2 said the first draft broke, so the fix must not have reintroduced it in another shape.
3. **The frozen column must never be a second source of truth** that can disagree with
   `articles.visibility`.
4. **No route may become cheaper to game.** An unresolvable row must stay at full price.

Out of scope: the delete path itself (Stage C, not written), the UI (Stage D), blob deletion
(Stage E), and account-level deletion.

## What you can and cannot run

The tree is read-only; `/tmp` and the node_modules caches are writable. **You have no network, not
even loopback**, so Postgres is unreachable and every test here needs it — do not spend the run
trying. I have run them; the results are below and I watched each new test go red before the fix.

- `npx vitest run tests/billing-half-units.test.ts tests/billing-quota-sql.test.ts tests/admin-queries.test.ts tests/db-schema.test.ts tests/doc-links.test.ts`
  → **5 files, 98 tests, all passing.**
- `npm run check` → all gates green (typecheck, build, full suite, cycles, migration chain).
- **Mutation check, run by me, not by the implementer:** replacing the read with
  `coalesce(${live}, 'private') = 'public'` — i.e. dropping the frozen term — turns **3 tests red**
  across `billing-half-units` and `admin-queries`:
  *falls back to the price frozen at deletion, in both windows*;
  *keeps a deleted public article's rows at half price*;
  *freezes the price at deletion, not at charge: shared after charging, then deleted*.
  Restored afterwards.

## Attack it

Independently, before you read my questions below.

**The invariant to break is the second one: find an ordering in which live re-pricing stops working
— an article shared or unshared after its charge whose usage no longer moves.** Then the first: find
a sequence in which a delete changes what somebody owes.

The trigger is the part I most want attacked. It is a `BEFORE DELETE ... FOR EACH ROW` that issues
an `UPDATE` against `ingest_events` while the article row is being deleted, and the foreign key's
`SET NULL` fires afterwards. Consider: cascades from other tables, a delete inside a larger
transaction, a bulk delete of many articles, an article deleted twice concurrently, and whether
anything can null `article_id` *without* passing through this trigger — in which case the row loses
its price with nowhere to have recorded it.

For each finding give:

- an ID, a severity (P0/P1/P2/P3), and whether it is **established** or **reasoned**
- (a) the input or mutation I can run that shows it fails its own claim
- (b) the smallest change that closes it — the code block or exact replacement wording

**Number new findings from `F7` upward.** F1–F6 are yours from the plan round and are listed below;
reuse an ID only for the same finding.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

A finding with no (a) goes last. Refuse only on an **established** P0 or P1, and name what
established it.

## Previous findings — this is the second pass

| ID | Finding, verbatim | Disposition | What changed |
|----|-------------------|-------------|--------------|
| F1 | refcount-then-remove can corrupt another owner's article | accepted, deferred | Greg chose to build the catalogue. Stage E rewritten; not in this candidate |
| F2 | "stamp at charge time" misprices later sharing changes | **fixed — this candidate is the fix** | Stamped at deletion by trigger, not at charge. `coalesce(live, frozen, 'private')` |
| F3 | deleting a missed active job permanently leaks its billing reservation | accepted | Stage C now refuses on a broad predicate and never deletes an active job. Not in this candidate |
| F4 | enqueue can race the check and resurrect a deleted article | accepted | Stage C must lock the article row in the enqueue transaction. Not in this candidate |
| F5 | storage cleanup incomplete | accepted with F1 | Durable per-class cleanup tasks, Stage E |
| F6 | cache plan leaves deleted data and can make failure reconciliation lie | accepted | `forgetUser`, network-authoritative re-read. Stage D |

Only **F2** is implemented here. Treat the fix as unreviewed code written by someone else, and spend
most of the run on whether it reintroduces the contract it was meant to restore.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

- The trigger fires per row. A reader deleting many articles at once, or a future bulk path, does one
  `UPDATE ... WHERE article_id = OLD.id` per article. I have not thought about lock ordering between
  that update and `lockBillingAccount`, which Stage C will take first.
- `isPublicPrice` takes `SQLWrapper` so one caller can pass a raw `sql` fragment and the other a
  Drizzle column. I am unsure whether that is a good seam or a way to pass the wrong column and have
  it typecheck.
- The `CHECK` allows `null | 'private' | 'public'` and duplicates the constraint on
  `articles.visibility`. If a third visibility is ever added, these two must change together and
  nothing says so.
- drizzle's snapshot knows the column and the CHECK and knows nothing about the function or the
  trigger. The guard is a behavioural test in `tests/db-schema.test.ts`. Say if that is enough.
- No backfill. Rows whose article was deleted *before* this migration keep reading as private, i.e.
  full price. That is the un-gameable direction but it is also, for those readers, the bug staying
  fixed in place. Say if it should be corrected instead, and whether it even can be.

Do not change any file.
