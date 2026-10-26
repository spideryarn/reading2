1. **Low — fixed:** brand previews still showed the dark tile on both themes and called it “opaque ivory.” Updated [generate-brand-assets.ts](/var/tmp/spideryarn-worktrees/fbshpsvx-icon-dark-by-default/scripts/generate-brand-assets.ts:121), regenerated all three previews, and added assertions in [brand-assets.test.ts](/var/tmp/spideryarn-worktrees/fbshpsvx-icon-dark-by-default/tests/brand-assets.test.ts:414).

2. **No touch-script defect found:** the shipped script is isolated, directly follows its `<head>` link, catches `matchMedia` failure, defaults dark, and correctly uses `addListener` when `addEventListener` is unavailable. It does not share state with the later boot scripts. There is no application CSP hash registry; the shell SHA-256 covers the complete built document automatically.

3. **No test defect found:** [touch-icon.test.ts](/var/tmp/spideryarn-worktrees/fbshpsvx-icon-dark-by-default/tests/touch-icon.test.ts:14) executes the exact shipped script. Removing it fails the presence assertion; reversing the condition fails the light/dark assertions.

4. **No further consumer or documentation disagreement found:** Vercel serves both icons as ordinary public files; crawler allowlists intentionally need only the dark default; Android/email use dark intentionally; extension and export behavior remains separate. `main-icon.md` matches the implementation.

Checks:

- Requested Vitest set: **4 files, 219 tests passed**
- Brand asset freshness: passed
- Typecheck: passed, 4,039 files covered
- Full `npm test`: blocked before collection because local Postgres/Docker is unavailable
- No commit made.