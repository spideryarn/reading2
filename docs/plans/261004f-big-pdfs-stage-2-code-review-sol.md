No P0 or P1 findings. I made no changes; the worktree remains clean.

### Findings

- **F9 — P2 — Reasoned — report only:** A provider-side size refusal below the unmeasured 40 MiB allowance becomes a generic retryable error. [`pdf-read.ts:1145`](/home/greg/code/spideryarn2/.claude/worktrees/fbbac46a-big-pdfs-up-to-our-limits/src/pdf-read.ts:1145) converts HTTP 413/400 into a plain `Error`, so an identical retry is offered. The behavior is established; whether OpenRouter actually refuses below 40 MiB is not.

- **F10 — P2 — Established mechanism, reasoned consequence — report only:** Harness cleanup can forget unfinished cleanup. [`eval-big-imports.ts:456`](/home/greg/code/spideryarn2/.claude/worktrees/fbbac46a-big-pdfs-up-to-our-limits/scripts/eval-big-imports.ts:456) drains the tracking list before deletion succeeds; [`eval-big-imports.ts:607`](/home/greg/code/spideryarn2/.claude/worktrees/fbbac46a-big-pdfs-up-to-our-limits/scripts/eval-big-imports.ts:607) removes a record even after cleanup failure; and [`eval-big-imports.ts:1454`](/home/greg/code/spideryarn2/.claude/worktrees/fbbac46a-big-pdfs-up-to-our-limits/scripts/eval-big-imports.ts:1454) can race active work on `SIGINT`. This can leave local evaluation rows, although the normal path queues no paid successor and the recorded run left zero rows. Fixing this properly needs a process/database lifecycle test unavailable here.

- **F11 — P2 — Established, wider/pre-existing — report only:** Single-page recovery uses context-free requests at [`pdf-read.ts:3136`](/home/greg/code/spideryarn2/.claude/worktrees/fbbac46a-big-pdfs-up-to-our-limits/src/pdf-read.ts:3136), then caches the aggregate under the original context-bearing key at [`pdf-read.ts:3423`](/home/greg/code/spideryarn2/.claude/worktrees/fbbac46a-big-pdfs-up-to-our-limits/src/pdf-read.ts:3423). [`pdf-integrity.test.ts:142`](/home/greg/code/spideryarn2/.claude/worktrees/fbbac46a-big-pdfs-up-to-our-limits/tests/pdf-integrity.test.ts:142) confirms reuse. This predates stage 2; the new oversized-context path itself correctly changes keys.

The production batching is sound: generated/default columns make batch sizes conservative, empty and boundary cases work, ordinals are assigned before slicing, deletion remains unconditional, and the transaction is preserved. The context-dropped PDF chunk consistently drives its instruction, retry, scoring, coverage, fold, seam behavior, and replacement checkpoint lookup. No production caller injects `wire.ask`. `encodedBytes` matched actual base64 lengths for byte counts 0–100,000.

Validation:

- Requested suites: 3 files, 26 tests passed.
- Additional PDF/doc suites: 4 files, 78 tests passed.
- `no-undeclared-spend` could not start because this sandbox rejects its `spawnSync git` call with `EPERM`.
- The supplied Postgres and typecheck results remain the available evidence for those checks.

VERDICT: SHIP