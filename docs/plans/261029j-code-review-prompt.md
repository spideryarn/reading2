Code review of plan docs/plans/261029j-explained-passages-underlined-in-the-prose.md (read it,
including the section recording your plan review and what changed). The diff is
docs/plans/261029j-code-review.diff (working tree vs HEAD; the new test is
tests/explained-prose.test.tsx, untracked). Read the touched files in full where it matters:
src/web/annotate.ts, src/web/TableView.tsx, src/web/ProseHoverCard.tsx, src/web/useHoverCard.ts,
src/web/marginalia/MarginaliaColumn.tsx, src/web/reader/Reader.tsx, src/web/styles/annotations.css,
src/web/styles/tokens.css, src/web/DesignPage.tsx.

Look for real defects: hover/tap/focus precedence between explained and term/cite/quote/link/
comment/chat/xref marks; the :where() CSS approach (does any author rule now beat it that should
not, e.g. quote fill or highlight colour losing/keeping the border wrongly; light theme); the
ExplanationsFeed refresh-on-band-open effect (double GETs, races, React StrictMode double effects);
owner/visitor/switch-off leaks; memo/cache keys; anything that passes tests but ships broken.

You may fix what you find directly in the worktree, keeping the surrounding style (comment density,
naming). Run `npx vitest run tests/explained-prose.test.tsx tests/annotate.test.ts
tests/xref-prose.test.tsx tests/citation-hover-card.test.tsx tests/quote-hover-card.test.tsx
tests/hover-card-touch.test.tsx` and `npm run typecheck` after any fix. Do not commit, do not
touch git state. Report: each finding (severity, file:line, scenario), what you changed, and
anything wider you did not change.
