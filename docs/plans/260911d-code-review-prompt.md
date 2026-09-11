# Review: cluster G's closing stage — the last 33 route guards join `AUTH_ROUTES`

**Findings only. Do not edit any file.** Report findings ranked P0–P3, each with file, line, the
concrete failure it would cause, and what would fix it. If you find nothing at a level, say so.

## What this is

Spideryarn's authenticated API used to dispatch through an `if` chain in `serveAuthenticatedApi`
(`src/routes.ts`). Over several stages it has been moved, verbatim, into an ordered table of closures,
`AUTH_ROUTES`, which `dispatchAuthRoute` walks, awaiting each handler. This stage moved the last 33
guards and deleted the test-side readers that only existed to read the chain. The design and its
rules are in `docs/plans/260907b-split-the-authenticated-api-dispatch-by-domain.md`: bottom-up,
contiguous slices, prepended rows, handler bodies moved verbatim, no router dependency, no handler
rewrites, exactly one dispatch of the table, the admin-namespace gate outside the table and above
its dispatch.

**Read first:** `docs/plans/260911d-close-the-route-transition.md` (this stage's record, with every
mutation result), then `docs/plans/260911b-comments-join-the-route-table.md` for the recipe.

## The diff

Five commits on `dev`, and nothing else in the range (each merge of `origin/dev` was a no-op):

```
git log --oneline 6bc0c60a..d4c11480
git diff 6bc0c60a..d4c11480 -- src/routes.ts tests/ docs/plans/
```

- `1eaeb775` two new lifetime oracles (`tests/quiz-mark-stream-lifetime.test.ts`,
  `tests/glossary-stream-lifetime.test.ts`), plus registry entries; then slice 1, `ideas` … `quizMark`
- `ae166e94` slice 2, the glossary (and the artefact-cache test learning a named constant)
- `370923e1` slice 3, the article block
- `30851cc5` slice 4, the top fourteen (admin, shelf, models, transcribe, feedback, reader,
  shelfOpen), and the contract test requiring an empty chain
- `d4c11480` the chain readers deleted from `tests/authenticated-api-route-contract.test.ts` and
  `tests/cacheable-covers-artefact-routes.test.ts`, and the plan status updates

## The evidence already gathered (re-run what you can)

- **Body purity**: `docs/plans/260911d-verify-move.mjs.txt` (copy it to a `.mjs` to run). To
  reproduce: `git show 6bc0c60a:src/routes.ts > before.ts`, then per slice (`ideas`, `glossary`,
  `article`, `top`): `node verify.mjs before before.ts b-<s>.json <s>`,
  `node verify.mjs after src/routes.ts a-<s>.json <s>`, `node verify.mjs diff b-<s>.json a-<s>.json`.
  Recorded: all four print *the move is a move*, against the tree at `d4c11480`.
- **Lifetime**: each streaming or paid moved row, with `await` → `void` (or transcribe's call
  launched), goes red in its oracle and the contract test stays green. The plan's per-slice sections
  have the tables.
- **Red first**: every slice's contract-test failure before the test edit is recorded.
- The generator that produced the rows was a scratch script, not committed. It cut each guard
  together with the comment block directly above it, and each matcher declaration together with its
  comment. It dropped the trailing `return;`, renamed `slugPart(m,` / `part(m,` / `= m;` to
  `captures`, derived the handler's destructured parameters from the identifiers the body uses, and
  prepended rows in chain order.

Your sandbox probably cannot reach local Postgres. The Postgres-lane suites (the oracles,
`request-spend`) were run outside it. Say so if you could not run something, rather than guessing.

## What I most want you to try to break

1. **The order.** The ordering expectation in the contract test (*keeps the table in the order the
   chain had*) was edited in the same commits as the moves. That is the trap 260907b § Stage 3
   warns about: an order oracle written with the arrangement it approves. Independently derive the
   chain's guard order from `git show 6bc0c60a:src/routes.ts` (the 33 `if (<m> && req.method ===
   "…")` lines, top to bottom). Confirm the 33 new rows sit, in that order, **above** the 49 rows
   that were already in the table. This is the finding I would least like to be wrong about.
2. **The admin gate.** Four admin routes are now rows. Confirm that nothing lets a request reach an
   admin row without passing `if (adminNamespace && !isAdmin(user.id))`, and that the table is
   still dispatched exactly once, after the gate and before the 404.
3. **Handler parameters.** Each row destructures only what its body uses (`req`, `res`, `query`, and
   `user` for feedback). Is there a body that reads a name from `serveAuthenticatedApi`'s scope that
   is no longer bound? Typecheck passes, so look for a shadowing or a same-named module-scope
   binding that would make a wrong reference compile.
4. **Comments outside bodies.** The verifier does not cover them. Look for any positional comment
   (*above*, *below*, *in the chain*, *the X route*) the moves made false, or any comment moved onto
   the wrong row.
5. **The deleted readers.** Did the deletion in `d4c11480` remove any check that still guarded
   something real? In particular: `regexMatch`'s refusal of a matcher fed something other than
   `path` (postmortem 260901a); the two contract-test cases deleted; and the two
   artefact-cache cases deleted. Is there a way to add a route now that none of the remaining checks
   would see?
6. **The two new oracles.** Could either pass with its subject broken? For example, a gate handed
   to the wrong stream, or a failure case that reads response state after the settle rather than
   at it.

Write the findings as a markdown document.
