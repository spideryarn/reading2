# Quiz keeps whether an answer was judged right, and spacing adapts

Greg's reply to question [q-m9zkx3](../user-feedback/questions/q-m9zkx3.md) (reply `spya-dxhyu2`,
2026-10-30), about report `spya-fytjtf`. Queue item `qi-ehnr2hsh`. Replaces the flat three-day
comeback of plan [261029m](261029m-quiz-green-for-right-and-a-quiet-time-to-recall-again.md)
(commit `220a723ea`), which is on dev.

> B
>
> — Greg, 2026-10-30 (`spya-dxhyu2`)

Option B, as the question put it: *"Save right/wrong with each answer. The deeper green stays.
Spacing adapts: got it wrong, back in a day; got it right, back in a week, then longer each time you
get it right again."* It named its costs, which this plan pays: a change to the public privacy page,
and a stored machine judgement that is sometimes wrong.

## What this does, in one paragraph

Each finished mark already becomes a `quiz_attempts` row. It now also carries the hidden check's
word — `right`, `wrong`, or nothing when the check failed or declined. The deeper green for *right*
then survives a reload, and the "time to recall it" clock comes back on a schedule that reads the
question's history: **wrong, a day; right, a week, then two, four, eight**. An answer the check could
not judge is never stored as wrong, and changes the schedule as little as possible. Nothing new is
shown in Quiz — no red, no score, no count — and the privacy page, privacy.md and both exports say what is
now kept and why.

```
  answer → mark → hidden check ─┬─ "right" ──┐
                                ├─ "wrong" ──┼─→ quiz_attempts row (verdict column)
                                └─ nothing ──┘        verdict NULL, never "wrong"

  the question's rows, newest first          comes back after
  ─────────────────────────────────          ────────────────
  wrong                                      1 day
  right                                      7 days
  right, right (a day or more apart)         14 days
  right, right, right                        28 days
  right ×4 or more                           56 days (the ceiling)
  nothing judged yet (incl. every row         3 days (261029m's rule, unchanged)
    from before this change)
  the newest try unjudged                    3 days, whatever came before (Sol's F2)
```

## The three things the question flagged, and what each does here

1. **A declined or failed check is not saved as wrong.** The column is nullable and only ever gets
   what `classifyVerdict` returned; `undefined` is `NULL`. `NULL` is skipped by the schedule: it
   neither counts as a right nor breaks a run of them, and when nothing in a question's history is
   judged, or the newest try is unjudged, the schedule is 261029m's flat three days — an unjudged
   answer never inherits a long interval it has not earned. Every row stored before this change is `NULL`,
   so existing readers see exactly what they saw yesterday until they answer again.
2. **An answer edited later is judged again.** It already is, structurally: there is no path that
   saves an answer without marking it, and every mark is a new row with its own verdict (append-only,
   261005b). The schedule reads the newest row first, so a *right* followed by a *wrong* is due in a
   day. A test says so. And the in-box rule from 261029m stays: *right* steps down to plain answered
   when the words in the box are not the words that were judged (`quizLookFor`).
3. **The check is a cheap model and sometimes wrong.** It once called an unanswerable question
   right. A wrong *right* now costs more than one visit's deeper green: it pushes the question out
   to a week. Bounded on purpose — the ceiling is eight weeks, and one *wrong* brings it back to a
   day. A wrong *wrong* brings a question back in a day, which costs a reader one early prompt. The
   privacy page says the check is automatic and sometimes wrong. The verdict's agreement with hand
   labels is the 261029i eval, waiting for the OpenRouter key on 2026-11-01 (`qi-msd5tmda`).

## The schedule, exactly

`recallAfterDays(history)` in a new pure module, [`src/quiz-spacing.ts`](../../src/quiz-spacing.ts),
over one question's rows in one batch, newest first, each `{ verdict: "right" | "wrong" | null,
answeredAt }`. The days count from the **newest** row's time, whatever its verdict.

- No tries, or the **newest** try unjudged → `RECALL_AFTER_DAYS` (3). (The first draft took the
  newest *judged* row's schedule here, which let one failed check keep an eight-week clock; Sol's F2.)
- Newest try `wrong` → 1.
- Otherwise walk back from the newest to the first `wrong` (or the start), skipping `null`s, and
  count a `right` only if it is at least 24 hours **older** than the last one counted
  (`lastCounted.at − this.at ≥ 24h`), so answering again within one sitting does not climb the
  ladder. With `n` counted: `7 × 2^(n−1)`, at most 56.
- **The order is the store's, never re-sorted**: `created_at desc, id desc`, the order the latest
  answer is picked in. Postgres orders by the microsecond and a JS `Date` cannot, so re-sorting in
  JS could pick one row as the answer and schedule from another (Sol's F3).

**Why these numbers.** Greg named the first two (a day, a week) and the shape ("longer each time").
Doubling is the simplest expanding rule; the literature does not pick the factor, and the
retrieval-practice note says a delay matters more than its exact schedule
([01-retrieval-practice.md](../research/261010a-reading-and-learning-evidence/01-retrieval-practice.md)).
The ceiling is a guess that a reader who has got something right four times over two months has it,
and that a question coming back less than every two months is one they will never see again in an
article they may never reopen. What would change them: Greg finding questions come back too often
or too rarely.

**Where it runs.** On the server, the one place that sees the history. The read
(`latestForBatch`) is **one select of the batch's rows**, grouped in TS, so an answer and its
schedule come from one snapshot (Sol's F1: two selects could pair one mark's answer with another's
schedule). The `done` frame carries the schedule for the mark just made, from a history read after
its own insert **cut at that row** (`asOf`), so a mark landing a moment later is not counted into
it. The client draws the look from `answeredAt + recallAfterDays` and never re-derives the
schedule; both the read and the `done` frame go through one parser (`parseRecallAfterDays`), which
turns anything absent or malformed into three days (Sol's F4: `undefined` would have made a question
never due). A mark whose save failed has no history to read: it gets the three days, and is gone on
reload anyway.

## Stages

### Stage 1 — the column, the store, the wire

- `quiz_attempts.verdict text NULL`, `CHECK (verdict in ('right','wrong'))`, no default and no
  backfill. Generated migration `drizzle/<ts>_quiz_attempts_verdict.sql`, applied locally; production
  gets it from the Overseer's deploy. **No separate timestamp column**: the verdict is written in
  the same insert as the row and decided seconds before it, so `created_at` *is* its time; a
  `judged_at` that always equals `created_at` would be a second copy of one fact
  ([sql.md § Store when it happened](../project/sql.md#store-when-it-happened)). If a verdict is
  ever written later than its row, that is when a column is needed.
- `QuizAttemptStore.record` takes `verdict?` and returns `recallAfterDays` beside `id` and
  `answeredAt`; `latestForBatch` returns `verdict?` and `recallAfterDays` per question (a second
  select of the batch's `(question_id, verdict, created_at)`, grouped in TS — tens of rows).
- `markOneAnswer` passes `event.verdict`, and the `done` frame adds `recallAfterDays`.
- `QuizKeptAnswer` gains `verdict?` and `recallAfterDays`.
- The schema's header comment, the route's header comment and `QuizKeptAnswer`'s doc lose "the
  verdict is not stored". The log stays verdict-free: nothing logs it now and nothing will.

### Stage 2 — the client reads it

- `keptFromServer` validates `verdict` (only `"right"`/`"wrong"`) and `recallAfterDays` (a finite
  number ≥ 1, else 3); `noteMark` takes `recallAfterDays` from the `done` frame.
- `KeptAnswer` gains `recallAfterDays`; `quizLook` uses it in place of the constant.
- **What else now persists across a reload, because `QuizPanel`'s verdicts are derived from
  `kept`**: the walk's premise choice and *Where to look again*. Both read the stored verdicts now,
  **except a due answer's** (Sol's F5): a *right* from last week would otherwise hide the next
  premise before the reader has recalled it again. A due answer counts as unjudged there until it is
  answered again. The colour reads `kept` directly. Said in quiz.md.

### Stage 3 — privacy, export, docs

- **The public page** ([`PrivacyPage.tsx`](../../src/web/PrivacyPage.tsx)): the *What you write*
  bullet ends *"When an automatic check can decide, we also keep whether it judged a quiz answer
  right or wrong. It can be mistaken; we use it to colour the question and to decide when to ask it
  again."* — Sol's F6 wording, which says *wrong* is kept too and that some answers are unjudged.
  `LAST_UPDATED` → 30 October 2026. The source comment says why.
- [privacy.md § Quiz answers](../project/privacy.md#quiz-answers): the first bullet rewritten from
  "not stored" to "stored since 2026-10-30, at Greg's request", with his reply and why (spacing,
  the green that lasts), and what stays true: never logged, never shown *in Quiz* as words or a
  score, `NULL` is not `wrong`.
- **Export**: `quiz-attempts.json` rows carry `verdict` (`null` when unjudged); the bundle exports
  whole rows already. The reader's Markdown "your words" export says *"A quick automatic check
  judged this right / wrong; it can be mistaken."* under the mark, nothing when unjudged — it is
  their data, and privacy.md says so (F6). Article transfer and deletion work on whole rows and
  need nothing (F10, which corrected this line). The test seeder that reads `quiz-attempts.json`
  back takes the verdict too.
- **Every stale "not stored / this visit / per visit" claim**, found by a repository search rather
  than from memory (F8): `quiz-mark.ts`, `quiz-verdict.ts`, `quiz-sections.ts`, `quiz.css`, the
  Quiz tip in `marginalia/tips.ts` (which told readers "Green means answered, not right or
  wrong").
- quiz.md (§ Whether the reader got it right, § Answers are kept, § What is deliberately not here),
  learning-vision.md's spacing line, the code comments that say it is not stored
  (`quiz-recall.ts`, `useQuiz.ts`, `QuizPanel.tsx`, `quiz-verdict.ts`).
- Screenshots: the deeper green after a reload, light and dark, and a *wrong* row a day old showing
  the clock — on the local database with inserted rows, no live model (the key is over its limit
  until 2026-11-01).
- Bookkeeping: q-m9zkx3 answered and published; the report's note.

## The plan review

GPT Sol, read-only, [261030c-plan-review-sol.md](261030c-plan-review-sol.md). Ten findings; it
agreed that no `judged_at` column is needed.

| # | Finding | What we did |
|---|---|---|
| F1 | Two selects (and record's post-insert read) can pair an answer with another mark's schedule | One select in the read; `record` cuts its history at its own row (`asOf`), tested |
| F2 | An unjudged newest try inherits an eight-week clock | Newest unjudged → three days |
| F3 | The "a day after" rule read backwards; no tie-breaker | Stated as `lastCounted − older ≥ 24h`; the store's order passed through, never re-sorted; equal-time rows tested against the database |
| F4 | `done` without `recallAfterDays` could make a question never due | One parser for the read and `done`; old-frame and malformed values tested |
| F5 | Stored verdicts now steer the premise and *Where to look again*; a due *right* would hide a premise | Due answers' verdicts left out of the scaffolding; tested red first |
| F6 | Privacy and export wording contradicted itself | Page wording as suggested; "in Quiz" scoping; export's line says it can be mistaken |
| F7 | Tests could pass with wiring broken | `done`-frame scheduling tested without a reload; DB histories; JSON export holds right and `null`; each new wire field mutated once and seen red |
| F8 | Stale claims beyond the ones listed | Repository search; five more fixed |
| F9 | No timer at the due boundary | **Not done.** Any render reads the clock again; a tab left open across the exact threshold sees it on the next interaction. As in 261029m. Device clock skew accepted, future times clamped. |
| F10 | Transfer described wrongly | Corrected; no code needed |

## Simpler options passed over

- **Store the verdict, keep the flat three days.** Half of B: the green lasts, but the spacing
  Greg chose does not happen. Not what he picked.
- **Schedule from the latest verdict only** (wrong 1, right 7, no growth). No history read at all,
  but "then longer each time it is right again" is the part that needs one.
- **Compute the schedule in the browser** from a history the server sends. Two copies of the rule
  or a heavier read; the server already has the rows.
- **A `judged_at` column.** Above: it would always equal `created_at`.
- **Count every right, however close together.** Simpler by one comparison, but re-answering a
  question three times in a minute would push it out to a month.

## Tests

- `tests/quiz-spacing.test.ts`: each row of the table above; `null` skipped and never wrong; a right
  then a wrong is a day (judged again); rights inside a day count once, exactly a day apart twice;
  the ceiling; the given order wins over time; `asOf` cuts a later try; the parser.
- `tests/quiz-attempts-route.test.ts` (Postgres): a verdict is stored and `NULL` when absent; the
  `done` frame and the read carry `verdict` and `recallAfterDays`; an edited answer is judged again
  and a failed check after it is neutral, not a third wrong; two rows in one instant resolve by id
  for answer and schedule alike. Seen red with the route not passing the verdict.
- `tests/marginalia-quiz-answer.test.tsx`: a stored *right* three days old is still the deeper green
  after a reload and a stored *wrong* a day old is due; an old server's answers fall back to three
  days; a wrong marked this visit comes due a day later from its `done` frame alone. Seen red with
  the parse of each removed.
- `tests/quiz-panel.test.tsx`: a stored *right* eight days old shows the next premise, one day old
  hides it. Seen red with the due filter removed.
- `tests/privacy-page.test.ts`, `tests/store-export-covers-tables.test.ts`, `tests/your-words.test.ts`.
