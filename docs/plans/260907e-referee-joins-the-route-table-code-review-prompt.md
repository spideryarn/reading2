# Review prompt — the built move: referee into `AUTH_ROUTES`

You reviewed this plan, and then Stage 1 as built. This is the **whole finished change**, stages 2
and 3 included. Weight this highest: a plan review cannot see a move that changed a handler, and your
Stage 1 review could not see Stage 2 because it did not exist yet.

Verdict wanted on one question above all: **is this a behaviour-preserving move?**

## The change

Three commits on `worktree-referee-into-the-route-table`:

1. `Stage 1: three referee streams, held open …` — `tests/referee-stream-lifetime.test.ts`, plus the
   lane and registry entries in `tests/store-migration-registry.ts`.
2. `Stage 2: referee's eight guards become table rows …` — the move itself: `src/routes.ts`,
   `tests/authenticated-api-route-contract.test.ts`, `tests/referee-scan-route.test.ts`.
3. `Stage 3, and the review that found the same bug class twice …` — your four Stage 1 findings
   fixed, plus the `requireUser` assertion.

Read `git diff origin/dev...HEAD` for the whole thing, and
`docs/plans/260907e-referee-joins-the-route-table-and-the-stream-lifetime-test-that-has-to-come-first.md`
§ *Stage 2, as built* for the purity evidence and § *The Stage 1 review* for what your last review
changed.

## What I claim, and want attacked

1. **The eight handler bodies are unchanged.** Captured from the chain before the move and from the
   table rows after, put through one normaliser — matcher identifier → `captures`, a guard's trailing
   `return` dropped, comments and whitespace collapsed — and diffed empty (150/180/333/137/179/121/
   138/114 chars both sides). **Attack the normaliser, not just the result**: is there an edit it
   would erase? It strips comments, so a changed comment would not show — I claim that is acceptable
   because comments do not execute; say if you disagree given that some of these comments are the
   only record of why an ordering exists.
2. **Nothing else moved.** Exported names identical (13). `EXPECTED_AUTH_ROUTES` untouched — the
   contract test's header calls that the whole evidence of a behaviour-preserving move.
3. **The dispatch position is unchanged**, so the eight answer from where they answered. Check the
   rows were *prepended* above jobs and in the chain's own order.
4. **Two comments were rewritten** — the dispatch-site one (now "twenty-one guards") and the chain's
   matcher note. I also **moved** the referee namespace-design comment up to the new pattern
   constants and split the scan/mirror rationale into their rows. Is anything now in the wrong place,
   or asserting something no longer true?
5. **Mutation 4**: `await` → `void` in the *moved* criteria closure turns
   `referee-stream-lifetime` red while the contract test, `assertHandlersAwaited` included, stays
   green. I present that as proof the behavioural test was necessary. Is that reading right?

## Specific things to check

- **`slugPart` on every capture that becomes a directory name** — `docs/project/security-map.md`
  names it. All five routes take a slug; the moved handlers call `slugPart(captures, 1)` on the raw
  `RegExpExecArray`. Confirm nothing weakened, and that `part` vs `slugPart` is used exactly where it
  was before.
- **The `requireUser` count is still one**, and Stage 3's new assertion is not itself foolable. It
  compares a line number against `source.indexOf("serveAuthenticatedApi(user")` — is that a fragile
  way to locate the handoff?
- **`tests/referee-scan-route.test.ts`** — its source-reader was re-anchored from
  `if (refereeScan && …) {` with a four-space closing brace to the row's `pattern:` with a four-space
  `},`. Does the new regex actually cut that handler and nothing else, and do its three assertions
  still test what they tested?
- **The five matchers**: three became module-scope constants (shared by two rows each) and two are
  written inline (one row each), following the existing comment's rule. Are the regexes character-for-
  character what the chain had?
- **Anything that still reads the chain** and would now silently see fewer guards.

## Not in scope

The slice choice (settled), the decision to add rows to a table rather than build something (settled
by Greg and your earlier review), and prose or doc structure unless a document states something false
about the code.
