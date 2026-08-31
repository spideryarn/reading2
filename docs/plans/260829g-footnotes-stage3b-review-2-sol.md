Verdict: **BLOCKED.** Both original blockers are fixed, but I reproduced two new data-integrity failures.

## Blockers

1. **Numeric-only content digests collapse into one identity.**

[`digestOf`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/blocks.ts:446) removes `/-\d+$/`. For a valid base id such as `spya-note-9417977611`, it removes the digest itself and returns `spya-note`.

This affects about 0.91% of ten-hex digests. Real stage 2 inputs found almost immediately:

- `note-12` → `spya-note-9417977611`
- `note-58` → `spya-note-7582867268`

Repointing an unchanged paragraph between those notes incorrectly carried its old block id. Both different notes resolve to `spya-note`.

Parse the fixed ten-hex field structurally, e.g. capture `^(spya-note-[0-9a-f]{10})(?:-\d+)?$`. Add the repoint reproduction; the existing numeric fixture at [note-carry-over.test.ts:478](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/note-carry-over.test.ts:478) inadvertently exercises the collapse without comparing two numeric digests.

2. **A mixed insertion, edit and renumber can move an id to the wrong passage.**

[`reconcileNotes`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/blocks.ts:631) misidentifies this revision:

- Before: A=`fn1`, B=`fn2`.
- After: new X=`fn1`; edited A=`fn2`; unchanged B=`fn3`.
- Because A’s old digest has disappeared, X is mapped to A through `fn1`.
- The unchanged B proves that the anchor family renumbered, but that evidence is not considered.

With two otherwise identical passages, I reproduced A’s old passage id moving to the passage citing new X, while the passage still citing edited A minted. This is precisely the wrong-attachment failure the note fingerprint was meant to prevent.

A conservative remedy is to detect evidence of renumbering—an unchanged digest moving to another source anchor—and disable anchor fallback for that revision or anchor family. Then edited-and-renumbered notes really mint as documented.

## Answers

1. The duplicate-“Ibid.” characterisation is honest. The note-body rotation is pre-existing. Stage 3b protects the citing passages but does not fix the body identities. The displaced comment lands on a logically different note whose prose and cited-note fingerprint read identically; only navigation/back-link controls may differ.

2. The migration bridge is fixed. The stamped flag makes the namespaces disjoint, stamped previous blocks are excluded, and exact matching finishes first. The original `n[A]Tai` + `l` attack now mints while the unchanged `Tail` passage retains its id.

3. `SRC_ATTR` is not an active-content security problem:

- Both sanitiser bindings retain it as inert `data-*`.
- Crafted quotes and markup serialize inside the quoted attribute; I verified no element or handler is created.
- No client code, CSS selector, or reflection path reads it.
- The public DTO copies `block.html` verbatim at [dto.ts:145](/Users/greg/Dropbox/dev/experim/spideryarn2/src/public/dto.ts:145), so it does expose up to 128 characters of otherwise discarded source metadata. That is a small information-surface expansion, not execution.

A page cannot preload `SRC_ATTR`, but its author controls the anchor from which stage 2 derives it. Therefore it can influence—and, through blocker 2, steal—continuity.

4. `reconcileNotes` can mis-continue. The “edited and renumbered mints” claim is false in mixed revisions. It can instead assign the old identity to the new occupant of the old positional anchor.

It also treats multiple current physical notes with the same new digest as one map entry because `out` is keyed by digest. The second note is skipped rather than counted as ambiguous.

5. Yes. When parsing recognises no valid stamp, returning the caller’s text makes exact and folded matching equivalent to the unstamped path. The false-positive gate costs only a parse.

6. Yes. Leaving an invalid stamp’s element in place is the conservative choice. Removing content while contributing no identity would manufacture collisions.

7. Cache fingerprints are unaffected: [`hashBlocks`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/source-hash.ts:112) reads id, text, role and treatment, not HTML. The narrower claim that carry-over reads only `NOTE_ATTR`/`REF_ATTR`/`BACK_ATTR` is inaccurate: `SRC_ATTR` deliberately affects the resolver at [blocks.ts:582](/Users/greg/Dropbox/dev/experim/spideryarn2/src/blocks.ts:582), and therefore affects the eventual key indirectly.

Verification: focused suite **25/25 passed**. Full suite: **313 files passed, 3 unrelated dirty-tree fixture failures**. Scoped lint passed with existing complexity notices. No files changed.