Recorded F6–F9 in the plan:

| ID | Severity | Evidence | Finding | Status |
|---|---|---|---|---|
| F6 | P2 | Established | Back test never pressed Back or pushed the mode entry. | Fixed with real Reader tests. |
| F7 | P1 | Established | Command quick search omitted Search’s mode herald. | Fixed; regression watched red, then green. |
| F8 | P3 | Established | Docs incorrectly described shared behavior and the panel cross. | Fixed. |
| F9 | P1 | Reasoned | Empty busy fields may let placeholder text overlap the spinner. | Inherited; reported, left unchanged. |

**Validation:** 202 tests passed, including the six requested files; typecheck passed. All three requested mutations were caught and restored. The new Reader test also caught removal of rail restoration. Native focus, soft keyboards, browser geometry, and the full suite remain unverified here.

**Verdict: ship after these fixes — applied.**

Files changed:

- [Reader.tsx](/home/greg/code/spideryarn2/.claude/worktrees/bar-opens-quick-search/src/web/reader/Reader.tsx)
- [dock-quick-search.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/bar-opens-quick-search/tests/dock-quick-search.test.tsx)
- [mode-herald-wiring.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/bar-opens-quick-search/tests/mode-herald-wiring.test.tsx)
- [search.md](/home/greg/code/spideryarn2/.claude/worktrees/bar-opens-quick-search/docs/project/search.md)
- [Previous cross plan](/home/greg/code/spideryarn2/.claude/worktrees/bar-opens-quick-search/docs/plans/261004g-quick-search-box-clear-cross.md)
- [Stage plan and review ledger](/home/greg/code/spideryarn2/.claude/worktrees/bar-opens-quick-search/docs/plans/261005i-the-command-bar-opens-quick-search-and-the-search-panel-box-gets-a-clear-cross.md)
- [Root-cause postmortem](/home/greg/code/spideryarn2/.claude/worktrees/bar-opens-quick-search/docs/postmortems/261005h-sharing-an-arrival-predicate-drops-the-rest-of-the-press.md)