# Plan review: Find more rows in the command bar, and more mode aliases

You are reviewing a **plan**, before anything is built. Read-only: change no file.

## The candidate

`docs/plans/261004k-command-bar-find-more-rows-and-more-mode-aliases.md`, committed on this branch
(the tip commit; `git log -1 -- <that path>`). Nothing else has changed. The tree is readable; read
the code the plan talks about rather than trusting the plan's account of it.

Where to start (this does not limit scope): `src/mode-catalog.ts`, `tests/mode-catalog.test.ts`,
`src/web/command-match.ts` (ranking tiers, `parseArgumentQuery`), `src/web/CommandBar.tsx`
(`besideTheModes`, `rerunRows`, the argument rows), `src/web/rerun-commands.ts`,
`src/web/glossary-ask-handoff.ts`, `src/web/command-runners.ts`, `src/web/GlossaryPanel.tsx`
(`MoreRow`, and the effect that takes the ask hand-off), `src/web/useGlossary.ts` (`more`),
`src/web/QuotesPanel.tsx` (`findMore`, `Foot`), `src/web/useQuotes.ts`, `src/command-pick.ts` and
`src/web/command-proposal.ts` (the catalogue a fast model picks from),
`docs/project/reading-view-overview.md` § The command bar.

## What to do

Attack the plan independently first. Is each claim under "What exists" true of the code? Will the
design work as written — ranking, the hand-off, eligibility, one POST per press, StrictMode, the
interface-model catalogue? What would make a reader's press do something its row did not say, spend
twice, or do nothing silently? Is there a simpler design that gets the same result? Is anything
missing from the test list that would let a real defect through?

You may run a test file that needs nothing outside the tree (no Postgres, no network).

## Output

Findings with stable IDs `F1`, `F2`, …, each with a severity and its evidence (file and line):

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Say for each whether it is **established** (direct evidence) or **reasoned**. End with one line:
`VERDICT: build as planned` / `VERDICT: build with the changes above` / `VERDICT: do not build`.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- Typed `find more` and `find more terms`: `parseArgumentQuery` will offer *Find “more terms” in
  this article*. Where do argument rows sit relative to ranked rows, and can the new rows come first?
- "Taken and dropped when ineligible": the band's read may still be loading when the hand-off
  arrives; is "settled" well defined in both hooks, and can a job that finishes inside the window
  turn a dropped press into a late one?
- Glossary's `rewrites` falls back to `stale || outdated` when the server's `panelRun` verdict is
  absent; is "not rewrites" enough to promise an append?
- Many more aliases: prefix and substring tiers may now put the wrong mode first for short queries
  (`re`, `qu`, `con`). Is there a cheap test that would catch a regression in first-rank for each
  mode's own label prefix?
