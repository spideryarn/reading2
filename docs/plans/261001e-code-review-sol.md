Findings/fixes:

- [test:49](/home/greg/code/spideryarn2/.claude/worktrees/figure-overflow-390/tests/masthead-facts-wrap-in-chrome.test.tsx:49): added the real font-token sheet, actual multiline assertion, and owner/`AuthorNames` coverage including nested spans and `+ 2 more`.
- [shell.css:366](/home/greg/code/spideryarn2/.claude/worktrees/figure-overflow-390/src/web/styles/shell.css:366), [plan:52](/home/greg/code/spideryarn2/.claude/worktrees/figure-overflow-390/docs/plans/261001e-masthead-facts-line-overflows-a-phone.md:52): corrected two overclaims—only later facts are inline-blocks, and unbroken tokens remain unbreakable.
- No other `.facts` consumer or narrow-window override exists. Metadata uses a separate flex row. The 390/1440 screenshots show no desktop regression.

Verification: typecheck and Biome pass; `masthead-authors` passes 8/8. Chrome could not launch in this sandbox (`crashpad … EPERM`), and full `npm test` could not reach Postgres.

Verdict: approve with these review fixes. The CSS change is correct; only the pre-existing unbroken-token case remains outside scope.