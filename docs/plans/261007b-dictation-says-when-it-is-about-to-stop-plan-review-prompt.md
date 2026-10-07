You are reviewing a plan before it is built. Read-only: do not edit any file.

The plan: docs/plans/261007b-dictation-says-when-it-is-about-to-stop-and-runs-fifteen-minutes.md

Read it, then read the code it names, at least:
- src/web/mic-recording.ts (MAX_MS, the ceiling timer, parts and rotation)
- src/web/useDictation.ts (capped(), startedAt, the shared AudioContext, the stop path)
- src/web/DictationStrip.tsx and src/web/quiet-chime.ts
- src/dictation-limits.ts, src/transcribe.ts (MAX_TRANSCRIPT_CHARS, TIMEOUT_MS)
- src/web/dictation-keep.ts (the IndexedDB copy) 
- src/types.ts (MAX_FEEDBACK_ANSWER_CHARS, MAX_FEEDBACK_BODY_CHARS), src/routes.ts (feedbackAnswer,
  MAX_FEEDBACK_BODY_BYTES, the feedback route, and wherever a stale client's three answers are folded),
  src/db/schema.ts (feedback_body_shape), src/feedback.ts and the Sentry mirror
- docs/project/dictation.md § The sizes, docs/project/security-map.md § Where the defences physically live

Questions to answer, each with file:line evidence:

1. Is raising MAX_MS from 5 to 15 minutes safe as planned? Look for anything that silently assumed
   five minutes: a per-dictation size or memory bound, the IndexedDB keeper, the upload queue, any
   server limiter or timeout, MAX_TRANSCRIPT_CHARS (is it per part or per dictation?), the join of
   parts at Stop, the mic lock, the live recogniser on Chromium over fifteen minutes.
2. Is the claim "this cap is not a defence listed in security-map.md" right? If any part of this
   plan edits a listed defence, say which.
3. The warning design: `endsAt` on the hook, a countdown in the last minute, a chime at the start
   of the last minute and another at the cap. What will go wrong? Consider the ceiling timer being
   a setTimeout (background-tab throttling, a suspended laptop), the countdown and the timer
   disagreeing, the chime being recorded onto the tape, the screen-reader live region, and the
   double-press-on-Stop window after a cap.
4. Stage 2: is raising MAX_FEEDBACK_ANSWER_CHARS to 12,000 with no migration sound? Find every
   reader of that constant and of MAX_FEEDBACK_BODY_CHARS and say what breaks, including a stale
   client's three-answer body, MAX_FEEDBACK_BODY_BYTES against Vercel's 4.5 MB body limit with a
   2 MB screenshot, the Sentry copy, emails, and /admin/feedback. Would you take the migration to
   20,000 now instead, and why or why not?
5. Is there a simpler design that meets Greg's two requests (never stop silently; at least 15
   minutes) that the plan missed? Is anything in the plan more than is needed?
6. Anything else that is wrong, missing or risky.

Answer with findings numbered P1, P2, …, each marked blocker / should-fix / note, and finish with
one line: `VERDICT: approve`, `VERDICT: approve with changes` or `VERDICT: rework`.
