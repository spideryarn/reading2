# Stage 3b, reworked after your BLOCK

You blocked this on two reproduced data-integrity failures
(`docs/plans/footnotes-stage3b-review-sol.md`). Both were real and both are now addressed, along
with your three smaller findings and your view on content sensitivity. This is the re-review.

**Seven passes over this lane, seven real findings.** Please assume there is an eighth. The
scoped diff is `docs/plans/footnotes-stage3b-v2.diff` (`src/blocks.ts` and `src/notes.ts`), the
tests are `tests/note-carry-over.test.ts` (25 of them), and the write-up is
`docs/plans/footnotes.md` § "Stage 3b, as it actually landed".

## Blocker 1 — duplicate note text rotating identities

The key now names the note's **content digest** and drops `mintNoteId`'s positional `-2`/`-3`
counter, so a third "Ibid." inserted above two others no longer rotates the identity the citing
passages see.

**What is deliberately not fixed, and I want you to check the claim.** Three notes whose prose is
identical still cannot be told apart by a content key, so their block ids go out in document order
and an inserted duplicate takes the first old note's id. The claim is that this is **neither
introduced nor fixed here**: run the same fixture with the whole of stage 3b switched off and the
rotation is identical, the only difference being that the citing passages re-mint as well. It is
pinned as a limit in the tests rather than claimed as fixed. Is that characterisation honest, and is
the residual risk correctly described — comments moving to the wrong note body, or only to a note
that reads identically?

## Blocker 2 — the migration bridge

All three of your remedies, on the grounds that any one alone is insufficient:

1. A **stamped flag first**, with counted and delimited fields, so the two key families are disjoint
   by construction whatever an article's prose says — rather than the previous claim that no legacy
   text could spell a new key.
2. The legacy bucket is built only from previous blocks that **parse** with no stamp in them.
3. The fallback runs only after **every** candidate has had its exact match, so an earlier
   candidate's fallback cannot consume an id a later one would have claimed outright.

Please try to break it again, including your original `n[A]Tai` + marker `l` construction.

## Content sensitivity — I took your advice, and it changed stage 2

You said the author's original target anchor could serve as a second continuity signal. It was
**not on disk**: the canonicaliser builds a fresh `<li>` and drops the author's element, so 0 of 178
note bodies across the four fixtures carried any name. Measured before designing around it.

So stage 2 now writes `SRC_ATTR` (`data-spya-note-src`) on the note body, holding the author's own
name for the note — `fn7`, `cite_note-lstm1997-2`, `footnote-1`. `reconcileNotes` decides which note
continues which before any id is handed out: content hash survives a renumbering, the anchor
survives a rewording, the anchor is consulted only where the hash failed and only when it names
exactly one previous note that no longer exists under its own hash, and everything ambiguous mints.

**This is the part I am least comfortable with, and it is a security question as much as a
correctness one.** `SRC_ATTR` is the only value this file writes that is *the page's own text*. It
is length-capped at 128, scrubbed off arriving documents with the other reserved attributes so a
page cannot pre-load one, never used as a selector, never rendered, and used only as a Map key.
But it now travels into the sanitised article html that every reader is served, and into the public
payload a stranger receives.

1. Is that safe? Consider the sanitiser, the `data-*` allowlist, anything that reflects attributes,
   and whether a crafted anchor can do anything at all downstream.
2. Can a page use it to make **two different notes reconcile as one**, or to steal the identity of a
   note in the previous revision — the attacker being the page's author, since a reader's own
   articles are the untrusted input here?
3. Does adding an attribute to stored html disturb any cache fingerprint or carry-over key? The
   claim is no: keys read only `NOTE_ATTR`/`REF_ATTR`/`BACK_ATTR`, and `hashBlocks` reads id and
   text. Check it.

## Also

4. `reconcileNotes` itself — can it mis-continue, i.e. say note X continues note Y when they are
   different notes? What happens on a revision that both edits and renumbers many notes at once?
5. The gate is now `MIGHT_BE_STAMPED`, case-insensitive, and on a parse that finds no stamp the
   caller's **own text** goes back rather than a re-derivation. Is that exactly equivalent to the
   unstamped path?
6. A stamp whose value is not one stage 2 could have minted is now **left in place** rather than
   removed. Right call?
7. Anything else.
