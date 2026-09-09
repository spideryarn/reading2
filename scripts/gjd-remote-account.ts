/**
 * The small, pure boundary between gjd-remote and the account registry command
 * that runs on the box. Account choice cannot happen in gjd-remote's calling
 * process: that process is often on Greg's Mac, while the registry, usage and
 * launch-reservation lock exist only on the box.
 */

const ACCOUNT_NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;
const BOX_SPIDERYARN = "/home/greg/code/spideryarn2";

const shq = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;

export function requestedClaudeAccount(requested: string | undefined): string {
  return requested ?? "auto";
}

export type ResolvedLaunchAccount = {
  name: string;
  family: "claude";
  stateDir: string | null;
  providerAccountId: string | null;
  providerTenantId: string | null;
  displayEmail: string | null;
  reason: string;
};

export type ParsedLaunchAccount =
  | { kind: "value"; account: ResolvedLaunchAccount }
  | { kind: "refused"; why: string };

/** Parse the one JSON record emitted by the box-side `resolve` subcommand. */
export function parseResolvedLaunchAccount(raw: string): ParsedLaunchAccount {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { kind: "refused", why: "the account resolver did not return one JSON record" };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { kind: "refused", why: "the account resolver returned something other than an object" };
  }
  const o = value as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  if (keys.join(",") !== "displayEmail,family,name,providerAccountId,providerTenantId,reason,stateDir") {
    return { kind: "refused", why: `the account resolver returned fields I do not understand (${keys.join(", ")})` };
  }
  if (typeof o.name !== "string" || !ACCOUNT_NAME.test(o.name)) {
    return { kind: "refused", why: "the account resolver returned an invalid account name" };
  }
  if (
    o.stateDir !== null &&
    (typeof o.stateDir !== "string" ||
      !o.stateDir.startsWith("/") ||
      o.stateDir.endsWith("/") ||
      o.stateDir.includes("\r") ||
      o.stateDir.includes("\n") ||
      o.stateDir.includes("\0"))
  ) {
    return { kind: "refused", why: "the account resolver returned an invalid config directory" };
  }
  if (
    o.displayEmail !== null &&
    (typeof o.displayEmail !== "string" ||
      o.displayEmail === "" ||
      o.displayEmail.includes("\r") ||
      o.displayEmail.includes("\n") ||
      o.displayEmail.includes("\0"))
  ) {
    return { kind: "refused", why: "the account resolver returned an invalid display email" };
  }
  if (o.family !== "claude") return { kind: "refused", why: "the account resolver returned the wrong family" };
  for (const key of ["providerAccountId", "providerTenantId"] as const) {
    if (o[key] !== null && (typeof o[key] !== "string" || o[key] === "" || /[\r\n\0]/.test(o[key]))) {
      return { kind: "refused", why: `the account resolver returned an invalid ${key}` };
    }
  }
  const ambient = o.stateDir === null;
  if (ambient !== (o.providerAccountId === null && o.providerTenantId === null)) {
    return { kind: "refused", why: "the account resolver returned a partial ambient identity" };
  }
  if (
    typeof o.reason !== "string" ||
    o.reason === "" ||
    o.reason.includes("\r") ||
    o.reason.includes("\n") ||
    o.reason.includes("\0")
  ) {
    return { kind: "refused", why: "the account resolver returned an invalid reason" };
  }
  return {
    kind: "value",
    account: {
      name: o.name,
      family: "claude",
      stateDir: o.stateDir,
      providerAccountId: typeof o.providerAccountId === "string" ? o.providerAccountId : null,
      providerTenantId: typeof o.providerTenantId === "string" ? o.providerTenantId : null,
      displayEmail: o.displayEmail,
      reason: o.reason,
    },
  };
}

/**
 * Run in ssh, not locally. The hidden CLI owns the on-box choose-and-reserve
 * lock; stdout is reserved for its one machine-readable result.
 */
export function accountResolveCommand(requested: string, launchName: string, sessionUuid = launchName): string {
  return (
    `cd ${shq(BOX_SPIDERYARN)} && ` +
    `${shq("node_modules/.bin/tsx")} scripts/claude-accounts.ts resolve ` +
    `--account ${shq(requested)} --launch-name ${shq(launchName)} --session-uuid ${shq(sessionUuid)}`
  );
}

export function accountOutcomeCommand(sessionUuid: string, outcome: "started" | "completed" | "failed"): string {
  return (
    `(cd ${shq(BOX_SPIDERYARN)} && ${shq("node_modules/.bin/tsx")} scripts/claude-accounts.ts outcome ` +
    `--session-uuid ${shq(sessionUuid)} --value ${shq(outcome)})`
  );
}

/**
 * Lines inserted into the generated job only for a flagged launch. `failure`
 * is gjd-remote's existing failTo() expression, so either guard leaves the
 * same durable FATAL note as its cd and command-v guards.
 *
 * Auth status contains identity metadata, not credentials. We never inspect,
 * print or pass either OAuth token here.
 */
export function accountJobLines(
  account: ResolvedLaunchAccount | undefined,
  failures: { missingConfig: string; wrongIdentity: string },
  verifyCommand?: string,
): string {
  if (account === undefined) return "";
  if (account.stateDir === null) return "";
  return [
    `[ -d ${shq(account.stateDir)} ] || ${failures.missingConfig}`,
    `${verifyCommand ?? (`(cd ${shq(BOX_SPIDERYARN)} && ${shq("node_modules/.bin/tsx")} scripts/claude-accounts.ts verify ` +
      `--account ${shq(account.name)} >/dev/null)`)} || ${failures.wrongIdentity}`,
  ].join("\n");
}

/** Route only the paid Claude process; the login shell after it inherits none
 * of this state. The four removals are credential precedence, not cleanup. */
export function accountClaudeCommand(
  account: ResolvedLaunchAccount | undefined,
  command: string,
): string {
  if (account?.stateDir == null) return command;
  return (
    "env -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL " +
    `-u CLAUDE_CODE_OAUTH_TOKEN CLAUDE_CONFIG_DIR=${shq(account.stateDir)} ${command}`
  );
}

/** Tmux metadata is absent only when account resolution was not performed. */
export function accountTmuxFlag(account: ResolvedLaunchAccount | undefined): string {
  return account === undefined ? "" : `-e CLAUDE_ACCOUNT=${shq(account.name)}`;
}

/** Includes its own separator for direct concatenation into the tmux command. */
export function accountTmuxPrefix(account: ResolvedLaunchAccount | undefined): string {
  const flag = accountTmuxFlag(account);
  if (flag === "" || account === undefined) return "";
  const metadata = JSON.stringify({
    v: 2,
    family: account.family,
    name: account.name,
    providerAccountId: account.providerAccountId,
  });
  return `${flag} -e CLAUDE_ACCOUNT_META=${shq(metadata)} `;
}
