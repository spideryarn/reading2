# Narrow check of one fix: F8 (Diagram's stale press context)

Read-only. Do not change any file. This is **not** a general review: discovery is closed. Check one
fix, written by an Opus subagent after your code review of 261003l, and so unreviewed.

**Candidate**: commit `ebf1c0d62`, only these paths: `src/web/Dock.tsx`, `src/web/reader/Reader.tsx`,
and the new test in `tests/every-mode-draws-its-surface.test.tsx` (search "F8"). Diff:
`git show ebf1c0d62 -- src/web/Dock.tsx src/web/reader/Reader.tsx tests/every-mode-draws-its-surface.test.tsx`.

**Your finding**, in `docs/postmortems/261003f-activation-targets-read-from-delayed-urls-can-outlive-their-presses.md`:
Dock derived the Diagram press context from `location.search` at render, so Force → immediate
Diagram command row armed a `sketch` token nothing claimed, and Back spent it.

**The fix**: Reader passes `subNav.diagram` into `<Dock diagram>`; Dock uses the prop when given and
falls back to `diagramInSearch(search)` off the reading view.

Answer three things, each *established* or *reasoned*:
1. Is F8 closed on the reading view — every arming path in Dock (the bar press, the command bar's
   mode row, the sub-mode rows) reads the prop and not the address?
2. Is the new test sensitive — would it fail if `Reader.tsx` stopped passing the prop? You may run
   `npx vitest run tests/every-mode-draws-its-surface.test.tsx` (no Postgres needed).
3. Can `subNav.diagram` and `diagramInSearch` disagree at a settled address (the unrecognised-value
   degrade, the experimental switch), so the fix changes what a press arms in an ordinary case?

One line to finish: **F8 closed** / **F8 still open**, with the reason.
