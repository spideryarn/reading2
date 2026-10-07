You are reviewing a plan, read-only, in the Spideryarn repo (this worktree). Do not edit files.

The plan: docs/plans/261004k-hide-the-headings-rail-while-structure-or-marginalia-is-on.md

Read it, then check its claims against the code rather than its prose:
src/web/reader/Reader.tsx (`mode`, `bandOpen`, `marginOpen`, `fit`, `bandCovers`, `crumbsRoot`,
`showCrumbs`, `showBar`, `tallCrumbsBar`, `layoutKey`, `marginRoom`, `marginColumn()`, the
`.controls` JSX and `BarStuckSentinel`), src/web/HeadingsCrumbs.tsx, src/web/BarStuckSentinel.tsx,
src/web/scroll.ts (`watchBarStuck`, `controlsBar`, `stickyOffset`),
src/web/marginalia/MarginaliaColumn.tsx (`MarginaliaHead`), src/web/marginalia/notes.ts
(`headPath`), src/web/layout.ts (`fitView`, `margW`), src/web/styles/crumbs.css,
tests/headings-crumbs-wiring.test.tsx, docs/project/experimental-features.md § the breadcrumb.

Questions I most want answered:

1. Are the two conditions the right ones? Is there a state where `mode === "structure"` and the
   band is not actually showing its "you are here" beside the prose, other than the
   `bandCovers` case already handled? Is `marginOpen && fit.margW > 0` exactly when
   `MarginaliaHead` draws its path, apart from the empty-path case the plan names?
2. Does hiding the breadcrumb on these states break anything that assumes the bar is present:
   scroll offsets, `?at=` restore, `layoutKey`, `data-bar-stuck`, crumbs.css rules keyed on
   `:has(.crumbs)`, the narrow-window taller bar? Any flicker or loop, e.g. `fit` depending on
   something `showCrumbs` changes?
3. Is the "known, and left" list honest: is the empty-head gap as small as the plan says?
4. Is there a simpler design I passed over wrongly, or a product tweak worth asking Greg about?
5. Are the planned tests able to go red for the right reason in jsdom (no layout; `pageWidth`
   falls back to `innerWidth`)? What widths give `fit.margW > 0` and `=== 0`?

Give findings as P0/P1/P2, each with an ID and file:line evidence, and end with one line:
`VERDICT: approve`, `VERDICT: approve with changes`, or `VERDICT: rework`.
