The core rail/card implementation is sound, and I found no blocker: `hereHit` is logically correct after effects settle; the two armed-state effects do not loop; the one-shot scroll listener neither leaks nor double-fires; keyboard depth, crumb ellipsis, mode-band offset, and Outline’s uncontrolled tooltips remain correct. I would still not land yet: six should-fixes remain, mostly places where the tests certify less than their names claim. Shipping 12px without the touch overhang is reasonable—the documented reveal-first trade is preferable to adding an untested hit-map overlay.

## Blockers

None.

## Should-fix

1. **`hereHit` partially defeats the scroll optimization, while the performance test silently passes.**  
   [Spine.tsx:326](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Spine.tsx:326), [Spine.tsx:373](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Spine.tsx:373), [spine-scroll.test.ts:69](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/spine-scroll.test.ts:69)

   Every section crossing now re-renders the entire Spine, not merely every part crossing. The existing performance test gives both parts `children: []`, so `hits === l1`; its “within one part must not re-render” assertion cannot encounter an L2 boundary.

   The identity guard prevents `useDelayGroup`’s repeated closes from corrupting `armed`, but the fresh handlers still make its layout effects run again while the group is active.

   Either accept this cost, update the scroll documentation, add real L2s to the performance test, and measure a long article—or keep `hereHit` in a ref/DOM attribute and only enter React state while a card is open. Also key the value to `metrics`: after remeasurement, new bands can render for one paint with the previous metrics’ `hereHit`.

2. **The outline-reset effect closes after paint, so the test does not prove “never arrives open.”**  
   [Spine.tsx:487](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Spine.tsx:487), [spine-hover.test.tsx:312](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/spine-hover.test.tsx:312)

   `useEffect` permits the old card to paint once before clearing it. The test then waits 300ms, so even a deliberately delayed close would pass. This effect also currently fails Biome’s dependency rule; its suggested autofix deletes `[outline]` and destroys the behavior.

   Prefer storing the outline identity with `armed` and refusing to open it against another outline. Otherwise use `useLayoutEffect`, add the deliberate-dependency suppression, and test the first committed state rather than the state 300ms later.

   The membership effect itself is correct and terminates after one clearing render. Running on mount is a harmless no-op.

3. **Two real L2 hits still produce blank or indistinguishable cards.**  
   [Spine.tsx:837](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Spine.tsx:837), [Spine.tsx:885](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Spine.tsx:885), [tree.json:770](/Users/greg/Dropbox/dev/experim/spideryarn2/data/revistes-ub-30977/tree.json:770), [spine-card.test.tsx:99](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/spine-card.test.tsx:99)

   The corpus contains two childless depth-2 nodes under “References”: both have empty titles; one has a `navLabel`, one has neither. `BandCard` renders an empty title, and `ariaFor` ignores `navLabel`, giving both buttons effectively the same name.

   Normalize the band’s own label too: title, then `navLabel`, then a positional fallback such as “References — section 1 of 2.” Add these real degradation shapes to the card test. The current fixture gives every band a title and gist.

4. **The geometry test misses the important inclusive-range mutation.**  
   [Spine.tsx:192](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Spine.tsx:192), [spine-card.test.tsx:351](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/spine-card.test.tsx:351)

   The row stub is faithful. The sampled positions are not: every positive assertion lands in the first row of a two-row band. Changing:

   ```ts
   edge(e.endRow + 1)
   ```

   to:

   ```ts
   edge(e.endRow)
   ```

   leaves the suite green while every band loses its final row.

   Add a reading line in the second row of a band, plus one exactly on a boundary to pin the half-open interval.

5. **The width sentinel certifies only the spine-on case; the live spine-off mode crossover disagrees.**  
   [layout.ts:363](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/layout.ts:363), [styles.css:8273](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:8273), [spine-width.test.ts:115](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/spine-width.test.ts:115)

   With the spine on, 844/843 is right. With `?spine=0`, `fitMode` crosses at 832/831, but the unconditional CSS query still overlays the band through 843. Thus widths 832–843 have JS reserving a side band while CSS paints a covering band. Outline measures around this; other modes do not.

   Prefer a runtime class/data attribute derived from `fit.modeW === 0` over another copied breakpoint.

   The source test can also pass with:

   - a fourth derived query lacking a marker;
   - three correct decoy marker/query pairs beside the wrong selectors;
   - a marked query nested inside `@supports`;
   - a later `.reader.spine-on { --spine-w: 0px; }`.

   Build-time comment removal is harmless because the test reads source. The `SMALL_DEVICE` character check should use comment-stripped CSS and an exact occurrence count; currently a commented-out query can satisfy it. A rendered width/layout check remains necessary.

6. **The 12px rail exposes a phone-width logo/title collision.**  
   [styles.css:271](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:271), [styles.css:8199](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:8199), [HomeLogo.tsx:18](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/HomeLogo.tsx:18)

   Below 732px, `--logo-w` is 2.6rem while the masthead shorthand forces 1rem left padding. At a 16px root, the masthead title begins at `12 + 16 = 28px`; the logo’s visible image reaches about 31.2px and its z-indexed link box reaches 41.6px. The old 24px rail happened to clear it.

   Coordinate with the mobile-rule owner and restore the compensation after that shorthand, for example with a narrow-window `max(... calc(--logo-w … --spine-w))`.

## Nits

- Lane thresholds are right: the floor meets at four and exceeds pitch at seven. The prose saying pitch is always `10 / lanes` omits the 5px cap: one and two lanes have 5px pitch and 4px paint. [styles.css:1300](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:1300)
- Several comments still describe the old design: “1.5rem rail,” `armed` being touch-only, tooltips owning mouse state, and the 856px crossover. [Spine.tsx:12](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Spine.tsx:12), [Spine.tsx:294](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Spine.tsx:294), [layout.ts:113](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/layout.ts:113)
- Biome also warns about the comma operator in the new card test. [spine-card.test.tsx:345](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/spine-card.test.tsx:345)

Checks: the six scoped files passed 156/156 tests; `spine-scroll.test.ts` passed its two vacuous cases. The full suite reached 5516/5518, with two unrelated concurrent `rawSha256` store failures. Web TypeScript passed; the tests project has one unrelated concurrent type error.