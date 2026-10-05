**Verdict: ship with the fixes made.** Reviewed `e9abf4aa6..8827e8119`. Nothing committed.

**F11 — P1, established, fixed: the title fallback still accepted symbols and short dialogue.**

Input: 240 paragraphs containing only `123 456 789`, `# * +`, `Oh.`, or `“35,” she said.` Also reproduced with a window beginning with `#` followed by only `Oh.`.

After finding no block with three letter-containing words, `titleOf` made a second pass with a threshold of zero. These passages received opening-words titles and author provenance.

Removed that second pass. Without qualifying text or a usable heading, the node now receives `UNTITLED_WINDOW_TITLE`, no `titleFrom`, and the UI voice. Five regression cases failed before the fix and pass afterward.

**F12 — P1, established, fixed: furniture could still supply the root title.**

Input: five `Running Title` headings, followed by `The Real First Heading` and prose, with no supplied article title. Numeric and symbol headings reproduce the same problem.

Planning used demoted headings, but root naming searched the original body. Consequently, furniture still titled a node.

Root naming now searches the same filtered heading body. Two regression cases failed before the fix and pass afterward, covering both a real heading afterward and furniture-only documents.

Reproduce F11 and F12 with:

```sh
npx vitest run tests/bounded-heading-tree.test.ts
```

**F13 — P3, established, fixed: the documentation described the wrong title source.**

The new section and `TreeNode.titleFrom` comment said “first paragraph,” although selection skips blocks that do not qualify. The section also described every model tree as having the target shape and left the section bound unqualified.

Corrected these descriptions, documented the stock fallback and comparison semantics, and described the repetition threshold as a heuristic.

**F14 — P3, established, wider scope: the prior review report contains seven broken relative links.**

`npx vitest run tests/doc-links.test.ts` fails because links in `docs/plans/261005a-long-documents-stage-d-code-review-sol.md` resolve relative to `docs/plans/`.

Smallest fix: use `../../src/…` and `../../tests/…`, a sibling filename for the review report, and `../postmortems/…` for the postmortem. Left unchanged as requested.

The remaining attacks found no defect:

- `sameHeading` preserves case, trailing punctuation, and numbering. “Chapter 1” through “Chapter 9” remain distinct.
- Repeated “Exercises” headings lose their cuts as intended; blocks remain covered and windows provide valid navigation.
- The original harness produced 9,815 sound trees and two expected refusals for bodies below four blocks. The furniture harness passed another 2,104 cases, including 4, 5, and 500 repetitions at every heading level.
- `titleFrom` survives supplement append, label merge, finalization, JSON storage, and owner/public client paths. No stripping schema intervenes. Independent parser and builder checks reject model-supplied provenance, including checkpoint replay.

Validation: **174 targeted tests passed**, including all seven pinned `buildHeadingTree` digests. Typecheck passed. Lint reported one existing complexity advisory in the unchanged builder. Doc links: 15 passed, one failed as F14. No full-suite or Postgres run.

Files changed:

- `src/heading-tree.ts`
- `src/types.ts`
- `tests/bounded-heading-tree.test.ts`
- `tests/structure-step-bounded-fallback.test.ts`
- `docs/project/structure-step.md`
- Temporary harness: `/tmp/stage-d-furniture-attack.ts`