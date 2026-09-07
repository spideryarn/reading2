Verdict: the commit is not ready to land. There are two immediate blockers, followed by several stage-2 hazards.

## Findings

1. The committed visitor policy is incomplete and crashes public readers.

`HEAD` adds `structure` to `Mode` but not to the total `POLICY` record in [visitor.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/visitor.ts:152). `visitorGap()` then dereferences `policy.kind` at line 316 when `policy` is undefined.

The working tree contains the correct `structure: { kind: "available" }` addition at [visitor.ts:169](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/visitor.ts:169), but `git diff HEAD -- src/web/visitor.ts` shows it is uncommitted and therefore absent from the scoped diff.

Evidence: against an archive of committed `HEAD`, `tests/visitor-gaps.test.ts` ran 17 tests and failed the two sweeps that reach Structure, both with:

```text
TypeError: Cannot read properties of undefined (reading 'kind')
```

This also breaks `markedModes()` and the sharing inventory, not merely a direct `?mode=structure` visit.

What I would do: include the existing uncommitted policy hunk in the stage commit, then rerun the visitor and public-network tests against a clean `HEAD`. This demonstrates that the visitor tests were strengthened correctly—they caught the omission.

2. The two-column container query cannot affect the grid, so Structure always remains stacked.

`.struct-grid` establishes itself as the query container at [structure-mode.css:57](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/styles/structure-mode.css:57), while the query attempts to restyle that same element at [structure-mode.css:72](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/styles/structure-mode.css:72). A container query applies to descendants of its query container; the container cannot query itself.

The result is especially inconsistent above 364px:

- `.struct-grid` stays one column.
- `.struct-inner`, which really is a descendant, no longer matches the stacked-layout rule at line 95 and retains its left-hand bracket.

Thus wide Structure is a stacked layout decorated as though it were side-by-side.

What I would do: put `container-type: inline-size` on `.mode-band.struct`, not `.struct-grid`. The grid and bracket are then both descendants querying the same content box, and the existing 364px threshold remains the right content-box arithmetic.

3. Column B’s windowing breaks both monotonicity and the paragraph all-or-nothing promise.

Paragraphs are inserted into `bRows` at [structure.ts:318](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/structure.ts:318), after which the combined section-and-paragraph list is windowed at [structure.ts:338](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/structure.ts:338).

With `limitB`, rung 3 can therefore replace sibling sections with a partial paragraph run. For example, a three-row window around the first current section can change from:

```text
section 1, section 2, section 3
```

to:

```text
section 1, paragraph 1, paragraph 2
```

That means a higher rung draws less of the mandatory section structure and truncates a paragraph set that the comments promise is “all or none.” The `earlier`/`later` counts also become counts of heterogeneous rows rather than hidden sections.

Separately, [windowed():224](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/structure.ts:224) treats `limit <= 0` as “show everything,” although the API says `null` is the no-limit sentinel. A zero-row capacity therefore creates maximum overflow.

What I would do: represent/window the sibling sections separately from current-section detail. Choose the rung first; if its paragraph detail does not fit, drop the whole paragraph rung. Then window only the mandatory sibling level. Test `limitB` with paragraphs, zero capacity, and no current row.

For positive limits, the present arithmetic is correct at the first and last rows; with no current row it deliberately keeps the head, matching its comment.

4. “Current” is in fact decided twice.

The selection model computes `currentPart` and `currentSection` once at [structure.ts:281](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/structure.ts:281). But `makeRow()` independently recomputes `here` with another range-containment decision at [structure.ts:203](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/structure.ts:203).

On valid, disjoint fixture ranges they agree. That is why the test called “from one selection” passes. Structurally, however, the stated invariant is not built: malformed or overlapping sibling ranges can select the first part while marking multiple parts, and `windowed()` then centres from the second answer.

What I would do: pass `here: entry === currentPart/currentSection` into `makeRow`; paragraphs receive `false`. Keep range containment only in the single selection walk.

There is a related uncovered state: if the selected part has no title or nav label, it is omitted from Column A while Column B can still show its children. The right column is then the inside of a row that is not visible or marked.

5. The planned connector and supplement alignment are not actually present.

The plan promises a right-edge marker on Column A’s current part and a matching bracket on Column B at [plan:215](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/docs/plans/260907c-structure-mode-as-a-third-mode-behind-the-experimental-switch.md:215). The CSS contains the Column B border at [structure-mode.css:83](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/styles/structure-mode.css:83), but Column A has only the generic current-row background at [structure-mode.css:202](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/styles/structure-mode.css:202). There is no right-edge marker or shared connector tint.

The code also does not preserve the supplement’s number gutter as its comment claims. [StructurePanel.tsx:92](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/StructurePanel.tsx:92) omits `.struct-num` when the number is empty, whereas Outline always renders its empty number span. This contradicts [structure-mode.css:208](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/styles/structure-mode.css:208) and causes the apparatus title to shift left.

What I would do: add the promised matching edge marker, and always render the number span—even when empty—if aligned gutters are intended. The underlying supplement projection is otherwise correct: unnumbered, not expanded, no gist, and still current when the reader is inside it.

6. Long lists do overflow the current band; `flex` merely ensures the outer grid shrinks before its contents are clipped.

At `MODE_MIN` 288, the content box is roughly 263px after border and horizontal padding, so it stacks. The grid has no scrolling or windowing, and the band clips all overflow at [structure-mode.css:28](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/styles/structure-mode.css:28).

`flex: 1 1 auto; min-height: 0` at [structure-mode.css:62](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/styles/structure-mode.css:62) lets the grid’s own box shrink; it does not shrink or window its lists.

What breaks first:

- Normally the tail of Column B is clipped, because all of Column A precedes it in the stacked grid.
- If the part list alone exceeds the band, Column A is clipped and Column B can disappear entirely.
- Once the two-column query is fixed, whichever side is taller is independently clipped.

This is already declared as stage 2, so I would not expand stage 1 to solve it twice. But it is a real current behaviour, not protection supplied by the flex rules.

7. The tests have material blind spots.

The two mutations you tried are good: changing `contains` and deleting Column B both attack central properties and go red.

I mutation-checked additional cases in an archived `/tmp` copy:

- Making Column A rung 4 identical to rung 3, and deleting Column B’s near/all gist behaviour, left all 16 projection tests green.
- Replacing every row’s `blockId` with one wrong constant left all 22 requested tests green.
- Removing gist rendering from `StructurePanel` left all 6 panel tests green.

The reason the rung-4 A assertion is weak is the three-part fixture at [structure-projection.test.ts:97](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/tests/structure-projection.test.ts:97): current plus its two neighbours already means everybody, so rungs 3 and 4 are indistinguishable. Column B’s rung-4/rung-5 gist progression is not asserted at all. Neither file presses a row, checks its jump target, or verifies that a projected gist reaches the DOM.

I would add:

- At least five parts, so rung 3 leaves distant parts ungisted and rung 4 adds them.
- At least five sections for the equivalent B checks.
- `limitB` combined with paragraph expansion.
- `limitA/B: 0`.
- A click assertion checking the exact block ID.
- A DOM assertion for each current gist.

8. A reader without Experimental Features does see one new thing once the visitor-policy fix is committed.

The Dock and command bar are correctly gated through the same filtered `visible` list at [Dock.tsx:1220](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/Dock.tsx:1220). Ordinary reading, metadata and tweets navigation do not expose Structure unless the URL already names it; retaining a URL-named current experimental mode is deliberate.

However, `sharedInventory()` walks every member of `MODES` without consulting experimental visibility at [shared-inventory.ts:101](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/shared-inventory.ts:101). Once Structure’s visitor policy is present, it adds a visible “Structure” row to the Access & Sharing inventory at lines 107–119 even for an owner whose switch is off.

So “the ordinary reader’s bar is unchanged” is true. “A reader without the switch is unaffected anywhere” is false.

I would probably narrow the claim rather than filter the disclosure: direct Structure URLs are genuinely shareable, so hiding that fact from the sharing inventory is debatable. If strict invisibility is the product requirement, this inventory needs the experimental setting or an explicit rule excluding presentation-only duplicates.

## Tests and table edits

The other table edits do not weaken their existing contracts. In particular:

- `visitor-gaps` is strong enough to catch the missing committed policy.
- `dock-experimental-modes` retains an independent identity list.
- `command-bar`, `DRAWS`, `SPENDS`, `page-title`, passage selection, and the stylesheet manifest received ordinary total-table additions.
- The dedicated two-column panel test is the right answer to the shallow shared fixtures.

Changing `MODES.length === 14` to `> 5` in `page-head.test.ts` is technically a weaker change detector: it no longer forces that file to notice every addition or removal. It is not a meaningful loss of title-behaviour coverage, because the loop already consumes every current `MODES` entry and the independent total records force new modes through their real decisions. I would not restore the literal count. If protection against accidental truncation is wanted, an explicit mode-identity contract belongs in a mode-vocabulary test rather than as arithmetic inside the title test.

The requested two suites pass: 22/22. The other runnable changed suites passed in the working tree. The stylesheet-manifest suite passed 5/6; its final check was blocked because this sandbox refused its child `git` process. Against clean committed `HEAD`, the visitor suite fails 2/19 as described above.

## Prose that is false

Besides the substantive comments already mentioned:

- The “one selection model” comments in [structure.ts:10](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/structure.ts:10) overstate the implementation.
- The connector description in the plan says a Column A marker exists when it does not.
- The plan says Column B’s quiet header is the part number “and nothing else,” but [StructurePanel.tsx:191](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/StructurePanel.tsx:191) deliberately renders number plus title.
- [plan:473](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/docs/plans/260907c-structure-mode-as-a-third-mode-behind-the-experimental-switch.md:473) says the shared public fixture gained a section; the implementation correctly chose a separate test instead.
- Numerous exact-count comments became stale: for example [Dock.tsx:777](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/Dock.tsx:777), [Dock.tsx:1142](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/Dock.tsx:1142), [Dock.tsx:1498](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/Dock.tsx:1498), [Reader.tsx:161](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/reader/Reader.tsx:161), and [Reader.tsx:856](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/reader/Reader.tsx:856). There are now 15 modes and 10 modes without passage producers.

## Where I agree

You are right about `data/`: [worktree-setup.ts:139](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/scripts/worktree-setup.ts:139) calls `materialiseCorpus()`, whose source is explicitly `tests/fixtures/data-root` at [corpus-materialise.ts:35](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/scripts/corpus-materialise.ts:35) and which copies it into `data/` at lines 62–75. The fixture README identifies it as five selected articles. My earlier maxima were fixture maxima, not corpus maxima; the revised plan is honest to reject them.

I also accept measurement-before-anchoring for scroll preservation, provided the browser transition measurement remains a gate before calling the comparison usable. It is pre-existing shared machinery, and building anchoring before observing a defect would be premature.

Finally, absent `limitB`, the rung construction itself is monotonic; positive-window arithmetic is correct at both list ends; the tree source, paragraph-label readiness wiring, visitor intent, mode registration, and underlying supplement semantics are sound.