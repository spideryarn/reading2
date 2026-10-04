# Code review: Remember's header (badge icon + card, chip cards, (i) in short pieces)

You are reviewing **and fixing**. The work is commit `1019c380d` on this branch
(`git show 1019c380d`; `git diff 1019c380d~1 1019c380d` for the scoped diff). The plan, with the
three feedback reports it answers and the plan review's six findings, is
`docs/plans/261004f-remember-header-profile-icon-only-and-a-card-on-each-sub-mode-chip.md`.

Fix what you find **inside this stage's scope** directly in the working tree (do not commit).
Stay focused on this change; report anything wider instead of fixing it. Do not touch
`.env.local`, `infra/`, or anything listed as a defence in `docs/project/security-map.md`.

Look hardest at:

1. **`ProfilePanel`'s trigger wrapped in `Tooltip`** (`src/web/ProfilePanel.tsx`). The button
   carries two Floating UI references and two prop sets. Is anything the panel's
   `getReferenceProps()` set (click, `aria-expanded`, `aria-haspopup`, `aria-controls`, the dismiss
   handlers) overwritten by `Tooltip`'s clone, or the other way round? `Tooltip` is controlled
   (`open={tipOpen}`) and `enabled={!open}`: can the card be left open, reopen under an open panel,
   or come back after the panel closes without a new hover? Focus: the panel returns focus to the
   trigger on close; does that focus reopen the card, and is that acceptable? On touch, does a tap
   open only the panel? Does `aria-describedby` dangle?
2. **Every sentence as a claim**, against the source: `REMEMBER_VIEW_HOW` in
   `src/web/QuizPanel.tsx`, the new `MODE_CATALOG.remember.how` in `src/mode-catalog.ts` (read on the
   Dock card, the band's (i), the Help page, and by visitors), the badge card's words in
   `src/web/WrittenForYou.tsx`, and the edited Help copy in `src/web/help/help-topics.tsx`. Name any
   that is false or stronger than the code, and correct it.
3. **`RememberSubModeToggle`**: the wrap in `TooltipGroup`/`Tooltip` must not change the click
   handler's arming, the `aria-pressed` buttons, the layout (`.remember-submode` is a flex row whose
   children were the buttons), or keyboard behaviour.
4. **Remember's (i)** (`RememberSubModesAbout` in `src/web/BandAbout.tsx`, passed from
   `src/web/ChatPanel.tsx`): is it shown in exactly the Remember conversation bands, to owner and
   visitor alike where the band exists? Any state where `about` makes the card wrong?
5. **Leftovers**: anything still naming `compact`, "written for you" as visible words, or the old
   catalog paragraph — code, tests, docs, help, CSS made dead by the change.
6. **The tests** in `tests/remember-header-cards.test.tsx`: would each go red if the behaviour
   regressed, or does any pass for the wrong reason?

Run `npm run typecheck` and the test files you touch or that cover what you change
(`npx vitest run <files>`). Do not run the full suite.

Report: numbered findings, each with severity (P0/P1/P2), file and line, what you changed or why you
left it, and anything wider than this stage for the caller to decide. End with one line:
`VERDICT: approve` or `VERDICT: approve with fixes applied` or `VERDICT: rework`.
