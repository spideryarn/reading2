# Stage 1 launch protocol review — findings

Review target: commit `25bd82bf` (committed bytes only).

## F14 — P1 — established: interior blank journal records are silently erased before replay

Both stores read the journal with `split("\\n").filter((line) => line !== "")`
(`launch-store.ts:115`, `launch-admission.ts:355`). That removes an interior blank
record before either exact parser sees it. Therefore a journal such as
`<valid planned>\\n\\n<valid reserved>\\n` opens `whole`, although its second
record cannot be parsed at all. This violates F11 and the explicit gate that a journal
must replay whole and legally before it licenses launches. The same defect exists in
the admission journal, where an erased record can hide the point at which reservation
history became unknowable.

(a) Run an otherwise-valid store test that inserts one empty line between two valid
records, closes and reopens, then assert `status().kind === "history-lost"` and that
`plan()`/`reserve()` refuses. It currently reports `whole` in both stores. A direct
shell reproduction is to take either passing persisted-journal fixture, replace the
first newline with two newlines, and reopen it.

(b) Split without filtering: remove only the one trailing element created by a final
newline, and pass every interior element (including `""`) to replay. Add this case to
both store suites.

## F15 — P1 — established: history reset inventories artefact-only occurrences but allows them to launch again

`LaunchStore.resetHistory()` puts parseable journal IDs and owner-held IDs into
`carried`, but puts IDs found only under `launches/o/` into the separate
`artefactDirs` diagnostic list (`launch-store.ts:203-227`). Replay does nothing with
that list (`launch-protocol.ts:575-584`), while `plan()` refuses only IDs in
`fold.carried` (`launch-protocol.ts:1119-1123`). Thus an occurrence whose records are
behind the hole and whose reservation has already been released is visible through
its artefact directory but is permitted to become a fresh occurrence after reset.
Its attempt numbering restarts at `a1`, so any old correlation-bound `exit.json` can
also make reconciliation release the new reservation while the second child runs.
Even without that stale-exit consequence, invoking the launcher again already breaks
the core at-most-once-after-ambiguity invariant.

(a) Launch an occurrence far enough to create `o/<id>/a1`, then release its owner
reservation; replace/hide all parseable launch records for that ID behind a malformed
first journal line; reopen and resolve history. Assert the reset lists the ID in
`artefactDirs` but not `carried`, then call `launchOccurrence()` for the same origin.
It currently plans and invokes `a1` again. The existing hidden-occurrence F2 test does
not expose this because its owner still holds the occurrence's reservation, which
incidentally puts the ID into `carried`.

(b) Union every valid ID found in `launches/o/` into the reset's `carried` entries
(`lastSeen: null`, and the inventoried owner slot if any), rather than recording those
IDs only as inert diagnostics. Add the artefact-only/no-owner-held reset regression.
