Implemented stage 4 without committing.

Key changes:

- Added tolerant Codex browser types and parsing in [usage-history-client.ts](/home/greg/code/spideryarn2/.claude/worktrees/codex-usage/tools/fleet/web/src/usage-history-client.ts):
  - `CodexWindowView`: value/unknown, preserving slot provenance and duration.
  - `CodexBucketView`: bucket metadata, windows, credits, limits, spend control and reached state.
  - `CodexRecordedObservationView`: value/unknown.
  - `CodexObservationView`: adds a distinct legacy `absent` arm.
  - `UsageHistoryView.latestCodex` is required and selected by file order.
  - Malformed Codex data becomes non-retryable `unknown` without losing Claude data.
  - Trailing unreadable physical lines are detected through history holes and supersede older readings.

- Added the Codex account card in [UsagePanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/codex-usage/tools/fleet/web/src/UsagePanel.tsx), including:
  - Duration-based window identity and unfamiliar durations.
  - General versus model-specific buckets.
  - Live reset-expiry re-evaluation.
  - Explicit reached-limit state.
  - Over-100 values with geometry-only clamping.
  - Duplicate bucket/slot rejection.
  - Reset credits, but no API-credit claim.

- Lifted history ownership into [App.tsx](/home/greg/code/spideryarn2/.claude/worktrees/codex-usage/tools/fleet/web/src/App.tsx), so the Usage and Overseer mounts receive exactly the same newest Codex attempt.

- Extended `overseer usage` in [overseer.ts](/home/greg/code/spideryarn2/.claude/worktrees/codex-usage/scripts/overseer.ts):
  - Text output prints Claude, its scan control, and Codex.
  - `--json` retains the existing report shape and adds `codex`.
  - A rejected Codex collector does not discard a successful Claude reading.

- Added the requested brief source/interpretation section to [usage-history.md](/home/greg/code/spideryarn2/.claude/worktrees/codex-usage/docs/project/usage-history.md).

Red→green evidence:

- Initial card/parser suite: 13/13 failed, including the route→parser→DOM test because the Codex selector and rendering path did not exist.
- Initial CLI suite: 2/2 failed because Codex text/JSON output did not exist.
- Final focused Codex suites: 19/19 passed.
- Broader focused run: 8 suites, 519 tests passed.

Additional checks:

- All three direct TypeScript projects passed, including `tests/tsconfig.json`.
- Fleet production bundle built successfully.
- Touched-file lint: no warnings.
- `git diff --check`: passed.
- No network, live usage reading, `npm test`, or wrapper `npm run typecheck`.
- No Sol review because that would require the prohibited network/model call.
- No commit created.

I found no incorrect stage-4 requirement. One representation detail needed extra handling: a trailing unreadable history line is represented only by a hole with no right edge, not by a sample. I also caught and corrected an initially invalid absent-field test fixture that accidentally retained its default Codex field.