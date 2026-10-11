Code review of commit 74ee320c8 (plan docs/plans/261010g-guide-chat-at-the-top-of-the-command-bar-with-one-icon.md, your plan review docs/plans/261010g-plan-review-sol.md). The scoped diff is docs/plans/261010g-code-review.diff.

House workflow: fix what you find inside this change (src/web/CommandBar.tsx, src/web/ChatPanel.tsx, src/web/styles/mode-band.css, the tests and docs in the diff), and report anything wider for me to decide. Do not commit. Run the relevant tests after any fix: npx vitest run tests/command-bar*.test.* tests/command-match-arguments.test.ts tests/guide-in-chat-panel.test.tsx tests/command-pick-catalogue.test.ts tests/help-corpus.test.ts ; and npm run typecheck.

Look especially at:
1. The pinned guide and every selection path: fresh open, typing then clearing, a profile read inserting/removing the Suggest row while a row is selected (previousReasonRows), a suggestion list landing while the bar was shut and then reopening, Enter repeat guards.
2. The separator logic (two conditions) — can it double up or draw in the wrong place, e.g. with Suggest offered, with suggestions shown, with the ask-the-guide row?
3. Whether `pinnedGuide`'s non-memoised find makes `ordinary`/`shown` churn each render, and whether that matters for the effects that depend on `shown`.
4. Help and doc text accuracy against the code.
Reply with numbered findings (severity, what you changed or what you recommend).
