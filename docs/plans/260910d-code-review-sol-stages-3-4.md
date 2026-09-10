Verdict: **ship with the uncommitted changes below**. No P0/P1 findings; I did not refuse.

### Findings

- **F1 — P2, established: unrouted environment order changed.**
  - (a) `Object.keys(claudeEnv({ ANTHROPIC_API_KEY: "key", PATH: "/bin" }, "env"))` returned `["ANTHROPIC_API_KEY", "PATH"]`; `1209bc70` returned `["PATH", "ANTHROPIC_API_KEY"]`. This is observable as the child’s `envp` order.
  - (b) Restored names are now deleted and re-appended for unrouted calls, preserving legacy order. A 524,288-case comparison against the parent implementation found zero remaining differences.

- **F2 — P2, established: inherited prototype names were falsely reported.**
  - (a) `sanitisedEnv({ PATH: "/bin" }, ["toString"], ["toString"], callback)` reported `toString`, although it is inherited from `Object.prototype`, not present in the environment.
  - (b) The callback filter now requires `Object.hasOwn(parent, name)`.

- **F3 — P2, established: routed credential refusals gave impossible remediation.**
  - (a) An inherited `CLAUDE_CONFIG_DIR` plus `--auth env` could say credentials were passed or complain they were missing. Routed `--pass-env ANTHROPIC_API_KEY` recommended `--auth env`, which routing also forbids.
  - (b) Argument validation now detects the existing routing conditions and explains that the selected state directory owns authentication. It runs before generic credential diagnostics. Routing activation itself is unchanged.

- **F4 — P3, established test gap: the routed boundary matrix was under-specified.**
  - (a) Candidate tests survived mutations that restored an explicitly requested future `CLAUDE_*`, stopped dropping `CLAUDECODE`, or made all `ANTHROPIC_*` absolute.
  - (b) Tests now cover future `CLAUDE_*`, `CLAUDECODE`, and routed restoration of non-credential `ANTHROPIC_*`.

- **F5 — P3, established test gap: multi-name reporting was unguarded.**
  - (a) Mutations reporting or warning about only the first overruled name passed all candidate tests.
  - (b) Tests now require one callback/warning containing every unique present name, excluding absent names and all values.

Your Bedrock conclusion is right: `CLAUDE_CODE_USE_BEDROCK` is intentionally absolute for routed children, consistent with the first-party account check.

`run-codex.ts` passes no `drop`, so its `childEnv` behavior remains unchanged. `accountNeutralEnv` removes its specified six variables.

Verification:

- 43 non-E2E `run-claude` tests passed.
- 5 sanitizer tests passed.
- 22 helper/account tests passed.
- Typecheck passed across all 1,939 source files.
- Touched-file lint exited 0; only the pre-existing complexity notices remain.
- Full `run-claude` E2E execution was blocked by the sandbox rejecting nested tsx IPC sockets with `listen EPERM`; this is unrelated to candidate behavior.
- No commit made.

Files I changed:

- [scripts/run-claude.ts](/home/greg/code/spideryarn2/.claude/worktrees/pool-env-tests/scripts/run-claude.ts:202)
- [scripts/subagent-cli.ts](/home/greg/code/spideryarn2/.claude/worktrees/pool-env-tests/scripts/subagent-cli.ts:445)
- [tests/run-claude.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/pool-env-tests/tests/run-claude.test.ts:39)
- [tests/subagent-cli-sanitised-env.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/pool-env-tests/tests/subagent-cli-sanitised-env.test.ts:18)

The concurrently modified plan/review files in the worktree were not mine.