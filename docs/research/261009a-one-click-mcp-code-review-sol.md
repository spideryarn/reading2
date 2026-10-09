Fixed issues in all four scoped files:

- [spideryarn-mcp.ts](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/mcp-spike/scripts/spideryarn-mcp.ts:171): Claude Code now receives the generated `PATH`; Node lookup requires an executable file and resolves relative directories.
- [mcp-session.test.ts](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/mcp-spike/tests/mcp-session.test.ts:519): added regressions and a real shell roundtrip covering spaces, single quotes and metacharacters.
- [mcp.md](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/mcp-spike/docs/project/mcp.md:40) and [research doc](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/mcp-spike/docs/research/261009a-one-click-mcp-install-for-claude-and-chatgpt.md:130): corrected DCR/single-client claims, distinguished Sol’s F1 from F6, and updated ChatGPT options against [official OpenAI docs](https://developers.openai.com/api/docs/guides/custom-mcp-server).

No stdout contamination found. All **49 requested tests passed**, including the real-server stdio test. Lint and whitespace checks passed. `npm run typecheck` hit sandbox IPC `EPERM`; the same script passed via `node --import tsx scripts/typecheck.ts`.

Wider decision: remote enablement still requires the OAuth spike and your choice of client trust policy; enabling DCR alone cannot satisfy the current single-client gate.

VERDICT: fixed