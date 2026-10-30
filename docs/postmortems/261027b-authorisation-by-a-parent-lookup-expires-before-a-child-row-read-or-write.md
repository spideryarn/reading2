# Authorisation by a parent lookup expires before a child row read or write

Review of [stage 2 of several Skim briefs](../plans/261027d-several-skim-briefs-per-article-and-a-picker-between-them.md)
found that a transfer could separate a brief request's ownership check from its
read or write. No reader exposure is known; this was found by static review,
not a production report. The correction covers the new brief store. It does
not close the existing transfer residual across other stores.

## The class: authorisation by parent lookup expires before child-row access

Commit `2a56e2ea8` introduced `src/store/pg-skim-briefs.ts`. Its reader-facing
methods first called `articleIdForOwned`, then addressed `skim_briefs` by the
returned article id. That id identifies an article; it does not preserve who
owns it. The write mutex did not repair that: `lockArticleRow` selected by id
without rechecking ownership after waiting.

Two orderings expose the mistake:

- A transfer holds the article lock with its owner change uncommitted. The old
  reader's create sees their committed ownership and waits for the lock. After
  transfer cleanup and commit, the unfiltered lock succeeds and the create
  inserts the old reader's private sentence onto the recipient's article.
- A list or get resolves ownership, then transfer commits and the recipient
  adds a brief. The following child-row query can return the recipient's private
  sentence to the previous reader.

The same write shape was already acknowledged for other stores in
[the transfer plan, D2 and review F1/F7](../plans/261011n-author-gift-link-and-article-ownership-transfer.md),
with broader fencing queued as `qi-3recafqm`. This finding extends that known
class to the new store; it is not evidence that the earlier accepted residual
was secretly fixed. The original job route writer already checked ownership
while locking, so this defect concerns the reader-facing methods.

## Why the existing checks missed it

The candidate's owner-isolation tests started with an article already owned by
someone else. They exercise a failed initial lookup, not ownership changing
after a successful one. Its transfer tests seeded briefs before transfer and
verified deletion. Both assertions can pass while an in-flight request inserts
after cleanup or reads the recipient's later rows.

Regressions were added first in `tests/article-transfer.test.ts`: create waits
behind a real article lock, with `pg_blocking_pids` establishing the wait;
list/get inject the ownership transition immediately after the initial lookup.
The database test attempt was blocked by the environment (`EPERM`). Neither
an assertion failure on the candidate nor a passing database run was observed.
The evidence here is the candidate's predicates and the regression orderings;
the database tests still require execution in a permitted environment.

## The fix and its bounds

`src/store/pg-skim-briefs.ts` now takes the article lock with `ownedSlug` in
the locking query for mutations, including notice dismissal. Its list/get
queries join the article and repeat the owner predicate in the statement that
reads private child rows. Ownership is therefore checked at the operation that
needs it, rather than inferred from an earlier lookup.

The long-term fix applies that property to every owner-scoped child-row access
that can cross transfer. That broader work remains `qi-3recafqm`; changing the
brief store does not establish it elsewhere.

## Countermeasures, ranked by ease against value

1. **Keep the owner predicate in the protected operation.** The local fix does
   this with an owner-filtered lock for writes and an owner join for reads.
   It is a small change with a directly inspectable boundary.
2. **Test a transition after successful authorisation.** The new regressions
   cover both directions of disclosure. Run them against the candidate as well
   as the fix; their discriminating assertions remain unverified here.
3. **Audit sibling stores under the queued transfer work.** This closes the
   wider class, at greater scope than this stage's review.
4. **Reject a blanket transaction around every lookup/read as the answer.**
   Under `READ COMMITTED`, separate statements can still see ownership change;
   a transaction alone does not supply the required predicate or lock.

---

Up: [Postmortems](../project/postmortems.md)
