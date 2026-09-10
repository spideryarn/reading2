Verdict: I found no established third file whose Vitest pass/fail result changes under the six variables, so I do not reject the two-file conclusion. But the present sweep does not establish it repo-wide.

F1 — P1 — established: two of the six variables were never varied.

Every Vitest lane calls `loadEnvLocal()`, and the loader deliberately lets `.env.local` override inherited values ([src/env.ts](/home/greg/code/spideryarn2/.claude/worktrees/pool-env-tests/src/env.ts:103), [unit setup](/home/greg/code/spideryarn2/.claude/worktrees/pool-env-tests/tests/setup/unit-no-database.ts:125)). This checkout’s `.env.local` defines both `CODEX_API_KEY` and `OPENAI_API_KEY`.

Therefore:

- A’s intended `CODEX_API_KEY=unset` and B’s `probe-codex-key` both became the same `.env.local` value.
- A’s intended `OPENAI_API_KEY=unset` and B’s `probe-openai-key` likewise became the same value.

Concrete files include `tests/run-codex.test.ts` and `tests/live.test.ts`; neither was actually compared under unset versus B’s value.

Smallest addition: set `SPIDERYARN_ENV_PINNED` to all six names in both A and B, and include an in-worker witness that asserts the exact expected presence/value in each run. Do not trust the shell invocation alone.

F2 — P1 — established scope gap, but not an established third red.

The filter selects only direct textual hits and ends with `grep '\.test\.ts$'` ([candidates.sh](/tmp/claude-1000/-home-greg-code-spideryarn2/0c8bc732-c1dc-4675-af27-495ff3e523b6/scratchpad/candidates.sh:6)). In the current tree that is 141 candidates out of 793 `.test.ts` files, plus 194 `.test.tsx` files categorically excluded.

A concrete miss is [tests/declared-spend.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/pool-env-tests/tests/declared-spend.test.ts:22), which transitively reaches [evals/declared-spend.ts](/home/greg/code/spideryarn2/.claude/worktrees/pool-env-tests/evals/declared-spend.ts:484). Its generated rows change with `ANTHROPIC_API_KEY`: unset produces a null credential fingerprint; `sk-ant-probe` produces a fingerprint. It was outside the 141. I ran that file under both values: 24/24 passed in each, so this proves the filter miss and differing execution, not a differing Vitest answer.

Smallest addition: generate a second candidate universe from transitive imports starting at every `.test.ts` and `.test.tsx`, targeting executable reads of the six variables and child-process boundaries. The strongest evidence would simply run every test file under the corrected environment matrix.

F3 — P2 — reasoned: the all-unset/all-set pair cannot establish independence.

[sweep-ab.sh](/tmp/claude-1000/-home-greg-code-spideryarn2/0c8bc732-c1dc-4675-af27-495ff3e523b6/scratchpad/sweep-ab.sh:13) exercises two of at least 64 presence combinations. It misses:

- dependence requiring one variable to be absent while another is present;
- cancellation between two variables;
- empty-versus-absent behavior, especially `CODEX_HOME=""`;
- values rejected before the account-sensitive path is reached.

I found no concrete test exploiting one of those combinations.

Smallest useful addition: six one-hot runs and six leave-one-out runs, alongside all-unset and all-set. Exhaustive presence coverage is 64 runs; arbitrary value independence cannot be proved by a finite sweep.

F4 — P3 — established, separate `$HOME` class.

[tests/fleet-transcript.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/pool-env-tests/tests/fleet-transcript.test.ts:777) reads `$HOME/.claude/projects` and silently returns before its assertions when no transcript exceeds 2 MB. This box has such a transcript. I ran the file normally and with `HOME=/tmp/spideryarn-review-no-home`; both reported 51/51 passed, but only the normal run exercised the real-corpus assertions.

That is runner-dependent test meaning which a status-only comparison cannot detect, but it does not belong to the six-variable account-routing class: `$HOME` is a separate machine-fixture dependency.

Smallest addition: report this case as an explicit skip, or place machine-fixture tests in a separate sweep that varies `HOME`.

The load-bearing wording I would copy into the plan is:

> Among the 141 textually selected candidates, A and B had identical Vitest statuses outside the two reproduced files. This does not establish repo-wide independence. Moreover, `.env.local` made A and B identical for `CODEX_API_KEY` and `OPENAI_API_KEY`, so those two variables remain unmeasured until rerun with them pinned.

The raw comparator itself correctly found all files and the same 21 named skips; I found no duplicate full test names that its `Map` would collapse.