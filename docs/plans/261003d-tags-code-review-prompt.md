You are reviewing built code in this repo (Spideryarn; CLAUDE.md and docs/project/ explain it), and
**fixing what you find** inside this change. Work in the current worktree.

The feature: a reader's own tags on their articles — stored in `article_tags`, edited from the shelf
(card and table row) and near the top of the Metadata page with one combobox (`TagEditor`), and used
as a Tags filter row above the shelf's Topics row. Read the plan first, including its section "After
GPT Sol's plan review (decisions)" and "Progress":
docs/plans/261003d-your-own-tags-on-articles-on-the-shelf-and-the-metadata-page.md
Your own plan review is docs/plans/261003d-tags-plan-review-sol.md — check each accepted finding was
actually built, not just written down.

The whole change is `git diff origin/dev HEAD` (also saved as docs/plans/261003d-tags-code-review.diff;
skip drizzle/meta/*_snapshot.json, which is generated).

Look hardest at:
- Ownership and privacy: can any route, listing, export or public response give one reader's tags to
  another, or let a stranger write them? (src/store/pg-tags.ts, src/store/tag-rows.ts, src/store/pg.ts
  listArticles and articleMetadata, src/routes.ts, src/public/.)
- The cap and the row lock in `pgTagStore.edit`; the CHECK in the migration vs `normaliseTag`
  (src/tags.ts) — any input the JS accepts and Postgres refuses becomes a 500.
- Client state: `useShelf.editTags` (both lists, the archived overlay, the stale-read barrier), the
  cache invalidation in src/web/lib/api.ts `saving`, `cached-shelf.ts`, Metadata's `setProvenance`.
- The filter: Library.tsx (`tagFacets`, `tagsChosen`, `chosenSets`, counts), and that topic and tag
  chips count the same visible set; any render loop from a fresh array per render
  (docs/postmortems/260827e-shelf-render-loop.md).
- TagEditor.tsx: keyboard behaviour, ARIA combobox semantics, what a failed save shows, the popover in
  ShelfTags.tsx sitting above the card's whole-card link.
- Tests that could not go red (docs/reusable/silent-success.md).

Rules: fix real defects in place, with a test that fails without the fix where one is practical. Do
not commit. Do not run the full suite (the box is busy); run the specific test files you touch with
`npx vitest run <files>` and `npm run typecheck`. Never run git commands that discard work
(checkout --, restore, reset, stash, clean). Then write your report: each finding numbered P0/P1/P2,
what you changed for it (file and line) or why you left it, and anything wider for me to decide.
End with a plain verdict: would you ship this.
