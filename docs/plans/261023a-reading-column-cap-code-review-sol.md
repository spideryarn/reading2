Verdict: **ship with fixes**

1. `tests/structure-band-width.test.ts:92` — moving the last sample from 1165 to 1108 moves this regression test off Structure's 1165px two-column switch. If Structure's 609px branch leaked into an ordinary mode at that switch, this test would still pass. Keep the 1108 boundary assertion, but also assert the ordinary band is its intended 457px at 1165 (not Structure's 609px).
2. `src/web/layout.ts:158` — “no band” and “nothing changes below 1109px” are false. At 1194px Structure is 638px, wider than Tweets' 496px; at 1024px Marginalia's gap changes 135→121, and a lone cell changes above 708px. The same overclaim appears in `docs/plans/261023a-reading-column-cap-a-middle-value.md:38`, `docs/user-feedback/questions/q-z3j0ep.md:44`, and `docs/user-feedback/261021_2302-reading-measure-in-real-characters.md:45`. Qualify these claims as about the standard band. The old first-widened pixel was 1221, not 1220: at 1220 the band was still 400px.
3. `src/web/layout.ts:1016` — the PROSE_MIN failure example ignores `wideIdeal(9)`. Before the fix, 844px/root 9 produced a 306px band and 526px prose, not 430 + 402; the test at `tests/layout.test.ts:369` repeats it. The test is sound and would have been red, but the recorded failure scenario is wrong. `src/web/layout.ts:1002` also still calls the deliberately loose 42rem cap “the measure, its pad and the gutter.”
4. `docs/plans/261023a-reading-column-cap-a-middle-value.md:70` — the built-change record says the slack tests stay `it.fails`, but both correctly became ordinary tests; it also describes the sampled line-length counter as every window from 1000px. A future maintainer could restore `it.fails` or mistake samples at 1194/1440 for a width sweep. `docs/project/marginalia.md:118` similarly says the card width did not change while recording 282→338; only its sizing rule stayed unchanged.

Checks before fixes:

- Focused Vitest command: 8 files, 208 tests passed.
- `npm run typecheck`: could not start because this sandbox denies tsx's local IPC socket (`listen EPERM`). The equivalent `node --import tsx scripts/typecheck.ts` completed successfully: all four projects passed and all 3934 source files were covered.

## Fixes made

1. `tests/structure-band-width.test.ts:92`, `tests/structure-band-width.test.ts:104` — kept the 1108 last-unchanged boundary and added the missing 1165 switch assertion: standard 457px, Structure 609px.
2. `src/web/layout.ts:159`, `docs/plans/261023a-reading-column-cap-a-middle-value.md:38`, `docs/user-feedback/questions/q-z3j0ep.md:44`, and `docs/user-feedback/261021_2302-reading-measure-in-real-characters.md:45` — scoped the iPad/1024/1109 claims to the standard band.
3. `src/web/layout.ts:1003`, `src/web/layout.ts:1017`, `tests/layout.test.ts:369`, and `docs/plans/261023a-reading-column-cap-a-middle-value.md:58` — described the cap as deliberately loose and corrected the old small-root failure to 306px band + 526px prose.
4. `docs/plans/261023a-reading-column-cap-a-middle-value.md:69` — recorded the ordinary 10rem slack tests and the counter's actual sampled windows.
5. `docs/project/marginalia.md:118` — distinguished the unchanged card sizing rule/cap from its changed rendered width.
6. `src/web/layout.ts:1013`, `docs/project/narrow-windows.md:143`, and `docs/user-feedback/questions/q-z3j0ep.md:46` — corrected the old first-widened standard-band pixel from 1220 to 1221.

Mutation checks: removing the wide-band lower-bound fix failed `wide ≥ standard`; removing the `PROSE_MIN` floor failed at 703px/root 9; restoring the 49rem cap failed both 10rem slack tests.

Checks after fixes:

- Requested focused Vitest command: 8 files, 209 tests passed.
- The exact `npm run typecheck` remains blocked by the sandbox's tsx IPC `listen EPERM`; `node --import tsx scripts/typecheck.ts` passed all four projects and covered all 3934 source files.
- Scoped Biome check found the existing complexity advisory and `before(...)` false-positive hook diagnostic in `tests/layout.test.ts`; neither is introduced by these comment-only edits to that file.
