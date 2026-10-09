# Plan review: excerpts drawn from the block's own markup (261009k)

You are reviewing a plan, read-only, in the repo at the current directory (TypeScript; React client in src/web/). Read CLAUDE.md's "The one contract that matters" and docs/project/security-map.md first.

The plan: docs/plans/261009k-excerpts-keep-maths-and-formatting.md. Stage 1 is already built — review the code as part of the plan, because it fixes the design the remaining stage rolls out:

- src/web/excerpt.ts (new) — `excerptHtml`, `excerptFallbackHtml`
- src/web/Excerpt.tsx (new) — the component
- src/web/maths-provenance.ts, src/web/maths.ts — `RENDERED_MATHS` now holds `{ html, render }`
- src/web/BlockLinkCard.tsx — index entries carry `block`
- src/web/SkimPanel.tsx, src/web/modes/skim/SkimMode.tsx — Skim rows drawn through `<Excerpt>`
- tests/excerpt.test.ts, tests/skim-panel.test.tsx (the spya-pqae7m case)

`git diff origin/dev -- src tests` shows the change.

Please judge, with concrete failure scenarios where you can:
1. Correctness of locating words and cloning the range: the two offset spaces (pre-maths html vs drawn html), whitespace (block.text collapses whitespace; findQuote's forgiving pass), widening out of TeX spans and existing <math>, range ends at node boundaries, nested block boundaries.
2. Safety: can anything in the output carry an id / data-spya-* / href / event handler / style, or survive serialise→re-parse differently (mXSS) given the inert document, the bare recreation, cloned <math> subtrees, and the final sanitizeBlockHtml pass? Does keeping a renderer function and pre-maths html on a block via the symbol create any risk?
3. The rollout list in stage 2: anything wrong to convert (e.g. inside a button, a <q>, a textarea, an aria-label/title attribute string context where JSX needs a string not an element), anything missed, anything where the Excerpt fallback would change behaviour visibly.
4. Whether a simpler design would do the same job.
5. Performance in long lists (Search with hundreds of hits, Quotes with 60 rows).

Write findings as a numbered list with severity (high/medium/low), file:line, and a suggested fix. End with a one-line verdict: "proceed", "proceed with changes", or "rethink".
