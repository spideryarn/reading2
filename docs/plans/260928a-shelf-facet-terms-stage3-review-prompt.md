# Stage 3 code review prompt: shelf filter terms (260928a)

You are the reviewer-fixer for Stage 3 (the UI) of docs/plans/260928a-shelf-facet-terms.md.

**Candidate (committed)**: commit ab16dfe3. `git show ab16dfe3 --stat` lists every changed path. Start with:
- src/web/shelf-narrow.ts, src/web/useShelfTerms.ts, src/web/ShelfTerms.tsx
- the changes to src/web/Library.tsx (`git show ab16dfe3 -- src/web/Library.tsx`) and src/web/params.ts
- tests/shelf-narrow.test.ts, tests/shelf-topics.test.tsx
- docs/project/shelf-terms.md, and the plan's § The UI

This does not limit scope. The server side (stages 1–2, reviewed) is `GET /api/library/terms` in src/routes.ts and `LibraryTermsResponse` in src/types.ts. Earlier reviews, whose IDs are still live: docs/plans/260928a-shelf-facet-terms-plan-review-sol.md (F5 touch, F6 archived coherence, F11 one count formula are this stage's).

Another session is editing the same page (the Table view: library-columns.tsx, lib/DataTable.tsx, column hiding). Keep any fix to Library.tsx small.

## What the stage is for

A "Topics" row above the shelf: chips with live counts, AND across selected, greyed zero, a desktop tooltip with the top articles, an "All N topics" list with one row per topic (the touch answer), `?topics=` in the URL, "Show archived" moved into the URL (`?archived=1`) and widening the topics to the archive, one narrowing function over both lists, both the cards and the table obeying it.

## Please

1. An independent pass for user-visible wrong behaviour: does every count obey the one formula (`visible = scope ∩ search ∩ Unread ∩ every selected topic`; chip = |visible ∩ its articles|; physical slugs)? Does the "n of m" line equal what is rendered, in both views, with and without archived? Can a stale `?topics=` key ever empty the shelf, even for a frame? Races: scope switch, a job finishing, a pending re-ask, Back/Forward across topic presses and the archived toggle, a half-typed search (`pushView`). The author says that while a new scope loads after switching archived, the previous scope's topics keep applying, so for a moment archived rows can be filtered by active-only topic sets — is that acceptable or a bug? Accessibility: `aria-pressed`, names beginning with the visible text, disabled chips and their tooltips, keyboard. Render cost: anything recomputed per keystroke over every article that should not be.
2. Run the two test files yourself: `npx vitest run tests/shelf-narrow.test.ts tests/shelf-topics.test.tsx`. They need nothing outside the tree.
3. **Fix what is inside this stage**, narrowly, red first. **Report, do not fix**, anything wider. Do not commit; leave changes in the working tree.

## Output

Findings with stable IDs S3-1, S3-2, … each with severity (P0 data loss/security/charging/broadly unusable; P1 user-visible wrong behaviour or contract violated; P2 design/maintainability risk; P3 prose), established or reasoned, evidence (file:line), and what you changed (or why only reported). Then the final lines of the test command. Then a one-line verdict.
