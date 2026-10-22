ship

No P1/P2 findings. I made no fixes.

Validation:

- Focused tests: 20/20 passed.
- Tailwind resolver passed; the prefixed gap utility appears in a fresh production build.
- Typecheck passed via `node --import tsx scripts/typecheck.ts`; the npm wrapper alone hit a sandbox IPC restriction.
- `git diff --check HEAD` passed.