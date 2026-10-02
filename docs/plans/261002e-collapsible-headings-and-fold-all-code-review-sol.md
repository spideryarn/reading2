1. **P1 — [fold.ts:134](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/fold.ts:134):** an old keyed Reader’s passive cleanup could clear the newly mounted article’s fold store. Added mount ownership so stale cleanup is ignored; real unmount still removes the active `<style data-fold>`.

2. **P1 — [position.ts:107](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/position.ts:107):** sparse Structure starts could fall back to hidden index 0 when the first or every start was folded. It now selects the first eligible start or returns `-1` when none exists, preventing `?at=` from naming hidden content.

3. **P2 — [prose.css:136](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/styles/prose.css:136):** the chevron’s target could overhang a one-line heading at 12px/20px roots, and non-foldable headings reserved an empty trailing slot. Foldable rows now receive the exact required height; only headings with a rendered chevron reserve prose space.

4. **P2 — [on-screen.ts:59](/home/greg/code/spideryarn2/.claude/worktrees/fbskqwg8-collapsible-headings/src/web/on-screen.ts:59):** Fold all could make the shared on-screen/reading-time sampler measure hundreds of zero-height rows every sample. Folded rows now skip the sequential layout read and accrue no visibility or reading time.

The earlier visibility, arrival-anchor, Spine, nested-fold, final-section, tooltip cloning, propagation, `aria-expanded`, Alt-click and chord-guard fixes otherwise hold. The mirrored right placement follows `--text-pad-r` at the narrow breakpoint; touch opacity 0.45 remains visible and the target remains at least 24×24px. No wider product decision remains beyond the already-documented one-table invariant and OS shortcut conflicts.

Checks:

- Required Vitest command: 7 files, 82 tests passed.
- Added on-screen regression: 14 tests passed.
- Typecheck passed for all projects via `node --import tsx scripts/typecheck.ts`.
- Exact `npm run typecheck` was attempted but the sandbox refused `tsx`’s IPC socket with `EPERM`.
- Full `npm test` could not start because local Postgres/Docker was unavailable.
- Biome check and `git diff --check` passed; only two pre-existing CSS specificity warnings remain.

Files edited:

- `src/web/fold.ts`
- `src/web/on-screen.ts`
- `src/web/position.ts`
- `src/web/styles/prose.css`
- `tests/fold.test.ts`
- `tests/fold-keynav.test.ts`
- `tests/on-screen.test.ts`
- `tests/reading-position.test.ts`