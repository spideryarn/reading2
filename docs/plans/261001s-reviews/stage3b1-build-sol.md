Implemented and locally verified, but the required Opus review and paid evaluations remain outstanding because this sandbox could not reach Anthropic’s API.

### What changed

- Cache compatibility now includes the exact `output_config.format` alongside effort and renderer in [pipeline.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/pipeline.ts:336). The table references each stage’s exported schema constant, so schema adoption cannot be omitted from cache identity.
- Cache groups dissolved:
  - Ideas left `ids/high`; the remaining group is Tweets, Timeline, Quiz, FAQ, and Simple.
  - Quotes no longer shares `text/medium` with Glossary.
  - Sketch remains the sole `ids/low` member.
- Ideas, Sketch, and Quotes now have validated module-load schemas and use `withMessagesJsonSchema`:
  - [ideas.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/ideas.ts:880): `blockId` checked; `ideas/4`.
  - [sketch.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/sketch.ts:578): five-way `anyOf`; `block` checked; `sketch/4`.
  - [quotes.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/quotes.ts:1549): no block-id fields; `quotes/8`.
- Sketch has 18 optional parameters, one union-bearing parameter with five alternatives: below the 24/16 limits.
- Existing refusal/truncation ordering and post-parse id, quote, bounds, coordinate, and path validation remain unchanged.
- Ideas’ prompt changed only where it contradicted its parser: assumed ideas require `whyYouNeedIt`, and assumed occurrences require `reasoning`.
- Added Sketch `no-schema-a/b` arms. The byte pin proves the frozen request differs only by `output_config.format`.
- The thinking-effort harness now verifies Ideas and production Sketch actually send `json_schema`.
- Quotes evaluation now records and prints `validity: { valid, attempted }`.

### Red-first evidence

- Initial cache/request tests: 4 files failed, 9 failed / 54 passed. Failures were missing format identity and missing schemas.
- Sketch frozen-arm byte pin: 1 failed / 6 passed before the omission seam existed.
- Final focused gate:

```text
Test Files  15 passed (15)
Tests       485 passed (485)
Duration    20.39s
```

- Typecheck fallback:

```text
✓ src/web/tsconfig.json  (429 files)
✓ tests/tsconfig.json  (2530 files)
✓ tools/fleet/web/tsconfig.json  (104 files)
✓ tsconfig.json  (809 files)
✓ all 2648 source files are covered by some project
```

`npm run typecheck` itself could not create `/tmp/tsx-1000/*.pipe`; `node --import tsx scripts/typecheck.ts` passed.

Biome completed without errors; only existing complexity diagnostics and an unrelated optional-chain warning remain. `git diff --check` is clean.

`npm test` and `tests/article-cache-call-site.test.ts` could not start the private lane because this sandbox cannot connect to Postgres at `127.0.0.1:54362`. The separate stop-details subprocess test also hits the `tsx` IPC restriction.

No commits or state-changing git commands were made. No `src/hierarchy*.ts` file was touched.

### Required Opus review

The wrapper reached Claude Code but exhausted ten API retries with `EAI_AGAIN`; zero model tokens and $0 were used. The prepared review prompt is `/tmp/spideryarn-stage3b1-opus-review.md`. Retry with:

```bash
node --import tsx scripts/run-claude.ts \
  --model opus --effort high --access review \
  --allow 'Bash(npx vitest run:*)' \
  --prompt-file /tmp/spideryarn-stage3b1-opus-review.md \
  --output /tmp/spideryarn-stage3b1-opus-answer.md \
  --timeout-minutes 45
```

### Paid evaluation commands

Ideas—one six-draw-family run, followed by separate high/medium and high/low panels:

```bash
IDEAS_RESULTS=evals/results/thinking-effort-261001s-ideas-schema

npx tsx evals/thinking-effort/run.ts \
  --mode ideas \
  --arm base-a --arm base-b \
  --arm medium-a --arm medium-b \
  --arm low-a --arm low-b \
  --out "$IDEAS_RESULTS"

npx tsx evals/thinking-effort/lineup.ts \
  --results "$IDEAS_RESULTS" --mode ideas \
  --arms base-a,base-b,medium-a,medium-b
npx tsx evals/thinking-effort/make-judge-prompts.ts \
  --results "$IDEAS_RESULTS" --mode ideas
npx tsx scripts/run-codex.ts \
  --model sol --effort high --timeout-minutes 90 --sandbox review \
  --prompt-file "$IDEAS_RESULTS/judging/ideas/prompt-rank.md" \
  --output "$IDEAS_RESULTS/judging/ideas/verdict-rank.json"
npx tsx scripts/run-claude.ts \
  --model opus --effort high --access write --timeout-minutes 90 \
  --prompt-file "$IDEAS_RESULTS/judging/ideas/prompt-score.md" \
  --output "$IDEAS_RESULTS/judging/ideas/score-judge-report.md"
npx tsx evals/thinking-effort/tally.ts \
  --results "$IDEAS_RESULTS" --mode ideas
mv "$IDEAS_RESULTS/judging/ideas" \
  "$IDEAS_RESULTS/judging/ideas-high-v-medium"

npx tsx evals/thinking-effort/lineup.ts \
  --results "$IDEAS_RESULTS" --mode ideas \
  --arms base-a,base-b,low-a,low-b
npx tsx evals/thinking-effort/make-judge-prompts.ts \
  --results "$IDEAS_RESULTS" --mode ideas
npx tsx scripts/run-codex.ts \
  --model sol --effort high --timeout-minutes 90 --sandbox review \
  --prompt-file "$IDEAS_RESULTS/judging/ideas/prompt-rank.md" \
  --output "$IDEAS_RESULTS/judging/ideas/verdict-rank.json"
npx tsx scripts/run-claude.ts \
  --model opus --effort high --access write --timeout-minutes 90 \
  --prompt-file "$IDEAS_RESULTS/judging/ideas/prompt-score.md" \
  --output "$IDEAS_RESULTS/judging/ideas/score-judge-report.md"
npx tsx evals/thinking-effort/tally.ts \
  --results "$IDEAS_RESULTS" --mode ideas
mv "$IDEAS_RESULTS/judging/ideas" \
  "$IDEAS_RESULTS/judging/ideas-high-v-low"
```

Sketch—same production effort, schema versus frozen no-schema request:

```bash
SKETCH_RESULTS=evals/results/thinking-effort-261001s-sketch-schema

npx tsx evals/thinking-effort/run.ts \
  --mode sketch \
  --arm base-a --arm base-b \
  --arm no-schema-a --arm no-schema-b \
  --out "$SKETCH_RESULTS"

npx tsx evals/thinking-effort/lineup.ts \
  --results "$SKETCH_RESULTS" --mode sketch \
  --arms base-a,base-b,no-schema-a,no-schema-b
npx tsx evals/thinking-effort/make-judge-prompts.ts \
  --results "$SKETCH_RESULTS" --mode sketch
npx tsx scripts/run-codex.ts \
  --model sol --effort high --timeout-minutes 90 --sandbox review \
  --prompt-file "$SKETCH_RESULTS/judging/sketch/prompt-rank.md" \
  --output "$SKETCH_RESULTS/judging/sketch/verdict-rank.json"
npx tsx scripts/run-claude.ts \
  --model opus --effort high --access write --timeout-minutes 90 \
  --prompt-file "$SKETCH_RESULTS/judging/sketch/prompt-score.md" \
  --output "$SKETCH_RESULTS/judging/sketch/score-judge-report.md"
npx tsx evals/thinking-effort/tally.ts \
  --results "$SKETCH_RESULTS" --mode sketch
```

Quotes:

```bash
npx tsx scripts/eval/quotes-spread-eval.ts --runs=2
```

Quotes validity is currently unmeasured: zero provider calls were attempted. With the default three articles, two runs, and two arms, the evaluator will report an exact count out of 12 and exit non-zero unless all 12 produce valid Quotes artefacts.