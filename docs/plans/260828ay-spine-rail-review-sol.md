The identity guard in piece 1 is correct for the regression it fixes, but its lifecycle coverage is incomplete. Build piece 2 only after fixing the width contract, drift list, lane arithmetic, and rendered-CSS evidence. Do not build piece 3 as written: its child-row design assumes titles and gists that the actual outline leaves do not contain, and “you are here” is not defined at the level represented by the cards.

## Blockers

### 1. Piece 3’s child data premise is false

**Where:** [260828ay-spine-rail.md:224](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260828ay-spine-rail.md:224), [Spine.tsx:708](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Spine.tsx:708), [granularity-zoom.md:99](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/granularity-zoom.md:99)

`buildOutline(..., 3)` makes the children of an L2 hit depth-3 leaves. The tree contract says those leaves have `navLabel`, not a heading title or gist.

A repo-data sweep found:

- 888 depth-3 nodes
- 0 with a gist
- 0 with a non-empty title
- 853 with a non-empty `navLabel`

The existing child list is already effectively blank on normal articles because it renders `c.node.title`. Adding `c.node.gist` produces a second blank line. Reducing five blank entries to four does not fix it.

**Do instead:** Decide what the rows represent before implementation:

- For paragraph-level children, render a single concise `navLabel`, filtering empty leaves.
- If the desired design genuinely requires title plus gist, use a different level of the hierarchy, such as sibling L2 sections.
- Calculate `+n more` from the filtered, displayable rows.

This plan needs rewriting before piece 3 starts.

### 2. The proposed CSS width is not the same width as the TypeScript constant

**Where:** [260828ay-spine-rail.md:120](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260828ay-spine-rail.md:120), [layout.ts:39](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/layout.ts:39), [styles.css:263](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:263)

The plan pairs `SPINE_W = 12` pixels with `--spine-w: 0.75rem`. The app does not lock the root font size to 16px. With a 20px browser root size, CSS paints 15px while layout arithmetic subtracts 12px.

The proposed text test would certify that disagreement as correct.

Also, the plan says the declaration is under `:root`; it is actually under `.reader`.

**Do instead:** Use `--spine-w: 12px`. The rail is part of pixel-based layout and breakpoint arithmetic, so `rem` is the wrong unit unless the runtime calculation also measures the root font size.

### 3. The drift table is incomplete, and two existing tests change behavior rather than merely expected numbers

**Where:** [260828ay-spine-rail.md:115](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260828ay-spine-rail.md:115)

Missed functional occurrences:

- [preview-colour.tsx:115](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/preview-colour.tsx:115) hardcodes `MODE_MIN + 24`.
- [styles.css:8249](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:8249) contains the second `max-width: 743px` query coupled to `SMALL_DEVICE`.
- The plan does not account for two tests whose scenarios stop exercising what their names claim:
  - [layout.test.ts:104](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/layout.test.ts:104): at width 1279 the table no longer needs to shrink. Move the input to 1275 or another genuine shrink case.
  - [chat.test.ts:181](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/chat.test.ts:181): at width 966 the mode no longer “gives way.” Width 954 preserves the intended 398px-mode scenario.

Other expected changes include:

- Layout crossover: `744/743` → `732/731`
- Mode crossover: `856/855` → `844/843`
- Table widths: 736 → 748, 676 → 688, 366 → 378
- Chat width 1176 → 1188

Current documentation also embeds the old contract, including [granularity-zoom.md:399](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/granularity-zoom.md:399), [tooltips.md:141](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/tooltips.md:141), [diagram.md:561](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/diagram.md:561), and the parallel [260828aw-outline-mode.md:487](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260828aw-outline-mode.md:487). [search.md:669](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/search.md:669) is already inconsistent with the live 15px/5px lane settings.

The `1.5rem` values in the masthead padding calculations are ordinary page gutters, not copies of the rail width. Do not change those.

**Do instead:** Add the missing code, CSS query, test scenarios, comments, and current project docs to the plan. `preview-colour.tsx` already has another agent’s changes, so coordinate and stage only the spine-width hunk.

## Should-fix

### 4. The identity guard handles stale closes, but armed state is not reconciled when its band disappears

**Where:** [Spine.tsx:270](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Spine.tsx:270), [Spine.tsx:299](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Spine.tsx:299), [Spine.tsx:574](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Spine.tsx:574)

The fresh closure is not a problem. Each closure captures its own band id, and the functional state update compares against the current `armed`. Therefore:

- A stale close from A cannot close newly opened B.
- A genuine close from the currently armed id lands.
- Resize remeasurement with the same ids remains valid.
- Valid tree ids do not repeat within one outline; article changes remount the owning article by slug.

The missing case is band removal. If an outline refresh, failed measurement, or hit-set replacement unmounts the armed tooltip, Floating UI’s cleanup does not reliably send the matching close. `armed` can remain non-null. Positional ids can then be reused by a new outline, reopening a semantically different card without input.

**Do instead:** Clear `armed` when:

- the outline identity changes;
- metrics become unavailable; or
- the armed id is no longer present in `metrics.hits`.

Clear on outline replacement even when the same positional id still exists.

### 5. Touch reveal-then-commit still works, but scroll and rotation semantics are undefined

**Where:** [Spine.tsx:638](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Spine.tsx:638), [Tooltip.tsx:168](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Tooltip.tsx:168)

The guarded close does not break the main sequences:

- Tap A reveals A with `byTouch`.
- Tap B dismisses A and reveals B; any late A close is ignored.
- Tap A again commits the jump and clears it.
- Tap outside or press Escape closes the currently armed card.

`mouseOnly` correctly prevents synthesized hover events from taking over the touch state.

However, Floating UI dismissal does not enable ancestor-scroll closing here. A touch-open card survives scrolling and rotation, then repositions or becomes semantically stale. That is especially troublesome if the card later says “you are here.”

**Do instead:** Choose and test a policy. I recommend closing touch-open cards on scroll, outline replacement, and meaningful layout changes. If persistence is intentional, document it and ensure the card’s live content remains true.

### 6. Three of the five hover tests are not evidence for the fix

**Where:** [spine-hover.test.tsx:146](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/spine-hover.test.tsx:146), [spine-hover.test.tsx:151](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/spine-hover.test.tsx:151), [spine-hover.test.tsx:201](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/spine-hover.test.tsx:201)

Only persistence and handover were observed red before the guard.

The others could not prove this fix:

- “renders one target per hit” does not exercise open/close identity.
- “opens” can observe a tooltip still in its 80ms exit transition after the erroneous close.
- “closes” can start with an already-closing zombie, so advancing time passes without mouse leave causing the close.

**Do instead:**

- Establish a stable open state in a separate `act`, then advance beyond both the delayed stale close and exit transition.
- Only after proving it is still open, trigger leave/outside dismissal and assert it closes.
- Temporarily reverting the identity guard should make the relevant assertions red.
- Add component-level tests for touch A→A, A→B, outside tap, Escape, scroll policy, and armed-band removal.

### 7. The proposed search lanes overlap much sooner than the plan says

**Where:** [260828ay-spine-rail.md:161](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260828ay-spine-rail.md:161), [styles.css:1376](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:1376), [styles.css:1400](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:1400)

With proposed gutter 8 and maximum pitch 4:

| Searches | Pitch | Painted width |
|---:|---:|---:|
| 1 | 4px | 3px |
| 2 | 4px | 3px |
| 3 | 2.67px | 1.67px |
| 8 | 1px | 1.5px |

The plan’s “one search is a 4px bar” forgets the `- 1px` gap. The 1.5px floor starts controlling at four searches and exceeds the pitch at six, not “about a dozen.”

No 12px design can display eight lanes with both a 1.5px stroke and a 1px gap; that would require 20px.

**Do instead:** A more useful compromise is `--spine-gutter: 10px` and retain `--lane-max: 5px`. It preserves the current 4px painted bar for one and two searches. Document that dense searches merge from roughly seven onward, and visually test the actual 1/2/3/8 cases.

### 8. The `.spine-paint` idea is viable, but the plan omits important hit-testing and paint-order consequences

**Where:** [260828ay-spine-rail.md:176](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260828ay-spine-rail.md:176), [styles.css:1268](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:1268), [styles.css:3397](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:3397)

An absolutely positioned inner wrapper can preserve the fixed rail and safe-area arithmetic. But:

- A 12px right overhang covers the beginning of the gist/table region.
- With the mode open it also lies over the first 12px of `.mode-band`, because the rail’s stacking context is above the mode band.
- `elementFromPoint` and keyboard navigation will treat that area as a depth-1 rail button.
- Moving painted layers into an earlier wrapper can reverse the current order between the viewport marker and hover wash unless z-index/order is specified.
- `(pointer: coarse)` only describes the primary pointer; hybrid devices remain ambiguous.

Accepting 12×4px buttons on touch is not a good fallback.

**Do instead:** Prototype the inner wrapper, but specify its paint order and test hit maps over the gist, block-id gutter, and open mode band. Decide explicitly between `pointer` and `any-pointer` behavior. Keep the extended target only if browser testing confirms the obscured strip is an acceptable tradeoff.

### 9. “You are here” is not available from the current `here` state

**Where:** [Spine.tsx:355](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Spine.tsx:355), [260828ay-spine-rail.md:260](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260828ay-spine-rail.md:260)

`here` is the current L1 part. Hover cards usually represent L2 hits. Comparing only their parent with `here` would label every sibling section in the current part “you are here.”

Tracking the exact L2 in React state would update on every section boundary and re-render all controlled tooltips, defeating the scroll effect’s deliberate L1-only optimization.

**Do instead:** Either:

- say “current part” when only L1 membership is known; or
- calculate the exact current hit in a ref and snapshot/update it only while a card is open.

If the exact current section is exposed, add `aria-current="location"` to its button. Do not make it visual-only.

### 10. The proposed card is materially taller than the plan claims

**Where:** [260828ay-spine-rail.md:213](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260828ay-spine-rail.md:213), [styles.css:1442](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:1442)

Five one-line children becoming four two-line children adds three lines, before adding crumb position and footer text. The card has a maximum width but no useful height budget, and the main gist is not clamped.

On a short viewport this becomes a large block that changes instantly while scrubbing between neighbours. It will read as a strobe rather than a quick orientation aid.

**Do instead:** Given the actual data, use one-line `navLabel` rows. If future data supports gists, cap them to two or three children with explicit line clamps and test the worst long-content card at roughly 390px viewport height.

### 11. Carrying the whole parent `OutlineEntry` is unnecessary coupling

**Where:** [260828ay-spine-rail.md:224](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260828ay-spine-rail.md:224), [Spine.tsx:176](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Spine.tsx:176), [Spine.tsx:681](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Spine.tsx:681)

The reference is cheap in memory, but it gives `BandCard` access to far more tree structure than the UI needs. The plan explicitly says the parent gist will not be shown.

**Do instead:** Store a narrow value:

```ts
parent?: {
  title: string
  index: number
  total: number
}
```

Populate it while mapping the parent’s children. Omit `1 of 1` unless there is a real navigational benefit.

The parallel Outline implementation currently has its own card rather than the shared `BandCard` promised by its plan. Do not refactor another agent’s uncommitted Outline work during this change. Share a small presentation component later only if the rendered structures genuinely converge.

### 12. The degradation table omits several ordinary inputs

**Where:** [260828ay-spine-rail.md:284](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260828ay-spine-rail.md:284)

Missing cases include:

- one child (`1 of 1` noise);
- empty `title`, `gist`, and `navLabel`;
- blank children that need filtering;
- no ToC/outline at all;
- parent title absent but position available;
- `words === 0`;
- childless supplement/part;
- `+n more` after filtering rather than before it.

**Do instead:** Define each explicitly. Showing “0 words” is technically safe, but it should be an intentional result. No-ToC should retain the current empty, `aria-hidden` spine behavior.

## Nit

### 13. Keep 12px unless browser evidence says it fails

A 16px rail recovers 8px rather than 12px, so it gets two-thirds of the space benefit and leaves more room for marks. It still does not solve touch-target size and still requires every breakpoint change.

Because “halve it” is explicit, 12px is a reasonable design direction. Do not silently substitute 16px; use it only as a fallback if the 12px browser prototype demonstrates unacceptable search or hit-testing failures.

### 14. The most likely silent success is `spine-width.test.ts`

A regex that finds `--spine-w: 0.75rem` can match a comment or an overridden declaration. A test covering one `743px` occurrence can miss the second media query. Nudging the matched number proves only that the regex observes that string, not that the browser uses it.

Make the source check a drift sentinel by stripping comments, anchoring declarations, asserting exact occurrence counts, and checking all three coupled media queries. Then add rendered evidence:

- measure `.spine.getBoundingClientRect().width`;
- verify computed reader padding and mode position;
- test both sides of 731/732 and 843/844;
- confirm `window.innerWidth`;
- run once with a non-16px default/root font size.

That rendered check is the evidence that the feature works.

I could not rerun Vitest in this review environment: startup tried to write a temporary Vite config under `node_modules/.vite-temp` and the filesystem is read-only.