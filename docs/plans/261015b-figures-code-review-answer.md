Review complete. Post-fix verdict: **approve**.

Fixed three correctness bugs:

- Caption reservation could orphan an image’s caption and corrupt ordinals.
- Roman table identifiers omitted `C`, `D`, and `M`.
- Native table `<caption>` elements were not recognized as owned captions.

Structure’s drawn/measured rows remain identical, and light-theme `--ink-soft` is correct.

Validation:

- Focused tests: 44/44 passed.
- Full typecheck passed via the socket-free equivalent invocation. The requested npm wrapper was attempted but sandbox-blocked before execution.
- Biome lint and `git diff --check`: clean.
- No commit made.

Full findings and changes: [261015b-figures-code-review-sol.md](/var/tmp/spideryarn-worktrees/fbj5-skim-figures-followups/docs/plans/261015b-figures-code-review-sol.md).