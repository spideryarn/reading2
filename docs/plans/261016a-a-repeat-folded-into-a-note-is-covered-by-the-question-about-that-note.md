# A repeat folded into a note is covered by the question about that note

Queue item `qi-7j8d72p9` (feedback sweep bookkeeping, an admin's report). Report `spya-tqsw3u`
(#581, Greg's shorter repeat of #580 `spya-x5e966`, Sentry SPIDERYARN-READING2-J2). Up:
[feedback-reports.md](../project/feedback-reports.md).

## The bug

Both reports share one note,
[261015_1711-cell-com-refused-…](../user-feedback/261015_1711-cell-com-refused-the-app-a-better-way-round-and-a-question.md)
(`reports: spya-x5e966, spya-tqsw3u`, `ending: awaiting`), and
[q-fp8tqr](../user-feedback/questions/q-fp8tqr.md) (`report: spya-x5e966`) asks its question. A
question's `report:` names one report, and both readers of "is this waiting report asked about?"
check only that one:

- `scripts/feedback-questions.ts` § `waitingWithoutQuestion` lists `spya-tqsw3u` as waiting with
  no open question;
- the Feedback dialog's *Needs a decision* view (`src/web/FeedbackEarlier.tsx`, the `orphans`
  filter) draws it under *Waiting, but no question written yet*, with nothing to answer.

**The class:** every repeat folded into one note (feedback-reports.md § The run, step 1, says to)
is a second report id on an awaiting note, and the question about that note can name only the
first. Each one is listed as unasked, by the script and in the dialog, and there is nowhere to
write that it is not.

## The fix

**Say it in the question: an optional `repeats:` header**, the reports folded in as repeats of the
one `report:` names, which this question answers too.

```
report: spya-x5e966
repeats: spya-tqsw3u
```

- **Parsed** by `parseQuestionFile` (`scripts/feedback-endings.ts`): comma-separated report ids,
  none twice, none equal to `report`, and refused under `report: none` (a repeat of nothing).
  Absent means none. Never sent to the browser as words; it reaches the server only as below.
- **One function decides "asked"**: `askedReports(questions)` — the `report` and `repeats` of
  every open question. `waitingWithoutQuestion` uses it, and the generator writes it, sorted, into
  `src/feedback-questions.generated.ts` as `FEEDBACK_ASKED_REPORTS`, server-only like
  `FEEDBACK_QUESTION_ACTED`.
- **The listing says what to do:** a waiting report with no question is now told *write its
  question (--new), add it to `repeats:` of the question that already answers it, or correct its
  note's ending*. That is the class's remedy, offered at the place the sweep finds it, so the next
  repeat is a one-line fix rather than a puzzle.
- **The server marks the rows; it filters nothing.** `GET /api/admin/feedback/earlier` gives each
  admin row `asked: boolean`, true when the id is in `FEEDBACK_ASKED_REPORTS`. Rows, counts and
  `more` are untouched, so the client's envelope check (`more === counts[show] > rows`) still
  holds, and the store's pagination is not second-guessed after its limit (Sol's first plan
  review, findings 1 and 2).
- **The dialog reads it.** A row is drawn under *Waiting, but no question written yet* only when no
  thread names it and it is not `asked`. Typing: `AdminEarlierFeedback.asked: boolean` (what the
  server sends now); the wire row has `asked?: boolean`; the admin validator refuses a present
  non-boolean; absence is made `false` where `addenda` absence is made `null`, before an
  `AdminRowReport` exists. So a server from before this (mid-deploy, rollback) is drawn exactly as
  today, and an older tab ignores the key, since the admin row check is not key-exact (Sol's
  second review, finding 2).
- **Keyed by bare id**, the same accepted limit as the endings (`src/feedback-ending.ts`): ids are
  unique per owner, so a stranger's report with the admin's report's id, named by an open question,
  would mark the admin's row asked and keep it off the no-question list. Not owner-safe; the same
  collision risk the endings already carry, and as unlikely.
- **This report:** `q-fp8tqr` gets `repeats: spya-tqsw3u`.
- **The run's step 1** (feedback-reports.md), where a repeat is folded into a note, says: if that
  note's question is already written, add the repeat to its `repeats:`.

No change to the counts, the thread shape, or any non-admin answer.

### The options passed over

**Work coverage out from the notes** — a report sharing an awaiting note with the one a question
names is covered (this plan's first two drafts). Rejected by both of Sol's plan reviews: a
question names a report, not a note, and a report's open question can be about a different note,
even a shipped one's follow-up (`q-xd9es7` is). So a report would be hidden although nobody had
asked about its note. Counting awaiting notes does not fix that. The relation has to be written
down by whoever knows it, the agent writing or folding.

**Let `report:` take several ids.** The same information, but `report` is what the thread draws
beside the question and what the server looks up owner-scoped; a list there changes the thread's
shape (one linked report) and needs a `questions=4` wire version. A separate field leaves `report`
meaning what it means.

**Drop the asked rows on the server.** The client checks `more` against the counts and would
refuse the whole answer as `[fb-list]`, and filtering after the store's `limit + 1` can hide a real
orphan on the next page.

## Tests, red first

- `tests/feedback-questions.test.ts`: a waiting report named in an open question's `repeats:` is
  not listed; one in an answered question's is; on the committed files `spya-tqsw3u` is not
  listed.
- `tests/feedback-endings.test.ts`: `repeats:` parses; a duplicate, an id equal to `report`, a
  non-id, or one under `report: none` is refused; the questions module carries the asked set, and
  `repeats` of an answered question is not in it.
- `tests/feedback-route.test.ts`: each admin row carries `asked`, under every `show`; rows and
  counts unchanged.
- `tests/feedback-dialog.test.tsx`: an `asked` waiting row is not drawn as an orphan; a row without
  the key is drawn as before; a non-boolean `asked` fails the answer.

## Docs

[feedback.md](../project/feedback.md) and [feedback-reports.md](../project/feedback-reports.md)
each define an orphan as a waiting report no open question is about; both say `repeats:` counts.
The question format in feedback-reports.md § To ask gets the field.

## Bookkeeping

Name `spya-tqsw3u` in the covering note as today (it is). Nothing the reader sees changes beyond
the stray row going, so no new note. Run `npx tsx scripts/feedback-endings.ts`.
