# Plan review, round 2: Recall's question links its passage, and a Hint button

Read-only review. Do not edit anything.

Candidate: `docs/plans/261004h-recall-questions-link-the-passage-and-carry-a-hint-button.md`
(untracked; base is HEAD), reworked after your round-1 review at
`docs/plans/261004h-recall-hint-plan-review-sol.md`. Nothing is built yet.

1. For each of F1 to F8, say whether the reworked plan resolves it. § What the plan review changed
   lists what was taken. F5 was taken only in part: the split requires a question in the body but
   NOT a valid id beside it, for the reason given there. Say whether that reason holds.
2. New in this round, so attack it: the `hint_opened_at` column, its set-once route, clearing on
   retry and edit, and `answerAsSeen` for Live's seed and `reader_notes`. Check against
   `src/chat.ts`, `src/store/pg-chat.ts`, `src/routes.ts`, `src/live.ts`, `src/reader-notes.ts`,
   `src/store/export.ts`, the migrations folder and `docs/project/database.md`,
   `docs/project/security-map.md`. Is a new route the simplest correct way to record the press?
   Does anything else (an in-memory `withRetry`/`withEdit`, the client's optimistic rows in
   `useChat.ts`, the stream-recovery path) need to know the field?
3. Anything else that would make the build go wrong.

Keep the F ids stable: reuse F1 to F8 for the same findings, and number new ones from F9.
Severity scale: P0 data loss, exploitable security, incorrect charging, service unusable; P1
user-visible wrong behaviour or an authoritative contract violated; P2 design or maintainability
risk; P3 prose. Mark each *established* or *reasoned*, with file and line.

End with exactly one line: `VERDICT: approve`, `VERDICT: approve with changes` or `VERDICT: rework`.
