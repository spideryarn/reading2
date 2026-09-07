NONCE: SEARCH-TABLE-5

Verdict: Stage 5 is sound and pushable. No P0 or P1 findings. The four moved handlers are behaviorally unchanged.

### Findings

- **P2-LIFETIME-ORACLE-GAPS** — The “once, not per domain” ruling remains correct as an argument about a verified verbatim move: the dispatcher’s await is tested once, while the body comparison protects each caller’s own await/return. Search’s behavioral coverage gives this slice valuable defense in depth, but it is incidental and does not generalize.

  Under the stronger “a behavioral test must redden” standard, these remaining slices have gaps:

  | Route | Stateful behavior | Existing behavioral coverage |
  |---|---|---|
  | `POST /api/comments/:slug/:id/answer` | SSE plus the `answering` registry | **Gap.** The only HTTP test is a pre-stream 409 refusal at [routes.test.ts:1400](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/tests/routes.test.ts:1400). No successful route test would catch `await` → `void`. |
  | `DELETE /api/chat/:slug/:threadId` | Holds `inTurnOrder` until deletion completes | **Gap.** There is no server-side DELETE test. The helper suite explicitly says it does not test route wiring at [turn-order.test.ts:9](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/tests/turn-order.test.ts:9). This is in the next chat/live slice. |
  | `POST /api/similar/:slug` and `/api/projection/:slug` | Paid single-flight promises in `INFLIGHT` maps | **Gap, under the broader operational definition of lock.** Their lifetime link is `return withSpendAttribution(...)`, not an `await`; the equivalent mutation is `return` → `void`. Current tests exercise the helpers and error mapper, not these HTTP routes. See [routes.ts:8263](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/src/routes.ts:8263). |
  | `GET /api/link-summary` | SSE plus a database single-flight claim | **Gap outside your parenthetical, but still among the 56 guards.** No test drives a successful HTTP stream through [routes.ts:8013](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/src/routes.ts:8013). |

  Chat POST is incidentally covered: route tests await `handleApi` and then require frames and stored rows, for example [chat-route.test.ts:114](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/tests/chat-route.test.ts:114). Quiz mark similarly requires a 200, an opened stream, and terminal content at [quiz-mark-route.test.ts:459](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/tests/quiz-mark-route.test.ts:459). Live-session routes are ordinary JSON operations with positive route tests. Glossary, ideas, quotes, timeline, arc and sketch do not stream or hold route-lifetime locks; illustrated’s byte-serving path has positive body-level coverage.

  Therefore: search is safer than originally stated, but by fortunate existing coverage. Before later moves, I would add oracles for the chat-thread DELETE, comment answer, similar/projection, and link-summary slices.

- **P2-RETURN-NORMALIZER** — Yes, the normalizer should refuse automatic comparison whenever it finds a return belonging to the guard’s function scope other than exactly one final, argumentless top-level `return;`. Nested function returns should be excluded from that scan.

  One precision: a retained early return inside a table handler would not fall through to another route—the dispatcher still returns `true` after the handler. The dangerous transformation is removing that return and allowing later statements in the same handler to execute. Refusing non-trailing or value-bearing returns still gives the right safety boundary, and will force deliberate handling of chat GET and the existing `similar`/`projection` promise returns.

### Stage 5 verification

1. **All four bodies are verbatim.** I compared them independently with `713d983c^`, including comments:

   - GET: only `searches` → `captures`, indentation, and final `return;`.
   - POST: both `slugPart(searches, 1)` uses became `slugPart(captures, 1)`; `await withSpendAttribution(...)` is intact.
   - PATCH: both `slugPart` and `part` bindings changed to `captures`; validation and response are unchanged.
   - DELETE: only the matcher binding and trailing return changed.

   Response timing and the `searching` lifetime are therefore unchanged.

2. **The current return/throw audit is clean.** Each of the four old `return;` statements was the arm’s final statement. PATCH’s only earlier exit is `throw httpError(400, …)`. It rejects through the awaited handler at [routes.ts:7355](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/src/routes.ts:7355), through `serveAuthenticatedApi`, and into the same outer `serveApi` catch. No intervening `try` changes it.

3. **Dispatch and order are correct.** The four rows are prepended above referee in GET, POST, PATCH, DELETE order. The existing 21 rows retain their order. `SEARCHES_PATTERN` and `ONE_RUN_PATTERN` exactly match the former regexes and have no stateful flags. The single table dispatch remains after all chain guards, and trailing-return removal is safe because a matched, awaited handler is followed by `return true`.

4. **The contract remains stable.** `EXPECTED_AUTH_ROUTES` was not changed.

Permitted test run:

```text
Test Files  1 passed (1)
Tests       326 passed (326)
```

I did not run either Postgres-backed suite and relied on your supplied results for them. No files were modified.