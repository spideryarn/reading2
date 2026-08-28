Verdict: revise before building. The experiment is worth trying, but three core implementation claims are currently false.

## Blocking findings

1. **`currentEntryId` cannot describe the proposed outline.**

The plan says to pass empty `closed`/`opened` sets ([outline-mode.md:234](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/outline-mode.md:234)). But selective expansion requires:

- Rung 1: `deep=1`
- Rung 2: `deep=1`, `opened={currentPart}`
- Rung 4: additionally open the current section

With empty sets, `deep=1` shows no sections; `deep=2` shows every part’s sections. [`showsChildren`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/tree.ts:654) has no state meaning “open only the branch containing this row.”

Worse, the proposed `atRow` is not the precise reading row. Summary mode derives it from `?at=` ([App.tsx:3329](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/App.tsx:3329)), whose documented unit is the first block of the current section ([position.ts:44](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/position.ts:44)). If paragraph rows are drawn, [`currentEntryId`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/tree.ts:614) will repeatedly identify the section’s first paragraph, not the paragraph being read.

The plan must choose:

- Track an exact live row for paragraph focus; or
- Stop “current” at the section and never claim a paragraph row is current.

Create one pure outline projection that returns both `visibleEntries` and `currentId`; do not make the renderer and current-node walk reconstruct it separately.

2. **`buildSummaryTree(..., depthLimit: 3)` is not “exactly the structure this needs.”**

It walks raw children. It does not apply the shared navigation projection that removes continuation cells and collapses apparatus into one entry. That projection exists in [`navigableItems`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/tree.ts:167) precisely because otherwise blank leaves become visible/current.

A real example already exists: `data/revistes-ub-30977/tree.json` has two depth-2 leaves under “References”; one has an empty title and no nav label. The planned “sections” renderer can silently draw blank rows or skip them while `currentEntryId` still walks into them. New supplement nodes create the same problem at larger scale.

The projection must handle:

- Continuation cells
- Unlabelled/non-structural leaves
- Supplement nodes
- Variable `leafDepth`, rather than assuming paragraphs are always depth 3
- Missing `gist` or `navLabel` without substituting one for the other

3. **Character-count fitting is not honest enough here.**

The earlier decision explicitly identified the alternative: render all candidates off-screen at their real width and measure them once ([column-context.md:111](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/column-context.md:111)). That was rejected when the cost was five candidates for each of three panels and failure meant a little blank space. Here it is only five candidates for one panel, and failure deletes rows.

The proposed `data-outline-rung` and pure height sweep only prove what the estimator chose; they cannot prove the rendered list fits. That is the silent-success pattern.

Cheapest honest solution:

- Observe the real band’s `clientHeight`.
- Render the five candidate lists together off-screen at the real band width.
- Read their heights once and select the largest fitting candidate.
- Re-measure on container resize and `document.fonts.ready`.

There is no measure-resize-measure loop: hidden candidates retain fixed geometry; only the chosen visible candidate changes.

## High findings

4. **The size-versus-length reversal is not yet sound.**

The claimed blast radius—“one row growing” ([outline-mode.md:184](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/outline-mode.md:184))—omits three kinds of motion:

- The old branch disappears and a differently sized branch appears.
- The chosen rung can change because the new section has a different paragraph count.
- Reusing `cur/near/mid/far` styling changes font sizes on several rows, not one.

The real trees are not even enough for the argument:

- `constitution`: crossing from “Following Anthropic’s guidelines” to “Being broadly ethical” replaces 3 sections with 15—twelve inserted rows.
- Noema: “Brains Are Not Computers” has 26 paragraph children; nearby sections have 3.
- `source`: “References and Author Bio” has one child.

Measure displacement of unchanged rows before and after these crossings at 288px and 400px band widths, and at 390px, 620px and 1024px heights. Also oscillate across the boundary in both directions. “Does it feel like the hairline?” is too subjective as the only acceptance test.

5. **The iPad behavior is currently broken or undefined.**

Below 856px, every mode band covers the prose rather than sitting beside it ([layout.ts:343](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/layout.ts:343), [styles.css:7967](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:7967)). At 768px iPad portrait:

- The plan’s assertion that prose is visible beside `navLabel`s is false.
- Tapping a row moves an article hidden behind the full-screen panel.
- Hover cards cannot be opened.
- The plan gives no first-tap/second-tap rule, close-after-jump rule, or touch stepping behavior.

The existing touch rules explicitly treat hover-only information as unavailable ([touch.md:42](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/touch.md:42)). This needs a real iPad interaction design, not only browser validation.

6. **The accessibility decision repeats a problem Diagram mode has already solved.**

Clickable, unfocusable `<li>` rows leave keyboard and screen-reader users unable to inspect or activate arbitrary entries. Avoiding a hundred tab stops is valid; making all rows unreachable is not.

Diagram Tree already uses one composite tree tab stop, roving focus, `treeitem` metadata, arrow navigation, focus-triggered detail, and 44px touch buttons ([diagram.md:421](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/diagram.md:421)). Reuse that pattern. Add `aria-current="location"` for the current row.

## Design findings

7. **The ladder spends space in the wrong order.**

The arc answers the feature’s main question—where the whole argument stands—yet it comes after paragraph labels already represented by the prose. On Noema’s 26-paragraph section, paragraph expansion will fail while the one arc sentence would fit.

Use:

1. All parts
2. Current part’s sections
3. Current section gist
4. Current part arc
5. Current section paragraph labels

Also try independent later enrichments when an earlier expensive one does not fit. Blank space is defensible only after all cheaper independent additions have been considered.

8. **Diagram Tree is the omitted fourth existing surface.**

It already provides a nested, ordered, clickable tree with the current position marked ([diagram.md:40](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/diagram.md:40)). Outline remains meaningfully different because it is automatically expanded around the reader and intended never to scroll, but the plan’s comparison is incomplete.

A fourth Summary `LENGTH` rung is the wrong consolidation: Outline changes topology and focus, not text length. A stronger fifth option is a Diagram Tree variant with:

- A stable compact tree above
- A fixed-height current-section detail card below
- No branch-driven reflow

Using an eighth band mode temporarily for comparison is still reasonable because Greg explicitly chose it.

## Missing or incorrect integration

- The visitor claim is false today. [`visitorGap`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/visitor.ts:159) grants free access only to `toc`; an unknown new mode fails closed as owners-only. Outline must be added explicitly and tested.
- `docs/plans/spine-rail.md` does not exist in this checkout, so its interaction and proposed `BandCard` contract cannot be reviewed. `BandCard` is currently private and coupled to the spine’s `Band`/`OutlineEntry` shape ([Spine.tsx:671](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Spine.tsx:671)).
- `?mode=outline` is sufficient URL state if focus is wholly derived. Any hysteresis must use one latched focus value for rendering and marking, then reset on direct jumps.
- Do not bundle the `buildOutline` rename and widespread “outline mode” documentation rename into this experiment. That adds risk before the mode has earned survival.

Required tests should assert actual DOM outcomes: every mandatory part ID appears once, the expected current ID is drawn, `scrollHeight <= clientHeight`, and the last row’s rectangle remains inside the panel. Mutate row padding or line-height and prove the overflow test turns red.

No files were changed.

