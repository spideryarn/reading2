# Review the code, not the plan

You reviewed the plan for this change earlier today and said "do not build this as written". It has
now been built, in this worktree (`/home/greg/code/spideryarn2/.claude/worktrees/feedback-one-box`),
and pushed to `dev`. Read-only: do not edit files. Read `AGENTS.md` first.

**Your previous findings are at**
`docs/plans/260902m-one-feedback-box-with-a-kind-toggle-and-dictation-review-sol.md`. Treat the fixes
made in response as unreviewed code written by somebody else, and spend most of the run on what is
actually in the tree rather than on re-checking the plan.

**The plan, updated to say what was built and what your review changed:**
`docs/plans/260902m-one-feedback-box-with-a-kind-toggle-and-dictation.md`.

## The diff

Two commits on this branch: the change itself and a merge of `origin/dev`.

```
git diff d4d9067...HEAD -- src tests drizzle docs
```

Files: `src/types.ts`, `src/db/schema.ts`, `src/store/contracts.ts`, `src/store/pg-feedback.ts`,
`src/routes.ts` (§ feedback), `src/feedback.ts`, `src/feedback-envelope.ts`, `src/messages.ts`,
`src/web/FeedbackDialog.tsx`, `src/web/FeedbackButton.tsx`, `src/web/styles.css`,
`drizzle/20260902161529_feedback_body_and_kind.sql`,
`drizzle/20260902161553_feedback_one_body.sql`, and four test files.

## What changed in response to your review, so you can check the fixes rather than the intentions

1. **The cap.** `MAX_FEEDBACK_BODY_CHARS` (12,072) is the column's CHECK; `MAX_FEEDBACK_ANSWER_CHARS`
   (4,000) is what the route and the dialog hold the reader to. The backfill no longer truncates.
   Is 12,072 actually right — count the headings and separators in
   `drizzle/20260902161553_feedback_one_body.sql` against the old `message()` in `src/feedback.ts`
   as it was, and say if a legal old row can still fail the CHECK.
2. **`body` is `not null`** and `feedback_says_something` is gone. Two migrations: the first adds both
   columns nullable, the second backfills, sets `not null`, drops the three, and adds the wider
   CHECK. Is the ordering inside that second file safe under drizzle's statement splitting, and is
   there any row shape that makes it abort?
3. **The legacy request shape** is accepted: `feedbackBody` in `src/routes.ts` folds
   `steps`/`expected`/`actual` into `body` under the migration's headings, and refuses a body
   carrying both shapes as `[fb-shape]`. Check the caps arithmetic — `MAX_FEEDBACK_BODY_BYTES` is
   back to `3 *` — and whether a stale client can now produce a `body` the *database* refuses (which
   would be a 500 rather than a 400).
4. **The microphone.** `dictationBusy = armed || readOnly` guards both send paths and the Send
   button, and an effect on `open` stops an armed dictation when the dialog shuts. Look for the case
   neither covers: a send in flight when the reader closes, a transcript landing after close, the
   `discard()` path, StrictMode double-invocation, and whether `dictate.dictation.toggle` is stable
   enough to sit in a dependency array without re-firing.
5. **The toggle** is two `aria-pressed` buttons inside a `<fieldset>` with a `<legend>`. Check the
   accessibility of that against a real radio group, and whether `discard()` resets it.

## Also worth your attention, and not from the plan

- **`drizzle/meta/`.** The 0052/141103 fork was repaired independently on `dev` and here; the merge
  took the trunk's repair and re-chained this branch's two snapshots onto
  `20260902150952_realtime_sessions_and_usage` by swapping the `feedback` table into that snapshot.
  Is that snapshot pair actually what a regenerate would have produced — i.e. will the *next*
  `npm run db:generate` emit only new DDL? That is the failure this repo has had twice.
- **The log line** in `fileFeedback` now carries `kind` (the store's answer) and `reportKind` (the
  reader's). Is anything in there text the reader wrote?
- **`asPlainText`** on the failed-send path, and the Sentry `message`.

## What I want from you

Ranked findings. For each: **(a) the concrete failure — the input, the row, the sequence, something I
can run** and **(b) the smallest fix, as a diff or a code block**. A finding with no (a) is an
opinion; put those last and label them. Do not write a patch into the tree.

Say plainly if something is fine. I would rather have three real findings than nine.
