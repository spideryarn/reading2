**Ready to build.**

Use this predicate while holding the article row lock:

```sql
SELECT 1
FROM jobs j
JOIN article_revisions r ON r.id = j.draft_revision_id
WHERE r.article_id = $article_id
  AND r.status = 'draft'
  AND (
    j.status = 'queued'
    OR (
      j.status = 'running'
      AND j.attempt_id IS NOT NULL
      AND j.lease_expires_at > clock_timestamp()
    )
  )
LIMIT 1;
```

Use the shared `leaseIsLive` expression in Drizzle. A claimed job with no draft is intentionally missed: if deletion owns the article lock first, the job later copies the nulled glossary; if draft opening owns it first, deletion subsequently sees the committed pointer. An expired unswept job is excluded and cannot publish because the same lease boundary fences every write.

Add deterministic cases for queued-with-draft, expired-running-with-draft, and claimed-without-draft.

409 is the right v1. Queueing requires a durable ordered delete operation followed by regeneration; merely waiting on the article lock is insufficient because jobs do not hold it throughout model work.

The in-place update is sound. “No precedent” raises the proof burden but does not require a revision. The protected invariant is published text; this atomic derived-value deletion plus the active-draft guard preserves it without copying every block.

The visibility guard belongs here: same extracted helper, same bug family, negligible scope expansion.

One missed stale comment remains: [pg-revisions.ts](/home/greg/code/spideryarn2/.claude/worktrees/glossary-delete-pg/src/store/pg-revisions.ts:641) repeats the false in-place-writes claim. Also clean up the deleted-importer claim in [pg.ts](/home/greg/code/spideryarn2/.claude/worktrees/glossary-delete-pg/src/store/pg.ts:698) while correcting that commentary.