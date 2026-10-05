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

## Open questions for Greg (not blocking)

- **Q-quiz-verdict** — keep the hidden right/wrong with each stored answer, so that after a return
  the quiz still knows which steps need their hint and *Where to look again* is still filled in?
  Recommended: not yet. It is the stored grade the privacy doc promises we do not keep.
- **Q-quiz-resume** — on coming back, open at question 1 with your answer showing (built), or jump
  to the first question you have not answered? Recommended: the jump, as a follow-up, once the first
  version has been used.

## What landed

(filled in at the end)
