1. **Medium — [tests/quiz-mark-stream.test.tsx:571](/var/tmp/spideryarn-worktrees/fbag4hsu-quiz-mark-cut-off/tests/quiz-mark-stream.test.tsx:571)** — The test accepted any ceiling ≥2,032, so a substantial regression from the planned 4,000 would pass. Fixed to assert the exact wire value; mutation-tested. The production call sends 4,000 directly, with no stale 1,200-based billing, admission, cost-estimate, or timeout dependency found.

2. **Low — [tests/quiz-panel.test.tsx:1982](/var/tmp/spideryarn-worktrees/fbag4hsu-quiz-mark-cut-off/tests/quiz-panel.test.tsx:1982)** — The test did not explicitly distinguish the marked answer from a subsequently edited draft. Fixed by editing the textarea before pressing Discuss and asserting the seed still contains `mine.answer`; mutation-tested. The done-only/owner-only gating and neighbouring `Tooltip`/`ControlTip`/`IconButton` accessibility and touch conventions are correct.

3. **Low — [src/web/reader/Reader.tsx:1170](/var/tmp/spideryarn-worktrees/fbag4hsu-quiz-mark-cut-off/src/web/reader/Reader.tsx:1170)** — The feature-specific tests would still pass if this callback changed from `"wait"` to `"send"`; there is no Quiz-specific full Reader transition test. Not fixed. The implementation itself is correct: it opens Chat through `handToChat(seed, "wait")`, creates a fresh unsent draft, preserves inert `learn=quiz`, and is unreachable to visitors. Existing generic handoff and URL-retention integration tests pass.

Files changed:

- `tests/quiz-mark-stream.test.tsx`
- `tests/quiz-panel.test.tsx`

Checks: 192 focused tests passed; scoped lint passed; full typecheck passed via the same driver invoked with `node --import tsx` because `npm run typecheck` hit a sandbox IPC `EPERM`.

**SHIP AFTER FIXES (made)**