# Longer lived results need a generation boundary

Caught in the built-code review of [261004b](../plans/261004b-citation-hover-card-offers-dig-deeper.md).
The article's Citations read could retain a failed Dig deeper or a no-match note after a replacement
list arrived while the band was closed. Reopening the band drew the old message on a retained work
id. This review made no production changes; reader impact was not measured.

## State lifetime expanded without result invalidation

Commit `e5be1f9fc24118d86e9cc1ea08a832be31c35866` moved the investigation state from the band into
`useCitationsRead`, to let a prose card start it in any mode. The stream correctly outlived the band.
Its completed local results did too, but they carried only a work id. Regeneration deliberately
inherits that id; it does not mean the old press describes the replacement reference or passages.

`useCitationsRead` accepted a fresh list without clearing these results; `CitationsPanel` joined them
to rows by id. The independent root-cause subagent confirmed that `investigationViewOf` hides a
failure only when a newer stored investigation exists. A replacement row with no such answer still
drew the old failure. The old code could already retain results if the band stayed open throughout
regeneration; this commit extended the hazard to a closed band and later re-entry.

## Why the existing checks missed it

The added lifecycle tests proved that closing the band preserved a draft and that the standalone
read could start a dig. Neither replaced the list while retaining its work id. The plan review
explicitly anticipated persistent failure and no-match state, but did not require a generation
boundary for those messages.

The two new regressions failed before the fix: **1 file, 20 tests; 2 failed, 18 passed**, with
`a replaced list inherited a failure about the old list` and
`a replaced list inherited a no-match note about the old reference`.

## The fix

`useCitationsRead` now clears completed failure and no-match state when the list's `generatedAt`
changes. Ordinary reconciliation reads keep that timestamp and preserve their result. An active
stream keeps its draft and admission; if the list changed during it, its old terminal messages are
cleared when it ends. This also prevents an old press's late failure from branding the new row.

This is the intended lasting fix for these local messages. Stored investigations and lookups keep
their existing server-side attachment rules. There is no new client fingerprint or alternate
attachment authority.

The final targeted run passed **2 files, 27 tests** (`citations-investigate-client` and
`citations-find-late-reply`). It covers closed-band replacement, an old press failing after
replacement, admission after band remount, and a reused read changing slug before late stream frames.

## What would catch the class, ranked by cost against value

1. **Replace the underlying artefact while retaining the addressed id in lifecycle tests.** Done
   here. It exposes results whose lifetime now exceeds the validity of their input, at the cost of
   a few controlled renders and one revalidation.
2. **When lifting state, name both its mount boundary and its data boundary.** Cheap review work:
   list replacement is distinct from leaving a panel or leaving the article. Preserving an id is
   not evidence that its contextual result is still applicable.
3. **Give every local result a new client context fingerprint.** Rejected here: the server already
   owns derived attachment checks, and a generation boundary suffices for these local terminal
   messages. Duplicating those checks would add a second authority without improving this fix.

Up: [postmortems.md](../project/postmortems.md)
