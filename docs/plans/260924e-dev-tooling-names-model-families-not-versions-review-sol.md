The Codex-wrapper conclusion is true after the fixes: `--model sol` follows every `model/list` page, resolves under the credential actually used, selects only a visible exact Sol family member, and has no hardcoded fallback.

The broader claim that “every dev-tooling caller names a family” is not literally true: two OpenRouter callers remain version-pinned, deliberately. That needs Greg’s decision.

I cannot inspect my resolved model ID from inside this session. I can confirm the requested alias was `sol`; the plan’s measured account list suggests `gpt-5.6-sol`, but I cannot verify that independently.

Mechanical edits are safe: `GENERATED_BY` is only validated as three nonempty strings, and no parser asserts the edited command text.

Validation:

- Typecheck passed across all 2,214 source files.
- Selection/protocol tests: 5 passed.
- Manual fallback run correctly used `gpt-8-sol` for subscription and `gpt-9-sol` for the API key.
- Related doc/changelog/fleet tests: 100 passed; one changelog suite could not start because the review sandbox forbids `spawnSync git`.
- Full `tests/run-codex.test.ts`: 59 passed, 35 sandbox failures caused by `tsx` being denied its `/tmp/*.pipe` IPC socket. The failures occur before the wrapper starts.
- Lint had no errors; only existing advisory complexity/style notices.

Findings

- **High — fixed** — [scripts/run-codex.ts:325](/home/greg/code/spideryarn2/.claude/worktrees/latest-model-aliases-0924/scripts/run-codex.ts:325): only the first `model/list` page was read, allowing an older Sol—or no Sol—to be selected while the newest was on a later page. Pagination now follows `nextCursor`, accumulates every page, and rejects repeated cursors. Red-first test: [tests/run-codex.test.ts:96](/home/greg/code/spideryarn2/.claude/worktrees/latest-model-aliases-0924/tests/run-codex.test.ts:96).

- **High — fixed** — [scripts/run-codex.ts:251](/home/greg/code/spideryarn2/.claude/worktrees/latest-model-aliases-0924/scripts/run-codex.ts:251): `child.kill()` killed only the immediate app-server and resolved before it was reaped, potentially leaving descendants behind. It now creates a detached process group, kills the group, and resolves only on `close`. Using `close` also removes the `exit`/last-stdout-chunk race. Red-first process-leak test: [tests/run-codex.test.ts:127](/home/greg/code/spideryarn2/.claude/worktrees/latest-model-aliases-0924/tests/run-codex.test.ts:127).

- **High — fixed** — [scripts/run-codex.ts:688](/home/greg/code/spideryarn2/.claude/worktrees/latest-model-aliases-0924/scripts/run-codex.ts:688): subscription-first resolved once under the subscription, then reused that ID after falling back to `CODEX_API_KEY`, whose offered list may differ. Each credential actually spent now resolves independently and lazily. Test: [tests/run-codex.test.ts:936](/home/greg/code/spideryarn2/.claude/worktrees/latest-model-aliases-0924/tests/run-codex.test.ts:936).

- **Medium — fixed** — [scripts/run-codex.ts:309](/home/greg/code/spideryarn2/.claude/worktrees/latest-model-aliases-0924/scripts/run-codex.ts:309): an initialization error was treated like success; the wrapper sent `initialized` and `model/list` and could return a model afterward. Initialization refusal is now terminal. Red-first test: [tests/run-codex.test.ts:113](/home/greg/code/spideryarn2/.claude/worktrees/latest-model-aliases-0924/tests/run-codex.test.ts:113).

- **Medium — not fixed; wider decision** — [tools/fleet/describe.ts:51](/home/greg/code/spideryarn2/.claude/worktrees/latest-model-aliases-0924/tools/fleet/describe.ts:51), [tools/overseer/attention-classify.ts:73](/home/greg/code/spideryarn2/.claude/worktrees/latest-model-aliases-0924/tools/overseer/attention-classify.ts:73): these are genuine dev-tooling model callers and still pin `openai/gpt-5.6-luna`. They deliberately mirror the product constant, so changing them alone would split the drift alarm; nevertheless, they make the unqualified “every dev-tooling caller names a family” conclusion false.