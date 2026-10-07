No P0 findings. I fixed the in-scope issues, but the current prompt still needs a paid eval run before I would land it.

### P1

- Fixed — retrying a legacy Recall answer left its old stance in Postgres. The in-memory message was stance-free, but the SQL update did not clear the column. Added `stance: null` in [pg-chat.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/store/pg-chat.ts:524) and a regression test that seeds a real legacy stance in [store-chat-pg.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/tests/store-chat-pg.test.ts:710).

- Fixed, verification still required — the evaluated prompt did not yet deliver Greg’s requested voice. The latest output had six replies over 120 words, two questions in `disagreement`, a guessed correction in `unclear`, reader-verdict openings, and `nudgeFailed` asking about the answer it had just supplied. Examples are at [remember-recall.md](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/evals/results/remember-recall.md:37), [remember-recall.md](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/evals/results/remember-recall.md:131), and [remember-recall.md](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/evals/results/remember-recall.md:145). I tightened [converse.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/converse.ts:583) to:

  - distinguish substantive replies from pure clarification;
  - clarify vague references before correcting;
  - forbid verdict-like opening reactions;
  - move away from a failed nudge instead of asking for the supplied answer;
  - aim for 60–100 words with 120 as the ceiling;
  - permit exactly one interrogative sentence/question mark.

  I did not overwrite the existing uncommitted eval evidence with a new paid run. [remember-mode.md](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/docs/project/learn-mode.md:139) records that this remains to be measured.

### P2

- Fixed — the central live mode catalog still advertised the retired stance behaviour. Updated [mode-catalog.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/mode-catalog.ts:332), Help and Features copy, including the clarification/direct-answer exceptions, with a catalog regression test.

- Fixed — the eval’s `expert` reader incorrectly claimed the article had three arguments, so the model’s valid correction looked like undesirable behaviour. The corrected case is in [remember-recall.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/evals/learn-recall.ts:205). The brevity counter now measures the documented 120-word target rather than 180 words at [remember-recall.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/evals/learn-recall.ts:370).

- Fixed — an optimistic retry test still expected the legacy stance to survive. It now asserts removal in [chat-turn-paths.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/tests/chat-turn-paths.test.ts:153).

- Fixed — the new kind-less legacy-follow-up route test used an invalid Spideryarn id, so it would not address the seeded thread. Corrected in [remember-route.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/tests/learn-route.test.ts:172).

### Confirmed

Legacy stance acceptance is now narrowly correct in [routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/routes.ts:2770): only a valid old stance on a normal send whose authoritative thread kind is Remember is accepted and dropped. Chat sends, unknown stances, retries and edits reject it. Begin/edit create no stance, retry clears it, and finish cannot patch it.

`EditQuestion`’s `aria-disabled` is intentional and sound: activation still reaches the refusal handler, announces through `role="status"`, retains the rewrite, and clears the message when asking becomes possible. Enter, Shift+Enter and button activation remain covered. The Recall composer’s Send button is pinned right with `margin-left:auto` and now has a regression test.

### Checks

- Targeted unit tests: 9 files, 85 tests passed. The final copy changes’ 3 relevant files, 32 tests, also passed.
- Typecheck: all four projects passed; all 2,752 source files covered. `npm run typecheck` itself could not create its `tsx` IPC socket under the sandbox, so I ran the exact underlying script with `node --import tsx scripts/typecheck.ts`.
- Targeted lint exited successfully, with only existing complexity/specificity notices.
- The Postgres-backed route/store tests could not start: private-database setup was denied access to `127.0.0.1:54362` by the sandbox. Those tests did not execute.
- Wider, left for you: Biome reports an unrelated missing `capability.kind` hook dependency in [Reader.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb97-98-remember-recall-and-tutorial/src/web/reader/Reader.tsx:1533).
- No commit made; full `npm test` was not run.

Verdict: not ready to land yet. The code findings are fixed, but I would require the targeted Postgres tests and one new paid Recall eval showing the revised prompt actually resolves the observed failures.