Accurate. In the repaired tree, the claim holds:

- Registration requires `tokens.account_id === id_token.chatgpt_account_id`.
- Neither the wizard nor the parser authenticates the token, and no code or documentation claims otherwise.
- The wizard never executes `codex login`; it only prints the command after safe preflight.
- Nothing writes, rotates, or replaces `auth.json`.

No outstanding P0/P1. Accept after repairs.

Findings:

- **F1 — P1, fixed:** Known refusal paths seeded and rewrote `config.toml` before validating an unreadable credential or an existing registry pin. Identity and pin checks now precede seeding, with byte-preservation tests. [claude-accounts.ts](/home/greg/code/spideryarn2/.claude/worktrees/codex-accounts/scripts/claude-accounts.ts:1753)

- **F2 — P1, fixed:** A missing credential received a `codex login` instruction even when the home used a redirected `chatgpt_base_url` or keyring storage, where the resulting credential could not be registered locally. Seed preflight now validates routing, storage, provider and state paths before modifying config or offering login. [claude-accounts.ts](/home/greg/code/spideryarn2/.claude/worktrees/codex-accounts/scripts/claude-accounts.ts:889)

- **F3 — P3, fixed:** Help implied `--seed` controlled Codex seeding. It now says Codex always seeds. [claude-accounts.ts](/home/greg/code/spideryarn2/.claude/worktrees/codex-accounts/scripts/claude-accounts.ts:1989)

- **F4 — P2, outstanding:** The verifier is sufficient for the home’s own `config.toml`, but does not prove safe endpoint routing across every effective configuration layer. Codex 0.153.4 can also load system/managed layers; doctor reports the effective provider but not the effective `chatgpt_base_url`. Those layers are absent on this box, and project configuration is forbidden from setting routing keys, so this is not an established current misrouting defect. Stage 2 must separately constrain runtime flags and environment. [Codex 0.153.4 configuration loader](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/config/src/loader/mod.rs)

- **F5 — P2, outstanding:** `primaryRepoRoot()` is correct for this repo’s standard `.claude/worktrees/<name>` layout, but it is a path-string heuristic, not a Git relationship check. An unrelated nested checkout beneath such a path can be truncated to the wrong repository, while a linked worktree elsewhere seeds only that checkout. No current path is wrong.

The remaining suspicions did not produce findings: TOML serialization is stable across the second run; the workspace refusal is actionable; and nothing currently trusts `familyData.workspaces` without rereading `auth.json`.

Verification:

- Focused gate: 143/143 passed.
- Typecheck: all four projects and 1,914 files passed.
- `git diff --check`: passed.
- Scoped lint: no errors; existing advisory diagnostics only.
- Full `npm test` could not start the database lane due sandbox `EPERM`.
- `run-claude.test.ts`: its subprocesses hit the sandbox’s `tsx` IPC `EPERM`; 36 tests passed before that boundary.
- No real Codex binary was invoked by tests.
- No commit made.