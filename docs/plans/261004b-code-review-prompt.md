You are reviewing BUILT code in the Spideryarn repo, in the worktree you are running in. You may fix what you find (workspace-write): fix real defects inside this change's scope, add or adjust tests that prove each fix (watch them go red first), and report anything wider for me to decide. Never run git commands that discard work (no stash, reset, checkout --, restore, clean), never commit, and never touch .env.local, infra/ or any remote database.

The work: docs/plans/261004b-citation-hover-card-offers-dig-deeper.md, Part 1 only (Part 2 is a proposal and is not built). Your own plan review is docs/plans/261004b-plan-review-sol.md; check that F1, F2 and F3 were actually done, and say whether the conclusion in the plan's Log ("Not taken": no extra line on the card saying the press is paid, because the glossary card's button has none either) is defensible.

The diff is the one commit on top of the merge base:
  git diff 1c5329440..HEAD

Focus on:
1. src/web/useCitations.ts: the investigate state and verb moved from useCitations into useCitationsRead. Admission (the ref guard), abort on slug change, the refresh-on-failure reconciliation, and anything the band relied on that changed when the state stopped unmounting with the band (a draft, failure or findNote that now survives a mode change; a stale `investigateFailed` shown on a row after the list was replaced). Does ArticlePage keep one read across a slug change, or remount it, and is the cleanup right in both cases?
2. src/web/CitationsPanel.tsx: barToReveal; the focus effect (loading list, missing work, bar hiding the row, the nuqs write landing a render later, an unscored row, a non-prioritised order, a visitor panel that is never handed a focus); the keep-the-dug-row-drawn effect (keyed on the work's priority, not the bar: can it loop, fight the reader's slider, fire for a visitor, or lower a dormant bar in another order?). `lastDug` is a ref written during render; is that a problem?
3. src/web/reader/Reader.tsx: citeActions, citeFocus and citeFocusTaken. Owner-only threading; that a visitor can never get a non-null citeActions; that setMode("citations") from a card on a phone or a narrow window actually shows the band (compare openTermInGlossary and how the band steps aside, `bandAway`).
4. src/web/ProseHoverCard.tsx CiteCard: the button's states, that the card closes, that *search Scholar* and the provenance rule are untouched, and the foot's wrap (src/web/styles/prose-hover-card.css).
5. docs/project/citations.md: every sentence I added is bounded by what the code does.

Run: npm run typecheck, and npx vitest run tests/citations-panel.test.tsx tests/citation-hover-card.test.tsx tests/citations-investigate-client.test.tsx tests/citations-find-late-reply.test.tsx tests/always-mounted-reads-refresh.test.tsx tests/prose-not-rebuilt.test.tsx tests/glossary-card-actions.test.tsx tests/doc-links.test.ts. Re-run a red Postgres suite alone before believing it (the box is shared).

Answer with: findings ranked by severity, each with file:line evidence; for each, whether you FIXED it (and which test proves it, and that you saw it red) or are REPORTING it for me; then the gate results with exact counts.
