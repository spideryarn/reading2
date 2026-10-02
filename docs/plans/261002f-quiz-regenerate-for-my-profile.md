# Quiz gets the "written for your profile" badge, and Regenerate in its panel

Follow-up to [261002b](261002b-written-for-your-profile-panel-edit-in-place-and-regenerate.md)
(fb7s, `spya-nq6hnu`), which gave every other profile-aware mode the badge and its panel and left
Quiz in § Deferred for two reasons: its GET carries no `profileChanged`, and regenerating writes a
new batch and loses the answers already given. Owner entry points: [quiz.md](../project/quiz.md)
and [reader-profile.md](../project/reader-profile.md).

> Q-quiz-regenerate yes it needs a "Regenerate for my profile". That's more important, ok to lose
> answers.
>
> — Greg, 2026-10-02

## What gets built

### 1. The quiz records which profile it was written for

- `Quiz` (src/types.ts) gains `profileHash?: string | null` — `hashProfile` of the rendered profile
  the run used, `null` for none, **absent on a quiz written before this change** (exactly the shape
  `Ideas` has). Set in `generateQuiz` from the `profile` it already takes, as `generateIdeas` does.
- **Not in the stamp.** `pipeline.ts`'s `quiz.stamp` is unchanged, so a changed profile still makes
  nothing stale and never rewrites a quiz on its own — the rule Simple follows too
  ("the quiz's rule"). Greg's *"no automatic regeneration needed for v1"* still stands; the button
  is the decision.
- `GET /api/quiz/:slug` goes through the shared `withProfileChanged` (src/routes.ts), like Simple,
  Ideas, Sketch. `QuizResponse` gains `profileChanged: boolean`, and `QuizFound` becomes
  `Omit<QuizResponse, "profileChanged">` like its neighbours. No second mechanism.

### 2. The make-public dialog does not list the quiz

`ProfileCarrying` (src/store/pg.ts) is derived from every artefact type with a `profileHash`, and it
drives both `personalisedSteps` (the owner's *make public* dialog: "these were written for your
profile") and `OWNED_ARTEFACT`'s coverage check. The quiz is **not in a shared link** —
`PublicArtefacts` has no `quiz`, `public-reader.ts` never reads the column — so telling an owner
"your quiz questions were written for your profile" before they share would describe something the
visitor never receives. That is the reason src/quiz.ts gave for having no `profileHash` at all.

So: `ProfileCarrying = Exclude<derived, NeverShared>` with `type NeverShared = "quiz"`, one named,
commented decision. Every *other* artefact gaining a `profileHash` still fails the compiler at
`personalisedSteps` and at the `OWNED_ARTEFACT` check, which is the property that exists for.

### 3. The badge and Regenerate in the Quiz band

- `useQuizRead` reads `profiled` (`quiz.profileHash != null`) and `profileChanged`, as `useIdeasRead`
  does, and exposes `refresh` (it already has one).
- `QuizPanel`'s `head` row, beside the Recall | Quiz control, renders `<WrittenForYou>` with
  `regenerate = { run: owner.write, busy: job || starting, refresh, consequence }`. `owner.write` is
  the existing forced run — the same call *Write them again* and Metadata's Quiz row make; forcing is
  safe because the step replaces.
- **The consequence is said before the press.** `Regenerate` (src/web/ProfilePanel.tsx) gains an
  optional `consequence?: string`, rendered as a visible line beside the button when present. Quiz
  passes *"Writes new questions for your profile; your answers so far are cleared."* A visible line
  rather than a `title` tooltip: ProfilePanel already refuses native tooltips (they are invisible on
  touch, and the iPad is where Greg uses this), and rather than a `confirm()`, which would be a second
  modal on top of the panel for a decision the line already explains.
- **The answers going is already how a new batch works**: the `batchId` effect in QuizPanel clears
  the index, verdicts, draft and mark, and `useQuiz` clears the ticks. Nothing new to build there;
  a test pins it for this path.
- **Held until the replacement has been read (Sol, P1).** `busy = job || starting` covers the post
  and the run, but a finished job leaves `job` before its `refresh` GET lands — and a failed GET
  keeps the old batch *and its old `profileChanged: true`*. Reopening the badge then would offer a
  second paid rewrite. So the quiz read (`useQuizRead`, since the code review — see below)
  remembers the `batchId` a forced run was pressed on and `useQuiz` reports
  `rewriting` while that batch is still the one on screen and the job has not failed; Regenerate's
  `busy` includes it. A new batch, or a failed job, releases it.

## Tests, red first

- `quiz.test.ts`: `generateQuiz` with a profile records `hashProfile(profile)`; without one, `null`.
- Route: `GET /api/quiz` answers `profileChanged: true` when the stored hash differs from the
  reader's current profile, `false` when equal / absent (the shared rule, `profileIsStale`).
- `profile-panel.test.tsx`: a `consequence` is shown beside Regenerate; absent when not passed.
- `quiz-panel.test.tsx`: the badge appears for a profiled quiz; with `profileChanged`, the panel's
  Regenerate shows the consequence and posts a **forced** `quiz` job; a new batch clears the ticks.
- Type-level: `personalisedSteps`' record compiles without a `quiz` key (it would not, today, if
  `Quiz` gained the field without the exclusion — seen red by adding the field first).

## Simpler options passed over

- **No badge, just a Regenerate button in the quiz head.** Smaller, but it is a second way to show
  "this was written for you / for an older profile", and Greg asked for "the same panel".
- **Listing the quiz in the make-public dialog** (no exclusion). One fewer type; but the sentence
  would be false about a shared link, and that dialog's postmortem
  (260830c-the-dialog-said-nothing-was-personalised) is about exactly a false sentence there.
- **A `confirm()` before regenerating.** The line beside the button says the same before the press,
  without a second dialog.

## Deferred, named

- **A quiz written before this change has no recorded profile hash**, so it shows no badge and no Regenerate until it
  is next written (Metadata's Quiz row, or the stale banner). Inferring "written for some profile"
  from absence would put a badge on quizzes written before 2026-09-30, when the prompt ignored the
  profile.
- **Stored answers** are still not stored; "cleared" means the ones on screen this session.
- **A dictated answer still recording when the new batch arrives (Sol, P1)** could land in the new
  batch's empty box: the batch reset clears `typed` but does not stop the answer's dictation. It
  needs the microphone left recording through the whole rewrite (about a minute), and it is the
  same pre-existing path *Write them again* has had since 260930c; binding dictation delivery to
  the question is a change to `useDictationField` for every box, not to this feature.
- **The same post-job window in the other modes' Regenerate.** Ideas, Tweets, Summary and Sketch
  pass `busy = job || starting` too; this plan closes it for Quiz only, where the batch id makes it
  one line. Named for whoever next touches `Regenerate`.

## Review

GPT Sol's plan review: [261002f-quiz-regenerate-plan-review-sol.md](261002f-quiz-regenerate-plan-review-sol.md).
No P0; P1 2 accepted (above), P1 1 deferred with the reason above. It confirmed excluding the quiz
from `ProfileCarrying` breaks no other consumer and that no public path reads the column.

## Code review

The code review fixed two gaps in `QuizPanel`: *Write them again* in the stale banner now obeys
`rewriting`, and a held batch offers *Read the new questions* so a failed GET can be retried
without another paid run. Red-first panel tests and a real reader/job-hook integration test cover
both stale and current batches through a delayed read, a failed read, and read-only recovery.

**Its P1 left open, now fixed.** The hold was local to `useQuiz`, which unmounts when the reader
leaves Quiz; returning before the replacement GET succeeded re-enabled paid Regenerate on the old
batch. The hold now lives in `useQuizRead` (`held`, `hold`, `release`), which lasts as long as the
article page. A successful read of a different batch releases it; so does a failed or cancelled
job, as the band saw it. And for a job that failed while the band was closed — which a fresh
mount's `useStepJob` cannot know was ours — the band releases once the job list has loaded and is
idle **and** a read has landed since: with no job running, a read showing the same batch is the
server saying nothing replaced it. A read that is pending or fails keeps the hold. `useStepJob`
passes `loaded` through for this. Two tests in tests/quiz-regenerate-revalidation.test.tsx, each
seen red against a mutant (a band-local release on mount; no idle release).
Root cause: [postmortem](../postmortems/261002f-a-band-local-hold-cannot-protect-a-job-that-outlives-the-band.md).

**And the browser check found the panel's foot clipped.** With the consequence line, the panel
content was 527px in a 480px panel: Regenerate sat below the fold on open, at both widths. The
consequence line and the action row are now a sticky footer (`.prof-panel-foot`), so Regenerate
and Done are in view on open in every mode's panel.
