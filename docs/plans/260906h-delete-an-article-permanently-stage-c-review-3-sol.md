| Question | Verdict |
|---|---|
| 1. Guard closes F40/F41 resurrection window | **Holds.** The retry/holder row lock serializes with `destroy`; existence-only is sound because terminal status is absorbing. |
| 2. Guard permits legitimate work | **F50 — P1, established.** |
| 3. F42 guard covers stranded reservations | **Holds.** Both-null is precisely unsettled; either timestamp being non-null is settled. An already-deleted job is already stranded elsewhere, not stranded by this deletion. |
| 4. Stranger-controlled refusal | **Holds.** Job selection is owner-scoped, and the composite job/reservation foreign key enforces the same owner. |

**F50 — P1, established: a publishing holder can be refused because `articleExists` is stale.**

At [`pg-jobs.ts:436`](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/store/pg-jobs.ts:436):

1. A second paste adopts an active queue holder while no article exists.
2. `lockArticleFor` finds no row, locks nothing, and records `articleExists = false`.
3. Before [`lockAdoptedHolder`](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/store/pg-jobs.ts:415) runs, the holder creates and publishes the article, becomes terminal, and commits.
4. The holder query excludes that terminal row, and line 416 throws 409 using the stale article result—even though the article now exists and the paste is legitimate.

The positive control starts with `givenArticle()` at [`article-delete-pg.test.ts:835`](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/tests/article-delete-pg.test.ts:835), so it does not exercise this interleaving.

Smallest safe change: when the active-holder lookup misses, restart `enqueueIn` once in a fresh transaction, releasing any job locks and repeating the article-first lookup. If the fresh transaction still finds neither article nor active holder, return the 409. Do not simply acquire the article lock after the holder query; that reverses `destroy`’s article→job lock order.