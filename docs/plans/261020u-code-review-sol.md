1. **Low — stale element description. Fixed.** The plan said the hint used `<kbd>`; the implementation uses an accessibility-hidden `<span>`. Corrected in [261020u-backspace-takes-the-way-back.md](/var/tmp/spideryarn-worktrees/fbyjnpjg-backspace-build/docs/plans/261020u-backspace-takes-the-way-back.md:139).

2. **Low — incorrect coarse-pointer rationale. Fixed.** A coarse pointer does not imply there is no hardware keyboard. Updated the plan and comments in [ReturnChip.tsx](/var/tmp/spideryarn-worktrees/fbyjnpjg-backspace-build/src/web/ReturnChip.tsx:193) and [dock.css](/var/tmp/spideryarn-worktrees/fbyjnpjg-backspace-build/src/web/styles/dock.css:399) to say hardware keyboards are uncommon on touch-first devices.

No correctness defects found. The Structure case works, the key cannot trigger the ×, repeat is refused, cleanup prevents lingering or duplicate actions, and the tests meaningfully exercise those paths.

Checks:

- Requested Vitest files: 148 passed.
- Typecheck: `npm run typecheck` could not start because the sandbox denied the `tsx` IPC socket. Running the identical script through `node --import tsx scripts/typecheck.ts` passed all four projects and covered all 3,896 source files.
- Biome lint on `ReturnChip.tsx`: passed.
- `git diff --check`: passed.

VERDICT: ship after my fixes