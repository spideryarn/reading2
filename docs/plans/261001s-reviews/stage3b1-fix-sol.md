Implemented exactly R1 and R2; no commits or state-changing git commands.

Files changed:

- [src/ideas.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/ideas.ts:105)
- [tests/ideas.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/tests/ideas.test.ts:122)
- [tests/article-cache-output-format.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/tests/article-cache-output-format.test.ts:61)

R1:

- Restored Ideas’ prompt bytes exactly; comparison against `HEAD` produced no diff.
- `ideas/4` now says the request gained a schema and the prompt is unchanged.
- One idea schema, no provenance `anyOf`.
- `provenance` is a string enum.
- `whyYouNeedIt` and `analogy` remain optional.
- Every occurrence requires `reasoning`.
- Re-checked Sketch and Quotes against the same rule; both are consistent and remain untouched.

R2:

- Added an exhaustive test that drives every `ArticleStage` through its real generator request seam.
- Every emitted `body.output_config?.format ?? null` is compared with `ARTICLE_OUTPUT_FORMAT[stage]`.

Red evidence:

```text
❯ |unit| tests/ideas.test.ts (38 tests | 1 failed) 89ms
     × keeps the prompt's one idea shape without narrowing what the parser accepts 32ms

AssertionError: expected { type: 'object', …(3) } to match object { type: 'object', …(2) }

-           "reasoning",

 Test Files  1 failed (1)
      Tests  1 failed | 37 passed (38)

EXIT_CODE=1
```

```text
❯ |unit| tests/article-cache-output-format.test.ts (11 tests | 1 failed) 84ms
     × matches the request sent by arc 19ms

AssertionError: expected null to deeply equal { type: 'json_schema', …(1) }

 Test Files  1 failed (1)
      Tests  1 failed | 10 passed (11)

EXIT_CODE=1
```

Final gate output:

```text
> spideryarn@1.0.0 typecheck
> tsx scripts/typecheck.ts

Error: listen EPERM: operation not permitted /tmp/tsx-1000/14.pipe

EXIT_CODE=1
```

Fallback:

```text
✓ src/web/tsconfig.json  (429 files)
✓ tests/tsconfig.json  (2531 files)
✓ tools/fleet/web/tsconfig.json  (104 files)
✓ tsconfig.json  (809 files)
✓ all 2649 source files are covered by some project

EXIT_CODE=0
```

Database-free Vitest gate:

```text
 Test Files  9 passed (9)
      Tests  292 passed (292)
   Start at  01:39:26
   Duration  22.13s (transform 13.36s, setup 1.18s, import 31.42s, tests 8.97s, environment 2ms)

EXIT_CODE=0
```

This includes all modified database-free tests plus `article-cache-group`, `thinking-effort-eval`, and `doc-links`.

The two private-lane files—`article-cache-call-site` and `glossary-ideas-baseline`—could not be collected:

```text
[private lane] could not scavenge (carrying on): connect EPERM 127.0.0.1:54362 - Local (undefined:undefined)
No test files found, exiting with code 1

Error: No database, and every test that touches the store needs one.

  could not ask Docker which container serves port 54362: Command failed: docker ps --format {{.Names}}	{{.Ports}}

  Run: npm run db:start   (docs/project/supabase-local.md)

EXIT_CODE=1
```

Additional checks:

```text
Checked 3 files in 3s. No fixes applied.
```

`git diff --check` passed. No reviewer was dispatched.