F1 — High — The measurements strongly indicate a regression, but do not isolate it well enough to attribute exactly “0.8 s” to 261009k.

All five clean current runs were slower than every baseline run. The difference of medians is 788 ms; the median paired difference is 702 ms. That supports “a real dev-build regression of roughly 0.7–0.8 s.”

However, `94042d91b..56adcafa5` spans 26 commits and 261 files, not only the excerpt change. The baseline server also failed to serve several fonts because its shared `node_modules` was outside Vite’s allow-list, while current did not. Runs were always current then baseline, rather than counterbalanced. These factors make the exact attribution unfair.

Suggested change: rerun an A/B comparison from one tree using a feature flag or a temporary string-only Search renderer, with identical assets and dependencies; alternate AB/BA order. Measure a production build too. Until then, say “strong evidence of a roughly 0.7–0.8 s dev-build regression,” not that a production reader’s freeze definitely grew by 0.8 s.

F2 — Medium — The long-task method is appropriate, but two reported quantities are overstated.

A `longtask` observer is a good direct measure of the freeze, and alternating builds was sensible under load. But the script clears `window.__lt` without filtering subsequently delivered entries by `startTime >= __t0`, and “wall time to last row” is actually time to the last mutation anywhere in `document`, not specifically the Search list. The CPU profile also makes native browser work plausible, but does not prove that all unaccounted-for time was excerpt parsing/style/layout.

Suggested change: retain and filter long-task timestamps, observe `.srch-hits` specifically, label the current metric “last document mutation,” and describe the native-work attribution as “consistent with” rather than established.

F3 — High — The failing test goes red, but does not pin the performance contract.

I ran the described test against committed current behavior. The intended two assertions failed: 30 formatted excerpts were found where 0 and 1 were expected. So it genuinely reproduces the eager-render behavior.

But asserting absence of `<em>` only proves formatted markup is not displayed. An implementation could still call `excerptHtml` eagerly, discard its result, and pass while retaining the regression.

Suggested change: mock or spy on `excerptHtml` and assert zero calls before intersection, then exactly one call for the reported row. Keep the DOM assertions as the user-visible half of the test.

F4 — Medium — Lazy formatting is a sound narrow fix, and capping is not the right regression fix; nevertheless, test the one-line CSS option first.

Capping/progressively mounting rows changes find-in-page and keyboard traversal and addresses the older 1.8 s problem rather than just this regression. It should remain separate product work.

Before adding observer state to 588 rows, measure `.srch-hit { content-visibility: auto; contain-intrinsic-size: ... }`. The CSS specification requires `auto` content to remain available to find-in-page and tab navigation while allowing offscreen style/layout/paint work to be skipped. It will not avoid `excerptHtml`, DOMPurify, or DOM creation, so retain it only if measurement shows that it recovers enough of the regression. [CSS Containment specification](https://www.w3.org/TR/css-contain-2/#content-visibility)

F5 — Medium — `root: null` is correct for visibility, but pre-formatting around this nested scroller depends on `scrollMargin`.

The viewport observer will fire once a row is actually visible: clipping by `.srch-hits { overflow-y: auto }` participates in the intersection calculation. `rootMargin` cannot expand that intermediate clip. `scrollMargin` is precisely the option that expands scrollable ancestors’ clip rectangles. [Intersection Observer specification](https://w3c.github.io/IntersectionObserver/#dom-intersectionobserver-scrollmargin)

Current engines support it—WebKit added it in 2025 and Firefox in 141—but older implementations may ignore it, meaning rows format only after becoming visible and may flash. [WebKit release notes](https://webkit.org/blog/16824/release-notes-for-safari-technology-preview-217/), [Mozilla implementation](https://bugzilla.mozilla.org/show_bug.cgi?id=1860030)

Suggested change: either document that graceful degradation, or use one observer scoped to the `.srch-hits` element with `rootMargin`, which works without nested-scroll `scrollMargin`. It would still be one observer, just owned by the mounted Results list rather than globally.

F6 — Medium — The fallback and lifecycle contract needs tests beyond “API absent.”

The plan handles missing `IntersectionObserver`, but not an existing implementation whose constructor or `observe()` throws. `reveal-once.ts` catches setup failures; this helper should likewise fall back to formatted content.

Suggested change: add tests for:

- constructor/observe failure;
- StrictMode setup–cleanup–setup;
- unmount removing targets and callbacks;
- a `display:none` band becoming visible again;
- a keyboard-focused row formatting immediately or, at minimum, retaining the same accessible text;
- opening an offscreen row’s HitCard, which should remain eager and fully formatted.

F7 — Medium — Stage 3 must measure scrolling, not only opening.

The fix deliberately moves work from initial rendering into scrolling. A scrollbar drag or fast wheel movement can intersect several rows at once, producing a new scroll-time long task or a visible formatting flash.

Suggested change: add a rapid top-to-bottom scroll scenario recording long tasks and visible unformatted rows. Define a completion threshold—for example, recover most of the measured initial regression while adding no material scroll stall—rather than merely “remeasure.”

F8 — Low — Correct two factual details in the plan.

Search snippets are cut from `renderedText(block.html)`, so their plain fallback normally contains flattened rendered symbols, not raw TeX such as `\(d_k\)`. The cost is temporarily losing MathML, emphasis, and sub/superscript semantics. Also, retaining `seen` when React reuses `f.key` is appropriate: that key identifies the same passage, and changed `words` will still rerender. State that explicitly rather than resetting it on every query.

Verdict: **proceed with changes**. The direction is good, but isolate the benchmark, make the test prove `excerptHtml` is not called, and verify the nested-scroll and scroll-time behavior before calling it complete.