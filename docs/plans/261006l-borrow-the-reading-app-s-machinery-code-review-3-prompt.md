# Review, narrow: the fix for F19, and two additive Tooltip props (fleet dashboard)

Repo: this worktree. Round one on this stage is yours:
`docs/plans/261006l-borrow-the-reading-app-s-machinery-code-review-2-sol.md`.

## The candidate

Committed: `f9cf93d64`. `git diff 8f409a0a2..f9cf93d64`; paths: `git diff --name-only 8f409a0a2..f9cf93d64`.
Start with `tools/fleet/web/src/SessionsPanel.tsx` (§ `focusedTitleId`, `titleButton`, the focus-return
layout effect, `PreviewOn`), `tools/fleet/web/src/Tooltip.tsx` (`enabled`, `positionReference`),
`tests/fleet-session-preview.test.tsx` (the twelve appended tests).

## Scope

Discovery on this stage is closed. Check only:

1. **F19's fix.** It was an established P1 and its fix was not in your snapshot. Is it adequate, and
   does it introduce a P0 or P1? The statement to judge: *"focus returns to a session title only when
   a session title held focus immediately before the commit and `document.activeElement` is `body` or
   null after it; it never moves focus away from an element the reader put it on."* It reads the DOM
   during render to learn which title is focused — say whether that is unsound under React 19
   (strict mode double render, concurrent rendering, a render that is discarded).
2. **F18.** `Tooltip`'s `enabled` and `positionReference` are additive: is any existing caller's
   behaviour changed? The builder found that passing `null` to floating-ui's `setPositionReference`
   overwrites the trigger reference; check the effect's handling.
3. The builder reports two tests held by no mutation it ran ("does not take focus from a control the
   reader moved to", "leaves focus alone when the focused row has left the list"). Find the mutation
   that turns each red, or say they cannot go red and fix or delete them.

You may edit this worktree for findings inside this scope, red-first; do not commit; list files
changed. No network. Do not write or alter any quotation attributed to a person.

Findings numbered from F21, severity P0–P3 as before, established or reasoned, (a) and (b). End with
a one-line verdict: ship / ship with my fixes / do not ship.
