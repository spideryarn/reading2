- **P2 — `tests/library-hits.test.ts:279` (fixed):** Comparing `foldWithMap(s).folded` with `fold(s)` compared the implementation with its own wrapper. An incorrect deterministic fold would pass. Replaced it with independent server parity and map-invariant assertions; added exact spans, widening boundaries, astral neighbours, and rendered-text controls.

No P0/P1 findings. Changed only `tests/library-hits.test.ts`; no commits.

The Unicode probe checked **5,770,560 inputs**, including every code point in five contexts, random strings, and lone surrogates: zero parity, length, or monotonicity failures. The length guard is sound for current Unicode casing: contextual sigma changes spelling without shifting units. Aggregate length equality alone would not prove that for arbitrary future mappings.

`ownSpelling` handles trimming, both boundaries, and astral neighbours correctly. `marked` needs no edit. The accepted limitations remain: rendering can replace source spelling, and an unusable first occurrence can cause fallback despite a usable later occurrence.

The Node benchmark measured **18–23% overhead**, roughly **0.08–0.10 ms per paragraph**—about 5–6 ms extra across the shelf’s 30-hit maximum. No performance blocker.

Requested tests: **141 passed**. Direct TypeScript checks, lint, and diff checks passed. Full `npm test` was blocked by sandboxed database access; the typecheck wrapper was blocked by IPC permissions.

**SHIP**