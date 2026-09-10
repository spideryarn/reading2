/**
 * Inspect, register, and seed the box's per-account Claude config directories.
 *
 * The public commands are deliberately non-interactive. A later UI/wizard can
 * collect answers, then call the same `main(argv, deps)` seam. Identity is
 * asserted before any write. Nothing here logs a credential, refreshes an OAuth
 * token, or invokes one of Claude's credential-changing commands.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  constants,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { isMain } from "../src/is-main.js";
import {
  poolAccounts,
  parseAccountRegistry,
  readAccountRegistry,
  readProfile,
  readUsage,
  resolveAccount,
  type AccountEntry,
  type RegistryReading,
} from "../tools/overseer/accounts.js";
import { releaseLock, takeLock } from "../tools/overseer/lock.js";

export type AuthStatusReading =
  | { kind: "value"; loggedIn: boolean; email: string | null }
  | { kind: "unknown"; why: string };

type ProfileReading =
  | { kind: "value"; accountUuid: string; email: string; orgId: string; configDir: string; takenAt: string }
  | { kind: "unknown"; why: string; configDir?: string; takenAt?: string };

interface UsageLike {
  kind: string;
  [key: string]: unknown;
}

export interface ClaudeAccountsDeps {
  homeDir: string;
  registryPath: string;
  now: () => Date;
  out: (line: string) => void;
  err: (line: string) => void;
  readRegistry: (registryPath: string) => Promise<RegistryReading>;
  authStatus: (configDir: string) => AuthStatusReading;
  profile: (configDir: string) => Promise<ProfileReading>;
  usage: (configDir: string) => Promise<UsageLike>;
}

const realDeps = (): ClaudeAccountsDeps => {
  const homeDir = homedir();
  return {
    homeDir,
    registryPath: path.join(homeDir, ".claude-accounts", "registry.json"),
    now: () => new Date(),
    out: (line) => console.log(line),
    err: (line) => console.error(line),
    readRegistry: readAccountRegistry,
    authStatus: runAuthStatus,
    profile: async (configDir) => readProfile(configDir, { fetch }),
    usage: async (configDir) => readUsage(configDir, { fetch }),
  };
};

function depsWith(overrides: Partial<ClaudeAccountsDeps>): ClaudeAccountsDeps {
  const base = realDeps();
  return { ...base, ...overrides };
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function parseJsonObject(file: string, required: boolean): { ok: true; value: Record<string, unknown>; text: string | null } | { ok: false; why: string } {
  if (!existsSync(file)) {
    return required ? { ok: false, why: `${file} does not exist` } : { ok: true, value: {}, text: null };
  }
  const text = readFileSync(file, "utf8");
  try {
    const value = object(JSON.parse(text));
    return value ? { ok: true, value, text } : { ok: false, why: `${file} is not a JSON object` };
  } catch (error) {
    return { ok: false, why: `${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Ask Claude's free identity probe under exactly one config directory. */
export function runAuthStatus(
  configDir: string,
  options: {
    env?: NodeJS.ProcessEnv;
    command?: string;
    commandArgsPrefix?: string[];
    runner?: (
      command: string,
      args: string[],
      options: { encoding: "utf8"; env: NodeJS.ProcessEnv },
    ) => { error?: Error; status: number | null; stdout: string };
  } = {},
): AuthStatusReading {
  const runner = options.runner ?? spawnSync;
  const result = runner(options.command ?? "claude", [...(options.commandArgsPrefix ?? []), "auth", "status", "--json"], {
    encoding: "utf8",
    env: { ...(options.env ?? process.env), CLAUDE_CONFIG_DIR: configDir },
  });
  if (result.error) return { kind: "unknown", why: `could not run claude auth status: ${result.error.message}` };
  if (result.status !== 0) return { kind: "unknown", why: `claude auth status exited ${result.status ?? "without a status"}` };
  try {
    const parsed = object(JSON.parse(String(result.stdout)));
    if (!parsed || typeof parsed["loggedIn"] !== "boolean") {
      return { kind: "unknown", why: "claude auth status did not return a loggedIn boolean" };
    }
    const email = parsed["email"];
    if (email !== undefined && email !== null && typeof email !== "string") {
      return { kind: "unknown", why: "claude auth status returned a non-string email" };
    }
    return { kind: "value", loggedIn: parsed["loggedIn"], email: typeof email === "string" ? email : null };
  } catch {
    return { kind: "unknown", why: "claude auth status returned malformed JSON" };
  }
}

type SeedResult =
  | { ok: true; changed: boolean; messages: string[] }
  | { ok: false; why: string };

interface SeedOptions {
  defaultConfigDir?: string;
  now?: () => Date;
  isConfigDirInUse?: (configDir: string) => boolean;
  afterProjectsCopy?: () => void;
}

interface ProjectFile {
  relative: string;
  sha256: string;
}

interface ProjectsMigration {
  kind: "migrate";
  source: string;
  destination: string;
  backup: string;
  statePath: string;
  files: ProjectFile[];
  afterCopy?: () => void;
}

function readProjectsMigration(
  targetDir: string,
  source: string,
  destination: string,
): ProjectsMigration | null {
  const statePath = path.join(targetDir, ".projects-migration.json");
  const parsed = parseJsonObject(statePath, false);
  if (!parsed.ok || parsed.text === null) return null;
  const state = parsed.value;
  if (
    state.schema !== 1 || state.source !== source || state.destination !== destination ||
    typeof state.backup !== "string" || !Array.isArray(state.files) ||
    (state.phase !== "copying" && state.phase !== "renamed" && state.phase !== "complete")
  ) return null;
  const files: ProjectFile[] = [];
  for (const raw of state.files) {
    const file = object(raw);
    if (!file || typeof file.relative !== "string" || typeof file.sha256 !== "string") return null;
    files.push({ relative: file.relative, sha256: file.sha256 });
  }
  return { kind: "migrate", source, destination, backup: state.backup, statePath, files };
}

interface SeedPlan {
  targetDir: string;
  projectsLink: string;
  desiredProjects: string;
  claudePath: string;
  claudeBefore: string | null;
  claudeAfter: Record<string, unknown>;
  claudeChanged: boolean;
  settingsPath: string;
  settingsAfter: Record<string, unknown>;
  settingsChanged: boolean;
  copyPlugins: boolean;
  pluginsSource: string;
  projects: { kind: "link" } | { kind: "already" } | ProjectsMigration;
  now: () => Date;
  messages: string[];
}

function jsonText(value: Record<string, unknown>): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Add source defaults recursively while keeping every value already present in target. */
function defaultsUnder(source: unknown, target: unknown): unknown {
  const sourceObject = object(source);
  const targetObject = object(target);
  if (!sourceObject || !targetObject) return target === undefined ? structuredClone(source) : target;
  const result: Record<string, unknown> = { ...targetObject };
  for (const [key, value] of Object.entries(sourceObject)) result[key] = defaultsUnder(value, targetObject[key]);
  return result;
}

const FIRST_RUN_KEYS = new Set(["hasCompletedOnboarding"]);
const SEEDED_MCP_SERVERS = new Set(["playwright", "chrome-devtools"]);
const SEEDED_SETTINGS_ENV = new Set(["CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS"]);

function fileHash(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function projectManifest(root: string): ProjectFile[] {
  const files: ProjectFile[] = [];
  const visit = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const absolute = path.join(dir, name);
      const relative = prefix ? path.join(prefix, name) : name;
      const info = lstatSync(absolute);
      if (info.isSymbolicLink()) throw new Error(`${absolute} is a symlink; refusing transcript migration`);
      if (info.isDirectory()) visit(absolute, relative);
      else if (info.isFile()) files.push({ relative, sha256: fileHash(absolute) });
      else throw new Error(`${absolute} is not a regular file or directory`);
    }
  };
  visit(root, "");
  return files;
}

function sameManifest(a: ProjectFile[], b: ProjectFile[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function defaultConfigDirInUse(configDir: string): boolean {
  let pids: string[];
  try {
    pids = readdirSync("/proc").filter((name) => /^\d+$/.test(name));
  } catch {
    return true;
  }
  const needle = `CLAUDE_CONFIG_DIR=${configDir}`;
  for (const pid of pids) {
    if (Number(pid) === process.pid) continue;
    try {
      const entries = readFileSync(path.join("/proc", pid, "environ"), "utf8").split("\0");
      if (entries.includes(needle)) return true;
    } catch {
      // Processes may exit or be unreadable while /proc is scanned. Neither is
      // positive evidence that this config directory is in use.
    }
  }
  return false;
}

function inspectProjectsShare(
  projectsLink: string,
  desiredProjects: string,
  targetDir: string,
  options: SeedOptions,
): { ok: true; projects: SeedPlan["projects"] } | { ok: false; why: string } {
  let info: ReturnType<typeof lstatSync> | null = null;
  try {
    info = lstatSync(projectsLink);
  } catch {
    const resume = readProjectsMigration(targetDir, projectsLink, desiredProjects);
    if (resume && existsSync(resume.backup)) return { ok: true, projects: resume };
    return { ok: true, projects: { kind: "link" } };
  }
  if (info.isDirectory() && !info.isSymbolicLink()) {
    if ((options.isConfigDirInUse ?? defaultConfigDirInUse)(targetDir)) {
      return { ok: false, why: `${targetDir} is in use by a Claude session; refusing projects migration` };
    }
    if (!existsSync(desiredProjects)) return { ok: false, why: `${desiredProjects} does not exist` };
    let files: ProjectFile[];
    try {
      files = projectManifest(projectsLink);
    } catch (error) {
      return { ok: false, why: error instanceof Error ? error.message : String(error) };
    }
    const statePath = path.join(targetDir, ".projects-migration.json");
    const resume = readProjectsMigration(targetDir, projectsLink, desiredProjects);
    const stamp = (options.now?.() ?? new Date()).toISOString().replace(/[:.]/g, "-");
    const backup = resume?.backup ?? path.join(targetDir, `projects.retained-${stamp}`);
    if (resume && !sameManifest(files, resume.files)) {
      return { ok: false, why: "projects source changed since the recorded migration began" };
    }
    for (const file of files) {
      const destination = path.join(desiredProjects, file.relative);
      const parentRelative = path.dirname(file.relative);
      if (parentRelative !== ".") {
        let parent = desiredProjects;
        for (const segment of parentRelative.split(path.sep)) {
          parent = path.join(parent, segment);
          if (!existsSync(parent)) break;
          const parentInfo = lstatSync(parent);
          if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()) {
            return { ok: false, why: `projects migration destination collision at ${parent}` };
          }
        }
      }
      if (existsSync(destination)) {
        const destinationInfo = lstatSync(destination);
        if (!destinationInfo.isFile() || destinationInfo.isSymbolicLink() || !resume || fileHash(destination) !== file.sha256) {
          return { ok: false, why: `projects migration destination collision at ${destination}` };
        }
      }
    }
    return {
      ok: true,
      projects: {
        kind: "migrate",
        source: projectsLink,
        destination: desiredProjects,
        backup,
        statePath,
        files,
        ...(options.afterProjectsCopy ? { afterCopy: options.afterProjectsCopy } : {}),
      },
    };
  }
  if (!info.isSymbolicLink()) {
    return { ok: false, why: `${projectsLink} exists and is not the shared projects symlink; refusing before changing anything` };
  }
  const current = path.resolve(path.dirname(projectsLink), readlinkSync(projectsLink));
  if (!existsSync(projectsLink)) {
    return { ok: false, why: `${projectsLink} is a dangling symlink; refusing before changing anything` };
  }
  return current === path.resolve(desiredProjects)
    ? { ok: true, projects: { kind: "already" } }
    : { ok: false, why: `${projectsLink} points to ${current}, not ${desiredProjects}; refusing before changing anything` };
}

function seededClaudeJson(source: Record<string, unknown>, target: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };
  const sourceMcp = object(source.mcpServers);
  if (sourceMcp) {
    const allowed = Object.fromEntries(Object.entries(sourceMcp).filter(([name]) => SEEDED_MCP_SERVERS.has(name)));
    result.mcpServers = defaultsUnder(allowed, target.mcpServers ?? {}) as Record<string, unknown>;
  }

  const sourceProjects = object(source.projects);
  const targetProjects = object(target.projects) ?? {};
  const projectsAfter: Record<string, unknown> = { ...targetProjects };
  for (const [repoPath, rawProject] of Object.entries(sourceProjects ?? {})) {
    const sourceProject = object(rawProject);
    if (!sourceProject || typeof sourceProject.hasTrustDialogAccepted !== "boolean") continue;
    const targetProject = object(targetProjects[repoPath]) ?? {};
    projectsAfter[repoPath] = {
      ...targetProject,
      hasTrustDialogAccepted: targetProject.hasTrustDialogAccepted ?? sourceProject.hasTrustDialogAccepted,
    };
  }
  if (Object.keys(projectsAfter).length > 0) result.projects = projectsAfter;
  for (const [key, value] of Object.entries(source)) {
    if (FIRST_RUN_KEYS.has(key) && result[key] === undefined) result[key] = structuredClone(value);
  }
  return result;
}

function seededSettings(source: Record<string, unknown>, target: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };
  for (const key of ["model", "permissions", "autoMode"] as const) {
    if (source[key] !== undefined) result[key] = defaultsUnder(source[key], target[key]);
  }
  const sourceEnv = object(source.env);
  const targetEnv = object(target.env) ?? {};
  const allowedEnv = Object.fromEntries(
    Object.entries(sourceEnv ?? {}).filter(([name]) => SEEDED_SETTINGS_ENV.has(name)),
  );
  if (Object.keys(targetEnv).length > 0 || Object.keys(allowedEnv).length > 0) {
    result.env = defaultsUnder(allowedEnv, targetEnv);
  }
  return result;
}

/**
 * Where a config directory's `.claude.json` actually is.
 *
 * For the **default** account it is `~/.claude.json`, a sibling of `~/.claude`;
 * for every routed account it is inside the directory. The CLI itself follows
 * this rule — with `CLAUDE_CONFIG_DIR` unset it reads the sibling, and with it
 * set it reads inside — which is why pointing `CLAUDE_CONFIG_DIR` at
 * `~/.claude` yields `email: null` for an account that is plainly signed in.
 */
export function defaultClaudeJsonPath(configDir: string, home = homedir()): string {
  return path.resolve(configDir) === path.resolve(path.join(home, ".claude"))
    ? path.join(home, ".claude.json")
    : path.join(configDir, ".claude.json");
}

function prepareSeed(targetDir: string, options: SeedOptions = {}): SeedPlan | { why: string } {
  const defaultConfigDir = options.defaultConfigDir ?? path.join(homedir(), ".claude");
  if (path.resolve(targetDir) === path.resolve(defaultConfigDir)) return { why: "refusing to seed the default config directory into itself" };
  if (!existsSync(targetDir)) return { why: `${targetDir} does not exist; log in under that config directory before seeding it` };

  const desiredProjects = path.join(defaultConfigDir, "projects");
  const projectsLink = path.join(targetDir, "projects");
  const projects = inspectProjectsShare(projectsLink, desiredProjects, targetDir, options);
  if (!projects.ok) return { why: projects.why };

  // NOT `<defaultConfigDir>/.claude.json`. **The default account's config file
  // lives BESIDE its directory, not inside it** — `~/.claude.json`, while a
  // routed account's lives at `<CLAUDE_CONFIG_DIR>/.claude.json`. Measured on
  // the box 2026-09-10 against 2.1.267, and it is the same root cause as the
  // identity asymmetry in `authStatusEnv` below: naming the default dir
  // explicitly makes the CLI look *inside* it and find nothing.
  //
  // Reading the wrong path here does not fail loudly. A bare `claude auth
  // status` under an explicit default dir CREATES a first-run stub there, so
  // the seeder would find a real file holding eight boilerplate keys, no
  // `mcpServers` and no identity — and seed a pool account with nothing while
  // reporting success. `docs/reusable/silent-success.md` is the class.
  const sourceClaude = parseJsonObject(defaultClaudeJsonPath(defaultConfigDir), true);
  if (!sourceClaude.ok) return { why: sourceClaude.why };
  const claudePath = path.join(targetDir, ".claude.json");
  const targetClaude = parseJsonObject(claudePath, false);
  if (!targetClaude.ok) return { why: targetClaude.why };
  const claudeAfter = seededClaudeJson(sourceClaude.value, targetClaude.value);

  const sourceSettings = parseJsonObject(path.join(defaultConfigDir, "settings.json"), true);
  if (!sourceSettings.ok) return { why: sourceSettings.why };
  const settingsPath = path.join(targetDir, "settings.json");
  const targetSettings = parseJsonObject(settingsPath, false);
  if (!targetSettings.ok) return { why: targetSettings.why };
  const settingsAfter = seededSettings(sourceSettings.value, targetSettings.value);

  const pluginsSource = path.join(defaultConfigDir, "plugins");
  const pluginsTarget = path.join(targetDir, "plugins");
  const copyPlugins = existsSync(pluginsSource) && !existsSync(pluginsTarget);
  const claudeChanged = jsonText(claudeAfter) !== (targetClaude.text ?? "");
  const settingsChanged = jsonText(settingsAfter) !== (targetSettings.text ?? "");
  const messages = [
    claudeChanged ? "merged named .claude.json seed keys" : ".claude.json already carries every seeded value",
    settingsChanged ? "merged model, permissions, autoMode and env defaults" : "settings.json already carries every seeded value",
    copyPlugins ? "copied plugins/ because it was absent" : "plugins/ already present (or absent in the source)",
    projects.projects.kind === "already"
      ? `projects already links to ${desiredProjects}`
      : projects.projects.kind === "migrate"
        ? `migrated projects, retained ${projects.projects.backup}, and linked projects -> ${desiredProjects}`
        : `linked projects -> ${desiredProjects}`,
    "sentry and vercel are not seeded; run /mcp under this account directory to log in if they are needed",
  ];
  return {
    targetDir,
    projectsLink,
    desiredProjects,
    claudePath,
    claudeBefore: targetClaude.text,
    claudeAfter,
    claudeChanged,
    settingsPath,
    settingsAfter,
    settingsChanged,
    copyPlugins,
    pluginsSource,
    projects: projects.projects,
    now: options.now ?? (() => new Date()),
    messages,
  };
}

function applyProjects(plan: SeedPlan["projects"], projectsLink: string, desiredProjects: string): boolean {
  if (plan.kind === "already") return false;
  if (plan.kind === "link") {
    symlinkSync(desiredProjects, projectsLink);
    if (realpathSync(projectsLink) !== realpathSync(desiredProjects)) throw new Error("projects symlink verification failed");
    return true;
  }
  if (existsSync(plan.source)) {
    writeJsonAtomic(plan.statePath, {
      schema: 1,
      source: plan.source,
      destination: plan.destination,
      backup: plan.backup,
      phase: "copying",
      files: plan.files,
    });
    for (const file of plan.files) {
      const source = path.join(plan.source, file.relative);
      const destination = path.join(plan.destination, file.relative);
      mkdirSync(path.dirname(destination), { recursive: true });
      if (!existsSync(destination)) copyFileSync(source, destination, constants.COPYFILE_EXCL);
      if (fileHash(destination) !== file.sha256) throw new Error(`projects migration verification failed for ${destination}`);
    }
    plan.afterCopy?.();
    if (!sameManifest(projectManifest(plan.source), plan.files)) {
      throw new Error("projects source changed during migration; original retained in place");
    }
    renameSync(plan.source, plan.backup);
    writeJsonAtomic(plan.statePath, {
      schema: 1,
      source: plan.source,
      destination: plan.destination,
      backup: plan.backup,
      phase: "renamed",
      files: plan.files,
    });
  } else if (!existsSync(plan.backup)) {
    throw new Error("projects migration lost both its source and retained backup");
  }
  if (!existsSync(plan.source)) symlinkSync(plan.destination, plan.source);
  if (realpathSync(plan.source) !== realpathSync(plan.destination)) throw new Error("projects symlink verification failed");
  writeJsonAtomic(plan.statePath, {
    schema: 1,
    source: plan.source,
    destination: plan.destination,
    backup: plan.backup,
    phase: "complete",
    files: plan.files,
  });
  return true;
}

function writeJsonAtomic(file: string, value: Record<string, unknown>, mode = 0o600): void {
  const temporary = `${file}.tmp-${process.pid}`;
  writeFileSync(temporary, jsonText(value), { mode });
  chmodSync(temporary, mode);
  renameSync(temporary, file);
}

function unusedBackupPath(dir: string, instant: Date): string {
  const stem = `.claude.json.${instant.toISOString().replace(/[:.]/g, "-")}.bak`;
  let candidate = path.join(dir, stem);
  for (let suffix = 1; existsSync(candidate); suffix += 1) candidate = path.join(dir, `${stem}.${suffix}`);
  return candidate;
}

function applySeed(plan: SeedPlan): Extract<SeedResult, { ok: true }> {
  const projectsChanged = applyProjects(plan.projects, plan.projectsLink, plan.desiredProjects);
  if (plan.claudeChanged && plan.claudeBefore !== null) {
    const backups = path.join(plan.targetDir, "backups");
    mkdirSync(backups, { recursive: true, mode: 0o700 });
    const backup = unusedBackupPath(backups, plan.now());
    copyFileSync(plan.claudePath, backup);
    chmodSync(backup, 0o600);
  }
  if (plan.claudeChanged) writeJsonAtomic(plan.claudePath, plan.claudeAfter);
  if (plan.settingsChanged) writeJsonAtomic(plan.settingsPath, plan.settingsAfter);
  if (plan.copyPlugins) cpSync(plan.pluginsSource, path.join(plan.targetDir, "plugins"), { recursive: true, errorOnExist: true });
  return {
    ok: true,
    changed: plan.claudeChanged || plan.settingsChanged || plan.copyPlugins || projectsChanged,
    messages: plan.messages,
  };
}

/** Surgical, idempotent seeding. Exported so refusal paths can be tested without a real account. */
export function seedClaudeConfig(targetDir: string, options: SeedOptions = {}): SeedResult {
  const prepared = prepareSeed(targetDir, options);
  if ("why" in prepared) return { ok: false, why: prepared.why };
  return applySeed(prepared);
}

function assertIdentity(entry: Pick<AccountEntry, "stateDir" | "displayEmail">, deps: ClaudeAccountsDeps): { ok: true; found: string } | { ok: false; why: string } {
  if (!entry.displayEmail) return { ok: false, why: `${entry.stateDir}: Claude account has no displayEmail` };
  const status = deps.authStatus(entry.stateDir);
  if (status.kind === "unknown") return { ok: false, why: `${entry.stateDir}: ${status.why}` };
  if (!status.loggedIn) return { ok: false, why: `${entry.stateDir}: claude auth status reports loggedIn: false` };
  if (status.email !== entry.displayEmail) {
    return { ok: false, why: `${entry.stateDir}: expected ${entry.displayEmail}, but claude auth status found ${status.email ?? "no email"}` };
  }
  return { ok: true, found: status.email };
}

interface ParsedArgs {
  command: string;
  flags: Map<string, string | true>;
}

function parseArgs(argv: readonly string[]): ParsedArgs | { why: string } {
  const command = argv[0];
  if (!command) return { why: "usage: claude-accounts <list|check|add|resolve> [flags]" };
  const flags = new Map<string, string | true>();
  for (let i = 1; i < argv.length; i += 1) {
    const flag = argv[i];
    if (!flag?.startsWith("--")) return { why: `unexpected argument: ${flag ?? ""}` };
    if (flag === "--seed") {
      flags.set(flag, true);
      continue;
    }
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) return { why: `${flag} needs a value` };
    if (flags.has(flag)) return { why: `${flag} was supplied more than once` };
    flags.set(flag, value);
    i += 1;
  }
  return { command, flags };
}

function flag(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.flags.get(name);
  return typeof value === "string" ? value : undefined;
}

function registryAccounts(reading: RegistryReading): { ok: true; accounts: AccountEntry[] } | { ok: false; why: string } {
  return reading.kind === "error" ? { ok: false, why: reading.why } : { ok: true, accounts: [...reading.accounts] };
}

function writeRegistry(registryPath: string, accounts: AccountEntry[]): void {
  const dir = path.dirname(registryPath);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  writeJsonAtomic(registryPath, { schema: 1, accounts }, 0o600);
  chmodSync(registryPath, 0o600);
}

export interface LaunchRecord {
  schema: 1;
  accountName: string;
  providerAccountId: string | null;
  sessionUuid: string;
  launchName: string;
  createdAt: string;
  outcome: "reserved" | "started" | "completed" | "failed";
}

function readLaunches(file: string): LaunchRecord[] {
  if (!existsSync(file)) return [];
  const records: LaunchRecord[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const value = object(JSON.parse(line));
      if (
        value?.["schema"] === 1 &&
        typeof value["accountName"] === "string" &&
        (typeof value["providerAccountId"] === "string" || value["providerAccountId"] === null) &&
        typeof value["sessionUuid"] === "string" &&
        typeof value["launchName"] === "string" &&
        typeof value["createdAt"] === "string" &&
        (value["outcome"] === "reserved" || value["outcome"] === "started" || value["outcome"] === "completed" || value["outcome"] === "failed")
      ) {
        records.push({
          schema: 1,
          accountName: value["accountName"],
          providerAccountId: value["providerAccountId"],
          sessionUuid: value["sessionUuid"],
          launchName: value["launchName"],
          createdAt: value["createdAt"],
          outcome: value["outcome"],
        });
      }
    } catch {
      // A launch log is advisory ranking input. A malformed line cannot name an
      // account and therefore gives none an unfair recent-launch penalty.
    }
  }
  return records;
}

function weeklyPercent(reading: unknown): number | null {
  if (Array.isArray(reading)) {
    for (const value of reading) {
      const found = weeklyPercent(value);
      if (found !== null) return found;
    }
    return null;
  }
  const value = object(reading);
  if (!value) return null;
  if (value["window"] === "seven_day" && value["kind"] === "value" && typeof value["utilizationPercent"] === "number") {
    return value["utilizationPercent"];
  }
  const direct = object(value["seven_day"]);
  if (direct && (direct["kind"] === "value" || direct["kind"] === "current")) {
    const number = direct["utilizationPercent"] ?? direct["percentage"];
    if (typeof number === "number") return number;
  }
  for (const child of Object.values(value)) {
    const found = weeklyPercent(child);
    if (found !== null) return found;
  }
  return null;
}

function chooseAuto(
  accounts: AccountEntry[],
  usage: Map<string, number | null>,
  launches: LaunchRecord[],
): { account: AccountEntry; reason: string } {
  const last = new Map<string, number>();
  const latestBySession = new Map<string, LaunchRecord>();
  for (const launch of launches) {
    const at = Date.parse(launch.createdAt);
    if (Number.isFinite(at)) {
      last.set(launch.accountName, Math.max(last.get(launch.accountName) ?? 0, at));
    }
    latestBySession.set(launch.sessionUuid, launch);
  }
  const active = new Map<string, number>();
  for (const record of latestBySession.values()) {
    if (record.outcome === "reserved" || record.outcome === "started") {
      active.set(record.accountName, (active.get(record.accountName) ?? 0) + 1);
    }
  }
  const candidates = accounts;
  candidates.sort((a, b) => {
    const activeDifference = (active.get(a.name) ?? 0) - (active.get(b.name) ?? 0);
    if (activeDifference !== 0) return activeDifference;
    const aUsage = usage.get(a.name) ?? null;
    const bUsage = usage.get(b.name) ?? null;
    if (aUsage === null || bUsage === null) {
      const recency = (last.get(a.name) ?? 0) - (last.get(b.name) ?? 0);
      if (recency !== 0) return recency;
      // Equal recency and only one unknown: sample the unknown account so it
      // can acquire a reading. This is exploration, not pretending it is 0%.
      if (aUsage === null && bUsage !== null) return -1;
      if (aUsage !== null && bUsage === null) return 1;
    }
    if (aUsage !== null && bUsage === null) return -1;
    if (aUsage === null && bUsage !== null) return 1;
    if (aUsage !== null && bUsage !== null && aUsage !== bUsage) return aUsage - bUsage;
    const recent = (last.get(a.name) ?? 0) - (last.get(b.name) ?? 0);
    return recent !== 0 ? recent : a.name.localeCompare(b.name);
  });
  const account = candidates[0]!;
  const percent = usage.get(account.name) ?? null;
  const allUnknown = candidates.every((candidate) => (usage.get(candidate.name) ?? null) === null);
  const tied = candidates.filter((candidate) => (usage.get(candidate.name) ?? null) === percent).length > 1;
  const reservation = (active.get(account.name) ?? 0) > 0
    ? "; active reservations were balanced before usage"
    : "";
  const reason = allUnknown
    ? `all pool seven-day readings were unknown; chose the least recently launched account${reservation}`
    : percent === null
      ? `chose a never-reserved account whose live seven-day reading is unknown so it can be sampled${reservation}`
      : `chose the lowest live seven-day utilization (${percent}%)${tied ? "; the tie was broken by least recently launched" : ""}${reservation}`;
  return { account, reason };
}

async function withLaunchLock<T>(dir: string, now: () => Date, body: () => Promise<T>): Promise<T> {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const lock = path.join(dir, "launch.lock");
  const deadline = Date.now() + 10_000;
  let held: ReturnType<typeof takeLock>;
  for (;;) {
    held = takeLock(lock, now);
    if (held.ok) break;
    if (held.refusal.reason !== "already-running" && held.refusal.reason !== "lost-the-race") {
      throw new Error(`could not take ${lock}: ${held.refusal.detail}`);
    }
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${lock}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  try {
    return await body();
  } finally {
    releaseLock(held.lock, lock);
  }
}

export type LaunchResolution =
  | { ok: true; account: AccountEntry | null; resolvedName: string; reason: string }
  | { ok: false; why: string };

function reservation(account: AccountEntry | null, sessionUuid: string, launchName: string, at: Date): LaunchRecord {
  return {
    schema: 1,
    accountName: account?.name ?? "ambient",
    providerAccountId: account?.providerAccountId ?? null,
    sessionUuid,
    launchName,
    createdAt: at.toISOString(),
    outcome: "reserved",
  };
}

function appendReservation(dir: string, record: LaunchRecord): void {
  const ledgerPath = path.join(dir, "reservations.ndjson");
  appendFileSync(ledgerPath, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(ledgerPath, 0o600);
}

export function recordLaunchOutcome(
  accountDir: string,
  sessionUuid: string,
  outcome: "started" | "completed" | "failed",
  at = new Date(),
): boolean {
  const ledgerPath = path.join(accountDir, "reservations.ndjson");
  const prior = readLaunches(ledgerPath).filter((record) => record.sessionUuid === sessionUuid).at(-1);
  if (!prior) return false;
  appendReservation(accountDir, { ...prior, createdAt: at.toISOString(), outcome });
  return true;
}

/** Resolve and reserve on the box, where the registry and usage credentials live. */
export async function resolveForLaunch(
  requested: string,
  sessionUuid: string,
  overrides: Partial<ClaudeAccountsDeps> = {},
  launchName = sessionUuid,
): Promise<LaunchResolution> {
  const deps = depsWith(overrides);
  const reading = await deps.readRegistry(deps.registryPath);
  if (reading.kind === "error") return { ok: false, why: reading.why };
  if (requested !== "auto") {
    const resolved = resolveAccount(reading, requested);
    if (resolved.kind === "refused") return { ok: false, why: resolved.why };
    const dir = path.dirname(deps.registryPath);
    return withLaunchLock(dir, deps.now, async () => {
      appendReservation(dir, reservation(resolved.account, sessionUuid, launchName, deps.now()));
      return {
        ok: true,
        account: resolved.account,
        resolvedName: resolved.account.name,
        reason: `explicitly requested ${requested}`,
      };
    });
  }
  const accounts = poolAccounts(reading);
  if (accounts.length === 0) {
    const ambient = reading.kind === "value"
      ? reading.accounts.find((account) => account.family === "claude" && account.role === "orchestrator") ?? null
      : null;
    const dir = path.dirname(deps.registryPath);
    return withLaunchLock(dir, deps.now, async () => {
      appendReservation(dir, reservation(ambient, sessionUuid, launchName, deps.now()));
      return {
        ok: true,
        account: ambient,
        resolvedName: ambient?.name ?? "ambient",
        reason: reading.kind === "ambient"
          ? "no account registry is configured; using the ambient Claude account"
          : "no Claude pool accounts are configured; using the ambient Claude account",
      };
    });
  }
  const dir = path.dirname(deps.registryPath);
  return withLaunchLock(dir, deps.now, async () => {
    const usage = new Map<string, number | null>();
    let identityFailure: string | null = null;
    await Promise.all(accounts.map(async (account) => {
      const reading = await deps.usage(account.stateDir);
      const value = object(reading);
      const identity = object(value?.["identity"]);
      if (
        value?.["kind"] === "value" &&
        (identity?.["providerAccountId"] !== account.providerAccountId ||
          identity["providerTenantId"] !== account.providerTenantId)
      ) {
        identityFailure = `${account.name} live identity does not match its registry pin`;
        return;
      }
      usage.set(account.name, weeklyPercent(reading));
    }));
    if (identityFailure) return { ok: false, why: identityFailure };
    const ledgerPath = path.join(dir, "reservations.ndjson");
    const chosen = chooseAuto([...accounts], usage, readLaunches(ledgerPath));
    appendReservation(dir, reservation(chosen.account, sessionUuid, launchName, deps.now()));
    return { ok: true, ...chosen, resolvedName: chosen.account.name };
  });
}

async function listOrCheck(command: "list" | "check", deps: ClaudeAccountsDeps): Promise<number> {
  const reading = await deps.readRegistry(deps.registryPath);
  const parsed = registryAccounts(reading);
  if (!parsed.ok) {
    deps.err(`FATAL: ${parsed.why}`);
    return 1;
  }
  if (reading.kind === "ambient") {
    deps.out("ambient account (registry absent; CLAUDE_CONFIG_DIR is unchanged)");
    return 0;
  }
  let failed = false;
  for (const account of parsed.accounts) {
    const identity = assertIdentity(account, deps);
    if (!identity.ok) failed = true;
    if (command === "check") {
      deps.out(identity.ok ? `${account.name}: found ${identity.found}; identity matches` : `${account.name}: FAILED ${identity.why}`);
      continue;
    }
    const usage = await deps.usage(account.stateDir);
    const weekly = weeklyPercent(usage);
    deps.out(
      `${account.name} family=${account.family} role=${account.role} stateDir=${account.stateDir} expected=${account.displayEmail ?? "(none)"} ` +
        `${identity.ok ? `found=${identity.found}` : `FAILED=${identity.why}`} seven-day=${weekly === null ? "unknown" : `${weekly}%`}`,
    );
  }
  return failed ? 1 : 0;
}

async function verifyForLaunch(name: string, deps: ClaudeAccountsDeps): Promise<{ ok: true } | { ok: false; why: string }> {
  const reading = await deps.readRegistry(deps.registryPath);
  const resolved = resolveAccount(reading, name);
  if (resolved.kind === "refused") return { ok: false, why: resolved.why };
  const account = resolved.account;
  if (account.family !== "claude") return { ok: false, why: `${name} belongs to ${account.family}, not claude` };
  if (!existsSync(account.stateDir)) return { ok: false, why: `${account.stateDir} does not exist` };
  const defaultStateDir = path.join(deps.homeDir, ".claude");
  if (path.resolve(account.stateDir) !== path.resolve(defaultStateDir)) {
    const projects = inspectProjectsShare(
      path.join(account.stateDir, "projects"),
      path.join(defaultStateDir, "projects"),
      account.stateDir,
      { isConfigDirInUse: () => false },
    );
    if (!projects.ok || projects.projects.kind !== "already") {
      return { ok: false, why: projects.ok ? "projects is not linked to the shared tree" : projects.why };
    }
  }
  const profile = await deps.profile(account.stateDir);
  if (profile.kind === "unknown") return { ok: false, why: profile.why };
  if (profile.accountUuid !== account.providerAccountId || profile.orgId !== account.providerTenantId) {
    return { ok: false, why: "provider account or tenant identity does not match the registry pin" };
  }
  if (account.displayEmail && profile.email !== account.displayEmail) {
    return { ok: false, why: "provider display email does not match the registry" };
  }
  return { ok: true };
}

async function add(parsed: ParsedArgs, deps: ClaudeAccountsDeps): Promise<number> {
  const allowed = new Set(["--name", "--config-dir", "--email", "--role", "--family", "--seed"]);
  for (const key of parsed.flags.keys()) {
    if (!allowed.has(key)) {
      deps.err(`FATAL: unknown add flag ${key}`);
      return 2;
    }
  }
  const name = flag(parsed, "--name");
  const configDir = flag(parsed, "--config-dir");
  const email = flag(parsed, "--email");
  const role = flag(parsed, "--role");
  const family = flag(parsed, "--family") ?? "claude";
  if (!name || !configDir || !email || !role) {
    deps.err("FATAL: add requires --name, --config-dir, --email and --role");
    return 2;
  }
  if (family !== "claude") {
    deps.err(`FATAL: ${family} is a registry family, but this slice implements Claude operations only`);
    return 2;
  }
  if (role !== "pool" && role !== "orchestrator") {
    deps.err(`FATAL: unknown role ${role}`);
    return 2;
  }
  if (!path.isAbsolute(configDir) || configDir.endsWith(path.sep)) {
    deps.err("FATAL: --config-dir must be an absolute path without a trailing slash");
    return 2;
  }
  if (parsed.flags.has("--seed") && role !== "pool") {
    deps.err("FATAL: --seed applies only to a pool config directory");
    return 2;
  }

  // Seed preflight is before auth/profile and, critically, before registry or
  // target writes. A real projects directory makes the whole add a no-op.
  let seedPlan: SeedPlan | null = null;
  if (parsed.flags.has("--seed")) {
    const prepared = prepareSeed(configDir, { defaultConfigDir: path.join(deps.homeDir, ".claude"), now: deps.now });
    if ("why" in prepared) {
      deps.err(`FATAL: ${prepared.why}`);
      return 1;
    }
    seedPlan = prepared;
  }

  const reading = await deps.readRegistry(deps.registryPath);
  const existing = registryAccounts(reading);
  if (!existing.ok) {
    deps.err(`FATAL: ${existing.why}`);
    return 1;
  }
  const identity = assertIdentity({ stateDir: configDir, displayEmail: email }, deps);
  if (!identity.ok) {
    deps.err(`FATAL: ${identity.why}; registry was not changed`);
    return 1;
  }
  deps.out(`found: already signed in as ${identity.found} under ${configDir}`);
  const profile = await deps.profile(configDir);
  if (profile.kind === "unknown") {
    deps.err(`FATAL: profile identity is unknown: ${profile.why}; registry was not changed`);
    return 1;
  }
  if (profile.email !== email) {
    deps.err(`FATAL: profile found ${profile.email}, expected ${email}; registry was not changed`);
    return 1;
  }
  deps.out(`found: profile accountUuid=${profile.accountUuid} orgId=${profile.orgId}`);

  if (seedPlan) {
    // Apply the already-preflighted plan. Do not call seedClaudeConfig here:
    // re-reading between assertion and write would create two sources of truth.
    const seeded = applySeed(seedPlan);
    for (const message of seeded.messages) deps.out(`seed: ${message}`);
    if (!seeded.changed) deps.out("seed: nothing to change");
  }

  const priorIndex = existing.accounts.findIndex((account) => account.name === name);
  const prior = priorIndex >= 0 ? existing.accounts[priorIndex] : undefined;
  if (
    prior &&
    (prior.providerAccountId !== profile.accountUuid || prior.providerTenantId !== profile.orgId)
  ) {
    deps.err(`FATAL: ${name} is pinned to a different provider account or tenant; registry was not changed`);
    return 1;
  }
  const next: AccountEntry = {
    ...prior,
    name,
    family: "claude",
    role,
    stateDir: configDir,
    providerAccountId: profile.accountUuid,
    providerTenantId: profile.orgId,
    displayEmail: email,
    addedAt: prior?.addedAt ?? deps.now().toISOString(),
    familyData: prior?.familyData ?? {},
  };
  const accounts = [...existing.accounts];
  if (priorIndex >= 0) accounts[priorIndex] = next;
  else accounts.push(next);
  const proposed = parseAccountRegistry({ schema: 1, accounts });
  if (proposed.kind === "error") {
    deps.err(`FATAL: the proposed registry is invalid: ${proposed.why}; registry was not changed`);
    return 1;
  }
  const changed = !prior || JSON.stringify(prior) !== JSON.stringify(next);
  if (changed) {
    writeRegistry(deps.registryPath, accounts);
    deps.out(`${prior ? "changed" : "added"}: registry entry ${name}`);
  } else {
    deps.out(`found: registry entry ${name} already matches; nothing to change`);
  }
  return 0;
}

export async function main(argv: readonly string[], overrides: Partial<ClaudeAccountsDeps> = {}): Promise<number> {
  const deps = depsWith(overrides);
  const parsed = parseArgs(argv);
  if ("why" in parsed) {
    deps.err(`FATAL: ${parsed.why}`);
    return 2;
  }
  if (parsed.command === "list" || parsed.command === "check") {
    if (parsed.flags.size > 0) {
      deps.err(`FATAL: ${parsed.command} takes no flags`);
      return 2;
    }
    return listOrCheck(parsed.command, deps);
  }
  if (parsed.command === "add") return add(parsed, deps);
  if (parsed.command === "verify") {
    if (parsed.flags.size !== 1 || !parsed.flags.has("--account")) {
      deps.err("FATAL: verify requires only --account");
      return 2;
    }
    const name = flag(parsed, "--account");
    if (!name) return 2;
    const result = await verifyForLaunch(name, deps);
    if (!result.ok) {
      deps.err(`FATAL: ${result.why}`);
      return 1;
    }
    return 0;
  }
  if (parsed.command === "resolve") {
    const allowed = new Set(["--account", "--launch-name", "--session-uuid"]);
    for (const key of parsed.flags.keys()) {
      if (!allowed.has(key)) {
        deps.err(`FATAL: unknown resolve flag ${key}`);
        return 2;
      }
    }
    const account = flag(parsed, "--account");
    const launchName = flag(parsed, "--launch-name");
    if (!account || !launchName) {
      deps.err("FATAL: resolve requires --account and --launch-name");
      return 2;
    }
    const sessionUuid = flag(parsed, "--session-uuid") ?? launchName;
    const resolved = await resolveForLaunch(account, sessionUuid, deps, launchName);
    if (!resolved.ok) {
      deps.err(`FATAL: ${resolved.why}`);
      return 1;
    }
    deps.out(JSON.stringify({
      name: resolved.resolvedName,
      family: "claude",
      stateDir: resolved.account?.stateDir ?? null,
      providerAccountId: resolved.account?.providerAccountId ?? null,
      providerTenantId: resolved.account?.providerTenantId ?? null,
      displayEmail: resolved.account?.displayEmail ?? null,
      reason: resolved.reason,
    }));
    return 0;
  }
  if (parsed.command === "outcome") {
    const allowed = new Set(["--session-uuid", "--value"]);
    for (const key of parsed.flags.keys()) {
      if (!allowed.has(key)) {
        deps.err(`FATAL: unknown outcome flag ${key}`);
        return 2;
      }
    }
    const sessionUuid = flag(parsed, "--session-uuid");
    const outcome = flag(parsed, "--value");
    if (!sessionUuid || (outcome !== "started" && outcome !== "completed" && outcome !== "failed")) {
      deps.err("FATAL: outcome requires --session-uuid and --value started|completed|failed");
      return 2;
    }
    const recorded = recordLaunchOutcome(path.dirname(deps.registryPath), sessionUuid, outcome, deps.now());
    if (!recorded) {
      deps.err(`FATAL: no reservation exists for session ${sessionUuid}`);
      return 1;
    }
    return 0;
  }
  deps.err(`FATAL: unknown command ${parsed.command}`);
  return 2;
}

if (isMain(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
