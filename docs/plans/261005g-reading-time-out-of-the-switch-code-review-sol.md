approve with changes

- **P3 — [public-network-trace.test.tsx:3547](/var/tmp/spideryarn-worktrees/reading-time-out-of-switch/tests/public-network-trace.test.tsx:3547):** `GET /api/reader` proves a request occurred, but could leave the store at its unloaded `on:false` default. **Fixed:** the test now also requires `loaded:true`, `on:false`, `since:null` and no load error.
- **P3, pre-existing/outside scope — [reading-time.md:141](/var/tmp/spideryarn-worktrees/reading-time-out-of-switch/docs/project/reading-time.md:141):** “Nothing yet on touch” is stale; tapping the reading-time line opens its card. **Not fixed**, per scope.

No P0–P2 findings. Ownership remains enforced in the client and both store methods. The gutter, hover card, spine and quiz filter have no remaining experimental gate. Current reader-facing copy matches the change. Retaining `enabled` is reasonable; its disable behavior already exists and is tested.

Files changed:

- `tests/public-network-trace.test.tsx`

Validation: all four TypeScript projects and source coverage passed using `node --import tsx scripts/typecheck.ts`; the normal npm launcher hit a sandbox pipe restriction. File lint and `git diff --check` passed. **`npm test` refused to start for insufficient memory; no tests ran.**

No commit made.