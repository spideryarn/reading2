The direction is sound, including Structure as a third experimental mode and the visitor policy, but I would revise the plan before building. Two issues affect the validity of Greg’s comparison: scroll position is not preserved “for free,” and the fixed focus-well design has silently disappeared.

Scope note: the worktree began receiving Structure implementation edits while I was reviewing it. I anchored factual checks to the requested pre-build commit, `b12a8fa1`, and used the incoming edits only as a positive control where noted.

## Findings

1. The central scroll-preservation claim is not established and is probably false at some widths.

The plan equates retaining `?at=` with retaining the visible reading position ([plan:45](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/docs/plans/260907c-structure-mode-as-a-third-mode-behind-the-experimental-switch.md:45)). Those are different guarantees.

Evidence:

- `withMode` does preserve other query parameters ([Dock.tsx:1707](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/Dock.tsx:1707)), and its unit test proves only that serialization fact ([dock-mode-urls.test.ts:54](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/tests/dock-mode-urls.test.ts:54)).
- The on-page mode buttons do not use `withMode`; they call `onActivate` ([Dock.tsx:1939](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/Dock.tsx:1939)), which ultimately calls `setMode(next)` ([Reader.tsx:2283](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/reader/Reader.tsx:2283)). Nuqs still leaves `?at=` alone, but the plan cites the wrong mechanism.
- On a mode change, the URL-to-page restoration effect does not run because it depends only on `at` ([useReadingPosition.ts:52](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/reader/useReadingPosition.ts:52)).
- The opposite effect does rerun on `layoutKey` and immediately measures the newly reflowed page ([useReadingPosition.ts:63](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/reader/useReadingPosition.ts:63)). It can therefore overwrite `?at=` with whichever section happens to land under the sticky line after reflow.
- Hierarchy has no band and retains gist columns; Outline and Structure open the fixed band and remove those columns ([Reader.tsx:321](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/reader/Reader.tsx:321)). The prose width and row heights change; `layoutKey` explicitly includes these dimensions because that reflow matters ([Reader.tsx:451](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/reader/Reader.tsx:451)).
- `?at=` is normally section-granular, so even deliberate restoration can put the reader at a section’s beginning rather than the same paragraph ([url-state.md:414](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/docs/project/url-state.md:414)).

What I would do: make position retention an implementation requirement, not a Stage 4 observation. Before changing mode, capture a stable block or section plus its viewport offset; after the new layout commits, restore that offset before allowing the scroll spy to write. Add browser assertions for all Hierarchy/Outline/Structure transitions, checking the block at the focus line and its bounding-rect offset—not merely screenshots or the unchanged URL.

2. The plan silently drops the fixed focus wells, which makes the v1 an unfair test of Structure.

The previous design’s fixed-height focus well was the answer to boundary churn: changing current content should not displace everything below it ([Sol memo:42](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/docs/plans/260903b-one-structure-mode-hierarchy-and-outline-merged-sol-design-memo.md:42), [old plan:211](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/docs/plans/260903b-one-structure-mode-hierarchy-and-outline-merged.md:211)). It is neither implemented nor listed as deferred in the new plan.

Without it:

- Column A does not “change never” as claimed ([plan:78](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/docs/plans/260907c-structure-mode-as-a-third-mode-behind-the-experimental-switch.md:78)); its current/near gists change at part boundaries.
- Column B inserts and removes the current section’s gist and paragraphs. Sibling rows below it move even though they represent unchanged structure.
- Independently selected rungs can change at the same boundary, adding another discontinuity.

This can look polished while producing exactly the orientation churn the mode is supposed to solve.

What I would do: restore a fixed-height detail/focus region per column, or otherwise reserve invariant space for the expanding material. Compute the current part and section once from `focusRow`, then derive both columns and all rung candidates from that single selection model. The independently measured rungs must not independently decide what “current” means.

3. The proposed paragraph counters cannot truthfully say “12 earlier / 9 later” from the available position signal.

The plan correctly says `focusRow` is section-granular. `useColumnContext` chooses the active section and returns its first row ([useColumnContext.ts:128](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/useColumnContext.ts:128)); Outline reads it as such ([OutlinePanel.tsx:30](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/OutlinePanel.tsx:30)). Outline deliberately never marks a current paragraph because doing so would plausibly—but usually incorrectly—mark the section’s first paragraph ([outline.ts:52](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/outline.ts:52)).

Therefore a current-centred paragraph window and both edge counts cannot be derived honestly.

What I would do:

- For v1, show all paragraph labels only when the complete set fits and is below the cap.
- Otherwise show the section gist plus an honest total such as “26 paragraphs,” as the Sol memo proposed ([Sol memo:54](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/docs/plans/260903b-one-structure-mode-hierarchy-and-outline-merged-sol-design-memo.md:54)).
- If centred paragraph windows are essential, add and test a genuinely paragraph-granular focus signal.

Also apply `paragraphLabelsReady`; Outline withholds the entire layer rather than presenting missing labels as missing article structure ([OutlinePanel.tsx:49](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/OutlinePanel.tsx:49)).

4. The checklist claim is incomplete, and Stage 1 as written is neither compiling nor fully truthful.

Against `new-mode.md` as it stood at `b12a8fa1`, the plan answers every listed residue item. But the checklist itself misses a compiler-forced total:

- `GENERATES: Record<Mode, boolean>` lives in [command-bar.test.tsx:317](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/tests/command-bar.test.tsx:317). It needs `structure: false`.
- The plan’s statement that “Nothing counts the modes” is false ([plan:230](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/docs/plans/260907c-structure-mode-as-a-third-mode-behind-the-experimental-switch.md:230)). [page-head.test.ts:545](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/tests/page-head.test.ts:545) deliberately asserts 14 as a positive-control count.

When the concurrent edits added Structure, I ran the permitted `npx vitest run tests/page-head.test.ts`: 26 tests passed and that count failed, receiving 15 instead of 14.

Stage 1 also advertises “two linked columns” in the Dock card ([plan:240](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/docs/plans/260907c-structure-mode-as-a-third-mode-behind-the-experimental-switch.md:240)) while its actual panel lists only parts ([plan:266](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/docs/plans/260907c-structure-mode-as-a-third-mode-behind-the-experimental-switch.md:266)). Experimental users—and anyone opening the intentionally reachable URL—would receive a false description.

I would recut the stages:

1. Pure projection plus committed fixtures, without adding the mode vocabulary.
2. Vocabulary, every total including `GENERATES`, the count update, experimental/public tests, and a small but faithful A+B panel powered by the projection.
3. Measured ladders, fixed wells, responsive layout, keyboard/touch, and explicit scroll-anchor preservation.

Tests must not rely solely on `data/`: it is gitignored, so those tests are not portable to CI or another checkout.

5. The corpus maxima are wrong, and the overflow design protects the wrong level.

I measured every currently present `data/*/tree.json`:

- Maximum root children/parts: 8, `openai-huggingface` ([tree.json:11](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/data/openai-huggingface/tree.json:11)).
- Maximum sections in a part: 7, Constitution’s “Being helpful” ([tree.json:451](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/data/constitution/tree.json:451)).
- Maximum paragraphs in a section: 26, Noema’s “Brains Are Not Computers” ([tree.json:699](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/data/noema-mythology-of-conscious-ai/tree.json:699)).

The older corpus report did contain a Constitution part with 15 sections ([260828aw:350](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/docs/plans/260828aw-outline-mode.md:350)), but the later design explicitly also records Noema’s 26-paragraph section ([260903b:57](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/docs/plans/260903b-one-structure-mode-hierarchy-and-outline-merged.md:57)). Thus “15 and 23” is not correct against either the current five files or the documented historical corpus.

More importantly, “the ladder does not climb” does not protect a base rung that itself cannot fit. Short viewports or future trees can overflow the mandatory part/section sibling lists. Add centred windows plus explicit counters for base sibling sets, not only paragraph expansion, and test short-height panels.

6. The 400px premise is good, but 194px/364px is not the exact box arithmetic.

Verified:

- `GIST_MIN = 176` ([layout.ts:72](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/layout.ts:72)).
- `MODE_IDEAL = 400`, `MODE_MIN = 288` ([layout.ts:247](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/layout.ts:247)).
- `modeW = clamp(avail - PROSE_MIN, MODE_MIN, MODE_IDEAL)` ([layout.ts:790](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/layout.ts:790)).

But `.mode-band` has a 1px border and global `border-box` sizing ([mode-band.css:28](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/styles/mode-band.css:28), [tokens.css:305](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/styles/tokens.css:305)). With no Structure padding:

- 400 outer pixels provide 399 content pixels.
- After a 12px gutter, the tracks are 193.5px each.
- A 364px outer band provides 363 content pixels, or 175.5px tracks.
- The exact outer threshold is 365px.

There is no universal band padding, but any Structure-specific padding raises that threshold; copying Outline’s 20px horizontal padding would raise it to roughly 385px ([outline-mode.css:44](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/styles/outline-mode.css:44)).

Also, when the band covers the prose, `fitMode` reports `modeW: 0` while CSS expands the actual band to viewport width ([layout.ts:764](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/layout.ts:764), [narrow-window.css:326](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/styles/narrow-window.css:326)). Do not choose stacked/two-column layout from `--mode-w`; use the actual grid content width.

The underlying product tweak remains plausible: roughly 193.5px is still above 176. Browser readability remains unverified.

7. Decision 2’s deviation is declared, but its reason is factually wrong; decision 5 has an undeclared deviation.

“Today’s trees are three deep, so there is nothing to choose between” ([plan:178](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/docs/plans/260907c-structure-mode-as-a-third-mode-behind-the-experimental-switch.md:178)) is false. Even at three depths the choice is `[parts][sections + paragraphs]` versus `[parts + sections][paragraphs]`. Greg explicitly chose fit over stability for that current choice ([old plan:264](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/docs/plans/260903b-one-structure-mode-hierarchy-and-outline-merged.md:264)).

The fixed split may still be the better v1, but the honest rationale is: decision 1 gives the columns stable semantic jobs, and this plan now values those jobs and lower churn above fuller columns. That explicitly reverses decision 2 now, rather than postponing it until adaptive depth.

Decision 5 also said rows jump and hover shows a card with the row’s gist and children ([old plan:273](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/docs/plans/260903b-one-structure-mode-hierarchy-and-outline-merged.md:273)). The new plan conflates that card with inspection-focus retargeting and drops it. Either include the card or name it as a third deliberate deviation. It can reasonably be deferred; it just cannot be attributed to Greg’s answer as written.

Adaptive uneven depth itself can honestly be deferred for this experiment. A fixed three-deep v1 can compare the three renderings of today’s artefact. The conclusion must be scoped accordingly: it says nothing about books, deeper trees, or fit-selected depth allocation.

8. The visitor policy is correct, but the proposed public test can pass with half the mode missing.

Outline is explicitly visitor-available because it reads the payload tree ([visitor.ts:161](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/visitor.ts:161)). The public projection includes and sanitizes the complete tree, including `navLabel`, gist and treatment ([public-reader.ts:267](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/store/public-reader.ts:267), [dto.ts:235](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/public/dto.ts:235)). Experimental status controls discoverability, not authorization; direct URLs deliberately remain reachable ([experimental-features.md:37](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/docs/project/experimental-features.md:37)). Structure should therefore be visitor-available, not owner-only.

However, the public test fixture has only a root and one part—no section child ([public-network-trace.test.tsx:331](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/tests/public-network-trace.test.tsx:331)). A `BAND_SAYS` assertion using that part title can pass while Column B never renders. Add a root → part → section fixture and a Structure-specific assertion that separately observes readable rows in both columns, alongside the zero-request trace.

## Other verified facts

- At baseline, `App.tsx` was 462 lines and `src/web/modes/` had exactly the ten named controller directories. Structure is naturally the eleventh. This claim is correct.
- `focusRow` is section-granular and Outline reads it. That claim is correct, but Structure must expand the currently Outline-only `buildSummaryTree` memo and `useColumnContext` enable gate ([Reader.tsx:443](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/reader/Reader.tsx:443), [Reader.tsx:505](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/reader/Reader.tsx:505)).
- “The same object” is inaccurate. Hierarchy uses `buildGeometry`; Outline uses a separate `buildSummaryTree` projection ([Reader.tsx:243](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/reader/Reader.tsx:243), [tree.ts:508](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/tree.ts:508)). They share the same stored `article.tree`, which is the important contract; reword the claim that way.
- Copying Outline’s measurement machinery into Structure is reasonable during the comparison, but make it one Structure-local hook called twice. Its hidden candidates must exactly match each real column’s width and padding, observe each candidate child, handle font changes, and break equal-height ties toward the lower rung—the silent failures documented in [OutlinePanel.tsx:145](/home/greg/code/spideryarn2/.claude/worktrees/structure-third-mode/src/web/OutlinePanel.tsx:145).

I could not verify browser-level position retention, 193.5px readability, or the connector’s effectiveness under the stated no-browser constraint. I also cannot verify “the whole corpus” beyond the five ignored local trees; the historical timing and primary-checkout state recorded in the plan are not independently recoverable from this worktree.

Before writing code, my three changes would be: design and test explicit viewport anchoring; restore fixed focus wells and honest overflow behavior; and recut Stages 1–2 so the mode is registered only when a truthful two-column projection and every total/count are ready.