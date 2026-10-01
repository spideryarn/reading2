Verdict: approve after fixes. No remaining P0/P1 findings found.

### P0

- None.

### P1

- [every-mode-draws-its-surface.test.tsx:1275](/home/greg/code/spideryarn2/.claude/worktrees/fb8h-mode-info-icon/tests/every-mode-draws-its-surface.test.tsx:1275) — phase A silently passed when the band was absent. It now requires the band, exactly one direct corner icon, and the icon as first child.

- Corner clearance was missing where the icon could obscure content or controls:
  - Visitor Diagram’s picture toolbar: [diagram-sketch.css:37](/home/greg/code/spideryarn2/.claude/worktrees/fb8h-mode-info-icon/src/web/styles/diagram-sketch.css:37)
  - Structure’s empty/between-parts text: [structure-mode.css:413](/home/greg/code/spideryarn2/.claude/worktrees/fb8h-mode-info-icon/src/web/styles/structure-mode.css:413)
  - FAQ statuses, stale warning, errors, and unheaded lists: [faq.css:20](/home/greg/code/spideryarn2/.claude/worktrees/fb8h-mode-info-icon/src/web/styles/faq.css:20)
  - Trajectory’s unheaded statuses, stale warning, errors, and purpose control: [trajectory.css:215](/home/greg/code/spideryarn2/.claude/worktrees/fb8h-mode-info-icon/src/web/styles/trajectory.css:215)
  - Tweets’ empty/loading/error states: [glossary.css:241](/home/greg/code/spideryarn2/.claude/worktrees/fb8h-mode-info-icon/src/web/styles/glossary.css:241), [Tweets.tsx:131](/home/greg/code/spideryarn2/.claude/worktrees/fb8h-mode-info-icon/src/web/Tweets.tsx:131)

### P2

- [BandAbout.tsx:70](/home/greg/code/spideryarn2/.claude/worktrees/fb8h-mode-info-icon/src/web/BandAbout.tsx:70) — `AboutMade` discarded a valid duration when author and date were absent. Duration-only provenance now renders correctly; the test now checks the complete exact timestamp rather than merely the year.

- [FaqPanel.tsx:187](/home/greg/code/spideryarn2/.claude/worktrees/fb8h-mode-info-icon/src/web/FaqPanel.tsx:187) — a completed empty FAQ omitted its promised count. The card now distinguishes “not loaded” from “No questions.”

- [mode-catalog.ts:256](/home/greg/code/spideryarn2/.claude/worktrees/fb8h-mode-info-icon/src/mode-catalog.ts:256) — Search omitted that meaning searches are retained; Remember omitted that replies point to supporting passages. Added both promised explanations.

- Stale old-placement documentation was corrected in [faq.md:91](/home/greg/code/spideryarn2/.claude/worktrees/fb8h-mode-info-icon/docs/project/faq.md:91), [citations.md:171](/home/greg/code/spideryarn2/.claude/worktrees/fb8h-mode-info-icon/docs/project/citations.md:171), and [trajectory.md:166](/home/greg/code/spideryarn2/.claude/worktrees/fb8h-mode-info-icon/docs/project/trajectory.md:166).

The audit found no visitor provenance leaks, fabricated authors, lost live failures/actions, missing mode icons, dead named CSS helpers, or regression in Diagram’s screen-reader status announcement.

Checks passed:

- 8 affected test files: 215 tests
- Final requested three-file sweep: 115 tests
- `npx tsc --noEmit -p tsconfig.json`
- Biome lint: no errors
- `git diff --check`

A real-browser visual pass remains advisable for pixel-level overlap confirmation. Referee’s documented exception remains unchanged. I did not touch the unrelated review prompt, diff, or screenshot files already in the worktree.