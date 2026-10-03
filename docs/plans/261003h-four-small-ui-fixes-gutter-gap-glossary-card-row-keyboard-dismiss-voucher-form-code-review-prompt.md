# Code review: 261003h, four small UI fixes

Review, and fix what you find **inside these four fixes**, narrowly and red-first (a test that
fails before your fix). Anything wider you notice: report it, do not fix it. You are in a linked
worktree and cannot commit; leave your changes in the working tree.

**Candidate (committed):** four commits on top of base `451df1f8f`:

- `095e5d3ac` gutter gap: `src/web/styles/gutter.css`, `tests/gutter-target-size.test.ts`
- `f11f228ed` term card row: `src/web/ProseHoverCard.tsx`, `src/web/styles/prose-hover-card.css`,
  `tests/glossary-card-actions.test.tsx`, `tests/quote-hover-card.test.tsx`,
  `tests/hover-card-touch.test.tsx`, comment and doc renames in `src/web/useHoverCard.ts`,
  `src/web/TermJump.tsx`, `src/web/QuotesPanel.tsx`, `src/web/help/help-modes.tsx`,
  `src/web/reader/Reader.tsx`, `tests/glossary-band-wiring.test.ts`, `tests/glossary.test.ts`,
  `docs/project/glossary.md`, `docs/project/quotes.md`, `docs/project/tooltips.md`
- `54f7dbaf3` keyboard: `src/web/useVisualViewport.ts`, `src/web/ChatPanel.tsx`,
  `src/web/CandidatesPanel.tsx`, `src/web/CommentDialog.tsx`, `src/web/GlossaryPanel.tsx`,
  `src/web/SearchPanel.tsx`, `src/web/modes/conversation/ConversationModes.tsx`,
  `docs/project/touch.md`, `tests/put-keyboard-away.test.ts`,
  `tests/the-enter-key-really-sends.test.tsx`, `tests/conversation-band-send-new.test.tsx`
- `b9e306231` voucher form: `src/web/AdminVouchersPage.tsx`, `tests/admin-vouchers-page.test.tsx`

`git show <sha>` for each. The plan, with what your plan review changed, is
`docs/plans/261003h-four-small-ui-fixes-gutter-gap-glossary-card-row-keyboard-dismiss-voucher-form.md`
(§ After GPT Sol's plan review). That list says where to start and does not limit scope.

You may run single test files: `npx vitest run tests/<one>.test.tsx`. No network, so nothing that
needs Postgres. A red inside the sandbox is not yet a finding: say which you saw.

**Evidence I ran, outside your sandbox:** `npm run typecheck` green on the pre-commit tree. A
Playwright pass on the uncommitted tree at 1440, 820 and 390 wide: 72 gutters sampled, 32px between
icon centres, 8px between targets, no icon below its row, and the same icon count under the old and
new thresholds on every row; the term card's foot on one line without a link, link above the three
grouped buttons with one; the voucher form with no horizontal overflow at 390. Screenshots are
`docs/plans/261003h-shot-*.png`. No real soft keyboard was exercised: that part is jsdom only.

**What I want:** an independent attack on the code first. Wrong behaviour a reader can reach,
a test that would stay green with the fix deleted, a doc sentence that is false against the code.

Severity, by consequence: **P0** data loss, security, charging, service unusable. **P1**
user-visible wrong behaviour or a contract violated. **P2** design or maintainability risk, no wrong
behaviour today. **P3** prose. Give every finding an ID, a severity, file and line, whether you
fixed it, and the test that was red. End with a one-line verdict.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- `putKeyboardAway` in `ChatPanel.tsx` runs after an `await live.stop()`; whether `box.current` is
  still the right element then.
- `ConversationModes.tsx`: `softKeyboardIsUp()` is read inside `onSendNew`, before the old box
  blurs. Whether any path reaches `onSendNew` after the blur.
- The glossary look-up blurs even when `ask` refuses the term.
