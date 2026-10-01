C1 — P2 — fixed. The fixed annotation head jumped when the visitor controls bar hid because it did not share the shell’s `top` transition. Added it to the normal and reduced-motion rules in [shell.css](/home/greg/code/spideryarn2/.claude/worktrees/fb7e-annotations-mode/src/web/styles/shell.css:622) and [narrow-window.css](/home/greg/code/spideryarn2/.claude/worktrees/fb7e-annotations-mode/src/web/styles/narrow-window.css:1019). The red-first regression is in [layout-margin.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb7e-annotations-mode/tests/layout-margin.test.ts:41).

C2 — P2 — fixed. At narrow widths, Annotations displayed its own “needs a wider window” state while retaining the generic banner that incorrectly describes a mode panel covering the article. The banner is now hidden when `.marg-narrow` is present; the prose, masthead, and shared notice remain visible. Regression: [layout-margin.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb7e-annotations-mode/tests/layout-margin.test.ts:48); fix: [narrow-window.css](/home/greg/code/spideryarn2/.claude/worktrees/fb7e-annotations-mode/src/web/styles/narrow-window.css:364).

C3 — P3 — report only. The design pass deliberately dropped the article-root question, and the behavior is tested, but the plan’s initial description and several `notes.ts` comments still say the root question is drawn. See [the plan](/home/greg/code/spideryarn2/.claude/worktrees/fb7e-annotations-mode/docs/plans/261001d-annotations-mode-marginalia-in-a-right-hand-column.md:111) and [notes.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb7e-annotations-mode/src/web/annotations/notes.ts:20). This is documentary drift, not a runtime defect.

No further findings in the highlighted areas:

- `useMarginLayout`’s dependencies and observers cover legitimate content and geometry changes; cleanup is StrictMode-safe and the transforms do not create a ResizeObserver feedback loop.
- `OwnerIdeasFeed` does not loop, clears on teardown, and never mounts on the visitor path.
- The `bandOpen` split is intentional; remaining consumers use the correct band-versus-visible-prose semantics.
- Margin arithmetic accounts for safe-area insets, and `--marg-reserve: 0` keeps the padding override inert outside Annotations.
- Focus indicators and stacking order are intact.
- The mode card accurately says Annotations reads existing structure, arc, and Ideas data without generating anything.

Verification:

- Requested suite: **8 files, 343 tests passed**.
- `git diff --check`: passed.
- Focused lint on the three changed files: no errors.
- `npm run typecheck`: could not complete because this sandbox rejected the `tsx` IPC socket with `EPERM`. Running the underlying checker directly compiled all four TypeScript projects successfully; its final coverage check then rejected an unrelated, pre-existing ignored `logs/fb7e/check2.ts`.
- No commit made. The unrelated untracked feedback document was left untouched.

VERDICT: land