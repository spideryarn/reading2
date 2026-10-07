# Review: stage 2 — Greg answers an agent's question inside the Feedback dialog

Repo: this worktree (branch `worktree-fbcnbv8f-earlier-tab-deferred-and-ask`, off `dev`).
TypeScript, ESM, one Node server, Postgres via drizzle, React under `src/web/`.

## The candidate

Committed: commit `ed62e3ab4` alone. `git diff ed62e3ab4^..ed62e3ab4`; changed paths:
`git diff --name-only ed62e3ab4^..ed62e3ab4` (56 files).

Start with: `scripts/feedback-questions.ts` (`classifyAnswers`, `runAnswers`),
`scripts/feedback-endings.ts` (the question parser and compile), `src/feedback-question.ts`,
`src/store/pg-feedback.ts` (`submitAnswer`, `newestAnswers`, `linkedReports`), `src/routes.ts`
(the two `/api/admin/feedback/…` rows), `drizzle/20261007051332_feedback_question_answers.sql`,
`src/web/FeedbackEarlier.tsx` (`EarlierQuestions`, `ReplyBox`, `useQuestionReplies`),
`src/web/FeedbackDialog.tsx`, `scripts/overseer-tools/prompt-feedback-sweep.md`,
`docs/project/feedback-reports.md`, and the ten files in `docs/user-feedback/questions/`.
Begin there; the manifest is the scope.

## What it is meant to do

The spec is the plan:
`docs/plans/261007d-earlier-tab-says-what-became-of-each-report-numbers-them-and-asks-greg-questions-in-place.md`
— decisions 1, 2, 6 to 9, and "What the plan review changed", whose round-two bullets F7, F11,
F12, F13, F14, F15 (your own findings) are binding. Stage 1 (`16963ad41` and the commit after it)
you have already reviewed; it is out of scope except where this commit changes it.

Invariants: no agent writes to production (Greg's reply is the only production write, made by his
own signed-in request); no handler authorises with `isAdmin`, and no defence in
`docs/project/security-map.md` § Where the defences physically live is edited; one owner never
reads another's answers; a reply Greg sends is never silently lost (F14, F11); `--answers` never
reports "none" when it could not tell, and trusts only an admin-owned, production- or
preview-environment row (F13); the unattended sweep's real instructions
(`prompt-feedback-sweep.md`) read the new mechanism and nothing still sends an agent to the
retired waiting list as a live instruction.

The builder (a Claude Opus subagent) reported these departures; judge each: a Stage 2 client
requires `questions` in the admin answer, so stage 1 and 2 must deploy together (they will: both
land on `dev` at once); the reply's id is bound to its question and words, so our client never
gets a 409; drafts are kept per question across box, filter and tab switches and dialog close;
the answers table's FK is `ON DELETE RESTRICT` like `feedback`'s; no rate limit on the answers
POST; the body cap is 12,000; `--answers` also exits 2 on an unparseable question file; and the
builder noted that closing the dialog mid-dictation in a reply box may drop words still in
flight. I also changed two notes from `ending: awaiting` to `shipped` (reading time, sharing),
both decided by Greg on 2026-10-05 and built per their plans (261005g, 261005e).

Content: each question file's body should say only what its source bullet (now deleted from
`docs/user-feedback/awaiting-approval.md`; see `git show ed62e3ab4^:docs/user-feedback/awaiting-approval.md`)
and the plan section it links say, reshaped to `docs/reusable/ask-me-questions.md`. Check them.

## What you can and cannot run, and what you may change

You may edit this worktree. Fix what is inside this stage — each finding red-first, with the test
that reproduces it — and leave anything wider as a finding for me to decide. Do not commit. List
every file you changed at the end.

You can run one test file at a time and scripts with `node --import tsx`. No network, not even
loopback; anything needing Postgres fails for that reason alone. On this commit, against the local
database, the builder ran typecheck (green, 3371 files) and 43 test files (1641 tests passed),
and I re-ran `feedback-endings` and `doc-links` after my note edits (65 passed). If you add a test
that needs Postgres, say so and I will run it.

## Attack it

Independently, before reading my suspicions. Break an invariant above.

For each finding: an ID continuing from C5 (C6, C7, …), a severity (P0 data loss / exploitable
security / broadly unusable; P1 user-visible wrong behaviour or an authoritative contract
violated; P2 design or maintainability risk; P3 prose), established or reasoned, (a) the input or
mutation I can run, (b) the smallest change that closes it and whether you applied it. A finding
with no (a) goes last. Correct changed doc wording that does not match the code. End with one
line: `VERDICT: approve`, `VERDICT: approve with fixes` (say whether applied), or
`VERDICT: refuse` (only on an established P0 or P1 you could not fix).

## My own suspicions — read last

Already mine; worth less than what you find.

- Words lost: closing the dialog mid-dictation in a reply box (the builder's own note); a
  reply posted to an old deployment that does not have the answers route; a question that
  disappears from the generated list while its box holds a draft.
- `submitAnswer`'s insert-on-conflict-do-nothing then compare: any race between two identical
  POSTs where both report 201, or a conflict reported as a duplicate?
- `--answers`'s check that the table is absent before saying "not deployed yet": could a
  permission error or a pooler error be read as "absent"?
- Question bodies are rendered as text, never HTML or markdown; a model's voice for the question,
  the reader's for the reply.
- The migration needs the production app role to read and write the new table; is anything other
  than default privileges relied on, and is that written where the deploy will notice?
