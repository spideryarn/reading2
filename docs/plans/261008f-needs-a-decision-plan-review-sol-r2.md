F1 — **Not closed.** The amendment correctly names the `caue42` note, but the worktree instead adds `spya-thpsnd` to the command-bar note ([plan:240](/var/tmp/spideryarn-worktrees/feedback-earlier-decisions/docs/plans/261008f-needs-a-decision-becomes-threads-you-can-reply-to-or-defer.md:240), [command-bar note:2](/var/tmp/spideryarn-worktrees/feedback-earlier-decisions/docs/user-feedback/261003_1005-the-command-bar-takes-a-sentence.md:2), [caue42 note:2](/var/tmp/spideryarn-worktrees/feedback-earlier-decisions/docs/user-feedback/261003_1016-debate-reception-and-claims-sub-modes.md:2)). That command-bar plan calls itself part 3 “noted here and not built” ([261003k:3](/var/tmp/spideryarn-worktrees/feedback-earlier-decisions/docs/plans/261003k-command-bar-takes-a-sentence-and-a-fast-model-picks-the-command.md:3)), while the actual shipped part-3 note already exists ([part-3 note:31](/var/tmp/spideryarn-worktrees/feedback-earlier-decisions/docs/user-feedback/261003_1010-fewer-modes-part-3-why-you-are-reading-feeds-the-bar.md:31)). Follow the amendment, regenerate, and pin the association in a test. The primary red UI test is sound.

F2 — **Closed.** State compares the current deferral with every reply; `acted` only controls display, with DB timestamps and a defined tie.

F3 — **Closed.** `questions=2`, legacy normalization, exact validation, and both deployment directions are specified.

F4 — **Closed.** A sent reply is retained until a GET started after its receipt returns.

F5 — **Closed.** Both deferral transitions are conditional and retries preserve timestamps.

F6 — **Closed.** Open-only deferral, 409 for stale questions, server-authored environment, and production-script provenance are specified.

F7 — **Closed.** It is now a shortcut button beside the two real ARIA tabs.

F8 — **Closed.** Every relevant reader action advances the per-opening choice counter.

F9 — **Closed.** Measurement is the fallback, width changes remeasure, and the real-device limitation is explicit.

F10 — **blocker** — Split completeness is still inferred only from `notes.length < expected` ([feedback-endings.ts:195](/var/tmp/spideryarn-worktrees/feedback-earlier-decisions/scripts/feedback-endings.ts:195)). Any wrongly associated note—including the current F1 mistake—makes the compiler claim completion. Add a stable per-report part identity/ordinal, reject duplicates and gaps, and derive `FEEDBACK_INCOMPLETE_SPLITS` from coverage rather than cardinality.

F11 — **should-fix** — Deferral receipts lack F4’s stale-GET protection. A GET begun before **Defer** or **Bring back** can land afterward and restore the old state ([plan:155](/var/tmp/spideryarn-worktrees/feedback-earlier-decisions/docs/plans/261008f-needs-a-decision-becomes-threads-you-can-reply-to-or-defer.md:155), [plan:269](/var/tmp/spideryarn-worktrees/feedback-earlier-decisions/docs/plans/261008f-needs-a-decision-becomes-threads-you-can-reply-to-or-defer.md:269)). Give deferral receipts the same reconciliation rule and race tests.

F12 — **should-fix** — Every unacted reply is returned in every v2 page, but replies are append-only and the existing byte ceiling covers reports only ([plan:148](/var/tmp/spideryarn-worktrees/feedback-earlier-decisions/docs/plans/261008f-needs-a-decision-becomes-threads-you-can-reply-to-or-defer.md:148), [types.ts:7562](/var/tmp/spideryarn-worktrees/feedback-earlier-decisions/src/types.ts:7562)). Bound or paginate/fetch thread history without truncating or losing replies, and test the byte boundary.

F13 — **should-fix** — Operative text below the amendments still says “two missing questions” and “third tab” ([plan:294](/var/tmp/spideryarn-worktrees/feedback-earlier-decisions/docs/plans/261008f-needs-a-decision-becomes-threads-you-can-reply-to-or-defer.md:294), [plan:307](/var/tmp/spideryarn-worktrees/feedback-earlier-decisions/docs/plans/261008f-needs-a-decision-becomes-threads-you-can-reply-to-or-defer.md:307)). Replace these with the one Marginalia question and shortcut.

F14 — **should-fix** — Raising the cap to 6,000 leaves a second unintended red test: 4,001 characters are still expected to fail ([feedback-question-values.ts:27](/var/tmp/spideryarn-worktrees/feedback-earlier-decisions/src/feedback-question-values.ts:27), [feedback-dialog.test.tsx:2130](/var/tmp/spideryarn-worktrees/feedback-earlier-decisions/tests/feedback-dialog.test.tsx:2130)). Use `MAX_FEEDBACK_QUESTION_BODY_CHARS + 1`. The targeted run had 274 passing and these two UI failures.

F15 — **nit** — The plan requires a line exactly equal to `Details`, while both parser and splitter accept whitespace-padded variants via `trim()` ([plan:221](/var/tmp/spideryarn-worktrees/feedback-earlier-decisions/docs/plans/261008f-needs-a-decision-becomes-threads-you-can-reply-to-or-defer.md:221), [feedback-question-values.ts:42](/var/tmp/spideryarn-worktrees/feedback-earlier-decisions/src/feedback-question-values.ts:42)). Compare the raw line and test a padded non-marker.

F16 — **should-fix** — This bug already names a reusable class and its introducing commit, so it meets the postmortem rule ([plan:83](/var/tmp/spideryarn-worktrees/feedback-earlier-decisions/docs/plans/261008f-needs-a-decision-becomes-threads-you-can-reply-to-or-defer.md:83), [write-postmortem.md:7](/var/tmp/spideryarn-worktrees/feedback-earlier-decisions/docs/reusable/write-postmortem.md:7)); no stage writes one. Add the required subagent root-cause/postmortem task.

REFUSE