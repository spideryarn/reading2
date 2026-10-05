# Review, second pass: stage D after the first review and a real book

Repo: this worktree (`.claude/worktrees/long-documents-d-then-e`), branch
`worktree-long-documents-d-then-e`. TypeScript, ESM, vitest.

## The candidate

Committed: `8827e8119` on top of `e9abf4aa6` (which you reviewed).
`git diff e9abf4aa6..8827e8119 -- src tests docs/project docs/investigations docs/user-feedback`.
Changed paths: `git diff --name-only e9abf4aa6..8827e8119`.

Start with: `src/heading-tree.ts` (`demoteFurniture`, `REPEATED_HEADING_MIN`, the opening-words
title), `src/web/tree.ts` § `titleVoice`, `src/types.ts` § `titleFrom`, `src/public/dto.ts`,
`docs/project/structure-step.md` § "When one answer will not fit". Not the limit of scope.

## What it is meant to do

Your first review is `docs/plans/261005a-long-documents-stage-d-review-sol.md`. The plan's
§ "Result: stage D" says what happened since. In short, a real 250-page book went through the
bounded builder and showed three things, each now changed in `buildBoundedHeadingTree` only
(`buildHeadingTree` must still be byte-identical):

1. A heading repeated `REPEATED_HEADING_MIN` (5) or more times, or the passed article title met
   more than once, or a heading with no letter in it, is page furniture: it does not count toward
   the section level, does not cut a part or section, and titles nothing. Its block stays a leaf.
2. An opening-words title comes from the first block in the window with at least three words
   containing a letter; runs of dot leaders are dropped.
3. A node titled that way carries `titleFrom: "opening-words"`, which crosses the public DTO, and
   the client's `titleVoice` draws it in the author's face. The stock untitled-window title draws
   as the app's own.

The same contract as before must still hold for every tree the builder returns: zero `checkTree`
problems after `mergeLabels(tree, {})`, with or without supplements; every body leaf at depth 3;
no body sibling set over `MAX_BATCH`; no empty title; `planBatches` covers it and nothing it
plans is unaskable; `buildGeometry` and `buildSections` give no empty-titled or paragraph section.

## Previous findings

| ID | Finding | Disposition | What changed |
|----|---------|-------------|--------------|
| F8 | A root-only model tree with notes fails the new structure gate | fixed by you; accepted as written | `planBatches` leaves supplement branches out |
| F9 | Arc refuses 1,097 parts | not attempted here; reported onward | nothing |
| F10 | Inherited comments describe only the model path | fixed by you; accepted | comments |

The three changes above are unreviewed code written by someone else. Spend the run on them.

## What you can and cannot run, and what you may change

You may edit this worktree. Fix what is inside these three changes, each finding red-first with
the test that reproduces it, and leave everything wider as a finding. Do not commit. List every
file you changed. In anything you write, do not attribute words to Greg and add no dated
quotations. You can run one test file at a time (`npx vitest run tests/<one>.test.ts`) and a
script (`node --import tsx <script>`); no network, so Postgres tests skip. Write your report to
the `--output` file only; do not create a second report file.

## Attack it

Re-run your adversarial builder harness with the furniture rules in play: headings repeated 4, 5
and 500 times at every level; a document where every heading is furniture; furniture as the first
or last block; the article title as the only heading; a furniture heading that is the first block
of what would be a window; documents of digits and symbols; headings equal up to case, trailing
punctuation or numbering (what does `sameHeading` treat as equal, and can that wrongly demote
"Chapter 1" … "Chapter 9"?). Check `titleFrom` survives every path a tree takes to the client
(the DTO, any tree copy or merge such as `mergeLabels`, any schema that strips unknown keys) and
that a model-built tree can never carry it.

For each finding: an ID from F11 up, a severity (P0 data loss/security/charging/broadly unusable;
P1 user-visible wrong behaviour or a contract violated; P2 design risk; P3 prose), established or
reasoned, (a) the input I can run, (b) the fix you made or the smallest change that closes it.
Verdict: ship, ship with the fixes made, or do not ship. Refuse only on an established P0 or P1
you could not fix.

## My own suspicions — read last

- `sameHeading` may ignore numbering, which would make numbered chapters furniture.
- A document whose real section headings all repeat (a textbook with "Exercises" in every
  chapter) loses those cuts; windows take over. I think that is acceptable; say if it produces
  anything worse than plain.
- The new docs section in `structure-step.md`: is every sentence true of the code?
