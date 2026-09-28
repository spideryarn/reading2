Found and fixed four issues; two design risks remain. No P0 findings.

## Findings

**C1 — P1 — `[ai-no-room]` made an unsupported diagnosis and wrongly blocked retries. Fixed.**

At [src/messages.ts:2598](/home/greg/code/spideryarn2/.claude/worktrees/referee-claims-long-pieces-0928/src/messages.ts:2598), `saidNothing("length")` claimed the allowance was spent “working out” the answer. That is not true for every caller: it may have received tool-call or other non-text output, and `saidNothing` has no token accounting. `blocked` was also too strong because identical claims requests varied 2.4× in reasoning use.

It now states only that the allowance was exhausted before text appeared and returns `retry`. Proven by [tests/messages.test.ts:406](/home/greg/code/spideryarn2/.claude/worktrees/referee-claims-long-pieces-0928/tests/messages.test.ts:406) and the reasoning-only claims test at [tests/referee-claims-run.test.ts:341](/home/greg/code/spideryarn2/.claude/worktrees/referee-claims-long-pieces-0928/tests/referee-claims-run.test.ts:341).

**C2 — P2 — The prompt-ablation eval no longer changed only the prompt. Fixed.**

Production moved to 39,400 tokens, but [evals/referee-claims.ts:940](/home/greg/code/spideryarn2/.claude/worktrees/referee-claims-long-pieces-0928/evals/referee-claims.ts:940) retained 12,000. Future ablations would therefore confound prompt and budget.

It now imports `CLAIMS_MAX_TOKENS`. A regression test was added at [tests/referee-claims-run.test.ts:231](/home/greg/code/spideryarn2/.claude/worktrees/referee-claims-long-pieces-0928/tests/referee-claims-run.test.ts:231).

**C3 — P2 — `ReasoningEffort` did not represent the documented wire contract. Fixed.**

[src/ai-call.ts:719](/home/greg/code/spideryarn2/.claude/worktrees/referee-claims-long-pieces-0928/src/ai-call.ts:719) omitted `xhigh` and `max`, despite describing itself as the complete OpenRouter effort type. This would prevent future table rows from selecting supported values.

Both values were added. The compile-time coverage assertion is in [tests/chat-reasoning.test.ts:22](/home/greg/code/spideryarn2/.claude/worktrees/referee-claims-long-pieces-0928/tests/chat-reasoning.test.ts:22).

**C4 — P2 — The child-process log test was not a sound completion check. Fixed.**

[tests/referee-claims-no-room-log.test.ts:83](/home/greg/code/spideryarn2/.claude/worktrees/referee-claims-long-pieces-0928/tests/referee-claims-no-room-log.test.ts:83) launched the `tsx` CLI, which requires an IPC socket unavailable in restricted test environments. It also could accept expected log records even if the child subsequently exited unsuccessfully.

It now uses Node’s `--import tsx`, requires a clean child exit, and leaves reader-facing exception verification to an ordinary in-process test.

**C5 — P2 — A trickling stream can now delay failure substantially longer. Not fixed.**

The derived ceilings are internally consistent, but claims now permit 519 seconds, ordinary criteria 181 seconds, and literature criteria 274 seconds. `onActivity` resets the stall clock on every raw read at [src/openrouter-stream.ts:237](/home/greg/code/spideryarn2/.claude/worktrees/referee-claims-long-pieces-0928/src/openrouter-stream.ts:237), including keepalives. A stuck-but-trickling connection can therefore wait for the full deadline—over three times longer for ordinary criteria.

Changing this safely needs a separate response-progress clock; merely shortening these deadlines would contradict the newly supported token ceilings.

**C6 — P2 — Incompatible model overrides now fail closed. Not fixed.**

[src/ai-call.ts:1275](/home/greg/code/spideryarn2/.claude/worktrees/referee-claims-long-pieces-0928/src/ai-call.ts:1275) sends the job’s configured effort even when an environment variable overrides its model. With `require_parameters: true`, a model that does not support `reasoning.effort` can refuse the request. That is a regression for such override configurations, although it is the plan’s deliberate fail-closed behavior and does not affect the supported defaults.

**C7 — P3 — The postmortem overstated its strongest countermeasure. Fixed.**

The reasoning table forces a decision but cannot prove that the selected effort or budget is correct. The ranking at [docs/postmortems/260928b-a-lesson-kept-in-a-helper-does-not-reach-the-other-wire.md:98](/home/greg/code/spideryarn2/.claude/worktrees/referee-claims-long-pieces-0928/docs/postmortems/260928b-a-lesson-kept-in-a-helper-does-not-reach-the-other-wire.md:98) now says that explicitly. The postmortem otherwise names a useful class.

## Wider observations

- Both `openRouterStream` and `openRouterJson` go through `outgoing`; the table therefore controls both wires. Runtime-supplied `reasoning` is stripped before the table value is inserted.
- The tracked explicit `reasoning` bodies under `evals/` use direct HTTP intentionally. However, the pre-existing untracked `evals/scratch-claims/repro.ts` and `sibling-run.ts` pass `reasoning` through `as any`; rerunning them now silently uses the table value while labeling results with the command-line effort. I left these untracked files untouched.
- `warnIfThinkingAteTheCeiling` sees a reliable finish reason and usage after a normally drained stream. It cannot diagnose a consumer that exits before the usage frame arrives, which is expected.
- Earlier plan-review findings F4 and F7 needed the corrections above; the other six were materially implemented.

Validation: all seven focused files passed, 135 tests total; direct TypeScript checking passed all four projects; scoped lint and `git diff --check` passed. The full database suite could not run because this sandbox has no reachable Postgres and cannot start Docker. The nine fixes remain uncommitted because the sandbox makes the worktree’s shared Git index read-only; `evals/scratch-claims/` remains untouched.

ship with the fixes made