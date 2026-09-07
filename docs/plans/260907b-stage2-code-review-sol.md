## Finding

- **P2-GAINED-ROUTE-PARSER-BLINDNESS** — The assertion is bidirectional over what `bindingOf` recognizes, but not over actual routes. If a currently routeless kind gains a conventional inline declaration, it fails helpfully. If it gains a route using an unsupported form—such as `LABELS_PATTERN.exec(path)`—`labels` remains “unbound,” still matches `ROUTELESS_KINDS`, and the test stays green. This slightly overstates “a kind that gains a route has to leave here deliberately” at [cacheable-covers-artefact-routes.test.ts:232](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/tests/cacheable-covers-artefact-routes.test.ts:232). The planned checked AST inventory is the proper eventual fix.

No P0 or P1 findings; I would not block stage 2 on this limitation.

## Verification

- The new exact equality at [cacheable-covers-artefact-routes.test.ts:250](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/tests/cacheable-covers-artefact-routes.test.ts:250) is not circular. `ROUTELESS_KINDS` is an independent hand-written oracle, so losing an existing recognized route expands `unbound` and fails by name.
- The hardcoded list is useful rather than ordinary duplication:
  - A ninth `SHAPE` kind without a route appears as an unexpected unresolved kind and fails.
  - A listed kind gaining a conventional `/api/<kind>/:slug` declaration disappears from `unbound` and fails until deliberately removed.
  - The P2 exception above applies when the new route uses syntax the grep cannot recognize.
- I reproduced the rename finding using the test’s exact derivation:
  - Original: 10 served artefacts, eight unresolved.
  - `timeline` → `timelineRoute` in declaration and guard: unchanged; Timeline remains covered.
  - `TIMELINE_PATTERN.exec(path)`: 9 served; `timeline` becomes unexpectedly unresolved.
- Stage 3 behavior is loud:
  - Same-module extraction preserving the declaration and guard spellings remains green.
  - Hoisting an existing regex makes the new exact-set assertion fail.
  - Changing only the GET guard form makes the existing unanswered-route assertion at [line 269](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/tests/cacheable-covers-artefact-routes.test.ts:269) fail.
  - Therefore stage 3 will need to adapt this test or replace its grep with the checked parser; it will not quietly lose an existing artefact route.
- `src/routes.ts` is unchanged. The commit contains only the stated test file.
- `owner-isolation.test.ts`, `source-store.test.ts`, and `embedding-route-failures.test.ts` are all unmodified and did not need the reverted changes:
  - The first two explicitly assert that their extracted `sendSource` body is present.
  - Embedding asserts exactly two matches, so an empty extraction fails.
  - Same-file domain extraction or regex hoisting does not invalidate their respective subjects.

Reproduced results: focused suite **20/20 passed**; embedding suite **8/8 passed**.