# Code review: Light, Dark and System as command bar rows

You are reviewing **code**, and you may fix what you find. Your sandbox is workspace-write in this
worktree.

## The candidate

One commit on this branch, the tip: `git show --stat HEAD` lists the changed paths, and
`git diff HEAD~1..HEAD` is the whole change. The tree is clean at that commit, so any diff after
your run is yours.

The plan, with your own plan-stage findings F1–F4 and what was done about each:
`docs/plans/261005d-theme-commands-in-the-command-bar.md` (§ After GPT Sol's plan review) and
`docs/plans/261005d-theme-commands-plan-review-sol.md`. **Use new IDs from F5 on**; reuse F1–F4 only
to say one of those is still open.

Start with (this does not limit scope): `src/web/appearance-commands.ts`, `src/web/appearance.ts`,
`src/web/CommandBar.tsx` (`commandMarker`, the `commands` memo, the row markup, `activate`),
`src/web/command-match.ts` (`CommandWords.marker`, `pickOption`, `rankCommands`),
`src/command-pick-catalogue.generated.json`, `src/web/help/help-topics.tsx`, and the tests
`tests/appearance-commands.test.tsx`, `tests/command-bar-pick.test.tsx`,
`tests/command-match-arguments.test.ts`, `tests/command-match-mode-aliases.test.ts`,
`tests/command-pick-catalogue.test.ts`. Docs: `docs/project/reading-view-overview.md` § The command
bar, `docs/project/web-client.md` § Appearance.

## What to do

1. An independent pass first. Can a reader's press do something its row did not say, or do nothing
   silently? Is the `current` mark ever wrong or stale: after a press, after a refused save, after
   another tab or /profile changes the choice while the bar is open, under System when the OS
   flips? Does any word now put an Appearance row above the row a reader plainly meant, or fail to
   put one first for the words the docs promise? Does `marker` leak into anything a model is shown,
   or into ranking? Does the sentence-picking path (`knownOptions`, the catalogue, the pick test)
   hold for all three ids? Do the docs and the Help sentence say what the code does? Is anything
   attributed to Greg that is not the one sentence quoted at the top of the plan?
2. **Fix what is inside this change**, narrowly and red-first (a failing test before the fix).
   **Report, do not fix**, anything wider.
3. Run the test files yourself where they need nothing outside the tree (jsdom and pure tests; no
   Postgres), e.g. `npx vitest run tests/appearance-commands.test.tsx tests/command-bar-pick.test.tsx tests/command-match-arguments.test.ts tests/command-match-mode-aliases.test.ts tests/command-pick-catalogue.test.ts tests/appearance.test.ts`.
   What I ran is in the commit message. Do not commit.

## Output

Findings `F5`, `F6`, … each with severity, **established** or **reasoned**, evidence (file:line),
and whether you fixed it (name the files you changed).

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

End with one line: `VERDICT: ship` / `VERDICT: ship with the fixes above` / `VERDICT: do not ship`.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- `ORDER` in `appearance-commands.ts` is Dark, Light, System; /profile's is System, Light, Dark.
  Does the difference matter anywhere but the tie order for `theme`?
- The storage-refused press returns `stay` from a synchronous `run`; does `activate` treat a
  synchronous `stay` as it does an awaited one (message shown, rows still pressable)?
- `tests/command-bar-pick.test.tsx` gained a case that changes the module-level appearance and
  resets it by hand; can it leak into a later test in that file?
- The alias `theme` is shared by three rows and Debate's description mentions themes; `system`,
  `os theme`, `match device` were chosen by ear.
