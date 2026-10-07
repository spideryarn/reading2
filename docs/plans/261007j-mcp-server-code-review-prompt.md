# Code review: the local MCP server (261007j), stages 1 and 2

You are reviewing **and fixing** code in this worktree. The candidate is three commits on top of
`47465ba57`: `a7ebb87e8` (plan and note), `fc92761db` (stage 1, the code), `33c268b00` (stage 2,
the spike and the doc). `git diff 47465ba57..33c268b00 --stat` lists every changed path. Start with
`src/mcp/session.ts`, `src/mcp/tools.ts`, `src/mcp/server.ts`, `src/mcp/approve.ts`,
`src/mcp/api.ts`, `scripts/spideryarn-mcp.ts`; that list does not limit your scope. Read
`CLAUDE.md`, then the plan `docs/plans/261007j-mcp-server-for-spideryarn-admins-first.md` (§ How
you sign in, § The tools, § Sending mail and publishing ask the human, § A retry sends one gift,
§ One reader per server, § What landed). Your own two plan reviews are beside it
(`261007j-mcp-server-plan-review-sol.md`, `-review-2-sol.md`); § Review in the plan says how each
finding was taken, including F12, which was decided by arbitration (a native macOS dialog rather
than elicitation). **Read the conclusions in § What landed as a reviewer of conclusions too.**

## What to attack, independently first

- The session file: permission and ownership checks, the owner-tagged lock and its stale takeover,
  atomic writes, refresh under the lock, logout racing refresh, the binding of a server to one
  reader (F14), and whether a token can reach stdout, stderr, a tool result or an error.
- The approval gate: can any path run an asking tool's write without `approve()` returning true?
  Does `update_gift_voucher` ask whenever the change re-sends (compare `parseVoucherPatch` and the
  PATCH handler in `src/routes.ts` — does anything besides `email` re-send)? Is the `osascript`
  invocation injection-safe and does `readDialogAnswer` read the real output format?
- The tools against the routes they call: body field names and shapes (`src/routes.ts`,
  `src/store/pg-vouchers.ts` `parseNewVoucher`/`parseVoucherPatch`, `parseVisibilityRequest`,
  `patchReader`, `parseJobRequest`), error mapping, the voucher id derivation (F13).
- `scripts/spideryarn-mcp.ts`: does `serve` keep stdout pure from the first byte; argument parsing;
  failure messages.
- Data sent into the model's context: anything returned that should be trimmed. One is known
  already and is yours to fix: `set_auto_modes` returns the whole `/api/reader` profile, including
  the reader's profile text; it should return only `{ autoModes }` (and check `whoami` for the
  same).
- The tests: would they fail against a broken implementation, or do they share an assumption with
  the code (docs/reusable/silent-success.md)?

## How to work

Fix what is inside this stage, narrowly, **red first**: write or adjust the test, watch it fail,
then fix. Run `npx vitest run tests/mcp-tools.test.ts tests/mcp-session.test.ts
tests/mcp-stdio.test.ts` and `npm run typecheck` yourself. You have no network, so the spike
(`scripts/spikes/261007j-mcp-local-spike.ts`) is not yours to run; its output is in § What landed.
Do not commit. Do not touch `src/routes.ts`, `src/auth.ts` or anything in
`docs/project/security-map.md` § Where the defences physically live. **Report, do not fix,**
anything wider.

## My own suspicions (worth less; spend most of the run elsewhere)

- The stale-lock takeover by rename: two processes taking over the same stale lock at once.
- Whether a 401 retry after a refresh could ever use a token read before the binding check.

## Output

Findings with an ID (C1, C2…), severity (P0 harm or a defence breach; P1 wrong in a way that
matters; P2 worth changing; P3 nit), file:line, and for each: fixed (with the test that went red)
or reported. Then the gate results you ran. Last line: `VERDICT: ready`, `VERDICT: ready after the
fixes above`, or `VERDICT: not ready`.
