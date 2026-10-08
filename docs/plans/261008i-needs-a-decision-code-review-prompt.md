Code review of plan 261008i in the Spideryarn repo, in this worktree. You have write access: FIX what
you find inside this change (the files it touches and their tests), then report. Do not commit, and
run no git command that changes the index or the working tree beyond your own edits (no checkout,
restore, stash, reset). Do not touch production, .env*, infra/ or systemd. Do not edit the admin
prefix gate or any defence listed in docs/project/security-map.md § Where the defences physically
live; if a fix would need that, report it instead.

The change: `git diff a7ccdb2ba..6d5f0b934` (one commit). The plan, with both of your plan reviews
and how each finding was answered: docs/plans/261008i-needs-a-decision-becomes-threads-you-can-reply-to-or-defer.md
(read "What the plan review changed", both rounds; they amend the numbered decisions). The bug's
postmortem: docs/postmortems/261008c-needs-a-decision-lists-reports-nobody-can-answer.md. The doc
for readers of the code: docs/project/feedback.md § Questions for an admin.

Evidence already gathered (check it, don't trust it):
- `npm run typecheck` clean; tests/feedback-dialog.test.tsx 230 pass; feedback-route 76,
  feedback-store + owner-isolation + db-schema* pass against the local database; feedback-endings,
  feedback-questions, feedback-question-values pass.
- A browser check (Chromium 1440×900 and WebKit iPhone 13, plus 390×420 as a keyboard stand-in)
  passed every flow: shortcut + count + tooltip, opening on Needs a decision, contents, pager,
  Details shut, the reply box growing with no inner scroll, send → replied group, defer → deferred
  group, bring back; no console errors.
- Known and accepted: an open thread stays open across closing the dialog (so a dictation in
  flight is not unmounted); the shortcut appears only once the opening read lands; F10 (part
  numbers on split notes) declined.

Look hardest at:
1. The state rule end to end (src/feedback-question-values.ts questionState; src/routes.ts
   questionsForAdmin; src/web/FeedbackEarlier.tsx withLocal, questionsOf, the clock/tick and
   startedAt): can a receipt be retired by a read that started before it, or kept forever? Can the
   pill/shortcut counts disagree with the groups?
2. The opening read and the default filter (useEarlierFeedback: the effect that loads, the
   choices counter, the move to All, the close reset, the 404 fallback): double reads, a read that
   never happens, a move to All that overrules the reader, a stale generation.
3. The deferral route and store: the conditional upsert (`onConflictDoUpdate ... setWhere`),
   concurrency, the 409 for answered questions, the parser, owner scoping, the script's
   provenance check and absent-table handling (scripts/feedback-questions.ts runAnswers).
4. Wire compatibility: `questions=2` negotiation on the server; withLegacyQuestions and the strict
   validators on the client (exact key sets, deferredAt iff deferred).
5. The compiler change (combineEndings returns null for an incomplete split; compileEndings'
   `incomplete`; FEEDBACK_QUESTION_ACTED; the Details rule) and every consumer of the endings map,
   including scripts/feedback-shipped-emails.ts, which reads the generated file at a commit.
6. Anything a reader-facing sentence claims that the code does not do (for example "The next
   feedback sweep lists them to write one" in EarlierList, and the sweep prompt change).
7. CSS: the shortcut in the tab row at 320–390px, the big-screen sizes, the reply box with
   `overflow: hidden`.

Write your findings, numbered C1, C2, … each with severity, file:line, what was wrong and what you
changed (or why you did not), into the output file. End with one line: APPROVE, APPROVE WITH
FIXES (fixes applied), or REFUSE.
