# Review, round two, narrow: what changed in stage 2 of 261003l after your review

Repo: the current directory (Spideryarn). Read-only: change no file. Your stage 2 review is
`docs/plans/261003l-stage-2-code-review-sol.md` (CR-11..CR-17). Discovery on the stage is closed;
this round checks only the changes made after it, some of them yours and reviewed by nobody.

## The candidate

Committed: `29a7ea2bb`. `git diff 5f5ae98cd..29a7ea2bb -- . ':!evals/results' ':!drizzle/meta'`.
Start with:

- `src/chat.ts` § `withSpokenTurn`: your CR-11 guard, widened by me from `existing?.kind ===
  "explore"` to `existing && !isSpokenKind(existing.kind)`, and `tests/chat-spoken-route.test.ts`.
- `src/converse.ts`: `EXPLORE_SYSTEM` and the Explore line in `lengthLine` after two eval-driven
  revisions (CR-12 and CR-13 were folded in); and `runToolWith`, an eval seam on `ConverseRequest`.
- `src/web/ChatPanel.tsx`: the `h2` is `sr-only` when the sub-mode chips are present.
- `evals/remember-explore.ts` and
  `docs/investigations/261003e-explore-sub-mode-against-chat-with-the-notes-tool.md`.
- `docs/project/remember-mode.md` § Explore, the fourth sub-mode.

## Statements to check for accuracy

1. No stored thread whose kind is not `chat` or `remember` can receive a spoken exchange, whatever
   the request says or omits; and every spoken path that worked before for chat and Recall still
   works (a fresh thread, an existing chat, an existing Recall thread, a replay).
2. CR-12 and CR-13 are resolved by the prompt as it now reads, and the revisions introduced no
   contradiction between `EXPLORE_SYSTEM`'s rules, nor with the shared sections it interpolates.
3. `runToolWith` cannot be set by any request: no route, Live path or public path passes it.
4. The investigation's claims are carried by its own files under `evals/results/`: the headline
   (Explore 93% against Chat 87% on the judge's "about the reader's thinking" label, so the
   25-point bar was NOT met), the eight thresholds reported as met, and the stated limits. Say
   where a sentence claims more than the evidence holds.
5. `docs/project/remember-mode.md` and the plan's "Stage 2" sections match the code at
   `29a7ea2bb`.

Severity as before (P0..P3), IDs from `CR-18`, file:line, established or reasoned. Verdict: land,
land with the changes named, or do not land.
