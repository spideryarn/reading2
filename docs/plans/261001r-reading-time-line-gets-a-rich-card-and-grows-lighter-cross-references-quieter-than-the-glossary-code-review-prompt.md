You are reviewing the code built from a plan in the Spideryarn repo (this worktree), and you may fix what you find.

Plan (with your own plan review folded in at the end): docs/plans/261001r-reading-time-line-gets-a-rich-card-and-grows-lighter-cross-references-quieter-than-the-glossary.md

The change is exactly commit abe1d662c: `git show abe1d662c`. Files: src/web/BlockLinkCard.tsx (READING_LINE selector, ReadingCard, referenceFor virtual reference, aria-hidden guard, tip-soon vs tip-cite class), src/web/BlockGutter.tsx (title removed), src/web/styles/gutter.css (opacity ramp), src/web/styles/annotations.css (mark.term 2px/70%, mark.cmt.term width, mark.xref thin solid grey), tests/reading-time-card.test.tsx (new), tests/block-gutter.test.tsx, tests/gutter-target-size.test.ts, and five docs.

Look hard for:
1. Bugs in the delegated card: does the virtual reference work with Floating UI's useFloating/autoUpdate/arrow (setPositionReference with {getBoundingClientRect, contextElement})? Does `focusIn`'s show(el) without clientY behave? Does the open-card refresh effect (index/resolveXref change) keep the reading card correct? Is `pointerout` from the strip handled (the strip's relatedTarget is usually the table cell)? Anything that makes the existing link card behave differently than before?
2. The reading card's words against the code (useReadingTime.ts, Reader.tsx): every claim true?
3. CSS: the opacity calc is valid CSS (unitless custom property multiplication inside calc), zero at level 0; the annotation overlaps (term+xref, cite+xref, cmt+term) render as the plan says.
4. Tests: would each new or changed assertion have gone red before the change? Any test that passes vacuously?
5. Docs: anything false or contradicting another doc (tooltips.md new section, reading-time.md, cross-references.md, glossary.md, design-css-overview.md).

Fix what is inside this change directly (keep the repo's comment style, never run a formatter, do not commit). Then run: npx vitest run tests/reading-time-card.test.tsx tests/block-gutter.test.tsx tests/gutter-target-size.test.ts tests/block-link-card.test.tsx tests/xref-prose.test.tsx and npm run typecheck.

Answer with numbered findings (severity P0-P3, file:line, what you changed or why you didn't), anything wider for me to decide, and the gate results.
