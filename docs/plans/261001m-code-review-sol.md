No P0 findings. I fixed one runtime issue and strengthened two weak test areas.

1. **P1 — screen readers heard the folded citation twice.** [CitationsPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb7w-7x-citations-dup-line-and-flash/src/web/BibliographyPanel.tsx:1095)

   The title link was described by both Tooltip’s generated `aria-describedby` content and a second hidden copy. I removed the duplicate and hid only the visually repeated author–year heading from assistive technology. Full authors remain available when the visible title is shortened. Updated [citations.md](/home/greg/code/spideryarn2/.claude/worktrees/fb7w-7x-citations-dup-line-and-flash/docs/project/bibliography.md:26).

2. **P2 — interaction tests could miss real-device regressions.** [citations-panel.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb7w-7x-citations-dup-line-and-flash/tests/bibliography-panel.test.tsx:654)

   Added checks for:

   - iOS’s touch `pointerdown` followed by a click reporting `mouse`
   - keyboard, Ctrl-click, and middle-click activation
   - folded rows with no card
   - registry-filled by-lines remaining visible
   - full shortened author lists remaining accessible
   - each accessible description being spoken once

3. **P2 — reduced-motion citation timing was untested.** [block-flash.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb7w-7x-citations-dup-line-and-flash/tests/block-flash.test.ts:377)

   Added a test proving the strong still wash lasts the citation-specific 2.4 seconds, rather than disappearing at the ordinary 1.2-second timer.

Conclusion: yes—`Bartlett (1932)` now renders as one visible line. Its cited words receive a 2.4-second strong pulse; the peak wash retains approximately 8.7:1 contrast against the prose text on the dark palette. Paragraph and Trajectory flashes remain 1.2 seconds. I found no additional normalization false positives/negatives beyond the already-fixed hyphen, apostrophe, and comma cases.

Validation:

- Requested Vitest command: **209 tests passed**
- Equivalent no-IPC typecheck: **4 projects passed; all 2,549 source files covered**
- `npm run typecheck` itself could not launch because the sandbox forbids `tsx`’s local IPC socket (`EPERM`); `node --import tsx scripts/typecheck.ts` ran the same script successfully.
- `git diff --check`: passed
- Biome: no errors; one unrelated pre-existing informational `noUselessFragments` advisory at `CitationsPanel.tsx:672`
- No commit created.