You are reviewing BUILT code in the Spideryarn repo, in the worktree you are running in. You may fix what you find (workspace-write): fix real defects inside this change's scope, add or adjust tests that prove each fix (watch them go red first), and report anything wider for me to decide. Never run git commands that discard work (no stash, reset, checkout --, restore, clean), never commit, and never touch .env.local, infra/ or any remote database.

The work: docs/plans/261002c-glossary-hide-an-entry-dig-deeper-from-the-card-hyphens-match-spaces.md. Read the whole plan, especially "Revised after GPT Sol's plan review" (that was your own plan review: docs/plans/261002c-plan-review-sol.md). Check that each of its eight points was actually done.

The diff is the two commits on top of the merge base:
  git diff 5418f7b30..HEAD
(0c296f382 = stage 1: matcher + both reads re-match; a0de6acd6 = stages 2-3: hide + the card buttons + lifting the lookup state into useGlossaryRead.)

Focus on:
1. src/term-match.ts: the separator rule and its canonicalisation; any form it mishandles; whether server (block.text) and client (rendered html text, src/web/annotate.ts termMarks) can now disagree in a new way.
2. src/glossary-occurrences.ts and its two read call sites (src/store/pg.ts loadGlossary, src/store/public-reader.ts). Is always re-matching (stale or not) correct for everything downstream: occurrencesFitTheArticle, the [gl-not-quoted]/[gl-stale] refusals in src/term-lookup.ts, chat tools, the export (it must export the STORED artefact, not the re-matched copy, unless it should not), public DTO projection?
3. src/store/pg-glossary-hidden.ts and routes: ownership, the 404/400 paths, the data-modifying CTE, idempotency, the export declarations in src/store/article-rows.ts / export.ts / export-bundle.ts, and anything that lets a visitor or the public read see the hide.
4. src/web/useGlossary.ts: the lifted lookup state machine. Admission, abort on slug change, the refresh-on-failure reconciliation, look() returning boolean, setHidden's serialisation and refresh, races between a GET landing and a hide/unhide, and anything the band relied on that changed when the state stopped unmounting with the band.
5. src/web/glossary-shown.ts and every consumer: are hidden entries really gone from prose marks, the card, G (TermJump), Skim stop cards, band counts/sorts/threshold (gateToReveal in Reader.tsx openTermInGlossary too), and is ?term= of a hidden entry cleared in every order?
6. src/web/ProseHoverCard.tsx TermCard's two new owner-only buttons: owner-only threading (termActions), disabled states, close only on successful hide, failure line, touch (the card's pointer handling), and that Dig deeper opens the band on the term and the band shows the streaming answer.
7. Accessibility and layout of the band's trash button (a sibling of the row's button, not nested) and the Hidden (n) section.

Run: npm run typecheck, and npx vitest run on the test files you touch plus tests/glossary*.test.ts* tests/stop-card.test.ts tests/store-export-covers-tables.test.ts tests/public-imports.test.ts. Re-run a red Postgres suite alone before believing it (the box is shared).

Answer with: findings ranked by severity, each with file:line evidence; for each, whether you FIXED it (and which test proves it) or are REPORTING it for me; then the gate results with exact counts. Also say plainly whether you think the conclusion "always re-match on both reads" is right.
