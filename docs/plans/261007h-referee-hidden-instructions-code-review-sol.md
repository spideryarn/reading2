Reviewed and fixed the branch. The scanner and its answer type remain untouched.

Verification:

- 176 focused tests passed across the requested suites plus command-bar and activation coverage.
- All 3,384 TypeScript files passed typechecking via `node --import tsx scripts/typecheck.ts`. The exact npm launcher was blocked by sandbox IPC permissions.
- `git diff --check` passed.
- Full `npm test` could not start because Docker/private Postgres is unavailable in the sandbox.
- Changes remain uncommitted because the worktree’s Git index is mounted read-only.

Findings:

1. **Medium — hostile paths could forge location descriptions.** An ID containing ` > math` produced the reassuring phrase “marked up as maths.” The UI now treats paths as opaque evidence and makes no inferred location claim. Evidence: [SourceScanNotice.tsx](/var/tmp/spideryarn-worktrees/fby6590g-referee-hidden-instructions/src/web/SourceScanNotice.tsx:596), regression test [source-scan-notice.test.tsx](/var/tmp/spideryarn-worktrees/fby6590g-referee-hidden-instructions/tests/source-scan-notice.test.tsx:490). **Fixed.**

2. **High — bidi controls remained active in displayed evidence.** React escaped markup but did not stop document-controlled Unicode from visually reordering finding text, paths, or details. All Unicode bidi controls are now printed as visible code points and isolated with `<bdi>`. Evidence: [SourceScanNotice.tsx](/var/tmp/spideryarn-worktrees/fby6590g-referee-hidden-instructions/src/web/SourceScanNotice.tsx:178), tests for U+202E and U+061C at [source-scan-notice.test.tsx](/var/tmp/spideryarn-worktrees/fby6590g-referee-hidden-instructions/tests/source-scan-notice.test.tsx:497). **Fixed.**

3. **Medium — attacker-written paths and CSS evidence were unbounded.** A very long ID, class, or style value could flood the panel and bury later findings. Displayed paths and details are capped at 500 characters with an explicit “shortened” marker; finding words remain intact and first. Evidence: [SourceScanNotice.tsx](/var/tmp/spideryarn-worktrees/fby6590g-referee-hidden-instructions/src/web/SourceScanNotice.tsx:186), red-first regression at [source-scan-notice.test.tsx](/var/tmp/spideryarn-worktrees/fby6590g-referee-hidden-instructions/tests/source-scan-notice.test.tsx:513). **Fixed.**

4. **Medium — grouping coverage omitted two identity fields.** Tests would not catch different kinds or evidence details being merged into one row. Coverage now proves both remain separate, while ordinary labels, caveats, text, and paths retain their existing guarantees. Evidence: [source-scan-notice.test.tsx](/var/tmp/spideryarn-worktrees/fby6590g-referee-hidden-instructions/tests/source-scan-notice.test.tsx:460). **Fixed.**

5. **Medium — Hidden text lacked end-to-end URL and activation coverage.** Production wiring was correct, but no test proved a real command-bar selection writes `?mode=referee&referee=hidden` in one navigation and arms no paid work. Evidence: total activation map at [activation.ts](/var/tmp/spideryarn-worktrees/fby6590g-referee-hidden-instructions/src/web/activation.ts:435), new Reader test at [command-bar-sub-modes.test.tsx](/var/tmp/spideryarn-worktrees/fby6590g-referee-hidden-instructions/tests/command-bar-sub-modes.test.tsx:547). **Fixed with tests.**

6. **Medium — the live-region invariant was under-specified by tests.** The implementation already kept a permanent node, but the test did not prove there was exactly one status node or that its identity survived loading → result. Evidence: implementation [RefereeMode.tsx](/var/tmp/spideryarn-worktrees/fby6590g-referee-hidden-instructions/src/web/modes/referee/RefereeMode.tsx:220), strengthened test [referee-notices.test.tsx](/var/tmp/spideryarn-worktrees/fby6590g-referee-hidden-instructions/tests/referee-notices.test.tsx:168). **Fixed with tests.**

7. **Low — the two-word Hidden text chip could wrap internally on phones.** The row already wraps, but the chip itself had no `white-space` guard. Evidence: [referee.css](/var/tmp/spideryarn-worktrees/fby6590g-referee-hidden-instructions/src/web/styles/referee.css:261), regression [referee-band-fits.test.ts](/var/tmp/spideryarn-worktrees/fby6590g-referee-hidden-instructions/tests/referee-band-fits.test.ts:111). **Fixed.**

8. **Low — the chip mark’s visibility rules had no test.** Coverage now requires a non-zero ring with a border and a filled unexplained-finding state. All colours continue to use existing light/dark tokens. Evidence: [referee.css](/var/tmp/spideryarn-worktrees/fby6590g-referee-hidden-instructions/src/web/styles/referee.css:285), [referee-band-fits.test.ts](/var/tmp/spideryarn-worktrees/fby6590g-referee-hidden-instructions/tests/referee-band-fits.test.ts:100). **Fixed with tests.**

9. **Low — present-tense docs and comments still described four views or the scan living in Notices.** Current documentation and code commentary now consistently describe five sub-modes, confidentiality-only Notices, and Hidden text’s mark/panel. Evidence: [referee-mode.md](/var/tmp/spideryarn-worktrees/fby6590g-referee-hidden-instructions/docs/project/referee-mode.md:168), [RefereeMode.tsx](/var/tmp/spideryarn-worktrees/fby6590g-referee-hidden-instructions/src/web/modes/referee/RefereeMode.tsx:204). **Fixed.**