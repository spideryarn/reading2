Verdict: **land after fixes (made)**. No P0 findings. No commit created.

### Findings

- **T1 — P1 — fixed:** The `graceUntil === 0` branch allowed an indefinitely stale anchor when WebKit cleared or changed the selection without delivering `selectionchange`. The press now validates the exact live anchor at pointer-down and rechecks it before opening. [TouchSelectionChip.tsx:241](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/TouchSelectionChip.tsx:241)  
  Tests: silent collapse and silent selection replacement at [touch-selection-chip.test.tsx:303](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/tests/touch-selection-chip.test.tsx:303).

- **T2 — P1 — fixed:** The implementation assumed `click` follows a prevented `pointerdown`. That is unsafe on WebKit and could make the feature entirely inert. The action now commits on `pointerup`; `click` is only a fallback and cannot double-submit. [TouchSelectionChip.tsx:290](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/TouchSelectionChip.tsx:290)  
  Test: pointer-down, silent collapse, pointer-up without click at [touch-selection-chip.test.tsx:321](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/tests/touch-selection-chip.test.tsx:321).

- **T3 — P2 — fixed:** A new touch outside the chip did not cancel pending settle/grace timers. The chip could remain or resurrect during a row/mark interaction. Outside presses now clear both timers and the armed anchor. [TouchSelectionChip.tsx:157](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/TouchSelectionChip.tsx:157)  
  Tests: [pending settle:248](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/tests/touch-selection-chip.test.tsx:248), [active grace:294](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/tests/touch-selection-chip.test.tsx:294).

- **T4 — P2 — fixed:** Suppression previously left the component mounted and cleanup called `setShown` while unmounting; mode changes also retained the chip lifecycle. Suppression now unmounts the active listener-owning child, cleanup only clears resources, and `slug:mode` remounts it across article/mode changes. [TouchSelectionChip.tsx:105](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/TouchSelectionChip.tsx:105), [Reader.tsx:2970](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/reader/Reader.tsx:2970).

- **T5 — P2 — fixed:** The CSS cleared the Dock but not the install strip immediately above it. Because the chip’s z-index is higher, it could cover that strip and its close control. The vertical clamp now includes `--hint-now`. [annotations.css:1362](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/styles/annotations.css:1362)  
  Test: [touch-selection-chip.test.tsx:398](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/tests/touch-selection-chip.test.tsx:398).

### Verified seams

- S1 remains intact: the chip only opens `AnnotateDialog`; saving still waits on `owner.comments.loaded`. [Reader.tsx:3000](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/reader/Reader.tsx:3000)
- The mouseup path in `TableView` is behaviorally unchanged; `readSelection` delegates to the shared implementation. The clamped range now has explicit coverage. [selection.test.ts:112](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/tests/selection.test.ts:112)
- A touch tap on an existing `<mark>` still opens its comment, while the chip disappears. [touch-selection-chip.test.tsx:367](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/tests/touch-selection-chip.test.tsx:367)
- The chip’s prevented pointer-down occurs only on the fixed sibling button, so it does not consume the prose row’s block-selection tap.

### WebKit beliefs, not physical-device evidence

- WebKit likely emits repeated `selectionchange` events while handles move, but no terminal “drag ended” event. A pause longer than 300ms may therefore briefly show the chip before dragging resumes. This remains a P3 real-iPad check.
- Cancelling `pointerdown` should not be treated as guaranteeing a later `click`; the pointer-up fix removes that dependency.
- Preventing the button’s pointer-down will often preserve the selection, but Safari may still collapse it while dismissing its callout. The fix supports collapse after a validated pointer-down and an observed collapse within 300ms.

Checks:

- Requested four-file Vitest run: **35 passed**
- Full typecheck: **passed**, all four projects
- `git diff --check`: **passed**
- Full `npm test`: could not start because local Postgres/Supabase was unavailable on port 54362.
- No commit made. The pre-existing untracked review-prompt file was untouched.