Verdict: **ship with changes**. The production routing is correct, but I would close these three issues before calling Stage 5 complete.

1. **The tests still do not prove that each overflow message reaches the correct public caller.** [referee-tooltips.test.tsx:918](/home/greg/code/spideryarn2/.claude/worktrees/referee-mode-clarity/tests/referee-tooltips.test.tsx:918) calls `parseHits` directly. It never exercises Search, Criteria, Claims, or Mirror. Consequently, removing `"editable"` at [search.ts:906](/home/greg/code/spideryarn2/.claude/worktrees/referee-mode-clarity/src/search.ts:906), or mistakenly adding it to a Referee caller, would leave this test green. The existing truncated Search-stream test merely checks that something was thrown. Assert the exact message through `findPassagesStream`, `runCriterionStream`, `runClaimsStream`, and `mirrorStream`.

   The Candidates disclosure test has a smaller version of the same weakness: [referee-candidates-press.test.tsx:208](/home/greg/code/spideryarn2/.claude/worktrees/referee-mode-clarity/tests/referee-candidates-press.test.tsx:208) requires only “AI/model,” “search,” and “may run.” The visible warning could stop saying that paper-derived terms go to a search engine and still pass. Assert that disclosure in the visible note, not merely in the tooltip.

2. **One card still says its heading again.** [MirrorPanel.tsx:410](/home/greg/code/spideryarn2/.claude/worktrees/referee-mode-clarity/src/web/MirrorPanel.tsx:410) has “Go to this passage” followed by “Scrolls the paper to the passage this remark is about.” The generic check misses it because the heading has fewer than three content words. Replace the first paragraph with the useful provenance fact—for example, that this is where the referee’s own comment was anchored and was not a passage selected by Mirror—then keep the current second paragraph.

3. **Candidates’ documentation still contradicts the button-gated behavior.** [referee-mode.md:50](/home/greg/code/spideryarn2/.claude/worktrees/referee-mode-clarity/docs/project/referee-mode.md:50) says the brief arrives “unprompted,” and [referee-candidates.ts:678](/home/greg/code/spideryarn2/.claude/worktrees/referee-mode-clarity/src/referee-candidates.ts:678) still calls it automatic. Both should say that pressing *Build the reviewer brief* creates the thread and sends the opening ask.

Adjudications:

- The implementer is right about the CSS dispute. In the parent revision, line 6643 began the comment; the exact selector appeared only in the real rule at line 6647. Deleting that rule would have failed the original test. Stripping comments is still sensible hardening.
- The scale-neutral wording is the right choice; `TheKey` should remain the sole colour mapping.
- The shortened mode card retains the right two ideas. The removed sub-mode lines carried nothing now missing at its point of use.
- The current overflow implementation is correctly routed, and the default-to-`"fixed"` direction is safe.
- I would not restore “cheap to check and easy to dismiss” to the Mirror footnote. It is design rationale rather than information needed to interpret the evidence, and it is less exact for coverage than for placement.
- There is no worthwhile generic paraphrase detector to add. Keep the present copying heuristic as a floor and add explicit assertions for important cards such as the Mirror jump.