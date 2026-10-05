**Closed.** The diff blocks admission when any active peer reaches its expiry, sets `stopped` through the existing refusal path, and preserves cleanup and call accounting. No regression found in those paths.

Validation against code matching `6033b84c8`:

- `/tmp/stage-e-expiry-regression.ts`, rerun in memory without rewriting files: passed; two calls started and counted, `out-of-time`, zero live cap timers.
- `npx vitest run tests/structure-slices-adversarial.test.ts`: **19/19 passed**, including settlement and timer cleanup.

The changed F24 expectation is correct: the first call’s synchronous work crosses its cap before the peer reaches admission. The peer must therefore never start, giving **one call**.

No files edited; no network used.