Code review of one small commit in the repo you are in: `git show 8dd4085f` (plan 261001e, docs/plans/261001e-masthead-facts-line-overflows-a-phone.md; your plan review of it is docs/plans/261001e-plan-review-sol.md).

The change: src/web/styles/shell.css `.facts > span + span` goes from `white-space: nowrap` to `display: inline-block`, and a new Chrome test, tests/masthead-facts-wrap-in-chrome.test.tsx.

Evidence I gathered (please verify what you can rather than trusting it):
- The test was red before the fix: "the facts line pushes the page sideways: expected 538 to be less than or equal to 390" (control + text premise passed). Green after.
- Mutation: with the rule changed to `display: inline` and no nowrap, it goes red on the split check: `expected [2,1,1,1,2] to deeply equal [1,1,1,1,1]`.
- Browser sweep at 390 and 1440 against the dev server: the table in the plan. npm run typecheck exit 0.
- Run the test yourself: `npx vitest run tests/masthead-facts-wrap-in-chrome.test.tsx tests/masthead-authors.test.tsx` (Chrome is at /usr/bin/google-chrome-stable; the test launches it itself).

You may FIX what you find, inside this change only (shell.css rule and its comment, the test, the plan doc). Report anything wider for me to decide. Look especially for:
1. Any way the test passes for the wrong reason (it inlines readerCss() without @font-face; it renders Masthead without onRenamed, so a visitor's masthead — does the owner's masthead render differently in the facts line? Should the test also cover the authors-list case, AuthorNames, where the first span holds nested spans and a "+ N more" button?).
2. Any layout regression from inline-block elsewhere `.facts` appears (grep for `facts` in src/web, including narrow-window.css and any public/metadata page that reuses the class), and on desktop.
3. Whether the comment in shell.css and the plan say anything false.
Keep the answer short: findings with file:line, what you changed, and a verdict.
