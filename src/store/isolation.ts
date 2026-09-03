/**
 * **The isolation level every store transaction asks for, in one place.**
 *
 * A leaf on purpose: it imports nothing, so `pg-jobs.ts` and `pg-visibility.ts`
 * can have it without inheriting the read layer that `pg.ts` drags in behind
 * `src/api.ts`. That is the same reason `ownedSlug` moved to
 * [owned-slug.ts](owned-slug.ts) — see the note in [pg.ts](pg.ts).
 *
 * ## Why a transaction has to say this rather than inherit it
 *
 * `read committed` is PostgreSQL's default, so on an ordinary database naming it
 * changes nothing. It is written into the `begin` because the correctness of
 * what happens inside *depends* on it, and a `default_transaction_isolation` set
 * on the role or the database takes it away **silently**: nothing errors,
 * nothing fails on a laptop, and the failure arrives in production as a first
 * ingest that cannot write its document.
 *
 * Two shapes inside want it, and both are **insert conflict-tolerantly, then
 * read what you waited for**:
 *
 * - `writeRawSource` (src/store/artifacts-pg.ts) inserts `on conflict do
 *   nothing` into `raw_sources` and reads the row back to compare it.
 * - `lockOrCreateArticle` (src/store/pg-revisions.ts) does the same shape for
 *   the `articles` row: `on conflict do nothing`, then re-read.
 *
 * **What actually goes wrong is not the read back.** Measured rather than
 * reasoned about, 2026-09-01: at `repeatable read` an `insert … on conflict do
 * nothing` that meets a conflicting row from outside its own snapshot raises
 * `40001 could not serialize access due to concurrent update` at the *insert*,
 * whichever order the two transactions arrive in — waiting for an uncommitted
 * writer and finding an already-committed one both do it. So the read back is
 * never reached, and `do nothing` is not the escape at `repeatable read` that it
 * is at `read committed`.
 *
 * The outcome is the one the pin is for, and it is the worse one: **nothing in
 * `src/` catches or retries `40001`**, so the serialization failure aborts the
 * whole transaction and reaches the reader through `guardDbStore` as *"could not
 * reach its database just then … usually a moment's trouble"*, which is a lie
 * about something that would happen every time two readers add the same new
 * document at once. That is
 * docs/postmortems/260901f-a-for-update-that-locks-nothing.md arriving through a
 * different door.
 *
 * ## Why every transaction and not only the two that provably need it
 *
 * Until 2026-09-03 four transactions pinned and seventeen inherited, and picking
 * out the ones that "depend on the level" is a judgement each new author would
 * have to make again, correctly, about code they are writing for the first time.
 * The cost of naming it is one argument; the cost of getting the judgement wrong
 * is a class of failure that cannot happen on a laptop. So the rule is: **a
 * transaction in this store names its level**, and
 * tests/store-transaction-isolation.test.ts is what says so to the author of the
 * next one. docs/project/sql.md, and
 * docs/plans/260903a-improve-the-codebase-sweep.md § T1.3.
 *
 * `article-rows.ts` § `SNAPSHOT` is the one deliberate exception and stays
 * different: it wants one consistent picture of a whole article for an export,
 * which is what `repeatable read` is actually for.
 *
 * ## Proved, not asserted
 *
 * tests/store-session-isolation.test.ts drives the real `commit` down a
 * connection whose `default_transaction_isolation` is `repeatable read` and asks
 * the transaction itself what level it got. A test that merely checked an option
 * was passed would not survive a refactor, and one that asserted `read
 * committed` against a laptop would agree with the bug.
 */
export const READ_COMMITTED = { isolationLevel: "read committed" } as const;
