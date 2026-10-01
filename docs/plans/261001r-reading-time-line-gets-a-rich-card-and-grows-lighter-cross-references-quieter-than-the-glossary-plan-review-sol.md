No P0 findings. One issue would visibly break the requested behaviour; two others need resolving before implementation.

1. **P1 — The proposed opacity formula draws a line on every unread row.**

   The plan proposes `0.02 + level² × 0.03` ([plan:51](/home/greg/code/spideryarn2/.claude/worktrees/fbmn3ruw-sxvq2j-reading-marks/docs/plans/261001r-reading-time-line-gets-a-rich-card-and-grows-lighter-cross-references-quieter-than-the-glossary.md:51)). At level 0 that is `0.02`, not zero. Every gutter always renders the span ([BlockGutter.tsx:867](/home/greg/code/spideryarn2/.claude/worktrees/fbmn3ruw-sxvq2j-reading-marks/src/web/BlockGutter.tsx:867)); its box becomes zero-width when `--read` is absent ([gutter.css:932](/home/greg/code/spideryarn2/.claude/worktrees/fbmn3ruw-sxvq2j-reading-marks/src/web/styles/gutter.css:932)), but the absolutely positioned pseudo-element still has `width: 2px` and is not clipped ([gutter.css:952](/home/greg/code/spideryarn2/.claude/worktrees/fbmn3ruw-sxvq2j-reading-marks/src/web/styles/gutter.css:952)). It therefore remains faintly visible while having no hover target—the opposite of “no visible line at first.”

   Concrete fix: use a zero-at-zero curve, for example `level × (level + 1) × 0.025`, yielding `0, .05, .15, .30, .50`, or explicitly clip the pseudo-element. Prefer the former because opacity itself then preserves the invariant.

   Also update the exact old-value assertion in [gutter-target-size.test.ts:228](/home/greg/code/spideryarn2/.claude/worktrees/fbmn3ruw-sxvq2j-reading-marks/tests/gutter-target-size.test.ts:228), which the plan’s test list currently misses. Add a browser check for an unread row, not only “a few levels.”

2. **P2 — Reading `--read` is reliable when the card opens, but the level sentence can become stale while it remains open.**

   `gutterCss` sets `--read` on the row ([reading-time.ts:124](/home/greg/code/spideryarn2/.claude/worktrees/fbmn3ruw-sxvq2j-reading-marks/src/web/reading-time.ts:124)); custom properties inherit through the cell and gutter to the span, so `getComputedStyle(span).getPropertyValue("--read")` is sound. Validate the trimmed value as an integer `1–4`.

   The problem is refresh: card content is computed only in `show` ([BlockLinkCard.tsx:290](/home/greg/code/spideryarn2/.claude/worktrees/fbmn3ruw-sxvq2j-reading-marks/src/web/BlockLinkCard.tsx:290)) or when `index`/`resolveXref` changes ([BlockLinkCard.tsx:259](/home/greg/code/spideryarn2/.claude/worktrees/fbmn3ruw-sxvq2j-reading-marks/src/web/BlockLinkCard.tsx:259)). Reading levels instead update the generated style element ([ReadingTimeStyle.tsx:13](/home/greg/code/spideryarn2/.claude/worktrees/fbmn3ruw-sxvq2j-reading-marks/src/web/ReadingTimeStyle.tsx:13)). A passage crossing level 3→4 while hovered changes its line but not its card sentence.

   Concrete fix: simplest is to omit the invented level-specific sentence and explain only what the line means. If the level sentence is valuable, pass the level map into `BlockLinkCard` and refresh open content when it changes; do not treat a one-time CSS read as live state. The current red test also sets `--read` inline ([reading-time-card.test.tsx:48](/home/greg/code/spideryarn2/.claude/worktrees/fbmn3ruw-sxvq2j-reading-marks/tests/reading-time-card.test.tsx:48)); render `ReadingTimeStyle` in one test so the real generated-rule inheritance is covered.

3. **P2 — `mark.cmt.term` changes from a 1px comment line to a 2px comment-shaped line through the cascade.**

   `mark.term` will set the full `2px dotted` border ([annotations.css:92](/home/greg/code/spideryarn2/.claude/worktrees/fbmn3ruw-sxvq2j-reading-marks/src/web/styles/annotations.css:92)). The overlap rule only changes its style to solid ([annotations.css:132](/home/greg/code/spideryarn2/.claude/worktrees/fbmn3ruw-sxvq2j-reading-marks/src/web/styles/annotations.css:132)). Therefore `mark.cmt.term` becomes 2px solid, while an ordinary comment remains 1px solid ([annotations.css:39](/home/greg/code/spideryarn2/.claude/worktrees/fbmn3ruw-sxvq2j-reading-marks/src/web/styles/annotations.css:39)). That is an unmentioned third appearance.

   Concrete fix: decide explicitly. I recommend preserving the existing “comment wins” rule by adding `border-bottom-width: 1px` alongside `border-bottom-style: solid`; the ✳ still distinguishes the comment. Add a computed-style overlap test for `mark.cmt.term`. If 2px solid is intentional to convey both meanings, document and browser-check it rather than inheriting it accidentally.

4. **P3 — The delegated-card mechanics otherwise check out, with one virtual-reference constraint.**

   - Hit-testing is sound: the gutter is inert, the strip opts back into pointer events ([gutter.css:921](/home/greg/code/spideryarn2/.claude/worktrees/fbmn3ruw-sxvq2j-reading-marks/src/web/styles/gutter.css:921)), and `data-open` disables it again ([gutter.css:945](/home/greg/code/spideryarn2/.claude/worktrees/fbmn3ruw-sxvq2j-reading-marks/src/web/styles/gutter.css:945)).
   - The detach observer continues to work because `shown.el` should remain the real span even when Floating UI receives a virtual position reference ([BlockLinkCard.tsx:235](/home/greg/code/spideryarn2/.claude/worktrees/fbmn3ruw-sxvq2j-reading-marks/src/web/BlockLinkCard.tsx:235)).
   - `autoUpdate` is already enabled ([BlockLinkCard.tsx:204](/home/greg/code/spideryarn2/.claude/worktrees/fbmn3ruw-sxvq2j-reading-marks/src/web/BlockLinkCard.tsx:204)).

   Concrete fix: store `pointerClientY - stripRect.top`, and have the virtual reference’s `getBoundingClientRect()` recompute `strip.getBoundingClientRect().top + offset` each time. A frozen `clientY` will not follow scrolling merely because `contextElement` is supplied. Keep the actual span in `shown.el`; only `setPositionReference` should receive the virtual object. Scope the new selector as `.blk-gutter > span.blk-read`.

   `aria-describedby` on the `aria-hidden` span has no accessibility effect: the trigger is excluded from the accessibility tree. It is harmless but misleading DOM. Guard the description effect for `aria-hidden="true"` if you want the code to express the intended “nothing is announced” rule explicitly.

5. **P3 — The provider coverage checks out.**

   Production has one `BlockGutter` call, inside `TableView` ([TableView.tsx:1567](/home/greg/code/spideryarn2/.claude/worktrees/fbmn3ruw-sxvq2j-reading-marks/src/web/TableView.tsx:1567)); the only production `TableView` mount is inside `Reader` ([Reader.tsx:2587](/home/greg/code/spideryarn2/.claude/worktrees/fbmn3ruw-sxvq2j-reading-marks/src/web/reader/Reader.tsx:2587)); and the provider wraps the complete Reader return ([Reader.tsx:2422](/home/greg/code/spideryarn2/.claude/worktrees/fbmn3ruw-sxvq2j-reading-marks/src/web/reader/Reader.tsx:2422), [Reader.tsx:3133](/home/greg/code/spideryarn2/.claude/worktrees/fbmn3ruw-sxvq2j-reading-marks/src/web/reader/Reader.tsx:3133)). Direct gutter mounts exist only in tests.

   Concrete fix: none.

6. **P3 — The factual card claims check out, but “active” should be made precise.**

   “Only you see it” is true: recording is owner-only ([useReadingTime.ts:14](/home/greg/code/spideryarn2/.claude/worktrees/fbmn3ruw-sxvq2j-reading-marks/src/web/useReadingTime.ts:14)), and only an owner gets `ReadingTimeStyle` ([Reader.tsx:2486](/home/greg/code/spideryarn2/.claude/worktrees/fbmn3ruw-sxvq2j-reading-marks/src/web/reader/Reader.tsx:2486)).

   Counting requires the prose not to be covered ([Reader.tsx:510](/home/greg/code/spideryarn2/.claude/worktrees/fbmn3ruw-sxvq2j-reading-marks/src/web/reader/Reader.tsx:510)), a visible browser page, activity within five minutes, and a visible share of the passage ([useReadingTime.ts:202](/home/greg/code/spideryarn2/.claude/worktrees/fbmn3ruw-sxvq2j-reading-marks/src/web/useReadingTime.ts:202)). Thus “on screen and active” is directionally true but underspecified.

   Concrete fix: say, “It counts while this passage is visible in the reading view, the page is visible, and you have been active in the last five minutes.” Avoid language implying the reader understood or completed the passage; levels measure credited time against a 230-wpm estimate ([reading-time.ts:42](/home/greg/code/spideryarn2/.claude/worktrees/fbmn3ruw-sxvq2j-reading-marks/src/web/reading-time.ts:42)).

7. **P3 — The rest of the annotation matrix checks out; one sentence in the plan overclaims the distinction.**

   - Citation + xref: xref comes later and replaces the shared `text-decoration`, matching xref interaction precedence.
   - Term + xref: the orange `border-bottom` and grey text decoration remain separate.
   - Author link + xref cannot occur: xrefs intersecting an author link are dropped ([annotate.ts:1056](/home/greg/code/spideryarn2/.claude/worktrees/fbmn3ruw-sxvq2j-reading-marks/src/web/annotate.ts:1056)).
   - Author link + citation/term retains separate decoration channels; the existing citation comment records the linked-citation browser check ([annotations.css:168](/home/greg/code/spideryarn2/.claude/worktrees/fbmn3ruw-sxvq2j-reading-marks/src/web/styles/annotations.css:168)).
   - No relevant override exists in `narrow-window.css`, `glossary.css`, or print rules.

   Citation and the proposed xref are both 1px grey; they differ by dash pattern and intensity, not by “at least two of shape, hue and weight” as claimed ([plan:92](/home/greg/code/spideryarn2/.claude/worktrees/fbmn3ruw-sxvq2j-reading-marks/docs/plans/261001r-reading-time-line-gets-a-rich-card-and-grows-lighter-cross-references-quieter-than-the-glossary.md:92)). Concrete fix: change that sentence to “shape and intensity.” The proposed visual treatment itself is reasonable.

   The only operative old-value pin I found is the gutter opacity test above. Historical plans, the append-only changelog, and the old feedback report still say “darker”; those are records of what shipped, so do not rewrite them. Ensure the new project docs and eventual changelog entry use “more visible.”