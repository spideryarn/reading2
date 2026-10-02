You are reviewing a plan for the Spideryarn repo (a reading web app), read-only. Repo root is the current directory.

Read the plan: docs/plans/261002a-horizontal-scrollbar-wider-band-on-wide-windows-archive-button-on-the-masthead.md

It covers three of the owner's feedback reports: (1) a horizontal scrollbar on a Mac with classic scrollbars, (2) a wider mode band on wide windows, (3) an Archive button on the reading view's masthead. A first build already exists on this branch; the scoped diff against origin/dev is docs/plans/261002a-code-review.diff — use it as evidence of what the plan means, but this pass is about the DESIGN.

Please check, and be concrete (file:line, numbers):

1. Scrollbar: is the root cause right? Read src/web/reader/measure.ts, docs/postmortems/260912b-a-layout-read-from-a-number-that-means-a-different-viewport-on-ios.md, tests/layout-viewport-width.test.tsx, src/web/styles/shell.css (.masthead, .controls), dock.css (.dock), narrow-window.css (covering band). Is switching useWindowWidth to the root clientWidth safe on iOS (zoomed and not), Android, and desktop with overlay scrollbars? Can the new ResizeObserver on documentElement loop or thrash (e.g. a page whose height straddles the window so the vertical scrollbar flips)? Are there other boxes sized from 100vw or innerWidth in the reading view that will still overflow beside a classic scrollbar? Does anything else (SmallScreenHint, bandCoversProse, ViewportProbe, Structure face, dock-fit) now disagree with the layout width in a way that matters?
2. Band: read src/web/layout.ts bandWidth / fitMode / fitBoth / proseAloneMaxPx / wideIdeal. Is "the band takes what the prose cell has beyond proseAloneMaxPx, capped at wideIdeal" correct and is it really a no-op below the crossover? Anything that consumes the band width (Marginalia notesFit, Structure, dock-fit ladder, tooltips, chat input, band header) that a 544px band would break?
3. Archive: read src/web/useArchive.ts, src/web/Masthead.tsx (ArchiveMark), src/types.ts (Article.archivedAt), src/store/pg.ts (the projection), src/web/article/access.ts (public arm). Is archivedAt kept away from visitors on every path (public DTO src/public/dto.ts, export, feedback-article.ts, any cache like an offline saved copy)? Is the "keyed on slug" claim correct? Is the stale-payload case right (archive here, then navigate away and back — does the article payload come from a cache that would show the old state)?
4. Anything simpler that would do as well.

Reply with a numbered list of findings, each tagged P0/P1/P2/P3, with the evidence and the fix you recommend. End with a one-line verdict.
