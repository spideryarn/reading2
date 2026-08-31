# Footnotes, stages 3–5: input wanted before I build

You reviewed this plan before stage 2 and again after it landed. Stage 2 is committed (`2ba408a`).
Read, in this order:

- `docs/plans/260828o-footnotes.md` — the plan. Sections that matter here: "The representation",
  "`gistable: false` is not the switch", "Reclassification must invalidate the caches",
  "The tree: present in the structure, absent from the argument", "Word count and reading time",
  "The trap that would cost the most", "The stages", "Stage 2, as it actually landed".
- `src/notes.ts` — what stage 2 leaves in the DOM.
- `tests/notes-canonical.test.ts` — what is currently proved.

I am about to build stages 3, 4 and 5 in one push. **I want your input before I write any code**,
not a review afterwards (that comes later, separately). I am not asking you to re-review the plan's
prose. I am asking you to attack the eleven concrete implementation decisions below, against the
actual code, and tell me which of them are wrong.

Be concrete and quote `file:line`. Where you disagree, say what you would do instead and what it
costs. Where a decision is fine, say so in one line and move on — I would rather have five sharp
objections than eleven paragraphs of agreement.

---

## Decision 1 — where roles are assigned

Stage 2 stamps the DOM before Readability: `data-spya-note` on the note element,
`data-spya-note-ref` on markers, `data-spya-notes` on the container. Stage 3 reads those stamps in
`splitIntoBlocks` (`src/blocks.ts`) and writes `role` / `treatment` / `noteId` onto the `Block`.

**Check the chain actually survives**: `runExtract` sanitises after Readability. Do the
`data-spya-*` attributes survive DOMPurify's allow-list to reach `splitIntoBlocks`, and then the
stored `article.html`? If they do not, this whole design has no input and I need to know now. Name
the file and line where they would be dropped.

## Decision 2 — v1 assigns only `role: "footnote"`

The plan's `role` union has five members. In v1 the only recogniser is stage 2's four web adapters,
and all four produce footnotes. A bibliography recogniser is stage 6 (PDFs, cut from v1).

So I intend to ship the full five-member union in the type and the persistence, but have **only**
`"footnote"` ever assigned by the pipeline in v1 — with the other four exercised solely by synthetic
fixtures.

Is that the right cut, or does shipping a union whose other four members no code path produces
create a worse hazard than a two-member union I widen later? Consider what a stored `role` value
means to `import.ts` a year from now.

## Decision 3 — the predicates live in one module, and `gistable` stays

New file `src/block-policy.ts`, exporting the five named predicates from the plan
(`isSearchable`, `isBodyEvidence`, `isEmbeddable`, `countsTowardReadingTime`, `isStructural`).
`gistable` is left exactly as it is — still computed by `describeBlock`, still meaning what it means
today — and the predicates *combine* `gistable` with `treatment` rather than replacing it. So
`isEmbeddable(b)` is `b.gistable && b.treatment !== "supplement"`.

The alternative is to delete `gistable` and express its five existing meanings through the
predicates. That is a much bigger diff across `labels.ts`, `toc.ts` and `tree-invariants.ts`.

Which? Specifically: is leaving `gistable` in place going to leave me with two overlapping
vocabularies that the next person picks the wrong one from, and is that worse than the churn?

## Decision 4 — `pg-shelf.ts`'s SQL

`src/store/pg-shelf.ts` hard-codes `gistable = true` in SQL (around line 222), outside any
TypeScript predicate. Read what it computes. My options:

  a. widen the SQL to `gistable = true AND (treatment IS NULL OR treatment <> 'supplement')` —
     assumes blocks are stored in a shape SQL can filter on;
  b. precompute the scalar at write time and store it, so the shelf reads a column;
  c. something else you see in the code.

Tell me which, based on how blocks are actually stored (jsonb blob? one row per block?). If (a) is
impossible because blocks are a jsonb document, say so — that changes the shape of stage 3.

## Decision 5 — the fingerprints, and whether zero-role articles must be invalidated

The plan says `role` and `treatment` must join `hashBlocks` (`src/source-hash.ts:47`) or every cached
artefact computed before the split keeps reporting itself current.

I intend to add them **in a way that leaves the hash of a zero-role article byte-identical to today's**
— i.e. omit absent fields from the hashed representation entirely, rather than serialising
`role: undefined`. That way the existing corpus is not mass-invalidated, but the day a role appears
the hash moves.

Is that sound, or is it exactly the kind of cleverness that produces a stale artefact? Check
`hashBlocks` and `structureHash` and say whether "absent field omitted" is achievable in the actual
serialisation, and whether any *other* fingerprint in the repo needs the same treatment.

## Decision 6 — the word-count seam

`src/library-scalars.ts:87` and `src/web/stats.ts:33` each sum words independently;
`src/reading-time.ts` shares only the WPM constant, not the numerator. The plan wants one seam,
`articleWordCounts`.

But those two run on opposite sides of the wire, and the shelf may compute in SQL (see decision 4).
So "one seam" may be unachievable for all three. My intent: put `articleWordCounts(blocks)` in a
dependency-free module the client can import, use it in both TypeScript call sites, and handle the
shelf separately.

What is the failure mode I am not seeing? Specifically: is there a third place a word count or a
reading time is stated out loud that I have not listed?

## Decision 7 — the carry-over key fix

The plan (section "The trap that would cost the most") says: strip the recognised marker and control
DOM **nodes**, not text patterns, and fold a fingerprint of the *targeted note* into the key. Four
tests: insertion survives, target replacement mints, stripped-text collision stays distinct,
legitimate leading number not stripped.

`extractText` is `blocks.ts:150`; `exactKey` is `blocks.ts:317`; order-based carry-over is
`blocks.ts:402`.

My question is about **layering**. `Block.text` is what the reader searches, what the model reads and
what the hash covers. I do *not* intend to change `Block.text` — the marker digits stay in it. I
intend the stripping to happen only inside the carry-over key computation.

Is that separation actually available where `exactKey` is computed — does it still have the DOM
element at that point, or only the extracted text? If only the text, this fix is much harder than
the plan implies and I want to know before I start.

## Decision 8 — the supplement node's six invariants, and where the node is built

The plan: build the body tree from body blocks only, then append the supplement node mechanically
afterwards, extending the root's range. `TreeNode` gains `role: "supplement"`. Six invariants in
`tree-invariants.ts` (depth-one child of root; one contiguous range; only supplement blocks; every
supplement block exactly once; only leaves beneath; no gist, never nested, never root).

Two things I want checked against the code:

  a. Is "extend the root's range afterwards" actually safe, or does something between tree
     construction and validation re-derive the root's range and silently undo it?
  b. The gist-composition pass writes parents from children's gists. Where is it, and does appending
     the supplement after composition genuinely keep "Notes" out of the root's gist — or is there a
     later pass that recomposes?

## Decision 9 — the fisheye

Per the plan, `src/web/tree.ts:72` expands shallow branches into cells and
`src/web/context.ts:90` skips continuation cells but not leaf cells, so a reader standing mid-Notes
gets a run of blank section entries. Filtering leaves out instead makes `context.ts:108` select the
last preceding *body* item, which claims the reader is still in the argument.

My intent: give the supplement's cells an explicit supplement marking that `itemsFromCells` turns
into a single "Notes" item, so a reader mid-Notes is *in* that item rather than nowhere or wrongly
elsewhere.

Does that hold against the actual code, and does it break the anchor invariant that keeps the three
panels agreeing?

## Decision 10 — stage 5's marker recognition

A marker is recognised by **what it targets** — a block with `role: "footnote"` — never by being
inside a `<sup>`. In the browser, the client has the block list and the rendered HTML. The anchor
carries `data-spya-note-ref="<noteId>"` from stage 2.

So: does the client trust the attribute, or resolve the href and check the target block's role?
The attribute is faster and simpler. The role check is authoritative. A hostile page cannot forge
the attribute (stage 2 strips reserved attributes before stamping — verify that), but a *buggy
pipeline* could.

Which, and why?

## Decision 11 — order of build

I intend 3 → 4 → 5, each committed separately, because stage 4 needs `treatment` to exist and stage 5
needs the supplement to be somewhere to jump to.

Is there a dependency inversion here — something in stage 5 or 4 that, if I knew it now, would
change what stage 3's types look like? That is the expensive kind of mistake and it is why I am
asking before rather than after.

---

## Finally

Name the **one** thing on this list most likely to be discovered late and expensively, and say why.
And name anything I have not asked about that you would expect to bite — you have found three
blockers in this feature already that every green test agreed were fine.
