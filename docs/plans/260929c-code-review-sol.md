Verdict: **accept after fixes**

- **F10 — P2, fixed:** FAQ and Citations hid Metadata-started progress, Stop, and failures on existing/outdated results. Both now share status with their single existing footer—no duplicate or empty footer. Regression tests added.
- All nine panels retain stale/profile-changed handling. Glossary and Quotes behavior is consistent.
- FAQ/Citations rerun claims are accurate. Citations preserves matching IDs, retaining stored *Find it* results.
- No current docs incorrectly describe an outdated banner.

Checks:

- Typecheck: passed.
- Scoped lint: no errors; one pre-existing informational warning.
- Requested Vitest suite: not run—the repository memory guard refused startup due system memory pressure.
- No commit made.