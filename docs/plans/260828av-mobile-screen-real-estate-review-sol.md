# Verdict: STOP — the plan is not ready to build

The central CSS transform is correct, but its JavaScript measurements are not. Several platform and dock-width claims are also false.

One caveat: `styles.css`, `index.html`, and the manifest changed concurrently during this review. The findings cover both the original rules and the draft diff; line links point to the latest snapshot inspected.

## Blockers

1. **`stickyOffset()` breaks with non-zero `--safe-top`.**

The proposed controls arithmetic is sound:

- Resting: `bar-bottom - bar-h - safe-top = 0`
- Hidden: `safe-top - bar-h - safe-top = -bar-h`

So `.controls` rests at `top: safe-top` and translates upward by exactly the bar height.

The CSS consumers—table heading, gist sticky, spine, fade and mode band—also remain geometrically correct. But the “no consumer edits” wording is false because `.controls` itself is being edited.

More importantly, [`stickyOffset()`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/scroll.ts:53) clamps `rect.bottom` to `rect.height`. At rest it therefore returns `barHeight`, while the actual obstruction ends at `safeTop + barHeight`. Jumps land `safeTop` pixels underneath the controls.

When hidden, it returns `min(barHeight, safeTop)`, which is also wrong when `safeTop > barHeight`.

2. **`dockOffset()` has the equivalent transformed-element bug.**

[`dockOffset()`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/scroll.ts:29) returns `getBoundingClientRect().height`. A transform moves the dock but does not reduce that height. Screenful stepping at [`scroll.ts:506`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/scroll.ts:506) will continue subtracting the whole hidden dock.

Therefore the plan’s “No JavaScript changes” claim at [`260828av-mobile-screen-real-estate.md:159`](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260828av-mobile-screen-real-estate.md:159) is false.

3. **Loudly: `viewport-fit=cover` is not inert in ordinary browser tabs.**

WebKit explicitly documents that `cover` lays content out across the full screen, requiring safe-area insets to avoid the notch and home indicator. [WebKit’s iPhone X guidance](https://webkit.org/blog/7929/designing-websites-for-iphone-x/) WWDC21 also describes the bottom inset changing as Safari’s tab bar minimizes and landscape content extending sideways. [WWDC21 Safari design session](https://developer.apple.com/videos/play/wwdc2021/10029/)

The defensible matrix is:

| Context | Portrait | Landscape |
|---|---|---|
| Safari tab | Side insets usually zero. Bottom can be non-zero and dynamic with browser UI/home indicator; do not promise top/bottom zero. | Notch-side inset is non-zero on affected devices; bottom may also be non-zero/dynamic. |
| Chrome-iOS tab | Side insets usually zero. Top/bottom depend on Chrome, OS, device and toolbar state. | Side unsafe areas occur on notched devices with `cover`; bottom is not safely assumed zero. |
| Standalone app | Usually non-zero top and bottom on notched/home-indicator phones. | Side and bottom insets; top depends on device/status-bar behaviour. |

The assertion at [`260828av-mobile-screen-real-estate.md:139`](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260828av-mobile-screen-real-estate.md:139) that all insets are zero outside an installed app must go.

4. **The horizontal safe-area arithmetic exceeds the layout budget.**

[`fitView()`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/layout.ts:247) already allocates essentially all of `window.innerWidth`, with its resulting `minWidth` covering spine plus table at [`layout.ts:315`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/layout.ts:315). Adding left/right padding to `.reader` without subtracting those insets from the available width produces horizontal overflow.

The pinned left table column also still calculates its position without `safe-left`, and the dock itself needs side insets in landscape.

5. **The 390px dock calculation uses the wrong button count.**

There are eight modes in [`Dock.tsx:288`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Dock.tsx:288), followed by Comments, Tweets and Metadata: eleven buttons, not nine.

At the proposed minimum:

```text
11 × 40px = 440px
```

That excludes dock padding, gaps, `.dock-modes` margins, borders, the Comments chevron and badge. The practical minimum is at least roughly 470px. It necessarily scrolls at 390px.

The old silent-clipping bug is not recreated: `.dock-modes { flex: none }` makes the inner group expand and the outer dock scroll. But the narrow rule `.dock > *:not(.dock-gap) { flex: none }` overrides the direct buttons, so the proposed flex does not evenly distribute the whole row.

## High-severity findings

6. **Hidden `--dock-bottom: 0` puts controls in the unsafe area.**

The interactive mode band uses `bottom: var(--dock-bottom)`. Setting that to zero lets it extend behind the home indicator. The spine also remains `bottom: 0`.

Permanent `.reader` padding alongside a changing mode-band bottom is reasonable in steady state, but:

- `safe-bottom` itself may change with Safari UI, so `--dock-space` is not necessarily stable in a tab.
- The dock slides over 180ms while the mode band and fade snap immediately, producing visible transient desynchronisation.

7. **The drawer `:has()` guard only wins by source order.**

Specificities are:

- `:root[data-bars="hidden"]`: `(0,2,0)`
- `:root:has(.dock-drawer)`: `(0,2,0)`
- `:root:has(.dock:focus-within)`: `(0,3,0)`

So the drawer selector does not have the same `(0,3,0)` strength as the existing focus guard. It works only if placed later. `:has()` itself is supported on the relevant modern Safari baseline. [WebKit Safari 15.4 notes](https://webkit.org/blog/12445/new-webkit-features-in-safari-15-4/), [Selectors specificity](https://www.w3.org/TR/selectors-4/)

8. **Several `--dock-h` consumers are missing from the migration.**

Besides the named comment/chat cases:

- Annotate dialog
- Dock drawer
- [`PublicPages.tsx`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/PublicPages.tsx:31)
- [`Tweets.tsx`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Tweets.tsx:88)
- [`Metadata.tsx`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Metadata.tsx:204)

The non-reader pages currently reserve `dock-h + 2rem`; a common 34px home-indicator inset is already two pixels larger than that extra allowance.

Also watch shorthand ordering: the draft adds `padding-bottom: safe-bottom` to `.dock`, then a later `padding: 0 .4rem` resets it to zero.

9. **The intended swipe path will not hide Spideryarn’s bars.**

Gist stepping calls programmatic `window.scrollTo`, while [`markOurScroll()`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/scroll.ts:330) tells [`watchBarVisibility()`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/scroll.ts:203) to ignore that scrolling. A landscape reader using the app’s primary gesture can therefore keep both bars visible indefinitely.

## Platform claims requiring correction

10. **“Only installation can remove Chrome’s remaining toolbar” is too strong.**

A webpage has no direct toolbar-hiding API. But current Chromium code and tests include fully hidden toolbar state, user-scroll hiding, and a native “Hide Toolbars” action. [Chromium fullscreen controller](https://chromium.googlesource.com/chromium/src/%2B/5731dd81944fabdf837f5fa473cfb1fe7ad90dd7/ios/chrome/browser/ui/fullscreen/fullscreen_controller.h), [Chromium iOS tests](https://chromium.googlesource.com/chromium/src/%2B/ebffce60c38b4a29e55d78b0092f1a43f52faf9c/ios/chrome/browser/fullscreen/ui_bundled/fullscreen_egtest.mm)

The residual strip/right-hand-strip behaviour is version-dependent and needs a current-device observation, not a timeless claim.

11. **The programmatic-scroll claim is supported for Chrome, not all iOS.**

Current Chrome-iOS code distinguishes user and programmatic scrolling for toolbar collapse. But the plan generalises this to “iOS since iOS 7”; current Safari evidence was not established, and historical WebKit discussion is contradictory. Scope the assertion to tested Chrome versions.

12. **`black-translucent` is the documented mechanism, but not a reliable guarantee.**

Apple documents it as making standalone content extend beneath the status bar. [Apple meta-tag reference](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariHTMLRef/Articles/MetaTags.html)

However, current WebKit bug 301994 reports standalone apps retaining a system-owned top gap while `safe-area-inset-top` reports zero. [WebKit bug 301994](https://bugs.webkit.org/show_bug.cgi?id=301994) The “web view starts at y=0” claim needs a real-device qualification and fallback.

## Missing

13. **Accessibility behaviour needs explicit device tests.**

A transformed dock remains in the tab order and accessibility tree. Keyboard focus should trigger `:focus-within`, but it is speculative whether VoiceOver virtual focus always produces the same DOM focus state. Test hidden/resting states with VoiceOver and Switch Control; [`touch.md`](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/touch.md:271) already marks those unverified.

The unresolved on-screen-keyboard issue from [`260827t-mobile-reading-view.md`](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260827t-mobile-reading-view.md:193) also remains.

14. **The install hint lacks a layout and focus contract.**

It can cover the final article lines, remain floating after the dock hides, or sit underneath an open drawer. Its focus and dismissal state should also participate in the never-hide rule.

15. **The manifest claims are overstated.**

Removing `orientation` correctly permits portrait. Changing `background_color` may improve launch appearance, but cannot guarantee removal of iOS’s white launch frame. Also the proposed dark background still does not match the manifest’s orange `theme_color` at [`site.webmanifest:19`](/Users/greg/Dropbox/dev/experim/spideryarn2/public/site.webmanifest:19). A current WebKit report shows white flashes even with matching dark manifest and CSS values. [WebKit bug 311569](https://bugs.webkit.org/show_bug.cgi?id=311569)