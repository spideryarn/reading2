Yes—the anchor deletion is the right call. From arbitrary two snapshots, edited-in-place and replaced-at-the-same-anchor are indistinguishable. It cannot be made generally safe without an immutable publisher identity or external edit history. An ordinary author anchor can safely veto continuity, but cannot prove it.

Verdict: **BLOCKED**, for a separate migration-bridge failure.

## Blocker

The bridge is syntactically one-way, but not migration-only. Its bucket accepts every unstamped previous block ([src/blocks.ts:687](/Users/greg/Dropbox/dev/experim/spideryarn2/src/blocks.ts:687)); ordinary paragraphs remain unstamped forever.

I reproduced this across two already-canonicalised snapshots:

- Previous: ordinary `<p>Alpha1</p>`, id X.
- Current: new `<p>Alpha<footnote-marker>1</p>`.
- The ordinary paragraph was removed.
- `legacyKey` matched the identical raw text and assigned X to the new footnoted passage.

Thus a reader comment moves onto changed content. Both snapshots also contained an unchanged stamped footnote, proving this was not the stage-2 migration.

The existing test only proves the fallback cannot reach a stamped block ([note-carry-over.test.ts:389](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/note-carry-over.test.ts:389)). It does not distinguish legacy unstamped footnote blocks from permanently unstamped ordinary blocks.

A safe bridge needs explicit article/revision metadata saying the previous blocks predate canonicalisation—or a one-off migration. Absence of per-block stamps cannot prove that.

## Other answers

- The accepted limitation is honestly documented at [260828o-footnotes.md:1252](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260828o-footnotes.md:1252).
- One half-removal remains: [note-carry-over.test.ts:327](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/note-carry-over.test.ts:327) still says stage 2 “now keeps `SRC_ATTR`” and describes the deleted mechanism.
- `SRC_ATTR`, `authorName`, and `reconcileNotes` are gone from executable code. Stage 2 emits no new attribute.
- The specific digest-keyed `reconcileNotes` bug is gone. Same-digest physical notes are still deliberately treated as equivalent; the “Ibid.” test documents that limitation.
- The narrow claim is now true: the carry-over fingerprint reads only `NOTE_ATTR`, `REF_ATTR`, and `BACK_ATTR`. `CONTAINER_ATTR` is used separately for block classification.
- `digestOf` is correct. Its fallback cannot collide with a well-formed digest and is currently unreachable because every call is gated by the equivalent `NOTE_ID_PATTERN`.
- The numeric-digest and mixed insert/edit/renumber reproductions behaved correctly in direct runtime checks.

Scoped lint passed with three existing complexity notices. Vitest could not start under the read-only sandbox because it requires temporary writes; full typechecking reached unrelated dirty-tree `arc` errors.