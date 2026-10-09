LAND WITH FIXES (made)

1. **Fixed — folder matches could exceed the deadline.** The fallback processed all 954 PNGs, including unchanged files, with Git calls per candidate. It now batch-compares raw hashes against `HEAD`; the full candidate hash takes about 0.5 seconds.

2. **Fixed — restage race.** A peer edit arriving after selection but before compression could be staged. Receipts now bind both source and output bytes, with regression coverage for before-compression, after-compression, and index races.

3. **Fixed — `leading_cd` semantics.** Quoted `~` was incorrectly expanded; empty and unsupported escaped `cd` forms could use the wrong directory. These now follow shell behavior or fail open without touching files.

4. **Fixed — matcher false negative.** `./docs/...` paths are now recognized.

5. **Fixed — unsupported documentation claims.** The plan, browser documentation, and postmortem now accurately describe changed-from-`HEAD` filtering, variable paths, test cases, shipping state, and reader impact.

Verification:

- Hook test: `ALL PASS`
- Focused Vitest: 31/31 passed
- Typecheck: passed through the no-IPC loader
- Scoped lint: passed with two pre-existing informational complexity notices
- Full `npm test`: could not start because Postgres/Docker is unavailable in this sandbox; no test failure occurred.