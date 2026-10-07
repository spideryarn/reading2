The stale-copy fix is sound after one P1 fix. The original “Greg saw `[chunk]`” conclusion overclaimed; the feedback note currently in the worktree has since been qualified sufficiently, but the postmortem still makes that unsupported attribution.

## Findings

- **P1 — Fixed:** [LazyPage.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbu6uba0-changelog-errors-on-ipad/src/web/LazyPage.tsx:201) waited forever when `location.reload()` returned without replacing the document. It now releases the original error after five seconds, showing `[chunk]`. The regression test failed first, then passed.

- **P2 — Fixed:** [lazy-page.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbu6uba0-changelog-errors-on-ipad/tests/lazy-page.test.tsx:258) previously claimed a reload while its mock only returned `true`; no reload was requested. The test now calls and asserts `reloadPage`, and separately covers a no-op reload.

- **P2 — Not fixed:** [the postmortem](/home/greg/code/spideryarn2/.claude/worktrees/fbu6uba0-changelog-errors-on-ipad/docs/postmortems/261003f-a-home-screen-app-outlives-every-deploy-and-has-no-reload-button.md:9) says Greg definitely saw `[chunk]`. That is not established; `BJ` occurred closer to the report. Similar attribution remains in comments at [LazyPage.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbu6uba0-changelog-errors-on-ipad/src/web/LazyPage.tsx:173) and [lazy-page.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbu6uba0-changelog-errors-on-ipad/tests/lazy-page.test.tsx:251). I left the concurrently edited documentation alone.

- **P2 — Not fixed, wider:** [scripts/build-stamp.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbu6uba0-changelog-errors-on-ipad/scripts/build-stamp.ts:57) and [vite.config.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbu6uba0-changelog-errors-on-ipad/vite.config.ts:460) still say `builtAt` is informational and never asserted. It is now operationally part of stale-build identity. Those files were outside this change.

- **P3 — Not fixed, accepted limitation:** [LazyPage.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbu6uba0-changelog-errors-on-ipad/src/web/LazyPage.tsx:229) treats any rejected lazy import as potentially stale, including a module-evaluation bug. That can cause one unnecessary reload if another build is live, but cannot loop and loses no mounted page state.

## Conclusion and trace

The current feedback note’s lines 36–49 now explicitly ask which message Greg saw and state that `[render]` is not fixed. With `BJ` separately queued, `ending: shipped` is defensible under the project’s deferred-work rule. Do not tell Greg that his observed error was certainly `[chunk]`; say that the matching, reproduced `[chunk]` failure is fixed.

The remaining mechanics check out:

- A single Vite `stamp` supplies both compiled constants and `build.json`. A fresh production build confirmed the commit and `builtAt` strings occur byte-for-byte in the emitted bundle.
- `sessionStorage` is written and read back before reload, and survives ordinary reloads. A current new bundle also stops naturally because its identity equals `/build.json`.
- The address is compared before and after the request.
- The request has a four-second raced deadline.
- SPA-rewritten HTML fails JSON parsing and safely returns `null`.
- A throwing reload falls through to the original error; a no-op reload now falls through after five seconds.
- *Try again* and `routeKey` reset behavior are unchanged.
- The copy follows `copy.md`; Reload is a native, named, focus-visible button.

Changed by me:

- `src/web/LazyPage.tsx`
- `src/web/stale-shell.ts`
- `tests/lazy-page.test.tsx`

Checks:

- Scoped suites: 36 passed.
- Typecheck: clean via the equivalent Node loader invocation.
- Biome: clean.
- Doc links and eager graph: 25 passed.
- Production client build: passed.
- Full `npm test` could not start its database lane because this sandbox denies local Postgres/Docker access; the user-provided pre-review run was green.
- No commit made.

**Verdict: ship it with the fixes made**