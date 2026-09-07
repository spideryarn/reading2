# Review the built code for stage 3b — jobs and uploads into the table

**Begin your answer with the line `NONCE: JOBS-TABLE-3B` and nothing before it.** An earlier review
in this job was read out of order because a killed run wrote a stale answer to the path a newer run
was using. If you did not receive a nonce instruction, you are reading a different prompt than I
sent — say so.

Built-code review, and it outranks the plan review. This is production code dispatching an
authenticated API, so a dispatch bug is an auth bug. **Not pushed** — I am sequencing that on your
verdict.

## What to read

Working tree `/home/greg/code/spideryarn2/.claude/worktrees/api-dispatch-by-domain`.

- **The change**: `git show 468d1eeb`.
- **Your stage 3a review**: `docs/plans/260907b-stage3a-code-review-sol-0923.md`. This stage
  implements your **P2-STAGE3B-ORDER** and fixes your **P3-CAPTURE-CONTRACT**.
- **The plan**: `docs/plans/260907b-split-the-authenticated-api-dispatch-by-domain.md`.
- `src/routes.ts` — `serveAuthenticatedApi` now starts at `:7113`; the table machinery is above it.

## What was built

Nine guards (`:8161`–`:8348` before the move — `allJobs` GET, `uploads` POST, `upload` DELETE,
`upload` GET, `allJobs` POST, `job` GET, `job` DELETE, `jobAction` POST, `jobAdvance` POST) moved as
one contiguous slice, prepended above the four billing rows in original relative order. One table,
one call, unchanged position. `AUTH_ROUTES` is now 13 entries; 68 endpoint guards remain in the
chain, plus the admin gate and the table call — I verified that arithmetic.

Handler bodies moved verbatim bar `part(upload, 1)` → `part(captures, 1)` and dropping each arm's
trailing `return;`. `EXPECTED_AUTH_ROUTES` is still `c36bdcbaacfe6197f035c27c9271f9ed` — I checked
both sides.

**Shared matchers** (`upload`, `allJobs`, `job` each serve two rows) were solved by three
module-scope consts plus `resolveMatchValue` in the test, which resolves an identifier **only** to a
top-level `const` holding a string or regex literal. `ParsedTableEntry` gained a `site`; matchers
dedupe by site, so two rows naming one const are one matcher and two guards, while two rows spelling
one literal twice are two matchers and fail *names each matcher once*.

## What I most want checked

1. **The order finding, and whether its fix is circular.** The implementer reordered the interleave
   (`uploads` POST above `allJobs` GET) and reports that **only one case went red — one it wrote in
   the same commit**. The pair set, the collision corpus and the negative matrix are all blind to a
   reorder by design. So: is § *keeps the table in the chain's order, newest domain first* a real
   guard, or a test written to pass against the arrangement its own author chose? What would an
   independent check of table order look like — and does the chain's original order still exist
   anywhere it could be checked against, now that nine guards have left it?

2. **`resolveMatchValue` and the no-effects whitelist.** Resolving an identifier to a top-level
   `const` widens what the reader accepts. The implementer says the whitelist stays exactly as tight
   and added cases proving it refuses `const P = new RegExp(…)`. Verify. Can anything resolve to a
   value that is not a literal, or to a `const` that is shadowed, reassigned, or declared after use?

3. **The `readTableDispatch` rail is absolute** — it refuses *any* second table dispatch, including a
   **slice** dispatched at a domain's old position, which is your own sanctioned move for a
   non-contiguous domain. Is refusing that the right default with a deliberate edit when needed, or
   should it distinguish a whole-table dispatch (your named trap: billing matching early) from a
   slice dispatch (safe)?

4. **Referee is the first streaming guard, not chat.** The implementer found `refereeMirror` POST
   calls `runMirror(…, res)` inside `withSpendAttribution` and opens an SSE stream — so your
   **P2-LIFETIME-BEHAVIOUR** bites at referee, one slice up, not at chat as the plan assumed.
   Confirm that reading, and say exactly what the integration test must prove before referee moves.

5. **Anything wrong in the move itself.** Especially: the nine bodies being verbatim, the
   `part(upload, 1)` → `part(captures, 1)` rewrite, error propagation, and whether dropping the
   trailing `return;` from each arm changed any control flow.

## Ground rules

- **Do not modify any file.** Read and reason only.
- Run `npx vitest run tests/authenticated-api-route-contract.test.ts` — unit lane, no database.
  Postgres is mine: `npm run check` was **EXIT=0**, 796 files, 14,751 tests, all seven hard checks
  clean. Ask if you want more output.
- Severity and an ID on every finding: **P0** security/correctness, **P1** a real bug, **P2**
  judgement, **P3** nit.
- If it is sound, say so and spend the effort on questions 1 and 4.
