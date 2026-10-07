1. **C1 — Medium: GIF conversion retained the entire decoded clip twice.** Updated [frames-to-gif.ts](/var/tmp/spideryarn-worktrees/fbmq05ww-help-screenshots/scripts/frames-to-gif.ts:16) to use a bounded palette sample, reuse one decoder, and write one global palette. The representative 40-frame conversion fell from 5.9s to 4.2s. Canvas still peaks around 528MB RSS, but the script no longer explicitly retains memory proportional to every full RGBA frame.

2. **C2 — Medium: the GIF frame test could count marker-like compressed data as frames.** Added a block-aware GIF parser in [image-size.ts](/var/tmp/spideryarn-worktrees/fbmq05ww-help-screenshots/tests/helpers/image-size.ts:67) and exercised a decoy marker in [help-images.test.ts](/var/tmp/spideryarn-worktrees/fbmq05ww-help-screenshots/tests/help-images.test.ts:83). The shipped GIFs parse as 8, 7 and 8 distinct frames.

3. **C3 — Low: converter behavior was untested, and failure messages disappeared when output was captured.** Added direct CLI coverage for ordering, mismatched dimensions and identical frames in [frames-to-gif.test.ts](/var/tmp/spideryarn-worktrees/fbmq05ww-help-screenshots/tests/frames-to-gif.test.ts:43). Failures now write synchronously in [frames-to-gif.ts](/var/tmp/spideryarn-worktrees/fbmq05ww-help-screenshots/scripts/frames-to-gif.ts:47).

4. **C4 — Low: reduced-motion stills escaped the PNG byte limits.** [help-images.test.ts](/var/tmp/spideryarn-worktrees/fbmq05ww-help-screenshots/tests/help-images.test.ts:79) now applies the minimum and maximum byte checks to fallback stills too.

5. **C5 — Low: two image descriptions did not match their crops.** Corrected the bottom bar from “Structure open” to “Plain open” and removed the absent phone section heading in [help-images.ts](/var/tmp/spideryarn-worktrees/fbmq05ww-help-screenshots/src/web/help/help-images.ts:100), [the-reading-view.md](/var/tmp/spideryarn-worktrees/fbmq05ww-help-screenshots/src/web/help/pages/the-reading-view.md:26), and [touch.md](/var/tmp/spideryarn-worktrees/fbmq05ww-help-screenshots/src/web/help/pages/touch.md:25).

The `<picture>` reduced-motion fallback and 2× dimensions are correct. The help-chat branch will intentionally require `WRITE_HELP_CORPUS=1 npx vitest run tests/help-corpus.test.ts` when merged second; no server bundle change is needed.

Checks: requested scope plus the new converter test, 239 passed; typecheck passed for all 3,433 files via the equivalent Node loader invocation; Biome and `git diff --check` passed. Full `npm test` could not start because local Postgres is inaccessible in this sandbox.

VERDICT: ready