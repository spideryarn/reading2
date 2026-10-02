You are reviewing a plan (read-only) for the Spideryarn reading view, in this repo.

Plan: docs/plans/261002e-collapsible-headings-and-fold-all.md — read it in full, including Greg's request at the top.

Check it against the code. In particular:
1. The central claim: every jump to a prose block goes through `scrollToBlock` in src/web/scroll.ts, so a `revealBlock(id)` there unfolds anything a jump targets. Find any path that brings a block on screen WITHOUT scrollToBlock (flash.ts, comment-jump.ts, internal-links.ts, router.ts, useReadingPosition.ts restore, TermJump.tsx, Spine.tsx, DiagramPanel, SkimMode, ReturnChip, jump-history, keynav) and say whether it would leave the reader looking at a folded (zero-height) row.
2. The second claim: hiding a folded row's cells (`tr[data-block=…] > td { display:none }`) leaves every row-measuring consumer working — keynav measureRow/rowTops/activeSectionIndex, Spine.tsx measure(), position.ts reading-position spy and ?at= writing, on-screen.ts, reading-time.ts (time accrued to a zero-height row?), isBlockOnScreen/whereIsBlock, measureOrigin. Look for anything that would now misbehave (e.g. something that assumes a row has height, IntersectionObservers on rows, table.css border-collapse spacing, `tbody tr:first-child` rules, sticky offsets).
3. keynav: is filtering `plan.starts[d]` through isFolded at keypress the right place? Does ← / → in Structure (acrossDepth) or the chain logic break?
4. The chord: Cmd+Opt+T on macOS (Chrome, Safari, Firefox, Arc) and Ctrl+Alt+T on Windows/Linux — does any browser or OS already bind these? Is `e.code === "KeyT"` right? Is a sibling helper in src/web/key-chord.ts the right shape?
5. Where should the chevron go, given the gutter layout in src/web/styles/gutter.css (heading rows: one bottom-aligned slot, absolutely positioned left of the prose) and narrow windows (src/web/styles/narrow-window.css)? Is "left of the gutter" sound? Propose better if not.
6. Is the masthead facts line (src/web/Masthead.tsx) a sensible home for the fold-all control? Better place?
7. The synchronous <style> written by a module store: any problem with SSR-free Vite app, tests (jsdom), article switches, or two TableViews mounted at once?
8. Anything in docs/project/security-map.md this touches (it should touch none).
9. Is there a simpler design that achieves the same thing?

Answer with numbered findings, each: severity (P0/P1/P2/nit), the file:line evidence, and the fix. Be concrete. Say plainly if the plan's claims hold.
