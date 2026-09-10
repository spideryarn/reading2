# Code review: Structure mode subsumes Outline

You are reviewing — and, under this repo's house workflow, **fixing** — the code built from
`docs/plans/260910g-structure-mode-subsumes-outline.md` in this worktree. Read the plan first (it
records your own plan review's seven findings and what was done about each), then the diff:

```
git diff origin/dev -- src tests
```

(The docs under `docs/project/` are being swept by another agent in parallel; ignore them unless a
code comment points at a doc sentence that is now false.)

## What was built

- `outline` left `MODES`; `RETIRED_MODES` + `modeFromParam` (src/modes.ts) resolve `?mode=outline`
  to `structure` in `modeParam` (src/web/params.ts), `readMode` (src/read-address.ts), and the
  Dock's `modeInSearch`. `liftStrandedText` (src/web/router.ts) rewrites `?mode=hierarchy&text=0` to
  `mode=structure`.
- `StructureBand` (src/web/modes/structure/StructureMode.tsx) measures its band's `offsetWidth`,
  borders and the root font size and chooses `StructurePanel` (two columns) or `OutlinePanel` (the
  nested list) via `structureFace`. Both panels take a `surfaceRef`. `Reader` lost its Outline hooks
  and arm and passes `supplementOf` and the arc cells to `StructureBand`.
- `StructurePanel` always draws two tracks; its stacked branch and structure-mode.css's container
  queries are gone.
- `OutlinePanel` measures every rung twice (titles whole / clamped) and prefers whole titles; the
  one-line clamp is `.outln-list.clamp`, the floor. `data-outline-clamp` joins `data-outline-rung`.
- Structure is `experimental: false`, has Outline's aliases plus `outline`, and Outline's Dock slot.
- Tables: MODE_LABEL, OWNER_MODE_NOTE, MODE_CATALOG, MODES_UI, POLICY, MODE_TARGET, band(),
  selectPassages; tests updated; new `tests/structure-mode-faces.test.tsx`.

## The conclusions I would least like to be wrong about

1. **No oscillation and no disagreement at the face threshold**, now that `structureFace` subtracts
   Structure's padding (rem × measured root size) and the band's measured borders from the border-box
   width, whichever face is mounted. Is there any state where mounting one face changes the band's
   `offsetWidth` or border (e.g. a face-specific class on the `<aside>` that `mode-band.css` or
   `narrow-window.css` keys a width/border off — check `.mode-band.outln` vs `.mode-band.struct`
   selectors across all stylesheets)? Is `offsetWidth` the right read when the band is transformed or
   hidden during a slide?
2. **The callback-ref-as-state pattern** (`surfaceRef={setBand}`, merged in `OutlinePanel` via
   `useCallback`): any render loop, stale observer, or a face switch that leaves `band` pointing at a
   detached element? Does `OutlinePanel`'s own measure effect still see `panelRef.current` set before
   it runs?
3. **The clamp floor** in `OutlinePanel`'s measure: does it ever choose a clamped rung when a whole
   one fits, or report `clamp: false` for a list that is in fact clamped? Are the visible list and the
   measured candidate the same markup in both states (`listClass`)?
4. Anything that still treats `outline` as a mode string (grep `src/` and `tests/` — note that
   "outline" is also the reading table's compact state, the pipeline's frozen-outline prompt text, a
   shadcn button variant, and a CSS property; those are not this).

Fix what you find inside this scope, keep the repo's comment style (comments explain *why*, dated,
naming who found what), and run the directly affected tests
(`npx vitest run tests/structure-mode-faces.test.tsx tests/outline-panel.test.tsx
tests/mode-surface-changes-no-markup.test.tsx tests/every-mode-draws-its-surface.test.tsx
tests/public-network-trace.test.tsx tests/shared-inventory.test.ts tests/address-settling.test.ts`)
and `npm run typecheck` (read its exit code; it prints ✗ to stderr). Do not commit, do not run any
git command that changes the tree or index, and do not touch `docs/project/`.

Report: numbered findings, each with file:line evidence, severity (P0/P1/P2), and **fixed / not
fixed (why)**; then the test and typecheck results with exit codes.
