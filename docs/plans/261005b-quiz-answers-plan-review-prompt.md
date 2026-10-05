# Plan review: quiz answers are kept and restored (261005b)

You are reviewing a **plan**, before anything is built. Read-only: change no file.

## The candidate

`docs/plans/261005b-quiz-answers-are-kept-and-restored.md`, as committed on the branch
`worktree-fb-quiz-answers-kept` in this worktree (the commit whose subject starts `261005b: plan`).
Nothing else has changed from `origin/dev`.

## What it is for

A reader (Greg, an admin) reported that quiz answers vanish when he comes back to the quiz. Today
nothing is stored, by design. The plan stores each finished mark in a new table, written server-side
when the mark completes, returns the current batch's latest answers with `GET /api/quiz/:slug`, and
has the panel restore them. Greg asked for the simplest version that gets most of the value.

## Read first (this does not limit scope)

- `docs/project/quiz.md` — the feature, and what it deliberately does not do
- `src/routes.ts` § `markOneAnswer`, § `refuseAMovedQuiz`, and the `GET /api/quiz/:slug` route
- `src/web/useQuiz.ts` (both hooks) and `src/web/QuizPanel.tsx` (the effects that set `at`, `move`,
  `superseded`, the verdict effect)
- `src/store/pg-reading-time.ts` and `src/db/schema.ts` § `readingTime`, § `glossaryHiddenEntries` —
  the tables this one is shaped on
- `docs/project/sql.md`, `docs/project/privacy.md`, `src/web/PrivacyPage.tsx`
- `src/store/export.ts`, `src/store/export-bundle.ts`

## What I want

An independent attack on the plan first. In particular: is there a simpler design that gets most of
the value; is anything here wrong against the code as it is; what would ship broken if built exactly
as written; what has to hear about a new per-reader table that the plan does not name (export,
deletion, article reset, successor/copy of an article, account erasure, the public read, admin
views); and whether the client restore can be built on `QuizPanel`'s existing effects without a
race (the batch reset, the reading filter and the prose arrival all set `at` in one commit).

Severity, by consequence:

- **P0** data loss, exploitable security, incorrect charging, or the service broadly unusable
- **P1** user-visible wrong behaviour, or an authoritative contract violated
- **P2** design or maintainability risk with no wrong behaviour today
- **P3** non-behavioural prose or comment defect

Give every finding an id (F1, F2, …), its severity, the file and line it rests on, and the change to
the plan you would make. End with a one-line verdict: build as written / build with the changes
above / do not build.

## My own suspicions (already mine; spend most of the run elsewhere)

- Whether `attempts` belongs on the quiz GET, given `useQuizRead` runs for every opened article.
- Whether the `question` text column is worth having.
- Whether replacing the `answered` set with the `saved` map loses the "a failed save" case.
- Whether keeping rows for replaced batches is the right default for a privacy-minded product.
