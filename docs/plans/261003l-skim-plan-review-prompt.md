# Plan review: 261003l — Skim arrows stay in the band; stops shared across depths

You are reviewing a **plan**, read-only. Change no file.

## The candidate

- The plan: `docs/plans/261003l-skim-arrows-stay-in-the-band-and-stops-shared-across-depths.md`
  (committed on this worktree's branch; the commit is HEAD).
- Nothing is built yet. The code it proposes to change, to read as it stands at HEAD:
  `src/skim.ts` (the step, prompt, `validateRoute`, schema), `src/types.ts` § `SkimStop`,
  `src/web/skim-route.ts`, `src/web/modes/skim/SkimMode.tsx`, `src/web/SkimPanel.tsx`,
  `src/public/dto.ts` § `publicSkim`, `src/web/flash.ts`, and the mode's doc
  `docs/project/skim.md`. Tests: `tests/skim.test.ts`, `tests/skim-route.test.ts`,
  `tests/skim-panel.test.tsx`. This list is where to start, not a limit.
- House rules that bind it: `AGENTS.md`, `docs/project/prompting-guide.md`,
  `docs/project/mode.md`, `docs/project/narrow-windows.md`.

## What to do

An independent pass first. Attack the plan: is each stage's design correct against the code as it
is, is anything it says about the current code false, what breaks that it does not mention (URL
state, history, the visitor's band, old stored routes, the export bundle, freshness/stamps, the
stop card, keyboard, the reader's `/help`), is the measurement able to show what it claims, and is
there a simpler design that gives Greg what he asked for in his quoted words. You may run a test
file that needs nothing outside the tree (`npx vitest run tests/skim-route.test.ts`); you have no
network and no Postgres.

## Severity, and what a refusal takes

P0 data loss, exploitable security, incorrect charging, service broadly unusable ·
P1 user-visible wrong behaviour, or an authoritative contract violated ·
P2 design or maintainability risk with no wrong behaviour today ·
P3 non-behavioural prose or comment defect.

Grade by consequence. Say for each finding whether it is **established** (direct evidence, exact
source path) or **reasoned**. Refuse the plan only on an established P0 or P1. Give every finding
an id, F1, F2, …, a file and line where there is one, and the change you would make.

End with one line: `VERDICT: build as planned` / `VERDICT: build after fixes (F…)` /
`VERDICT: do not build`.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- Whether `moveTo` no longer stepping aside leaves a held flash or a scroll in a wrong state when
  the band covers, or changes what the arrow keys do when the band has stepped aside.
- Whether `locate` preferring the asked depth for a carried stop breaks an old link or the
  "stop wins" rule's tests.
- Whether a required `again` array under the strict schema, at low effort, is likely to be filled
  with everything or nothing.
- Whether the pips in the number column collide with the position line and its "where am I" button.
