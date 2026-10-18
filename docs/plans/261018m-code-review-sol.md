1. **P3 — [src/types.ts:1406](/var/tmp/spideryarn-worktrees/qi-6297kfn6-skim-figures-for-visitors/src/types.ts:1406):** stale comment said the public DTO did not carry figures. Fixed it to describe `figures` crossing beside quote-only `stops`. No other code, client-path, security-map, or documentation findings.

Verification:

- Projection exposes exactly `{ blockId, depth, cue, after }`; future fields cannot cross implicitly.
- Removing the DTO projection failed `public-dto.test.ts`.
- Always emitting `figures` failed the legacy-route omission test.
- Whole-object spread failed on `plantedFigureField`.
- Removing `route.figures` from `walkOf` failed the visitor-walk test.
- Final scoped tests: 117 passed.
- Typecheck: all 3,825 source files covered and passed. The requested npm wrapper hit a sandbox `tsx` IPC restriction; running the identical script through Node’s `tsx` loader passed.
- `public-visibility-pg.test.ts` could not run: this sandbox cannot access Docker or local PostgreSQL, so its result remains unverified.
- `git diff --check` and lint for the fixed file passed.

LAND WITH FIXES