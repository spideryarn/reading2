Review complete. I found and fixed four issues; no commit was made.

### Findings

- **Medium — fixed:** During `saving`, the drawn knob retained the known value but `aria-pressed` disappeared, changing the control from a toggle into a generic disabled button for assistive technology. It now retains `aria-pressed` alongside `aria-disabled`, with on/off coverage for every relevant variant. [Dock.tsx:3272](/home/greg/code/spideryarn2/.claude/worktrees/fb4e-mode-bar-toggle-icons/src/web/Dock.tsx:3272), [dock-experimental-switch.test.tsx:268](/home/greg/code/spideryarn2/.claude/worktrees/fb4e-mode-bar-toggle-icons/tests/dock-experimental-switch.test.tsx:268). This matches the [WAI-ARIA button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/): `aria-pressed` identifies the toggle state; `aria-disabled` independently reports availability.

- **Low — fixed:** When `data-open` expands the gutter over lower rows, the new hover strip also expanded and added an “inside the gutter” click area in the adjacent gap. The line still follows the expanded gutter, as its old pseudo-element did, but the hover target is now inert while open. [gutter.css:944](/home/greg/code/spideryarn2/.claude/worktrees/fb4e-mode-bar-toggle-icons/src/web/styles/gutter.css:944)

- **Low — fixed:** The critical `blk-read` cascade had DOM tests but no static assertion pinning the declarations and selector specificity that keep it out of control slots. Added coverage for the generic, open, unread, and pseudo-element rules. [gutter-target-size.test.ts:186](/home/greg/code/spideryarn2/.claude/worktrees/fb4e-mode-bar-toggle-icons/tests/gutter-target-size.test.ts:186)

- **Low — fixed:** Several comments still described the old mode order, reading line, or ellipsis as the literal last child. I corrected these in [Dock.tsx:109](/home/greg/code/spideryarn2/.claude/worktrees/fb4e-mode-bar-toggle-icons/src/web/Dock.tsx:109), [dock-fit.css:5](/home/greg/code/spideryarn2/.claude/worktrees/fb4e-mode-bar-toggle-icons/src/web/styles/dock-fit.css:5), [BlockGutter.tsx:23](/home/greg/code/spideryarn2/.claude/worktrees/fb4e-mode-bar-toggle-icons/src/web/BlockGutter.tsx:23), and [block-gutter.test.tsx:715](/home/greg/code/spideryarn2/.claude/worktrees/fb4e-mode-bar-toggle-icons/tests/block-gutter.test.tsx:715). I also corrected the claim that group borders never alter width: loose links add 1px, which the normal fit measurement sees.

### Gutter conclusion

After the open-state fix, I find no control-slot or short-row regression:

- `blk-read` is last in the DOM, while `data-controls` is calculated solely from real controls.
- It is `position:absolute`, so it never participates in grid auto-placement.
- `.blk-gutter > span.blk-read` has specificity `(0,2,1)`, beating the matching generic, `:nth-child`, container-query, and open rules at at most `(0,2,0)`.
- Unread rows have zero strip width and zero line opacity; the pseudo-element cannot receive pointer events.
- The explicit open selector `(0,3,1)` disables the enlarged hover area while the column is unfolded.
- `touch.css` contains no gutter rules. `narrow-window.css` changes surrounding layout/tokens but has no child, `nth-child`, `data-open`, or `blk-read` selector.

`groupStarts` is computed from the same already-filtered `visible` list in both the segmented and loose-link arms.

Every actionable finding from the earlier plan review is represented in code or tests. The sole deliberately outstanding Diagram assertion is the prohibited security-map edit.

### Wider items to decide

- **Stale, not edited as instructed:** [security-map.md:261](/home/greg/code/spideryarn2/.claude/worktrees/fb4e-mode-bar-toggle-icons/docs/project/security-map.md:261) still says Diagram is in every reader’s bar.
- The accessibility wording at [experimental-features.md:122](/home/greg/code/spideryarn2/.claude/worktrees/fb4e-mode-bar-toggle-icons/docs/project/experimental-features.md:122) now needs an approved important-doc edit to mention that saving retains the known pressed state.
- Pre-existing documentation drift remains: [glossary.md:60](/home/greg/code/spideryarn2/.claude/worktrees/fb4e-mode-bar-toggle-icons/docs/project/glossary.md:60) illustrates the old five-mode bar, and [web-client.md:39](/home/greg/code/spideryarn2/.claude/worktrees/fb4e-mode-bar-toggle-icons/docs/project/web-client.md:39) says there are fourteen modes.

### Checks

- Typecheck passed for all four projects and all 2,306 source files. `npm run typecheck` itself could not create tsx’s `/tmp` IPC socket under this sandbox, so I ran the identical script via `node --import tsx scripts/typecheck.ts`.
- The focused Vitest run was **refused by the memory guard before any tests ran**: 9.02 GB available, swap full. I am not reporting tests as passing.
- `git diff --check` passes.
- Scoped Biome still reports pre-existing `BlockGutter` dependency/complexity findings; none came from these edits.
- The untracked `docs/plans/260929c-sol-code-prompt.md` was untouched.