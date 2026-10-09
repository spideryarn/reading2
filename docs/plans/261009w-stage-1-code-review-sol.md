LAND AFTER FIXES

C1 — P3: Marginalia’s live help still called Sources “Peer review” because the phrase crossed a line break. Fixed in [marginalia.md](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/src/web/help/pages/modes/marginalia.md:30) and regenerated [help-corpus.generated.json](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/src/help-corpus.generated.json:317).

C2 — P3: Two comments became misleading during the scripted rename:

- The catalogue implied Reception itself opens on Bibliography. Fixed by separating Reception’s relationship to Sources from Sources’ initial sub-mode in [mode-catalog.ts](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/src/mode-catalog.ts:98).
- The restored-view explanation still said legacy Debate URLs open “Peer review”. Fixed in [last-view.ts](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/src/web/last-view.ts:461).

No wider findings. I verified legacy URL lifting, precedence, restored last views, Dock detection, shared-link titles, feedback normalization, help redirects, command aliases, and the Sources-specific possessive. Stored step names remain untouched.

Checks passed:

- Legacy/router/UI batch: 433 tests
- Final focused batch: 259 passed, 1 skipped
- Command/catalogue batch: 74 passed, 2 skipped
- Typecheck passed via the underlying command
- Touched-file lint and `git diff --check` passed

`npm test` could not start PostgreSQL because the sandbox forbids local TCP/Docker access (`EPERM 127.0.0.1:54362`). No commit was made.