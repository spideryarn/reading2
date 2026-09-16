### Findings

- **F8 — P1 — established — [FeedbackEarlier.tsx:45](/home/greg/code/spideryarn2/.claude/worktrees/fb3r-feedback-history-tab/src/web/FeedbackEarlier.tsx:45) — fixed.** A wrong-shaped JSON `200` crashed at `reports.map`. Added runtime validation for the complete DTO; malformed JSON, malformed dates, invalid kinds, non-JSON responses, and 401s now show `[fb-list]`. Watched red first.

- **F9 — P1 — reasoned — [FeedbackDialog.tsx:1218](/home/greg/code/spideryarn2/.claude/worktrees/fb3r-feedback-history-tab/src/web/FeedbackDialog.tsx:1218) — fixed.** The scrollable Earlier panel had no focusable content, so keyboard users could skip directly from its tab to Close. Made the tabpanel focusable and added a visible focus treatment in [feedback.css:223](/home/greg/code/spideryarn2/.claude/worktrees/fb3r-feedback-history-tab/src/web/styles/feedback.css:223). Watched red first.

- **F10 — P2 — established — [messages.ts:540](/home/greg/code/spideryarn2/.claude/worktrees/fb3r-feedback-history-tab/src/messages.ts:540) — fixed.** `[fb-list]` was absent from `CODE_KINDS`, so `kindOfMessage()` returned `null` rather than `"retry"` and both message-contract tests failed. Registered it as retryable.

- **F11 — P1 — established — [FeedbackDialog.tsx:688](/home/greg/code/spideryarn2/.claude/worktrees/fb3r-feedback-history-tab/src/web/FeedbackDialog.tsx:688) — fixed.** A send failing after switching to Earlier placed its recovery panel inside hidden Write content. Failure now returns to Write and focuses its tab while the dialog remains open. Success still becomes the planned thank-you panel. Watched red first and documented in [feedback.md:173](/home/greg/code/spideryarn2/.claude/worktrees/fb3r-feedback-history-tab/docs/project/feedback.md:173).

F1–F3, F5, and F6 are closed: microphone stopping, paste/drop/send guards, focus/reset behavior, and the independent narrow DTO are present and tested. StrictMode starts exactly one read; closing invalidates late generations.

Evidence:

- Relevant suites: 96 passed, including 56 feedback-dialog tests.
- Typecheck: all 2,194 source files covered and clean.
- Biome: clean; two complexity infos remain.
- Full `npm test` could not start because this sandbox cannot reach the shared Postgres/Docker service.
- No browser run, as requested.

**VERDICT: approve**