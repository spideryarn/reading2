# Marginalia shows FAQ, Citations, Debate and comments, shut by default

Two of Greg's reports about the same right-hand column, both admin suggestions, so built.

**SPIDERYARN-READING2-82** (spya-h6rrhv, 2026-10-01):

> Perhaps include FAQ, Citations, Debate items, Comments etc (if generated) in Annotations.
>
> And make a note in new-mode.md and/or docs for Annotation mode that we should keep an eye out for
> where new mode-items might be useful to include/display in Annotations mode.
>
> Rather than showing the full item, maybe show them default-collapsed.
>
> — Greg, 2026-10-01

**spya-rczgjb** (2026-10-01):

> I really like the rail at the top of the annotation marginalia mode that tells you where you are,
> both in terms of the structure and the arc. Can we make it visually look slightly different from
> the rest of the annotations? Perhaps put a box around it or a line under it or something to show
> that it's not just a regular margin-annotation?
>
> — Greg, 2026-10-01

Annotations has since become **Marginalia** (261001n); `new-mode.md` is [mode.md](../project/mode.md),
and Marginalia has no doc of its own yet, so this plan gives it one.

## What the reader gets

Beside a block, under the part's question and any idea stamp, at most **one shut line per kind**:

```
  prose …                         │  What does the author mean by X?      ← question (as now)
                                  │  ASSUMES  rational agents             ← idea stamp (as now)
                                  │  ▸ FAQ  Why does the bound hold?      ← one question here
                                  │  ▸ DEBATE  disputes · Smith 2021
                                  │  ▸ 3 CITATIONS                        ← several, counted
                                  │  ▸ YOUR NOTE  check this against §4
```

Pressing a line opens it in place (not a hover card — it is an open/shut row, so the column grows
and the collision pass pushes the notes below down). Open, each kind shows what its own band shows
in short:

| Kind | Anchor (block) | Shut line | Open |
|---|---|---|---|
| FAQ | the question's first answering passage (`passages[0]` by block position) | the question | the quoted answering words; "+N more passages" |
| Debate | each claim row's `blockId` (whole-article `direct` rows have no block, so they stay in the band) | relation · work title | the source's quote, a link to the page, `applies` |
| Citations | `firstCited` | the work's title (short) | by-line, year, `why` |
| Comments | the comment's `blockId` | the body's first words, or "Bookmark" | the whole body (and the AI answer's first lines if there is one) |

Several items of one kind in one block collapse to a count ("3 citations") that opens to their
shut lines. That is the density rule: the risk 261001d named is *"a second article down the
margin"*, and a paper with forty references would otherwise put forty lines there.

**Nothing generates.** Each kind is read only if it already exists: Citations and comments are
already held by the Reader in every mode; FAQ and Debate get read-only hooks (`useFaqRead`,
`useDebateRead`, GET only, no `useStepJob`, no `useAutoRun`) mounted only while the column is open,
in the same feed component that reads Ideas today. A stale owner artefact (`stale: true`) is not
drawn, as for Ideas; a note naming a block the article no longer has is skipped.

**Visitors** get FAQ and Debate from their payload (`artefacts.faq`, `artefacts.debate`) and the
owner's public comments, as they already get Ideas. **Citations stay owner-only**, matching the
prose marks' decision ([citations.md § Who sees it](../project/citations.md)): the margin is not the
place to quietly reverse it.

**The head** (spya-rczgjb): a hairline rule under it in `--rule-strong` (plain `--rule` was too faint
on the dark page in the browser check), above the existing fade. Greg offered a box or a line; the line is the quieter of the two
and the column's notes have no rules of their own below the head except the question's left rule,
so a horizontal rule reads as a different thing. One CSS declaration.

## Where it fits the interface vision

[interface-vision.md](../project/interface-vision.md) question 2 asked which stored content goes into
the margin first: Debate disputes, FAQ beside its answers, or both. Report 82 is Greg's own answer,
wider than either: FAQ, Citations, Debate and comments, shut. FAQ sits beside the passage that
answers it, which is option B's shape, so nothing here pre-empts it; Debate shows every relation,
not only `disputes`, with the relation word first so a reader can tell. Each kind is one entry in a
list (`notes.ts`) so dropping one, or narrowing Debate to disputes, is one line. The question comes
off the open list and the doc records what was built.

## Simpler options passed over

- **Show the items in full** — what Greg asked us not to do.
- **One line per item, no per-kind count** — simpler by a few lines, but a citation-heavy paper
  fills the column; the count is the cheapest density guard.
- **Hover cards like the idea stamp** — reuse, but a card is not "collapsed"; Greg asked for
  default-collapsed, which is an open/shut row. Hover cards also cannot hold a link to click.

## Deferred

- Quotes, glossary terms, timeline, cross-references in the margin (the "etc"). Quotes and glossary
  already mark the prose; adding them is one entry each once this shape is liked. Named in
  marginalia.md's list of candidates.
- Debate's whole-article rows, which have no block.
- Remembering which lines a reader opened.

## Stages

1. **Pure notes** (red-first tests in `tests/marginalia-notes.test.ts`): `MarginaliaNote` gains
   `faq | debate | citation | comment` kinds grouped per kind per block; anchors resolved by block
   position (block-ids.md); stale/missing blocks skipped.
2. **Reads and drawing**: `useFaqRead`, `useDebateRead`; the feed component reads them; Reader
   passes citations/comments/faq/debate into `marginaliaNotes`; `MarginShutNote` button with
   `aria-expanded`; CSS; the head's rule. Browser check, desktop and 390px (where the notes are
   hidden — confirm nothing new leaks).
3. **Docs**: `docs/project/marginalia.md` (new, owned by reading-view-overview.md) with the rule
   "when a mode adds block-anchored items, ask whether they belong in the margin", and a line in
   mode.md's checklist pointing to it; interface-vision.md question 2 resolved.

GPT Sol on the plan (`--sandbox review`) and on the code (`--sandbox workspace-write`).

## GPT Sol on the plan, and what changed

[The review](261002b-marginalia-plan-review-sol.md); no P0.

1. **Read-only by structure** — accepted: `useFaqRead` and `useDebateRead` are the read halves that
   `useFaq` and `useDebate` now compose, as `useIdeas` composes `useIdeasRead`; a test proves the
   read hooks issue only a GET.
2. **Stale for visitors, and citations' own gate** — accepted: an FAQ passage or a Debate claim is
   placed only where its quoted words are still in the block's text (both readers, since a visitor's
   payload carries no freshness); citations only when the owner's read is `ready` and not `stale`,
   never from `artefacts.citations`.
3. **Citation density** — grouping per block does not stop a paper citing one work per paragraph
   adding forty lines. Measured on a real paper in the browser before deciding; the fallback is to
   drop citations from the margin (the prose marks them already) and say so to Greg.
4. **FAQ at its earliest surviving passage** by block position, not `passages[0]` — accepted.
5. **Button and panel as siblings**, `aria-controls`, a focus ring, links outside the button —
   accepted.
6. **Referee notes are not reading notes** — owner comments with a `criterionId` are left out.
7. **One disclosure per kind per block** — accepted, replacing the two-level count: one item shows
   its title shut; several show "3 citations", and opening shows them all.

## After the browser check and GPT Sol's code review

**The browser check** (Playwright, desktop and 390px, local articles `vb-spya-vu3xen`,
`cargocult-spya-rz663q`, `scaling-hypothesis`, `writes`): all eight checks passed. Lines open in
place, the notes below move down without overlapping, a press changes neither the row nor `?at=`,
Enter and Space toggle, opening the column made only GETs, and at 390px nothing new appears. Two
changes came out of it:

- **Bare bookmarks left out.** A bookmark with no words showed as a lone "BOOKMARK" stamp with
  nothing after it, beside a block the gutter already marks with the bookmark icon. Comments with
  words (or an AI answer) stay.
- **The head's rule in `--rule-strong`**, because `--rule` was barely visible on the dark page.

**Citation density, measured** (Sol's F3 on the plan, F1 on the code): on Gwern's *The Scaling
Hypothesis* (12,646 words, the most citation-heavy local article) the column carries 24 citation
lines. Shut, one line each, they read as a sparse column rather than a second article. So citations
stay, and the note to Greg names the measurement. If a denser paper shows otherwise, dropping the
kind is one loop in `notes.ts`.

[Sol's code review](261002b-marginalia-code-review-sol.md): no P0. Sol fixed, inside the stage: the
promised open content (FAQ's remaining passages, Debate's source quote, a comment's AI answer),
Debate rows keyed on `id` rather than `url` (two rows can share a URL), the ellipsis clipping the
chevron, and tests for the owner feed's requests, post-job refresh, and taps inside TableView. It
confirmed that "nothing generates" holds.
