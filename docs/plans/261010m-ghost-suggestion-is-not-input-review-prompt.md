# Code review: a ghost suggestion is not input (261010m)

You are reviewing an uncommitted change in this worktree. Read the plan first:
`docs/plans/261010m-ghost-suggestion-is-not-input.md`, then the postmortem
`docs/postmortems/261010b-ghost-suggestion-read-as-typed-input.md`. The diff is
`git diff` in this worktree (the three new files are intent-to-add, so they show).

Context: `tools/fleet/steer.ts` `sendMessage` types a message into another agent's Claude Code
tmux pane. It must only proceed when the input box is empty, because typed text is appended to
whatever is there and submitted as one turn. The change makes a box holding only Claude Code's dim
ghost suggestion count as empty, by capturing with `tmux capture-pane -p -e` and removing
SGR-2-dim characters before judging emptiness (`undimmedLines` in `tools/fleet/pane.ts`).
This area has a higher robustness bar: the wrong direction is calling a real draft empty.

Please check, and FIX what you find inside these files (you have workspace-write):

1. Can any realistic `capture-pane -e` output make typed (non-dim) text disappear from
   `undimmedLines`, so a real draft reads empty? Think about: SGR parsing (`38;5;n`, `38;2;r;g;b`,
   colon forms, `48`/`58`, empty params, `ESC[m`), state carried across lines, tmux's -e encoding,
   OSC 8 hyperlinks, the line-count fallback, the `❯` marker handling in `boxLineIsOccupied`.
2. Does the `-e` capture change any OTHER `paneSurface`/`parsePane` outcome on the send path
   (geometry: `shapeOf` widths with trailing bg-coloured spaces, border matching, dialog detection)?
   `answerQuestion` deliberately keeps the plain capture; is that right?
3. Is `SteerIo.capture(paneId, form)` with a required `form` correctly threaded through every
   implementation in the repo (grep for `SteerIo` and `capture:`)?
4. Are the tests meaningful (would they fail on the bugs they name)? Add any missing case you think
   matters.
5. Any doc or comment the change made stale.

Run only these test files (the box is loaded; do not run the full suite):
`npx vitest run tests/fleet-pane-surface.test.ts tests/fleet-steer.test.ts tests/fleet-pane.test.ts tests/fleet-steer-route.test.ts`
and `npm run typecheck`.

Do not run tmux send-keys against anything. Do not commit. Reply with: findings (each with
severity and whether you fixed it), the files you changed, and the test/typecheck results.
