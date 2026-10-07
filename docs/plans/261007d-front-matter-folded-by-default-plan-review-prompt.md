# Plan review: front matter folded by default, and authors read off an arXiv HTML page

You are reviewing a **plan**, before anything is built. Read-only: change no file.

Repo: the worktree `/var/tmp/spideryarn-worktrees/fbduh4w3-front-matter-collapse`, TypeScript +
ESM, React client under `src/web/`.

## The candidate

- Base commit `a8b5973877282a24ac0eaeb2ade3473d9b4635f2` (a branch off `dev`). No code has changed.
- The plan, untracked: `docs/plans/261007d-front-matter-folded-by-default-and-arxiv-html-authors.md`.

## What it is for

A feedback report from the project's owner: the start of many articles is authors, affiliations
and contact lines, drawn badly, and he wants it identified and collapsed by default so a reader
lands on the article itself; and he wants author names and affiliations imported and drawn
better. The plan (1) adds a display-only rule that finds one run of leading blocks ending at the
abstract and hides it through the existing fold store (`src/web/fold.ts`), with a button in the
masthead to show it; (2) reads authors off arXiv's LaTeXML HTML at import, for new imports.

## What I want from you

An independent attack on the plan first. Read the plan, then the code it stands on:
`src/web/fold.ts`, `src/web/masthead-echo.ts`, `src/web/TableView.tsx` (where the echo is
wired), `src/web/FoldToggle.tsx`, `src/web/Masthead.tsx`, `src/web/scroll.ts` (`scrollToBlock`,
`revealBlock` callers, the echo's go-to-top case), `src/web/keynav.ts` § `step`,
`src/web/reader/useReadingPosition.ts`, `src/web/useColumnContext.ts`, every other caller of
`isFolded` / `isFoldedAway`; and for stage 2 `src/meta-authors.ts`, `src/authors.ts`,
`src/extract.ts` (where `metaAuthors` and `authorsForByline` are used, and what Readability and
the sanitiser have done to the DOM by then). Also the plan it follows,
`docs/plans/261007b-the-title-is-drawn-once-and-the-masthead-loses-its-back-arrow.md`, whose
reviews found that "a zero-height row keeps working" was false in several places. That list is
where to start, not a limit.

Questions with a floor:

1. Is each statement the plan makes about the existing code accurate?
2. The stage-1 rule: name concrete, realistic articles (a paper, an essay, a book, a report) on
   which it would hide a block of the author's own prose, or hide something a reader must not
   lose. Is "block 0 is an h1 and an Abstract heading within 16 blocks" enough of an anchor?
3. The third kind of hiding in the fold store: for every consumer of the store, is the plan's
   stated behaviour (`isFolded` true, `isFoldedAway` true, revealable, not foldable, part of the
   store's identity) right, and which consumer does it get wrong? Consider the interaction of
   the echo, a real fold, Fold all, a re-extraction with the same key, a rename, `?at=` naming a
   block in the run on first load, the spine, reading-time sampling, search hit marks, margin
   items and comments anchored in the run.
4. Stage 2: does the DOM `metaAuthors` is handed still contain `.ltx_authors` markup at that
   point? Is "all or nothing, only when no citation_author" a sound gate? What would make it
   store a wrong author list?
5. Is there a simpler design that gets most of the value? Is anything here not worth building?

## Output

Findings with stable IDs `F1`, `F2`, …, each with a severity from this scale, graded by
consequence: **P0** data loss, exploitable security, incorrect charging, service broadly
unusable; **P1** user-visible wrong behaviour or an authoritative contract violated; **P2**
design or maintainability risk with no wrong behaviour today; **P3** prose defect. Say for each
whether it is *established* (an exact source path that shows it) or *reasoned*. End with a
one-line verdict: `VERDICT: build as planned` / `build with the P0 and P1 fixes` /
`revise before build`.

## My own suspicions (already mine; spend most of the run elsewhere)

- `isFoldedAway` true for the run may be wrong for a Structure section that starts in the run and
  continues into the abstract.
- The second rule (no Abstract heading) is the risky one and may not be worth having.
