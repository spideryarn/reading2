# Quiz answers are kept, and restored when you come back

Report `spya-e8ujxn` (Sentry SPIDERYARN-READING2-CA), queue item `qi-wdxddd4z`. Greg, 2026-10-04:

> I think when I tried with the quiz, I answered a question or two and then came back to it and it
> looked like the answers had been thrown away. Is there a way for us to store those answers? Is
> that very complicated? If so, let's discuss.

The Overseer's brief: find out what is stored today, store the reader's answers with timestamps if
they are not, restore them on return; if it turns out complicated, put the open choice to Greg as a
question rather than waiting.

## What is true today

Nothing is stored, on purpose ([quiz.md § What is deliberately not here](../project/quiz.md)). The
answer, the mark and the "answered" tick are React state in `QuizPanel` and `useQuiz`, so they go:

- on a reload;
- on leaving Quiz for another mode and coming back (the band unmounts) — most likely what Greg met;
- **on pressing Next and then Previous inside one visit** (`move` clears the attempt and the box).

The public privacy page says so in as many words: *"Quiz answers are the exception: they go to a
model to be marked and are not stored."* So this change reverses a published sentence. Greg asked
for the storing, which is the decision; the sentence has to follow it or it becomes false.

## What we build

One stage. Not complicated: one table, one write, one field on a read, and the panel restoring from
a map.

### The table

`spideryarn.quiz_attempts`, one row per **finished** mark, append-only:

| column | |
|---|---|
| `id` | uuid, primary key |
| `article_id` | → `articles.id`, `on delete cascade`. No `owner_id`, as `reading_time` and `glossary_hidden_entries`: only the owner writes, and ownership is inherited through the article |
| `batch_id` | text — the quiz batch the answer was marked against |
| `question_id` | text |
| `question` | text — the question's words at the time, so a row still means something after *Write them again* has replaced the batch (the batch lives in one JSON column that is overwritten) |
| `answer` | text, the reader's words as sent to the marker; CHECK on length ≤ `MAX_QUIZ_ANSWER_CHARS` |
| `reply` | text, the mark exactly as the reader saw it |
| `created_at` | `timestamptz not null default now()` — when the mark finished. The database stamps it |

Index on `(article_id, batch_id, question_id, created_at desc)`.

**Append, not upsert.** Answering a question again adds a row; the read takes the latest per
question. Same cost to build, and it keeps when each try happened (AGENTS.md § Store when it
happened).

**The right/wrong verdict is not stored.** quiz.md and privacy.md both refuse a stored grade, and
restoring answers does not need one. What that costs: after a return, the next step shows its
premise (the "no verdict" case, which already errs towards help), and *Where to look again* starts
empty until something is answered this visit. Open question Q-quiz-verdict below.

**Rows for a replaced batch are kept, not deleted and not shown.** Greg, 2026-10-02: *"ok to lose
answers"* on Regenerate — they are lost from the screen. They stay in the table and in the export,
readable because of the `question` column.

### The write

In `markOneAnswer` (src/routes.ts), when `markAnswerStream` yields its one `done`: insert the row,
**then** send the `done` frame. A new `quizAttemptStore.record(slug, {...})` in
`src/store/pg-quiz-attempts.ts`, shaped on `pg-reading-time.ts` (`articleIdForOwned`,
`guardDbStore`).

- A write that fails must not fail the mark: the reader has watched it arrive. Catch it,
  `captureFailure`, and send `done` with `saved: false`. The panel then does not tick the question
  as kept — see below — so a failed save is not silent.
- A reader who left gets no `done` from the stream, so nothing is stored. Right: no finished mark.
- Nothing about the answer or the reply is logged.

### The read

`GET /api/quiz/:slug` gains `attempts`: for the **current batch only**, the latest row per question
— `{ questionId, answer, reply, answeredAt }`. One query beside `loadQuiz`. Riding on the existing
read (rather than a second endpoint) means the panel gets questions and answers in one commit and
there is no second loading state. A read of attempts that fails does not take the questions away:
`attempts: []` and the failure captured.

### The client

- `useQuizRead` (which lives in `OwnedReader`, so it outlives the band) holds
  `saved: Map<questionId, {answer, reply, answeredAt}>`, seeded from every GET and added to by
  `mark` on a `done` with `saved !== false`. This one map replaces the `answered` set in `useQuiz`:
  the tick is "there is a kept answer", one source instead of two.
- `QuizPanel`: when the panel lands on a question (mount, `move`, the batch reset, the arrival and
  filter effects that go through `move`) and `saved` has it, the box is filled with the kept answer
  and the attempt is set to `{status: "done", reply, answer}` through a new `owner.showSaved(id)`.
  Everything downstream already works from that shape: `superseded`, the filled Next, "— answered".
- **Which question opens is unchanged: the first.** It now shows the kept answer and its mark, which
  is what says "nothing was thrown away". Opening at the first unanswered question instead is
  Q-quiz-resume below.
- A restored mark shows no verdict-driven behaviour, and no new copy: no "saved", no date.

### What else has to hear about it

- **Export**: `quiz-attempts.json` in the article bundle (`tests/store-export-covers-tables.test.ts`
  will insist).
- **Privacy**: `PrivacyPage.tsx` — quiz answers and their marks move onto the kept list and the
  exception sentence goes; `docs/project/privacy.md` records the reversal and why.
- **Docs and comments that say "nothing is stored"**: quiz.md (§ What is deliberately not here, the
  `batchId` paragraph, § On screen "not in the URL"), `markOneAnswer`'s header, `useQuiz.ts`'s
  header, `QuizPanel`'s `superseded` comment ("nothing stores it"). The 0046 migration comment is
  history and stays.
- **Help page** (`/help`): a line if it mentions the quiz forgetting; otherwise none.
- Not the public page (a visitor has no quiz), not the *make public* dialog (`NeverShared` already).

## Passed over

- **`localStorage`.** Simpler — no table, no privacy change. But it does not follow the reader to
  the iPad, which is where the report came from, and Greg asked to *store* them.
- **Only fixing the in-visit loss** (keep the map in `OwnedReader`, no table). Fixes mode switches
  and Next/Previous, not a reload or another device. It is the client half of this plan, so it is
  not thrown away — but on its own it leaves "came back" half-answered.
- **A client `PUT` after the mark.** A second request that can fail separately from the mark it
  describes, and a body that could carry a reply the model never wrote.

## Tests, red first

- `tests/quiz-mark-route.test.ts`: a finished mark, then `GET` returns it under `attempts`; a second
  answer to the same question returns the later one; a batch that has been replaced returns none; a
  failed mark stores nothing; a store that throws still sends `done`, with `saved: false`.
- `tests/quiz-panel.test.tsx`: answer, unmount, mount again → the answer and its mark are there and
  the question says answered; answer, Next, Previous → the same; a new batch → nothing restored;
  editing a restored answer shows the "previous answer" note.
- The schema gates that fire on their own: `action-tables-have-created-at`, `store-export-covers-tables`,
  `db:chain`, `migration-snapshots`.

## After GPT Sol's plan review

[The review](261005b-quiz-answers-plan-review-sol.md) of `bed0d44c8`: build with changes. All eight
findings accepted; where this section and the text above disagree, this section wins.

- **F1, the offline cache.** `src/web/lib/api.ts` deliberately does not invalidate the cached quiz
  GET on a mark, so a reload offline would bring back "unanswered". After a mark that was saved, the
  cached quiz response is refreshed through the existing cache machinery (a background re-read is
  enough); a failed mark must not evict the questions. Test: cache, answer, restore offline.
- **F2 and F7, two maps, not one.** The server's `attempts` and **this visit's finished marks** are
  kept apart in `useQuizRead`: `fromServer` (replaced by each GET that carried attempts) and
  `thisVisit` (added to on every `done`, saved or not, never touched by a GET, cleared only by a new
  batch or slug). What the panel reads is, per question, whichever is later by `answeredAt`. So a GET
  that started before a save cannot erase it, and a finished mark whose save failed is still there
  after Next → Previous. `record()` returns the row's `created_at` and `done` carries it as
  `answeredAt`; a failed save uses the client's clock and carries `kept: false`, and the mark shows
  one quiet line, *"This answer could not be saved, so it will not be here when you come back."*
- **F3, one restoring effect.** Not inside `move`. A single effect after the navigation effects,
  keyed on batch and the id of the question actually on screen: if there is no attempt for that
  question and the box is empty, fill both from the kept answer. It never overwrites a draft or a
  live mark. Tests: batch + filter + arrival in one commit, same-index arrival, StrictMode.
- **F4, a restored mark is not a new mark.** The restored attempt carries `restored: true` and the
  verdict effect skips it, so Next → Previous does not delete a verdict earned this visit. A new
  mark with no verdict still clears the old one.
- **F5, "could not read" is not "none".** `attempts: null` when the attempts read failed; the client
  then keeps what it had for the same batch, and on an opening read says, quietly, that the kept
  answers could not be loaded, with the band's existing retry.
- **F6, both exports.** `ArticleRows`, `readArticleRows`, both `ARTICLE_TABLE_COVERAGE` destinations,
  and the serialisers in `src/store/export.ts` (rollback) and `src/store/export-bundle.ts` (the
  reader's), each tested with a sentinel attempt including one from a replaced batch.
- **F8, the save boundary.** A reader who leaves during the verdict call still gets a `done` from
  `markAnswerStream`, so the row is written with nobody listening. That is the rule, not an accident:
  **a mark that finished is kept, whether or not its last frame was delivered.** Tested.
- **Append stays.** Sol notes a latest-answer upsert is the smaller product scope. Kept as append
  because the code is the same size and the times of earlier tries are the thing Greg's "store when
  it happened" asks for; the `question` column is what makes those rows mean anything.
- Recorded, no work: the article foreign key covers deletion and account erasure; a successor
  revision keeps the article id; reset keeps the rows; the public payload and admin views are
  explicit projections and do not pick the table up. One test that a non-owner and the public read
  get no attempts.

## Open questions for Greg (not blocking)

- **Q-quiz-verdict** — keep the hidden right/wrong with each stored answer, so that after a return
  the quiz still knows which steps need their hint and *Where to look again* is still filled in?
  Recommended: not yet. It is the stored grade the privacy doc promises we do not keep.
- **Q-quiz-resume** — on coming back, open at question 1 with your answer showing (built), or jump
  to the first question you have not answered? Recommended: the jump, as a follow-up, once the first
  version has been used.

## What landed

Built 2026-10-05, in one stage, as the section above describes. Where things are:

- **Table and migration**: `quizAttempts` in `src/db/schema.ts`;
  `drizzle/20261005032955_quiz_attempts.sql`. The answer's CHECK is `char_length between 1 and 4000`.
- **Store**: `src/store/pg-quiz-attempts.ts` (`record`, `latestForBatch`), `QuizAttemptStore` in
  `contracts.ts`, `quizAttemptStore` in `index.ts`.
- **Route**: `markOneAnswer` writes the row and then sends `done` with `answeredAt` (or
  `kept: false`); `GET /api/quiz/:slug` adds `attempts` (`null` when that read failed).
- **Client**: `useQuizRead` holds `fromServer` and `thisVisit` and exposes `kept`, `keptUnread`,
  `noteMark`; `useQuiz` derives `answered` from `kept` and adds `showKept`; `QuizPanel` has the one
  restoring effect, the `restored` skip in the verdict effect, and the two failure lines.
- **Exports**: `quiz-attempts.json` in both.
- **Tests**: `tests/quiz-attempts-route.test.ts`, `tests/quiz-kept-answers.test.tsx`, and cases added
  to `store-export-covers-tables`, `api-fetch-offline`, `privacy-page` and `public-reads`.
- **Docs**: [quiz.md § Answers are kept](../project/quiz.md#answers-are-kept),
  [privacy.md § Quiz answers](../project/privacy.md#quiz-answers), export.md, and `/privacy`.

Five things were decided while building, none of them a change of design:

- **The restoring effect is keyed on the batch, the question drawn and its kept answer, and reads
  the box and the attempt without depending on them.** Keyed on them too, a reader who typed over
  an empty box and then cleared it would have had their old answer jump back in.
- **It restores only when there is no attempt at all**, not merely none for this question. Every
  road to a new question goes through `move`, which clears the attempt, so the two are the same in
  practice; the stricter test cannot replace a mark in flight.
- **A failed save's time is this machine's clock, but never earlier than an answer already held
  for that question.** The merge takes the later of two and the other is stamped by the server, so
  a slow laptop clock would otherwise put the older, saved answer back over the newer one (F7's
  second case). Tested with a server time in 2099.
- **A `done` with no `answeredAt` counts as not saved**, as well as one with `kept: false`: that is
  what a server from before this change sends during a deploy, and it stored nothing.
- **F1 is a re-read, not a cache write**: `useQuiz.mark` calls the read's `refresh` after a stored
  mark, which also serves F2 (it trails a read already out). The exemption in `lib/api.ts` is
  unchanged and its comment now says why it survives.

Not built, as planned: no stored verdict, no change to which question opens, no change to either
prompt. `/help` says nothing about quiz answers being forgotten, so it did not change.

### GPT Sol's code review, and the browser check

[The code review](261005b-quiz-answers-code-review-sol.md) of `523e771cf`: approve with the fixes
made, committed as `96901255c`. Three findings, all fixed by the reviewer, red first:

- **C1 (P1)**: a question opened from the prose could have its box filled with the answer of the
  question that was open before. The restoring effect now waits for the arrival's destination.
  [Postmortem 261005d](../postmortems/261005d-later-effects-still-read-the-render-before-earlier-state-writes.md).
- **C2 (P1)**: a read that came back with `attempts: null` replaced the offline copy and erased the
  answers in it. A complete copy of the same batch is now left alone.
  [Postmortem 261005e](../postmortems/261005e-a-partial-success-must-not-replace-a-complete-offline-copy.md).
- **C3 (P3)**: quiz.md said the privacy page publicly promises no stored verdict; the page says
  nothing about verdicts. Reworded.

One round, not two: the only code after the review is the reviewer's own, plus one control test.

**Browser** (a Sonnet subagent, Playwright, local dev server, article `fowler-phrenology`): an answer
and its mark came back after Next then Previous, after leaving for Chat and returning, and after a
reload, with the right answer under the right question; the list ticks them; the "previous answer"
note works on a restored answer; no "saved", date or right/wrong word appears; at 820 and 390 wide
the restored box shows the whole answer with no inner scroll and nothing overflows.

Two limits on that check. OpenRouter began refusing the marking call (403) part-way through, so a
**fresh** mark was only seen at desktop width; iPad and phone were checked on restoring and layout.
And twice, after a refused mark on a later question, the panel was seen back on question 1; three
later attempts did not repeat it. The reviewer was editing `QuizPanel.tsx` under that dev server at
the time, and a hot reload resets the panel to question 1, which is the likely cause but was not
proven. `tests/quiz-kept-answers.test.tsx` now has the control: a failed mark on question 3 leaves
the reader on question 3 with their words.
