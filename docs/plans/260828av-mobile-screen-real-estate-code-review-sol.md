# Verdict: STOP

The eight advertised edits are present, and the two central arithmetic fixes are correct. But `viewport-fit=cover` still leaves real installed-app collisions, plus the install hint covers live content.

## Ship blockers

1. **Installed non-reader pages collide with the shifted logo.**

   `.logo-home` now occupies `safe-top … safe-top + 44px` ([styles.css:2799](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:2799)), but Metadata, Tweets, and public pages retain a fixed `pt-14` = 56px ([Metadata.tsx:451](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Metadata.tsx:451), [Tweets.tsx:283](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Tweets.tsx:283), [PublicPages.tsx:65](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/PublicPages.tsx:65)).

   With `safe-top=47`, the logo covers y=47–91 while the back link starts around y=56: roughly 35px of overlap. Other global pages have the same app-wide omission. `viewport-fit=cover` changed the whole document, but only the reader shell received a top-inset audit.

2. **The install hint has no layout clearance.**

   It is fixed above the dock ([styles.css:2602](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:2602)), while `.reader` reserves only `--dock-space` ([styles.css:2588](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:2588)) and `.mode-band` also stops only above the dock ([styles.css:3215](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:3215)).

   Therefore the hint overlays article lines and, more reliably, the bottom of every open mode panel. At 390px it may wrap and cover more than one line. `safe-bottom=40` moves both dock and hint upward correctly but does not reserve the hint’s height.

3. **Horizontal safe-area coverage is incomplete.**

   - `.reader` starts after `--safe-left`, but pinned cells still use `left: spine + mode`, omitting the inset ([styles.css:607](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:607)). Above the 760px unpinning breakpoint, horizontal scrolling pins them exactly 40px too far left when `safe-left=40`.
   - `.cmt-dialog`, `.chat-dialog`, and `.annotate-dialog` remain `right:1.25rem` with widths based on the whole viewport ([styles.css:1827](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:1827), [styles.css:6819](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:6819), [styles.css:6845](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:6845)). With `safe-right=40`, their outer controls can enter the unsafe strip.
   - Non-reader wrappers use ordinary `px-6` rather than side insets, affecting narrower landscape phones.

## The eight claimed fixes

1. **`stickyOffset`: correct.** Ceiling is `rect.height + safeTop` ([scroll.ts:123](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/scroll.ts:123)).

2. **`dockOffset`: correct.** `Math.max(0, innerHeight - rect.top)` measures visible coverage ([scroll.ts:51](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/scroll.ts:51)).

3. **Safe-area threading: mechanically present on every named selector, but incomplete app-wide** as above.

4. **Width budget: correct; the inset is not counted twice.**

   Let physical width be `W` and horizontal inset `S`. `fitView` receives `W-S`. Its `minWidth` covers table + spine/mode. Because `.reader` is `border-box`, its border-box must additionally contain the new inset padding: `fit.minWidth + S = W`. The addition at [App.tsx:1719](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/App.tsx:1719) is right.

5. **Eleven-button behavior: correct.** Eight modes plus Comments, Tweets, Metadata. The row necessarily scrolls. Several comments still falsely say “nine” ([Dock.tsx:481](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Dock.tsx:481), [styles.css:7921](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:7921)).

6. **`max(--dock-bottom, --safe-bottom)`: correct** on mode band and overflow fade.

7. **`:has()` specificity: correct.** The most specific argument is `.dock:focus-within`; with `:root`, the selector is `(0,3,0)` ([styles.css:8119](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:8119)).

8. **`--dock-space` migration: correct.** All functional consumers were migrated, including the three page clearances and preview. Remaining `--dock-h` hits are definitions or stale comments.

## CSS at safe=0 and safe=40

The following arithmetic is correct at both values:

- Masthead, controls and mode-band widths exclude both side insets.
- Masthead top padding grows by exactly `safe-top`.
- Controls rest at `top=safe-top`; their transform is 0 at rest and `-bar-h` hidden.
- Spine clears top, left and bottom unsafe regions.
- Dock height becomes `dock-h + safe-bottom`, with the extra amount used as bottom padding.
- The narrow dock’s `padding-left/right` longhands do **not** reset `padding-bottom`; your understanding is correct.
- Drawer, hint and logo move clear of their named edges.
- Dialog bottom clearance correctly uses resting `--dock-space`.

One pre-existing defect remains in the touched masthead rule: base `padding-left` reserves the logo ([styles.css:301](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:301)), but the narrow shorthand resets it to `1rem` ([styles.css:7903](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:7903)). With the narrow `--logo-w:2.6rem`, the title overlaps the logo by 0.1rem and stops aligning with controls by 1.6rem. Adding safe-left shifts both together, so the defect is unchanged at 40px.

## `stickyOffset` numbers

With `safe-top=47`, `bar-h=44`, and the normal 40px table head:

- Not yet stuck: bar prediction 91; total **131px**.
- Stuck at rest: measured bottom 91; total **131px**.
- Hidden: transformed bottom 47; total **87px**.

Those are correct. Hidden still needs to clear the 47px system area, not zero.

## Dock hiding

The named guard protects dock focus, drawer presence and hint focus. I found no confirmed state where the dock hides while one of those is actively used.

It does not cover `.cmt-dialog`, `.chat-dialog`, or `.annotate-dialog`. A dialog can open while bars are already hidden, and focusing it does not restore them. The dialog nevertheless remains anchored to resting `--dock-space`, leaving a phantom gap—about 98px with a 52px dock, 34px bottom inset and 12px gutter. This is a real UX cost, though less severe than a control disappearing mid-press.

## Safe-area probe

The measurement technique is fundamentally sound. `getComputedStyle()` returns resolved values, and padding is reported in used pixels; `visibility:hidden` still creates a box, unlike `display:none`. An unsupported `env()` declaration normally yields computed default padding rather than an unresolved token. [MDN documents the resolved-value behavior](https://developer.mozilla.org/en-US/docs/Web/API/Window/getComputedStyle), while [WebKit explicitly supports safe-area `env()` values in padding](https://webkit.org/blog/7929/designing-websites-for-iphone-x/).

Caveats:

- A WebKit bug can still expose the wrong inset—there is an unresolved report of safe-area values returning zero—so “a probe cannot be wrong” is too absolute. It cannot correct browser data. [WebKit bug 274773](https://bugs.webkit.org/show_bug.cgi?id=274773)
- No caching is defensible for correctness, but the justification is overstated: JS only consumes top and horizontal insets, not the dynamic bottom inset. Re-reading on every `stickyOffset` and every Reader render is probably unnecessary; performance impact is speculative.
- There is no reentrancy problem. `safeAreaInsets()` itself is SSR-guarded.
- It does append the probe during a React lazy initializer/render, under Strict Mode. That is an impure render side effect, although `isConnected` prevents duplicate probes.
- `useWindowWidth` itself is not SSR-safe because it reads `window` before the probe guard; this app currently does no SSR.

## Install hint

Reading the environment once is defensible: display mode and platform do not normally change inside one browsing context. Cross-tab dismissal and a trackpad becoming primary input are the missed dynamic cases, but neither warrants listeners here.

The iPad heuristic is the standard practical one: explicit `iPad`, or desktop-style `Macintosh` plus multiple touch points. It remains UA heuristics, not proof.

Yes, the hint can show to somebody who has already installed:

- `navigator.standalone` and `display-mode` reveal the **current window’s mode**, not installation history.
- Returning to the ordinary browser after installation still reports browser mode.
- Apple says Home Screen web apps have storage separate from the browser, so standalone state cannot reliably set the browser tab’s dismissal flag. [Apple WWDC23](https://developer.apple.com/videos/play/wwdc2023/10120/)

Thus the component prevents the hint inside the installed app, but cannot reliably prevent it in a browser where the app is already installed.

## Test theatre

- Meaningful: the hidden and beyond-viewport `dockOffset` tests fail against the old height implementation.
- Theatre for this regression: resting dock and absent dock both pass the old implementation.
- `shouldOfferInstall` tests only the pure conjunction. They can all pass with broken iPad detection, broken `matchMedia`, broken storage, or a component that never renders.
- The safe-area zero test passes against `return NO_INSETS`.
- The “real pixels” probe test verifies CSSOM plumbing and parsing, but never exercises `env()`, visibility, zero-size layout, rotation, or real safe areas.
- There is no test for `stickyOffset`, width subtraction/add-back, any safe-area CSS, dock tokens, eleven buttons, hint layout, environment detection, or dismissal.

## Other phone defect

`OfflineStrip` is fixed to all physical edges without safe insets ([OfflineStrip.tsx:49](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/OfflineStrip.tsx:49)). It is also below the dock in stacking order, so the visible dock covers it; when the dock hides, it emerges behind the home-indicator area. That is exactly an installed/offline path.

No files were changed. Vitest could not start because the read-only environment blocked its `.vite-temp` write. Direct TypeScript checking found concurrent unrelated failures in `TableView.tsx`, `chat/effects.ts`, and admin tests; the root project itself passed.