import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  accountClaudeCommand,
  accountJobLines,
  accountOutcomeCommand,
  accountResolveCommand,
  accountTmuxFlag,
  accountTmuxPrefix,
  parseResolvedLaunchAccount,
  requestedClaudeAccount,
} from "../scripts/gjd-remote-account.js";

const resolved = {
  name: "pool-two",
  family: "claude",
  stateDir: "/tmp/claude-pool-two",
  providerAccountId: "uuid-pool-two",
  providerTenantId: "org-pool-two",
  displayEmail: "pool-two@example.com",
  reason: "lowest seven-day usage (3%)",
} as const;

describe("the on-box account resolution boundary", () => {
  it("defaults an unflagged launch to auto while preserving an explicit main", () => {
    expect(requestedClaudeAccount(undefined)).toBe("auto");
    expect(requestedClaudeAccount("main")).toBe("main");
  });
  it("invokes the box's registry command with the requested account and launch name", () => {
    expect(accountResolveCommand("auto", "agent-one")).toContain(
      "scripts/claude-accounts.ts resolve --account 'auto' --launch-name 'agent-one'",
    );
  });

  it("accepts one complete machine-readable result", () => {
    expect(parseResolvedLaunchAccount(`${JSON.stringify(resolved)}\n`)).toEqual({ kind: "value", account: resolved });
  });

  it.each([
    ["extra output", `${JSON.stringify(resolved)}\nnoise`],
    ["relative state dir", JSON.stringify({ ...resolved, stateDir: "relative" })],
    ["trailing slash", JSON.stringify({ ...resolved, stateDir: "/tmp/pool/" })],
    ["unsafe account name", JSON.stringify({ ...resolved, name: "pool two" })],
    ["missing display email", JSON.stringify({ ...resolved, displayEmail: "" })],
  ])("refuses %s", (_label, raw) => {
    expect(parseResolvedLaunchAccount(raw).kind).toBe("refused");
  });
});

describe("the account-specific Claude job preflight", () => {
  it("does not export the selected config dir", () => {
    const lines = accountJobLines(resolved, { missingConfig: "FAIL_CONFIG", wrongIdentity: "FAIL_IDENTITY" });
    expect(lines).not.toContain("export CLAUDE_CONFIG_DIR");
    expect(lines).toContain("/tmp/claude-pool-two");
    expect(lines).toContain("FAIL_CONFIG");
    expect(lines).toContain("FAIL_IDENTITY");
  });

  it("scopes routing to the Claude process and clears every competing credential", () => {
    const command = accountClaudeCommand(resolved, "claude --session-id abc");
    expect(command).toBe(
      "env -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL " +
        "-u CLAUDE_CODE_OAUTH_TOKEN CLAUDE_CONFIG_DIR='/tmp/claude-pool-two' claude --session-id abc",
    );
  });

  it("does not leave the selected config dir in the shell after Claude exits", () => {
    const root = mkdtempSync(path.join(tmpdir(), "gjd-account-scope-"));
    try {
      const bin = path.join(root, "bin");
      mkdirSync(bin);
      writeFileSync(path.join(bin, "claude"), "#!/bin/sh\nprintf '%s|%s|%s|%s|%s\\n' \"$CLAUDE_CONFIG_DIR\" \"\${ANTHROPIC_AUTH_TOKEN-unset}\" \"\${ANTHROPIC_API_KEY-unset}\" \"\${ANTHROPIC_BASE_URL-unset}\" \"\${CLAUDE_CODE_OAUTH_TOKEN-unset}\"\n");
      chmodSync(path.join(bin, "claude"), 0o755);
      const run = spawnSync("bash", ["-c", `${accountClaudeCommand(resolved, "claude")}\nprintf 'after=%s\\n' \"\${CLAUDE_CONFIG_DIR-unset}\"`], {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          ANTHROPIC_AUTH_TOKEN: "secret-a",
          ANTHROPIC_API_KEY: "secret-b",
          ANTHROPIC_BASE_URL: "https://wrong.invalid",
          CLAUDE_CODE_OAUTH_TOKEN: "secret-c",
        },
      });
      expect(run.status).toBe(0);
      expect(run.stdout).toContain("/tmp/claude-pool-two|unset|unset|unset|unset");
      expect(run.stdout).toContain("after=unset");
      expect(run.stdout).not.toContain("secret-");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("never puts a credential into the generated lines", () => {
    const lines = accountJobLines(resolved, { missingConfig: "FAIL_CONFIG", wrongIdentity: "FAIL_IDENTITY" });
    expect(lines).not.toContain("accessToken");
    expect(lines).not.toContain("refreshToken");
    expect(lines).not.toContain("credential-that-must-never-escape");
  });

  it("adds tmux metadata for a selected account", () => {
    expect(accountTmuxFlag(resolved)).toBe("-e CLAUDE_ACCOUNT='pool-two'");
    expect(accountTmuxPrefix(resolved)).toContain("-e CLAUDE_ACCOUNT='pool-two'");
    expect(accountTmuxPrefix(resolved)).toContain('"name":"pool-two"');
    expect(accountTmuxPrefix(resolved)).not.toContain('"name":"auto"');
  });

  it("records the resolved ambient name, never auto, when no registry exists", () => {
    const ambient = {
      ...resolved,
      name: "ambient",
      stateDir: null,
      providerAccountId: null,
      providerTenantId: null,
      displayEmail: null,
      reason: "no account registry is configured; using the ambient Claude account",
    } as const;
    expect(accountTmuxPrefix(ambient)).toContain('"name":"ambient"');
    expect(accountTmuxPrefix(ambient)).not.toContain("auto");
  });

  it("runs bookkeeping and identity checks in subshells so they cannot change the job cwd", () => {
    expect(accountOutcomeCommand("session-one", "started")).toMatch(/^\(cd .*\)$/);
    expect(accountJobLines(resolved, { missingConfig: "FAIL_CONFIG", wrongIdentity: "FAIL_IDENTITY" }))
      .toMatch(/\n\(cd .*verify .*\) \|\| FAIL_IDENTITY$/);
  });

  it("leaves an unflagged launch completely ambient", () => {
    expect(accountJobLines(undefined, { missingConfig: "FAIL_CONFIG", wrongIdentity: "FAIL_IDENTITY" })).toBe("");
    expect(accountTmuxFlag(undefined)).toBe("");
    expect(accountTmuxPrefix(undefined)).toBe("");
  });

  it.each([
    ["missing config directory", false, false, 23],
    ["wrong provider identity", true, false, 24],
    ["the expected identity", true, true, 0],
  ] as const)("runs the guards without starting Claude: %s", (_label, makeConfig, identityMatches, expectedStatus) => {
    const root = mkdtempSync(path.join(tmpdir(), "gjd-account-job-"));
    try {
      const bin = path.join(root, "bin");
      const configDir = path.join(root, "config");
      mkdirSync(bin);
      if (makeConfig) mkdirSync(configDir);
      const lines = accountJobLines(
        { ...resolved, stateDir: configDir },
        { missingConfig: "exit 23", wrongIdentity: "exit 24" },
        identityMatches ? "true" : "false",
      );
      const run = spawnSync("bash", ["-c", `${lines}\nprintf 'STARTED\\n'`], {
        encoding: "utf8",
        env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
      });
      expect(run.status).toBe(expectedStatus);
      expect(run.stdout.includes("STARTED")).toBe(expectedStatus === 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
