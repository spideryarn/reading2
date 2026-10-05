# Plan review: Light, Dark and System as command bar rows

You are reviewing a **plan**, before anything is built. Read-only: change no file.

## The candidate

`docs/plans/261005d-theme-commands-in-the-command-bar.md`, committed on this branch (the tip
commit). Nothing else has changed. The tree is readable; read the code the plan talks about rather
than trusting the plan's account of it.

Where to start (this does not limit scope): `src/web/appearance.ts`, `src/web/AppearanceSetting.tsx`,
`src/web/CommandBar.tsx` (`experimentalCommand`, `experimentalRows`, the `commands` memo, `activate`,
`onlyMovesTheReader`), `src/web/command-match.ts` (`Command`, `TIERS`, `rankCommands`,
`parseArgumentQuery`, `pickKey`, `pickOption`, `commandId`), `src/command-pick.ts` and
`src/command-pick-call.ts`, `tests/command-pick-catalogue.test.ts`,
`tests/command-match-arguments.test.ts`, `tests/command-match-mode-aliases.test.ts`,
`tests/command-bar-arguments.test.tsx`, `docs/project/reading-view-overview.md` § The command bar,
`docs/project/web-client.md` § Appearance.

## What to do

Attack the plan independently first. Is each claim under "What exists" true of the code? Will the
design work as written: ranking, ids, the pick catalogue (which keys on (id, label), and here a
description changes with state), the model-picked path, the storage-refused path, visitors, the
Metadata page? What would make a reader's press do something its row did not say, or do nothing
silently? Is there a simpler design that gets the same result? Is anything missing from the test
list that would let a real defect through?

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

- The description of the row in force changes with state. Does the generated pick catalogue, or the
  server's lookup of a key, depend on the description in a way that makes the current row
  unpickable or the catalogue test unstable?
- The alias `theme` on all three rows, and `system` / `light` / `dark` as substrings: does any
  existing row's label, alias or description now rank an appearance row above what the reader
  plainly meant (Debate has "themes"; Summary's levels; "highlight" contains "light")? Typed-only
  rows still rank once something is typed.
- Showing all three rows, the current one marked, departs from the "never a row that does nothing"
  rule. Is that the right call, or does something in the bar assume every drawn row changes state?
- A storage-refused press keeps the bar open over a page whose colours did change. Is `stay` the
  right outcome there?
