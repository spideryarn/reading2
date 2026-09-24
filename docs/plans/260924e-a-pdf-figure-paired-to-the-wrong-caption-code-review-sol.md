No P0 or P1 findings. The stage’s narrow runtime claim holds for all repository callers and manifest consumers inspected.

1. **P2 — Caption-contract documentation lagged the implementation.** The comment described captions only as enabling the drawn route, although bitmap pairing now also requires caption evidence. I corrected [src/collect-assets.ts](/home/greg/code/spideryarn2/.claude/worktrees/pdf-figure-thorpe-0924/src/collect-assets.ts:390). The similar comment in [src/pipeline.ts](/home/greg/code/spideryarn2/.claude/worktrees/pdf-figure-thorpe-0924/src/pipeline.ts:1805) remains outside this stage; it is incomplete but does not affect behavior.

Audit conclusions:

- The sole production caller supplies captions from the same blocks used to derive markers, keyed by the exact marker attribute.
- `renderHtml` escapes captions, while `textContent` correctly restores ampersands, quotes, angle brackets, whitespace, and nested text. I also exercised this round trip directly.
- `/\\[([]/` correctly cuts at both `\(` and `\[`.
- `pageText` is captured from the same `getTextContent()` call previously used for the scanned-page decision, before that decision. Pages the old raster path processed therefore cannot newly receive an absent text entry; scanned pages remain skipped.
- Manifest consumers either select `status === "stored"` or display the generic failed state, so the new bounded reason requires no additional branch.
- No other `collectPdfFigures` or `pairPageFigures` caller was missed.

Verification:

- Focused Vitest suite: **3 files, 100 tests passed**.
- Typecheck passed all four TypeScript projects via `node --import tsx scripts/typecheck.ts`.
- The exact `npm run typecheck` wrapper could not start in this sandbox because `tsx` was denied permission to create `/tmp/tsx-1000/15.pipe`; project code was not reached.
- `git diff --check` passed.
- No database access, commits, index changes, or branch changes.