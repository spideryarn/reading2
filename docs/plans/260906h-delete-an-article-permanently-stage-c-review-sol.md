Refuse. No P0 found, but F20 is an established P1 and violates the “must stay happened” contract.

## Findings

**F20 — P1 — established: a retained terminal job can resurrect the article after deletion**

`retryJob` copies `old.url` or `old.upload` into the new request ([src/jobs.ts](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/jobs.ts:3884)). That makes `requiresArticle` false ([src/jobs.ts](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/jobs.ts:3084)). After deletion, `enqueueIn` therefore inserts the job despite finding no article ([src/store/pg-jobs.ts](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/store/pg-jobs.ts:295)); its worker subsequently calls `lockOrCreateArticle` and recreates the row.

This includes:

- The suspected retry of a re-run: its URL was copied from the article into the original job.
- Retries of failed/cancelled URL ingests.
- Retries of upload ingests.

It is larger than a race: because terminal jobs deliberately survive, the reader can retry one sequentially after deletion.

(a) Add a case that seeds an `error` job with `url`, destroys the article, then calls the exact retry-shaped request with pumping disabled:

```ts
await enqueue({
  slug: SLUG,
  retryOf: oldJobId,
  url: "https://example.test/article",
  steps: ["arc"],
  pump: false,
});
expect(await jobRows()).toHaveLength(0);
```

It currently creates a queued job for the deleted slug. Advancing it recreates `articles`.

(b) Smallest closure: all retries must insist that their original article still exists:

```ts
requiresArticle:
  request.retryOf !== undefined ||
  (!request.url && !request.upload)
```

The 404 then propagates through `withRetrySlot`/`withIngestSlot`, whose `finally` releases any fresh retry reservation, so this does not strand billing.

---

**F21 — P1 — reasoned: fresh URL adoption has the same uncovered race**

`freeSlug` may return `{kind:"adopted"}` because the URL is already on the shelf, but `requiresArticle` is derived from the presence of `request.url`, not from what the allocation means. Therefore:

1. URL lookup adopts existing slug S.
2. Delete S commits.
3. Enqueue locks S, finds nothing, but `requiresArticle === false`.
4. It inserts a non-reserving job for S.
5. The worker recreates S.

The exemption is needed only when adoption came from an active job that has not created an article yet. `SlugAllocation` currently erases the difference between “adopted from shelf” and “adopted from in-flight job.”

(a) Deterministic mutation: add a temporary barrier immediately after allocation at [src/jobs.ts](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/jobs.ts:2997). Start an enqueue for an already-shelved URL, pause there, destroy the article, release the enqueue. It returns a surviving queued job.

(b) Smallest closure: preserve adoption provenance in `SlugAllocation`—minted, adopted from shelf, or adopted from an active reserver. Require the article for shelf adoption; permit absence only for a mint or an adoption backed by a still-active name reserver.

---

**F22 — P2 — established: the retained delete test does not guard most of the cascade**

Schema inspection finds fourteen direct `articles` FKs plus transitive children. The permanent-delete test calls four rows “every child table” but asserts only `article_revisions`, `block_identities`, and `revision_blocks` ([tests/store-shelf-pg.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/tests/store-shelf-pg.test.ts:805)). The fully populated Stage A spike is evidence for today, not a regression guard.

(a) Change `link_summaries_article_id_articles_id_fk` to `ON DELETE NO ACTION` in a scratch database and run the four scoped files: none seeds a link-summary row, so the delete cases remain green. Add one such row and `destroy` fails instead of returning success.

(b) Retain the Stage A fully populated fixture as a test, asserting every expected cascade and every deliberate `SET NULL` survivor. Reuse the schema-derived article-table inventory rather than maintaining another table list.

## Answers to the explicit questions

- The early unlocked read is safe. It takes no row-level lock, grants nothing, and the post-billing-lock `FOR UPDATE` re-read is authoritative. If deletion wins during the gap, the second read returns 404 and the transaction rolls back the billing-row insertion.
- The present F4 tests are not adequate as a whole-system guard. The sequential case proves that `enqueueIn` honors `requiresArticle: true`; it does not prove that callers classify every existing-article enqueue correctly. F20 and F21 are the missed classifications. Keep the SQL lock assertion, but add caller-level tests for retry and shelf adoption.
- Keep both owner predicates. The locked read and `DELETE … where ownedSlug` are independently sufficient by design; the static guard is appropriate evidence for the otherwise unreachable second layer. Removing either would weaken the stated contract.
- Leaving `uploads` is the right Stage C choice because Stage E needs its staging-object mapping. It has no uniqueness/FK collision hazard, but it is not operationally inert: `/add/upload/<id>` becomes a stale redirect, and its retained terminal job exposes F20. Retire the row only after Stage E durably owns or completes cleanup.
- The new enqueue transaction is short: one indexed article lookup/lock plus insertion/classification. Existing-article enqueues serialize briefly, but new minted slugs lock nothing. I found no lock cycle because enqueue takes only `article`; it never subsequently requests `billing_accounts`.
- I found no current state where the article is deleted but `rowCount !== 1` causes a committed 404. A concurrent delete waits on the row lock; a trigger failure or zero-row outcome rolls the transaction back.
- `done`, `error`, and `cancelled` rows are inert against all slug partial indexes, which only cover `queued`/`running`. The remaining ingest-event uniqueness is by reservation ID, not slug. They are index-inert—but `error` and `cancelled` are retryable, so they are not operationally inert because of F20.
- I found no separate F3-style permanently stranded reservation sequence. Active job transitions and reservation settlement share transactions; a retry refused after the proposed F20 fix releases its fresh reservation through the existing `finally`.

No database tests were rerun, per the environment restriction; the refusal is established by the direct retry → ticket → insert → `lockOrCreateArticle` control flow.