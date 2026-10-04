# Code review: Debate's Reception and Claims sub-modes

You are reviewing and, inside this stage, fixing. Work only in this worktree.

**Candidate (committed):** commit `4b502174a` on top of `337ec99d0`. See it with
`git show --stat 4b502174a` and `git diff 337ec99d0 4b502174a -- <path>`. 38 paths; the full list
is the `--stat`. Start with `src/web/DebatePanel.tsx`, `src/web/debate-levels.ts`,
`src/web/debate-order.ts`, `src/web/debate-threads.ts`, `src/web/router.ts`
(`liftLegacyDebateBy`, `liftedLegacyHref`), `src/web/params.ts`, `src/web/sub-modes.ts`,
`src/web/activation.ts`, `src/web/last-view.ts`, `src/web/modes/debate/DebateMode.tsx`,
`src/web/reader/Reader.tsx`, `src/scholar-search.ts`, `src/web/styles/debate.css`. That list does
not limit scope.

**The spec** is `docs/plans/261003o-debate-reception-and-claims-sub-modes-and-a-tidier-panel.md`
(steps 1–11, and "Tests"). Your own plan review is
`docs/plans/261003o-debate-reception-and-claims-plan-review-sol.md`; F1–F9 were all accepted, so
check each was actually done. The implementer (a Claude subagent) reported these departures from
the plan; judge each: the Scholar link searches the title only; the "Not judged for relevance by
the AI" line is gone (unjudged rows sort last in their claim); Reception's order options are
computed from stored groups before the thread narrows; a visitor's empty sub-mode whose rows were
withheld shows the withheld sentence on the panel; the control reuses Summary's `.summ-*` classes.

## What to do

1. Review independently first: correctness against the spec and against the code around it. A
   reader's view, a visitor's view (`src/public/dto.ts` payloads), old stored debates (no `bears`,
   old `valence`), old links (`?name=`, `?debateby=claim`, `?debatethread=key`), last-view restore,
   the command bar, Marginalia's Debate items, tooltips and the help page. Look for anything the
   old panel said that the new one silently stopped saying (a count, a loss, a provenance note).
2. Run tests yourself where they need nothing outside the tree, for example
   `npx vitest run tests/debate-panel.test.tsx tests/debate-order.test.ts tests/debate-threads.test.ts tests/debate-bar.test.ts tests/router.test.ts tests/last-view.test.ts tests/url-state.test.ts`.
   You have no network and no Postgres; do not claim a result for a test that needs them.
3. **Fix what is inside this stage**, narrowly, with a test seen red first. **Report, do not fix,**
   anything wider. Do not commit; leave your changes in the working tree.

Severity by consequence: **P0** data loss, security, wrong charging, service unusable. **P1**
user-visible wrong behaviour or an authoritative contract violated. **P2** design or maintainability
risk, nothing wrong today. **P3** prose. Mark each finding *established* or *reasoned*, give each an
id continuing the chain (`F10`, `F11`, …), and say for each whether you fixed it. End with
`VERDICT: land`, `VERDICT: land with the fixes I made`, or `VERDICT: do not land`, and why.

## My suspicions (mine, worth less; spend most of the run elsewhere)

- Thread scoping: a `?debatethread=` with no stored row in the sub-mode on screen.
- The handoff button's count against what Claims then shows when the relevance bar is set.
- `liftedLegacyHref` on Back/Forward and inside `navigate()`.
- Whether anything still imports `src/citations.ts` into the client graph.
