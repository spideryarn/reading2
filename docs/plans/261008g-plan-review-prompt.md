Review the plan docs/plans/261008g-the-way-back-chip-moves-the-position-and-leaves-the-modes-alone.md
for the Spideryarn repo (read-only). Read the code it names: src/web/ReturnChip.tsx, src/web/jump-history.ts,
src/web/router.ts (watchHistoryWrites, stampFor, dismissJumpOrigin, originHref, useJumpStamp),
src/web/reader/useReadingPosition.ts (the restore effect), src/web/reader/Reader.tsx (bandJump, bandAway,
bandOverProse, where ReturnChip/BandBackChip are drawn), node_modules/nuqs/dist/patch-history-*.js,
and tests/return-chip.test.tsx, tests/jump-history.test.ts.

Questions: Is pushing the current address with only ?at= changed, unmarked through the wrapper, then
rewriting the stamp underneath it (like dismissJumpOrigin), correct with nuqs's queue (pending writes,
sync reset)? Will the restore effect reliably move the page (synced.current edge cases, e.g. origin equal
to synced)? Is the v3 stamp with `earlier` (replacing depth) sound, including compatibility with older
bundles and with v2 entries? Is the covering-band edge handled right, and are there other places the
reader cannot see the landing? Anything the plan misses (spine mark useJumpOrigin, keyboard, help text,
docs that describe history.go)? Is the simpler option (drop the chain) actually better?

Write numbered findings with severity and a final verdict line: VERDICT: <ship plan as is | revise>.
