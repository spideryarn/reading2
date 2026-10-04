# Plan review: Debate gets Reception and Claims sub-modes, and a tidier panel

You are reviewing a **plan**, read-only. Change no file.

**Candidate (live, pre-commit):** base `1a019b71d`, one untracked file:
`docs/plans/261003o-debate-reception-and-claims-sub-modes-and-a-tidier-panel.md`. Read it first.
It refers to an investigation and a postmortem that are not written yet; the measurements they will
hold are summarised in the plan's own section "What is there today, and what the quick evals found".

**Context to read, as far as you need:** `docs/project/debate.md`, `src/web/DebatePanel.tsx`,
`src/web/debate-levels.ts`, `src/web/debate-order.ts`, `src/web/debate-threads.ts`,
`src/web/modes/debate/DebateMode.tsx`, `src/web/params.ts` (the Debate params near line 1350),
`docs/project/url-state.md`, `docs/project/mode.md`, `src/types.ts` (search `DirectDebateRow`,
`identificationLevel`), `src/public/dto.ts` (search `publicDebate`), and the earlier plans
`docs/plans/260906b-…` (why the identification default was `quoted`), `260929h-…`, `260930j-…`,
`261002i-…`. Tests: `tests/debate-panel.test.tsx`, `tests/debate-bar.test.ts`,
`tests/debate-order.test.ts`, `tests/debate-threads.test.ts`, `tests/url-state.test.ts`.

The reader's request (an admin, trusted) is quoted at the top of the plan. He asked for the simplest
version that gets most of the value.

## What to do

Attack the plan independently first. Is it the right v1 for the request? Will it work against the
code as it is? What does it break that it does not mention (a visitor's view, Marginalia's Debate
items, the command bar, chat tools, last-view restore, links already in the wild, tests that pin
today's behaviour)? Is anything in it wrong about how the code works today? Is there a smaller plan
that gets the same value, or a part that should be cut?

Severity, by consequence: **P0** data loss, security, wrong charging, service unusable. **P1**
user-visible wrong behaviour or an authoritative contract violated. **P2** design or
maintainability risk, nothing wrong today. **P3** prose. Say for each finding whether it is
*established* (direct evidence: an exact source path, a contract contradicted) or *reasoned*.
Give every finding an id, `F1`, `F2`, … End with a verdict line: `VERDICT: build as planned`,
`VERDICT: build with the P0/P1 fixes`, or `VERDICT: do not build`, and why.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- Changing `DEBATE_LEVEL_DEFAULT` from `quoted` to `named` reverses a measured decision from
  260906b (the "Claude's constitution" decoy: a page about a different document with the same
  title). Is sorting stronger identification first, plus the chip, enough? Is there a better rule,
  for example treating `named` by title-and-byline differently from title alone?
- `?debateby=claim` used to draw both groups; mapping it to the Claims sub-mode changes what an old
  link shows.
- The thread rule in step 5 (a thread with no rows in this sub-mode narrows nothing) against the
  existing rule that buttons are disabled when the bars hide every source in them.
- Whether Reception as the default lands most readers on an empty tab, since most pieces have no
  reception.
