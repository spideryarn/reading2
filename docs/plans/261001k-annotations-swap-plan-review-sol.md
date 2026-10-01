Verdict: **build with fixes**. The core press rule is sound; no P0 findings.

1. **P1 — Specify and test the hypothetical fit calculations.**  
   `bothFit` cannot come from the current `fit`: while notes are off, `fit.margW` is necessarily zero. It must run `fitView` hypothetically with `margin: true`; `aloneFit` must do the same with `modeBand: false`. The current work-in-progress does this correctly in [Reader.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb7m-7p-annotations/src/web/reader/Reader.tsx:454), but the plan and tests should pin it.

   Exact inclusive thresholds, measured after safe-area insets:

   - Notes alone: **612px with the 12px spine; 600px without**.
   - Band + prose + notes: **900px with the spine; 888px without**.
   - Band beside prose: **700px with the spine; 688px without**.

   Consequently, [the mobile wording](/home/greg/code/spideryarn2/.claude/worktrees/fb7m-7p-annotations/docs/plans/261001k-annotations-head-path-wraps-and-the-notes-swap-in-on-a-narrow-window.md:71) is false as a device rule: from 612–699px, notes fit alone while the band covers the prose. A landscape phone can therefore swap to notes. Keep the decision, but describe it as “below the notes-alone threshold,” not “a phone.” Add boundary tests at 611/612, 599/600 with `spine=0`, and about 650px.

2. **P1 — Closing the band is not equivalent to stepping it aside.**  
   `?mode=plain` unmounts the band; `bandAway` deliberately uses `display:none` so a half-written Chat question, Quiz answer, focus, and other component state survive. That preservation is documented in [narrow-window.css](/home/greg/code/spideryarn2/.claude/worktrees/fb7m-7p-annotations/src/web/styles/narrow-window.css:373), while the preceding plan justified band priority partly because it may contain half-typed words.

   The simpler `mode=plain` implementation may still be the right v1, but the plan must explicitly accept that loss. Otherwise this needs a broader “band stepped aside while notes win” state, which is materially more complex. Test a dirty Chat/Quiz case before deciding.

3. **P2 — “Every activation” has one off-reader exception.**  
   On the reading view, Dock clicks, Enter/Space on the Dock button, and Cmd-K command selection all reach the same `onMode` handler. Sub-mode commands also do; conversation bands’ own `onMode={setMode}` bypasses it, but that is harmless because they only activate another band and `fitBoth` already makes that band win. Annotations has no separate keyboard shortcut.

   On Metadata, however, both the Dock and command bar navigate through `modeLinkHref`; that link deliberately preserves the existing band ([Dock.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb7m-7p-annotations/src/web/Dock.tsx:1494), [link construction](/home/greg/code/spideryarn2/.claude/worktrees/fb7m-7p-annotations/src/web/Dock.tsx:1561)). At 800px, pressing Annotations there arrives with both parameters and the band wins. Either scope “most recent press” to the reading view or name Metadata as an arrival exception.

   Herald behavior is otherwise coherent: Annotations gets no herald; closing the band hides and clears any old band herald.

4. **P2 — The path is probably Greg’s “rail,” but the height budget is understated.**  
   The structural path is the element that literally says where the reader is, and it is the only part currently forced to one ellipsized line, so the interpretation is persuasive. Splitting part and section, wrapping, retaining a screen-reader-only separator, and using `overflow-wrap:anywhere` is sound.

   But “one or two lines taller” is not the actual bound: three lines per title plus the three-line arc permits a nine-line head. That recreates the earlier design problem where a six- or seven-line head dominated the margin. Give the path one total budget—roughly three or four lines—or explicitly approve the larger maximum. Browser-check it at the **200px column width** (612px notes-only or 900px with a band), not only at 1600px where the column is 288px.

5. **P2 — Pin the complete swap and history sequence.**  
   Both `mode` and `margin` are push-state parameters. Synchronous nuqs writes coalesce into one navigation, so the proposed two writes should produce one Back step, but the plan should assert it—or reuse the existing combined `mode`/`margin` setter for an explicitly atomic write.

   The Reader test should exercise the full sequence:

   `Glossary → Annotations → Glossary → Annotations → Annotations off`

   and assert one Back reverses each press. Also add the missing wide case: at ≥900px, pressing Annotations must leave Glossary open and show both. The pure helper tests alone cannot catch incorrect wiring of `bothFit`.

Read-only review; I changed no files.