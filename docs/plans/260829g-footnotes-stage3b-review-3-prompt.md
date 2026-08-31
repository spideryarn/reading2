# Stage 3b, third pass: I removed the machinery rather than fixing it

Your second review blocked this on two reproduced failures. Blocker 1 is fixed. **Blocker 2 I have
answered by deleting the feature that caused it**, which is a decision against your earlier advice,
so the first thing I want from you is to tell me if I have that wrong.

Scoped diff: `docs/plans/260829i-footnotes-stage3b-v3.diff` (`src/blocks.ts`, `src/notes.ts`). Tests:
`tests/note-carry-over.test.ts`. Eight passes over this lane, eight real findings — please assume a
ninth.

## The decision

You said content sensitivity was not worth its cost: editing a note should re-mint the note body,
not every passage citing it. You proposed the author's original target anchor as a second continuity
signal. We built it, and you then found that it moves a passage's id to the **wrong passage** on a
mixed insert-edit-renumber.

So the anchor machinery is gone — `SRC_ATTR`, `authorName`, `reconcileNotes`, and the stage-2 change
that wrote a new attribute into every reader's html. `src/notes.ts` is now two `export` keywords on
constants that already existed; **nothing about what stage 2 writes to disk has changed.**

My reasoning, which you should attack:

- The bug this stage exists to fix is **renumbering**. Marker-stripping plus a content digest fixes
  that completely and has survived two of your reviews.
- The anchor existed only to stop a note's *text* being edited from re-minting the passages citing
  it — a rarer event — and its cure produced wrong-attachment twice.
- `docs/project/block-ids.md` is explicit that **a lost anchor is the safer failure**. Re-minting
  loses a comment's anchor; mis-continuing moves the comment onto something else. Buying a
  convenience with the unsafe failure is the wrong trade.

**So the accepted limitation is now: editing a footnote's text re-mints the block ids of the
passages citing it.** Is that the right call, and is it correctly and honestly documented in
`docs/plans/260828o-footnotes.md` § "Stage 3b, as it actually landed"? If you still think the anchor is
worth having, say what would make it safe, and say plainly whether it can be made safe at all from
two snapshots.

## Blocker 1, fixed

`digestOf` now captures the fixed ten-hex field structurally instead of chopping a `/-\d+$/` tail,
so `spya-note-9417977611` is a digest and not a digest-with-a-counter. Your reproduction is in the
tests as a `describe` with **two** tests: one asserting the fixture's digests really are all digits
(so it cannot quietly stop being the hard case), and one asserting a passage repointed between the
two notes mints.

## What I want checked

1. **The removal itself.** A half-removed feature is worse than either state. Is there a dangling
   reference, a clause that now cannot fire, a test that passes only because the thing it tested is
   gone, or a comment describing machinery that no longer exists?
2. **The migration bridge**, which you cleared last time — is it still intact and still one-way after
   the deletion? The three properties were: the stamped flag making the namespaces disjoint by
   construction, legacy buckets built only from previous blocks that parse with no stamp, and the
   fallback running only after every candidate has had its exact match.
3. **The duplicate-note map.** You said `reconcileNotes` keyed `out` by digest and skipped a second
   note sharing a digest rather than counting it ambiguous. That function is gone — confirm nothing
   equivalent survives in the fingerprint path.
4. **The claim I was told to correct.** The write-up said carry-over reads only
   `NOTE_ATTR`/`REF_ATTR`/`BACK_ATTR`, which you said was inaccurate because `SRC_ATTR` fed the
   resolver. With `SRC_ATTR` gone, is the claim now true?
5. **`digestOf`'s fallback.** It returns the whole `noteId` when the pattern does not match. Is that
   the safe direction, or does it let a malformed stamp collide with a well-formed one?
6. Anything else.
