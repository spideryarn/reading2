# Plan review: Remember's header (badge icon, chip cards, (i) in short pieces)

Read-only review. Do not edit anything.

Review the plan at `docs/plans/261004f-remember-header-profile-icon-only-and-a-card-on-each-sub-mode-chip.md`
against the code in this worktree. It answers three small admin feedback reports, quoted at its top.

Check, and say for each whether it holds:

1. **The plan's claims about the current code.** That Quiz is the only caller of `WrittenForYou`
   without `compact`; that Summary, Structure, Debate, Referee and Diagram already have a card on
   every sub-mode chip and Remember's `RememberSubModeToggle` is the only one without; that
   Remember's (i) in Recall/Tutorial/Explore is `MODE_CATALOG.remember` via `ChatPanel` ->
   `ModeSurface`. Are there other modes that still print "written for you" style words, or other
   sub-mode-like controls with no card, that the plan misses?
2. **The Tooltip on the ProfilePanel trigger.** `ProfilePanel` already puts a Floating UI reference
   and `useClick`/`useDismiss`/`useRole` on the button. Wrapping that button in `src/web/Tooltip.tsx`
   (`enabled={!open}`) puts a second reference and prop set on it. Does `Tooltip`'s cloneElement /
   merged-ref / prop-merge order break the panel's handlers, `aria-*` attributes or focus? Any
   touch-device problem (a tap opening both)? Is there a simpler correct shape?
3. **Every proposed sentence, as a claim.** The four `REMEMBER_VIEW_HOW` strings, the new
   `MODE_CATALOG.remember.how`, and the badge card's words. Check each against the source
   (`src/converse.ts`, `src/web/activation.ts`, `src/quiz.ts`, `src/web/ChatPanel.tsx`,
   `docs/project/remember-mode.md`, `docs/project/quiz.md`, `docs/project/reader-profile.md`,
   `docs/project/mode.md` § The card on the button). `MODE_CATALOG.how` is read on four surfaces,
   including by a visitor; is the new one true on all of them? Name any sentence that is false or
   stronger than the code.
4. **What else reads `MODE_CATALOG.remember.how` or the words being removed** — tests, help pages,
   generated catalogues, docs — that the plan does not list.
5. **Simpler-first.** Is anything here more than the reports ask for, or is there a simpler product
   shape that satisfies Greg's words?

Give findings numbered, each with a severity (P0 blocks, P1 should fix, P2 minor), the file and line
that shows it, and a suggested change. End with one line: `VERDICT: approve` or
`VERDICT: approve with changes` or `VERDICT: rework`.
