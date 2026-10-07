Code review of the work for docs/plans/261007o-help-pictures-for-the-eight-modes-without-one.md
(and its plan review, 261007o-help-pictures-plan-review-sol.md). Scope: `git diff HEAD` in this
worktree — eight new PNGs in src/web/help/pages/images/ (mode-faq, mode-learn, mode-chat,
mode-debate, mode-referee, mode-marginalia, mode-plain, mode-illustrated), eight entries in
src/web/help/help-images.ts, a picture line in each of src/web/help/pages/modes/{faq,learn,chat,
debate,referee,marginalia,plain,diagram}.md, a new bullet in marginalia.md on other modes' lines, and
the regenerated src/help-corpus.generated.json.

Please: look at each PNG and check its alt and caption say only what the picture shows and what the
page's text supports (check claims against the code where a caption states a behaviour — e.g. the
new marginalia.md bullet against docs/project/marginalia.md and the Marginalia code under src/web/);
check each picture sits in a sensible place on its page; check the manifest entries are a usable
retake recipe; flag anything embarrassing or private in a picture. You may fix what you find (write
access); report anything wider. Do not invent quotes from Greg. Run
`npx vitest run tests/help-images.test.ts tests/help-corpus.test.ts tests/help-page.test.tsx` after
any edit (regenerate the corpus with WRITE_HELP_CORPUS=1 first if a page changed). End with a
verdict (ready / not ready) and numbered findings with what you changed.
