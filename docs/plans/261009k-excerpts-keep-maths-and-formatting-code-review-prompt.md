# Code review: excerpts drawn from the block's own markup (261009k)

You are reviewing, and fixing, code in the repo at the current directory (a git worktree; TypeScript,
React client in src/web/). Read CLAUDE.md's "The one contract that matters", docs/project/security-map.md,
and the plan docs/plans/261009k-excerpts-keep-maths-and-formatting.md first. You reviewed this plan
before it was built — your findings are docs/plans/261009k-excerpts-keep-maths-and-formatting-plan-review-sol.md,
and § Plan review in the plan says what was done with each.

The change: `git diff origin/dev...HEAD -- src tests docs/project` (two commits, ec92f91ea and 3488ca196).
Core: src/web/excerpt-html.ts, src/web/Excerpt.tsx, src/web/block-link-index.ts,
src/web/maths-provenance.ts, src/web/maths.ts. Then ~30 call sites converting a plain string to
`<Excerpt blockId words near? />`.

## What to look for
1. Correctness of excerpt-html.ts: the per-block parse cache (`parses`) and result cache (`cache`) —
   can a cached tree be mutated, can a stale result be served after a block changes (blocks are
   replaced, not mutated, on each load?), is the `near` offset space right at each call site that
   passes one (Found.start, comment.start, anchor.start, asked.start), `withAncestors`, `inertMath`
   (iterating `querySelectorAll` while replacing nodes), the plain-words shortcut in `finish` that
   skips the policy, widening at TeX span boundaries.
2. Safety: anything that can carry an id / data-spya-* / href / handler / style into an excerpt, or
   any serialise→reparse difference. The `finish` shortcut returns serialised text-only html without
   the policy pass — confirm that is sound.
3. Each call site: is the string really the article's words; is the block id the right block; is
   anything now inside a context that needs a string (attribute, aria, clipboard, measured length);
   did any visible behaviour change (ellipses, quotation marks, the "Whole paragraph" fallbacks).
4. The twelve tests moved to `@vitest-environment jsdom` because a panel's import graph now reaches
   src/web/sanitize.ts (DOMPurify(window) at module load). The plan explains why the alternatives
   were passed over; say whether you agree. Do NOT edit src/web/sanitize.ts or src/sanitize-policy.ts
   (defences — report instead).
5. Tests: are the new tests in tests/excerpt-html.test.ts and tests/skim-panel.test.tsx
   (search "spya-pqae7m") meaningful; anything important untested.

## How
Fix what you find **inside this change** directly (edit the files), keeping to the surrounding code's
style and comment density. Run `npm run typecheck` and the relevant vitest files
(`npx vitest run tests/excerpt-html.test.ts tests/skim-panel.test.tsx` plus any suite for a file you
touch). Do not commit, do not run git commands that change state. Report anything wider than this
change for me to decide.

Write your answer as: a numbered list of findings (severity high/medium/low, file:line, what you did
or why you left it), the commands you ran and their results, and a final one-line verdict:
"ship", "ship after my fixes", or "do not ship".
