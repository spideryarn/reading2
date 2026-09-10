/**
 * **An environment for a child process that says nothing about which account ran the suite.**
 *
 * Since plan 260909g every session the Overseer dispatches runs with `CLAUDE_CONFIG_DIR` pointing
 * at a pool account, and a test that hands a child `{ ...process.env }` hands it that too. Two
 * suites then failed for exactly those sessions and passed for everyone else — `run-claude.ts`
 * routes whenever the variable is merely present, and a bash job inherited it before the line
 * that was meant to be the only one setting it — and each presented as "I broke this file".
 * docs/plans/260910d-tests-pinned-to-one-account-environment-and-sanitisedenv-drop-wins.md.
 *
 * The rule: **a test decides the account environment its child sees; the runner does not.** A test
 * that wants one of these variables set passes it in `overrides`, where a reader can see it.
 *
 * This strips a *named list*. A variable that starts routing an account next month and is not on
 * it will leak exactly as these did; the list is the thing to extend, and the plan says so.
 */

/**
 * The variables that pick an account, or a credential, for a Claude or Codex child. Each one,
 * inherited, changes which account a spawned `claude`/`codex` — or a wrapper that routes on it —
 * would bill or refuse.
 */
export const ACCOUNT_ROUTING_VARIABLES = [
  "CLAUDE_CONFIG_DIR",
  "CODEX_HOME",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "CODEX_API_KEY",
  "OPENAI_API_KEY",
] as const;

/** `base` with every account-routing variable removed, then `overrides` applied on top. */
export function accountNeutralEnv(
  overrides: NodeJS.ProcessEnv = {},
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const name of ACCOUNT_ROUTING_VARIABLES) delete env[name];
  return { ...env, ...overrides };
}
