The approach is sound and appears to be the simplest design that delivers sentence links without client-side sentence splitting or another model call. I found three changes to make before building.

1. **F1 — P1, established: require the blind comparison.**  
   [Plan:161](/home/greg/code/spideryarn2/.claude/worktrees/fbra5fuz-summary-follows-the-text/docs/plans/261002e-summary-sentences-point-at-their-passage.md:161) explicitly skips it unless numeric screens move. This contradicts [prompting-guide.md:203](/home/greg/code/spideryarn2/.claude/worktrees/fbra5fuz-summary-follows-the-text/docs/project/prompting-guide.md:203), which requires a blind judge, and line 209, which limits those numbers to screens. Unchanged word counts and guard flags cannot detect choppier prose or weaker explanations.

   **Fix:** keep the proposed three articles and two repeats, but always run shuffled, blinded comparisons of paragraph `text` for plainness and fidelity, including before-versus-before controls. Also record a predefined sample’s sentence-link accuracy; the paragraph guard cannot measure that.

2. **F2 — P2, reasoned: make sentence/text equivalence an explicit read invariant.**  
   [Plan:94](/home/greg/code/spideryarn2/.claude/worktrees/fbra5fuz-summary-follows-the-text/docs/plans/261002e-summary-sentences-point-at-their-passage.md:94) promises validation and fallback, but never explicitly requires the sentence texts to reconstruct paragraph `text`. The guard reads only `p.text` ([simple-check.ts:83](/home/greg/code/spideryarn2/.claude/worktrees/fbra5fuz-summary-follows-the-text/src/simple-check.ts:83)); the proposed panel would display `sentences` instead.

   A read-only harness confirmed today’s `isUsableSimpleSummary` accepts malformed sentence data, different sentence wording, and out-of-paragraph sentence ids, preserving those fields. Adding structural checks alone would still permit the panel to show words the guard never checked.

   **Fix:** use one shared accessor for validated sentence data. Require a nonempty list, valid text/id shapes, paragraph-local ids, and `trimmedSentenceTexts.join(" ") === paragraph.text`. Return absent on failure, preserving paragraph text and chips. Test mismatched text, malformed entries, empty arrays, and foreign ids through both owner and visitor paths. Keep this separate from whole-summary rejection.

3. **F3 — P3, established: correct the phone preview promise.**  
   [Plan:136](/home/greg/code/spideryarn2/.claude/worktrees/fbra5fuz-summary-follows-the-text/docs/plans/261002e-summary-sentences-point-at-their-passage.md:136) says the card works on phones. [BlockLinkCard.tsx:379](/home/greg/code/spideryarn2/.claude/worktrees/fbra5fuz-summary-follows-the-text/src/web/BlockLinkCard.tsx:379) explicitly suppresses touch previews; a tap follows the link.

   **Fix:** say “On touch, tapping jumps; hover previews remain available with a pointer.” Add that expectation to the browser check.

The other checks support the design:

- JSONB and existing paragraph validators tolerate additive fields; exports preserve the artifact. The public DTO currently strips them, but the plan already includes updating it. Dock and voucher emails do not consume these paragraph fields.
- Keeping `simple/2` is appropriate. Joining trimmed sentence text with spaces preserves whitespace-based word counting and the guard’s input.
- A required nullable `id` passes both local schema validators. Extend `assertNoBlockIdEnums` to cover `"id"` alongside `"ids"`. The cache table already references the shared schema constant.
- `BlockRef` provides navigation, keyboard focus, accessible naming, and the shared card. The on-screen selector works for sentences. Add wrapped-sentence hover and keyboard checks: the card anchors to the whole element’s rectangle, while pointer-local positioning currently applies only to reading-time strips.

No repository files changed.

**Verdict: revise before approval for F1; retain the chosen design and incorporate F2–F3.**