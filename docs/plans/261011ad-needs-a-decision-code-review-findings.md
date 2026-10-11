# Needs a decision one-count — code review findings

Reviewed the stage diff from `HEAD~1`, the amended plan, the GPT Sol plan review, and every
client, test, CSS and project-doc reference to the admin's `waiting` status and *Needs a decision*.

## Findings before fixes

1. **Medium — user-facing fallback/cap copy still calls waiting reports decisions**
   (`src/web/FeedbackEarlier.tsx:1038-1048`). `ADMIN_EMPTY.open` says a report is “waiting on a
   decision”, `ADMIN_EMPTY.waiting` says reports “need a decision”, and `ADMIN_CAP_NOUN.waiting`
   calls them “reports that need a decision”. The last string is rendered for a capped list of
   waiting reports at `src/web/FeedbackEarlier.tsx:1862`; it therefore restores the old report
   meaning even though the pill number and row word were changed to threads and *Waiting*.

2. **Medium — the transition tests do not pin the pill to the shortcut after the states most
   likely to make them diverge** (`tests/feedback-dialog.test.tsx:3151`, `:3367`, `:3747-3752`).
   The reply and deferral tests assert only the shortcut after the optimistic state change. The
   retained-draft test asserts the pill and only the shortcut tooltip, rather than their identical
   displayed count. The current implementation is correct — `waitingQuestionCount` is calculated
   from `currentQuestions` after `withLocal`, while the retained draft exists only in `questions`
   (`src/web/FeedbackEarlier.tsx:966-995`) — but a later split can regress without these tests
   failing.

3. **Low — the shortcut still has a second count expression**
   (`src/web/FeedbackDialog.tsx:1308`). It renders
   `waitingQuestionCount ?? waitingThreads(liveQuestions)` while the pill renders
   `waitingQuestionCount`. The fallback currently returns the same value because both inputs come
   from `currentQuestions`, but it weakens the one-count contract and could mask a future failure
   to provide the shared count.

4. **Low — stale comments, tests and project docs still name an awaiting report “Needs a
   decision”** (`src/web/FeedbackEarlier.tsx:42-44`, `:1074`; `src/web/styles/feedback.css:295-296`;
   `src/types.ts:7933-7944`; `tests/feedback-dialog.test.tsx:2185-2187`, `:2247`;
   `docs/project/feedback.md:497-498`; `docs/project/feedback-reports.md:574-577`). These contradict
   the new row word and, in the two project docs, tell future agents/readers that a report rather
   than a live thread carries the phrase.

## Fixes made

1. Changed the waiting-report empty and cap copy to *waiting reports*, without saying the reports
   need a decision.
2. Added paired pill/shortcut assertions after an optimistic reply and deferral, and made the
   retained-draft test assert the shortcut's displayed count as well as the pill's. The existing
   null-count test still proves that the pill shows no number before questions arrive; the
   integrated retained-draft test proves the shortcut is absent until that read lands.
3. Removed the shortcut's `waitingThreads(liveQuestions)` fallback. Both controls now render the
   hook's one `waitingQuestionCount`; `null` is not replaced by a report count or another guess.
4. Changed the stale report-status vocabulary to *Waiting* in `FeedbackEarlier.tsx`, its CSS
   comment, `src/types.ts`, the addendum tests, `feedback.md`, `feedback-reports.md`, and the related
   feedback-endings test comment. A final search found no report row still called *Needs a
   decision*, no `.fb-show-questions`, and no client read of `counts.waiting` for the pill.

No wider finding remains.

## Verification

- `npx vitest run tests/feedback-dialog.test.tsx` — **passed**, 296 tests.
- `npm run typecheck` — the `tsx` launcher could not start in this restricted sandbox:
  `listen EPERM /tmp/tsx-1000/*.pipe`. The equivalent script invocation,
  `node --import tsx scripts/typecheck.ts`, **passed** all four TypeScript projects and confirmed all
  3,728 source files are covered.
- `npx biome lint src/web/FeedbackEarlier.tsx src/web/FeedbackDialog.tsx
  src/web/styles/feedback.css src/types.ts tests/feedback-dialog.test.tsx
  tests/feedback-endings.test.ts` — no errors or fixes; it reported the existing four complexity
  infos and four warnings in untouched lines.
- `git diff --check` — **passed**.
