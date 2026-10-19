Review this plan, read-only: docs/plans/261019a-reopen-lands-on-the-paragraph-you-were-reading.md
(repo root is the current directory). It answers a reader report and fixes a measured drift bug.

Read the code it touches before judging: src/web/reader/useReadingPosition.ts, src/web/position.ts
(positionToWrite), src/web/scroll.ts (scrollToBlock, glide, cancel, the arrival anchor ~line 900-1010,
abandonScroll), src/web/flash.ts (keepAligned, READER_INPUT, scrollToAndFlash), src/web/last-view.ts
(useLastView, save, rememberableSearch, restoredHref), src/web/fold.ts (visibleNear), src/web/rows.ts,
src/web/fonts.ts, docs/project/url-state.md § Reopening an article where you left it,
docs/postmortems/261002b-*.md.

Find what is wrong or missing: races between the hold, the spy, the layoutKey re-anchor
(useLayoutEffect in useReadingPosition), glide's corrective frame and nuqs's debounced write; whether the
hold's end conditions are right (could it fight a reader, e.g. scrollbar drag, keyboard, a band opening,
Back/Forward, a jump via jumpTo/returnToOrigin, the Skim/centred arrivals and holdAnchor); whether
"no cap" is safe; whether stage 2's {at, block} note and substitution in last-view is sound (timing
against the 300ms debounce, folded rows, the masthead echo, front-matter stretches, atTop, a different
reader, metadata view, a first open), and whether a restored paragraph in ?at= interacts badly with
anything that reads `at` (Reader.tsx usages, ReturnChip, Skim's `q.has("at")`, shared links). Also say if
a simpler design would do. Give numbered findings, each with severity, evidence (file:line) and the fix
you'd make. End with a verdict: BUILD AS IS / BUILD AFTER FIXES / RETHINK.
