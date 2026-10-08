build with fixes

**PR-1 (P1) — Prefer a generic labelled group over putting More inside a radiogroup.**  
D2 overstates the standard: `radio` is a required owned element of `radiogroup`, but that does not explicitly mean every descendant must be a radio. Nevertheless, this would be a mixed-control composite whose behaviour does not match the [ARIA radio-group pattern](https://www.w3.org/WAI/ARIA/apg/patterns/radio/)—especially since this Dock deliberately keeps every mode tabbable rather than using arrow-key navigation.

The cleaner structure is:

```tsx
<div role="group" aria-label="Article views">
  {/* Plain frame */}
  {/* Structure, Summary, Diagram, Skim, More, gathered mode */}
</div>

<div role="group" aria-label="Marginalia and comments">
  {/* Marginalia and Comments */}
</div>
```

Make mode controls ordinary buttons with `aria-pressed`, while More remains a menu button and Comments retains `aria-expanded` or link semantics. That preserves the exact visual and Tab order without misleading assistive technology. A toolbar is not a better replacement because the [toolbar pattern](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/) also expects composite arrow-key navigation. This change must also update `SkipToModes.tsx` and `skip-to-modes.test.tsx`.

Option 1 is acceptable as a narrow pragmatic compromise, but then:

- Change the label from “What the middle column shows” to something truthful such as “Article views and more modes”.
- Retain native DOM order: Skim radio → More button → Search radio.
- Add an assistive-technology check, ideally VoiceOver/Safari or an accessibility-tree assertion, including Escape returning focus to More.
- Correct the plan’s claim that ARIA categorically permits only radio children; the real concern is compatibility and conceptual accuracy. See the [WAI-ARIA definition](https://www.w3.org/TR/wai-aria-1.2/#radiogroup).

**PR-2 (P1) — Moving Comments exposes a stale fit-state bug when its drawer is open.**  
At fit rung 2, `.dock-modes .dock-btn-label` hides Comments, but the broader rule `.dock.dock-fit-2 .dock-btn.on .dock-btn-label` shows the label again when Comments gains `.on`. `fitSignature` does not include whether that drawer is open, so opening Comments can enlarge the bar without triggering a remeasurement. Scope the exception to actual selected mode controls—preferably via a stable mode attribute/class—or include panel state in the signature. Add a test for open Comments at rung 2.

**PR-3 (P1) — Several selectors currently equate “link inside `.dock-modes`” with “mode”.**  
Once the Comments link moves inside that subtree, it will be counted as a mode by:

- `tests/helpers/dock-more.ts`
- `tests/dock-experimental-modes.test.tsx`
- `tests/dock-mode-tooltips.test.tsx`
- `tests/dock-more.test.tsx`
- `tests/dock-fit.test.ts`

Add a stable marker such as `data-mode` to mode buttons and links, then retarget these helpers. Do not filter by the visible word “Comments”. Also update `tests/dock-corner-controls.test.tsx`, which explicitly asserts that More is outside the radiogroup, and the frame expectations in `tests/a-second-press-closes-the-mode.test.tsx`.

**PR-4 (P1) — The plan mentions `drawnCount`, but not all three width-accounting layers.**  
The implementation must update and test:

- The outer drawn count: drawn modes + More + Comments.
- The bands-frame count: band radios + More.
- `--dock-radio-count`, or its renamed equivalent if the radiogroup is removed: modes + More.
- The Marginalia frame count: Marginalia when present + Comments.
- The Comments-only Marginalia frame case.

These affect the coarse-pointer flex distribution, not merely desktop fitting. Exercise experimental modes both on and off, plus an open gathered mode after More.

**PR-5 (P2) — D1 itself is sound, but its boundary tests should include experimental FAQ.**  
Changing Skim to `group: "shape"` correctly removes the separator before it while leaving Diagram between Summary and Skim when enabled. Keep More’s insertion derived from the last drawn shape item rather than a fixed array index. Test every gathered mode, including FAQ with experimental modes enabled, because the normal configuration does not exercise that path. Update the `ModeGroup` explanation and the Skim “guides row” comment.

**PR-6 (P2) — The documentation sweep needs some specific non-obvious targets.**  
In addition to the named project docs, update:

- `src/web/help/pages/the-reading-view.md`, whose prose and image alt text give the old order.
- `src/web/help/pages/images/bottom-bar.png` if it visibly shows that order, then regenerate the help corpus rather than editing the generated JSON manually.
- `docs/project/reading-view-overview.md`, which explains why More is outside the radios.
- The “own frame/outside radiogroup” comments in `Dock.tsx` and `dock-fit.css`.
- The loose-control arithmetic comment in `narrow-window.css`.
- The rung-2 Comments comment in `dock-fit.ts`.

No functional change appears necessary for the phone hide-on-scroll guard or drawer Escape handler: both locate the open More trigger globally rather than relying on it being after the mode group. `scripts/measure-cpu.ts` also remains valid if modes use `aria-pressed` and More keeps its existing trigger selector.