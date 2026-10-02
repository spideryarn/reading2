No D1… findings: no P0–P3 defects found, so nothing was fixed or reported.

Verified:

- Chromium traverses differing fragments with `popstate` followed by `hashchange`; Help handles only `hashchange`, arriving once. The router sees an unchanged pathname and neither re-renders nor scrolls to the top. [Chromium source](https://chromium.googlesource.com/chromium/src/third_party/%2B/refs/heads/main/blink/renderer/core/loader/document_loader.cc), [HTML traversal sequence](https://developer.mozilla.org/en-US/docs/Web/API/Window/popstate_event#when_popstate_is_sent).
- Search-result fragment clicks work while the query remains present. Middle-click and modified primary clicks remain native.
- Current Chromium hit-tests the page scrollbar against the document element and dispatches `pointerdown`, so the capturing window listener stops settling before a scrollbar drag.
- Settling resources are removed on timeout, cancellation, unmount, reader input, and a superseding reveal. Metadata and jsdom fallbacks remain sound.
- The postmortem accurately describes the implementation.

Files changed: none. The existing untracked review-prompt file was untouched.

Checks:

- Vitest: `4 passed (4)` files; `86 passed (86)` tests.
- `npm run typecheck`: blocked by `/tmp/tsx-1000/14.pipe` `EPERM`.
- Fallback: four projects passed; all `2656` source files covered.

Verdict: both follow-up commits are ready to land unchanged.