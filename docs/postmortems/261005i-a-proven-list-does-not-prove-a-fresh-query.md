# A proven list does not prove a fresh query

Up: [postmortems.md](../project/postmortems.md). Work:
[261005j](../plans/261005j-draft-sweep-deletes-and-the-count-mode-goes.md).

The draft-backlog code review on 2026-10-05 found that its independent safety proof did not cover
the rows its deletion function could actually delete. The new script was still untracked and
uncommitted; no production deletion was run in this review. The production dry run recorded in the
plan demonstrated a clean snapshot, not a safe later deletion.

## What happened

`surveyDraftBacklog` selected revision ids and independently checked their protections. Its return
value kept article ids and counts, discarding the revision ids. `deleteDraftBacklog` accepted those
article ids and called the sweep with no restriction on revision identity. A revision that crossed
the six-hour threshold, lost its job pointer, or was inserted with an old timestamp after the survey
could therefore be deleted without appearing in the independent proof.

The lineage count had the same shape at a smaller boundary. `proveUnprotected` counted a parent
only when its child was outside the entire surveyed id list:

```sql
c.based_on_revision_id = r.id and c.id not in (<all surveyed ids>)
```

But deletion committed one batch at a time and skipped locked revisions. A surveyed child could
survive because it was locked or belonged to a later batch while its parent was deleted. The
`ON DELETE SET NULL` foreign key would then erase the surviving child's recorded base. A child
introduced after the survey was also absent from the old proof. Normal draft minting uses a
published base, so these lineage states are defensive cases; the script explicitly claimed to
check them rather than relying on normal minting.

These are source-derived counterexamples, not observed database reproductions. Local database
connections in the review sandbox were refused with `EPERM`; the focused integration suite could
not establish red or green results here.

## The class: evidence belongs to the exact set that is changed

The proof was treated as permission for a container—the article—rather than evidence about a
specific set of revision ids. Reusing the application sweep looked safer because it rechecked
eligibility under locks, but that recheck did not include the independent lineage check. Correct
locking cannot transfer a proof from one query's results to another query's results.

The two instances are the survey-to-delete boundary and the whole-list-to-batch boundary. In both,
the checked set and the changed set could differ while all ordinary protection checks agreed.

## Why the existing checks could agree

The integration case named “deletes exactly that list” surveyed a static fixture, then passed only
its article ids to deletion. Nothing changed between those operations, so a fresh query returned
the same rows by coincidence. The lineage refusal case used a young child outside the candidate
list; it did not exercise a child inside the surveyed list but outside the batch actually deleted.
Testing the independent query with deliberately protected ids established its individual counts,
but did not establish that deletion consumed those same ids.

**Introduced by:** the uncommitted Stage 2 implementation of
`scripts/draft-sweep-backlog.ts` for plan 261005j. There is no introducing commit SHA: the file is
untracked, and `git log -S 'deleteDraftBacklog' --all` found no committed version of this function.
The per-article application's existing lock-and-recheck sweep did not introduce this gap.

## The fix that is right for the long term

Keep the surveyed revision ids through the destructive API boundary. Process that finite set in
bounded chunks, and constrain the shared sweep to those ids. Within each article transaction,
lock the eligible chunk with `FOR UPDATE SKIP LOCKED`, independently prove the actual locked set,
and fail closed before deletion if the proof disagrees. The lineage query must exclude only the
rows this transaction will delete; every other child is a survivor for this check. Parent row
locks also block a new child's foreign-key protection from committing between proof and deletion.

This preserves the application's sweep and its concurrency protections while binding the extra
one-off proof to its action. A finite input also bounds the loop when other work creates candidates.
The review is implementing this correction; runtime verification still needs a machine able to
reach the local database.

## What would have caught it, ranked by ease against value

1. **Keep exact checked identities in the destructive function's input.** A small API change makes
   the proof/action relationship reviewable and prevents unrestricted re-enumeration. Being done
   in this review, with a locked-batch proof before the write.
2. **Change the set between checking and acting in a regression test.** Add a newly eligible row,
   then ensure it survives deletion of the original surveyed set. Add a candidate child outside
   the deletable batch and ensure its base cannot be deleted. These target both boundaries and
   are cheap once the existing database fixture is available; their execution is blocked here.
3. **One transaction and one whole-library lock set — rejected.** It could keep a global snapshot
   aligned with a global delete, but would hold locks across articles and charge readers for the
   entire backlog. Exact ids plus short transactions provide the needed boundary without that
   cost.

The question I should ask when a destructive operation follows a proof is whether its API still
carries the identities that earned the proof. An article id and a clean count cannot answer that.
