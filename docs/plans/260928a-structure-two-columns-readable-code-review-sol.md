Implemented three in-scope fixes. No P0 findings.

1. **P1 — fit and face could disagree after a root-font change.** Structure independently reread the DOM root size, while layout used `useRootFontPx`; the effect also ignored root-size changes when the band width stayed fixed. I now pass the same measured value through [Reader.tsx:1663](/src/web/reader/Reader.tsx:1663) and re-evaluate on it in [StructureMode.tsx:195](/src/web/modes/structure/StructureMode.tsx:195). Added a fixed-width 16→20px regression test.

2. **P1 — very small root sizes overlapped the ordinary band range.** Below roughly 7.5px, the calculated column minimum fell below `MODE_MIN`, allowing an ordinary band to be interpreted as columns. [layout.ts:297](/src/web/layout.ts:297) now floors the column threshold at `MODE_IDEAL + 1`; normal documented values remain 609/705px. The sweep now covers 5–32px roots, both spine states, and actual covering-band widths in [structure-band-width.test.ts:135](/tests/structure-band-width.test.ts:135).

3. **P2 — moving the gist into the grid introduced an unintended vertical gap.** `.struct-line { gap: 0.4rem }` began applying 0.4rem between title and gist in addition to the gist margin. Changed it to `column-gap` in [structure-mode.css:306](/src/web/styles/structure-mode.css:306), with a CSS regression test. The card’s projection/subtraction logic and measuring markup remain shared and its tests pass. I also corrected the obsolete 389px/covering-columns comment in [tooltip.css:113](/src/web/styles/tooltip.css:113).

4. **P2 — “exactly one highlighted row before the first part” is not the projection’s contract.** Before/between parts, `currentPart` is deliberately `null`; selecting the first part would invent a location ([structure.ts:518](/src/web/structure.ts:518)). Therefore the selector matches zero rows there, not one. I did not change that semantic. Tests now prove one identical deepest row in visible/measuring copies for current-section and undivided/apparatus-shaped states, and zero before the first part: [structure-panel-draws-both-columns.test.tsx:251](/tests/structure-panel-draws-both-columns.test.tsx:251).

No wider issue found:

- Herald, shell, sticky bars and return chip consume `--mode-w` directly; fisheye panels have no columns in Structure; the design page’s 288px is explicitly a standard-band specimen.
- The four project docs correctly state 609/705px, 1165px with the rail, 1153px without, and covering-band=list. The browser measurements agree with the code. The `column-gap` fix only removes unintended vertical space, so it does not invalidate measured widths, characters per line, fonts or colours.

Checks:

- Requested Vitest command: **7 files passed, 108 tests passed**.
- `npm run typecheck`: the `tsx` launcher was blocked before execution by sandbox IPC permissions (`listen EPERM /tmp/tsx-1000/14.pipe`).
- Same repository checker without the IPC launcher, `node --import tsx scripts/typecheck.ts`: **passed all four projects; all 2,225 source files covered**.
- `git diff --check`: passed.
- No commit made; pre-existing plan/review working files were preserved.

APPROVE WITH CHANGES (made)