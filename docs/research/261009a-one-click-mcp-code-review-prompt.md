# Code review: `spideryarn-mcp.ts config`, and the MCP setup docs

You are reviewing a small change in this repo (worktree root = cwd). Review it, **fix what you find
inside these files**, and report anything wider for me to decide. Run `npx vitest run
tests/mcp-session.test.ts tests/mcp-stdio.test.ts tests/doc-links.test.ts` and `npm run typecheck`
after any fix.

## What changed and why

Greg's local MCP server (`scripts/spideryarn-mcp.ts serve`) had never worked for him. A spike on
2026-10-09 found two causes: the primary checkout's `node_modules` predated the MCP SDK (server died
with ERR_MODULE_NOT_FOUND, app said only "Connection closed"), and `docs/project/mcp.md`'s example
config named a nonexistent checkout path. The change:

1. `scripts/spideryarn-mcp.ts`: a new `config` command printing the Claude Desktop `mcpServers` JSON
   and the `claude mcp add --scope user …` line, with this checkout's absolute paths and node's
   directory (found on the shell's PATH, not `process.execPath`, because Homebrew's execPath is a
   versioned Cellar path) first on `PATH`. `clientConfig` is exported and unit-tested.
2. `tests/mcp-session.test.ts`: four cases for it.
3. `docs/project/mcp.md`: setup rewritten around `config`; a "Checking it works" section (MCP
   Inspector via `--config`, because given the command directly the Inspector swallowed `--site`);
   a note that the remote route is not one click as designed.
4. `docs/research/261009a-one-click-mcp-install-for-claude-and-chatgpt.md`: new, the research and
   spike findings.

Things to check in particular:
- `serve` owns stdout for the protocol; `config` deliberately writes stdout. Is there any path by
  which `config`'s output or the new imports could reach stdout during `serve`?
  (`tests/mcp-stdio.test.ts` spawns the real server.)
- `shellWord` quoting correctness for paths with spaces and single quotes.
- Are the doc claims accurate against the code (e.g. the Desktop log path, `claude mcp get`,
  remote section claims about `MCP_OAUTH_CLIENT_ID` accepting one client — see `src/mcp/remote.ts`)?
- Anything in the research doc's "decision" section that misstates plan 261007p
  (`docs/plans/261007p-mcp-remote-sign-in-with-oauth.md`) or its Sol review.

## The diff

Run `git diff HEAD` and read the untracked research doc yourself.

End your answer with `VERDICT: ok`, `VERDICT: fixed` (you changed files; list them) or
`VERDICT: rethink`.
