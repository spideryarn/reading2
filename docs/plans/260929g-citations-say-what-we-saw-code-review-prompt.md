# Code review: Citations says whether we saw the cited paper (260929g, stages 1–2)

You are a reviewer **and fixer**. You run write-capable in this worktree. Fix what is inside this
change, narrowly, and red first: a failing test, then the fix. **Report, do not fix**, anything wider
you notice. Do not commit; do not run git commands that change state.

## The candidate: exact commits

- `459d3c54` — `findWorkPage` pulled out of src/citation-find.ts (shared with another session).
- `aed24b71` — src/paper-text.ts `readPaperText` (shared helper; not called by Citations yet).
- `82ae238f` — stage 1: provenance lines in the Citations row and hover card (UI only).
- `8bf23978` — stage 2: *Look it up* judges the search extract; quotes verified; lookup columns.

`git show <sha>` for each. Do not use a merge-base range; the branch has merges from `dev`. Plan:
`docs/plans/260929g-check-a-cited-paper-supports-the-claim.md` (read § "After the second plan
review", which is the contract). Two prior plan reviews are beside it.

## The one property that matters

Greg: *"be really careful to be clear about whether you could get the actual paper, so that we can
be sure you're not hallucinating"*. Nothing may be shown as coming from the work unless code found
it in retrieved text; every surface must say plainly what was and was not read; a linked row's link
must never change; a stale lookup must never be shown.

## Do

An independent pass first. Look especially at:

- src/citation-lookup.ts: identity (`resultIsTheWork`), `verifyQuote`, `judgeLookup`, `parseJudgement`.
- src/citation-find.ts: lookup prompt and request, orchestration, and that `readFind`'s URL rules are unchanged.
- src/citations.ts `attachLookups`, src/store/pg.ts `loadCitations`, and the fingerprint computed at read time vs call time.
- The migration and its CHECKs, src/store/citation-lookup-row.ts, export.ts, the public DTO.
- src/web/useCitations.ts `applyFound` and `lookupSubjectOf`; CitationsPanel and CiteCard copy.
- paper-text.ts for SSRF and bounds.

You may run individual test files that need nothing outside the tree:
- `npx vitest run tests/citation-lookup.test.ts`
- `tests/citation-find.test.ts`
- `tests/citations-panel.test.tsx`
- `tests/citation-hover-card.test.tsx`
- `tests/citations-find-late-reply.test.tsx`
- `tests/paper-text.test.ts`

The Postgres tests will not run in your sandbox. If you touch store code, say so and I'll run them.

## Author's own doubts (read after your pass)

- A DOI anchor needs the DOI in the result URL. Many publisher URLs don't carry it, so linked DOI
  rows may usually end `not-identified`. Is that acceptable, or is there a safe improvement?
- Is the client's `lookupSubjectOf` a sound mirror of the server fingerprint?
- `unreadable` covers a malformed judgement while the URL pick stands. Is its copy honest?

## Output

Findings with IDs (C-1, …), severity P0–P3, file:line, and for each: fixed (with the test) or
reported. Then list every file you changed. End with a verdict.
