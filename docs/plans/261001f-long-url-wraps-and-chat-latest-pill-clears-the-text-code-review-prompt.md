Code review of a small CSS fix, with authority to fix what you find inside this scope.

- Plan, with the browser-pass results under Progress:
  docs/plans/261001f-long-url-wraps-and-chat-latest-pill-clears-the-text.md
- Your earlier plan review:
  docs/plans/261001f-long-url-wraps-and-chat-latest-pill-clears-the-text-plan-review-sol.md
- The scoped diff (three CSS files and two new tests):
  docs/plans/261001f-long-url-wraps-and-chat-latest-pill-clears-the-text-code-review.diff

Check:

1. **Are the three CSS changes correct everywhere the chat transcript lives?**
   - In the mode band: src/web/styles/mode-band.css.
   - In the fixed chat dialog: src/web/styles/dialogs.css and src/web/ChatDialog.tsx.
   - In the Remember stance: `Conversation` with `kind="remember"` in src/web/ChatPanel.tsx, and the
     `.remember` rules in mode-band.css.

   Does anything else rely on `.chat-to-bottom` being absolute, or on `.chat-dialog-body` scrolling
   while it holds a conversation? Look for scroll-into-view, focus, the keyboard inset `--kb-inset`,
   and any JS that scrolls `.chat-dialog-body`. Grep src/ and tests/.
2. **Do the tests pin what the plan says?** Could they pass while the bug is back (silent success)?
   They use `readerCssNoComments` from tests/helpers/stylesheets.ts.
3. **Are the comments accurate?** They should match the neighbouring comments' house style and make
   no claim the code does not back.

If you find a real defect in scope, fix it directly in the working tree.

- Change only CSS, tests and comments, and nothing unrelated.
- Do not commit, and do not run any git command that changes state.
- After any change, run
  `npx vitest run tests/chat-latest-pill-in-flow.test.ts tests/prose-long-words-wrap.test.ts`.

Report:

- findings ranked by severity, each with file:line;
- what you changed, if anything;
- anything wider for me to decide.
