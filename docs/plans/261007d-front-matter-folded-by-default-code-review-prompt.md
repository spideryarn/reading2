# Code review: the byline blocks under the title start folded away, and three more arXiv author shapes

Repo: the worktree `/var/tmp/spideryarn-worktrees/fbduh4w3-front-matter-collapse`, TypeScript +
ESM, React client under `src/web/`, tests in `tests/` (vitest).

You may write. **Fix what is inside this change, narrowly and red-first** (a failing test, then
the fix). **Report, do not fix, anything wider you notice.** Do not commit. Do not touch
`src/public/dto.ts`, anything listed in `docs/project/security-map.md` § Where the defences
physically live, `.env*`, or `infra/`.

## The candidate

Committed, on top of `8bc2527cf` (the plan):

- `25ec39b9b` stage 2: `src/latexml.ts`, `tests/latexml.test.ts`,
  `tests/fixtures/latexml/authors-2610-{08392,08750,08781,08785,08790}.html`
- `1c343fdff` stage 1: `src/web/front-matter.ts` (new), `src/web/fold.ts`, `src/web/keynav.ts`,
  `src/web/reader/useReadingPosition.ts`, `src/web/marginalia/MarginaliaColumn.tsx`,
  `src/web/FoldToggle.tsx`, `src/web/Masthead.tsx`, `src/web/TableView.tsx`,
  `src/web/styles/shell.css`, and tests `tests/front-matter.test.ts`,
  `tests/fold-front-matter.test.ts`, `tests/front-matter-table.test.tsx`,
  `tests/marginalia-layout-folded.test.tsx`, `tests/fold-keynav.test.ts`,
  `tests/reading-position-holds-across-a-reflow.test.tsx`, `tests/structure-focus-row.test.tsx`

`git diff 8bc2527cf..1c343fdff` is exactly the change. Start with those files; that does not
limit scope.

The plan, which is part of the candidate and makes claims to check:
`docs/plans/261007d-front-matter-folded-by-default-and-arxiv-html-authors.md`. Your own plan
review is `docs/plans/261007d-front-matter-folded-by-default-plan-review-sol.md`; the plan's
§ The plan review says what was done with each finding, including F9, which was overruled.

## What it is for

The owner's report: the start of many articles is authors, affiliations and contact lines, drawn
badly; identify them and collapse them by default so a reader lands on the article itself.
Stage 1 is a display-only rule (`frontMatter`) plus a third kind of hiding in the fold store,
shut on arrival and opened by a masthead button or a jump. Stage 2 widens the existing LaTeXML
author-name reader by three closed shapes.

## What I want from you

An independent attack first. Run tests yourself where they need nothing outside the tree (these
are jsdom and pure tests; none needs Postgres): e.g.
`npx vitest run tests/front-matter.test.ts tests/fold-front-matter.test.ts tests/fold-keynav.test.ts`.
A finding you reproduced with a failing test outranks one you reasoned to.

Questions with a floor:

1. **The rule.** Construct realistic leading blocks (papers, essays, reports, books, news) that
   `frontMatter` hides and that are the author's own prose or something a reader must not lose.
   The plan states the accepted misses (§ What this gives up; § Known, not fixed). Is each
   statement there accurate, and is there a class it does not name? Check `authorNames`
   splitting a byline on commas and "and", `findName`'s glued-letter allowance, the `LEAD`
   pattern matching anywhere in a block as evidence, and `readsAsProse`'s two measures.
2. **The store.** For every consumer of `isFolded`, `isFoldedAway`, `revealBlock`, `visibleFrom`,
   `useFold`: is the behaviour with a shut run, an open run, a run under a real fold, a run
   beside the echo, a rename, a re-extraction under the same key, and an unmount right? The
   plan's two behavioural bullets under § Sections that start inside the run are the contract.
   Is `visibleFrom` asked everywhere it must be, and nowhere it must not be?
3. **`?at=`.** The reading position now writes a section that starts in the shut run as its
   first visible block. Does anything read `?at=` back expecting a section start (the restore,
   Structure's focus, the spine, a shared link), and get the wrong section?
4. **Marginalia.** Is leaving hidden rows' notes out of the layout right in every state,
   including a note whose row is shown again?
5. **Stage 2.** Can any of the three widenings make `latexmlAuthorNames` return a wrong list
   (a person missing, a non-person included, two people joined)? The claim is 0 wrong of 19
   pages, and that every pre-existing refusal other than the three shapes still refuses.
6. **Tests.** Which new tests would still pass with the behaviour they name broken?

## Output

Write findings with stable IDs continuing from the plan review (`C1`, `C2`, …), each with a
severity (**P0** data loss, exploitable security, incorrect charging, service broadly unusable;
**P1** user-visible wrong behaviour or an authoritative contract violated; **P2** design or
maintainability risk with no wrong behaviour today; **P3** prose defect), whether it is
*established* or *reasoned*, and whether you **fixed** it (name the test you saw red) or
**reported** it. End with one line: `VERDICT: ready to push` / `ready after the reported P0 and
P1s` / `not ready`.

## My own suspicions (already mine; spend most of the run elsewhere)

- `LEAD` as evidence anywhere in a block ("correspondence" is an ordinary word) leans entirely on
  `readsAsProse` to refuse prose.
- Splitting a byline on commas can turn "Smith, John" style or an institution into a "name".
- The sentence I would least like to be wrong about: *"hidden blocks that are the article's own
  prose: 0"* holds only for the 49 articles measured; the rule's safety on future imports rests
  on the per-block tests, not on that count.
