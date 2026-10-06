# Review request: 261006h, "none yet" as `200 null` on seven more artefact reads

You are the code reviewer **and fixer** for one stage. Fix what is wrong *inside this stage*,
narrowly and red-first (a failing test before each fix); report, do not fix, anything wider. You
reviewed the plan earlier today (`docs/plans/261006h-none-yet-rest-plan-review-sol.md`, F1–F3);
weigh this review higher than that one.

**Candidate (committed):** commit `a78132470`. `git show a78132470 --stat`. Its paths:

- `src/routes.ts` (§ `orNullWhenNotMadeYet`, and the GET handlers for
  `/api/{simple,ideas,faq,timeline,debate,glossary,quotes}/:slug`) — start here
- `src/store/pg.ts` (the seven loaders' throws), `src/store/artefact-not-made-yet.ts`,
  `src/types.ts` (`NONE_YET_AS_NULL_HEADER`)
- `src/web/lib/api.ts` (`NONE_YET_AS_NULL`, now exported), `src/web/useSimple.ts`, `useIdeas.ts`,
  `useFaq.ts`, `useTimeline.ts`, `useDebate.ts`, `useGlossary.ts`, `useQuotes.ts`
- tests: `tests/none-yet-is-not-a-404-route.test.ts` (needs Postgres),
  `tests/none-yet-catch-boundary.test.ts`, `tests/none-yet-is-not-a-404-hooks.test.tsx`,
  `tests/api-fetch-offline.test.ts`, `tests/a-broken-mode-leaves-the-article-readable.test.tsx`
- docs: `docs/project/web-client.md`, and the plan
  `docs/plans/261006h-the-other-seven-artefact-reads-answer-none-yet-as-200-null.md`

That list does not limit what you read. The mechanism itself and its first three reads (quiz,
crossrefs, citations) landed and were reviewed under plan 261006g; leave them alone unless this
stage broke them. Do not run any git command that changes state (no commit, add, stash, reset,
checkout, restore). Do not write any quote attributed to a person.

## What to do

1. Independent pass. For each of the seven, trace a request with and without the header through the
   real dispatcher and say what each of these answers: made artefact; article exists and artefact
   not made; unusable document (legacy `simple/1`, FAQ without `questions`, a debate failing
   `isDebateDocument`); valid but empty artefact; unknown slug; another reader's article; a store
   failure inside `load`; a `resolveProfile` failure inside `withProfileChanged`. Then the client:
   each hook on `200 null`, on a 404, on a real body, on a malformed body (`false`, `0`, `""`, `{}`,
   the artefact field `null`), on a failed revalidation with an artefact already on screen, offline
   with and without a saved copy. Mutate the code and see which tests notice.
2. Run the tests that need nothing outside the tree yourself:
   `npx vitest run tests/none-yet-is-not-a-404-hooks.test.tsx tests/api-fetch-offline.test.ts
   tests/none-yet-catch-boundary.test.ts tests/a-broken-mode-leaves-the-article-readable.test.tsx`.
   **You have no network, not even loopback, so `tests/none-yet-is-not-a-404-route.test.ts` is mine
   to run.** Its raw output, with six neighbouring files, on `a78132470`, is
   `docs/plans/261006h-none-yet-rest-gates-output.txt` (7 files, 469 tests, exit 0).
   `npm run typecheck` exits 0 on the same commit.

## Severity scale and output

- **P0** — would lose data or break production for readers. **P1** — wrong or regressed behaviour.
  **P2** — worth changing, not blocking. **P3** — nit.
- Every finding gets an ID (`F1`, …), a severity, the evidence (file and line), whether you
  reproduced it or reasoned to it, and whether you fixed it (name the test that went red first).
- End with one line: `VERDICT: land it` / `VERDICT: land it with my fixes` / `VERDICT: do not land`.

## What the builder decided beyond the plan — check these first

- **The shape check in each hook is presence only**: a plain `Error` unless the artefact field is a
  non-null object. Inner arrays are not validated (Ideas, Glossary and Quotes already derived a
  field that throws on a missing artefact).
- **`useSimple` no longer draws `{ simpleSummary: null }` as `ready`.** It did, deliberately (the
  removed comment said "a null artefact is drawn as it always was"). The builder says the route
  never sends that. Is that true of every source this hook can be fed from, the offline cache's
  older saved copies included?
- **The "same ten" test reads `src/routes.ts` as text.** Is it brittle in a way that lets a route
  be wrapped without its name in the offline pattern, or the reverse?
- **Sol-F1 fixtures are written straight onto the revision row**, because the store's shape check
  refuses malformed documents.
- **`tests/a-broken-mode-leaves-the-article-readable.test.tsx`**: its fetch mock answered unknown
  URLs with `{}`; the builder added citations, simple, faq, timeline and debate to its 404 list. The
  builder believes 23 of its tests were already red at the parent commit because of citations
  (261006g's hook change), and did not run the file there. Is weakening the mock the right repair,
  or does a `{}` reply turning into a page fault matter to what that test exists to pin?

## My own suspicions — already mine, worth less; spend most of the run elsewhere

- A `current()` check dropped or reordered around the new `await readJson` in any of the seven.
- A hook whose "none" branch forgets a setter the old 404 branch called.
- `Cache-Control: private, no-store` on the seven: anything that relied on the old headers.
- Comments or docs still saying "three".
