Implemented all ten scoped Messages-wire migrations. No prompt text changed, no reviewer dispatched, and no state-changing Git commands or commits were made.

### Files changed

Schema/request migrations:

- `src/arc.ts`, `src/tweets.ts`, `src/glossary.ts`
- `src/timeline.ts`, `src/quiz.ts`, `src/faq.ts`
- `src/crossrefs.ts`, `src/simple-summary.ts`
- `src/citations.ts`, `src/illustrated.ts`
- `src/illustrated-plate.ts` for the Illustrated version stamp
- `src/pipeline.ts` for `ARTICLE_OUTPUT_FORMAT`
- `src/models.ts` for now-stale cache-group commentary

Tests:

- `tests/article-cache-output-format.test.ts`
- `tests/article-cache-group.test.ts`
- `tests/simple-summary.test.ts`
- `tests/citations.test.ts`
- `tests/illustrated-run.test.ts`
- `tests/tweets.test.ts`, `tests/quiz.test.ts`, `tests/faq.test.ts`

Each schema is validated at module load. Block-id assertions name:

- Tweets: `blocks`
- Timeline, Quiz, FAQ: `blockId`
- Cross-references: `from`, `to`
- Simple: `ids`
- Citations and Illustrated: `block`
- Arc and Glossary: no block-id fields

Tweets retains legacy string rows through `anyOf`. Simple applies its schema inside `askLevel`, covering every initial call and retry.

### Red evidence

Before implementation:

```text
Test Files  4 failed (4)
     Tests  12 failed | 172 passed (184)
```

The failures covered Arc, Tweets, Glossary, Timeline, Quiz, FAQ, Crossrefs, Simple, Citations, and Illustrated. The common assertion was:

```text
AssertionError: expected undefined to match object { type: 'json_schema' }
```

Simple additionally failed both its three-level request test and retry test, proving retries lacked the schema too.

### Cache groups

No two distinct `ArticleStage` requests now have byte-identical cache identity.

- The former `ids/high` group is completely dissolved: Ideas, Tweets, Timeline, Quiz, FAQ, and Simple all have different schemas.
- Glossary and Quotes no longer share `text/medium`.
- Arc remains alone at `text/high`.
- Cross-references remains alone at `ids/medium`.
- Sketch remains alone at `ids/low`.

`tests/article-cache-group.test.ts` now proves there are zero distinct same-group pairs.

### Prompt/parser disagreements

No genuine disagreement was left unresolved.

Parsers retain their existing tolerant salvage paths, but schemas follow fields the prompts explicitly require. The deliberate exception is Tweets’ legacy string row, preserved as requested. All post-parse ID, quote, score, date, ordering, and numeric checks remain unchanged.

### Gates

Focused final Vitest command, including touched tests, stage tests, article-cache unit tests, and doc links:

```text
Test Files  20 passed (20)
     Tests  619 passed (619)
```

A wider stage sweep produced:

```text
Test Files  1 failed | 37 passed (38)
     Tests  1 failed | 882 passed (883)
```

Its only failure was sandbox-related and outside these changes:

```text
Error: spawnSync git EPERM
```

Normal typecheck was blocked by sandbox IPC:

```text
Error: listen EPERM: operation not permitted /tmp/tsx-1000/14.pipe
```

Fallback:

```text
npx tsc --noEmit --pretty false
```

completed with exit 0 and no output.

The database-backed `tests/article-cache-call-site.test.ts` could not start:

```text
Error: No database, and every test that touches the store needs one.

could not ask Docker which container serves port 54362
```

Lint on all touched source files completed with only existing complexity diagnostics and one unrelated pipeline optional-chain warning. Lint on all touched test files was clean:

```text
Checked 8 files in 2s. No fixes applied.
```

`git diff --check` is clean.

### Cheap validity evals Claude could run

No paid evals were run here.

- `evals/plain-words/artefacts.ts generate --only ...` can exercise Arc, Tweets, Citations, Quiz, FAQ, Timeline, and Illustrated on one article; Illustrated stubs image drawing.
- `evals/plain-words/run.ts generate ... <one-slug>` can cheaply exercise Glossary.
- `evals/simple/probe.ts run --guard off ... <one-slug>` exercises Simple’s three writer calls without the checker.
- Cross-references has no dedicated model-quality/validity evaluator.