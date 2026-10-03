# Code review: 261003i stage B — thorough replaces a quick search, colour swatch, no wash on a quick hit

You are reviewing code, and you may **fix what you find inside this stage**: narrowly, each fix with
a test seen red first. Anything wider, report and do not fix. Do not commit.

**Candidate (committed).** Exactly one commit, `bddc97fbc`, on branch
`worktree-fb-search-quick-2610`. See it with `git show --stat bddc97fbc` and
`git show bddc97fbc -- <path>`. Its changed paths are the whole candidate:

- `src/web/SearchPanel.tsx`, `src/web/modes/search/SearchMode.tsx`, `src/web/useSearch.ts`,
  `src/web/quick-session.ts`
- `src/web/search-hits.ts`, `src/web/annotate.ts`, `src/web/TableView.tsx`
- `src/web/styles/annotations.css`, `src/web/styles/search.css`
- `src/web/help/help-modes.tsx`, `docs/project/search.md`
- `tests/annotate.test.ts`, `tests/quick-search-panel.test.tsx`, `tests/quick-session.test.ts`,
  `tests/search-as-you-type.test.tsx`, `tests/search-hits.test.ts`, `tests/use-search.test.ts`
- the plan `docs/plans/261003i-quick-search-eval-thorough-replaces-quick-colour-key-and-no-wash.md`
  (Stage B is what was built; Stage A is an eval still running, not under review) and your own plan
  review beside it.

Another agent is writing an eval in this worktree while you work: leave `evals/`, `data/`,
`docs/investigations/`, `src/quick-search.ts`, `src/search.ts` and `src/models.ts` alone. Files
under `data/qeval/` are that agent's scratch and are why `npm run typecheck` currently exits red;
not yours to fix.

## What to do

An independent pass first. The four behaviours, in the plan's words: B1 the reader-visible name is
"thorough"; B2 pressing it asks the meaning search and deletes the quick row at once, client-side,
and the new row wears the quick row's resolved colour; B3 a solid colour swatch beside each saved
search's words and a full-strength left edge; B4 a quick hit paints nothing on its words (bar and
spine mark only), keeps its `data-hit`, and gets a ring when pressed.

Attack it: wrong behaviour a reader can reach, a race, a lost row, a colour written to the wrong
row, a mark that other modes (Ideas, Quotes, Referee, comments, glossary terms, xrefs) relied on,
docs or help text that are now untrue. Check the new docs wording in `docs/project/search.md`
against the code.

Run the tests yourself. These need nothing outside the tree:
`npx vitest run tests/annotate.test.ts tests/search-hits.test.ts tests/quick-search-panel.test.tsx tests/search-as-you-type.test.tsx tests/use-search.test.ts tests/quick-session.test.ts`.
Then mutate: undo one behaviour at a time (the `!m.bare` filter in `annotate.ts`; the
`remove(sourceId)` in `SearchMode.tsx`; the colour argument to `ask`) and confirm a test goes red.
Restore each mutation.

## Severity scale

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Give every finding an ID (C1, C2, …), a severity, file and line, whether you fixed it, and the red
test for each fix. End with a one-line verdict.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- `useSearch.ts`: the new `else if` at `begin` sends a colour PATCH whenever this tab's `chosen`
  differs from what `begin` reports. It is a general rule, not thorough-only. Can it fire on a
  quick revision (`revises`) every pause, on a retry, or after the row was deleted? Can it overwrite
  a colour chosen in another tab?
- `SearchMode.tsx`: `remove(sourceId)` on a quick row whose request is still in flight from this tab,
  or which is this typing session's row with a queued revision. Does anything re-create it?
- A bare quick mark is now invisible but `TableView.tsx` still excludes `mark.hit:not([data-quote])`
  from tap-to-select on touch, so a whole paragraph is a dead zone with nothing to see. If dropping
  that exclusion for bare marks is small and safe, fix it; otherwise report.
- The pressed ring on a bare mark is a box-shadow on an inline `<mark>` spanning a paragraph.
- `Found.bare` is derived from `spec.preview === "from-start"`: one fact read twice, or a coupling
  that the next "from-start" source will inherit by accident?
