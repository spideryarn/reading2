**Verdict: not ready** — the Marginalia picture needs a retake. All eight PNGs inspected; placement is sensible, and no private or embarrassing material was found.

1. **[P2, unresolved] Marginalia scaling:** [manifest:376](/var/tmp/spideryarn-worktrees/help-pictures-eight-modes/src/web/help/help-images.ts:376) records downscaling 2016→1344 pixels. This shrinks the text and violates the requirement to keep captures at 2×. Retake with a tighter crop.
2. **Fixed FAQ caption:** corrected the reversed question/answer placement and distinguished verified quotations from the AI’s pairing.
3. **Fixed Debate caption:** attributed “disputes it” to the AI’s judgement.
4. **Fixed Referee caption:** specified that “ordering” means list numbers 1–4, avoiding confusion with signed values.
5. **Fixed Marginalia bullet:** qualified which saved items appear and explained that grouped items show a count.
6. **Improved retake recipes:** added Ideas/FAQ, Glossary and Sketch prerequisites, plus Illustrated’s selected plate.
7. **Wider, pre-existing:** [Marginalia:19](/var/tmp/spideryarn-worktrees/help-pictures-eight-modes/src/web/help/pages/modes/marginalia.md:19) says the top question covers the whole article; [the code](/var/tmp/spideryarn-worktrees/help-pictures-eight-modes/src/web/marginalia/notes.ts:204) omits that question. Left unchanged.

Regenerated the corpus. Requested tests: **175 passed, 1 skipped**. Typechecking and manifest lint passed.