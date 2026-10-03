You are reviewing CODE in the Spideryarn repo, in the current working directory (a git worktree). Under the house workflow you **fix what you find** inside this change's scope: edit the files directly, keep each fix small, and add or adjust a test for each one. Report anything wider than this change rather than fixing it. Do not commit, and do not run any git command that discards work.

The change is the latest commit, acfa0c721 (`git show acfa0c721`). Its plan, with your own earlier plan review and how each finding was handled, is docs/plans/261003c-tap-opens-structure-row-cards-and-the-reading-time-card-on-touch.md. Read the plan, then the diff, then the surrounding code.

What it does: on a touch screen, a finger's first tap on a Structure row (in both faces, StructurePanel.tsx and OutlinePanel.tsx) opens the row's card, and the second tap jumps. A tap on the gutter's reading-time line opens its card (BlockLinkCard.tsx § press). A coarse-pointer CSS rule widens the reading line's hit area leftwards under raised gutter controls (gutter.css, at the end). useTapReveal closes a finger-opened card on scroll.

Look especially for:
- A real iPad sequence (pointerover/down/up/out/leave touch, compat mouse events, then a click labelled `mouse`) that defeats either rule. That means a first tap that jumps, a second tap that does not, or a card that closes itself straight away. docs/project/touch.md lists the traps.
- The gutter CSS: does `position: relative; z-index: 1` on `.blk-gutter > :is(button, a)` change layout or paint anywhere (focus patches, the "…" over the mark, the open gutter, `.blk-gutter` rules with `:nth-child`, the container queries)? Does the `::before`'s `min(var(--read, 0), 1)` evaluate as intended when `--read` is unset or "0"? Does the overhang ever cover a visible control, or the prose?
- BlockLinkCard: the `tappedRef` provenance across show/shut/re-word/index refresh; the scroll effect; any listener leak.
- StructurePanel: CardRow and Row must still draw identical markup to the measuring copies (the comment at "The wrapper must not change this row's box").
- Tests that cannot fail, or that assert the wrong thing.

Gates you may run: `npx vitest run tests/structure-card-opens.test.tsx tests/outline-panel.test.tsx tests/reading-time-card.test.tsx tests/block-link-card.test.tsx tests/citations-panel.test.tsx` and `npm run typecheck`. Do not run the full `npm test`.

End with a numbered list: each finding with its severity (P0/P1/P2), its evidence (file:line), and whether you FIXED it (and how) or are REPORTING it. Then a one-line verdict.
