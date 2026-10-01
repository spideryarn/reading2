1. **Low — duplicate parameter clearing.** Initialization errors called `clearParams()` before `fail()`, which cleared them again. Moved success-path clearing after the error verdict, preserving one clear per path. [AuthCallback.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fu-password-reset/src/web/AuthCallback.tsx:196)

2. **Low — guard-test loopholes.** A commented-out `takeReturn()` or aliased `setError` could satisfy the original regex. The guard now strips comments and pins both permitted setter references: its binding and sole call. [auth-callback.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fu-password-reset/tests/auth-callback.test.ts:408)

3. **Low — overbroad security-map wording.** “Every failure” included failures before `AuthCallback` is reached. Narrowed this to “every callback failure,” matching the code. [security-map.md](/home/greg/code/spideryarn2/.claude/worktrees/fu-password-reset/docs/project/security-map.md:93)

4. **Info — no remaining behavioral regression found.** Verdict order, success/recovery paths, no-parameter behavior, StrictMode handling, parameter clearing, and the signed-in `[auth-kind]` shelf button remain intact. Every currently rendered callback failure goes through `fail()`, which consumes the return before setting the error. [AuthCallback.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fu-password-reset/src/web/AuthCallback.tsx:154)

Commands:

- Requested Vitest command: exit `0` — 36 tests passed.
- `node scripts/typecheck.ts`: exit `0`.
- Scoped Biome lint: exit `0`.
- `git diff --check`: exit `0`.

**Verdict: approve with the three small fixes above; no unresolved security-relevant findings.**