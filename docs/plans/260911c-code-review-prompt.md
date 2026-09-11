# Code review: the paid single-flight block joins the route table, and link-summary's oracle (260911c)

You are reviewing one slice of an in-progress refactor in the Spideryarn repo, in the worktree you
are running in. **You may fix what you find inside this slice** (the house workflow since
2026-09-09): edit the files, then report exactly what you changed. Report anything wider than this
slice for the author to decide rather than fixing it. Do not commit, do not push, do not touch
`.env.local`, infra or any database other than the local test lanes the suite creates. **Do not run
mutations against `src/` while leaving them in place** — restore every byte you change there unless
it is a fix you report.

## What the slice is

`serveAuthenticatedApi` in `src/routes.ts` dispatches through an `if` chain that is being emptied
bottom-up into an ordered table, `AUTH_ROUTES`, one contiguous domain at a time. This slice:

1. writes `tests/paid-single-flight-lifetime.test.ts`, a lifetime oracle for `POST /api/similar/:slug`
   and `POST /api/projection/:slug`, which **return** `withSpendAttribution(…)` rather than awaiting
   it, and whose single-flight lives in `INFLIGHT` maps (src/similar.ts, src/projection.ts,
   src/article-vectors.ts);
2. moves the six guards `sketch` GET, `illustrated` GET, the illustrated plate GET, `arc` GET,
   `similar` POST and `projection` POST into rows;
3. writes `tests/link-summary-stream-lifetime.test.ts`, a lifetime oracle for `GET /api/link-summary`
   with the real Postgres claim, **ahead of** the article slice, which this stage deliberately does
   not move (see the plan § *Why the article slice does not move here*).

Read first: `docs/plans/260911c-paid-single-flight-joins-the-route-table.md` (this slice and its
evidence), then `docs/plans/260911b-comments-join-the-route-table.md` (the previous slice, same
recipe). The commissioning checklist is `docs/plans/260908f-prioritised-spideryarn-codebase-improvements.md`
§ G, second stage.

## The evidence

- The scoped diff: `logs/review-260911c/scoped.diff` (tracked files). Four new files are untracked:
  the two test files, `docs/plans/260911c-verify-move.mjs.txt` and the plan. `git diff HEAD` and
  `git status` reproduce all of it.
- The verifier captures: `logs/review-260911c/before.json` / `after.json`. Re-run it: copy
  `docs/plans/260911c-verify-move.mjs.txt` to a `.mjs`; `git show HEAD:src/routes.ts > head.ts`;
  `node verify.mjs before head.ts b.json`, `node verify.mjs after src/routes.ts a.json`,
  `node verify.mjs diff b.json a.json`.
- The generator that wrote the rows: `logs/review-260911c/gen-move.mjs`; the mutation runner:
  `logs/review-260911c/mutate.mjs`.
- Every mutation run, verbatim: `logs/review-260911c/mutations.txt`.
- Focused suites green after the move: `logs/review-260911c/focus.log` (15 files, 677 tests).
- Your sandbox may not reach local Postgres (last review's could not). If so, say which suites you
  could not run rather than inferring their result; the author will run them.

## The conclusion I am asking you to check

**The six guards moved as a pure move** — same bodies, same order, same position in dispatch, same
gates — **and both new files are real lifetime oracles**: each goes red if its route launches the
work instead of linking the request's lifetime to it (`return`/`await` → `void`), in the chain and
in the moved rows, and the single-flight assertions cannot be satisfied other than by the
single-flight.

**The finding I would least like to be wrong about**: that `tests/link-summary-stream-lifetime.test.ts`
really exercises the database claim — i.e. the second request's `pending` comes from
`linkSummaryStore.claim` seeing the first request's row, not from some earlier `pending` exit
(the preview step 3, the allowance, a thrown error framed as `pending`), and that the `calls === 1`
assertion is what makes L2 go red rather than something incidental. Second to that: that the paid
oracle's "second reader reached the map" wait (`entered` counter on pass-through wrappers) really
means the second request has consulted `INFLIGHT` before the first is released.

## Questions

1. Is the move pure? Re-run the verifier. Read the comments **outside** handler bodies in the diff —
   the verifier does not cover them. Are the positional edits (sketch "reads still in the chain
   below", arc "ideas GET in the chain below", similar "`tweets` note in `serveAuthenticatedApi`",
   the two `illustratedPlate` mentions in the asset comments) right, and did I miss any that the
   move falsified?
2. The verifier's one change (refusal reason names the callee): sound, or weaker than its parent?
3. Is each oracle sound (see above)? Is anything in them timing-dependent in an unmutated run —
   e.g. could the `until(entered === +2)` poll or the `reachedOrSettled` race go either way under
   load?
4. `tests/cacheable-covers-artefact-routes.test.ts` now also recognises a table row
   (`method: "GET"` then `pattern: <literal>` on the next line). Does that reopen the silent
   shrinkage the file was built against, anywhere?
5. The contract edits: both pair-key lists, the five new `moved` prefixes (is any of them a
   substring of a remaining chain path?), and the control repointed to `/api/quiz`.
6. Is the recount (82 guards, 49 moved, 33 remaining) right?
7. The decision not to move the article block (ordering: ten guards sit below it). Agree, or is
   there a reading of the design under which it could move now?
8. Anything in `tests/store-migration-registry.ts` (lanes + verdicts) another registry test would
   refuse?
9. Anything else you would block this on.

Answer with findings ranked P0–P3, each with file:line, what is wrong, and what you changed (if you
changed it). End with a one-line verdict.
