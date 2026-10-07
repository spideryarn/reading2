**Verdict: land with fixes.** No P0/P1 findings. The database-backed gate still needs verification outside this sandbox.

1. **P2 — Skim gave profile failure precedence over absence.** [src/routes.ts:10309](/var/tmp/spideryarn-worktrees/261007-not-made-yet-reads-and-quote-delay/src/routes.ts:10309). Fixed: observe the profile rejection, await the artefact first, return on exact null, then await the profile. Tests cover both failure orders, one response, a pending profile, and made-Skim profile failures. Fixed the garbled comment and updated the plan/postmortem. Eight tests failed before the fix.

2. **P2 — Tests missed replies decoded after switching articles.** [tests/none-yet-is-not-a-404-hooks.test.tsx:619](/var/tmp/spideryarn-worktrees/261007-not-made-yet-reads-and-quote-delay/tests/none-yet-is-not-a-404-hooks.test.tsx:619). Removing readiness’s post-parse guard survived all 245 original tests. Added 15 cases across all eight reads, explicitly proving decoding started before switching articles.

3. **P3 — Wider stale count comments, reported only.** [src/messages.ts:4551](/var/tmp/spideryarn-worktrees/261007-not-made-yet-reads-and-quote-delay/src/messages.ts:4551) says six artefacts beside an eight-entry table; [tests/store-parity.test.ts:455](/var/tmp/spideryarn-worktrees/261007-not-made-yet-reads-and-quote-delay/tests/store-parity.test.ts:455) says five reads beside a six-read loop. Left unchanged because these files are outside the commit.

All eight client reads passed inspection for headers, exact null handling, validation before publication, and guards after awaits. Valid-response behavior is preserved.

| Mutation | Result |
|---|---|
| Remove Sketch header | 2 failures |
| Replace Sketch’s null check with truthiness | 6 failures |
| Remove Illustrated from offline pattern | 3 failures |
| Convert generic route 404s to absence | 10 failures |
| Remove readiness post-parse guard | Originally survived; now 2 failures |
| Remove caption post-parse guard | 1 failure |
| Remove main Sketch post-parse guard | 2 failures |

Every mutation was reverted by editing.

Gates: **729 tests passed across seven requested suites**. The full eight-suite command failed during setup: local Postgres/Docker access was blocked. `npm run typecheck` hit blocked `tsx` IPC; the same script via `node --import tsx` passed all four projects. Doc links: 18 passed. Scoped lint: no errors, six informational findings. Diff check passed.

No commits, Git state changes, or deployment.