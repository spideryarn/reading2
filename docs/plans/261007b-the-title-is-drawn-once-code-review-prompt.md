# Code review: the title is drawn once, and the masthead loses its back arrow

You are the cross-family reviewer for three committed stages, and by the house rule you **fix what
you find inside these stages**, narrowly and red-first (a failing test before each fix), and
**report, do not fix, anything wider**. Do not commit; leave your changes in the working tree for
me to read as a diff. Other agents are not editing this worktree during your run.

## The candidate

Worktree `/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow`. Base
`c25a46a8d18827b13a4fdbf09f1e2c05655127cc`. Three commits, in order:

- `b39440f31` S1: the masthead's back arrow goes.
- `239e59b63` S2: the reading view hides the leading rows that repeat the masthead.
- `649dc7828` S3: `debugPage` stops writing a header into the page stage 3 splits.

`git diff c25a46a8d..649dc7828 --stat` is the complete list of changed paths (it is exactly these
three commits; nothing else is on the branch). One untracked file, not part of the code:
`docs/user-feedback/261006_2313-the-title-shown-twice-and-the-back-arrow-above-it.md`.

Start with: the plan
`docs/plans/261007b-the-title-is-drawn-once-and-the-masthead-loses-its-back-arrow.md` (your own
plan review is `…-plan-review-sol.md` beside it, and § The plan review says what became of each
finding, including F1, which was overruled in part after an Opus arbitration); then
`src/web/masthead-echo.ts`, `src/web/fold.ts`, `src/web/scroll.ts` § `scrollToBlock`,
`src/web/keynav.ts`, `src/web/useColumnContext.ts`, `src/web/reader/useReadingPosition.ts`,
`src/web/TableView.tsx`, `src/web/Masthead.tsx`, `src/extract.ts` § `debugPage`, and the tests in
the diff. That is where to start, not a limit.

Also read, as a reviewer of its conclusions and not only its prose: the postmortem
`docs/postmortems/261007b-a-page-wrapped-for-a-person-became-the-next-stage-s-input.md`, and the
doc change in `docs/project/content-extraction.md`.

## What it is for

The owner reported that an article shows its title twice, and asked for the back arrow above the
title to go. The plan has the diagnosis and the evidence.

## What I want

An independent attack first. Then, specifically:

1. Run tests yourself. Your sandbox has no network and no Postgres, so run only files that need
   neither; these do not: `tests/masthead-echo.test.ts`, `tests/masthead-echo-table.test.tsx`,
   `tests/fold.test.ts`, `tests/fold-keynav.test.ts`, `tests/structure-focus-row.test.tsx`,
   `tests/reading-position-holds-across-a-reflow.test.tsx`, `tests/extract-sanitize.test.ts`,
   `tests/dock-corner-controls.test.tsx`. If one cannot run in your sandbox, say so plainly rather
   than skipping it silently. I run the full suite and the database-backed files myself.
2. `mastheadEcho`: can it hide a block that is not an echo, or miss one that is? Consider what
   `Block.html`, `Block.tag` and `Block.text` really hold for the stored wrapper (fixtures under
   `tests/fixtures/data-root/`), entities, a title of digits or symbols, an empty title, a first
   block that is an `h1` wrapped by something, and whether `OUR_LINE` can match an author's line.
3. The fold store: `hidden`, `foldedAway`, `isFolded`, `isFoldedAway`, `revealBlock`,
   `setFoldArticle`'s identity test, and `foldable`. Every caller of `isFolded` in `src/web`: is
   the answer it now gets for an echo row the right one for that caller? The builder switched
   three to `isFoldedAway`; are there others that should have been, or one of the three that
   should not?
4. `scrollToBlock` on an echo row: the glide to the top, `done("settled")`, no arrival anchor.
   What do its callers do next with a "settled" outcome when the row they asked for is not on
   screen (flash, focus, history, the reading position written back to `?at=`)?
5. Anything else in the client that reads block 0 or "the first row" directly and does not go
   through the fold store: the spine, marginalia, the gutter, selection, comments, Skim, the
   visitor's view.
6. Stage 3: is it really new-extractions-only? Find anything that would re-run `debugPage` on an
   existing article without a human asking, or that reads the header back out of a stored page.
   What happens on a deliberate re-extraction of an old article (two block ids vanish): does the
   pipeline rebuild the tree, or can a stale tree name ids that no longer exist?
7. The tests: is any of the new ones unable to fail? Mutate and check where you doubt.
8. Comments and docs changed in the diff: is any sentence false against the code?

## Severity scale

- **P0** — loses or corrupts a reader's data, or breaks the reading view or imports.
- **P1** — a visible regression, or a claim in the code, plan or postmortem that is false.
- **P2** — a missed case, a weak test, a better way.
- **P3** — wording, naming, taste.

Give every finding an id (`C1`, `C2`, …), its severity, file and line, whether you **fixed** it
(and the test that was red first) or are **reporting** it, and for a reported one what you would
do. End with one line: **Verdict: ready to push / ready after the reported P0 and P1s / not
ready**, so an empty answer cannot pass for approval. List every file you changed.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- `beginJump` in `keynav.ts` pushes a history entry for a jump to an echo row from the top of the
  page, though nothing moves. The builder called it harmless.
- An article whose only heading was the wrapper's `h1` now has no *Fold all* button.
- `tests/extract-page-byline-is-the-chosen-one.test.ts` has a name that no longer describes it.
- The postmortem's countermeasure 3 proposes a sentence for `architecture.md` and does not add it.
