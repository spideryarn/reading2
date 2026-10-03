The implementation approach is sound. I found no P0 runtime issue and no token consumer that would silently become wrong after the proposed swap. I would approve the design after strengthening the test plan in two places.

## Findings

### P0

None.

### P1 — the plan claims a directional test that does not exist

The plan says an existing test asserting the gutter’s `left` will be changed to assert `right` ([plan:64](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/docs/plans/261003c-block-gutter-icons-move-to-the-right-of-the-block.md:64)). There is no such assertion for the ordinary gutter:

- The centring test only checks that `.blk-gutter` mentions the inset, measure, and both pads; it never checks `left` versus `right` ([prose-centred-in-its-cell.test.ts:71](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/tests/prose-centred-in-its-cell.test.ts:71)).
- The only directional gutter assertion is the footnote override’s current `left` ([prose-centred-in-its-cell.test.ts:122](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/tests/prose-centred-in-its-cell.test.ts:122)).
- `gutter-target-size.test.ts` checks that the gutter-bearing token is currently the left pad ([gutter-target-size.test.ts:178](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/tests/gutter-target-size.test.ts:178)), and it pins the reading strip’s `left: 100%` and pseudo-element’s `left: 0` ([gutter-target-size.test.ts:195](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/tests/gutter-target-size.test.ts:195)), but not the base gutter’s side.

Add positive and negative assertions:

- `.blk-gutter` contains `right: calc(...)` and no positioning `left:`.
- `td.text.note .blk-gutter` contains the full `right:` formula and no `left:`.
- `.blk-read` contains `right: 100%`; its `::after` contains `right: 0`; neither retains the old directional property.
- `--text-pad-r` derives from the gutter, while `--text-pad-l` is the plain rem pad.

Otherwise accidentally swapping the tokens but forgetting the base `left → right` change can pass the structural suite.

### P1 — the stated fold invariant is not checked at 12px or 20px roots

The screenshot matrix names widths only ([plan:72](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/docs/plans/261003c-block-gutter-icons-move-to-the-right-of-the-block.md:72)). This code explicitly supports non-default roots: the slot is `max(1.5rem, 24px)` ([shell.css:38](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/src/web/styles/shell.css:38)), and previous root-specific overhangs are why the heading and gutter floors exist ([gutter.css:277](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/src/web/styles/gutter.css:277)).

The proposed geometry is correct, but the plan should require either browser measurements or an explicit arithmetic test at 12, 16, and 20px roots, including 390px and a wide centred cell. The current functional fold tests do not inspect layout ([fold.test.ts:284](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/tests/fold.test.ts:284)).

### P2 — add Marginalia’s owning doc; preserve historical quotes

Because coexistence with Marginalia is the main design decision, record the resulting order in [marginalia.md:1](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/docs/project/marginalia.md:1), not only in the plan.

Do not “correct” Greg’s historical wording in [touch.md:428](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/docs/project/touch.md:428) or the quoted report in [BlockGutter.tsx:862](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/src/web/BlockGutter.tsx:862). Those are dated direct quotes; add current-state prose around them instead.

## Answers to the six questions

1. No token consumer becomes wrong, although several are intentionally asymmetric.

- `td.text` uses the pads as their physical sides, so the swap is exactly what moves its reserved space ([prose.css:75](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/src/web/styles/prose.css:75)).
- `.fold-toggle` uses the right pad plus the symmetric centring slack; it should remain unchanged ([prose.css:145](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/src/web/styles/prose.css:145)).
- The lone-column masthead’s signed `padR − padL` is correct: it follows the prose axis when the asymmetry reverses ([narrow-window.css:1224](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/src/web/styles/narrow-window.css:1224)).
- The band-mode masthead expression carries both pads and both masthead gutters explicitly, so it also reverses correctly ([narrow-window.css:1318](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/src/web/styles/narrow-window.css:1318)).
- The phone controls and masthead intentionally use only `--text-pad-l`; moving the `0.9rem` override to that token keeps them aligned with the new plain left edge ([narrow-window.css:170](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/src/web/styles/narrow-window.css:170), [narrow-window.css:226](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/src/web/styles/narrow-window.css:226)).
- `.notes-head` and `.note-num` intentionally use the prose’s starting edge, so they should move to the new plain left pad ([footnotes.css:115](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/src/web/styles/footnotes.css:115), [footnotes.css:129](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/src/web/styles/footnotes.css:129)).
- `.figure-note` does not read either token directly; it begins at the cell’s content edge and remains outside `.prose` ([prose.css:529](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/src/web/styles/prose.css:529)).
- Callouts, captions, and opaque blocks merely use narrower centred `.prose` boxes; the gutter deliberately follows the ordinary 65ch measure, as it does today ([prose.css:391](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/src/web/styles/prose.css:391)). There are no remaining hierarchy/gist-column token consumers.

The proposed footnote formula is also correct: because footnotes opt out of centring ([footnotes.css:71](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/src/web/styles/footnotes.css:71)), it must consume all surplus width, not half of it.

2. No other runtime mechanism assumes the block gutter is left.

- Gutter hover cards use the control’s rectangle with top placement plus `flip` and `shift`, not a hard-coded horizontal side ([BlockLinkCard.tsx:327](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/src/web/BlockLinkCard.tsx:327)).
- Touch activation is selector- and event-based; `.blk-gutter` is excluded as a hit surface regardless of its coordinates ([TableView.tsx:426](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/src/web/TableView.tsx:426)).
- The comment mark and keyboard focus are children of the gutter, so they travel with it. Focus styling is local to those children ([gutter.css:787](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/src/web/styles/gutter.css:787), [gutter.css:882](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/src/web/styles/gutter.css:882)).
- `.pin-right` does not pin anything; it only removes the last border ([table.css:90](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/src/web/styles/table.css:90)).
- The open `…` panel changes height, stacking, border, and hit testing but not horizontal placement, so it follows the moved gutter ([gutter.css:825](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/src/web/styles/gutter.css:825)).
- Scroll targeting reads row and passage rectangles vertically; there is no horizontal gutter term ([scroll.ts:981](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/src/web/scroll.ts:981)).
- The spine is independently fixed to the viewport’s left edge, and `spine-marks.ts` works in row/document pixels ([spine-marks.ts:19](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/src/web/spine-marks.ts:19)).
- `scatter.ts`’s `PAD_X` is internal diagram padding, unrelated to article-cell geometry ([scatter.ts:103](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/src/web/scatter.ts:103)).

3. Marginalia does not collide, and `--marg-reserve` must not change.

`.marg-note` starts at `left: 100%` of the cell and puts its text another `--marg-gap` beyond that ([marginalia.css:35](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/src/web/styles/marginalia.css:35)). The gutter remains wholly inside the cell.

At minimum slack, the gap from the gutter target’s outer edge to note text is:

`--blk-gutter-x + --marg-gap`

That is 19.2px at a 12px root, 25.6px at 16px, and 32px at 20px. Even the Marginalia chevron begins on the far side of the cell edge: `1.25rem − 0.9rem = 0.35rem`, matching the gutter inset ([marginalia.css:164](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/src/web/styles/marginalia.css:164)). Thus the two target boxes retain `2 × --blk-gutter-x` between them.

`fitMargin` and `fitBoth` position Marginalia from the table’s outer right edge, not the prose’s internal padding ([layout.ts:543](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/src/web/layout.ts:543), [layout.ts:598](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/src/web/layout.ts:598)). Since the two pad widths merely exchange sides, `proseAloneMaxPx`, `margReserve`, `margLeft`, and every crossover remain unchanged.

4. Yes, the fold toggle remains beside the gutter rather than underneath it.

Let `S` be the non-negative centring slack and `G = --blk-gutter-x`. After the swap:

- prose right edge = `cellRight − padR − S`
- fold box = the final `--blk-slot` inside that prose edge
- gutter box begins at `proseRight + G`

because the new right pad is `slot + 2G`.

So the fold control and gutter are always separated by exactly `G`: 4.2px at a 12px root, 5.6px at 16px, and 7px at 20px. The phone’s `0.9rem` change affects only the left pad and therefore cannot alter this relationship. The heading also reserves one slot at the end of its prose ([prose.css:412](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/src/web/styles/prose.css:412)) and floors the row to contain the target ([prose.css:136](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/src/web/styles/prose.css:136)).

The plan’s reasoning is right; its verification matrix needs the root-size cases noted above.

5. The token swap is the simplest mechanism.

Moving each consumer independently would duplicate the side decision and make masthead/phone alignment easier to miss. Logical properties would encode writing direction, whereas the requested design is specifically the physical right side. Semantic aliases such as `--text-pad-gutter` and `--text-pad-plain` would be slightly more descriptive but add indirection without eliminating any mirrored positioning rule. I would keep the proposed swap.

6. Missing or clarified updates:

- Add exact direction assertions for the base gutter, footnote gutter, reading strip, and line.
- Add fold/gutter rendered measurements at 12px and 20px roots, not just the default root.
- Add the resulting gutter–note ordering to `docs/project/marginalia.md`.
- Update side-specific comments in the named source and test files, including the cap test that currently parses the plain pad specifically from `--text-pad-r` ([gutter-target-size.test.ts:723](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/tests/gutter-target-size.test.ts:723)).
- Preserve dated quotations that say “left”; they describe the original report rather than current geometry.
- `tests/layout-margin.test.ts`, `scatter.ts`, `spine-marks.ts`, scroll tests, and functional fold tests require no value changes. Their underlying behavior is unchanged.