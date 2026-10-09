1. **Low — Skim docs misstated transient and door states.** Fixed [skim.md](/var/tmp/spideryarn-worktrees/fbx0rfs2-skim-quieter-stop/docs/project/skim.md:489) to:

   - distinguish resting grey chip names from hover/open full ink;
   - say both door lines become upright;
   - preserve Greg’s words as an attributed blockquote.

No other correctness findings. The heading cascade witness models the real current row. `--rule-strong` remains unchanged and is visible in both screenshots. Focus remains visible: the button reset does not suppress the browser outline, transparent backgrounds do not affect it, and focused term chips also gain `.on`.

Checks passed:

- Focused Vitest files: 187 tests
- Typecheck: all 3,585 source files covered
- Biome lint on `type-roles.test.ts`
- `git diff --check`

Nothing wider to report.