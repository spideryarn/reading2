# Code review, round two: a narrow check of one fix

Read-only: change no file. Discovery is closed; this is a check of fixes that were not in the
round-one snapshot.

## The candidate

Worktree `/var/tmp/spideryarn-worktrees/fb-title-twice-and-shelf-arrow`, commit `7e43dffb2`
(on top of `649dc7828`, which round one reviewed). `git show 7e43dffb2 --stat` lists its paths.
It contains two things:

1. **Your own round-one fixes C1 to C7**, which nobody but you has reviewed: `src/web/fold.ts`
   (`isMastheadEcho`, `isFoldedAway`), `src/web/keynav.ts` § `beginJump`, `src/web/scroll.ts`
   (a comment), `src/web/masthead-echo.ts` (`OUR_LINE_HTML`), and their tests. I read them and
   kept them. Treat them as code by somebody else.
2. **My correction to C1.** `OUR_LINE_HTML` as you wrote it was
   `/^<p\b[^<>]*>\n {2}[^<\n]*\n {2}· ~\d+ min read\n<\/p>$/`. Run over the first two blocks of
   every current article in production (read-only), the rule then hid both wrapper rows on 20 of
   22 web articles and only the heading on two, one of them the article the report was filed on.
   Their stored block 1 is, verbatim:

   ```
   <p id="spya-qz0abd">\n  Timur Galimzyanov\n\nAffiliation:&nbsp;Code Modelling Research, JetBrains Research, Munich, Germany · \n  · ~84 min read\n</p>
   ```

   (`\n` are real newlines.) The byline runs over several lines. I changed `[^<\n]*` to `[^<]*`,
   with a test built from that stored shape, red first
   (`tests/masthead-echo.test.ts` § "knows the line when the byline in it runs over several
   lines"). Production afterwards: 22 of 22 web articles hide both rows; 22 PDFs hide their
   heading; 4 PDFs and one renamed PDF hide nothing.

## What I want

- Is the loosened `OUR_LINE_HTML` still doing the job C1 gave it: can an author's own paragraph on
  a **newly** extracted article (no wrapper) now match it by saying ordinary things? Work it out
  from what `splitIntoBlocks` (`src/blocks.ts`) stores as `Block.html` for a `<p>` and for a
  `<div>` of text: does stored html of authored prose ever begin `\n` + two spaces and end
  `\n  · ~N min read\n`?
- `beginJump`'s new early return (C3): `ended?.()` is called and `false` returned. Read the
  callers of `beginJump` and say whether any of them is left in a wrong state by an "ended" jump
  that neither moved nor flashed (a pending flash, a held anchor, a chain of steps).
- `isFoldedAway` after C2 is simply `foldedAway.has(id)`. Confirm an echo row can be in
  `foldedAway` only under a real fold, given an echo heading is never foldable, and that
  `revealBlock` on such a row still does the right thing (it returns early for any echo).
- Run `tests/masthead-echo.test.ts`, `tests/masthead-echo-table.test.tsx`, `tests/fold.test.ts`
  and `tests/fold-keynav.test.ts` yourself.

Severity scale as before (P0 to P3), an id on every finding (`D1`, …), and one last line:
**Verdict: ready to push / ready after the reported P0 and P1s / not ready**.
