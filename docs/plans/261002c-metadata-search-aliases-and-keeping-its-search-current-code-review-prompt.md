# Code review: 261002c — Metadata search aliases, and keeping its search current

You are GPT Sol, reviewing built code in a repo worktree with write access. **Fix what you find
inside this change's scope** (the files in the diff), keeping the house style (comment density,
naming). Report anything wider for the author to decide rather than fixing it.

- The plan, including what changed after your own plan review:
  docs/plans/261002c-metadata-search-aliases-and-keeping-its-search-current.md
- Your plan review: docs/plans/261002c-metadata-search-aliases-and-keeping-its-search-current-plan-review-sol.md
- The diff under review (commit 22ea449bd): docs/plans/261002c-metadata-search-aliases-and-keeping-its-search-current-code-review.diff

Greg's report, verbatim: "Add lots more keyword-aliases for Metadata page search to make it more
flexible/forgiving (e.g. I tried searching for "regenerate" to find ways to regenerate the AI
processing, and nothing matched). And update docs so that any time we update the Metadata page, we
keep that search and ToC up-to-date."

Check especially:

1. `searchSections`'s retry after an AND miss (src/web/page-search.ts): correct, and does it keep
   "a second word only narrows"? Any query where it returns something misleading? It is shared with
   the Help page (src/web/help/HelpPage.tsx) — check Help's behaviour too.
2. The new keywords on each `<Section>` in src/web/Metadata.tsx and the new synonym words: any that
   now rank a wrong section FIRST for a plausible query (try the obvious ones per section, and the
   existing tests' phrasings). STOPWORDS gained "get" and "please" — any harm?
3. `AI_PROCESSING_KEYWORDS` is a module const defined after the component that uses it: safe?
   "Whole article" (reset) is behind the experimental switch: is routing *reset*/*start over* to
   AI processing misleading when it is off?
4. The command bar Metadata row aliases (src/web/CommandBar.tsx): do any now outrank a better row
   (e.g. "share", "public" vs the shared-articles row; "delete"; "cost")?
5. Tests: would each new test go red if its fix were reverted? The rendered phrase table in
   tests/metadata-contents-reveal.test.tsx, the one-group-per-stem test, the command-bar test.
6. The doc line in docs/project/web-client.md: accurate against the code?

Run `npx vitest run tests/page-search.test.ts tests/metadata-contents-reveal.test.tsx tests/command-bar.test.tsx tests/help-page.test.tsx tests/metadata-page-order.test.tsx`
and `npm run typecheck` after any fix. Do not commit. End with numbered findings (P1/P2/P3,
file:line, and whether you fixed each), the list of files you changed, and a one-line verdict.
Also check the conclusion, not only the evidence: is Greg's report actually answered?
