import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  main,
  recordLaunchOutcome,
  resolveForLaunch,
  runAuthStatus,
  seedClaudeConfig,
  type ClaudeAccountsDeps,
} from "../scripts/claude-accounts.js";
import type { AccountEntry, RegistryReading } from "../tools/overseer/accounts.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "claude-accounts-test-"));
  roots.push(root);
  return root;
}

function entry(name: string, role: "pool" | "orchestrator" = "pool"): AccountEntry {
  return {
    name,
    family: "claude",
    role,
    stateDir: `/configs/${name}`,
    providerAccountId: `uuid-${name}`,
    providerTenantId: `org-${name}`,
    displayEmail: `${name}@example.com`,
    addedAt: "2026-09-09T20:00:00.000Z",
    familyData: {},
  };
}

function registry(...accounts: AccountEntry[]): RegistryReading {
  return { kind: "value", schema: 1, accounts };
}

function seedFixture(root: string): { source: string; target: string } {
  const source = path.join(root, "default");
  const target = path.join(root, "pool");
  mkdirSync(path.join(source, "plugins", "example"), { recursive: true });
  mkdirSync(path.join(source, "projects"), { recursive: true });
  mkdirSync(target, { recursive: true });
  writeFileSync(path.join(source, "plugins", "example", "plugin.json"), "{}\n");
  writeFileSync(
    path.join(source, ".claude.json"),
    JSON.stringify({
      mcpServers: {
        playwright: { command: "playwright" },
        "chrome-devtools": { command: "chrome-devtools" },
        sentry: { command: "sentry" },
        vercel: { command: "vercel" },
      },
      projects: {
        "/repo/one": { hasTrustDialogAccepted: true, other: "private" },
        "/repo/two": { hasTrustDialogAccepted: false },
      },
      hasCompletedOnboarding: true,
      numStartups: 42,
      hasSeenUnrelatedExperiment: true,
      cachedUsageUtilization: { utilization: { seven_day: 85 } },
      oauthAccount: { emailAddress: "must-not-copy@example.com" },
    }),
  );
  writeFileSync(
    path.join(source, "settings.json"),
    JSON.stringify({
      model: "opus",
      permissions: { allow: ["Read"], deny: ["Bash"] },
      autoMode: true,
      env: {
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
        ANTHROPIC_AUTH_TOKEN: "must-not-copy",
        SHARED: "must-not-copy-either",
      },
      theme: "dark",
    }),
  );
  return { source, target };
}

describe("Claude config seeding", () => {
  test("is idempotent and reports that its second run changed nothing", () => {
    const { source, target } = seedFixture(tempRoot());
    const first = seedClaudeConfig(target, { defaultConfigDir: source, now: () => new Date("2026-09-09T21:00:00Z") });
    const before = JSON.stringify({
      claude: readFileSync(path.join(target, ".claude.json"), "utf8"),
      settings: readFileSync(path.join(target, "settings.json"), "utf8"),
      files: readdirSync(target).sort(),
    });

    const second = seedClaudeConfig(target, { defaultConfigDir: source, now: () => new Date("2026-09-09T21:01:00Z") });

    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: true, changed: false });
    if (second.ok) expect(second.messages.join("\n")).toMatch(/already|nothing to change/i);
    expect(JSON.stringify({
      claude: readFileSync(path.join(target, ".claude.json"), "utf8"),
      settings: readFileSync(path.join(target, "settings.json"), "utf8"),
      files: readdirSync(target).sort(),
    })).toBe(before);
    expect(lstatSync(path.join(target, "projects")).isSymbolicLink()).toBe(true);
    expect(readFileSync(path.join(target, ".claude.json"), "utf8")).not.toContain("must-not-copy@example.com");
    const seededClaude = JSON.parse(readFileSync(path.join(target, ".claude.json"), "utf8"));
    expect(Object.keys(seededClaude.mcpServers)).toEqual(["playwright", "chrome-devtools"]);
    expect(seededClaude).not.toHaveProperty("numStartups");
    expect(seededClaude).not.toHaveProperty("hasSeenUnrelatedExperiment");
    const seededSettings = JSON.parse(readFileSync(path.join(target, "settings.json"), "utf8"));
    expect(seededSettings.env).toEqual({ CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1" });
    if (first.ok) expect(first.messages.join("\n")).toMatch(/sentry.*vercel.*\/mcp/i);
  });

  test("migrates a real projects directory, retains a backup, and is a no-op on a second run", () => {
    const { source, target } = seedFixture(tempRoot());
    mkdirSync(path.join(target, "projects", "repo-a"), { recursive: true });
    writeFileSync(path.join(target, "projects", "repo-a", "conversation.jsonl"), "transcript\n");

    const first = seedClaudeConfig(target, {
      defaultConfigDir: source,
      now: () => new Date("2026-09-09T21:00:00Z"),
      isConfigDirInUse: () => false,
    });

    expect(first.ok).toBe(true);
    expect(lstatSync(path.join(target, "projects")).isSymbolicLink()).toBe(true);
    expect(readFileSync(path.join(source, "projects", "repo-a", "conversation.jsonl"), "utf8")).toBe("transcript\n");
    const backup = readdirSync(target).find((name) => name.startsWith("projects.retained-"));
    expect(backup).toBeDefined();
    expect(readFileSync(path.join(target, backup!, "repo-a", "conversation.jsonl"), "utf8")).toBe("transcript\n");

    const second = seedClaudeConfig(target, { defaultConfigDir: source, isConfigDirInUse: () => false });
    expect(second).toMatchObject({ ok: true, changed: false });
    if (second.ok) expect(second.messages.join("\n")).toMatch(/already links/i);
  });

  test("refuses a dangling projects symlink", () => {
    const { source, target } = seedFixture(tempRoot());
    symlinkSync(path.join(target, "missing-projects"), path.join(target, "projects"));
    const result = seedClaudeConfig(target, { defaultConfigDir: source });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.why).toMatch(/dangling/i);
  });

  test("refuses to migrate projects while the config directory is in use", () => {
    const { source, target } = seedFixture(tempRoot());
    mkdirSync(path.join(target, "projects"));
    const result = seedClaudeConfig(target, { defaultConfigDir: source, isConfigDirInUse: () => true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.why).toMatch(/in use/i);
  });

  test("preflights a parent-path collision before copying any transcript", () => {
    const { source, target } = seedFixture(tempRoot());
    mkdirSync(path.join(target, "projects", "repo-a"), { recursive: true });
    writeFileSync(path.join(target, "projects", "repo-a", "conversation.jsonl"), "transcript\n");
    writeFileSync(path.join(source, "projects", "repo-a"), "not a directory\n");

    const result = seedClaudeConfig(target, {
      defaultConfigDir: source,
      isConfigDirInUse: () => false,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.why).toMatch(/collision/i);
    expect(lstatSync(path.join(target, "projects")).isDirectory()).toBe(true);
    expect(existsSync(path.join(target, ".projects-migration.json"))).toBe(false);
  });

  test("resumes a projects migration after a partial copy", () => {
    const { source, target } = seedFixture(tempRoot());
    mkdirSync(path.join(target, "projects", "repo-a"), { recursive: true });
    writeFileSync(path.join(target, "projects", "repo-a", "one"), "one");
    writeFileSync(path.join(target, "projects", "repo-a", "two"), "two");
    mkdirSync(path.join(source, "projects", "repo-a"), { recursive: true });
    writeFileSync(path.join(source, "projects", "repo-a", "one"), "one");
    const sha = (value: string) => createHash("sha256").update(value).digest("hex");
    writeFileSync(path.join(target, ".projects-migration.json"), JSON.stringify({
      schema: 1,
      source: path.join(target, "projects"),
      destination: path.join(source, "projects"),
      backup: path.join(target, "projects.retained-fixed"),
      phase: "copying",
      files: [
        { relative: path.join("repo-a", "one"), sha256: sha("one") },
        { relative: path.join("repo-a", "two"), sha256: sha("two") },
      ],
    }));
    const result = seedClaudeConfig(target, { defaultConfigDir: source, isConfigDirInUse: () => false });
    expect(result.ok).toBe(true);
    expect(lstatSync(path.join(target, "projects")).isSymbolicLink()).toBe(true);
    expect(readFileSync(path.join(source, "projects", "repo-a", "two"), "utf8")).toBe("two");
  });

  test("resumes a projects migration after the original was renamed", () => {
    const { source, target } = seedFixture(tempRoot());
    const backup = path.join(target, "projects.retained-fixed");
    mkdirSync(path.join(backup, "repo-a"), { recursive: true });
    writeFileSync(path.join(backup, "repo-a", "one"), "one");
    mkdirSync(path.join(source, "projects", "repo-a"), { recursive: true });
    writeFileSync(path.join(source, "projects", "repo-a", "one"), "one");
    const sha = createHash("sha256").update("one").digest("hex");
    writeFileSync(path.join(target, ".projects-migration.json"), JSON.stringify({
      schema: 1,
      source: path.join(target, "projects"),
      destination: path.join(source, "projects"),
      backup,
      phase: "renamed",
      files: [{ relative: path.join("repo-a", "one"), sha256: sha }],
    }));
    const result = seedClaudeConfig(target, { defaultConfigDir: source, isConfigDirInUse: () => false });
    expect(result.ok).toBe(true);
    expect(realpathSync(path.join(target, "projects"))).toBe(realpathSync(path.join(source, "projects")));
  });

  test("preserves hand-set settings while filling missing nested values", () => {
    const { source, target } = seedFixture(tempRoot());
    writeFileSync(path.join(target, "settings.json"), JSON.stringify({ model: "sonnet", permissions: { allow: ["Mine"] }, env: { SHARED: "mine" } }));

    const result = seedClaudeConfig(target, { defaultConfigDir: source });
    const settings = JSON.parse(readFileSync(path.join(target, "settings.json"), "utf8"));

    expect(result.ok).toBe(true);
    expect(settings).toMatchObject({
      model: "sonnet",
      permissions: { allow: ["Mine"], deny: ["Bash"] },
      autoMode: true,
      env: { SHARED: "mine", CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1" },
    });
    expect(settings).not.toHaveProperty("theme");
  });

  test("backs up an existing target .claude.json before changing it", () => {
    const { source, target } = seedFixture(tempRoot());
    writeFileSync(path.join(target, ".claude.json"), '{"existing":true}\n');

    const result = seedClaudeConfig(target, { defaultConfigDir: source, now: () => new Date("2026-09-09T21:00:00Z") });

    expect(result.ok).toBe(true);
    const backups = readdirSync(path.join(target, "backups"));
    expect(backups).toHaveLength(1);
    expect(readFileSync(path.join(target, "backups", backups[0]!), "utf8")).toBe('{"existing":true}\n');
  });
});

describe("identity assertion and add", () => {
  test("runs auth status with CLAUDE_CONFIG_DIR set", () => {
    const root = tempRoot();
    const bin = path.join(root, "bin");
    mkdirSync(bin);
    writeFileSync(path.join(bin, "claude"), '#!/bin/sh\nprintf \'{"loggedIn":true,"email":"%s"}\\n\' "$CLAUDE_CONFIG_DIR"\n');
    chmodSync(path.join(bin, "claude"), 0o755);

    let invoked: { command: string; args: string[]; configDir: string | undefined } | undefined;
    expect(runAuthStatus("/chosen/config", {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
      // The managed unit runner refuses child processes (EPERM). The fake
      // runner is the same process seam; the real implementation still finds
      // this executable through PATH.
      runner: (command, args, options) => {
        invoked = { command, args, configDir: options.env.CLAUDE_CONFIG_DIR };
        return { status: 0, stdout: '{"loggedIn":true,"email":"/chosen/config"}\n' };
      },
    })).toEqual({
      kind: "value",
      loggedIn: true,
      email: "/chosen/config",
    });
    expect(invoked).toEqual({ command: "claude", args: ["auth", "status", "--json"], configDir: "/chosen/config" });
  });

  test("add refuses a different signed-in email and writes nothing", async () => {
    const root = tempRoot();
    const registryPath = path.join(root, ".claude-accounts", "registry.json");
    let profileCalls = 0;
    const output: string[] = [];
    const code = await main(
      ["add", "--name", "pool1", "--config-dir", path.join(root, "pool1"), "--email", "right@example.com", "--role", "pool"],
      {
        homeDir: root,
        registryPath,
        authStatus: () => ({ kind: "value", loggedIn: true, email: "wrong@example.com" }),
        profile: async () => {
          profileCalls += 1;
          throw new Error("profile must not be read");
        },
        out: (line) => output.push(line),
        err: (line) => output.push(line),
      },
    );

    expect(code).not.toBe(0);
    expect(profileCalls).toBe(0);
    expect(existsSync(registryPath)).toBe(false);
    expect(output.join("\n")).toContain("wrong@example.com");
  });

  test("add writes private modes and updates in place without replacing addedAt", async () => {
    const root = tempRoot();
    const configDir = path.join(root, "pool1");
    mkdirSync(configDir);
    const registryPath = path.join(root, ".claude-accounts", "registry.json");
    const common: Partial<ClaudeAccountsDeps> = {
      homeDir: root,
      registryPath,
      authStatus: () => ({ kind: "value", loggedIn: true, email: "pool@example.com" }),
      profile: async () => ({ kind: "value", accountUuid: "uuid-1", email: "pool@example.com", orgId: "org-1", configDir, takenAt: "2026-09-09T21:00:00.000Z" }),
      out: () => undefined,
      err: () => undefined,
      now: () => new Date("2026-09-09T21:00:00Z"),
    };
    const args = ["add", "--name", "pool1", "--config-dir", configDir, "--email", "pool@example.com", "--role", "pool"];
    expect(await main(args, common)).toBe(0);
    expect((statSync(path.dirname(registryPath)).mode & 0o777)).toBe(0o700);
    expect((statSync(registryPath).mode & 0o777)).toBe(0o600);

    expect(await main(args, { ...common, now: () => new Date("2027-01-01T00:00:00Z") })).toBe(0);
    const saved = JSON.parse(readFileSync(registryPath, "utf8"));
    expect(saved.accounts).toHaveLength(1);
    expect(saved.accounts[0].addedAt).toBe("2026-09-09T21:00:00.000Z");
  });

  test("add refuses a second orchestrator instead of writing a registry its own reader rejects", async () => {
    const root = tempRoot();
    const configDir = path.join(root, "second-orchestrator");
    mkdirSync(configDir);
    const registryPath = path.join(root, ".claude-accounts", "registry.json");
    const original = { schema: 1, accounts: [entry("main", "orchestrator")] };
    mkdirSync(path.dirname(registryPath), { recursive: true });
    writeFileSync(registryPath, `${JSON.stringify(original)}\n`);

    const code = await main(
      [
        "add",
        "--name",
        "other-main",
        "--config-dir",
        configDir,
        "--email",
        "other-main@example.com",
        "--role",
        "orchestrator",
      ],
      {
        homeDir: root,
        registryPath,
        authStatus: () => ({ kind: "value", loggedIn: true, email: "other-main@example.com" }),
        profile: async () => ({
          kind: "value",
          accountUuid: "uuid-other-main",
          email: "other-main@example.com",
          orgId: "org-other-main",
          configDir,
          takenAt: "2026-09-09T21:00:00.000Z",
        }),
        out: () => undefined,
        err: () => undefined,
      },
    );

    expect(code).not.toBe(0);
    expect(JSON.parse(readFileSync(registryPath, "utf8"))).toEqual(original);
  });
});

describe("on-box account resolution", () => {
  function resolutionDeps(root: string, accounts: AccountEntry[], weekly: Record<string, number | undefined>): Partial<ClaudeAccountsDeps> {
    return {
      homeDir: root,
      registryPath: path.join(root, ".claude-accounts", "registry.json"),
      readRegistry: async () => registry(...accounts),
      usage: async (configDir) => {
        const name = path.basename(configDir);
        const percentage = weekly[name];
        return percentage === undefined
          ? { kind: "unknown", configDir, takenAt: "2026-09-09T21:00:00.000Z", why: "401" }
          : {
              kind: "value",
              configDir,
              takenAt: "2026-09-09T21:00:00.000Z",
              identity: {
                providerAccountId: `uuid-${name}`,
                providerTenantId: `org-${name}`,
                displayEmail: `${name}@example.com`,
              },
              windows: { seven_day: { kind: "current", utilizationPercent: percentage, resetsAt: "2026-09-16T00:00:00Z" } },
            };
      },
      now: () => new Date("2026-09-09T21:00:00Z"),
      out: () => undefined,
      err: () => undefined,
    };
  }

  test("never chooses the orchestrator and picks the lowest weekly utilization", async () => {
    const root = tempRoot();
    const result = await resolveForLaunch("auto", "worker-1", resolutionDeps(root, [entry("main", "orchestrator"), entry("pool1"), entry("pool2")], { main: 0, pool1: 40, pool2: 10 }));
    expect(result).toMatchObject({ ok: true, account: { name: "pool2" } });
  });

  test("does not starve an unknown account that has never been reserved", async () => {
    const root = tempRoot();
    const result = await resolveForLaunch("auto", "worker-1", resolutionDeps(root, [entry("pool1"), entry("pool2")], { pool2: 90 }));
    expect(result).toMatchObject({ ok: true, account: { name: "pool1" } });
  });

  test("all unknown falls back to the least-recently-launched pool account", async () => {
    const root = tempRoot();
    const accountRoot = path.join(root, ".claude-accounts");
    mkdirSync(accountRoot, { recursive: true });
    writeFileSync(path.join(accountRoot, "reservations.ndjson"), `${JSON.stringify({
      schema: 1,
      accountName: "pool1",
      providerAccountId: "uuid-pool1",
      sessionUuid: "old-session",
      launchName: "old",
      createdAt: "2026-09-09T20:59:00.000Z",
      outcome: "reserved",
    })}\n`);
    const result = await resolveForLaunch("auto", "worker-1", resolutionDeps(root, [entry("pool1"), entry("pool2")], {}));
    expect(result).toMatchObject({ ok: true, account: { name: "pool2" } });
    if (result.ok) expect(result.reason).toMatch(/unknown.*least recently/i);
  });

  test("auto with no pool accounts resolves to the registered ambient account", async () => {
    const root = tempRoot();
    const result = await resolveForLaunch("auto", "worker-1", resolutionDeps(root, [entry("main", "orchestrator")], { main: 0 }));
    expect(result).toMatchObject({ ok: true, account: { name: "main" }, resolvedName: "main" });
    if (result.ok) expect(result.reason).toMatch(/ambient/i);
  });

  test("auto with no registry resolves to a named ambient account", async () => {
    const root = tempRoot();
    const result = await resolveForLaunch("auto", "session-ambient", {
      ...resolutionDeps(root, [], {}),
      readRegistry: async () => ({ kind: "ambient", accounts: [] }),
    });
    expect(result).toMatchObject({ ok: true, account: null, resolvedName: "ambient" });
    if (result.ok) expect(result.reason).toMatch(/registry.*ambient/i);
  });

  test("records an explicitly named launch for later LRU decisions", async () => {
    const root = tempRoot();
    const deps = resolutionDeps(root, [entry("pool1"), entry("pool2")], {});

    const named = await resolveForLaunch("pool1", "manual-worker", deps);
    const automatic = await resolveForLaunch("auto", "automatic-worker", deps);

    expect(named).toMatchObject({ ok: true, account: { name: "pool1" } });
    expect(automatic).toMatchObject({ ok: true, account: { name: "pool2" } });
    const records = readFileSync(path.join(root, ".claude-accounts", "reservations.ndjson"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records[0]).toMatchObject({
      accountName: "pool1",
      providerAccountId: "uuid-pool1",
      sessionUuid: "manual-worker",
      outcome: "reserved",
    });
  });

  test("concurrent resolutions reserve different accounts when possible", async () => {
    const root = tempRoot();
    const deps = resolutionDeps(root, [entry("pool1"), entry("pool2")], { pool1: 10, pool2: 10 });
    const [a, b] = await Promise.all([
      resolveForLaunch("auto", "worker-a", deps),
      resolveForLaunch("auto", "worker-b", deps),
    ]);
    expect(a.ok && b.ok).toBe(true);
    // Both must resolve to a *named* pool account, not the ambient one: two
    // concurrent `auto` launches picking the same account is the whole failure
    // this reservation exists to prevent, and an ambient resolution would pass
    // a bare `.size === 2` check while proving nothing.
    if (a.ok && b.ok && a.account && b.account) {
      expect(new Set([a.account.name, b.account.name]).size).toBe(2);
    } else {
      throw new Error("both concurrent launches should resolve to named pool accounts");
    }
  });

  test("a failed launch appends a failure outcome instead of erasing its reservation", async () => {
    const root = tempRoot();
    const deps = resolutionDeps(root, [entry("pool1")], { pool1: 10 });
    await resolveForLaunch("auto", "session-failed", deps, "worker-failed");
    expect(recordLaunchOutcome(path.join(root, ".claude-accounts"), "session-failed", "failed", new Date("2026-09-09T21:00:01Z"))).toBe(true);
    const records = readFileSync(path.join(root, ".claude-accounts", "reservations.ndjson"), "utf8")
      .trim().split("\n").map((line) => JSON.parse(line));
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ sessionUuid: "session-failed", outcome: "reserved" });
    expect(records[1]).toMatchObject({
      sessionUuid: "session-failed",
      providerAccountId: "uuid-pool1",
      outcome: "failed",
    });
  });
});
