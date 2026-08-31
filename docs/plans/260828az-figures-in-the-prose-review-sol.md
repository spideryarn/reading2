I would not ship this yet.

## Findings

1. **High — images inside `<figure>` still render dark-on-dark.**  
   [zoomable.ts:111](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/zoomable.ts:111), [styles.css:1031](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:1031)  
   The outer `<figure>` wins, but the sheet selector only matches a direct `img`/`svg` child of `.zoomable`. Here that child is `<figure>`, so its media gets no sheet.  
   Smallest fix: also match `.zoomable[data-zoom-kind="figure"] :is(img, svg)`.

2. **Medium — wrapping `<picture>`’s `<img>` disables responsive sources.**  
   [zoomable.ts:42](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/zoomable.ts:42), [zoomable.ts:117](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/zoomable.ts:117)  
   `<picture><source …><img …></picture>` becomes `<picture><source …><span><img …><button>…</button></span></picture>`. The `img` is no longer parented by `picture`, so the `<source>` candidates stop applying and the fallback image is used. This is not speculative, although no current corpus hit was found.  
   Smallest fix: make `picture` an outer zoomable target, before `img`, and update sheet/direct-click selectors for its descendant image.

3. **Medium — internal links in enlarged tables/figures bypass article navigation.**  
   [Lightbox.tsx:115](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Lightbox.tsx:115), [TableView.tsx:553](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/TableView.tsx:553)  
   The copy retains `<a href="#…">`, but the lightbox is outside the `<tbody>` that owns delegated link handling. Clicking such a link performs a native hash jump behind the open modal, without sticky-bar positioning or the normal `?at=` path.  
   Smallest fix: delegate link clicks inside `Lightbox`, resolve them with `internalTarget`, close, then call `onJump`.

4. **Medium — article classes can impersonate the injected control.**  
   [TableView.tsx:565](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/TableView.tsx:565), [zoomable.ts:169](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/zoomable.ts:169), [sanitize-policy.ts:511](/Users/greg/Dropbox/dev/experim/spideryarn2/src/sanitize-policy.ts:511)  
   The sanitizer permits `class="zoom-btn"` and `class="zoomable"`. Any source element with `zoom-btn` gets app button styling, triggers enlargement, and is deleted from the enlarged copy. Forbidding article `<button>` does not establish ownership because the handler matches only the class.  
   Smallest fix: reserve both classes and `data-zoom-kind` in the sanitizer; additionally match `button.zoom-btn` and its direct wrapper structure.

5. **Medium — the background can still scroll from outside the content scroller.**  
   [styles.css:8718](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:8718)  
   `overscroll-behavior` exists only on `.lightbox-content`. Wheel/touch gestures beginning on the backdrop, panel padding, or close-button row do not pass through that element and can scroll the document viewport.  
   Smallest fix: also put containment on the full-viewport `.lightbox` scroll container, then test wheel/touch from the backdrop.

6. **Low — wrapping a root `<pre>` restores its UA margins.**  
   [styles.css:978](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:978), [zoomable.ts:117](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/zoomable.ts:117)  
   `.prose > * { margin: 0 }` used to reset a root `pre`. After wrapping, the `pre` is no longer a direct child, and `.prose pre` does not set `margin`, so Chrome’s default vertical margins return.  
   Smallest fix: set `margin: 0` on `.zoomable > pre`, or on `.prose pre` generally.

7. **Low — zero-width tracking images are not considered tiny.**  
   [zoomable.ts:84](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/zoomable.ts:84)  
   `width="0"` fails `w > 0`, receives a wrapper, padding, light sheet, and enlarge control—turning an invisible image into a visible pale patch.  
   Smallest fix: distinguish a missing attribute from zero, and skip finite declared widths from `0` through `MIN_IMG_WIDTH - 1`.

8. **Low, speculative impact — linked images contain nested interactive controls.**  
   [zoomable.ts:117](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/zoomable.ts:117)  
   A linked image becomes `<a><span><img><button>…</button></span></a>`. That is invalid nested interactive content. The delegated click cancellation works in ordinary Chrome clicking, but focus/accessibility-tree behavior varies by browser and assistive technology; that impact is speculative.  
   Smallest correct fix: put the wrapper around the link and make the zoom button its sibling, not its descendant.

## Tests that overclaim

[zoomable.test.ts:49](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/zoomable.test.ts:49) says it covers every shape, but omits `<picture>`, zero-width images, forged reserved classes, linked-image semantics, computed CSS, and every dialog/event path. The fixed-point test proves jsdom only; a Chrome disagreement is speculative because there is no real-browser assertion.

I found no offset drift from the injected icon: its SVG has no text nodes, and `aria-label`, `alt`, and SVG path attributes contribute nothing to `textContent` or `Range.toString()`. I also found no state-sync defect in the normal `showModal`/Escape/close paths, and the `[open]` display guard is correct.

`git diff --check` passed. Tests could not start in the read-only environment because Vite tried to create `.vite-temp`; direct TypeScript checking reached an unrelated existing error in `src/web/chat/reduce.ts:660`.