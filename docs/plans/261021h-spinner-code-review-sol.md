No findings or fixes needed.

- Loading clears on fallback, failure and close; retained drafts cannot supply a stale count.
- Clicking while loading correctly opens Earlier on Needs a decision.
- The tooltip is keyboard reachable and supplies `aria-describedby`; the button’s accessible name is sufficient.
- The new test fails with the old render condition. Fake timers restore in `finally`.

Validation: **318 tests passed**. `npm run typecheck` hit a sandbox IPC restriction; the same script passed via `node --import tsx scripts/typecheck.ts`.

Final diff matches the supplied patch. No commits or database access.

VERDICT: clean