Fixes remain uncommitted.

- **P2 — Fixed:** Missing or malformed `TMUX_PANE` could select another session and label a peer as the Overseer. [The query](/var/tmp/spideryarn-worktrees/agent-a3f9ca538e6442814/scripts/gjd-remote-tell.ts:108) now requires a literal `%N` target; otherwise attribution falls back to an unnamed agent. Four regressions failed before the fix.
- **P3 — Fixed:** Docs overstated guaranteed Overseer attribution. They now describe matching and fallback conditions.
- No further injection, fingerprinting, receipt-reader, or dashboard/box-notifier compatibility defects found. Added receipt and replay coverage.

`CODEX_` names set: `CODEX_VERSION`, `CODEX_SESSION_ID`, `CODEX_THREAD_ID`, `CODEX_CI`, `CODEX_SANDBOX_NETWORK_DISABLED`. The plan’s detection assumption holds.

Validation:

- Separate runs passed **32 tell-helper tests, 58 steer-route tests, and 165 supporting tests**.
- The required combined run hung amid sandbox subprocess errors and was interrupted; CLI integration still needs an unrestricted-shell rerun.
- `npm run typecheck` hit tsx’s `listen EPERM`. **Direct invocation passed all four projects and source coverage.**
- Scoped lint passed with informational suggestions only.