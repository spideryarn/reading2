VERDICT: changes needed

1. **P2 — reporting.** [marketing-pages.md:80](/var/tmp/spideryarn-worktrees/qi-qg6ydbp7-learn-screenshots-browser-pass/docs/project/marketing-pages.md:80) mandates 1440×900 and quality 65–92, while [shots.ts:35](/var/tmp/spideryarn-worktrees/qi-qg6ydbp7-learn-screenshots-browser-pass/src/web/shots.ts:35) records 916×700 and quality 80–98. Suggested rule wording: “For band-only portraits, use a desktop width that makes the band close to its displayed width, and record the viewport in `shots.ts`. Start at 65–92; if a valid flat-colour shot falls below the asset test’s 20KB floor, raise quality and record the exception.”

2. **P3 — fixed.** [plan:3](/var/tmp/spideryarn-worktrees/qi-qg6ydbp7-learn-screenshots-browser-pass/docs/plans/261005l-remember-becomes-learn-and-explore-covers-critiques.md:3) still called Stage 3 open; [plan:496](/var/tmp/spideryarn-worktrees/qi-qg6ydbp7-learn-screenshots-browser-pass/docs/plans/261005l-remember-becomes-learn-and-explore-covers-critiques.md:496) used present-tense claims invalidated by close-out. I corrected both.

3. **P3 — fixed.** The unreferenced `s3-features-learn-1440.png` showed two blank loading skeletons, unlike the valid evidence referenced at [plan:438](/var/tmp/spideryarn-worktrees/qi-qg6ydbp7-learn-screenshots-browser-pass/docs/plans/261005l-remember-becomes-learn-and-explore-covers-critiques.md:438). I deleted it; it remains recoverable from commit `03c95f935`.

The two product PNGs otherwise look accurate, focused, properly cropped, and correctly described by their alt text. Their headers and `shots.ts` dimensions agree. No stale `remember.png`, old Learn/Quiz heights, or obsolete screenshot assertions remain.

Tests: 2 files passed, 33 tests passed.

Wider:

- [ChatPanel.tsx:1845](/var/tmp/spideryarn-worktrees/qi-qg6ydbp7-learn-screenshots-browser-pass/src/web/ChatPanel.tsx:1845) still says Explore offers “three ways in”; the array immediately above now has four. Outside Stage 3, so not fixed.
- The three-note `combineEndings` plan is correct. Separate feedback-note close-out edits appeared in the worktree during review; I left them untouched.