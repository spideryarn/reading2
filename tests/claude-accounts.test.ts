import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
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

function snapshotTree(root: string): unknown[] {
  const snapshot: unknown[] = [];
  const visit = (current: string, relative: string): void => {
    const info = lstatSync(current);
    const common = { path: relative || ".", mode: info.mode & 0o777, mtimeMs: info.mtimeMs };
    if (info.isSymbolicLink()) {
      snapshot.push({ ...common, kind: "symlink", target: readlinkSync(current) });
      return;
    }
    if (info.isDirectory()) {
      snapshot.push({ ...common, kind: "directory" });
      for (const name of readdirSync(current).sort()) visit(path.join(current, name), path.join(relative, name));
      return;
    }
    snapshot.push({
      ...common,
      kind: "file",
      sha256: createHash("sha256").update(readFileSync(current)).digest("hex"),
    });
  };
  visit(root, "");
  return snapshot;
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

function wizardSeedFixture(root: string): void {
  const { source } = seedFixture(root);
  symlinkSync(source, path.join(root, ".claude"));
  copyFileSync(path.join(source, ".claude.json"), path.join(root, ".claude.json"));
}

function matchingProfile(configDir: string, email = "pool@example.com") {
  return {
    kind: "value" as const,
    accountUuid: "uuid-pool",
    email,
    orgId: "org-pool",
    configDir,
    takenAt: "2026-09-09T21:00:00.000Z",
  };
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

  // Red before the fix on 2026-09-10. `~/.claude/sessions/<pid>.json` is BOTH
  // the `claude agents --json` listing and the SendMessage/ListAgents peer
  // registry — measured: a config dir whose sessions/ was symlinked to the
  // default's listed all ten ambient agents by name, while mindstone's own dir
  // listed two. Unshared, every pool session classified as
  // `running-but-unlisted` AND could not message the Overseer at all.
  //
  // Sharing is safe here for the reason it is NOT safe for memory: the files
  // are pid-keyed and pids are unique on a box, so each has exactly one writer.
  test("shares sessions/, copying existing records so a live session is not lost", () => {
    const { source, target } = seedFixture(tempRoot());
    mkdirSync(path.join(source, "sessions"), { recursive: true });
    writeFileSync(path.join(source, "sessions", "111.json"), '{"pid":111}\n');
    // A record a live pool session has already written under its own dir. It
    // must survive: dropping it would make a working session VANISH from `ls`
    // rather than appear, which is worse than the bug being fixed.
    mkdirSync(path.join(target, "sessions"), { recursive: true });
    writeFileSync(path.join(target, "sessions", "222.json"), '{"pid":222}\n');

    const first = seedClaudeConfig(target, {
      defaultConfigDir: source,
      now: () => new Date("2026-09-09T21:00:00Z"),
      isConfigDirInUse: () => false,
    });

    expect(first.ok).toBe(true);
    expect(lstatSync(path.join(target, "sessions")).isSymbolicLink()).toBe(true);
    // Both records are now visible through the one shared directory.
    expect(readFileSync(path.join(source, "sessions", "222.json"), "utf8")).toBe('{"pid":222}\n');
    expect(readFileSync(path.join(target, "sessions", "111.json"), "utf8")).toBe('{"pid":111}\n');
    const retained = readdirSync(target).find((name) => name.startsWith("sessions.retained-"));
    expect(retained).toBeDefined();
    expect(readFileSync(path.join(target, retained!, "222.json"), "utf8")).toBe('{"pid":222}\n');

    const second = seedClaudeConfig(target, { defaultConfigDir: source, isConfigDirInUse: () => false });
    expect(second).toMatchObject({ ok: true, changed: false });
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
  // Reproduced red on 2026-09-10 before the fix: `--help` answered
  // "FATAL: unknown command --help", and `add --help` answered
  // "FATAL: --help needs a value" — which is worse, because it reads as though
  // --help were a real flag whose argument you forgot, so the obvious next move
  // is to invent one. These are the exact strings Greg types.
  test.each([["--help"], ["-h"], ["help"], ["add", "--help"]])(
    "prints usage for %s instead of a FATAL",
    async (...argv) => {
      const output: string[] = [];
      const code = await main(argv, {
        out: (line) => output.push(line),
        err: (line) => output.push(`ERR:${line}`),
      });
      expect(code).toBe(0);
      const text = output.join("\n");
      expect(text).not.toMatch(/FATAL/);
      // Every question the wizard asks must be discoverable as a flag: a flag
      // nobody can find is a code path nobody can automate, and the web flow
      // depends on driving this same command non-interactively.
      for (const flag of ["--name", "--email", "--role", "--config-dir", "--yes"]) {
        expect(text).toContain(flag);
      }
    },
  );


  test("a second --yes run asks nothing, writes nothing, and reports every no-op", async () => {
    const root = tempRoot();
    wizardSeedFixture(root);
    const configDir = path.join(root, ".claude-pool1");
    const registryPath = path.join(root, ".claude-accounts", "registry.json");
    const output: string[] = [];
    let promptCalls = 0;
    let loginCalls = 0;
    const common = {
      homeDir: root,
      registryPath,
      stdinIsTTY: true,
      prompt: async () => {
        promptCalls += 1;
        return "must not be asked";
      },
      login: () => {
        loginCalls += 1;
        return { ok: true as const };
      },
      authStatus: () => ({ kind: "value" as const, loggedIn: true, email: null, authMethod: "claude.ai", apiProvider: "firstParty" }),
      profile: async () => matchingProfile(configDir),
      usage: async () => ({ kind: "unknown", why: "not needed" }),
      out: (line: string) => output.push(line),
      err: (line: string) => output.push(line),
      now: () => new Date("2026-09-09T21:00:00Z"),
    };

    expect(await main(["add", "--yes", "--email", "pool@example.com"], common)).toBe(0);
    const fixed = new Date("2020-01-01T00:00:00Z");
    const watched = [
      registryPath,
      path.join(configDir, "settings.json"),
      path.join(configDir, ".claude.json"),
      configDir,
      path.dirname(registryPath),
    ];
    for (const file of watched) utimesSync(file, fixed, fixed);
    const registryBefore = readFileSync(registryPath);
    const mtimesBefore = watched.map((file) => statSync(file).mtimeMs);
    const treeBefore = snapshotTree(root);
    output.length = 0;

    expect(await main(["add", "--name", "pool1", "--yes"], common)).toBe(0);

    expect(promptCalls).toBe(0);
    expect(loginCalls).toBe(0);
    expect(readFileSync(registryPath).equals(registryBefore)).toBe(true);
    expect(watched.map((file) => statSync(file).mtimeMs)).toEqual(mtimesBefore);
    expect(snapshotTree(root)).toEqual(treeBefore);
    expect(output.join("\n")).toMatch(/found: config directory.*\.claude-pool1/i);
    expect(output.join("\n")).toMatch(/found: settings.*forceLoginMethod=claudeai/i);
    expect(output.join("\n")).toMatch(/skipped: login.*profile already matches pool@example\.com/i);
    expect(output.join("\n")).toMatch(/found: seed nothing to change/i);
    expect(output.join("\n")).toMatch(/found: registry entry pool1 .*registry\.json.*already matches; nothing to change/i);
    expect(output.join("\n")).toMatch(/pool1 family=claude role=pool/i);
  });

  test("wizard refuses a sessions symlink that does not point at the shared registry", async () => {
    const root = tempRoot();
    wizardSeedFixture(root);
    const configDir = path.join(root, ".claude-pool1");
    const wrongSessions = path.join(root, "wrong-sessions");
    mkdirSync(configDir);
    mkdirSync(wrongSessions);
    symlinkSync(wrongSessions, path.join(configDir, "sessions"));
    const registryPath = path.join(root, ".claude-accounts", "registry.json");
    const output: string[] = [];

    const code = await main(["add", "--yes", "--email", "pool@example.com"], {
      homeDir: root,
      registryPath,
      authStatus: () => ({ kind: "value", loggedIn: true, email: null, authMethod: "claude.ai", apiProvider: "firstParty" }),
      profile: async () => matchingProfile(configDir),
      out: (line) => output.push(line),
      err: (line) => output.push(line),
    });

    expect(code).not.toBe(0);
    expect(existsSync(registryPath)).toBe(false);
    expect(output.join("\n")).toMatch(new RegExp(`refused:.*sessions.*${wrongSessions}.*${path.join(root, ".claude", "sessions")}`, "i"));
  });

  test("login is skipped when the live profile matches even if auth status has no email", async () => {
    const root = tempRoot();
    const configDir = path.join(root, "pool");
    mkdirSync(configDir);
    writeFileSync(path.join(configDir, ".credentials.json"), "{}\n");
    writeFileSync(path.join(configDir, "settings.json"), '{"theme":"dark"}\n');
    const output: string[] = [];
    const code = await main(
      ["add", "--name", "pool", "--config-dir", configDir, "--email", "pool@example.com", "--role", "pool"],
      {
        homeDir: root,
        registryPath: path.join(root, ".claude-accounts", "registry.json"),
        authStatus: () => ({ kind: "value", loggedIn: true, email: null, authMethod: "claude.ai", apiProvider: "firstParty" }),
        profile: async () => matchingProfile(configDir),
        usage: async () => ({ kind: "unknown", why: "not needed" }),
        out: (line) => output.push(line),
        err: (line) => output.push(line),
      },
    );

    expect(code).toBe(0);
    expect(output.join("\n")).toMatch(/skipped: login.*profile already matches pool@example\.com/i);
    expect(JSON.parse(readFileSync(path.join(configDir, "settings.json"), "utf8"))).toEqual({
      theme: "dark",
      forceLoginMethod: "claudeai",
    });
  });

  test("login is refused when the live profile belongs to a different email", async () => {
    const root = tempRoot();
    const configDir = path.join(root, "pool");
    mkdirSync(configDir);
    writeFileSync(path.join(configDir, ".credentials.json"), "{}\n");
    const output: string[] = [];
    const code = await main(
      ["add", "--name", "pool", "--config-dir", configDir, "--email", "right@example.com", "--role", "pool"],
      {
        homeDir: root,
        registryPath: path.join(root, ".claude-accounts", "registry.json"),
        authStatus: () => ({ kind: "value", loggedIn: true, email: "right@example.com", authMethod: "claude.ai", apiProvider: "firstParty" }),
        profile: async () => matchingProfile(configDir, "wrong@example.com"),
        out: (line) => output.push(line),
        err: (line) => output.push(line),
      },
    );

    expect(code).not.toBe(0);
    expect(output.join("\n")).toMatch(/refused: login.*wrong@example\.com.*right@example\.com/i);
    expect(existsSync(path.join(root, ".claude-accounts", "registry.json"))).toBe(false);
  });

  test("login is refused rather than replacing a credential whose identity is unavailable", async () => {
    const root = tempRoot();
    const configDir = path.join(root, "pool");
    mkdirSync(configDir);
    writeFileSync(path.join(configDir, ".credentials.json"), "{}\n");
    const output: string[] = [];
    const code = await main(
      ["add", "--name", "pool", "--config-dir", configDir, "--email", "pool@example.com", "--role", "pool"],
      {
        homeDir: root,
        registryPath: path.join(root, ".claude-accounts", "registry.json"),
        authStatus: () => ({ kind: "value", loggedIn: true, email: null, authMethod: "claude.ai", apiProvider: "firstParty" }),
        profile: async () => ({ kind: "unknown", why: "profile request failed with HTTP 401", status: 401 }),
        out: (line) => output.push(line),
        err: (line) => output.push(line),
      },
    );

    expect(code).not.toBe(0);
    expect(output.join("\n")).toMatch(/refused: login.*credential.*identity.*401/i);
    expect(output.join("\n")).toMatch(/CLAUDE_CONFIG_DIR=.*claude auth logout.*rerun/i);
    expect(existsSync(path.join(root, ".claude-accounts", "registry.json"))).toBe(false);
  });

  test("login is offered when logged out and the config directory has no credential", async () => {
    const root = tempRoot();
    const configDir = path.join(root, "pool");
    const bin = path.join(root, "bin");
    const record = path.join(root, "fake-claude-argv");
    mkdirSync(bin);
    writeFileSync(
      path.join(bin, "claude"),
      "#!/bin/sh\nprintf '%s\\n' \"$CLAUDE_CONFIG_DIR\" > \"$FAKE_CLAUDE_RECORD\"\nprintf '%s\\n' \"$@\" >> \"$FAKE_CLAUDE_RECORD\"\n",
    );
    chmodSync(path.join(bin, "claude"), 0o755);
    const oldPath = process.env.PATH;
    const oldRecord = process.env.FAKE_CLAUDE_RECORD;
    process.env.PATH = `${bin}:${oldPath ?? ""}`;
    process.env.FAKE_CLAUDE_RECORD = record;
    const output: string[] = [];
    let profileCalls = 0;
    let authCalls = 0;
    try {
      const code = await main(
        ["add", "--name", "pool", "--config-dir", configDir, "--email", "pool@example.com", "--role", "pool"],
        {
          homeDir: root,
          registryPath: path.join(root, ".claude-accounts", "registry.json"),
          stdinIsTTY: true,
          authStatus: () => authCalls++ === 0
            ? { kind: "value", loggedIn: false, email: null, authMethod: "none", apiProvider: null }
            : { kind: "value", loggedIn: true, email: null, authMethod: "claude.ai", apiProvider: "firstParty" },
          profile: async () => profileCalls++ === 0
            ? { kind: "unknown", why: "credential file does not exist" }
            : matchingProfile(configDir),
          usage: async () => ({ kind: "unknown", why: "not needed" }),
          out: (line) => output.push(line),
          err: (line) => output.push(line),
        },
      );
      expect(code).toBe(0);
    } finally {
      if (oldPath === undefined) delete process.env.PATH;
      else process.env.PATH = oldPath;
      if (oldRecord === undefined) delete process.env.FAKE_CLAUDE_RECORD;
      else process.env.FAKE_CLAUDE_RECORD = oldRecord;
    }

    expect(readFileSync(record, "utf8").split("\n")).toEqual([
      configDir,
      "auth",
      "login",
      "--claudeai",
      "--email",
      "pool@example.com",
      "",
    ]);
    expect(output.join("\n")).toMatch(/found: logged out.*no credential/i);
    expect(output.join("\n")).toMatch(/changed: login.*pool@example\.com/i);
  });

  test("interactive answers are asked in order and blank answers accept defaults", async () => {
    const root = tempRoot();
    wizardSeedFixture(root);
    const configDir = path.join(root, ".claude-named-by-answer");
    const questions: Array<[string, string]> = [];
    const answers = ["named-by-answer", "answer@example.com", "", ""];
    const code = await main(["add"], {
      homeDir: root,
      registryPath: path.join(root, ".claude-accounts", "registry.json"),
      prompt: async (question, defaultValue) => {
        questions.push([question, defaultValue]);
        return answers.shift() ?? "";
      },
      authStatus: () => ({ kind: "value", loggedIn: true, email: null, authMethod: "claude.ai", apiProvider: "firstParty" }),
      profile: async () => matchingProfile(configDir, "answer@example.com"),
      usage: async () => ({ kind: "unknown", why: "not needed" }),
      out: () => undefined,
      err: () => undefined,
    });

    expect(code).toBe(0);
    expect(questions.map(([question]) => question)).toEqual(["Account name", "Email", "Role", "Config directory"]);
    expect(questions[0]?.[1]).toBe("pool1");
    expect(questions[1]?.[1]).toBe("");
    expect(questions[2]?.[1]).toBe("pool");
    expect(questions[3]?.[1]).toBe(configDir);
    const saved = JSON.parse(readFileSync(path.join(root, ".claude-accounts", "registry.json"), "utf8"));
    expect(saved.accounts[0]).toMatchObject({
      name: "named-by-answer",
      displayEmail: "answer@example.com",
      role: "pool",
      stateDir: configDir,
    });
    expect(JSON.parse(readFileSync(path.join(configDir, "settings.json"), "utf8"))).toMatchObject({
      forceLoginMethod: "claudeai",
    });
    expect(statSync(configDir).mode & 0o777).toBe(0o700);
    expect(statSync(path.join(configDir, "settings.json")).mode & 0o777).toBe(0o600);
  });

  test("--yes accepts defaults without prompting, while supplied flags override them", async () => {
    const root = tempRoot();
    wizardSeedFixture(root);
    const configDir = path.join(root, "explicit-config");
    mkdirSync(configDir);
    let promptCalls = 0;
    const code = await main(["add", "--yes", "--email", "flag@example.com", "--config-dir", configDir], {
      homeDir: root,
      registryPath: path.join(root, ".claude-accounts", "registry.json"),
      prompt: async () => {
        promptCalls += 1;
        return "wrong";
      },
      authStatus: () => ({ kind: "value", loggedIn: true, email: null, authMethod: "claude.ai", apiProvider: "firstParty" }),
      profile: async () => matchingProfile(configDir, "flag@example.com"),
      usage: async () => ({ kind: "unknown", why: "not needed" }),
      out: () => undefined,
      err: () => undefined,
    });

    expect(code).toBe(0);
    expect(promptCalls).toBe(0);
    const saved = JSON.parse(readFileSync(path.join(root, ".claude-accounts", "registry.json"), "utf8"));
    expect(saved.accounts[0]).toMatchObject({ name: "pool1", role: "pool", displayEmail: "flag@example.com", stateDir: configDir });
  });

  test("does not prompt when stdin is not a TTY", async () => {
    const root = tempRoot();
    let promptCalls = 0;
    const output: string[] = [];
    const code = await main(["add"], {
      homeDir: root,
      registryPath: path.join(root, ".claude-accounts", "registry.json"),
      stdinIsTTY: false,
      prompt: async () => {
        promptCalls += 1;
        return "unexpected";
      },
      out: (line) => output.push(line),
      err: (line) => output.push(line),
    });

    expect(code).not.toBe(0);
    expect(promptCalls).toBe(0);
    expect(output.join("\n")).toMatch(/--email.*no default|supply --email/i);
  });

  test("a shell metacharacter in an email remains one literal login argument", async () => {
    const root = tempRoot();
    const configDir = path.join(root, "pool");
    const bin = path.join(root, "bin");
    const record = path.join(root, "fake-claude-argv");
    const injected = path.join(root, "injected");
    const email = `pool@example.com;touch ${injected}`;
    mkdirSync(bin);
    writeFileSync(path.join(bin, "claude"), "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$FAKE_CLAUDE_RECORD\"\n");
    chmodSync(path.join(bin, "claude"), 0o755);
    const oldPath = process.env.PATH;
    const oldRecord = process.env.FAKE_CLAUDE_RECORD;
    process.env.PATH = `${bin}:${oldPath ?? ""}`;
    process.env.FAKE_CLAUDE_RECORD = record;
    let profileCalls = 0;
    let authCalls = 0;
    try {
      expect(await main(
        ["add", "--name", "pool", "--config-dir", configDir, "--email", email, "--role", "pool"],
        {
          homeDir: root,
          registryPath: path.join(root, ".claude-accounts", "registry.json"),
          stdinIsTTY: true,
          authStatus: () => authCalls++ === 0
            ? { kind: "value", loggedIn: false, email: null, authMethod: "none", apiProvider: null }
            : { kind: "value", loggedIn: true, email: null, authMethod: "claude.ai", apiProvider: "firstParty" },
          profile: async () => profileCalls++ === 0
            ? { kind: "unknown", why: "credential file does not exist" }
            : matchingProfile(configDir, email),
          usage: async () => ({ kind: "unknown", why: "not needed" }),
          out: () => undefined,
          err: () => undefined,
        },
      )).toBe(0);
    } finally {
      if (oldPath === undefined) delete process.env.PATH;
      else process.env.PATH = oldPath;
      if (oldRecord === undefined) delete process.env.FAKE_CLAUDE_RECORD;
      else process.env.FAKE_CLAUDE_RECORD = oldRecord;
    }

    expect(existsSync(injected)).toBe(false);
    expect(readFileSync(record, "utf8").split("\n")).toEqual(["auth", "login", "--claudeai", "--email", email, ""]);
  });

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
      authMethod: null,
      apiProvider: null,
    });
    expect(invoked).toEqual({ command: "claude", args: ["auth", "status", "--json"], configDir: "/chosen/config" });
  });

  test("add trusts the matching live profile rather than a stale auth-status email", async () => {
    const root = tempRoot();
    const configDir = path.join(root, "pool1");
    mkdirSync(configDir);
    const registryPath = path.join(root, ".claude-accounts", "registry.json");
    let profileCalls = 0;
    const output: string[] = [];
    const code = await main(
      ["add", "--name", "pool1", "--config-dir", configDir, "--email", "right@example.com", "--role", "pool"],
      {
        homeDir: root,
        registryPath,
        authStatus: () => ({ kind: "value", loggedIn: true, email: "wrong@example.com", authMethod: "claude.ai", apiProvider: "firstParty" }),
        profile: async () => {
          profileCalls += 1;
          return matchingProfile(configDir, "right@example.com");
        },
        usage: async () => ({ kind: "unknown", why: "not needed" }),
        out: (line) => output.push(line),
        err: (line) => output.push(line),
      },
    );

    expect(code).toBe(0);
    expect(profileCalls).toBeGreaterThan(0);
    expect(existsSync(registryPath)).toBe(true);
    expect(output.join("\n")).toMatch(/skipped: login.*profile already matches right@example\.com/i);
  });

  test("add writes private modes and updates in place without replacing addedAt", async () => {
    const root = tempRoot();
    const configDir = path.join(root, "pool1");
    mkdirSync(configDir);
    const registryPath = path.join(root, ".claude-accounts", "registry.json");
    const common: Partial<ClaudeAccountsDeps> = {
      homeDir: root,
      registryPath,
      authStatus: () => ({ kind: "value", loggedIn: true, email: "pool@example.com", authMethod: "claude.ai", apiProvider: "firstParty" }),
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

  test("add refuses a symlink alias to the ambient default directory", async () => {
    const root = tempRoot();
    const defaultDir = path.join(root, ".claude");
    const configDir = path.join(root, ".claude-pool-alias");
    mkdirSync(defaultDir);
    symlinkSync(defaultDir, configDir);
    const registryPath = path.join(root, ".claude-accounts", "registry.json");
    const output: string[] = [];

    const code = await main(
      ["add", "--name", "pool1", "--config-dir", configDir, "--email", "ambient@example.com", "--role", "pool"],
      {
        homeDir: root,
        registryPath,
        authStatus: () => ({
          kind: "value",
          loggedIn: true,
          email: "ambient@example.com",
          authMethod: "claude.ai",
          apiProvider: "firstParty",
        }),
        profile: async () => ({
          kind: "value",
          accountUuid: "ambient-account",
          email: "ambient@example.com",
          orgId: "ambient-org",
          configDir,
          takenAt: "2026-09-09T21:00:00.000Z",
        }),
        out: (line) => output.push(line),
        err: (line) => output.push(line),
      },
    );

    expect(code).not.toBe(0);
    expect(output.join("\n")).toMatch(/default.*cannot be registered|ambient.*cannot be registered/i);
    expect(existsSync(registryPath)).toBe(false);
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
        authStatus: () => ({ kind: "value", loggedIn: true, email: "other-main@example.com", authMethod: "claude.ai", apiProvider: "firstParty" }),
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

  test("add performs every registry refusal before seeding the real config directory", async () => {
    const root = tempRoot();
    const { source, target } = seedFixture(root);
    symlinkSync(source, path.join(root, ".claude"));
    const registryPath = path.join(root, ".claude-accounts", "registry.json");
    mkdirSync(path.dirname(registryPath), { recursive: true });
    writeFileSync(registryPath, `${JSON.stringify({ schema: 1, accounts: [entry("pool1")] })}\n`);

    const code = await main(
      ["add", "--name", "pool1", "--config-dir", target, "--email", "pool1@example.com", "--role", "pool", "--seed"],
      {
        homeDir: root,
        registryPath,
        authStatus: () => ({ kind: "value", loggedIn: true, email: "pool1@example.com", authMethod: "claude.ai", apiProvider: "firstParty" }),
        profile: async () => ({
          kind: "value",
          accountUuid: "a-different-provider-account",
          email: "pool1@example.com",
          orgId: "org-pool1",
          configDir: target,
          takenAt: "2026-09-09T21:00:00.000Z",
        }),
        out: () => undefined,
        err: () => undefined,
      },
    );

    expect(code).not.toBe(0);
    expect(existsSync(path.join(target, "projects"))).toBe(false);
    expect(existsSync(path.join(target, ".claude.json"))).toBe(false);
  });

  test("launch verification refuses when Claude's effective auth is not logged in", async () => {
    const root = tempRoot();
    const configDir = path.join(root, "pool1");
    const sharedProjects = path.join(root, ".claude", "projects");
    mkdirSync(configDir, { recursive: true });
    mkdirSync(sharedProjects, { recursive: true });
    symlinkSync(sharedProjects, path.join(configDir, "projects"));
    const output: string[] = [];
    const code = await main(["verify", "--account", "pool1"], {
      homeDir: root,
      registryPath: path.join(root, ".claude-accounts", "registry.json"),
      readRegistry: async () => registry({ ...entry("pool1"), stateDir: configDir }),
      authStatus: () => ({ kind: "value", loggedIn: false, email: null, authMethod: null, apiProvider: null }),
      profile: async () => ({
        kind: "value",
        accountUuid: "uuid-pool1",
        email: "pool1@example.com",
        orgId: "org-pool1",
        configDir,
        takenAt: "2026-09-09T21:00:00.000Z",
      }),
      out: (line) => output.push(line),
      err: (line) => output.push(line),
    });

    expect(code).not.toBe(0);
    expect(output.join("\n")).toMatch(/auth status|effective auth/i);
  });

  test("launch verification records the expired-token exception instead of starving an idle account", async () => {
    const root = tempRoot();
    const configDir = path.join(root, "pool1");
    const sharedProjects = path.join(root, ".claude", "projects");
    mkdirSync(configDir, { recursive: true });
    mkdirSync(sharedProjects, { recursive: true });
    symlinkSync(sharedProjects, path.join(configDir, "projects"));
    const output: string[] = [];
    const code = await main(["verify", "--account", "pool1"], {
      homeDir: root,
      registryPath: path.join(root, ".claude-accounts", "registry.json"),
      readRegistry: async () => registry({ ...entry("pool1"), stateDir: configDir }),
      authStatus: () => ({
        kind: "value",
        loggedIn: true,
        email: "pool1@example.com",
        authMethod: "claude.ai",
        apiProvider: "firstParty",
      }),
      profile: async () => ({
        kind: "unknown",
        why: "profile request failed with HTTP 401",
        status: 401,
        configDir,
        takenAt: "2026-09-09T21:00:00.000Z",
      }),
      out: (line) => output.push(line),
      err: (line) => output.push(line),
    });

    expect(code).toBe(0);
    expect(output.join("\n")).toMatch(/warning.*expired.*refresh/i);
  });

  test("launch verification probes effective auth from Claude's eventual working directory", async () => {
    const root = tempRoot();
    const configDir = path.join(root, "pool1");
    const cwd = path.join(root, "worktree");
    const sharedProjects = path.join(root, ".claude", "projects");
    mkdirSync(configDir, { recursive: true });
    mkdirSync(cwd, { recursive: true });
    mkdirSync(sharedProjects, { recursive: true });
    symlinkSync(sharedProjects, path.join(configDir, "projects"));
    let probedCwd: string | undefined;
    const code = await main(["verify", "--account", "pool1", "--cwd", cwd], {
      homeDir: root,
      registryPath: path.join(root, ".claude-accounts", "registry.json"),
      readRegistry: async () => registry({ ...entry("pool1"), stateDir: configDir }),
      authStatus: (_stateDir, requestedCwd) => {
        probedCwd = requestedCwd;
        return {
          kind: "value",
          loggedIn: true,
          email: "pool1@example.com",
          authMethod: "claude.ai",
          apiProvider: "firstParty",
        };
      },
      profile: async () => ({
        kind: "value",
        accountUuid: "uuid-pool1",
        email: "pool1@example.com",
        orgId: "org-pool1",
        configDir,
        takenAt: "2026-09-09T21:00:00.000Z",
      }),
      out: () => undefined,
      err: () => undefined,
    });

    expect(code).toBe(0);
    expect(probedCwd).toBe(cwd);
  });

  test("list refuses a live profile mismatch without labelling that account with usage", async () => {
    const output: string[] = [];
    let usageCalls = 0;
    const code = await main(["list"], {
      readRegistry: async () => registry(entry("pool1")),
      authStatus: () => ({
        kind: "value",
        loggedIn: true,
        email: "pool1@example.com",
        authMethod: "claude.ai",
        apiProvider: "firstParty",
      }),
      profile: async (configDir) => ({
        kind: "value",
        accountUuid: "somebody-else",
        email: "pool1@example.com",
        orgId: "org-pool1",
        configDir,
        takenAt: "2026-09-10T00:00:00.000Z",
      }),
      usage: async () => {
        usageCalls += 1;
        return { kind: "value" };
      },
      out: (line) => output.push(line),
      err: (line) => output.push(line),
    });

    expect(code).not.toBe(0);
    expect(usageCalls).toBe(0);
    expect(output.join("\n")).toMatch(/FAILED.*profile|FAILED.*registry pin/i);
  });

  test("check --live-usage detects an endpoint failure instead of only checking local login state", async () => {
    const output: string[] = [];
    let usageCalls = 0;
    const account = entry("pool1");
    const code = await main(["check", "--live-usage"], {
      readRegistry: async () => registry(account),
      authStatus: () => ({
        kind: "value",
        loggedIn: true,
        email: account.displayEmail!,
        authMethod: "claude.ai",
        apiProvider: "firstParty",
      }),
      profile: async () => ({
        kind: "value",
        accountUuid: account.providerAccountId,
        email: account.displayEmail!,
        orgId: account.providerTenantId,
        configDir: account.stateDir,
        takenAt: "2026-09-10T00:00:00.000Z",
      }),
      usage: async () => {
        usageCalls += 1;
        return { kind: "unknown", why: "usage response was malformed" };
      },
      out: (line) => output.push(line),
      err: (line) => output.push(line),
    });

    expect(usageCalls).toBe(1);
    expect(code).not.toBe(0);
    expect(output.join("\n")).toMatch(/live usage.*FAILED|FAILED.*usage response was malformed/i);
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

  test("does not choose an account whose five-hour window is known exhausted", async () => {
    const root = tempRoot();
    const deps = resolutionDeps(root, [entry("pool1"), entry("pool2")], {});
    deps.usage = async (configDir) => {
      const name = path.basename(configDir);
      return {
        kind: "value",
        configDir,
        takenAt: "2026-09-09T21:00:00.000Z",
        identity: {
          providerAccountId: `uuid-${name}`,
          providerTenantId: `org-${name}`,
          displayEmail: `${name}@example.com`,
        },
        windows: [
          { kind: "value", window: "five_hour", utilizationPercent: name === "pool1" ? 100 : 20 },
          { kind: "value", window: "seven_day", utilizationPercent: name === "pool1" ? 1 : 10 },
        ],
      };
    };

    const result = await resolveForLaunch("auto", "worker-1", deps);
    expect(result).toMatchObject({ ok: true, account: { name: "pool2" } });
  });

  test("configured but known-exhausted pool accounts refuse instead of falling back to ambient", async () => {
    const root = tempRoot();
    const deps = resolutionDeps(root, [entry("pool1")], {});
    deps.usage = async (configDir) => ({
      kind: "value",
      configDir,
      takenAt: "2026-09-09T21:00:00.000Z",
      identity: {
        providerAccountId: "uuid-pool1",
        providerTenantId: "org-pool1",
        displayEmail: "pool1@example.com",
      },
      windows: [{ kind: "value", window: "five_hour", utilizationPercent: 100 }],
    });

    const result = await resolveForLaunch("auto", "worker-1", deps);
    expect(result).toMatchObject({ ok: false, why: expect.stringMatching(/five-hour|exhausted|eligible/i) });
    expect(existsSync(path.join(root, ".claude-accounts", "reservations.ndjson"))).toBe(false);
  });

  test("sorts an unknown reading after a known reading when reservation recency is equal", async () => {
    const root = tempRoot();
    const result = await resolveForLaunch("auto", "worker-1", resolutionDeps(root, [entry("pool1"), entry("pool2")], { pool2: 90 }));
    expect(result).toMatchObject({ ok: true, account: { name: "pool2" } });
  });

  test("does not starve an unknown account after the known account is reserved", async () => {
    const root = tempRoot();
    const deps = resolutionDeps(root, [entry("pool1"), entry("pool2")], { pool2: 90 });
    expect(await resolveForLaunch("auto", "worker-1", deps)).toMatchObject({
      ok: true,
      account: { name: "pool2" },
    });
    expect(await resolveForLaunch("auto", "worker-2", deps)).toMatchObject({
      ok: true,
      account: { name: "pool1" },
    });
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

  test("auto with no pool accounts leaves CLAUDE_CONFIG_DIR ambient even if an orchestrator entry exists", async () => {
    const root = tempRoot();
    const result = await resolveForLaunch("auto", "worker-1", resolutionDeps(root, [entry("main", "orchestrator")], { main: 0 }));
    expect(result).toMatchObject({ ok: true, account: null, resolvedName: "ambient" });
    if (result.ok) expect(result.reason).toMatch(/ambient/i);
  });

  test("an explicit Claude launch refuses a Codex registry entry", async () => {
    const root = tempRoot();
    const codex = { ...entry("codex-pool"), family: "codex" as const };
    const result = await resolveForLaunch("codex-pool", "worker-1", resolutionDeps(root, [codex], {}));
    expect(result).toMatchObject({ ok: false, why: expect.stringMatching(/codex.*not claude/i) });
    expect(existsSync(path.join(root, ".claude-accounts", "reservations.ndjson"))).toBe(false);
  });

  test("an explicit orchestrator entry refuses rather than setting the default directory explicitly", async () => {
    const root = tempRoot();
    const result = await resolveForLaunch(
      "main",
      "worker-1",
      resolutionDeps(root, [entry("main", "orchestrator")], {}),
    );
    expect(result).toMatchObject({
      ok: false,
      why: expect.stringMatching(/orchestrator.*ambient|cannot.*routed|omit.*account/i),
    });
    expect(existsSync(path.join(root, ".claude-accounts", "reservations.ndjson"))).toBe(false);
  });

  test("a pool entry pointing at the default config directory is a fault, not an ambient fallback", async () => {
    const root = tempRoot();
    const broken = { ...entry("pool1"), stateDir: path.join(root, ".claude") };
    const result = await resolveForLaunch(
      "auto",
      "worker-1",
      resolutionDeps(root, [broken], {}),
    );
    expect(result).toMatchObject({
      ok: false,
      why: expect.stringMatching(/default.*cannot be routed|\.claude.*refus/i),
    });
    expect(existsSync(path.join(root, ".claude-accounts", "reservations.ndjson"))).toBe(false);
  });

  test("expired reservations stop outweighing live usage", async () => {
    const root = tempRoot();
    const accountRoot = path.join(root, ".claude-accounts");
    mkdirSync(accountRoot, { recursive: true });
    writeFileSync(path.join(accountRoot, "reservations.ndjson"), `${JSON.stringify({
      schema: 1,
      accountName: "pool1",
      providerAccountId: "uuid-pool1",
      sessionUuid: "abandoned-session",
      launchName: "abandoned",
      createdAt: "2026-09-01T20:00:00.000Z",
      activeUntil: "2026-09-01T20:15:00.000Z",
      outcome: "reserved",
    })}\n`);

    const result = await resolveForLaunch(
      "auto",
      "worker-1",
      resolutionDeps(root, [entry("pool1"), entry("pool2")], { pool1: 10, pool2: 20 }),
    );
    expect(result).toMatchObject({ ok: true, account: { name: "pool1" } });
  });

  test("usage ties break by reservation time, not by when a prior session completed", async () => {
    const root = tempRoot();
    const accountRoot = path.join(root, ".claude-accounts");
    mkdirSync(accountRoot, { recursive: true });
    const line = (accountName: string, sessionUuid: string, createdAt: string, outcome: string) => JSON.stringify({
      schema: 1,
      accountName,
      providerAccountId: `uuid-${accountName}`,
      sessionUuid,
      launchName: sessionUuid,
      createdAt,
      outcome,
    });
    writeFileSync(path.join(accountRoot, "reservations.ndjson"), [
      line("pool1", "old-reservation", "2026-09-09T19:00:00.000Z", "reserved"),
      line("pool2", "new-reservation", "2026-09-09T19:30:00.000Z", "reserved"),
      line("pool2", "new-reservation", "2026-09-09T19:31:00.000Z", "completed"),
      line("pool1", "old-reservation", "2026-09-09T20:30:00.000Z", "completed"),
    ].join("\n") + "\n");

    const result = await resolveForLaunch(
      "auto",
      "worker-1",
      resolutionDeps(root, [entry("pool1"), entry("pool2")], { pool1: 10, pool2: 10 }),
    );
    expect(result).toMatchObject({ ok: true, account: { name: "pool1" } });
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

  test("keeps a delayed launch reserved through its wait plus startup grace", async () => {
    const root = tempRoot();
    const deps = resolutionDeps(root, [entry("pool1")], { pool1: 10 });
    await resolveForLaunch("auto", "delayed-session", deps, "delayed-worker", 7200);
    const record = JSON.parse(readFileSync(path.join(root, ".claude-accounts", "reservations.ndjson"), "utf8"));
    expect(record).toMatchObject({
      sessionUuid: "delayed-session",
      createdAt: "2026-09-09T21:00:00.000Z",
      activeUntil: "2026-09-09T23:15:00.000Z",
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
