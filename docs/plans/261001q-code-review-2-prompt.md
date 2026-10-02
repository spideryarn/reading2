# Code review 2: 261001q stage 2 — composite PDF figures

You reviewed this plan (`docs/plans/261001q-plan-review-sol.md`) and stage 1's code
(`docs/plans/261001q-code-review-sol.md`). Stage 2 was then decided by Greg and built.
Read `docs/plans/261001q-pdf-tables-and-composite-figures.md` § Stage 2 first.

**Greg's preference sets the bar for this review, and it is different from the other
figure routes'.** His words, 2026-10-01:

> If it comes down to it, I'd rather accidentally pull in a bit of extra stuff that got
> included within the bounding box than have no figure imported at all

So **do not** report as a defect that a region may take in a stray line of prose, the edge
of something next to it, or paint pdf.js did not measure. Several of your plan-review P1s
(strict-read veto, shadings, unmeasured paint, `other` paints) were deliberately dropped on
that basis; the plan's table says what became of each. **Do** report, at full severity:
anything that lets a region be **tied to the wrong caption**, or be **mostly another
figure, a table, or prose**; anything that can store a picture under two captions; any way
the route could fail the step, leak resources, ignore the abort signal or the budget, or
spend beyond `MAX_LOCATE_CALLS`; and anything that makes an existing route behave
differently from before.

The diff: `git diff c630dd59c..HEAD -- src tests` (two commits, `judgeLocatedRegion`
then its wiring). The code:

- `src/pdf-figure-region.ts` — `judgeLocatedRegion` and helpers at the end of the file.
- `src/pdf-figure-locate.ts` — `boxOnPage`, `answeredBox`, `COMPOSITE_REFUSALS`.
- `src/collect-pdf-figures.ts` — `locatedRoute` (the gate removal, the region choices and
  the dedupe) and `compositeRegion`.
- `src/collect-assets.ts` — `PDF_FIGURE_RECOVERY_POLICY` → `pdf-figures/6`.
- Tests: `tests/pdf-figure-located-region.test.ts`, `tests/collect-pdf-composite-figures.test.ts`,
  the pin in `tests/collect-assets.test.ts`.
- Docs: `docs/project/article-images.md` (the composite bullet), the postmortem
  `docs/postmortems/261001b-…`.

Evidence not in the repo: on the production paper, with the real locator, all three
figures were stored, and the renders were each figure whole with its labels. A box around
Table 3 with Fig 1's caption was refused `caption-not-adjacent`, and a box over the prose
under Fig 2 was refused `mostly-prose`.

Look hardest at: rule 4/5 (adjacency, other captions) against two-figure pages and
stacked figure-caption-figure-caption layouts; `findCaption` on a caption that also
appears as a running header or in a list of figures; the snap fixpoint (termination,
runaway growth to the page, the `MAX_REGION_AREA_FRACTION` guard); `mostly-prose` against
a figure that legitimately holds a lot of text (a flowchart); the dedupe in
`locatedRoute`; the gate removal's cost; and whether every test would go red without the
code it pins.

You are in `--sandbox workspace-write`. **Fix what you find inside this stage** (the files
above), run `npx vitest run <the test files you touch>` and `npm run typecheck`, and do not
commit. Report anything wider for me to decide. Answer as a numbered list: severity
(P0/P1/P2), evidence (file:line), what you changed or recommend. End with a one-line
verdict.
