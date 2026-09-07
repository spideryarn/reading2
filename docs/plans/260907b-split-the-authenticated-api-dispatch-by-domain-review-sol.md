The per-domain function shape is right; a route table is not. But the plan is not ready to build: Stage 1’s oracle and the ordering analysis need correction first.

I would land the corrected route-contract test as a complete result, then extract two or three domains and reassess. I would not pre-commit to extracting all domains.

## Findings

### P1-R1 — Stage 1 is circular and unsafe as written

“Derived from the matchers” cannot also be the independent oracle for whether a matcher was deleted. A count is only a canary: deleting one guard while adding another still passes it.

Nor should a generic matrix execute every accepted pair. Several accepted POSTs write data, spend money, contact providers, open SSE streams, or create Stripe objects. Testing their “answer today” is the responsibility of their existing route suites, not a dispatcher inventory.

Use this instead:

1. Hand-write a reviewed `EXPECTED_AUTH_ROUTES` contract with one row per matcher:

   ```ts
   {
     match: { kind: "literal", path: "/api/models" }
       // or { kind: "regex", source: "^\\/api\\/chat\\/([\\w.%-]+)$", flags: "" }
     methods: ["GET"]
     witnesses: ["/api/models"]
   }
   ```

   Do not pin binding names; renaming `timeline` to `timelineRoute` is behavior-neutral.

2. Parse [src/routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/src/routes.ts:6555) with the already-installed Babel parser, following the repo’s existing precedent. Extract and normalize:

   - 67 path matchers;
   - 81 matcher/method guards;
   - the separate admin gate;
   - whether every handled arm terminates.

3. Compare the parsed contract bidirectionally with the hand-written contract. Exact set equality is the oracle; `67` and `81` are only loud failure controls. Reject unsupported guard or matcher syntax rather than omitting it.

4. Black-box only the safe negative matrix: for each witness, call every method not accepted by any matcher that matches that witness and require the exact terminal 404 plus no `Allow` header. This reaches no handler and therefore needs no database.

5. Keep positive dispatch behavior in the existing per-route tests, with `/api/models` as the inexpensive harness control.

This catches deletion, addition, matcher changes, method changes, unknown syntax, and accidental acceptance of a wrong method. It still does not cover handler behavior, URL restoration, query parsing, streaming completion, or arbitrary regex intersections; the existing focused tests retain those jobs.

### P1-R2 — The plan’s ordering model is wrong

I parsed all top-level dispatcher guards. The result is:

- Exactly 81 guards have the simple form `matcher && req.method === "VERB"`.
- The admin namespace gate is the only other dispatch-level condition.
- Every arm terminates. `similar` and `projection` have an extra nested block, but ultimately `return withSpendAttribution(...)`.
- No two guards currently accept the same method/path pair.

There are two path overlaps:

- `/api/library/search` matches both `librarySearchRoute` and `shelfEntry`, but their methods are GET and PATCH.
- `/api/chat/:slug/live-tool` matches both `chatLiveTool` and `oneThread`, but their methods are POST versus PATCH/DELETE.

Consequently, swapping either overlapping pair does not change behavior. The Stage 1 acceptance criterion “reordering two overlapping guards makes it red” would pin an implementation detail, not behavior.

This also means “literal routes must precede slug routes” is not currently true as a path-level policy. Today:

- `PATCH /api/library/search` is the shelf-entry route for the article named `search`.
- `PATCH` or `DELETE /api/chat/foo/live-tool` is the thread route for the thread named `live-tool`.

A domain helper must return `false` after a path-only match with the wrong method. It is handled only when the complete matcher-and-method guard succeeds.

The plan also missed an actual interleave: `shelfOpen` is declared with the library matchers but handled at [src/routes.ts:7184](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/src/routes.ts:7184), after models, transcription, feedback, and the reader routes. Therefore library extraction reorders unrelated guards just as jobs extraction does. Conversely, the reader GET and PATCH guards are already consecutive; no unrelated handler separates them.

Other declaration/first-use reorderings occur around:

- article versus link preview/summary;
- source/asset/export versus metadata through projection;
- quiz mark versus debate;
- comment subroutes versus `one`;
- most chat subroutes versus `oneThread`;
- referee scan versus mirror.

They are harmless today because matcher evaluation is pure and the complete accepted pairs are unique.

### P1-R3 — The helper contract is underspecified

`tryXRoutes(req): Promise<boolean>` cannot literally mean `IncomingMessage`. Domains need the full `ApiRequest`: `res`, `path`, `query`, and sometimes `rawUrl`. The feedback route additionally needs the verified `user` at [src/routes.ts:7103](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/src/routes.ts:7103).

Specify top-level same-module functions along these lines:

```ts
async function tryChatRoutes(request: ApiRequest): Promise<boolean>
async function tryMiscRoutes(user: VerifiedUser, request: ApiRequest): Promise<boolean>
```

Each handled arm must await all work—including streams—before returning `true`; the helper returns `false` only after every full matcher/method pair misses. The caller then proceeds to the next domain or the one terminal 404.

`noImplicitReturns` helps, but it cannot prevent someone from starting a stream without awaiting it and immediately returning `true`.

### P2-R4 — Stage 2 incorrectly treats four source tests as the same defect

The silent shrink is real in [cacheable-covers-artefact-routes.test.ts:132](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/tests/cacheable-covers-artefact-routes.test.ts:132): `bindingOf(...) === null` is filtered away.

The other named tests already fail loudly:

- [owner-isolation.test.ts:1306](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/tests/owner-isolation.test.ts:1306) asserts both operands exist.
- [referee-scan-route.test.ts:342](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/tests/referee-scan-route.test.ts:342) explicitly refuses an empty match.
- [source-store.test.ts:84](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/tests/source-store.test.ts:84) has a positive control on the extracted function body.

The referee test’s exact source shape will need adapting when that guard moves, but it is not silently passing today. Stage 2 should fix the cacheable derivation and update source-location assumptions only when their domains move. Ideally, the cacheable test should reuse Stage 1’s checked parser rather than introducing another grep.

### P2-R5 — The plan conflates same-file extraction with eventual module extraction

Same-file top-level functions are a good, cheap first step. They lower the dispatcher’s complexity and colocate a domain’s matchers with its handlers, reducing shared-hunk collisions.

They do not yet provide file ownership, import isolation, or a smaller module. Therefore the lock registries are not materially harder for Stage 3: handler helpers continue closing over exactly the same module state.

The inventory is also incomplete. There are at least six relevant registries in `routes.ts`, not four:

- `answering` at [src/routes.ts:1010](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/src/routes.ts:1010)
- `streaming` at [src/routes.ts:2069](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/src/routes.ts:2069)
- `turnOrder` at [src/routes.ts:2120](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/src/routes.ts:2120)
- `searching` at [src/routes.ts:3800](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/src/routes.ts:3800)
- `refereeing` at [src/routes.ts:3970](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/src/routes.ts:3970)
- `pullingClaims` at [src/routes.ts:4211](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/src/routes.ts:4211)

`streaming` and `turnOrder` are the particularly important omissions. They become a real cost only during a later file split, when their ownership and `processSingleton` identities must move atomically with the helpers that use them.

### P2-R6 — The 404 claim needs narrower wording

Within `serveAuthenticatedApi`, for an authorized user, a matching path with the wrong method falls through to the terminal 404 at [src/routes.ts:8178](/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain/src/routes.ts:8178). No authenticated guard sets 405 or `Allow`.

Two qualifications:

- A non-admin requesting any `/api/admin` namespace path gets 403 before method dispatch—even with the wrong method.
- The overall `serveApi` surface does contain 405s in the public dispatcher and Stripe webhook. “No 405 anywhere on this surface” is correct only if “surface” means the authenticated dispatcher after its admin authorization gate.

## The other stated costs

The outer `try`/`catch` remains in `serveApi`, so ordinary awaited helper boundaries do not change error mapping or logging. `AsyncLocalStorage` explicitly survives awaited function calls, so owner and spend attribution remain intact. Monitoring context likewise does not care about a normal function boundary.

SSE is the sharp edge: do not return `true` until the existing streaming function has completed. Starting it and returning would move remaining spend outside the request snapshot and allow the outer lifecycle to finish early.

## Recommendation

Proceed, but revise the plan to:

1. Build the hand-authored, AST-checked route contract plus safe negative-method sweep.
2. Fix only the genuinely silent cacheable derivation.
3. Extract two or three same-file domains—billing first is a good control—then reassess.
4. Treat a later move into per-domain files as a separate, materially harder decision.

Stopping after Stage 1 would be a defensible successful finish. Greg’s new explicit request is enough to override the earlier “Tier 3, do not start” decision, but it does not make extracting every domain automatically worthwhile.

No P0 findings. I modified nothing. The offline `public-dispatch` suite passed 28/28; a targeted private-lane route suite could not start because the sandbox forbids its Postgres loopback, so I am not claiming a database-backed test result.