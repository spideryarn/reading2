# A new output destination bypassed the atomic completion contract

Up: [postmortems.md](../project/postmortems.md)

Review of commit `2a56e2ea8` found a brief route becoming visible before its job ended and
before any Quotes or Ideas generated earlier in the job were published. This was found by
inspection; no reader incident or production impact was established.

## The class: a new output destination bypassed the atomic completion contract

The candidate correctly separated an added brief's route from `article_revisions.skim`, but
implemented that separation by returning `kept-elsewhere` before `StoreSession.commit`.
`skimBriefStore.writeRoute` committed independently, then the walk published the draft through
the skipped-tail ending. A publication failure could therefore leave stops referring to Quotes
that readers could not load. Losing the claim between the two transactions also left a saved
route beside a stored step still marked running: a forced requeue bought the same work again.

The mistaken assumption was that changing the destination changed only the artifact write.
The existing session also owns the completion receipt, claim fence, publication and ending.
Its receipt is executable state: `stillForced` reads the saved step status before spending.
The sibling regression tests in `tests/jobs-walk.test.ts` already defend that receipt for
ordinary revision artifacts; they did not exercise the new destination.

A smaller consequence of mixing existence with freshness was also found: the force bypass
skipped the brief's existence check, so deleting a queued forced brief still bought a route.

## Why the checks missed it

The candidate's brief tests asserted successful output and deletion during a successful model
call. They did not reject publication after output was written or observe the job receipt in
the same transaction as that output. A success-only test could satisfy both the split write and
the required atomic write.

The review added regressions before changing the implementation. **Postgres was unavailable in
the review sandbox, so these tests have not reached assertion-red or assertion-green here.**
They require the author's Postgres run before their behavior counts as evidence.

## The fix and the countermeasures, ranked by ease against value

1. **Keep target selection inside the existing commit boundary.** Implemented:
   `StoreSession.commit` accepts a brief target; `pgStoreSession` writes it in the same
   transaction as publication and the job ending. It opens no revision Skim marker and writes
   no revision Skim artifact. The transaction-bound writer is a leaf shared with the brief
   store. Checking brief existence before honoring force also avoids the deleted-target spend.
2. **Observe output and receipt inside one transaction, then roll it back.** Added to
   `tests/skim-briefs-pg.test.ts`: when a changed brief route exists, its job and step must
   already say done; an injected failure rolls all of them back. A positive completion, distinct
   Quotes and Ideas products, expired-claim refusal and target-preserving retry cover the
   surrounding lifecycle. This is a small test extension of the existing receipt checks.
3. **A separate completion receipt or a compensating cleanup job** was rejected. Both add a
   second protocol for a destination that can participate in the existing short transaction.
   Cleanup would still expose an invalid route between the first write and compensation.

The implemented fix is also the long-term design: destination changes belong within the
transaction that establishes whether the product was kept. A receipt written afterwards is
another output, not an atomic guarantee.
