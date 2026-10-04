No established P0 or P1. Three nonblocking findings:

- **F1 — P2, established: the checker report silently changes its historical population.** [scripts/simple-check-report.ts:89](/home/greg/code/spideryarn2/.claude/worktrees/remove-simple-summary-level/scripts/simple-check-report.ts:89) iterates `SIMPLE_LEVELS` over old records. Narrowing that list drops their Simple-level flags and retries, while the ledger section still counts all historical calls. For example, `high-none-fbazc2/entropy-24-00930-spya-pywwkq.json` records a Simple retry that disappears from this tally. Explicitly label the report as covering Brief and Fuller, or preserve historical outcomes in its accounting.

- **F2 — P2, established: another pinned assertion survives the typecheck.** [tests/store-export-bundle.test.ts:532](/home/greg/code/spideryarn2/.claude/worktrees/remove-simple-summary-level/tests/store-export-bundle.test.ts:532) requires the HTML count row that §4 removes. Add its update to the plan explicitly. Keep the adjacent whole-JSON export assertions, including an old three-level fixture; those protect preservation of the removed text.

- **F3 — P2, established: dropping the probe fields also requires updating its consumers.** [evals/simple/probe.ts:249](/home/greg/code/spideryarn2/.claude/worktrees/remove-simple-summary-level/evals/simple/probe.ts:249) would print `undefined paragraphs, undefined words`. Its report also emits a `**simple**` heading whenever Fuller exists ([line 312](/home/greg/code/spideryarn2/.claude/worktrees/remove-simple-summary-level/evals/simple/probe.ts:312)). Neither problem is caught by narrowing `SimpleLevel`. Print Brief/Fuller counts for new runs and condition historical Simple output on `paragraphs` being present.

The main compatibility argument holds:

- Old rows, including three-key `check.levels`, pass the narrowed guards; new rows pass with two keys. The owner returns stored JSON whole, and the proposed public projection selects only Brief and Fuller.
- Keeping `simple/2` and `simple-prompt/7` preserves freshness comparisons. The probe’s aggregate `systemsSha256` **will change**, because its hashed object loses a key; that is distinct from either retained prompt changing.
- The writer’s result positions come from the same `SIMPLE_LEVELS.map` throughout. Stream-start fallback, cancellation, retries, and draining siblings do not require two waiters.
- Shared inventories use the common guard. Generated command catalogues already describe Brief, Fuller, and Thread. The store-migration witness records test-file classifications, not summary-level keys.

I changed no source or documentation. During review, another process began implementation. The requested test run encountered that partial edit and returned **53 passed, 64 failed**, so it is not evidence about the untouched base. Remaining source checks used `1698c6448`.

**Verdict: approve.**