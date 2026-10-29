No P0/P1 findings. I fixed three issues; no wider product decision is needed.

- **P2 — [GlossaryPanel.tsx](/var/tmp/spideryarn-worktrees/fbga6m76-top-bar-select-to-glossary/src/web/GlossaryPanel.tsx:293): focus was lost to `<body>` after the fresh box closed.** Added a one-shot focus handoff: existing terms focus their row button; new lookups focus the labelled Glossary band, never its input. Requests are StrictMode-safe and cleared when leaving Glossary. Regression coverage is in [selection-adds-to-glossary.test.tsx](/var/tmp/spideryarn-worktrees/fbga6m76-top-bar-select-to-glossary/tests/selection-adds-to-glossary.test.tsx:559).

- **P2 — [ReminderBar.tsx](/var/tmp/spideryarn-worktrees/fbga6m76-top-bar-select-to-glossary/src/web/ReminderBar.tsx:37): the reminder’s author-folding rule disagreed with the masthead.** Four authors incorrectly became “three et al.” The reminder and masthead now share [mastheadFactsAsWords](/var/tmp/spideryarn-worktrees/fbga6m76-top-bar-select-to-glossary/src/web/Masthead.tsx:136) and [collapsedAuthorNames](/var/tmp/spideryarn-worktrees/fbga6m76-top-bar-select-to-glossary/src/web/AuthorNames.tsx:34). The test now checks the four/five-author boundary instead of asserting the broken duplicate rule.

- **P3 — [narrow-window.css](/var/tmp/spideryarn-worktrees/fbga6m76-top-bar-select-to-glossary/src/web/styles/narrow-window.css:1237): the reminder still slid for readers requesting reduced motion.** Added it to the existing transition suppression list and added a CSS regression assertion.

Tests and checks:

- Focused suite: **7 files, 126 tests passed**.
- Final Glossary regression: **8 tests passed**.
- Broader related run: **109 tests passed**; the sole failure was the real-Chrome layout test because Chrome aborted under the sandbox with `SIGTRAP`/`setsockopt: Operation not permitted`, before its test body.
- Full typecheck: **passed**, all 4,079 source files covered. Final web TypeScript check also passed.
- Touched-file lint: **exit 0**; advisory-only existing complexity/specificity warnings remain.
- `git diff --check`: **passed**.
- `npm test`: could not start because the local Postgres/Docker test service was unavailable (`EPERM` connecting/querying Docker); no full-suite tests ran.