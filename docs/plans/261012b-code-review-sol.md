APPROVE AFTER FIXES

1. **Medium — The no-press capability was too permissive at the type boundary.** Evidence: [src/mcp/tools.ts](/var/tmp/spideryarn-worktrees/mcp-admin-no-press/src/mcp/tools.ts:80), [src/mcp/remote.ts](/var/tmp/spideryarn-worktrees/mcp-admin-no-press/src/mcp/remote.ts:195). I replaced the caller-supplied `admin` boolean with a verified user ID checked through `isAdmin`, restricted `webAdmin` at compile time to exactly the two named tools, required an existing `ask`, prohibited a simultaneous `remote` form, and retained the independent execution-time identity check before any API access.

2. **Low — Served forms spread internal policy fields.** Evidence: [src/mcp/tools.ts](/var/tmp/spideryarn-worktrees/mcp-admin-no-press/src/mcp/tools.ts:1078). I changed both transformations to construct served tools field-by-field, so `remote` and `webAdmin` cannot leak or be reprocessed.

3. **Medium — Coverage for non-admin and stdio behavior was weaker than its claim.** Evidence: [tests/mcp-tools.test.ts](/var/tmp/spideryarn-worktrees/mcp-admin-no-press/tests/mcp-tools.test.ts:1232), [tests/mcp-remote.test.ts](/var/tmp/spideryarn-worktrees/mcp-admin-no-press/tests/mcp-remote.test.ts:371). I added execution tests proving both admin and non-admin stdio sessions still encounter the press, the no-press handler refuses a non-admin before any API call, only the two approved tools have the capability, transformed tools contain no policy metadata, and all three email-sending forms remain unreachable remotely.

4. **Low — Documentation overclaimed that non-admin web accounts would see a dialog.** Evidence: [mcp.md](/var/tmp/spideryarn-worktrees/mcp-admin-no-press/docs/project/mcp.md:189), [security-map.md](/var/tmp/spideryarn-worktrees/mcp-admin-no-press/docs/project/security-map.md:165). I corrected this: the web route currently refuses non-admins; if later opened, these tools remain omitted. The Mac server retains the dialog for everyone. The prompt-injection risk and accepted R26 remain accurately documented in `security.md` and `security-risks.md`.

5. **Low — The earlier plan review contained broken repository links.** Evidence: [261012b-plan-review-sol.md](/var/tmp/spideryarn-worktrees/mcp-admin-no-press/docs/plans/261012b-plan-review-sol.md:3). I corrected them; the documentation-link suite now passes.

Anything wider not fixed: none. I did not touch the unrelated pre-existing feedback/generated-file changes and did not commit.

Tests and typecheck:

- Requested Vitest command: blocked before collection because this sandbox forbids connecting to local Postgres (`EPERM 127.0.0.1:54362`).
- Database-free subset: **122/122 passed** across `mcp-tools`, `mcp-remote-boundaries`, and `doc-links`.
- `mcp-remote.test.ts`: not executable here because of that database restriction.
- Exact `npm run typecheck`: its `tsx` launcher was blocked from creating an IPC socket.
- Equivalent `node --import tsx scripts/typecheck.ts`: **passed all four TypeScript projects; all 3,735 source files covered**.
- Biome lint on the four changed TypeScript files: **passed**.
- `git diff --check`: **passed**.