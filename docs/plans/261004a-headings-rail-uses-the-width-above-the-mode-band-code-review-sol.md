P0: none.

P1: none.

P2 — fixed two inaccurate comment claims:

- [`scroll.ts:66`](/home/greg/code/spideryarn2/.claude/worktrees/fbft2cgg-headings-rail-full-width/src/web/scroll.ts:66) said crossing the viewport edge happened “exactly” when the bar stuck, contradicting the intentional safe-area delay below it.
- [`BarStuckSentinel.tsx:1`](/home/greg/code/spideryarn2/.claude/worktrees/fbft2cgg-headings-rail-full-width/src/web/BarStuckSentinel.tsx:1) made an unnecessary, unproven guarantee about horizontal scrolling.

Both comments are corrected; behavior is unchanged. The edits remain uncommitted because this sandbox mounts the worktree’s Git metadata read-only.

Everything else checks out:

- All four plan-review findings landed: exact three-declaration CSS assertion, real-`Reader` wiring, queued-callback guard, and `showCrumbs` scoping.
- `entries.at(-1)` is correct for the observer’s single target: entries are appended to the callback queue in order. A zero-height target at the exact edge is still intersecting, so `!isIntersecting && top < 0` changes state only after it has passed above. Initial observations are also guaranteed, covering an already-scrolled mount. [Intersection Observer specification](https://www.w3.org/TR/intersection-observer/)
- Cleanup and the `stopped` guard prevent the attribute surviving without its breadcrumb bar, including StrictMode’s effect replay.
- The CSS selector has specificity `(0,4,0)` and beats the base `.controls` geometry. `--mode-w: 0` is a no-op; vertical transforms, crumb guards, narrow wrapping, and ≤731px overflow do not conflict.
- The zero-height direct child changes no flow geometry. No production selector or measurement depends on `.reader` child indexes or adjacency; `controlsBar()` and `ViewportProbe` locate the bar by class.
- The experimental-features sentence is accurate.

Checks:

- Requested tests: 3 files, 18 tests passed.
- Typecheck: all four projects passed, covering 2,923 source files. The npm wrapper could not create its IPC socket under this sandbox, so I ran the same script through `node --import tsx`.
- Touched-file lint completed. Only the existing `Reader.tsx` complexity and optional-chain advisories remain.
- `git diff --check` passed.
- Full suite not run, as requested.

VERDICT: approve with changes