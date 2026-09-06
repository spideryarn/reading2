## Verdict: REFUSE

Established P0/P1 failures remain. In particular: malformed success metadata exits 0, transcript aliases still destroy evidence, and several lifecycle orderings return beyond the promised bound.

### F8 — P1 — established: exit grace settles the Promise, not the process

(a) The forced grace calls `finish()` but leaves stdout/stderr pipes open at [subagent-cli.ts:275](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/claude-cli-as-subagent/scripts/subagent-cli.ts:275). A valid successful child spawning a detached 20-second pipe holder produced:

```text
Done — claude -p (...)
real 20.29
```

despite `--timeout-minutes 0.1`. The Promise settled after about five seconds, but Node stayed alive until the helper closed the pipe.

(b) On forced grace, finalize capture and explicitly destroy the owned stdout/stderr streams before settling. Add an end-to-end successful-run test measuring process exit, not merely `await runChild`.

### F9 — P1 — established: capture overflow cancels the exit bound

(a) Overflow calls `stopTimers()` at [subagent-cli.ts:204](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/claude-cli-as-subagent/scripts/subagent-cli.ts:204), which clears `closeGrace`. With a root that had exited and a detached helper crossing 64 MiB:

```json
{"ms":9126,"overflowed":true,"bytes":67043338}
```

It waited for the helper’s natural exit; an indefinite helper makes `runChild` indefinite.

(b) Overflow must not clear an armed `closeGrace`, or must immediately replace it with a forced-close deadline.

### F10 — P1 — established: `--stream` transfers the unbounded pipe to the caller

(a) Stream mode uses inherited descriptors at [subagent-cli.ts:180](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/claude-cli-as-subagent/scripts/subagent-cli.ts:180). An outer capturing process waited for the detached helper even after the inner wrapper finished:

```json
{"callerMs":8201,"stdout":"{\"promiseMs\":5111,\"timedOut\":true,\"signal\":\"SIGKILL\"}"}
```

An indefinite helper leaves an orchestrating caller waiting indefinitely.

(b) Use wrapper-owned pipes and tee them live to stdout/stderr; destroy those pipes at forced grace.

### F11 — P1 — established: the two grace periods stack

(a) The watchdog waits five seconds before SIGKILL at [subagent-cli.ts:220](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/claude-cli-as-subagent/scripts/subagent-cli.ts:220); only after exit does [line 275](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/claude-cli-as-subagent/scripts/subagent-cli.ts:275) start another five-second grace. A 100 ms timeout measured:

```json
{"promiseMs":10106,"timedOut":true,"signal":"SIGKILL"}
```

That contradicts the documented “timeout + grace” result at [codex-cli-as-subagent.md:360](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/claude-cli-as-subagent/docs/reusable/codex-cli-as-subagent.md:360).

(b) Establish one absolute post-timeout deadline; SIGKILL and forced settlement should share it.

### F12 — P1 — established: malformed `is_error` still succeeds

(a) [run-claude.ts:349](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/claude-cli-as-subagent/scripts/run-claude.ts:349) converts missing or malformed `is_error` to `false`. Therefore [line 592](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/claude-cli-as-subagent/scripts/run-claude.ts:592) accepted:

```json
{"type":"result","subtype":"success","result":"APPROVE-WITHOUT-IS-ERROR"}
```

The wrapper exited 0 and printed `Done —`. This directly disproves F6’s claimed requirement that `is_error === false`.

(b) Fail closed with `isError: event.is_error !== false`; test missing, string, numeric and null values.

### F13 — P0 — established: F5’s alias defence remains incomplete

(a) [samePath](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/claude-cli-as-subagent/scripts/run-claude.ts:498) cannot recognize two nonexistent leaves reached through symlinked parent directories. The wrapper exited 0 and left the sole underlying file containing only:

```text
NORMAL-SUCCESS
```

The transcript had been overwritten.

The Codex sibling still has no collision check at all: [run-codex.ts:492](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/claude-cli-as-subagent/scripts/run-codex.ts:492). Identical `--output` and `--activity-log` paths exited 0 and left only `ANSWER-ONLY`. That half predates this candidate but remains in the modified scoped file.

(b) Put one robust write-target identity check in the shared module. Non-truncating open/create plus `fstat` can cover nonexistent leaves, symlinked parents, dangling symlinks and hard links. Use it in both wrappers before spawning.

### F14 — P0 — established: inherited endpoint controls bypass the provider defence

(a) The drop list at [run-claude.ts:128](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/claude-cli-as-subagent/scripts/run-claude.ts:128) covers only three `CLAUDE_CODE_USE_*` selectors. Direct inspection showed `claudeEnv(..., "machine")` preserves:

```json
{
  "ANTHROPIC_BASE_URL":"https://attacker.invalid",
  "ANTHROPIC_CUSTOM_HEADERS":"Authorization: Bearer secret"
}
```

The installed Claude 2.1.263 binary explicitly recognizes both variables. Thus inherited configuration can reroute the request and forward custom secrets without `probeAuth` identifying that endpoint.

(b) Drop endpoint/header/provider controls by default, including these two, and require explicit `--pass-env` to restore them.

### F15 — P1 — established: the auth probe is outside `--timeout-minutes`

(a) `probeAuth` always receives 30 seconds at [run-claude.ts:429](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/claude-cli-as-subagent/scripts/run-claude.ts:429), while the requested clock starts only at [line 555](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/claude-cli-as-subagent/scripts/run-claude.ts:555). A one-second probe plus `--timeout-minutes 0.001` took:

```text
real 1.12
```

The same probe runs before `--dry-run`; a hanging probe reaches roughly 30 seconds.

(b) Start one deadline before probing, cap the probe by the remaining budget, and give the paid child only what remains.

### F16 — P0 — reasoned from established control flow: auth verification fails open

(a) Probe failure, timeout or malformed output becomes `undefined` at [run-claude.ts:424](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/claude-cli-as-subagent/scripts/run-claude.ts:424); [authConflict](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/claude-cli-as-subagent/scripts/run-claude.ts:454) then permits the paid run. A malformed fake probe under `--auth env` exited 0 with:

```text
ANTHROPIC_AUTH_TOKEN → credential unknown
PAID-RUN-WOULD-PROCEED
```

Combined with the already-measured unapproved-key fallback, this can spend the machine login that `--auth env` was intended to avoid. The same check also permits `env + third_party/bedrock`.

(b) Fail closed for `--auth env` unless the probe positively identifies an expected first-party method/source; allow a third-party provider only when its selector was explicitly passed.

### F17 — P1 — reasoned: restricted runs can name the wrong credential

(a) Read/review invocations add `--restricted` at [run-claude.ts:295](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/claude-cli-as-subagent/scripts/run-claude.ts:295), but the probe cannot. The documentation itself admits the probe reads settings the paid run ignores at [claude-cli-as-subagent.md:255](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/claude-cli-as-subagent/docs/reusable/claude-cli-as-subagent.md:255). Nevertheless the success line presents the probe as the run’s credential at [run-claude.ts:610](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/claude-cli-as-subagent/scripts/run-claude.ts:610).

(b) For restricted profiles, label this explicitly as an unrestricted auth probe that may differ; do not call it the credential actually used.

### F18 — P1 — established: the spend register names the wrong account

(a) [spend-declarations.ts:372](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/claude-cli-as-subagent/src/spend-declarations.ts:372) says the default is the machine login and `--auth env` means `ANTHROPIC_API_KEY`. Both claims contradict the new implementation: machine mode accepts any machine-resolved method/provider, while env mode passes three credentials. `npm run cost` prints this field authoritatively as “billed to” at [ai-cost.ts:615](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/claude-cli-as-subagent/scripts/ai-cost.ts:615). The guard’s explanation at [no-undeclared-spend.test.ts:149](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/claude-cli-as-subagent/tests/no-undeclared-spend.test.ts:149) also retains the disproved subscription assumption.

(b) Describe machine-resolved billing and enumerate all env credentials plus explicitly passed provider controls.

No direct buffered-tail truncation or double settlement was established: a normal 10 MiB tail was captured byte-exactly in 45 ms, and `settled` prevents duplicate Promise resolution. Spawn failure also reaches that guard.

Validation: 106 wrapper tests passed; the 36 spend-guard tests passed; `node --import tsx scripts/typecheck.ts` passed all projects. The ordinary `npm run typecheck` hit the documented sandbox `listen EPERM`, so I used the permitted direct invocation. No repository files were changed.