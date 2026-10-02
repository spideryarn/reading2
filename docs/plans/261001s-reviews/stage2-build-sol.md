Implemented Stage 2: production Structure is now `toc/11`, starts-only, schema-constrained, converted through the shared starts-to-ranges path, and measured by updated validity and quality harnesses. No commits or state-changing git commands were used.

## Files changed

Production:

- [src/hierarchy.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/structure.ts) — exact `toc/10` prompt retained; `toc/11` wording and three-level schema; request attachment; starts-only parsing/conversion; checkpoint validation.
- [src/hierarchy-prompt.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/structure-prompt.ts) — `PROMPT_VERSION = "toc/11"` and history.
- [src/hierarchy-starts.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/structure-starts.ts) — updated converter ownership comment.

Eval plumbing:

- [toc10-frozen.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/evals/structure-whole-document/toc10-frozen.ts) — byte-pinned ranged `toc/10` request/parser.
- [arms.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/evals/structure-whole-document/arms.ts) — `toc10-frozen` and `toc11-think-first`.
- [model-arms.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/evals/structure-whole-document/model-arms.ts) — schema forwarding and production parse/converter use.
- [run.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/evals/structure-whole-document/run.ts) — per-cell `collectSpend`.
- [structure-parse.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/evals/paperwork/structure-parse.ts) — per-draw spend, build/drop/depth/refusal fields, every raw answer retained, per-article tally.
- [run.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/evals/paperwork/run.ts), [plain-words/run.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/evals/plain-words/run.ts), [structure-starts-replay.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/evals/paperwork/structure-starts-replay.ts), and [spike-book-structure.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/scripts/spike-book-structure.ts) — production parser/converter or explicit frozen parser.
- [hierarchy-panel.sh](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/evals/thinking-effort/structure-panel.sh), [lineup.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/evals/thinking-effort/lineup.ts), [make-judge-prompts.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/evals/thinking-effort/make-judge-prompts.ts), [judge-rank.md](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/evals/thinking-effort/judge-rank.md), and [tally.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/evals/thinking-effort/tally.ts) — one complete quality run, four blind aliases, both judges, same-effort tally semantics.

Tests:

- Added [hierarchy-structure-toc11.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/tests/structure-whole-document-toc11.test.ts) and [paperwork-structure-parse.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/tests/paperwork-structure-parse.test.ts).
- Updated parity, checkpoint, prompt/digest, expansion stamp, eval, deepening, write-guard, and thinking-effort tests.

The think-first arm uses the allowed fallback wording, `"Think the problem through before you answer."`, because network access was unavailable.

I left the unrelated untracked review/probe files untouched.

## Red-first evidence

Observed red before implementation for:

- Schema validation and no-ID-enum assertion.
- Schema plus `effort: "low"` on `structureRequest`.
- Starts-only parsing/building.
- Invented-start refusal.
- Frozen `toc/10` request.
- Structure validity row fields.

Initial result:

```text
Test Files 3 failed (3)
Tests 6 failed (6)
```

The moved prompt pins also went red before repinning: `PROMPT_VERSION`, expansion stamp, request digest, and ranged eval fixtures.

One exception: the new `toc/10` checkpoint-miss test was written after the production change, so I did not observe that test red. It passes, but I am not presenting it as red-first evidence.

## Gates

Normal typecheck was blocked by the sandbox exactly as follows:

```text
> spideryarn@1.0.0 typecheck
> tsx scripts/typecheck.ts

Error: listen EPERM: operation not permitted /tmp/tsx-1000/14.pipe
...
Node.js v26.8.1
```

The prescribed fallback passed:

```text
✓ src/web/tsconfig.json  (425 files)
✓ tests/tsconfig.json  (2519 files)
✓ tools/fleet/web/tsconfig.json  (104 files)
✓ tsconfig.json  (809 files)
✓ all 2637 source files are covered by some project
```

Focused final tests:

```text
Test Files  6 passed (6)
Tests  30 passed (30)
```

Requested broad suite:

```text
Test Files  1 failed | 22 passed (23)
Tests  1 failed | 513 passed (514)
```

The only failure was unavailable gitignored corpus data:

```text
Error: ENOENT: no such file or directory, open
'evals/results/thinking-effort-smoke/corpus/cargocult-spya-rz663q/blocks.json'
```

The new hierarchy alias test in that file passes independently.

An additional plain-words run found one sandbox-only failure:

```text
Error: spawnSync git EPERM
```

Biome exited 0 with informational complexity/style advisories and no errors. `git diff --check` passed.

No paid calls, Postgres-dependent corpus export, or quality judging were run.

## Commands for Claude

Validity arm:

```bash
npx tsx evals/paperwork/structure-parse.ts \
  --label toc11-validity-analog --draws 40 \
  analog-cognition-and-consciousness-4-28-26-spya-f03kqf

npx tsx evals/paperwork/structure-parse.ts \
  --label toc11-validity-other --draws 10 \
  entropy-24-00930-spya-pywwkq \
  scaling-hypothesis \
  source-spya-f550ta

npx tsx evals/paperwork/structure-parse.ts tally
```

Quality panel, including the currently missing corpus export:

```bash
npx tsx evals/thinking-effort/run.ts \
  --export-only \
  --out evals/results/thinking-effort-261001

bash evals/thinking-effort/hierarchy-panel.sh
```

After the tmux log ends with `EXIT=0`, set `RUN` to its newly produced `evals/results/hierarchy-structure/<timestamp>-toc10-frozen+incumbent` directory:

```bash
RESULTS=evals/results/thinking-effort-261001
RUN=evals/results/hierarchy-structure/<timestamp>-toc10-frozen+incumbent

npx tsx evals/thinking-effort/lineup.ts \
  --results "$RESULTS" --mode hierarchy --hierarchy-run "$RUN"

npx tsx evals/thinking-effort/make-judge-prompts.ts \
  --results "$RESULTS" --mode hierarchy
```

Sol ranking judge:

```bash
npx tsx scripts/run-codex.ts \
  --model sol --effort high --timeout-minutes 90 --sandbox review \
  --prompt-file "$RESULTS/judging/hierarchy/prompt-rank.md" \
  --output "$RESULTS/judging/hierarchy/verdict-rank.json"
```

Opus scoring judge:

```bash
npx tsx scripts/run-claude.ts \
  --model opus --effort high --access write --timeout-minutes 90 \
  --prompt-file "$RESULTS/judging/hierarchy/prompt-score.md" \
  --output "$RESULTS/judging/hierarchy/score-judge-report.md"
```

The Opus prompt writes `verdict-score.json` itself. Then:

```bash
npx tsx evals/thinking-effort/tally.ts \
  --results "$RESULTS" --mode hierarchy --hierarchy-run "$RUN"
```

The lineup path is owned by `lineup.ts`; judging prompts by `make-judge-prompts.ts`, `judge-rank.md`, and `judge-score.md`; unblinding and U calculation by `tally.ts`.

## Stage-1 replay overrule

I agree with the overrule. The three differences were already-invalid, contradictory book answers. Keeping a chapter titled and summarised for blocks 49–82 but attaching it to blocks 927–2045 is silent semantic corruption; dropping the impossible child is more honest and matches the established expansion normaliser.

The challenge is sampling: every replay disagreement occurred on works above 2,000 blocks, while Stage 2’s paid validity set does not directly target that class. I would retain the overrule, but treat the zero-dropped-children gate as essential and consider a future book-scale validity draw if the paid results otherwise pass.