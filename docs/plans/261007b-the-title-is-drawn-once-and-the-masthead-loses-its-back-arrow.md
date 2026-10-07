# The title is drawn once, and the masthead loses its back arrow

Up: [plans.md](../project/plans.md)

Two feedback reports from Greg, filed a minute apart on 2026-10-06 from the same page, both about
the top of the reading view. Overseer queue item **qi-kprswh5n**. Both rows were proven an
administrator's by `scripts/feedback-reporter.ts` (exit 0), so this is trusted input and it is
built, simplest version first.

Report `spya-t6cdve`, a problem, on `/read/2608-13566v1-spya-yurten?summary=fuller&stop=spya-gs7srt`:

> Why does this article seem to show the title twice on the page?

Report `spya-us7e4v`, a suggestion, same page:

> Don't bother showing back arrow to the Shelf at the top. We have the Spideryarn logo for that.

## Prior work

Checked 2026-10-07: `docs/plans/`, `docs/user-feedback/`, `git log origin/dev`, `gjd-remote ls`
and the Overseer's queue. Nothing matches either report, and the only session carrying the id is
this one. The nearest neighbours are `260929c` (the back links became icons), `261004` /
`spya-gqj660` (the Home icon went from pages that have the corner logo, which is the same request
one page along) and `261006c` (the title lines up with the prose, which is probably why the
doubling is now obvious: since that change the two titles sit in the same column).

## The bug, reproduced

**It is every article, not this one.** The title is drawn by the masthead
(`src/web/Masthead.tsx`, an `<h1>`), and then the first block of the prose is another `<h1>` with
the same words.

- **In production's data** (read-only, 2026-10-07, current revisions): all 22 web articles start
  with an `<h1>` block whose text is the title, and all 22 follow it with a line ending
  `~N min read`. Of 27 PDFs, 22 start with an `<h1>` equal to the title; 4 PDFs carry the title
  again at block 1 or 2, and one of those "titles" is really the journal's name.
- **In a browser** (Playwright on the box, local dev, 1440 and 390 wide, owner and signed-out
  visitor): the masthead title and the prose `<h1>` are both visible on every article opened: the
  reported paper, a Paul Graham essay, a PDF, and a public article. Screenshot of the essay: the
  masthead says *The Age of the Essay*, and 150px below it the prose says *The Age of the Essay*
  again, then `· ~26 min read`, then the essay.

### The cause

Stage 2 does not write only the article. `debugPage` in `src/extract.ts` wraps what Readability
returned in a whole page meant for a person to open and look at, and that page has a header of our
own: `<h1>{title}</h1>` and `<div class="meta">{byline} · {site} · ~N min read</div>`. It has done
so since the first commit (`cd7fc5720`, 2026-08-24).

**A PDF is different** (GPT Sol, plan review F1; the first draft of this plan had it wrong).
`src/pdf-read.ts` puts its title only in `<head><title>`, and a PDF's leading `<h1>` is the
paper's own title as transcribed from its first page. On screen the two cases look the same, and
a PDF's masthead title is usually built from those very records.

Stage 3 (`src/blocks.ts`) splits **that page's body** into blocks. So our header becomes blocks 0
and 1 of every web article, with stable ids, covered by the tree like any other block.

The masthead arrived a day later (`8babeb993`, 2026-08-25) and drew the title, the byline, the
site and a reading time from `meta`. From that commit every article has said its title twice, and
its reading time twice with two different numbers (the masthead's `~21 min` is from our word
count; the prose's `~26 min read` is Readability's character count divided by a constant).

### The class

**A page built for one reader became another stage's input, so its chrome became content.** The
debug page's header was written for a person checking an extraction. Nothing separates "the
article" from "the page we wrapped it in", so the splitter, every model prompt and the reading
view all take the header as the author's words. It is the same family as
[260929b](../postmortems/260929b-outside-titles-stored-with-their-markup.md), where a value was
right for one sink and wrong for the next.

Other members of the class to look for, and what was found: the `~N min read` line (above), and
the `<title>` in the debug page's head (harmless, the splitter reads the body). The postmortem
names them.

## What to build

GPT Sol reviewed the first draft of this section and found six P1s
([the review](261007b-the-title-is-drawn-once-plan-review-sol.md)). All ten findings were checked
against the code; what each changed is in § The plan review. This is the design after it.

### 1. New web imports stop getting the header (Stage 3)

`debugPage` stops writing `<h1>` and `<div class="meta">` into the body. The title stays in
`<head><title>`. This is the root fix for the class, going forwards: no new article's blocks,
tree or model prompts start with our chrome. It is cheap because it rebuilds nothing (Sol F9; the
first draft wrongly deferred it together with the backfill).

**Not done: rebuilding the articles that already have the header.** Removing two blocks from the
front of an existing article means its blocks, its tree and every generated mode whose fingerprint
covers the blocks are written again, which is paid model work per article and a write to
production data this run may not make. It gets a queue entry (Stage 4) for Greg to schedule. Until
then existing articles are handled by 2.

**Fallback, decided now:** if Stage 3 turns out to reach further than `debugPage` and its tests
(a fingerprint that would make existing articles re-extract by themselves, or an idempotence check
that refuses stored pages), it is not forced through: it is written up here and joins the queue
entry, and 2 alone ships.

### 2. The reading view does not draw the blocks that only repeat the masthead (Stage 2)

A pure function, `mastheadEcho(article)`, returns the ids of at most two leading blocks, and the
prose table hides those rows. Nothing is removed from the data.

**The rule.**

- **The wrapper's shape** (every web article imported before Stage 3): block 0 is an `h1` and
  block 1 is a paragraph that has both our reading-time words and the exact line breaks and
  two-space indentation written by the old `debugPage` template. The line ends `~N min read`
  after a `·`; the wrapper writes the `·` even when nobody is named (`· ~141 min read`). The
  whitespace matters because a newly extracted article can begin with an author's own byline in
  the same words, and its words are not evidence that we wrote it. This needs no comparison with
  the title and therefore also works for a visitor, whose payload has the tidied title and not the
  original (Sol F4). Block 1 is hidden. Block 0 is hidden unless the reader has renamed the article.
- **The same words at block 0** (a PDF, a web article after Stage 3, a wrapper with no reading
  time): block 0 is an `h1`, its HTML is plain text with no markup in it, its text equals
  `meta.title` after trimming, collapsing whitespace and lower-casing, and the reader has not
  renamed the article. Hidden.

Only block 0, and block 1 in the wrapper's shape. Never a later heading: on a web page the
author's own `<h1>` can be block 2, with formatting the plain masthead does not have (Sol F2).

**A renamed article keeps its first heading** (`article.titleOverridden`; Sol F3 showed the first
draft could not tell). The masthead then shows the reader's name for the piece and the prose
shows, once, the author's. A second block that matches the exact legacy-template shape above is
hidden either way.

**A PDF's own title is hidden under the second rule, and Sol disagreed** (F1: it is the author's
content, so leave it and ask Greg). Overruled after Opus arbitrated, because the report is about
what is on screen and a PDF shows the same thing as a web article; the guard (plain text only,
equal words) means nothing is lost that the masthead does not show 170px higher; and it is
display-only and one predicate to undo. The PDFs whose first heading does not equal the title (5
of 27 in production today) are untouched.

**How a row is hidden, and what has to know.** Through the fold store (`src/web/fold.ts`), not
beside it. Sol F5 showed that a zero-height row only "keeps working" because every consumer asks
the store (`isFolded`): arrow keys (`keynav.ts`), the reading position, Structure's focus
(`useColumnContext.ts`), on-screen sampling, the spine, chat placement. So the store is told the
echo ids with the article, and:

- they are in its hidden set always, so the one stylesheet hides their cells and `isFolded`
  answers true for them;
- an echo heading is not foldable, so *Fold all* folds the sections and cannot shut the whole
  article behind a chevron nobody can see;
- `revealBlock` cannot open them;
- the echo ids are part of the store's identity, so a rename, which changes them without changing
  the blocks, takes effect (Sol F8).

**Three consumers ask about a section's start, not about a row, and they get a second question**
(found while building Stage 2; the first version of this section said every consumer "already
skips them", which was wrong). Block 0 is where the first section of every article starts
(`navigableItems` in `src/web/tree.ts` begins at row 0), and block 0 is also the echo. A fold
hides a whole section, so "the start is folded" rightly means "nothing of this section is on
screen". An echo hides one row whose section is still on screen. With the echo answering
`isFolded` true in those three places, the reading position wrote `?at=` as the second section
while the reader was in the first (so a reload put them a section ahead), Structure marked the
second section as current, and the up arrow could not reach the start of the article.

So `fold.ts` exports `isFoldedAway(id)`: true only when a real fold hides the row. An echo by
itself is false, but an echo row covered by a folded heading is true. `useReadingPosition.ts` (its
`skip`), `useColumnContext.ts` (Structure's focus) and `step` in `keynav.ts` ask that. Everything
else still asks `isFolded`. An echo row hidden only as an echo needs no skipping in those three:
it has no height and sits at the top of the first visible row, which is in its own section, so the
measurement is already right. The up arrow to row 0 and `?at=` naming it then go through
`scrollToBlock`, which sends them to the top of the page (next paragraph).

One thing this leaves: stepping by single blocks, the first down arrow from the top of the page
goes to the second visible block, because the first visible one already counts as where the
reader is. It is on screen under the masthead either way.

**A jump to a hidden block goes to the top of the page** (Sol F6): `?at=`, a search hit, a quote
or a comment that names an echo block scrolls to the masthead, which is the visible copy of those
words, instead of centring a row with no height.

**Reader state on a hidden block** (Sol F7). A comment, highlight or chat anchored on an echo
block would lose its mark and its margin note. Counted in production on 2026-10-07 (read-only):
**none**, on block 0 or block 1 of any article, web or PDF. A reader cannot make one from now on,
because there is nothing to select. Accepted and written down, rather than building a rule for
rows that keep themselves visible; model-made margin items on those two blocks are not drawn.

**Where it applies.** The prose table, for an owner and for a visitor. Not what models read, not
exports, not the other bands.

### Passed over

- **Hide the masthead's title instead** when the prose starts with it (Sol's alternative). Every
  block keeps its row, but the pencil, the sharing mark and the archive button are laid out beside
  that heading, the reader's rename would no longer be what the page is headed with, and the
  byline would sit above the title.
- **A class on the row and one CSS rule.** Smaller to write, but it hides the row from the eye
  and from nothing else (F5 to F7).

### 3. The back arrow (Stage 1)

`Masthead.tsx` drew `<BackLink href={LIBRARY_HREF} …>` above the title, labelled *Back to your
library* for an owner and *Back to Spideryarn* for a visitor. It goes. The reading view's way home
is the Spideryarn mark at the left end of the bottom bar (`DockHome`, `Dock.tsx`), which `Reader`
always mounts, for an owner and a visitor (Sol F10 found no reader it strands).

Greg says "at the top"; the logo on this page is in the bottom bar. That does not change the
request, and it is said here so nobody goes looking for a top logo that was never there.

`BackLink` itself stays: the admin pages and the visitor's pages still use it.

## Stages

Each ends green and committed, with this doc updated.

1. **The arrow.** Red first in `tests/dock-corner-controls.test.tsx` (the whole app, owner and
   visitor: the bar's mark links to `/` and the masthead has no link to `/`), then the removal and
   the comments that named it.
2. **The echo.** `mastheadEcho` and its unit tests, red first; the fold store takes the echo ids;
   the jump policy; a jsdom test through `TableView`; mutation check; browser pass.
3. **New imports.** `debugPage` loses its body header, with the fallback above.
4. **The record.** Postmortem naming the class; the queue entry for rebuilding existing articles;
   `content-extraction.md` and `reading-view-overview.md`; the feedback note and its bookkeeping.

GPT Sol reviewed this plan before Stage 1, and reviews the code before the push.

## The plan review

GPT Sol, 2026-10-07, verdict *build with the P0 and P1 fixes*. No P0.

| | Sev | Finding | Outcome |
|---|---|---|---|
| F1 | P1 | A PDF has no synthetic heading; its `<h1>` is the paper's own | Fact accepted and the diagnosis corrected. Its remedy (leave PDFs alone) overruled after Opus arbitrated: hidden under a narrow rule |
| F2 | P1 | "First three blocks" can hide a web author's own formatted `<h1>` | Accepted: block 0 only |
| F3 | P1 | A rename leaves `titleOriginal`, so the matcher would hide a renamed article's heading | Accepted: `titleOverridden` decides, `titleOriginal` is not used |
| F4 | P1 | A visitor has only the tidied title, so equality misses | Accepted: the wrapper is recognised by its shape |
| F5 | P1 | Zero-height rows work only for consumers that ask the fold store | Accepted: the echo goes through the store |
| F6 | P1 | A jump to a hidden row centres nothing | Accepted: such a jump goes to the top |
| F7 | P1 | Hiding the cell hides reader state anchored there | Counted: none in production. Accepted as a documented limit |
| F8 | P2 | Fold identity ignores a rename | Accepted |
| F9 | P2 | Stopping new imports is cheap; only the backfill is dear | Accepted: Stage 3 |
| F10 | P2 | The arrow test should be the whole app, and assert the bar's link too | Accepted |

## Questions, decisions, assumptions

- **Decided here, for Greg to overturn if he disagrees:** a PDF's own first heading is hidden when
  it says exactly what the masthead says. It is one predicate in `mastheadEcho`.
- **Assumed:** a visitor loses the arrow too. The bottom bar's mark takes a signed-out visitor to
  the front page, which is where the arrow went.
- The two different reading times: the prose's was ours; hiding the line leaves the masthead's.

## Ledger

- 2026-10-07: plan written after the data and browser reproduction; GPT Sol's plan review; Opus
  arbitration on F1; plan rewritten.
- 2026-10-07: Stage 1 built. Red first: 2 of 37 failed in `tests/dock-corner-controls.test.tsx`
  with the arrow in place, 37 pass without it.
- 2026-10-07: Stage 2 built by an Opus subagent, which stopped before the store change to report
  that the design above was wrong for three consumers (§ How a row is hidden); `isFoldedAway` is
  the result. Red first throughout; 40 mutants across the rule, the store, the three consumers,
  the jump and `TableView`, all killed, after two survivors each got a test. Three things it
  changes that the plan did not foresee: an article whose only heading was the wrapper's has no
  *Fold all* button, since there is nothing left to fold; stepping by single blocks, the first ↓
  from the top goes to the second visible block, because the first already counts as where the
  reader is; and `tests/article-end-mark.test.tsx` folded that same lone heading, so it now draws
  its fixture as renamed.
- 2026-10-07: Stage 3 built by an Opus subagent, not the fallback: nothing reads the header back
  out of the page, no fingerprint covers `src/extract.ts` so no existing article is re-extracted
  by itself, and `articleWithIds` tells models the title from `meta`. 15 tests in 7 files had
  pinned the header, each a block count down by two or an assertion about the header itself. One
  thing it changes that the plan did not foresee: a page that extracts to no prose used to yield
  our two header blocks and so passed `assertSomethingWasProduced`; it now yields none and is
  refused, which is that guard's purpose. This review traced a deliberate re-extraction too. The
  reader's Rebuild and *Read this* jobs contain all the default stages and force extraction, so
  the force cascades through blocks and Structure: the tree is rebuilt after the two header ids
  disappear, and the id-carry guard accepts the prose ids that remain. The developer's explicit
  `npm run extract -- <slug> --force` is deliberately a one-stage job, so it replaces the stored
  page but carries the old blocks and tree forward; no ids disappear until a job also names
  blocks, and the queue refuses any job that names blocks without Structure.
- 2026-10-07: browser pass after the fix (Playwright on the box; a web paper, an essay, a PDF and a
  public article, 1440 and 390 wide, owner and signed-out visitor). The title is on the page once
  and no `~N min read` line is drawn; no link to `/` in the masthead and the bottom bar's mark
  links there; ↓ and ↑ land only on visible rows and ↑ ends at the top with the masthead in view;
  `?at=` on either hidden row loads at the top, and on a block in the middle scrolls to it; *Fold
  all* folds 62 sections of the paper and unfolds them; no console errors. **One thing left on
  already-imported web articles:** Structure still lists the two hidden blocks as rows (on the
  paper, 1.1 with the title's words and 1.2 "Author list and read-time for the paper"), and
  pressing one goes to the top of the page. That goes when the article is rebuilt (qi-tjb2xjmj).
- 2026-10-07: GPT Sol's code review, round one
  ([the review](261007b-the-title-is-drawn-once-code-review-sol.md)): verdict *ready to push*,
  seven findings fixed by it and one reported. C1, an author's own `Author · Site · ~5 min read`
  line on a newly imported article would have been taken for ours, so the line must also have the
  old template's line breaks; C2, an echo row under a real fold was not `isFoldedAway`; C3, a jump
  to an echo row from the very top pushed a history entry for no movement; C4 to C7, a comment, a
  test that asserted nothing, a stale test name and a wrong fixture path. C8, reported: an
  author's paragraph that copies the template's exact whitespace would still be hidden; closing
  that needs provenance stored with the article, which is the rebuild.
- 2026-10-07: **Sol's C1 fix was wrong for the reported article, and nothing in the tree said so.**
  Its pattern allowed the byline no line break. Run over the first two blocks of every article in
  production (read-only), the rule hid both rows on 20 of 22 web articles and only the heading on
  two, `2608-13566v1-spya-yurten` among them: an arXiv byline is several lines long. The fixtures
  have no such byline, so every test passed. Test added from the stored shape, red first; pattern
  loosened; production then: 22 of 22 web articles hide both rows, 22 PDFs hide their heading, 4
  PDFs and the one renamed PDF hide nothing.
