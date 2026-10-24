# A one-way calibration check cannot prove every derived root is named

Up: [postmortems.md](../project/postmortems.md). Found in code review of
[261024n](../plans/261024n-admin-commands-in-the-command-bar-and-an-author-gift-without-leaving-the-article.md),
before the work was committed. **Nothing reached a reader.** The new dialog was still lazy; the
defect was that the guard meant to keep it lazy would not have noticed a later static import.

## What happened

`CommandBar` dynamically imports `AuthorGiftDialog`, so the eager-graph walk derives it as a new
`ROUTE_ROOT`. The candidate did not add it to the hand-written `ROUTE_PRIVATE` calibration list.
If the dialog later became a static import, it would enter the reader's first download and disappear
from `closure.dynamic`, hence from `ROUTE_ROOTS`. Absent from `ROUTE_PRIVATE` too, neither the
absence check nor the shared-module seam would inspect it. The graph and its calibration would
shrink together and stay green.

The missing assertion was added before the missing list entry:

```text
AssertionError: a derived administrator-only lazy root is absent from ROUTE_PRIVATE ...
expected [ 'src/web/AuthorGiftDialog.tsx' ] to deeply equal []

Test Files  1 failed
Tests       1 failed | 12 passed
```

## The class: a one-way calibration check mistaken for a completeness proof

The comment said “every root itself is here”, but the test proved only
`ROUTE_PRIVATE ⊆ routeClosure.files`: every named item was reachable. It did not prove the claimed
converse, `ROUTE_ROOTS ⊆ ROUTE_PRIVATE`. A new root could be derived correctly, omitted from the
witness and pass. This is the same family as
[a hand-written list that has to stay exhaustive while its source grows](260830c-the-dialog-said-nothing-was-personalised.md),
sharpened here to a directional mistake.

## Which commit introduced it

The missing dialog entry has no introducing commit: it was in the uncommitted worktree after
`13fd49387`. The test hole was introduced by `996237ba8e01880b39e3f8a778896af42d02c29f`
on 2026-10-22, *“the eager-client-graph guard derives every lazy admin route”*. Its red-first probes
made already-named roots unreachable. They proved contraction, not that a new unnamed root would be
caught, while the prose claimed both directions.

## Why nothing went red

- The graph walk found `AuthorGiftDialog` correctly; this was not a parser or resolver hole.
- The seam reports modules shared by the reader and lazy surfaces. A private root is outside that
  intersection, so the seam cannot name this omission.
- Both calibration assertions iterated `ROUTE_PRIVATE`. A file absent from the list was absent from
  their question.
- Earlier mutation tests removed roots the list already named. They exercised only the implemented
  direction.

## What would have caught it, ranked by ease against value

1. **Assert every derived root is named, then add `AuthorGiftDialog` to `ROUTE_PRIVATE`.** Done in
   this review. A later static import now leaves a stale witness entry and the existing reachability
   assertion fails.
2. **When a hand list is described with “every”, write the set direction beside the assertion.**
   Iterating the hand list proves stale entries; iterating the derived source proves omissions.
3. **Split exhaustive roots from representative private dependencies.** Deferred. The new converse
   assertion makes the mixed list safe without adding another list.
4. **Derive the witness from the same closure, or infer it from names.** Rejected. It would disappear
   with the root and recreate the silent success; names and directories do not encode this boundary.

## The fix that is right for the long term

Keep the roots derived from real dynamic imports and the calibration as an independent, readable
witness. Require every derived administrator-only root to be in that witness, and every witness
entry to remain reachable from the derived roots. The opposing assertions close the growth and
contraction forms of the class.

## The thing I would tell myself

I watched the calibration fail when an already named root disappeared and treated that as proof
that every root was named. It proved only that every name still had a root behind it. A check that
starts from the list cannot discover the entry I forgot to add.
