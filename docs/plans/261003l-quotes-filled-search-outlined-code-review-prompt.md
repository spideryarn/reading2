You are reviewing CODE, and you may fix what you find inside this stage.

The stage is one commit: `git show d42a76eaf` (base `d42a76eaf~1`). The plan is
docs/plans/261003l-quotes-filled-like-a-highlighter-pen-and-search-hits-outlined.md, your own plan
review is docs/plans/261003l-quotes-filled-search-outlined-plan-review-sol.md, and the browser
screenshots are docs/plans/261003l-shot-*.png (taken before the last two fixes: `mark.cite`'s
`display: inline; margin: 0` and `mark.chat`'s `color: inherit`, and at the final fill strengths).

What it does: swaps two marks in the article prose. A quote (`mark.hit[data-quote]`) becomes a
filled highlighter mark in a new purple (`--quote-rgb`, renamed from `--quote-stroke-rgb`), with
priority carried by fill strength. A search hit (`mark.hit[data-wash]`) becomes an outline: inset
top edge and end caps in the search's colour, the existing hue band as the bottom edge, confidence
as the edge's alpha. `annotateHtml` writes `data-wash-start` / `data-wash-end`. Every hit's edges
go through one `box-shadow` on `mark.hit`, composed from `--mk-*` custom properties.

Rules for this run:
- Fix what is inside this stage, narrowly. For a behaviour bug, write the test that reproduces it,
  see it fail, then fix. Report, do not fix, anything wider.
- Do NOT edit src/sanitize-policy.ts or src/sanitize.ts: that is a defence and needs Greg. If you
  think the sanitiser needs a change, say so as a finding.
- Do not run git commands that change history or the index. Do not commit.
- You can run one test file at a time: `npx vitest run tests/<one>.test.ts`. Not `npm test`, not
  `npm run typecheck`. Tests needing Postgres or the network will fail in your sandbox; that is the
  sandbox, not a finding.

What to check, most important first:
1. CSS correctness of src/web/styles/annotations.css as committed. Trace specificity and source
   order for every combination a mark can be in: quote only (tier 1, tier 2), search only (with and
   without data-hues), quote + search on one run, each of those pressed (`data-hit-open` is set when
   ANY non-bare hit covering the run is open), a reader's highlight (`mark.cmt[data-colour]`) over
   each, `passage-flash` / `passage-flash-still` (prose.css) over each, a bare quick hit, a
   citation or glossary term or cross-reference on the same element. For each, say what
   background-color and which `--mk-*` edges result, and whether that is what the comments claim.
2. Custom properties: can any `--mk-*`, `--hit-stroke-*`, `--quote-fill`, `--quote-a`, `--hit-a`
   or `--h0` be inherited from an ancestor or left unset in a way that paints the wrong thing or
   nothing? `td.text.has-hit` sets `--hit-a` and `--h0`… on the cell.
3. Did my plan-review fixes actually land: findings 1, 2, 5, 6 (inset), 7? Finding 3 I did not
   take, because the plan no longer edits the sanitiser: confirm from src/sanitize-policy.ts that
   the version-8 allow-list really strips `data-wash-start` / `data-wash-end` from article HTML,
   and that tests/sanitize.test.ts would fail if it did not. Finding 8 (a neutral outline) I
   weighed and kept the search's own colour; say if you think that is wrong on the evidence of the
   screenshots.
4. tests/quote-fill.test.ts: is each assertion capable of failing, and does it measure what its
   name says? Check the colour arithmetic (OKLab mixing, compositing, contrast).
5. Anything still describing the old split (quotes outlined, search filled/washed) in code
   comments, reader-facing copy (src/web/help/), or docs/project/, that a reader would now be
   misled by. History that says it is history is fine. src/sanitize-policy.ts comments are known
   stale and are not yours to change.
6. docs/project/quotes.md § A highlighter pen and docs/project/search.md § An outline: any claim
   that the code does not bear out.

Answer with: a list of what you changed (file and why), then numbered findings marked P0/P1/P2
with file:line evidence, each saying FIXED or REPORTED, and end with one line:
VERDICT: land / land after fixes / do not land.
