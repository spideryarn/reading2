198 tests passed across the requested files and `deploy-ready.test.ts`. Typecheck passed via `node --import tsx scripts/typecheck.ts`; the npm wrapper was blocked by sandbox `EPERM`. Lint reported advisories only. No commits, pushes, deploys, or database access.

1. **P1 — Exit did not prove teardown completed.** Unresolved teardown could exit zero and produce reusable evidence. The reporter now awaits `close()` before finalising; unexpected private teardown exceptions mark an external failure.

2. **P1 — Exact reuse bypassed contradictory evidence.** It ignored unusable reporter outcomes and newer deploy failures. Both stores now decide before the shortcut; malformed and obsolete outcomes are refused.

3. **P1 — Timeline filtering hid blockers.** Expired nearer runs, interrupted checks, and targeted failures could disappear, allowing older greens through. Selection now preserves these blockers and chooses the nearest commit before checking age.

4. **P1 — A nonzero partial rerun could pass.** A failed report without failed modules returned success. Reruns now require a passing report and exit zero; the full gate also validates reporter evidence.

5. **P1 — Interrupted deploy tests left no record.** Older evidence could survive an invisible attempt. Deploy now writes a started record before Vitest and replaces it on completion; failure to record the start makes the gate red.

6. **P2 — Environment provenance inspected the wrong checkout.** Records hashed the primary’s `.env.local`, rather than the tested worktree’s. Both endpoint hashes now inspect the worktree.

7. **P2 — File selection could silently omit required tests.** Missing failed files were dropped without proving deletion, and quoted Git filenames could be missed. Missing failures now require a committed deletion; changed paths use NUL separators.

VERDICT: ship after my fixes