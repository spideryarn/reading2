# Quiz asks only about what you have read, and says how much that is

**Status:** shipped to `dev` · 2026-09-30 · from [SPIDERYARN-READING2-61](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-61),
an admin report (Greg's own account, checked with `scripts/feedback-reporter.ts`). The note is
[260930_0037](../user-feedback/260930_0037-quiz-asks-only-about-what-you-have-read.md).

## What Greg asked for

> I would like to have a sense of which bits of the article the user has read. So what I'd like to do
> is roughly every second or so make note of which blocks are visible in the text on the page. […]
> perhaps we keep an internal sort of log or count of the amount of time spent for each block visible
> on the screen. And then once every so often, I don't know, every minute or something […] send it up
> to the server every minute or so. […] The most obvious thing might be to give a visual indication of
> what you have and haven't read, perhaps in the spine and/or perhaps in the text as well. […]
>
> I think what I went on to say was that if we have, that we can calculate how much you've read of
> the article and how far you've read. That second one is a bit more ambiguous, but anyway. And that
> if we know in, for example, the quiz mode, which blocks each question relates to or which sections
> it relates to, then we can filter. So we generate questions for the whole article, but we might
> filter, you know, if there's a tick box that defaults to only show me questions for stuff I've
> read, and then it would only show quiz questions for the stuff that the user has read.
>
> — Greg, 2026-09-30 (SPIDERYARN-READING2-61; he says some of the dictation was lost)

## What already exists

The first half of this is [reading-time.md](../project/reading-time.md), built 2026-09-16 from
Greg's near-identical report 41: a once-a-second heartbeat that shares each second between the
visible blocks by visible pixels (the "partial points"), totals sent once a minute and on hide,
stored per block in `spideryarn.reading_time`, drawn as a thicker spine and a gutter hairline.
Owner-only, behind the experimental switch. Nothing here builds a second tracker.

So the new parts are two, both client-side and both derived from the levels the page already has:

1. **A quiz tick-box, on by default: "Only what I've read".** The quiz is still written over the
   whole article; the panel walks only the questions whose passages you have read.
2. **How much of the piece you have read**, as a figure next to that tick-box.

## Design

### What "read" means

A block is *read* when its existing `readLevel` is **3 or 4**: on screen for at least 70% of the time
it takes to read at 230 wpm, with seconds shared by visible area. Level 4 alone ("as long as it takes
to read") is too strict — a reader at a brisk pace lands at 3 on most paragraphs, and those
paragraphs *look* read in the gutter. Levels 1–2 are "scrolled past", which is what the filter is for
excluding. One constant, `READ_ENOUGH`, in a new `src/web/read-filter.ts`.

A question is *on what you've read* when **every** one of its evidence blocks is read. Each question
names one to three `QuizEvidence` blocks, which are the passages its reference answer stands on
([quiz.md § A reference answer is not an answer key](../project/quiz.md#a-reference-answer-is-not-an-answer-key));
if one of them is unread, the question is partly about something you have not read.

**How much you have read** is the words in read blocks over all the words in the piece, rounded to a
whole percent, shown as "about 40% read so far". Words rather than blocks, so a read heading does not
count as much as a read page. "How far you've read" — Greg's second, more ambiguous figure — is
deferred (below).

### Where the data comes from

`useReadingTime` already returns `levels`. It gains two fields:

- `enabled` — reading time is on at all (owner, experimental switch on). Off means **no tick-box and
  no figure**, and the quiz is unfiltered exactly as today, because an empty level map is otherwise
  indistinguishable from "read nothing" and would hide every question.
- `ready` — the opening GET has settled (success or failure). Until then the filtered quiz shows a
  quiet "Looking…" line rather than a false "you haven't read any of this yet".

`Reader` hands `{ levels, ready, words }` to `RememberBand` → `QuizSubBand` → `QuizPanel` as one
optional `reading` prop, only for an owner whose reading time is enabled. Remember is already
owner-only, so no visitor arm is needed. `words` is built from `article.blocks` in `Reader`.

### The walk, filtered

The path is still the artefact's array, **never re-sorted and never rebuilt**. The panel's `at`
stays an index into the full array; filtering changes only which indices the reader can land on.

- **Next / Previous** go to the next / previous *included* index.
- **Premise rule.** `showPremise` keys on "arrived by Next from the step immediately before". A Next
  that skips an unread step did not come from the step before, so it passes `arrivedByNext: false`
  and the premise is shown — the premise is then the bridge over the step the reader skipped. That is
  the rule's existing behaviour for a jump, and needs no change in `quiz-ladder.ts`.
- **"Question n of N"** counts included questions only.
- **Show all N** lists included stems; a line under it says how many more are about passages not yet
  read.
- **Levels only rise while the page is open**, so the included set only grows: a question never
  disappears from under a half-typed answer while reading. Ticking the box on while standing on an
  excluded question moves to the nearest included one (through `move`, so the draft and mark go with
  it, as they would on any move); unticking never moves.
- **The first included question** is where the walk opens: if the opening index is excluded once
  levels are ready, the panel shows the first included question instead (derived, no effect).
- **Nothing read yet**: "None of these questions is about a passage you have read yet." with the
  tick-box itself as the way out.

The tick-box is React state, default on, per visit. No URL param, no localStorage — the simplest
version; if Greg finds himself unticking every time, it is a one-liner to remember.

### Privacy

**Nothing new is stored or sent.** The filter and the figure are computed in the browser from the
per-block totals `/privacy` already describes (§ Reading time). No change to published wording.

## Simpler options passed over

- **Filtering on the server** (`GET /api/quiz/:slug?read=…`): a second place that knows about reading
  time, a request per tick-box press, and a quiz response that differs per reader — which is the
  per-reader batch `quiz.md` defers. The client already has both halves.
- **Regenerating the quiz from read passages only**: a model call per reading session and a path
  that changes as you read. Greg said "we generate questions for the whole article".
- **Filtering by section** rather than by evidence block: coarser, and the evidence blocks are exactly
  what a question is about.

## Deferred

- **"How far you've read"** — furthest point, or a "take me to where I got to" button. Already in
  reading-time.md's deferred list; ambiguous in Greg's own words.
- **The figure anywhere but the quiz** (the spine's tooltip, the shelf). One function call once
  there is a place for it.
- **Remembering the tick-box across visits.**
- **Recording for readers with the switch off** — still deferred by reading-time.md; until it moves,
  the filter exists only for experimental readers.
- **localStorage buffering** of unsent seconds, which Greg mentions: the current design drops at most
  a minute on failure rather than risk a double count (reading-time.md), and nothing here changes it.

## Stages

1. `read-filter.ts` (pure: `isRead`, `questionIsRead`, `shareRead`) with tests; `useReadingTime`
   gains `enabled` and `ready`.
2. Plumbing through `Reader` → `RememberBand` → `QuizPanel`; the tick-box, the figure, the filtered
   walk; `quiz-panel.test.tsx` cases.
3. Docs: quiz.md, reading-time.md; the note; Sol code review.

## Reviews

- Plan: GPT Sol, read-only — [six findings, all taken](260930e-quiz-only-asks-about-what-you-have-read-review-sol.md)
- Code: GPT Sol — [one P1 and missing coverage, both fixed by the reviewer](260930e-quiz-only-asks-about-what-you-have-read-code-review-sol.md): a replacement batch could paint for one render at the old batch's index over the old draft (now a synchronous `changingBatch` guard, with a test that goes red without it); tests added for `readShareLabel`, `lastBefore`, a non-OK GET, a slug change and StrictMode.

## Browser check

A Sonnet subagent on its own dev server, commit `96d54a22`, `fowler-phrenology` (12 questions, no model call): the row renders ticked with "about 3% of the piece read so far" and the empty state; unticking shows all 12; about 100 seconds reading question 1's passage moved the figure to 6% and the walk to "Question 1 of 1"; with Experimental off there is no row and all 12 show. **One bug, fixed:** at 390px the figure ran off the band's right edge, clipped. The row is now a wrapping flex row and the figure wraps whole onto its own line; re-checked at 390 and 1280.

## Changes from GPT Sol's plan review

[The review](260930e-quiz-only-asks-about-what-you-have-read-review-sol.md) — six findings, all taken.
They supersede the Design section above where they differ.

1. **A failed opening read is not "read nothing".** `ready` becomes `status: "loading" | "loaded" |
   "failed"`. The filter and the figure apply only on `loaded`; on `failed` the quiz is unfiltered
   with a quiet line saying so.
2. **No derived question under a live draft.** The panel never *displays* an index it has not
   committed. While the filter is active and the question at `at` is excluded, nothing interactive
   is drawn, and an effect moves `at` through `move` (which clears the draft and aborts a mark) to the
   first included index at or after it, else the last one before it. With none included it clears the
   attempt and the draft and shows the empty state.
3. **"Levels only rise" holds only within one `{slug, enabled}` run.** Turning the experimental switch
   off and on resets the levels without remounting the quiz. So the status is keyed to the run
   (`loading` synchronously for a run that has not answered yet), and a status or level change is
   handled as a filter transition by the same rule as 2, not assumed away.
4. **An evidence block that is not in the current article is unread**, whatever the stored totals say
   — reading time keeps totals for block identities a re-extraction removed, and a block missing from
   `words` gets a one-second expected time, so an old id reaches level 4 easily. `questionIsRead`
   takes the set of current blocks.
5. **The figure counts body words only** — `isBody` from `src/block-policy.ts`, the same rule as the
   reading-time clock on the shelf and the masthead, and the same blocks the quiz is written from.
   Skipping a bibliography does not hold you under 100%.
6. **Privacy: the stored totals gain two uses.** Nothing new is stored or sent, but `/privacy` says
   the totals exist "so that the article's outline and margin can show you where you have been".
   Published wording is Greg's, so it is **proposed, not changed** — § Privacy wording for Greg.

## Privacy wording for Greg

The bullet in `src/web/PrivacyPage.tsx` (§ What we keep), with the change in bold:

> **How long you have spent on each part of your articles** — with experimental features on, a
> running total of the seconds each passage has been on your screen, so that the article's outline
> and margin can show you where you have been**, and the quiz can ask only about what you have
> read**. We keep the totals, …

Nothing else in the bullet changes. Until it lands, the page understates one use of data it already
declares; it does not understate what is kept. Listed in `awaiting-approval.md`.
