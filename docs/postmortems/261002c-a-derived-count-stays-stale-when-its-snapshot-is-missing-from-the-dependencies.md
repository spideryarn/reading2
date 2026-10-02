# A derived count stays stale when its snapshot is missing from the dependencies

Part D's code review on 2026-10-02 found that archiving a matching article while keeping the
search words unchanged left “No archived article mentions it” beside the search. The write had
succeeded; the count still described the earlier shelf. This was reproduced and fixed in the
review worktree. Production impact was not established.

## The missing dependency of a derived count

The search answer was treated as current when its query and Include archived setting matched.
Those identify the question, but not the article snapshot it was asked against. A successful
archive changes that snapshot without changing either input, so the search effect did not run
again and `Library` kept accepting its previous `archivedArticles`.

Commit `5bae817c568df8042138dd1eb17c62dc0cb0e679`, **“261002b Part D: Include buttons and counts
beside the shelf search's answer (spya-s9fhmw)”**, introduced the visible count and its incomplete
freshness check. The sibling is older: `useLibrarySearch` already left passage results unchanged
after shelf mutations at a fixed query. Part D inherited that lifetime and added a new claim to
it. The class is **a missing dependency of a derived count**: matching request parameters are
mistaken for evidence that the underlying data is still the same.

## Why the existing tests agreed

The count tests covered an initial nonzero answer, zero, and pressing Include archived. Their
shelf remained unchanged, or the chip changed and already triggered a fresh request. None changed
the data while holding the request parameters fixed. Query echo checks and the aborted-request
guard correctly rejected superseded queries; neither invalidated a completed answer after a
successful write.

The added regression first searched `alpha`, observed zero archived matches, then archived the
matching Alpha card without editing the query. Against the original implementation it failed:

```text
FAIL |unit| tests/shelf-archived-in-the-list.test.tsx > the Archived chip > refreshes the archived count when a matching article is archived with the query unchanged
Error: timed out waiting for the updated count
at tests/shelf-archived-in-the-list.test.tsx:219:35
1 failed | 22 skipped
```

The reviewing agent supplied that red output. After the fix, its UI followups passed 62 tests,
then 68 after additional coverage; these are review-time results, not a deployment claim.

## The fix that is right for the long term

Use the existing [`shelfKeyOf`](../../src/web/useShelfTerms.ts) identity, including known archive
edits and reader identity, as an input to [`useLibrarySearch`](../../src/web/useLibrarySearch.ts).
The hook now asks again when that snapshot changes, rejects late answers belonging to the old
snapshot, and suppresses the old state synchronously before its effect starts the replacement
read. This also repairs the related passage freshness defect at this caller. Reading-state
changes that leave the shelf identity unchanged do not cause another search.

This is the review fix, rather than an interim patch. It does not detect database changes that
the mounted shelf has not learned about; freshness is relative to its observed snapshot.

## What would have caught it, ranked by ease against value

1. **Mutate an input dataset while holding the visible query fixed.** The added archive regression
   does this and was observed red before the fix. This costs one focused UI test and checks the
   lifetime of derived results, rather than merely their initial value.
2. **Include data identity in asynchronous result identity.** Reusing the existing shelf key costs
   one additional hook input and closes both the stale count and its passage sibling. Check that
   old results disappear before a replacement request settles; rerunning the effect alone leaves
   a misleading interval.
3. **Refetch after every render or poll continuously — rejected.** This would eventually refresh
   the count, but adds unrelated requests and still leaves stale claims between reads. The missing
   dependency was observable already; another refresh mechanism would obscure it.

The lesson is to ask which data changes can invalidate an answer even when the words in the
search box remain identical. Request parameters alone do not describe a result's lifetime.

See [the Part D plan](../plans/261002b-include-public-chip-on-the-shelf-empty-shelf-help-and-a-phone-banner-on-the-shelf.md#part-d-as-built-after-the-plan-review)
and [postmortems](../project/postmortems.md).
