APPROVE WITH CHANGES

- **F1 — P1: Bulk removal could delete the caller’s tree.** Evidence: `scripts/worktree-remove.ts:699`. Moving a candidate branch onto the caller after classification reproduced deletion. **Changed:** fresh caller/target filesystem-identity comparison, with ordinary and aliased-path regressions. **Recommendation:** land this guard.

- **F2 — P1: Failed containment reads could become “outside.”** Evidence: `scripts/worktree-inuse.ts:898,910`. Unreadable aliases and unresolved escaped names could produce idle. **Changed:** preserve errno; permission/I/O failures and ambiguous spellings become unknown. Ordinary deleted physical paths retain the intended behavior. **Recommendation:** keep this distinction.

- **F3 — P1: Descendant exclusion weakened Linux protection.** Evidence: `scripts/worktree-inuse.ts:488,944`. A detached child was ignored although the old process-group rule counted it. **Changed:** descendants must also share the asker’s group; esbuild remains excluded. **Recommendation:** retain the detached-child regressions.

- **F4 — P2: Filter names did not prove pipeline membership.** Evidence: `scripts/worktree-sweep.ts:234`; `scripts/worktree-remove.ts:752`. An independent same-group `tail -f` reproduced idle, including with a real process. **Changed:** bulk classification and fresh removal disable filter-name exemptions. **Recommendation:** keep them disabled in bulk; named removal retains the implementer’s chosen heuristic.

- **F5 — P2: The `ps -p` exception accepted inconsistent output.** Evidence: `scripts/worktree-inuse.ts:1028`. Exit 1 with partial output, or success with empty/unrequested rows, could hide live processes. **Changed:** reject these combinations; retain exit 1 only for empty output without stderr. **Recommendation:** preserve those protocol checks.

- **F6 — P2: Unicode decoding corrupted containment names.** Evidence: `scripts/worktree-inuse.ts:819`. Emoji beside an escaped newline became replacement characters. **Changed:** decode complete Unicode code points. **Recommendation:** retain the combined emoji/escape regression.

- **F7 — P3: The hook test did not exercise its claimed live-peer veto.** Evidence: `tests/worktree-remove.test.ts:785`. Its owner had already exited; the added assertion failed with `ESRCH`. **Changed:** keep the fixture alive and assert actual liveness refusal. Added Bash 3.2 tests for failed `ps` and start-time conversion. **Recommendation:** retain these behavioral checks.

All three scoped suites pass: **158 passed, 4 platform-specific skips**. Hook syntax and failure paths passed under Mac Bash 3.2. Fixes were red-first; no commit or network use.

Wider limits remain: named-removal filter heuristics and concurrent observation/alias races. They are recorded in the new postmortem, without attributing implementation trade-offs to Greg.