# Marginalia

The column of notes to the right of the prose, each level with the block it is about. Its address is
`?margin=1`, and it stands beside whichever band is open. Up from here:
[reading-view-overview.md](reading-view-overview.md). Where this is meant to go is
[interface-vision.md](interface-vision.md): the right column is for what is anchored to the text.

The code is `src/web/marginalia/`: `notes.ts` decides which note goes beside which block (pure, and
tested in `tests/marginalia-notes.test.ts`), `MarginaliaColumn.tsx` draws them and the head, and
`press.ts` decides what the Dock button does on a narrow window.

## What it shows

**It generates nothing.** Every note comes from something another mode has already stored, and
opening the column never starts a run. The owner's lists are read through each mode's *read half*
(`useIdeasRead`, `useFaqRead`, `useDebateRead`), never the full mode hook, because the full hook
can start a run on its own. `tests/artefact-read-hooks.test.tsx` checks that the read halves only
read. A visitor's lists come in their payload.

- **The head**, pinned at the top: which part and section you are in, and the arc's sentence for
  where the argument has got to. It has a rule under it so it does not read as one more note (Greg,
  spya-rczgjb).
- **Each part's Socratic question**, beside the part's first real paragraph.
- **An idea stamp** ("assumes", "introduces") where each idea first occurs.
- **Other modes' items, shut by default**: FAQ questions, Debate's claim rows, Citations and comments
  (the owner's on a shared article; a bookmark with no words stays a mark in the gutter). Each block gets at most one line of each kind.
  One item shows its title; several show a count ("3 works"). Pressing the line opens the supporting
  quote and remaining-passage count for FAQ, the source quote and bearing for Debate, the byline and
  reason for a citation, or the comment and the first lines of its AI answer. This was
  [report 82](../user-feedback/261002_0300-marginalia-shows-other-modes-items.md), and the reasons
  are in [261002b](../plans/261002b-marginalia-shows-faq-citations-debate-and-comments-shut-by-default.md):

  > Perhaps include FAQ, Citations, Debate items, Comments etc (if generated) in Annotations. […]
  > Rather than showing the full item, maybe show them default-collapsed.
  >
  > — Greg, 2026-10-01

  | Kind | Beside | Rule |
  |---|---|---|
  | FAQ | the question's earliest answering passage that is still there | the quoted words must still be in that block |
  | Debate | the block of the claim a row answers | the claim's words must still be in that block. Whole-article rows have no block, so they stay in the band |
  | Citations | the earliest block that cites the work | **owner only**, and only from a fresh list, because the prose's citation marks are owner-only ([citations.md](citations.md)) |
  | Comments | the comment's block | a referee note (one with a `criterionId`) and a bare bookmark are left out |

  The quote check is there because a visitor's payload carries no staleness flag (no "this was
  written against an older version of the article"). A list written before a block changed could
  otherwise sit beside prose that no longer says what it quotes.

## Keep an eye out for new kinds

Greg, 2026-10-01: *"make a note … that we should keep an eye out for where new mode-items might be
useful to include/display in Annotations mode."*

**When a mode stores items that are anchored to blocks, ask whether they belong here**, shut by
default. Adding one is one new kind in `MarginaliaNote`, one loop in `marginaliaNotes` that places
it at its earliest surviving block and checks its quote, one small component in
`MarginaliaColumn.tsx`, and a read half if the mode hook can start a run.
[mode.md](mode.md) points here from its checklist. Not here yet, and named so they are not
forgotten: Quotes, glossary terms, Timeline events, cross-references. The first two already mark
the prose.

The constraint each new kind is weighed against is the one the first plan named: the risk is *"a
second article down the margin"*. That is why there is one line per kind per block, and why every
kind starts shut.
