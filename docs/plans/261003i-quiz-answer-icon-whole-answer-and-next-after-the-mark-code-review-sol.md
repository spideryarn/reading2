F1–F4 were implemented as accepted. I found no P0/P1 defect.

**F5 — P2 — ESTABLISHED — FIXED:** Width-change protection had no effective regression coverage. Removing `watch.observe(el)` left all 98 original tests green.

I strengthened [quiz-panel.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb-quiz-answer-icon-next-button/tests/quiz-panel.test.tsx:607) to check unchanged answers across widths, shrinking, border allowance, height-only notifications, observer cleanup/remounting, Next’s focus retention, re-marking unchanged words, and navigation immediately below the critique. Six corresponding broken variants were seen red; all mutations were restored.

Validation passed:

- Quiz panel: **101 tests**
- Shared icon-button/tooltip behavior: **20 tests**
- Typecheck, scoped lint, and diff checks

The npm typecheck wrapper hit a sandbox socket restriction; running the same script with `node --import tsx` passed. CSS load order and specificity were inspected; no browser check was performed.

Only the test file remains changed, uncommitted.

ACCEPT WITH THE FIXES MADE (F5).