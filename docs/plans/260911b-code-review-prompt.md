# Code review: Comments join the route table (260911b)

You are reviewing one slice of an in-progress refactor in the Spideryarn repo, in the worktree you
are running in. **You may fix what you find inside this slice** (the house workflow since
2026-09-09): edit the files, then report exactly what you changed. Report anything wider than this
slice for the author to decide rather than fixing it. Do not commit, do not push, do not touch
`.env.local`, infra or any database other than the local test lanes the suite creates.

## What the slice is

`serveAuthenticatedApi` in `src/routes.ts` dispatches through an `if` chain that is being emptied
bottom-up into an ordered table, `AUTH_ROUTES`, one contiguous domain at a time. This slice moves the
six Comments guards (`/api/comments/:slug` GET/POST, `…/:id/answer` POST, `…/:id/mark` PATCH,
`…/:id` PATCH/DELETE), after first writing a stream-lifetime oracle for the one that streams.

Read first: `docs/plans/260911b-comments-join-the-route-table.md` (this slice, including the
evidence), then `docs/plans/260908a-chat-and-live-sessions-join-the-route-table.md` (the previous
slice, whose recipe this follows). The commissioning checklist is
`docs/plans/260908f-prioritised-spideryarn-codebase-improvements.md` § G, first stage.

## The evidence

- The scoped diff: `logs/review-260911b/scoped.diff` (tracked files). Three new files are untracked:
  `tests/comment-answer-stream-lifetime.test.ts`, `docs/plans/260911b-verify-move.mjs.txt`,
  `docs/plans/260911b-comments-join-the-route-table.md`. `git diff HEAD` and `git status` reproduce
  all of it; HEAD is `607b57a0`.
- The verifier captures: `logs/review-260911b/before.json` / `after.json`. Re-run it yourself:
  copy `docs/plans/260911b-verify-move.mjs.txt` to a `.mjs`, then `node verify.mjs before <HEAD's
  routes.ts> b.json`, `node verify.mjs after src/routes.ts a.json`, `node verify.mjs diff b.json a.json`.
- The generator that wrote the rows: `logs/review-260911b/move.mjs`.
- Mutation runs: `logs/review-260911b/m1.log` … `m5.log` (M1 dropped `await` in the chain guard; M2
  `release()` deleted; M3 `release()` before the stream; M4 count → flag; M5 `void` in the moved row).
- Contract test red-first: `logs/review-260911b/contract1.log`. Focused suites green:
  `logs/review-260911b/focused.log`.

## The conclusion I am asking you to check

**The six guards moved as a pure move** — same bodies, same order, same position in dispatch, same
gates — **and `tests/comment-answer-stream-lifetime.test.ts` is a real lifetime oracle for
`POST /api/comments/:slug/:id/answer`**: it goes red if the moved handler launches the answer
instead of awaiting it, and its registry cases cannot be satisfied by the row's lease alone.

**The finding I would least like to be wrong about**: that the oracle's registry cases are not
passing for a reason unrelated to `answering` — e.g. that ageing `lease_expires_at` really is the
only other thing sparing the row in `sweepPending`, that the two-attempt case's second
`beginAnswer` really reclaims the row (rather than 409ing and the case passing some other way), and
that the gate queue cannot hand a stream the wrong gate in an unmutated run.

## Questions

1. Is the move pure? Re-run the verifier. Check the comments **outside** handler bodies by reading
   the diff — the verifier does not cover them. Is the one deliberate word change ("the `PATCH`
   above" → "below") right?
2. Are the verifier's two tightenings (targeted rename; raw-vs-blanked cut cross-check) sound, and
   does anything in them make it weaker than its parent on these six bodies?
3. Is the oracle sound (see the finding above)? Is the M1 failure — the subject case failing at the
   handshake with "settled before the stream was entered" rather than at the `settled === false`
   assertion — adequate evidence, or should the case be shaped so a launched stream fails on a
   lifetime assertion instead?
4. The contract edits: both pair-key lists, `moved`, and the control repointed to `/api/projection`.
   Is `/api/projection` the right next domain for the control?
5. Is the recount (82 guards, 43 moved, 39 remaining) right?
6. Anything in `tests/store-migration-registry.ts` (lane + verdict) that another registry test would
   refuse? Run `npx vitest run tests/store-migration-registry.test.ts` if unsure.
7. Anything else you would block this on.

Answer with findings ranked P0–P3, each with file:line, what is wrong, and what you changed (if you
changed it). End with a one-line verdict.
