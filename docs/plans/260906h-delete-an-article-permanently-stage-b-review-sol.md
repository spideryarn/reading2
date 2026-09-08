No refusal: I found no established P0/P1. The supported lifecycle preserves live repricing and freezes the correct value at deletion. I found three P2 schema risks.

### F7 — P2 — established: deletion performs unindexed ledger scans

The trigger searches `ingest_events.article_id` at [migration line 56](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/drizzle/20260906193737_ingest_events_freeze_price_at_delete.sql:56), but the table has only the owner/reservation index at [schema line 4418](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/db/schema.ts:4418). PostgreSQL does not automatically index the referencing side of a foreign key.

Consequently each article deletion scans the unbounded ledger for the trigger’s `UPDATE`, then the `ON DELETE SET NULL` action must find the same children. A bulk deletion repeats that work per article. The eventual failure is deletion exceeding the runtime role’s two-minute statement timeout.

(a) Run on the local database:

```sql
select indexname, indexdef
from pg_indexes
where schemaname = 'spideryarn'
  and tablename = 'ingest_events';

begin;
set local enable_seqscan = off;
explain (costs off)
update spideryarn.ingest_events
set article_visibility_at_delete = article_visibility_at_delete
where article_id = '<an article uuid>';
rollback;
```

There is no `article_id` index, and the plan has no index-backed lookup available.

(b) Smallest fix:

```sql
CREATE INDEX "ingest_events_article_id_live"
ON "spideryarn"."ingest_events" ("article_id")
WHERE "article_id" IS NOT NULL;
```

And in `schema.ts`:

```ts
index("ingest_events_article_id_live")
  .on(t.articleId)
  .where(sql`${t.articleId} is not null`),
```

The partial form avoids indexing legacy/deleted rows that can never match the trigger.

### F8 — P2 — established: `article_id` can be nulled without freezing its price

The foreign-key path is safe, but the database permits an ordinary `UPDATE ingest_events SET article_id = NULL`. No current TypeScript production path does this, so this is not presently user-reachable; nevertheless it is precisely a way to lose the price without passing through the article trigger. A linked public charge immediately becomes full-price.

(a) Add this after creating a public charged event in `billing-half-units.test.ts`:

```ts
expect(halfUnitsUsed(await usageFor(OWNER, FREE))).toBe(PUBLIC_INGEST_COST);

await pool.query(
  "update spideryarn.ingest_events set article_id = null where id = $1",
  [eventId],
);

expect(halfUnitsUsed(await usageFor(OWNER, FREE))).toBe(PRIVATE_INGEST_COST);
```

It changes from one half-unit to two.

(b) Smallest fail-safe is a child-table trigger that rejects a non-null → null transition unless the price has already been frozen:

```sql
CREATE FUNCTION spideryarn.ingest_events_require_price_on_unlink()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.article_id IS NOT NULL
     AND NEW.article_id IS NULL
     AND NEW.article_visibility_at_delete IS NULL THEN
    RAISE EXCEPTION 'ingest event cannot lose article_id without a frozen price'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ingest_events_require_price_on_unlink
BEFORE UPDATE OF article_id ON spideryarn.ingest_events
FOR EACH ROW
EXECUTE FUNCTION spideryarn.ingest_events_require_price_on_unlink();
```

The existing deletion sequence passes because its article trigger stamps first. If that trigger later disappears through drift, deletion fails loudly instead of silently changing the bill.

### F9 — P2 — established: “not a second source of truth” is tested but not enforced

The CHECK at [schema line 4412](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/db/schema.ts:4412) restricts the vocabulary only. It permits a live public article’s event to carry frozen `"private"` simultaneously. The test at [billing-half-units line 399](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/tests/billing-half-units.test.ts:399) proves current application paths do not do this; it does not prove the declared database invariant.

The live value still wins, so this causes no wrong bill today. It is a maintainability risk because a future writer can create the forbidden state successfully.

(a) This currently succeeds:

```sql
update spideryarn.ingest_events
set article_visibility_at_delete = 'private'
where article_id = '<a public article uuid>';

select a.visibility, e.article_visibility_at_delete
from spideryarn.ingest_events e
join spideryarn.articles a on a.id = e.article_id
where e.article_id = '<the same uuid>';
-- public | private
```

(b) Make the article trigger unlink and freeze atomically:

```sql
UPDATE spideryarn.ingest_events
SET article_visibility_at_delete = OLD.visibility,
    article_id = NULL
WHERE article_id = OLD.id;
```

Then add:

```sql
ALTER TABLE spideryarn.ingest_events
ADD CONSTRAINT ingest_events_frozen_only_after_unlink
CHECK (
  article_id IS NULL
  OR article_visibility_at_delete IS NULL
);
```

This makes the documented state distinction enforceable. It composes with F8’s guard because the trigger supplies the frozen value during the unlink.

### Ordering conclusions

I could not break either charging invariant through supported operations:

- Concurrent visibility changes and deletion serialize on the article row; the deleting trigger sees the winning committed visibility.
- Concurrent settlement cannot attach a row in the trigger/FK gap: the foreign-key key-share lock and article deletion lock serialize the operations.
- A rolled-back deletion rolls back the stamp.
- Bulk and cascaded deletes fire the row trigger for each article.
- Two concurrent deletes result in one successful trigger execution and one zero-row deletion.
- I found no reverse lock path that completes a deadlock cycle with Stage C’s billing-account → article → ledger order. F7 does, however, unnecessarily lengthen those lock holds.

The other suspicions do not rise to findings:

- `SQLWrapper` is broad, but both current call sites’ complete generated predicates are tested.
- A third visibility requires an explicit billing decision anyway; the duplicated CHECK makes omission fail loudly at deletion rather than silently misprice.
- The behavioural database test is an adequate trigger-drift guard when run against a freshly migrated database.
- No safe backfill exists for already-deleted rows: their article identity is gone and slug is mutable. Keeping them full-price is the only non-gameable answer.