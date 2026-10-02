# An ownership check ignores the reconciled view after a write

Part D review on 2026-10-02 reproduced an owner's shared article being counted, then shown, as
somebody else's after the owner archived it. The archive succeeded; ownership had not changed.
The bug was fixed in the review worktree. Production impact was not established.

## The class: a consumer bypasses the reconciled view

`Library.ownSlugs` combined the active articles with the raw archived listing. That listing can
be `null` because Include archived has never been enabled. A successful archive removes the
article from the active list and records its server-returned entry in the archive edits overlay.
`useShelf.archivedVisible` reconciles that overlay with the listing, but the ownership check did
not use it. The article disappeared from the ownership set even though the client still held
authoritative evidence that it belonged to this reader.

Part A introduced that ownership set in `f298ef76b`. Part D commit
`5bae817c568df8042138dd1eb17c62dc0cb0e679` introduced the reachable count symptom by starting a
public read for a search and retaining that snapshot for the later Include public section. The
snapshot could still contain the newly archived shared article, so its server-side exclusion of
archived articles was no longer sufficient. The pre-existing ownership projection and the new
snapshot lifetime met at the count.

This is a different failure from [the missing search dependency](261002c-a-derived-count-stays-stale-when-its-snapshot-is-missing-from-the-dependencies.md):
the count recomputed promptly, but from an ownership set that ignored a known successful write.

## Why the tests agreed, and the red evidence

Existing ownership tests started with the shared article present on the active shelf. They did
not move it between lists while the destination listing was unloaded and a public snapshot was
already retained. Checking only that the server omits archived articles also cannot cover a
snapshot taken before the archive.

The added test in [`shelf-include-public.test.tsx`](../../tests/shelf-include-public.test.tsx),
**“still excludes your own shared article after archiving it without loading the archive”**,
first saw no public match for `mine`, archived “Mine, shared”, and checked again at the same
query. The reviewing agent supplied this red result at line 345:

```text
Expected: No public article matches
Received: Checking the archive… Include archived1 public article matches by title, author, site or description. Include public
```

## The fix and ranked countermeasures

The review fix changes `ownSlugs` to combine active articles with
[`shelf.archivedVisible`](../../src/web/useShelf.ts), and makes that reconciled view its memo
dependency. Both the count and the section consume the same ownership set. This is the long-term
fix: use the source that already includes successful mutations rather than reconstructing an
incomplete alternative.

1. **Test a successful move while the destination listing is absent.** The regression was observed
   red, then passed after the fix. It also presses Include public, checks that the owned card stays
   excluded, and verifies that the retained listing was not fetched again. One focused test covers
   both consumers and the lifetime that exposed the defect.
2. **Inspect consumers of raw snapshots when a reconciled view exists.** The ownership set and
   visible shelf represented the same known articles differently. Reusing the existing view costs
   one source substitution and prevents the projection from forgetting successful writes.
3. **Always load the archive or refresh the public listing after every archive — rejected.** Both
   add requests to recover evidence already held locally. A late response can recreate the same
   gap; neither fixes the ownership projection itself.

See [postmortems](../project/postmortems.md) and
[the Part D plan](../plans/261002b-include-public-chip-on-the-shelf-empty-shelf-help-and-a-phone-banner-on-the-shelf.md#part-d-as-built-after-the-plan-review).
