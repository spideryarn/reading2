## P0

None.

## P1

None.

The reviewed behavior is sound:

- `margin-inline-start: auto` cannot conceal negative free space from `scrollWidth`; during overflow the auto margin resolves to zero. Coarse-pointer flex growth consumes positive space first, leaving Feedback last in the row.
- Each fit rung remains strictly narrower: rung 1 removes app labels; rung 2 removes mode labels; rung 3 removes remaining labels and reduces padding.
- Hover specificity and source order correctly override `.dock-btn:hover`; focus remains on the outer button.
- `drawsSiteNav` exactly matches the four signed-in branches mounting `SiteNav`. Contact, changelog, opensource, and other standalone routes correctly retain corner Feedback.
- Signed-out navs produce no trigger.
- The new import edge introduces no cycle.
- `when()` correctly uses one `now` value, exact timestamps, and the explicit 30-day exception.

## P2

- Stale documentation still described three trigger shapes, a 40px dock floor, and obsolete dock arithmetic. Fixed in [FeedbackButton.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb-greg-bottom-bar-batch/src/web/FeedbackButton.tsx:27), [feedback.md](/home/greg/code/spideryarn2/.claude/worktrees/fb-greg-bottom-bar-batch/docs/project/feedback.md:6), [touch.md](/home/greg/code/spideryarn2/.claude/worktrees/fb-greg-bottom-bar-batch/docs/project/touch.md:349), and [narrow-window.css](/home/greg/code/spideryarn2/.claude/worktrees/fb-greg-bottom-bar-batch/src/web/styles/narrow-window.css:728), plus related comments.
- Existing tests could remain green if the new CSS geometry, hover override, auto margin, spacing, or 44px floor disappeared. Added checks in [dock-fit.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb-greg-bottom-bar-batch/tests/dock-fit.test.ts:259), [feedback-button-tooltip.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb-greg-bottom-bar-batch/tests/feedback-button-tooltip.test.tsx:257), and [touch-controls.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb-greg-bottom-bar-batch/tests/touch-controls.test.ts:172).

Verification:

- Requested suite: 5 files, 152 tests passed.
- Coarse-pointer suite: 10 tests passed.
- Import-cycle gate passed.
- `npm run typecheck` was prevented from starting by the sandbox rejecting `tsx`’s IPC socket. Running the identical driver as `node --import tsx scripts/typecheck.ts` passed all projects and all 2,538 source files.
- No commit made.

Final verdict: **APPROVE — no P0/P1 findings; P2 documentation and regression-coverage gaps fixed.**