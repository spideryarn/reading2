## Verdict

**Do not land Stage 4 yet.** Four established P1 holes allow environment reads to remain silently uninventoried. No P0 findings.

## Findings

- **F10 — P1 — established:** all `import.meta.env` reads are invisible. The sweep only recognizes `process.env`, and the prefilter only selects files containing that exact text ([test](/home/greg/code/spideryarn2/.claude/worktrees/worktree-postmortem-preventions-260907/tests/env-names-are-inventoried.test.ts:755)). Existing missed reads include `VITE_SENTRY_DSN` and `VITE_VERCEL_ENV` ([monitoring.ts](/home/greg/code/spideryarn2/.claude/worktrees/worktree-postmortem-preventions-260907/src/web/monitoring.ts:72)); neither appears in `EXPECTED` or `ALLOWED`. The computed Supabase read is also invisible ([supabase.ts](/home/greg/code/spideryarn2/.claude/worktrees/worktree-postmortem-preventions-260907/src/web/lib/supabase.ts:34)), though its two names happen already to be in `EXPECTED`. Extend the sweep to `import.meta.env`, resolving both direct and computed forms. Treat `PROD`/`MODE` as Vite-provided names; decide explicitly where `VITE_SENTRY_DSN` and `VITE_VERCEL_ENV` belong.

- **F11 — P1 — established:** syntactically equivalent `process` access can disappear before or during traversal. The exact-text prefilter silently skips `process?.env.X`, `process . env.X`, `process["env"].X`, and `const { env } = process; env.X`. `globalThis.process.env.X` passes the prefilter but fails `isProcessEnv()` because the root is not a bare identifier ([recognizer](/home/greg/code/spideryarn2/.claude/worktrees/worktree-postmortem-preventions-260907/tests/env-names-are-inventoried.test.ts:271)). Remove the exact-string prefilter—530 source files is small enough to parse—or replace it with a demonstrably complete superset. Add controls through the real file-selection path; current fixtures call `sweepFile()` directly and therefore cannot catch this class.

- **F12 — P1 — established:** the reporter exemption is scoped to file and function name, and its positive control does trip if that one exempted read disappears. But it does not protect the premise that every caller derives its argument from `EXPECTED`. Adding `value("NEW_VARIABLE")` would read a new variable through the already-exempted AST node while the exemption count remained exactly one. Likewise, `value(expected.with)` already reads the `with` field, while `expectedNames()` only recognizes `name` and `or` ([parser](/home/greg/code/spideryarn2/.claude/worktrees/worktree-postmortem-preventions-260907/tests/env-names-are-inventoried.test.ts:648), [call site](/home/greg/code/spideryarn2/.claude/worktrees/worktree-postmortem-preventions-260907/src/vercel-health.ts:475)). Current `with` happens to duplicate another entry’s `name`; that is accidental safety. Validate every `value` reference/call shape and require every `with` value to be otherwise inventoried.

- **F13 — P1 — established:** the `src/env.ts` whole-object exemption currently hides a named read. `process.env` is passed into `applyEnvFile()` ([env.ts](/home/greg/code/spideryarn2/.claude/worktrees/worktree-postmortem-preventions-260907/src/env.ts:113)), which reaches `pinnedNames(env)` and reads `env[PINNED]`; `PINNED` is the literal `SPIDERYARN_ENV_PINNED` ([env.ts](/home/greg/code/spideryarn2/.claude/worktrees/worktree-postmortem-preventions-260907/src/env.ts:370)). That name is in neither inventory door. The exact “four exemptions” assertion correctly makes a fifth direct whole-object use red, and whole-object use elsewhere is refused, but neither detects named reads downstream of the existing four uses. Replace the file-wide exemption with exact, justified generic operations and account for named reads through passed aliases, beginning with `SPIDERYARN_ENV_PINNED`.

- **F14 — P2 — reasoned:** `SPIDERYARN_BASE_URL` belongs on the developer-only allowlist, not in deployment `EXPECTED`. Its owning code says it exists for worktree ports ([checkout.ts](/home/greg/code/spideryarn2/.claude/worktrees/worktree-postmortem-preventions-260907/src/billing/checkout.ts:141)), and deployment documentation says it **must stay unset** in production ([deployment.md](/home/greg/code/spideryarn2/.claude/worktrees/worktree-postmortem-preventions-260907/docs/project/deployment.md:633)). Preview already falls back to `VERCEL_URL`. Reporting a permanently false, deliberately forbidden production setting adds noise without diagnosing deployment health.

- **F15 — P3 — established:** parts of the allowlist explanation are literally inaccurate. `PGAPPNAME` is read and applied when a deployed pool is created ([client.ts](/home/greg/code/spideryarn2/.claude/worktrees/worktree-postmortem-preventions-260907/src/db/client.ts:138)); `SENTRY_FORCE_LOCAL` is evaluated by deployed monitoring; and the module-level `SPIDERYARN_OWNER_EMAIL` expression is evaluated whenever `owner.ts` loads. The model overrides can also alter deployed request behavior, although excluding them is reasonable because `/profile` separately reports the effective model. Reword these as “not actionable health-report settings” rather than “never read by a deployment” or “not deployment settings.”

## Requested syntax audit

| Spelling | Result today |
|---|---|
| `process.env.NAME` / `process.env["NAME"]` | Resolved |
| `const { NAME } = process.env` | Fails closed as whole-object use outside `src/env.ts` |
| `const e = process.env; e.NAME` | Fails closed at alias creation outside `src/env.ts`; alias itself is not followed |
| `globalThis.process.env.NAME` | **Silently skipped** |
| `process.env[IMPORTED_CONST]` | Fails closed: imports are not local declarators |
| `process.env[MODEL_ENV_VAR[task]]` | Fails closed; only the current local `const envVar = RECORD[index]` shape resolves |
| `import.meta.env[name]` or `.NAME` | **Silently skipped** |
| ``process.env[`NAME`]`` | Fails closed as a `TemplateLiteral` |
| `process.env?.NAME` | Resolved |
| `process?.env?.NAME` | **Silently skipped** when the file contains no other exact `process.env` text |
| `Reflect.get(process.env, "NAME")` | Fails closed as whole-object use outside `src/env.ts` |
| `Reflect.get(process, "env").NAME` | **Silently skipped** |
| `process["env"].NAME`, `{ env } = process`, `process . env.NAME` | **Silently skipped** |

The `fetch.ts` `scopeOf` fix handles the actual unrelated `seen` parameter correctly. It is not true lexical binding analysis: a same-named binding nested inside `credentialsSeen()` can have its calls attributed to the helper or cause a false refusal. Those outcomes over-report or turn red; I found no silent omission from that flaw.

All five new entries have `breaks: null`. Consequently they add only boolean names to the public `env` object; they cannot add warnings or change `ok`. No values are disclosed. I agree that `SPIDERYARN_OWNER_ID` should later receive a `breaks` clause after Greg’s production decision: the deployment documentation already calls absence a thrown error. Leaving it report-only is correct under this stage’s explicit safety constraint.

The 12 model overrides are defensible allowlist entries because they are optional comparison knobs and `/profile` reports their effective values. The wording should acknowledge that they can mechanically affect a deployment.

The candidate test itself passed **15/15**. `tests/health.test.ts` could not run in this sandbox: its private-lane global setup attempted loopback, received `EPERM`, and then aborted for lack of Postgres. The 965 lines are not chiefly empty ceremony, but the implementation spends substantial complexity resolving special cases after an unsound entry gate. Fix that boundary first; simplification can follow without an arbitrary line-cut target.