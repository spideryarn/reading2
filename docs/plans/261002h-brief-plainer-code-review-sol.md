## Findings

- **P0 — None.**
- **P1 — None.**
- **P2 — Fixed redundant activation.** [SummaryMode.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb9p-summary-writes-every-level/src/web/modes/summary/SummaryMode.tsx:334) minted tokens on both first movement and pointer-up. It now arms exactly once; the test verifies the nonce survives pointer-up and click unchanged.
- **P2 — Fixed potentially unbalanced blind sets.** [brief-plain.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb9p-summary-writes-every-level/evals/simple/brief-plain.ts:153) silently omitted unavailable runs and could claim exact balance for an odd set. It now rejects missing, failed, or odd inputs and reports both test and control balance.
- **P2 — Fixed stale documentation.** [simple-summary.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb9p-summary-writes-every-level/src/simple-summary.ts:45) still described claimed expertise as affecting every level; it now records Brief’s exception.

Additional checks:

- Printed all three prompts; they are coherent and constant per level.
- Simple and Fuller are byte-identical to `HEAD` except for the intended shape line.
- Prompt-version propagation and caching are correct.
- Generated pairs contain no key metadata; existing sides are exactly 10/20 new-on-X and 5/10 control-b2-on-X.
- All 40 recorded runs succeeded. No database or paid eval was run.

Gates:

- Focused Vitest: **2 files, 115 tests passed**.
- `npm run typecheck`: wrapper blocked by sandbox `tsx` IPC (`EPERM`); the identical script via `node --import tsx scripts/typecheck.ts` passed all four projects and covered all 2,745 source files.
- Focused lint and `git diff --check`: passed.

**Verdict: Ready after fixes; no wider decision required.**