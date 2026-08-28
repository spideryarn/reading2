# Review stage 2 of the footnotes work: canonicalising footnote shapes

Repo: `/Users/greg/Dropbox/dev/experim/spideryarn2`. This is a **code review of a completed stage**,
before it is committed. You reviewed the plan; your verdict was REVISE and the plan was revised
accordingly. This is the first stage built from it.

Read `docs/plans/footnotes.md` first (especially "What is in v1" and "The stages"), then review:

- **`src/notes.ts`** — new, 577 lines. The whole of the stage.
- **`tests/notes-canonical.test.ts`** — new, 442 lines, 34 tests.
- **`src/extract.ts`** — 13 lines added; the diff is at
  `/private/tmp/claude-501/-Users-greg-Dropbox-dev-experim-spideryarn2/387535ab-2d3e-40ae-bdc1-e74e26acf8d4/scratchpad/extract.diff`

## What this stage is, and is not

It canonicalises four measured footnote shapes (Gwern, Wikipedia, Substack, Tufte CSS) into one,
**before Readability runs**, and mints a `noteId`. It deliberately does NOT add the `role` field, the
predicates, the tree supplement node, any UI, or the PDF path — those are later stages. Do not
review it for their absence.

## The evidence, measured independently of the tests

I ran the real `runExtract` + `splitIntoBlocks` over the real fixtures with my own harness, asking
not "did an anchor resolve" but "does the reader land on prose or on a stub" — because
`stats.retargeted` reported 36 of 36 on a shape where half the links were useless.

| fixture | before: →prose / →stub | after: →prose / →stub |
|---|---|---|
| substack (`acx_footnotes.html`) | 18 / 18 | **36 / 0** (blocks 120 → 98; the 18 one-word digit blocks are gone) |
| gwern | 87 / 17 | 87 / 17 (the 17 are section headings — correct) |
| wikipedia | 338 / 5 | 338 / 5 |

Note stats after the change: wikipedia 121 notes / 170 markers / 170 back-links, with the
busiest note referenced **13 times**; tufte 5 notes via the tufte shape; **ar5iv 0, gutenberg 0**
(the two negative fixtures, which have no footnotes but do report healthy retarget counts of 85 and
162 from ordinary cross-references).

`npm run typecheck` is clean except `src/embeddings.ts:258`, which belongs to another agent working
in this shared tree and is not part of this change.

## What I want

**Attack it.** In particular:

1. **The recognition rule.** A note is only recognised if it *round-trips* — the note links back to
   where it was cited. That is what excludes ar5iv and Gutenberg. Is it right? What real footnote
   system does it wrongly exclude, and what non-footnote does it wrongly include? Is there a page
   shape where it produces a *worse* result than doing nothing?
2. **The security handling.** This reads a stranger's DOM before sanitisation and moves nodes into a
   structure we mint. Read `scrubReserved`, what is moved versus copied, and the `NEVER_ADMITTED`
   list. Can a hostile page get a forged `data-spya-note*` stamp past this, get body prose dressed as
   apparatus, or get anything into the output that the ordinary sanitiser would not have allowed?
   The template-fragment trap is handled — is anything else?
3. **Stable ids.** `noteId` is a hash of the note's own text; the element id is `spya-note-…`, which
   `ID_PATTERN` (anchored, 6 chars) correctly does not match, so it flows through
   `stampAuthorAnchors`/`retargetAnchors` as an author anchor. Is that reasoning sound? What happens
   on **re-extraction** — do note blocks and the paragraphs citing them keep their block ids? Note
   the plan's known trap: `Block.text` includes marker digits and the carry-over key is tag+text, so
   renumbering can orphan comments. That fix is scheduled for a later stage — confirm this stage has
   not made it worse or foreclosed it.
4. **Does it break anything that worked?** Gwern and Wikipedia already resolved 34/34 and 170/170.
   The counts above say they still do, but counts are what fooled us last time. Check the Wikipedia
   back-link rewriting specifically: the marker text changed from a number to `↩`, so something was
   rewritten on a shape the brief said to leave alone.
5. **The tests.** 34 of them, and they pass. Which are theatre? Which would still pass if the
   implementation were subtly wrong? Is there a mutation to `src/notes.ts` that leaves the whole file
   green — that is the question I care about most. Note test names suggest a byte-identical control
   and a forged-stamp test; judge whether they do what they claim.
6. **Simplicity.** The project's rule is "prefer simple over easy — each piece does one thing and can
   be read on its own; reuse the machinery that's already here rather than adding a second way to do
   the same thing." 577 lines is a lot. What is over-built, and what duplicates something the repo
   already has (`src/blocks.ts` has anchor stamping and fragment resolution; `src/web/internal-links.ts`
   resolves fragments to blocks)?

Cite files and line numbers. Disagree where you disagree; I would rather have the objection than the
endorsement. If you think this should not be committed as it stands, say so plainly and say why.
