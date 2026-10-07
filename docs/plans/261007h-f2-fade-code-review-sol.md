# F2 fade follow-up review — `2a7eacc0a`

Findings were recorded here before fixes. Fixes remain uncommitted.

- **N1 — P1, fixed: reflow hid the keyboard-focused part.** Resize,
  font-load and child-list callbacks revealed the chosen button even after Tab
  revealed a different focused button. A 200px row with choice 0 and focus 3
  went from `scrollLeft=180` back to `0` on resize. Reflows now preserve the
  focused direct child; a new selection still immediately reveals its choice.
- **N2 — P2, fixed: the order button's outer focus ring entered the fade.**
  `revealButton` reserved the fade width for the button box, while
  `.gloss-sort-btn:focus-visible` extends 3px beyond it. Reveals now reserve
  computed outward outline space as well; inset part-switcher outlines add none.
- **N3 — P2, fixed: elastic scrolling marked a nonexistent start edge.**
  `Math.abs(scrollLeft)` converted a negative LTR bounce into a positive distance.
  Direction-normalized positions are now clamped to the actual range. Tests cover
  both directions, both elastic bounds, and a normal intermediate position.
  Safari's elastic values and negative RTL positions are documented by
  [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollLeft).
- **N4 — P2, fixed: wide chips made successive reveals disagree.** A 180px
  interior chip in a 200px row cannot fit between two 20px fades; reveals
  alternated between clearing opposite edges. The mask is now omitted when the
  revealed chip cannot fit between those margins (`data-more-unmasked`). A chip
  wider than the viewport consistently shows its reading start. A smaller chip
  restores the mask. The overflow marks remain truthful in either case.
- **N5 — P2, wider/pre-existing: border-box geometry is not the client viewport.**
  First/last-chip reveals still use the group's bounding rectangle, which includes
  the part-switcher's 1px borders. That can accept a border-pixel clipping at an
  unfaded edge; the earlier hook already used that rectangle. A separate geometry
  refinement should combine client-scrollport containment with border-box mask
  coordinates. This candidate does not establish a P1 from that precision gap.

Other requested checks:

- **No reveal/scroll/mark/resize feedback loop found.** Scroll only updates
  attributes. Neither the attributes nor `mask-image` change layout sizes; the
  mutation observer watches direct child-list changes, not those attributes.
  Listener removal, both observer disconnects and the font unsubscribe are
  present. A regression checks scroll/focus listeners are inactive after unmount.
- **Marks are removed when a resize makes the row fit.** This is now exercised
  through the actual hook's ResizeObserver callback, beyond the candidate's
  direct `markMore` test. The 1px tolerance suppresses fractional endpoint noise;
  CSS pixels and the root-font-derived rem width remain consistent at ordinary
  browser zoom. CSS transforms/element `zoom` were not separately exercised.
- **No mask on a fitting bar.** Every mask selector requires an overflow mark;
  every mask selector also excludes `data-more-unmasked`. The candidate's
  recorded 1440 measurements showed fitting bars. No new browser pass was run in
  this review: jsdom verifies geometry/wiring and the CSS guard, not painting.
- **Protection applies to the revealed button.** A manual swipe may move a chosen
  or focused button under the fade or out of the viewport again. Scroll marking
  deliberately does not undo that swipe. Selection and focus can also be on
  different distant chips, so both cannot always be visible simultaneously.
  The CSS comment's unconditional focus-ring claim was corrected.
- **Mask compatibility:** the project's installed Tailwind optimizer was run
  against this sheet and emitted `-webkit-mask-image` alongside `mask-image`
  for both directions. No duplicate source declarations are needed for its built
  CSS. Browsers supporting neither ignore the mask; the controls still scroll
  and reveal, with no fade cue. The thin part-switcher scrollbar remains;
  OrderGroup's touch scrollbar remains hidden. The unprefixed property's
  compatibility baseline is described in
  [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/mask-image).
- **Learn's container is safe in this layout.** Its `.band-head` is an auto-width,
  stretched child of the explicitly sized `.mode-band` flex column, with
  `flex: none`. Inline-size containment removes dependence on children's intrinsic
  width, but does not change that externally determined head width or contain its
  block height. The 19rem query measures the head content box. Unsupported
  container queries leave shared 0.6rem padding (0.8rem for coarse pointers),
  and the bar can scroll; they do not restore the old globally tight padding.
  This is a layout inference from the CSS, consistent with the candidate's
  width measurements; see
  [inline-size containment](https://developer.mozilla.org/en-US/docs/Web/CSS/container-type).
- **OrderGroup without overflow:** no overflow marks or mask; any attempted
  reveal scroll is clamped by the browser. Desktop wrapping remains CSS-owned.
  Existing OrderGroup tests pass alongside the new focus/geometry regressions.

Validation:

- Red first: `tests/reveal-chosen-more.test.tsx` failed six cases before the
  fixes: focus/reflow, outward outline, LTR and RTL elastic bounds, and two wide
  chip sizes. The follow-up also checks fitting after resize, listener cleanup,
  and that the CSS mask actually excludes wide-chip rows.
- Requested six-file Vitest run: **6 files passed, 192 tests passed**, exit 0.
  `npx vitest run tests/reveal-chosen-more.test.tsx tests/order-group.test.tsx tests/learn-submode-four-chips.test.ts tests/part-switchers-share-one-bar.test.ts tests/arrows-belong-to-the-article.test.tsx tests/skim-panel.test.tsx`
- `npm run typecheck` could not start because the sandbox forbids tsx CLI's IPC
  socket (`listen EPERM`). Running the same script with
  `node --import tsx scripts/typecheck.ts` passed all four projects and verified
  coverage of all 3414 source files. After the final test additions,
  `node_modules/.bin/tsc --noEmit -p tests/tsconfig.json` also passed, exit 0.
- Scoped Biome lint: no errors; two pre-existing specificity warnings in unrelated
  `.chat-pointed li` / `.band-about` rules. `git diff --check` passed.
- No full suite was started, and no commit or push was made.

Root cause independently checked in a subagent and recorded in
[the postmortem](../postmortems/261007n-reflow-must-preserve-focus-and-a-reveal-must-admit-when-the-button-cannot-fit.md).

VERDICT: ready with these fixes

Files changed:

- `src/web/useRevealChosen.ts`
- `src/web/styles/mode-band.css`
- `tests/reveal-chosen-more.test.tsx`
- `docs/plans/261007h-f2-fade-code-review-sol.md`
- `docs/postmortems/261007n-reflow-must-preserve-focus-and-a-reveal-must-admit-when-the-button-cannot-fit.md`
