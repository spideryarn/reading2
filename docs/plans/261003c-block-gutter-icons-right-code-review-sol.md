## Findings

- Fixed: footnote gutter geometry used the right mirrored formula, but resolved `65ch` at `1.0625rem` while note prose uses `0.95rem`. That produced a full-surplus positioning error. Both now share `--note-reading-size` in [footnotes.css](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/src/web/styles/footnotes.css:63), pinned by [prose-centred-in-its-cell.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/tests/prose-centred-in-its-cell.test.ts:146).

- Fixed: `.quiz-in-prose` was another geometry box resolving the prose’s measure in Geist. It now uses the author face; its visible button retains UI type in [quiz.css](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/src/web/styles/quiz.css:320).

- Wider, not fixed: both masthead rules still resolve the author’s `65ch` in Geist. This is roughly an 82px alignment error at 1440—the measured 88px gutter gap minus its intended 5.6px inset—not “a few pixels.” The original deferral rationale was also wrong: masthead text descendants own their respective UI, author, AI, or reader faces, so a family-only geometry fix appears safe. Corrected documentation is at [narrow-window.css](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/src/web/styles/narrow-window.css:1216) and [the plan](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/docs/plans/261003c-block-gutter-icons-move-to-the-right-of-the-block.md:100).

The mirrored rules are otherwise correct:

- Padding swaps correctly in [shell.css](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/src/web/styles/shell.css:91).
- The base gutter’s `right: inset + half surplus` places it one inset beyond the prose edge in [gutter.css](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/src/web/styles/gutter.css:144).
- The fold toggle ends at the prose’s right edge in [prose.css](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/src/web/styles/prose.css:147).
- The reading strip occupies the inset left of the right gutter, with its line on the gutter-facing edge, in [gutter.css](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/src/web/styles/gutter.css:986).
- Footnotes correctly take the whole surplus rather than half in [footnotes.css](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/src/web/styles/footnotes.css:105).

The author family on `.blk-gutter` and `.fold-toggle` does not visibly restyle anything:

- The gutter’s only text is the two counters, both explicitly monospace ([gutter.css](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/src/web/styles/gutter.css:815)); everything else is SVG.
- FoldToggle’s child is only a chevron SVG ([FoldToggle.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/src/web/FoldToggle.tsx:53)).
- Both tooltip systems portal their cards, and `.tooltip` explicitly uses the UI face ([tooltip.css](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/src/web/styles/tooltip.css:28)).
- `.prose` universally receives the static author face; quotes inherit it, while code switches only its own descendants to mono. There is no per-article face that makes `--font-author` wrong ([voices.css](/home/greg/code/spideryarn2/.claude/worktrees/fbkd5dk5-gutter-icons-right/src/web/styles/voices.css:40)).

Tests:

- Targeted Vitest: 43/43 passed.
- A temporary full source reversion produced eight failures, including the voice-regex and direction assertions.
- Touched-test lint passed.
- `npm run typecheck` was attempted, but `tsx` could not create its IPC socket under this sandbox (`EPERM`). The same script via `node --import tsx scripts/typecheck.ts` passed all 2,775 covered source files.
- No commit made.

Verdict: **ship with changes**. Raw HEAD should not ship without the footnote, quiz, test, and comment corrections now present in the working tree.