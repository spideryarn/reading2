No P0s. I found and fixed three P1s.

1. **P1 — A throwing locator escaped the collector and returned no manifest entry.**  
   [src/collect-pdf-figures.ts:819](/home/greg/code/spideryarn2/.claude/worktrees/pdf-figure-locate-0928/src/collect-pdf-figures.ts:819)

   Wrapped the injected locator call so rejection behaves like `{ ok: false }`, preserving the held refusal. Added a red-first regression at [tests/collect-pdf-figures.test.ts:913](/home/greg/code/spideryarn2/.claude/worktrees/pdf-figure-locate-0928/tests/collect-pdf-figures.test.ts:913).

2. **P1 — `recoverPdfFigures` could reach the paid adapter by omission.**  
   [src/pipeline.ts:1720](/home/greg/code/spideryarn2/.claude/worktrees/pdf-figure-locate-0928/src/pipeline.ts:1720)

   Made `locate` required at this seam. Production explicitly passes `openRouterFigureLocator` at [src/pipeline.ts:2848](/home/greg/code/spideryarn2/.claude/worktrees/pdf-figure-locate-0928/src/pipeline.ts:2848); every test caller now explicitly passes `null` or a script. No paid calls were made during review.

3. **P1 — Unplaceable repeat/group images could evade rule 2.**  
   [src/pdf-figure-locate.ts:183](/home/greg/code/spideryarn2/.claude/worktrees/pdf-figure-locate-0928/src/pdf-figure-locate.ts:183)

   Their recorded boxes are placeholders, so checking whether the placeholder was visible was unsound. Any non-XObject image operator on the selected page now vetoes the answer. Added a red-first off-page-placeholder regression at [tests/pdf-figure-locate.test.ts:146](/home/greg/code/spideryarn2/.claude/worktrees/pdf-figure-locate-0928/tests/pdf-figure-locate.test.ts:146).

The other highlighted invariants held: selected bytes are rebound using the judge’s exact page/key, bitmap-owned identities are included in `taken`, duplicate located identities are symmetrically removed before storage, and sorting cannot make one duplicate “win.”

Not changed:

- The documented semantic risk remains: a tight box around a clean but wrong picture can pass.
- `too-complex` and `render-failed` remain the documented recall limitation.
- `pictureIdentity` does not copy or retain raster bytes, but hashing is linear and can repeat across overlapping windows. A local synthetic 40 MiB hash took about 147 ms. This is worth profiling on unusually large PDFs, but decoding/rendering/model latency dominates current evidence.
- Located-route memory is bounded to the current three-page window plus at most eight chosen rasters; no rendered PNG survives its iteration.

Verification:

- Typecheck passed via the requested Node fallback: all 2,226 source files covered.
- Focused suite: 5 files, 174 tests passed.
- Lint: no errors; complexity advisories only.
- `git diff --check`: passed.
- Full `npm test` could not start because the sandbox cannot access the local Postgres/Docker service. I did not start or touch a database, as requested.

No commit was made.