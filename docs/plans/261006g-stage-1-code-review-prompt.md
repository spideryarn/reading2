# Review request: 261006g stage 1, "none yet" as `200 null` on three reads, and Quiz's counts

You are the code reviewer **and fixer** for one stage. Fix what is wrong *inside this stage*,
narrowly and red-first (a failing test before each fix); report, do not fix, anything wider. You
reviewed this plan earlier today (`docs/plans/261006g-none-yet-plan-review-sol.md`, F1–F4); weigh
this review higher than that one.

**Candidate (committed):** commit `480d208a8`. `git show 480d208a8 --stat`. Its paths:

- `src/routes.ts` (§ `orNullWhenNotMadeYet`, and the GET handlers for `/api/quiz/:slug`,
  `/api/crossrefs/:slug`, `/api/citations/:slug`) — start here
- `src/store/artefact-not-made-yet.ts` (new), `src/store/citations-list-not-found.ts`,
  `src/store/pg.ts` (`loadQuiz`, `loadCrossrefs`), `src/types.ts` (`NONE_YET_AS_NULL_HEADER`)
- `src/web/lib/api.ts` (`saving`, `NONE_YET_AS_NULL`), `src/web/useQuiz.ts`,
  `src/web/useCitations.ts`, `src/web/useCrossrefs.ts`, `src/web/QuizPanel.tsx`
- tests: `tests/none-yet-is-not-a-404-route.test.ts` (new, needs Postgres),
  `tests/none-yet-is-not-a-404-hooks.test.tsx` (new), `tests/api-fetch-offline.test.ts`,
  `tests/quiz-panel.test.tsx`, `tests/xref-prose.test.tsx`, `tests/store-migration-registry.ts`
- docs: `docs/project/web-client.md`, `docs/project/quiz.md`, and the plan
  `docs/plans/261006g-none-yet-is-not-a-404-and-admin-costs-scroll-cue.md` § Stage 1

That list does not limit what you read. Stage 2 of the same plan (`SidewaysScrollBox`,
`DataTable`, `AdminCostsPage`) is already reviewed and landed; leave it alone. Do not run any git
command that changes state (no commit, add, stash, reset, checkout, restore). Do not write any
quote attributed to a person.

## What to do

1. Independent pass. Trace a request with and without the header through the real dispatcher (auth,
   the `article: "first-capture"` guard, the API's one `catch`, `guardDbStore`) and say what each of
   these answers: made artefact; article exists and artefact not made; unknown slug; another
   reader's article; a store failure inside `load`; a failure after `load` (quiz's kept answers,
   citations' matching). Then the client: each hook on `200 null`, on a 404, on a real body, on a
   malformed body, offline with and without a saved copy. Then the Quiz wording against what
   `QuizPanel` actually counts. Mutate the code and see which tests notice.
2. Run the tests that need nothing outside the tree yourself:
   `npx vitest run tests/none-yet-is-not-a-404-hooks.test.tsx tests/api-fetch-offline.test.ts
   tests/quiz-panel.test.tsx tests/xref-prose.test.tsx`. **You have no network, not even loopback,
   so `tests/none-yet-is-not-a-404-route.test.ts` is mine to run.** Its raw output, with nine
   neighbouring files, on `480d208a8`:

   ```
   npx vitest run tests/none-yet-is-not-a-404-route.test.ts tests/none-yet-is-not-a-404-hooks.test.tsx
     tests/api-fetch-offline.test.ts tests/quiz-panel.test.tsx tests/xref-prose.test.tsx
     tests/chat-citations-tool.test.ts tests/doc-links.test.ts tests/quiz-attempts-route.test.ts
     tests/cacheable-covers-artefact-routes.test.ts tests/authenticated-api-route-contract.test.ts
   EXIT=0
    Test Files  10 passed (10)
         Tests  701 passed (701)
   ```
   `npm run typecheck`: all four projects pass. If you change the route or the store, say exactly
   which command I should run to check your fix, and do not claim that test green.
3. Check the two doc paragraphs against the code.

The builder reported the route test red before the change: 7 of 10 failing
(`expected { status: 404 … } to deeply equal { status: 200, body: 'null' }` three times, and
`expected undefined to be 'private, no-store'` four times); the three "unknown slug stays a 404
with the header" cases passed while red and are regression guards. There is no test for the
narrowness of the catch; the builder calls it structural.

Nothing here has been seen in a real browser yet; that check is running separately.

## Severity and output

P0 breaks production for readers; P1 the stage does the wrong thing; P2 worth changing; P3 nit.
Every finding gets an ID (`F1`…), severity, file and line, and whether you **fixed** it (with the
red-then-green output) or are **reporting** it. End with one line:
`VERDICT: land it` / `VERDICT: land it with my fixes` / `VERDICT: do not land`.

## My own suspicions — already mine, worth less

- `res.setHeader("Cache-Control", "private, no-store")` is set before `load` and relied on to
  survive whatever the API's error path writes. Does it, for the 404 and for a 500?
- `send(res, 200, null)` — does `send` and everything between it and the socket (compression, the
  Vercel adapter, the dev server) deliver the four bytes `null` with a JSON content type?
- Can a `null` body reach `saving`'s `.then` for any other reason on these three URLs, so that a
  real answer is now silently not cached? And `NONE_YET_AS_NULL` ends at the slug: is `input` ever
  an absolute URL or carrying a query?
- Is a header that custom ever stripped or does it change how the request is treated (a preflight,
  a proxy, the service worker if there is one)?
- The hooks treat any falsy parsed body as "none". Is that too wide?
- The sentence "There are 12 in all: the other 7 are about passages you have not read yet." now
  shows on every question while the filter hides some. Is it right when the current question is one
  reached by *Show all* or an arrival from the prose?
