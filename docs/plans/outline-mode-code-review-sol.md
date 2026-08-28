## Verdict

**Revise before commit.** The projection is substantially better than the first plan, and section-granular currentness is implemented consistently. The two strongest promises—“one line per node” and “the chosen list fits”—are not yet true.

I reviewed the latest working-tree version, including the peer’s in-flight switch from index-based to ID-based keyboard focus.

## High findings

1. **The fit overstates the available height by the panel’s top padding.**

   [`measure()`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/OutlinePanel.tsx:93) accepts a candidate when its `scrollHeight <= panel.clientHeight`. But `clientHeight` includes padding, while the visible list starts below `0.75rem` of top padding in [styles.css](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:8859).

   The fit therefore grants the list roughly 12px it cannot occupy. A candidate within that margin is selected and clipped at the foot. This is a direct breach of the mode’s central promise.

2. **The “prose is beside the band” signal is wrong when the spine is off between 832px and 843px.**

   [App.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/App.tsx:2238) passes `proseBeside={fit.modeW > 0}`. With `?spine=0`, layout returns:

   - 832px → `modeW: 288`
   - 840px → `modeW: 296`
   - 843px → `modeW: 299`

   But the CSS makes every band full-screen through 843px in [styles.css](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:8269). Thus rung 5 is enabled while the band actually covers the prose. The condition is exact only with the 12px spine on.

3. **Rows are not one line each.**

   The only rule on `.outln-text` is `overflow-wrap: anywhere` in [styles.css](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:8911). There is no clamp, ellipsis, or `white-space: nowrap`.

   Long titles and especially paragraph `navLabel`s wrap at 288px and 400px. That invalidates three claims:

   - A rung is not “one line per row.”
   - The fallback for rung 1—keep every part but clamp its words—is not built.
   - The tooltip is described as revealing clamped text, but nothing is clamped.

   Measurement includes the wrapping, so this does not self-invalidate the chosen rung. It does make the list taller and boundary churn larger than the row-count argument assumes.

4. **The custom focus indicator uses the token the stylesheet explicitly says not to use.**

   [styles.css](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:8931) draws the ring with `var(--accent)`. `--accent` is a near-dark raised surface, not the orange focus colour; that warning is at [styles.css:32](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:32) and in `tokens.css`.

   At the same time, [the tree’s native outline is removed](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:8886). The result is a low-contrast focus indicator replacing the browser’s strong one. This is a defect, not taste.

5. **The new ID-based focus repair retains an ID after its row disappears.**

   [OutlinePanel.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/OutlinePanel.tsx:147) falls back to `now` when `focusedId` is absent from `rows`, but never clears the stale ID.

   Concrete sequence:

   1. Arrow onto paragraph P at rung 5.
   2. Shrink the window or leave the section; P disappears.
   3. Focus correctly falls back to the current section.
   4. Expand the window or return to that section.
   5. P reappears and silently becomes active again because its old ID was retained.

   The current test does not cover disappearance followed by reappearance.

6. **The narrow-window interaction remains functionally incomplete, as you suspected.**

   A row click only calls `onJump`; Outline has no route to `setMode`, so the full-screen band remains over the destination. Row height is around 20px, with no 44px minimum. The uncontrolled hover tooltip also is not a persistent touch disclosure.

   This is known incomplete work, but it is still release-blocking for the 843px-and-under layout.

## Fit and test honesty

The hidden-measurement design is otherwise sound:

- `visibility: hidden` is correct; `display: none` would produce zero heights.
- The measured `<ol>/<li>` markup and width match the visible list.
- Reading each candidate `<ol>.scrollHeight` is appropriate.
- Candidates do not depend on the selected rung, so there is no choose-resize-choose loop.
- `candidates` changes on section changes and structural props, not every scroll frame.
- Each candidate already carries its own tier font classes, so choosing that candidate does not change its measured typography afterwards.
- A zero `clientHeight` is handled conservatively, and the panel observer can retry once its height becomes positive.

Two remaining problems:

- The observer on `.outln-measure` cannot detect content-height changes because that element has `height: 0` in [styles.css](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:8955). Its border/content box stays zero while its descendants’ `scrollHeight` changes. `document.fonts.ready` catches the initial load, but the comment claiming the observer catches font swaps is false.
- The jsdom stub at [outline-panel.test.tsx:120](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/outline-panel.test.tsx:120) is testing real but narrow logic: “given five reported heights, choose the largest fitting rung.” It does not test the fit. Its height is `li count × pxPerRow`, so rungs 2, 3, and 4 report identical heights even though the gist and arc add rendered lines. It also ignores width, wrapping, margins, padding, fonts, ResizeObserver, and live resizing.

A mutation to `display:none`, row padding, line-height, candidate width, the panel-padding comparison, or the observer wiring can leave those tests green. A browser outcome test remains required.

Also, the claim at [OutlinePanel.tsx:193](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/OutlinePanel.tsx:193) that the fit is asserted in `outline-panel.test.tsx` directly contradicts that test file’s honest preamble.

## The current mark

Stopping currentness at the section is right given the available input, and it is consistently enforced:

- Level-3 rows cannot be `here` in [outline.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/outline.ts:218).
- The reverse `now` walk therefore stops at the section.
- `currentId` comes from that same walk.
- `aria-current` reads `row.now`.
- Initial `aria-activedescendant` falls back to the same `now` row.

The keyboard’s active descendant may later be a paragraph, which is correct: keyboard focus is not a claim that the reader is currently reading that paragraph.

`before` is necessarily conservative at paragraph level: because `focusRow` is a section start, none of the current section’s later paragraphs can become “read” as the reader advances through them.

## The navLabel argument

The fallback itself is defensible, but the stated justification is not.

A `navLabel` is permitted because this is navigation chrome—a door to prose—not specifically because prose is visible beside it. The existing `?text=0` ToC proves that navigation can legitimately use navLabels while prose is hidden.

Consequently, “the contract requires dropping rung 5 when the band covers prose” is too strong. Space, touch behavior, and avoiding a poor full-screen paragraph surrogate may still justify dropping it, but the node-shape contract does not.

The code also does not enforce that rationale uniformly: a depth-2 leaf with no title still reaches `rowText`’s navLabel fallback on a narrow window. `allowParagraphs=false` only suppresses `section.children`.

There is a second silent reporting issue: on a narrow window, or when the section exceeds the paragraph cap, candidate 5 is identical to candidate 4. The chooser breaks ties in favour of the larger rung number, so `data-outline-rung="5"` can mean “no paragraphs were permitted.” The diagnostic intended as evidence lies about how far down the ladder the panel got.

## Constitution churn

Crossing from “Following Anthropic’s guidelines” to “Being broadly ethical” is not small.

For a fixed rung:

| Rung | Old rows | New rows | What moves |
|---|---:|---:|---|
| 1 | 7 | 7 | No indices change, but four part tiers/font sizes change |
| 2–4 | 10 | 22 | Incoming part moves up 3 slots; every later part moves down 12 |
| 5 | 13 | 27 | Incoming part moves up 6; every later part moves down 14 |

The first part has three sections and its current section has three paragraph rows. The next has fifteen sections and its first section has five paragraph rows.

Thus the entire tail after the new part moves, not only the interval between the old and new focus. At a height where ten rows fit but twenty-two do not, the selected rung can also collapse from 2–4 to 1, producing a completely different change.

The required 288/400px × 390/620/1024px displacement measurements have not been made, so the plan’s churn acceptance criterion remains unsatisfied.

## Wiring and coverage

The visitor path is statically safe. Outline mounts no private hook and reads only the public article’s tree, blocks, and optional public arc. The comment that it reaches “no artefact at all” is technically false—the arc is an artefact—but it is already intentionally part of `PublicArticle`, so this is not an access leak.

The protection is not tested end-to-end: the “every mode” sweep in [public-network-trace.test.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/public-network-trace.test.tsx:461) hardcodes the old seven non-default modes and omits Outline. Adding a fetch inside Outline would escape that test.

Other important green mutations:

- Remove Outline from `MODES_UI`: no test checks Dock coverage.
- Break the `mode === "outline"` App branch or hardcode `proseBeside`: panel tests supply props by hand.
- Remove arc or supplement handling: all Outline fixtures use `arcByRow=null` and none contains a supplement.
- Break click/Enter/Home/End/left/right behavior: almost none is asserted.
- Put `aria-current` on the wrong single row: the panel test checks only that exactly one exists, not which ID.
- Remove `aria-setsize`/`aria-posinset`: already absent and untested. Because the DOM is flat, the browser cannot infer correct sibling positions from nesting as Diagram can.
- The new focus test passes `focusRow=2`, still inside fixture section 0. A real `LiveContext.focusRow` only takes section-start values, so it does not exercise the cross-section branch replacement its comment describes.

The implementation also omits Diagram’s Left/Right tree navigation and `aria-setsize`/`aria-posinset`. That is partial reuse of the pattern, not the promised copy.

## Documentation obligations

The live docs have not moved with the code:

- [reading-view-overview.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/reading-view-overview.md:38) has no Outline mode entry.
- [keyboard.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/keyboard.md:171) says only Dock and Diagram consume arrow keys.
- [touch.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/touch.md:33) now uses “Outline mode” for the older `?text=0` view and documents nothing about this full-screen navigator.
- [page-titles.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/page-titles.md:109) still says six of seven modes.
- [outline-mode.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/outline-mode.md:3) still says “planned, not built,” and its review table still claims `focusRow` is exact.

Given the repo’s signpost rules, this needs a live project doc owned from the reading-view overview, not only the retained plan.

## Checks

- Relevant suites: **93/93 passed**.
- Full suite: **5,500 passed, 11 failed**; all failures were in store parity/roundtrip tests, outside the Outline files.
- Web source typecheck: **passed, 168 files**.
- Test typecheck has one unrelated error in `glossary-ideas-baseline.test.ts`.
- Biome reported only the existing advisory complexity score of 34 for `outlineProjection`.
- No files were changed.