The “no production change” conclusion is supported, but I found and fixed four material measurement/safety issues plus two smaller ones.

- C1 — P1: The local-only guard trusted any loopback hostname, including an SSH tunnel to production or another local stack. Evidence: original `scripts/eval-pdf-chunk-size.ts:47-53`. Fixed by comparing `DATABASE_URL` with this repo’s independently reported Supabase endpoint before connecting: [eval-pdf-chunk-size.ts](/var/tmp/spideryarn-worktrees/fbz3uz86-pdf-shard-concurrency/scripts/eval-pdf-chunk-size.ts:55).

- C2 — P1: `firstWaveDoneMs` included every initial ask, so Kuhn’s 38 second-wave chunks were counted as part of the first wave. Fixed to use only the first `CHUNK_CONCURRENCY` asks and corrected the three derived raw-result fields: [eval-pdf-chunk-size.ts](/var/tmp/spideryarn-worktrees/fbz3uz86-pdf-shard-concurrency/scripts/eval-pdf-chunk-size.ts:214).

- C3 — P1: On a planned one-page chunk, an ordinary re-ask and page recovery send an identical instruction. Thus Kuhn-half’s “0 pages recovered” did not prove recovery was unused. Fixed by recording `ambiguousSinglePageRepeats`—19, 21, and 23—and narrowing the table’s recovery claim: [eval-pdf-chunk-size.ts](/var/tmp/spideryarn-worktrees/fbz3uz86-pdf-shard-concurrency/scripts/eval-pdf-chunk-size.ts:220), [investigation](/var/tmp/spideryarn-worktrees/fbz3uz86-pdf-shard-concurrency/docs/investigations/261011c-pdf-chunk-size-and-extract-speed.md:109).

- C4 — P1: Stage 1 treated equal input-token counts as chunk identity, although unrelated calls can collide, and its simulation allowed every split chunk to run concurrently even beyond width 100. The resulting 0.54–0.63× prediction was too strong. Fixed by explicitly treating it as an optimistic screening heuristic in the scripts, investigation, and plan log: [analyse.py](/var/tmp/spideryarn-worktrees/fbz3uz86-pdf-shard-concurrency/evals/results/pdf-chunk-size-2026-10-11/stage1/analyse.py:73), [investigation](/var/tmp/spideryarn-worktrees/fbz3uz86-pdf-shard-concurrency/docs/investigations/261011c-pdf-chunk-size-and-extract-speed.md:58).

- C5 — P2: The write-up implied smaller chunks failed more often. On Doctorow the rate barely changed: 33/43 versus 70.5/88; doubling chunks doubled total repeat calls. Fixed the causal explanation: [investigation](/var/tmp/spideryarn-worktrees/fbz3uz86-pdf-shard-concurrency/docs/investigations/261011c-pdf-chunk-size-and-extract-speed.md:25).

- C6 — P2: Invalid bounds such as `--max-pages NaN` or zero could start a paid, mislabeled run. Fixed with positive-integer validation before reading the PDF or calling a model: [eval-pdf-chunk-size.ts](/var/tmp/spideryarn-worktrees/fbz3uz86-pdf-shard-concurrency/scripts/eval-pdf-chunk-size.ts:103).

- C7 — P2, wider, not fixed: the concurrently added, untracked `docs/user-feedback/261011_0142-more-pdf-shards-would-not-be-faster.md:4` repeats C5’s causal overclaim. It is outside commit `5411a9381`.

Independent recomputation confirmed the reported wall-clock medians, repeat/recovery medians, recall ranges, spend medians, and $3.1745 ledger total. The ledger sum is correct. Production never passes `chunking`; omitted options retain the constants. Checkpoint keys remain safe because they include the resulting pages and context.

Verification:

- 78 relevant tests passed, plus 18 doc-link tests.
- Typecheck passed across all 3,708 source files.
- `no-undeclared-spend` could not collect because this sandbox forbids its `spawnSync git` with `EPERM`.
- No paid script ran; no database was reached.
- Fixes are in the working tree. Commit creation was blocked because the worktree Git administrative directory is read-only.

land after fixes (made)