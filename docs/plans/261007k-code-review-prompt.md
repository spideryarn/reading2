You are reviewing built code in the Spideryarn repo (TypeScript, Postgres, React). You may fix what you find inside this change's scope; report anything wider rather than fixing it.

Plan: docs/plans/261007k-repeat-paste-is-free-and-says-so.md (read its "Plan review" section: the earlier review's four findings and what was done about each).
Diff of the change: docs/plans/261007k-code-review.diff (also `git diff HEAD` in this worktree).
Earlier plan review: docs/plans/261007k-plan-review-sol.md.

What it does: `POST /api/jobs { url }` with no `steps`/`force`, for an address the reader already has (`slugForUrlKey`), now answers 200 `{ article, repeat: true }` before `withIngestSlot`: no reservation, no job. The add page stops on a `repeat` phase with a sentence and an "Open the article" button; the hover card's "add to Spideryarn" gets a `have` state with a "read it here" link; the MCP `import_article` adds a link to the article answer. Docs: billing.md, ingest-queue.md.

Please check, with file:line evidence:
1. Correctness of the route short-circuit (src/routes.ts, the POST /api/jobs handler). Anything a request could carry that should not be short-circuited? Is the order relative to `isOwnReadingPage`, `readThis` and the upload branch right? Any way to get free model work?
2. src/web/AddPage.tsx: the new `repeat` phase. Any state path where the page gets stuck, navigates by itself over a repeat, opens the wrong article after an address change or a reader change, or where High-powered AI / sharing / the purpose session misbehaves? StrictMode double effects? The once-guard (`claimed`) and `mayOpen`?
3. src/web/ProseHoverCard.tsx: the `have` arm. Interactions with `library`/`shelfKnown` (the `adding` override to `none`), the module-level `asked` map, a later re-hover.
4. Tests: do they actually pin the behaviour (would they go red if the change were reverted)? Any test elsewhere in the repo that the change should have updated (search tests/ for "charges again", "re-add", and for `POST /api/jobs` with a URL that is already on the shelf)?
5. Docs: are the billing.md and ingest-queue.md edits accurate against the code? Any other doc that still says a re-add charges (search docs/project)? Do not invent quotes from Greg; quote only what the plan already quotes.

Run `npx vitest run tests/billing-admission.test.ts tests/add-page-purpose.test.tsx tests/add-to-shelf-from-the-card.test.tsx tests/mcp-tools.test.ts` (the first needs `REQUIRE_POSTGRES=1`) and `npm run typecheck` after any fix.

Answer with: numbered findings, severity P0-P3, what you changed for each (if anything), and what you left for the author.
