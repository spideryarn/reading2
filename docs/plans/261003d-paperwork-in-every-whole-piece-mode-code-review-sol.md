No P0 findings. I found two P1s and one P2; all are fixed.

### Findings

- **P1 — Arc’s final `part` wording contradicted its own carve-out.**  
  The new wording categorically banned “sources, data, thanks, funding…” even when those subjects are genuine evidence, methods, or content—the exact exception stated later in `paperwork()`. I changed it to exclude passages “in their paperwork role” and facts they merely record. This now agrees with Arc’s relational, no-title, first/last-part rules.  
  Fixed in [src/paperwork.ts:56](/home/greg/code/spideryarn2/.claude/worktrees/fbk930hy-paperwork-all-modes/src/paperwork.ts:56); the shared exception is at [src/paperwork.ts:108](/home/greg/code/spideryarn2/.claude/worktrees/fbk930hy-paperwork-all-modes/src/paperwork.ts:108).

- **P1 — Parts of the ledger were stronger than the saved evidence.**  
  The committed results support the reported malformed Arc output, baseline leaks, concurrent-run failures, clean third run, source/data boundary examples, and balanced blind keys. They do **not** contain the targeted-repeat raw outputs or blind judges’ answer sheets. Consequently:
  
  - The precise targeted-repeat counts cannot be independently reproduced from the directory.
  - The blind preferences cannot be checked by unblinding the saved keys.
  - “Load, not the prompt” was causal language unsupported by one clean rerun; ordinary variance remains possible.
  - “No quality effect either way” was too strong for twelve pairs, especially without saved judgments.
  - “Same prompt hashes” was only true for the nine mode sources; `paperwork.ts` differed between the two baselines, although neither baseline prompt called it.
  
  I corrected and qualified these claims in [the ledger:174](/home/greg/code/spideryarn2/.claude/worktrees/fbk930hy-paperwork-all-modes/docs/plans/261003d-paperwork-in-every-whole-piece-mode.md:174), [the Arc entry:203](/home/greg/code/spideryarn2/.claude/worktrees/fbk930hy-paperwork-all-modes/docs/plans/261003d-paperwork-in-every-whole-piece-mode.md:203), and [the blind-read conclusions:228](/home/greg/code/spideryarn2/.claude/worktrees/fbk930hy-paperwork-all-modes/docs/plans/261003d-paperwork-in-every-whole-piece-mode.md:228).

- **P2 — The coverage claim was inaccurate, and the test did not pin kinds.**  
  Reconstructing the parent with the final exemption list leaves **ten** uncovered files: the nine measured modes plus Debate, not exactly nine. The original test could genuinely go red when a target file lacked `paperwork()`, but its synthetic “would reject” case tested only file-level AST detection—not whether the call reached the production system prompt. It also allowed a wrong kind.
  
  I documented the ten-file result at [the plan:83](/home/greg/code/spideryarn2/.claude/worktrees/fbk930hy-paperwork-all-modes/docs/plans/261003d-paperwork-in-every-whole-piece-mode.md:83), added an explicit ten-file kind map, and now assert exactly one correctly typed call per changed prompt at [tests/paperwork-coverage.test.ts:59](/home/greg/code/spideryarn2/.claude/worktrees/fbk930hy-paperwork-all-modes/tests/paperwork-coverage.test.ts:59) and [tests/paperwork-coverage.test.ts:91](/home/greg/code/spideryarn2/.claude/worktrees/fbk930hy-paperwork-all-modes/tests/paperwork-coverage.test.ts:91). I also renamed the synthetic test to state its actual claim.

### Verified

- All ten production system prompts receive `paperwork(kind)` exactly once:
  - `summary`: Sketch, Illustrated
  - `pick`: FAQ, Quiz, Ideas, Quotes, Glossary, Timeline, Debate
  - `part`: Arc
- Sketch’s apparatus rule, Illustrated’s per-node exception, Timeline’s own-date rule, Glossary’s title/author rule, and Quiz’s title rule are compatible with the shared rule.
- Dropping Arc’s label version was sound: labels conflict with “no part titles” and relational descriptions, and the committed malformed output demonstrates the extra-sentence failure. The exact repeat rates remain run notes rather than auditable saved evidence.
- All ten prompt-version constants were bumped. Quiz and Debate pinned literals moved. No stale fixture or client comparison was missed.
- Known consequences are accounted for:
  - opening stale Arc as an owner can trigger a paid regeneration;
  - Illustrated’s prompt version participates in its input fingerprint;
  - Quote links can become stale;
  - Debate regeneration performs paid searches.
- Every `PAPERWORK_EXEMPT` entry is justified by its prompt’s job: citations, interactive/user-selected modes, grading, cross-reference linking/fingerprinting, and referee inputs or criteria are not whole-piece content-selection prompts.
- I corrected the harness’s stale description of its mode-specific anchors at [evals/paperwork/modes.ts:18](/home/greg/code/spideryarn2/.claude/worktrees/fbk930hy-paperwork-all-modes/evals/paperwork/modes.ts:18).

Checks: 126 targeted tests passed. All four TypeScript projects typechecked directly; the wrapper itself was blocked by sandbox-denied `tsx` IPC creation. Biome reported no errors, only the existing complexity advisory for the harness reporter.

**Verdict: approve after the applied fixes; prompt wiring and stamps are sound, while the ledger now states the limits of its evidence honestly.**