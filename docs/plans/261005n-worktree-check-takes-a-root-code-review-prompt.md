# Code review: `worktree:check --root`, and the dashboard's removal uses it

You reviewed the plan for this. This is the code. You have a writable sandbox: **fix what you find
inside this stage's files, and report anything wider for me to decide.** Do not commit. Do not
invent a quotation from anyone, and do not attribute any sentence to Greg.

## The candidate

Uncommitted changes in this worktree against `origin/dev` — `git diff HEAD` shows all of it:

- `scripts/worktree-check.ts` — `checkTarget`, `runCheck`, a thin `main`; `run` now uses `gitEnv()`
- `scripts/worktree-port.ts` — `gitCommonDir` and `gitDir` use `gitEnv()`; `worktreePointerProblem`
  moved here from `scripts/readiness-loop.ts`, which now wraps it
- `tools/fleet/actions.ts` § `planRemoveWorktree` — step 3 is the primary's `tsx` and
  `scripts/worktree-check.ts --root <tree>`, run from the primary
- tests: `tests/worktree-check.test.ts`, `tests/fleet-actions.test.ts`,
  `tests/fleet-actions-route.test.ts`, `tests/fleet-enacted-receipts.test.ts`, `tests/fleet-web.test.tsx`
- docs: the plan (`docs/plans/261005n-worktree-check-takes-a-root-and-the-readiness-runner-follows-the-var-tmp-root.md`,
  including what your plan review changed and why stage 2 was dropped), `docs/project/worktrees.md`

## Evidence already in hand

- The new tests were seen red before the code: 19 failures for `--root` and the step-3 argv, then
  two more (the copied pointer accepted; the branch read as `worktree-sibling` under a poisoned
  `GIT_DIR`) before `gitEnv()` and the pointer check went in.
- `npm run typecheck` passes. The seven worktree/fleet/readiness test files pass.
- Run for real: a tree under `/var/tmp/spideryarn-worktrees/` with no `node_modules`, judged from
  this checkout with `--root`: exit 0 and SAFE when clean, exit 1 naming the file when one
  untracked file was added.

## What I want from you

This check's false SAFE deletes the only copy of somebody's work. Attack the code, not the prose:

1. Any argv or filesystem state for which `runCheck` returns code 0 about a tree other than the one
   named, or about part of it. Try to break `checkTarget` — order of the checks, `realpathSync`
   races aside.
2. `gitEnv()` now applies to **every** caller of `gitCommonDir` / `gitDir` (setup, deploy,
   `claude-accounts`, `vite.config.ts` via worktree-port) and to every git call in `gather`, which
   `worktree:sweep` and `worktree:remove` share. `gitEnv` also sets `GIT_TERMINAL_PROMPT=0` and
   `GIT_NO_REPLACE_OBJECTS=1`. Does any of those callers depend on the inherited environment, or
   on a prompt, in a way this breaks? Does importing `tools/fleet/readiness-git.ts` into
   `scripts/worktree-port.ts` create an import cycle or pull anything heavy into `vite.config.ts`?
3. The move of `worktreePointerProblem`: are the runner's messages byte-for-byte what they were?
4. Step 3 now runs with `cwd: primaryDir`. Does anything in `tools/fleet/routes-actions.ts` (the
   step runner, the receipts, the "what did this do to the box" text) treat a step's `cwd` or its
   `argv[0..2]` as meaningful in a way the new shape breaks? Is anything still keyed on
   `"worktree:check"` as an argv element?
5. Are the tests asserting what their names say? Is any of them unable to fail?
6. Is the conclusion in the plan — stage 2 dropped, and why — a fair reading of your F4 and F5?

Run a test file with `node --import tsx node_modules/vitest/vitest.mjs run <file>` if `npm test` is
refused by the sandbox. A red test inside the sandbox is not yet a finding: say what you ran.

Then a verdict: findings numbered CR1…, each with severity, file and line, whether you fixed it,
and the diff you made if so. Say plainly if you found nothing.
