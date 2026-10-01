P0–P1: None.

- P2 — `src/web/Dock.tsx:1561`: metadata-page links mishandled legacy `?mode=annotations`. Selecting a band discarded the notes state; selecting Annotations preserved the retired parameter. Added a failing regression test, then canonicalised legacy URLs through `withMargin()` before either navigation.

- P2 — `src/web/last-view.ts:250`: restoring URLs containing both legacy `mode=annotations` and `margin=0` produced duplicate, order-dependent margin parameters. Added failing cases for both orderings; restoration now performs the same atomic rewrite as Reader and emits one `margin=1`.

- P2 — `src/web/styles/dock-fit.css:295`, `src/web/Dock.tsx:2594`: `display: contents` could remove the element carrying `role="radiogroup"` from the accessibility tree, including in WebKit ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/display), [WebKit bug](https://bugs.webkit.org/show_bug.cgi?id=185679)). Replaced it with a real flex box. A second red-first test caught the resulting tablet-width imbalance; the group now receives one flex share per radio while Annotations receives one.

- P3 — `src/web/Dock.tsx:346`, `src/title-text.ts:185`, `src/public/page-head.ts:113`, `src/web/ModeHerald.tsx:78`, `src/web/feedback-context.ts:64`: several active-band seams still accepted the catalog-wide `Mode`, allowing `annotations` back into `?mode=`, titles, diagnostics, and herald state. Compile-time assertions failed first; these seams now use `BandMode`.

No further findings in `fitBoth`, layout variables, `marginColumn`, the ideas-feed lifetime, or Reader’s legacy rewrite.

Checks: 13 focused files / 290 tests passed; all four TypeScript projects passed. Targeted lint reported only Dock’s existing complexity advisory. The full suite was not run, as requested. No commit made.

Verdict: **land after fixes**.