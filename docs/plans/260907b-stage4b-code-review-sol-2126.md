NONCE: REFEREE-TABLE-4B

Verdict: the production move is sound and pushable. No P0 or P1 findings. I found one P2 weakness in the rewritten source-reader test; it does not affect runtime dispatch.

### Finding

- **P2-LEXICAL-HANDLER-BOUNDARY** — The rewritten extractor is exact against today’s source, but its closing delimiter is not structural. I compared its match with Babel’s AST: it matches exactly once and spans precisely from the scan row’s `pattern` property through that handler’s closing comma—1,725 characters, lines 6800–6826, with no Mirror or adjacent-row text.

  However, `[\s\S]*?\n {4}\},` can stop early if those characters appear inside a block comment or template literal, or overrun if the handler’s closing indentation changes. The presence control only proves the opening anchor. A premature terminator after both required calls could hide a later `withSpendAttribution` and leave the assertions green.

  Prefer selecting the exact GET/pattern row through `parseSource`, asserting its handler is an arrow-function block, and inspecting that block’s source span. I would not hold this production push for the P2, because the current extraction is demonstrably exact. See [referee-scan-route.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/tests/referee-scan-route.test.ts:349).

### Answers

1. **Yes, all eight bodies are verbatim modulo the required mechanical substitutions.** I independently extracted the parent commit’s eight `if` bodies and the new eight arrow-function bodies and compared them character-for-character after:

   - replacing the old matcher binding with `captures`;
   - removing only the final top-level `return;`;
   - removing the enclosing shape’s uniform indentation.

   All eight matched. One precision about the reported normalization: PATCH and DELETE also require `part(oneCriterion, 2)` → `part(captures, 2)`, not merely the stated `slugPart(...)` substitution.

   The three SSE callers I count—Criteria POST, Claims POST and Mirror POST—retain their `await withSpendAttribution(...)`; the two lock-bearing helpers remain fully awaited. Response writes and lock-release timing therefore remain inside the request lifetime. See [routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/src/routes.ts:6680).

2. **P2-LIFETIME-BEHAVIOUR is discharged.** The lifetime file is byte-unchanged in `9c1b5012`, while Criteria POST now necessarily travels through the table. The unchanged green run proves the moved path; your `await` → `void` mutation then makes both independent behavioural assertions fail while the static contract remains green. That is exactly the gap stage 4a required the unchanged integration test to cover. See [the lifetime cases](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/tests/streaming-route-request-lifetime.test.ts:399) and [the dispatcher awaits](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/src/routes.ts:7247).

3. **The extractor inspects the correct text today**, but has the future lexical-boundary weakness described above. It includes the scan handler and no adjacent row; after comments are removed, the two calls occur in the required order and `withSpendAttribution` is absent.

4. **The move preserves dispatch behaviour.** The eight rows preserve the parent’s relative order and are prepended above the existing thirteen. The three shared matchers are module-scope `const`s, identical to their former regex literals, and have no stateful flags. Removing trailing returns is safe: an awaited handler completes, `dispatchAuthRoute` returns `true`, and `serveAuthenticatedApi` returns at [the single table call](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/src/routes.ts:8498). Rejections continue through both awaits to `serveApi`.

5. **Search has no remaining prerequisite.** It is the 3b recipe:

   - add the four ordered pair-keys red-first;
   - introduce two shared module-scope matcher constants;
   - prepend the four handlers in GET, POST, PATCH, DELETE order;
   - compare bodies while normalizing both `slugPart` and `part` binding uses;
   - leave `EXPECTED_AUTH_ROUTES` and the lifetime oracle unchanged.

   I found no other test reading the `searches` or `oneRun` dispatch syntax.

I ran only the permitted unit lane: **325/325 passed**. I did not run either Postgres-backed suite. No files were modified.