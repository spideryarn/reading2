## Findings

1. **High — `BAND_SAYS` can pass when Outline’s visible band is empty.**  
   [public-network-trace.test.tsx:631](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/tests/public-network-trace.test.tsx:631) searches all of `host.textContent`. Outline renders five hidden, `aria-hidden` measurement copies containing the same rows and gists at [OutlinePanel.tsx:307](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/src/web/OutlinePanel.tsx:307). Mutation: delete the visible `rows.map(...)` at `OutlinePanel.tsx:295` while retaining `.outln-measure`; both new sweeps remain green on `PUBLIC_GIST`. This directly contradicts the comment that a mode rendering nothing cannot pass.

   The `null` assertion has the same proxy problem: absence of `.mode-close` at [public-network-trace.test.tsx:633](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/tests/public-network-trace.test.tsx:633) does not prove absence of `.mode-band`. Plain could gain a broken band without a close button and pass; Hierarchy could gain a band while retaining its gist and also pass. Assert mode-specific DOM: the direct visible Outline list, `.mode-band.summ` for Summary, and absence of `.mode-band` for Plain and Hierarchy.

2. **Medium — the mode sweeps do not enforce the file’s “no POST at all” invariant.**  
   The acceptance rule is explicit at [public-network-trace.test.tsx:6](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/tests/public-network-trace.test.tsx:6), but both sweeps assert only `outsidePublic()`, which permits every method under `/api/public/` ([public-network-trace.test.tsx:448](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/tests/public-network-trace.test.tsx:448), [public-network-trace.test.tsx:627](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/tests/public-network-trace.test.tsx:627), [public-network-trace.test.tsx:970](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/tests/public-network-trace.test.tsx:970)). Mutation: make any non-Plain visitor mode issue `POST /api/public/...`; both new sweeps pass, while the separate no-POST test opens only Plain. Add the method assertion inside both loops. An extra public GET would still pass intentionally; these are namespace sweeps, not request-count sweeps.

3. **Low — three comments/tests overclaim.**

   - A visitor does not have two DOM slots at [BlockGutter.tsx:26](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/src/web/BlockGutter.tsx:26). With no comments and no callback, the flex container has one child: the permalink. There are no placeholder slots.
   - “The four that spend” precedes six entries at [public-network-trace.test.tsx:535](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/tests/public-network-trace.test.tsx:535).
   - “Beside every paragraph” asserts only `> 0` at [public-network-trace.test.tsx:1439](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/tests/public-network-trace.test.tsx:1439). Rendering one owner button would pass. Either compare with the gutter/prose-block count or narrow the title to “retains the owner control.”

## Other requested attacks

The capability change is complete. The remaining `if (!owner) return` in `onSelect` at [App.tsx:2332](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/src/web/App.tsx:2332) is justified: text selection is ordinary reading behaviour, not an offered application control. I found no other rendered visitor control whose handler is swallowed. `preview-callout.tsx` is an isolated visual preview and its no-op callback is harmless.

`BAND_SAYS` is semantically right for the fixture:

- Hierarchy’s gist comes from the visible table.
- Summary’s gist comes from its band.
- Outline’s expected value is right, but the assertion is satisfied by hidden measurement copies.
- Quotes correctly tests the absent-artefact `VisitorBand`; it does not test the present public Quotes renderer, so that renderer could break while this row stayed green.

The dock fix is basically right. `aria-checked` is not necessarily updated during the native click callback, but it is reliable after the awaited `act(...)` and `settle()`. If URL polling reaches its deadline with the old mode, the final set comparison normally exposes the duplicate and missing mode; the return-anyway does not silently convert that into success. The already-selected initial Plain button is the unavoidable exception: a no-op press is observationally identical to selecting it again.

The gutter layout itself is safe. There are no positional or sibling selectors under `.blk-gutter`; removal simply shortens the flex stack. `has-marks` is derived solely from `cmtsByBlock` at [TableView.tsx:907](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/src/web/TableView.tsx:907), and visitors receive `NO_COMMENTS` at [App.tsx:1471](/home/greg/code/spideryarn2/.claude/worktrees/public-read-improvements/src/web/App.tsx:1471). The defect there is prose, not DOM behaviour.

**Verdict: BLOCKED — fix the Outline/absence false-positive in `BAND_SAYS` and enforce no POST within both mode sweeps.**