/**
 * Inspect, register, and seed the box's per-account Claude config directories.
 *
 * `add` is both the interactive wizard Greg runs and the flag-driven seam used
 * by tests and the web UI. Identity comes from the live profile, never merely
 * auth-status metadata. Nothing here logs or refreshes a credential; login is
 * invoked only for a demonstrably logged-out config directory.
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
import { createInterface } from "node:readline/promises";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

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
import {
  readCodexAuth,
  type CodexAuthReading,
  type CodexIdentity,
} from "../tools/overseer/codex-auth.js";

export type AuthStatusReading =
  | { kind: "value"; loggedIn: boolean; email: string | null; authMethod: string | null; apiProvider: string | null }
  | { kind: "unknown"; why: string };

type ProfileReading =
  | { kind: "value"; accountUuid: string; email: string; orgId: string; configDir: string; takenAt: string }
  | { kind: "unknown"; why: string; configDir?: string; takenAt?: string; status?: number };

interface UsageLike {
  kind: string;
  [key: string]: unknown;
}

type LoginResult = { ok: true } | { ok: false; why: string };

export type CodexDoctorReading =
  | {
      kind: "value";
      codexHome: string;
      sqliteHome: string;
      modelProvider: string;
      authFile: string;
      authStorageMode: string;
      authOk: boolean;
    }
  | { kind: "unknown"; why: string };

export interface ClaudeAccountsDeps {
  homeDir: string;
  registryPath: string;
  now: () => Date;
  out: (line: string) => void;
  err: (line: string) => void;
  prompt: (question: string, defaultValue: string) => Promise<string>;
  stdinIsTTY: boolean;
  readRegistry: (registryPath: string) => Promise<RegistryReading>;
  authStatus: (configDir: string, cwd?: string) => AuthStatusReading;
  login: (configDir: string, email: string) => LoginResult;
  profile: (configDir: string) => Promise<ProfileReading>;
  usage: (configDir: string) => Promise<UsageLike>;
  codexAuth: (stateDir: string) => Promise<CodexAuthReading>;
  codexDoctor: (stateDir: string) => CodexDoctorReading;
  codexConfigSource: string;
  repoRoot: string;
}

function primaryRepoRoot(checkoutRoot: string): string {
  const marker = `${path.sep}.claude${path.sep}worktrees${path.sep}`;
  const markerAt = checkoutRoot.indexOf(marker);
  return markerAt === -1 ? checkoutRoot : checkoutRoot.slice(0, markerAt);
}

const realDeps = (): ClaudeAccountsDeps => {
  const homeDir = homedir();
  return {
    homeDir,
    registryPath: path.join(homeDir, ".claude-accounts", "registry.json"),
    now: () => new Date(),
    out: (line) => console.log(line),
    err: (line) => console.error(line),
    prompt: async (question, defaultValue) => {
      const reader = createInterface({ input: process.stdin, output: process.stdout });
      try {
        const answer = (await reader.question(`${question}${defaultValue ? ` [${defaultValue}]` : ""}: `)).trim();
        return answer || defaultValue;
      } finally {
        reader.close();
      }
    },
    stdinIsTTY: process.stdin.isTTY === true,
    readRegistry: readAccountRegistry,
    authStatus: (configDir, cwd) => runAuthStatus(configDir, { ...(cwd === undefined ? {} : { cwd }) }),
    login: (configDir, email) => runClaudeLogin(configDir, email),
    profile: async (configDir) => readProfile(configDir, { fetch }),
    usage: async (configDir) => readUsage(configDir, { fetch }),
    codexAuth: readCodexAuth,
    codexDoctor: runCodexDoctor,
    codexConfigSource: path.join(homeDir, ".codex", "config.toml"),
    repoRoot: primaryRepoRoot(path.resolve(import.meta.dirname, "..")),
  };
};

function depsWith(overrides: Partial<ClaudeAccountsDeps>): ClaudeAccountsDeps {
  const base = realDeps();
  return { ...base, ...overrides };
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function claudeEnvironment(configDir: string, parentEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(parentEnv).filter(([name]) =>
    !name.startsWith("ANTHROPIC_") &&
    !name.startsWith("CLAUDE_") &&
    name !== "CLAUDECODE"
  ));
  return { ...env, CLAUDE_CONFIG_DIR: configDir };
}

function codexDoctorEnvironment(stateDir: string, parentEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  // Keep routing variables visible: doctor is the check that must expose an
  // inherited CODEX_SQLITE_HOME so the caller can refuse it.
  return { ...parentEnv, CODEX_HOME: stateDir };
}

function sameDirectory(left: string, right: string): boolean {
  if (path.resolve(left) === path.resolve(right)) return true;
  if (!existsSync(left) || !existsSync(right)) return false;
  try {
    return realpathSync(left) === realpathSync(right);
  } catch {
    return false;
  }
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
    cwd?: string;
    runner?: (
      command: string,
      args: string[],
      options: { encoding: "utf8"; env: NodeJS.ProcessEnv; cwd?: string },
    ) => { error?: Error; status: number | null; stdout: string };
  } = {},
): AuthStatusReading {
  const runner = options.runner ?? spawnSync;
  const parentEnv = options.env ?? process.env;
  const result = runner(options.command ?? "claude", [...(options.commandArgsPrefix ?? []), "auth", "status", "--json"], {
    encoding: "utf8",
    env: claudeEnvironment(configDir, parentEnv),
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
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
    const authMethod = parsed["authMethod"];
    const apiProvider = parsed["apiProvider"];
    return {
      kind: "value",
      loggedIn: parsed["loggedIn"],
      email: typeof email === "string" ? email : null,
      authMethod: typeof authMethod === "string" ? authMethod : null,
      apiProvider: typeof apiProvider === "string" ? apiProvider : null,
    };
  } catch {
    return { kind: "unknown", why: "claude auth status returned malformed JSON" };
  }
}

function doctorDetail(details: Record<string, unknown>, ...names: string[]): string | null {
  for (const name of names) {
    const value = details[name];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function doctorDetails(value: unknown): Record<string, unknown> | null {
  const mapped = object(value);
  if (mapped !== null) return mapped;
  if (!Array.isArray(value) || value.some((line) => typeof line !== "string")) return null;
  const details: Record<string, unknown> = {};
  for (const line of value as string[]) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    details[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return details;
}

function doctorCheckOk(check: Record<string, unknown>): boolean {
  if (typeof check.ok === "boolean") return check.ok;
  return typeof check.status === "string" && ["ok", "pass", "passed", "success"].includes(check.status.toLowerCase());
}

/** Parse the two doctor checks that establish effective state and auth paths. */
export function parseCodexDoctor(input: unknown): CodexDoctorReading {
  const root = object(input);
  const checks = object(root?.checks);
  const config = object(checks?.["config.load"]);
  const auth = object(checks?.["auth.credentials"]);
  const configDetails = doctorDetails(config?.details);
  const authDetails = doctorDetails(auth?.details);
  if (!config || !configDetails || !doctorCheckOk(config)) {
    return { kind: "unknown", why: "codex doctor config.load did not return a successful details object" };
  }
  if (!auth || !authDetails) {
    return { kind: "unknown", why: "codex doctor auth.credentials did not return a details object" };
  }
  const codexHome = doctorDetail(configDetails, "CODEX_HOME", "codex_home", "codex home");
  const sqliteHome = doctorDetail(configDetails, "sqlite home", "sqlite_home", "sqliteHome");
  const modelProvider = doctorDetail(configDetails, "model provider", "model_provider", "modelProvider");
  const authFile = doctorDetail(authDetails, "auth file", "auth_file", "authFile");
  const authStorageMode = doctorDetail(
    authDetails,
    "auth storage mode",
    "storage mode",
    "storage_mode",
    "authStorageMode",
  );
  if (!codexHome || !sqliteHome || !modelProvider || !authFile || !authStorageMode) {
    return { kind: "unknown", why: "codex doctor omitted required config or auth path details" };
  }
  return {
    kind: "value",
    codexHome,
    sqliteHome,
    modelProvider,
    authFile,
    authStorageMode,
    authOk: doctorCheckOk(auth),
  };
}

/** Run Codex's read-only doctor under exactly one state directory. */
export function runCodexDoctor(
  stateDir: string,
  options: {
    env?: NodeJS.ProcessEnv;
    command?: string;
    runner?: (
      command: string,
      args: string[],
      options: { encoding: "utf8"; env: NodeJS.ProcessEnv },
    ) => { error?: Error; status: number | null; stdout: string };
  } = {},
): CodexDoctorReading {
  const runner = options.runner ?? spawnSync;
  const result = runner(options.command ?? "codex", ["doctor", "--json"], {
    encoding: "utf8",
    env: codexDoctorEnvironment(stateDir, options.env ?? process.env),
  });
  if (result.error) return { kind: "unknown", why: `could not run codex doctor: ${result.error.message}` };
  try {
    return parseCodexDoctor(JSON.parse(String(result.stdout)) as unknown);
  } catch {
    return {
      kind: "unknown",
      why: `codex doctor${result.status === 0 ? "" : ` exited ${result.status ?? "without a status"} and`} returned malformed JSON`,
    };
  }
}

/** Start Claude's own interactive browser login without passing through a shell. */
export function runClaudeLogin(
  configDir: string,
  email: string,
  options: {
    env?: NodeJS.ProcessEnv;
    command?: string;
    runner?: (
      command: string,
      args: string[],
      options: { env: NodeJS.ProcessEnv; stdio: "inherit" },
    ) => { error?: Error; status: number | null };
  } = {},
): LoginResult {
  const runner = options.runner ?? spawnSync;
  const result = runner(
    options.command ?? "claude",
    ["auth", "login", "--claudeai", "--email", email],
    { env: claudeEnvironment(configDir, options.env ?? process.env), stdio: "inherit" },
  );
  if (result.error) return { ok: false, why: `could not run claude auth login: ${result.error.message}` };
  if (result.status !== 0) return { ok: false, why: `claude auth login exited ${result.status ?? "without a status"}` };
  return { ok: true };
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
  desiredSessions: string;
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
    return { ok: false, why: `${projectsLink} exists and is not the shared projects symlink` };
  }
  const current = path.resolve(path.dirname(projectsLink), readlinkSync(projectsLink));
  if (!existsSync(projectsLink)) {
    return { ok: false, why: `${projectsLink} is a dangling symlink` };
  }
  return current === path.resolve(desiredProjects)
    ? { ok: true, projects: { kind: "already" } }
    : { ok: false, why: `${projectsLink} points to ${current}, not ${desiredProjects}` };
}

function inspectSessionsShare(link: string, desired: string): { ok: true } | { ok: false; why: string } {
  let info: ReturnType<typeof lstatSync> | null = null;
  try {
    info = lstatSync(link);
  } catch {
    return { ok: true };
  }
  if (info.isDirectory() && !info.isSymbolicLink()) return { ok: true };
  if (!info.isSymbolicLink()) return { ok: false, why: `${link} exists and is not a directory or symlink` };
  const current = path.resolve(path.dirname(link), readlinkSync(link));
  if (!existsSync(link)) {
    return { ok: false, why: `${link} is a dangling sessions symlink to ${current}; expected ${desired}` };
  }
  return current === path.resolve(desired)
    ? { ok: true }
    : { ok: false, why: `${link} points to ${current}, not shared sessions ${desired}` };
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
  return sameDirectory(configDir, path.join(home, ".claude"))
    ? path.join(home, ".claude.json")
    : path.join(configDir, ".claude.json");
}

function prepareSeed(targetDir: string, options: SeedOptions = {}): SeedPlan | { why: string } {
  const defaultConfigDir = options.defaultConfigDir ?? path.join(homedir(), ".claude");
  if (sameDirectory(targetDir, defaultConfigDir)) return { why: "refusing to seed the default config directory into itself" };
  if (!existsSync(targetDir)) return { why: `${targetDir} does not exist; log in under that config directory before seeding it` };

  const desiredProjects = path.join(defaultConfigDir, "projects");
  // The shared peer registry and agents listing — see applySessionsShare.
  const desiredSessions = path.join(defaultConfigDir, "sessions");
  const projectsLink = path.join(targetDir, "projects");
  const projects = inspectProjectsShare(projectsLink, desiredProjects, targetDir, options);
  if (!projects.ok) return { why: projects.why };
  const sessionsLink = path.join(targetDir, "sessions");
  const sessions = inspectSessionsShare(sessionsLink, desiredSessions);
  if (!sessions.ok) return { why: sessions.why };

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
    claudeChanged ? `merged named seed keys into ${claudePath}` : `${claudePath} already carries every seeded value`,
    settingsChanged ? `merged model, permissions, autoMode and env defaults into ${settingsPath}` : `${settingsPath} already carries every seeded value`,
    copyPlugins
      ? `copied ${pluginsSource} -> ${pluginsTarget} because the target was absent`
      : existsSync(pluginsTarget)
        ? `${pluginsTarget} already exists`
        : `source ${pluginsSource} is absent; ${pluginsTarget} was skipped`,
    projects.projects.kind === "already"
      ? `${projectsLink} already links to ${desiredProjects}`
      : projects.projects.kind === "migrate"
        ? `migrated ${projectsLink}, retained ${projects.projects.backup}, and linked it -> ${desiredProjects}`
        : `linked ${projectsLink} -> ${desiredProjects}`,
    `sentry and vercel are not seeded in ${targetDir}; run /mcp under this account directory to log in if they are needed`,
  ];
  return {
    targetDir,
    projectsLink,
    desiredProjects,
    desiredSessions,
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

/**
 * Share `sessions/` the way `projects/` is shared, and for a bigger reason than
 * it looks.
 *
 * **`<config dir>/sessions/<pid>.json` is two things at once**: the listing
 * behind `claude agents --json`, and the peer registry behind `SendMessage` /
 * `ListAgents` — it carries `name`, `messagingSocketPath` and `sessionId`. The
 * sockets themselves already live in the shared `/run/user/1000/cc-socks/`;
 * only this listing is per config directory. Measured 2026-09-10: a config dir
 * whose `sessions/` was symlinked to the default's listed **all ten** ambient
 * agents by name, while the pool account's own dir listed two. Unshared, every
 * pool session showed as `running-but-unlisted` in the register **and could not
 * message the Overseer at all** — which for a dispatched agent whose job ends
 * in a debrief is close to fatal.
 *
 * **Why sharing is safe here when sharing memory would not be**: these files
 * are pid-keyed, and pids are unique on a box, so each has exactly one writer.
 * The record also carries `procStart` and `pidDomain`, so the CLI disambiguates
 * pid reuse itself. That is the opposite of `MEMORY.md`, where many writers
 * share one path — the distinction that matters, and one this plan got
 * backwards at first.
 *
 * **Deliberately simpler than the `projects/` migration**, which hashes a
 * manifest and records resumable state because transcripts and auto-memory are
 * irreplaceable. A session record is rewritten by its live process within about
 * a minute — measured, mtimes 40 minutes after start — so losing one costs
 * nothing. The copy exists only so a *running* session does not blink out of
 * `ls` between the swap and its next write; the original is retained rather
 * than deleted for the same reason.
 */
function applySessionsShare(plan: SeedPlan): boolean {
  const link = path.join(plan.targetDir, "sessions");
  const shared = plan.desiredSessions;
  let info: ReturnType<typeof lstatSync> | null = null;
  try {
    info = lstatSync(link);
  } catch {
    info = null;
  }
  if (info?.isSymbolicLink()) return false;
  mkdirSync(shared, { recursive: true, mode: 0o700 });
  if (info?.isDirectory()) {
    // Copy first, swap second: a live session's only record is in here.
    for (const entry of readdirSync(link)) {
      const destination = path.join(shared, entry);
      if (!existsSync(destination)) copyFileSync(path.join(link, entry), destination);
    }
    const stamp = plan.now().toISOString().replace(/[:.]/g, "-");
    renameSync(link, path.join(plan.targetDir, `sessions.retained-${stamp}`));
  }
  symlinkSync(shared, link);
  return true;
}

function applySeed(plan: SeedPlan): Extract<SeedResult, { ok: true }> {
  const sessionsChanged = applySessionsShare(plan);
  const sessionsLink = path.join(plan.targetDir, "sessions");
  if (sessionsChanged) plan.messages.push(`shared ${sessionsLink} -> ${plan.desiredSessions} so this account's sessions are listed and reachable`);
  else plan.messages.push(`${sessionsLink} already shares sessions -> ${plan.desiredSessions}`);
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
    changed: plan.claudeChanged || plan.settingsChanged || plan.copyPlugins || projectsChanged || sessionsChanged,
    messages: plan.messages,
  };
}

/** Surgical, idempotent seeding. Exported so refusal paths can be tested without a real account. */
export function seedClaudeConfig(targetDir: string, options: SeedOptions = {}): SeedResult {
  const prepared = prepareSeed(targetDir, options);
  if ("why" in prepared) return { ok: false, why: prepared.why };
  return applySeed(prepared);
}

function parseTomlFile(file: string, required: boolean): { ok: true; value: Record<string, unknown>; text: string | null } | { ok: false; why: string } {
  if (!existsSync(file)) {
    return required ? { ok: false, why: `${file} does not exist` } : { ok: true, value: {}, text: null };
  }
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return { ok: false, why: `could not read ${file}` };
  }
  try {
    const parsed = object(parseToml(text));
    return parsed === null
      ? { ok: false, why: `${file} is not a TOML table` }
      : { ok: true, value: parsed, text };
  } catch (error) {
    return { ok: false, why: `${file} is not valid TOML: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function tomlText(value: Record<string, unknown>): string {
  const text = stringifyToml(value);
  return text.endsWith("\n") ? text : `${text}\n`;
}

function seedCodexConfig(targetDir: string, deps: ClaudeAccountsDeps): SeedResult {
  const source = parseTomlFile(deps.codexConfigSource, false);
  if (!source.ok) return source;
  const targetPath = path.join(targetDir, "config.toml");
  const target = parseTomlFile(targetPath, false);
  if (!target.ok) return target;

  const after: Record<string, unknown> = { ...target.value };
  for (const key of ["model", "model_reasoning_effort", "approvals_reviewer"] as const) {
    const value = source.value[key];
    if (value === undefined) continue;
    if (typeof value !== "string") {
      return { ok: false, why: `${deps.codexConfigSource} ${key} must be a string before it can be seeded` };
    }
    after[key] = value;
  }
  // Merged, not replaced. A pool home's config.toml is a file a person may
  // have added a trust entry to by hand, and `add` is idempotent precisely so
  // it can be re-run — re-running it must not quietly delete their entry.
  // Only the repo root is *added*; the ambient config's own project entries are
  // still never copied, which is what this seed is careful about.
  const priorProjects = object(target.value.projects) ?? {};
  after.projects = { ...priorProjects, [deps.repoRoot]: { trust_level: "trusted" } };
  const desired = tomlText(after);
  const changed = desired !== (target.text ?? "");
  if (changed) writeFileAtomic(targetPath, desired, 0o600);

  // Codex silently ignores unknown config keys. Reading the effective paths
  // back through doctor proves the seed loaded, rather than merely that bytes
  // were written to a plausible-looking file.
  const doctor = deps.codexDoctor(targetDir);
  if (doctor.kind === "unknown") return { ok: false, why: `codex doctor could not verify the seed: ${doctor.why}` };
  if (doctor.codexHome !== targetDir) {
    return { ok: false, why: `codex doctor read back CODEX_HOME ${doctor.codexHome}, not ${targetDir}` };
  }
  return {
    ok: true,
    changed,
    messages: [
      changed ? `wrote ${targetPath} and doctor read it back from ${targetDir}` : `${targetPath} already matches and doctor read it back`,
      "plugins are per-home and are not copied; this account has none",
    ],
  };
}

function writeFileAtomic(file: string, text: string, mode: number): void {
  const temporary = `${file}.tmp-${process.pid}`;
  writeFileSync(temporary, text, { mode });
  chmodSync(temporary, mode);
  renameSync(temporary, file);
}

function assertIdentity(entry: Pick<AccountEntry, "stateDir" | "displayEmail">, deps: ClaudeAccountsDeps): { ok: true; found: string } | { ok: false; why: string } {
  if (!entry.displayEmail) return { ok: false, why: `${entry.stateDir}: Claude account has no displayEmail` };
  const status = deps.authStatus(entry.stateDir);
  if (status.kind === "unknown") return { ok: false, why: `${entry.stateDir}: ${status.why}` };
  if (!status.loggedIn) return { ok: false, why: `${entry.stateDir}: claude auth status reports loggedIn: false` };
  return {
    ok: true,
    found: status.email ?? "no local email (live profile establishes identity)",
  };
}

function profileIdentityFailure(account: AccountEntry, profile: ProfileReading): string | null {
  if (profile.kind === "unknown") return `live profile is unknown: ${profile.why}`;
  if (profile.accountUuid !== account.providerAccountId || profile.orgId !== account.providerTenantId) {
    return "live profile does not match the registry pin";
  }
  if (account.displayEmail && profile.email !== account.displayEmail) {
    return "live profile email does not match the registry";
  }
  return null;
}

function codexTenantId(identity: CodexIdentity): { ok: true; tenantId: string | null } | { ok: false; why: string } {
  if (identity.workspaces.length === 0) return { ok: true, tenantId: null };
  if (identity.workspaces.length === 1) return { ok: true, tenantId: identity.workspaces[0]!.id };
  const defaults = identity.workspaces.filter((workspace) => workspace.isDefault);
  if (defaults.length === 1) return { ok: true, tenantId: defaults[0]!.id };
  return {
    ok: false,
    why: "the credential's workspaces are ambiguous; choose exactly one default workspace in ChatGPT, refresh the credential, and rerun",
  };
}

function codexIdentityFailure(account: AccountEntry, reading: CodexAuthReading): string | null {
  if (reading.kind === "unknown") return `local auth identity is unknown: ${reading.why}`;
  if (reading.identity.accountId !== account.providerAccountId) return "local auth identity does not match the registry pin";
  const tenant = codexTenantId(reading.identity);
  if (!tenant.ok) return tenant.why;
  if (tenant.tenantId !== account.providerTenantId) return "local auth workspace does not match the registry pin";
  return null;
}

function pathIsInside(parent: string, child: string): boolean {
  if (!path.isAbsolute(child)) return false;
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function codexDoctorFailure(account: AccountEntry, reading: CodexDoctorReading): string | null {
  if (reading.kind === "unknown") return reading.why;
  if (reading.codexHome !== account.stateDir) {
    return `codex doctor reports CODEX_HOME ${reading.codexHome}, not registry stateDir ${account.stateDir}`;
  }
  if (!pathIsInside(account.stateDir, reading.sqliteHome)) {
    return `codex doctor reports sqlite home ${reading.sqliteHome} outside ${account.stateDir}; unset inherited CODEX_SQLITE_HOME`;
  }
  if (reading.modelProvider !== "openai") {
    return `codex doctor reports model provider ${reading.modelProvider}, not openai`;
  }
  const expectedAuthFile = path.join(account.stateDir, "auth.json");
  if (reading.authFile !== expectedAuthFile) {
    return `codex doctor reports auth file ${reading.authFile}, not ${expectedAuthFile}`;
  }
  if (reading.authStorageMode.toLowerCase() !== "file") {
    return `codex doctor reports auth storage ${reading.authStorageMode}, not File`;
  }
  if (!reading.authOk) return "codex doctor reports that auth credentials are not usable";

  const config = parseTomlFile(path.join(account.stateDir, "config.toml"), false);
  if (!config.ok) return config.why;
  for (const key of ["chatgpt_base_url", "openai_base_url", "model_providers", "profile"] as const) {
    if (Object.hasOwn(config.value, key)) {
      return `config.toml ${key} can redirect a pinned account and is not allowed`;
    }
  }
  if (
    Object.hasOwn(config.value, "forced_login_method") &&
    config.value.forced_login_method !== "chatgpt"
  ) {
    return "config.toml forced_login_method must be chatgpt when present";
  }
  if (Object.hasOwn(config.value, "forced_chatgpt_workspace_id")) {
    const forced = config.value.forced_chatgpt_workspace_id;
    if (typeof forced !== "string" || forced !== account.providerTenantId) {
      return `config.toml forced_chatgpt_workspace_id disagrees with registry providerTenantId ${account.providerTenantId ?? "null"}`;
    }
  }
  return null;
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
    if (flag === "--seed" || flag === "--live-usage" || flag === "--yes") {
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
  /** A reservation must survive --wait, but an abandoned one must not count forever. */
  activeUntil?: string;
  outcome: "reserved" | "started" | "completed" | "failed";
}

const RESERVATION_START_GRACE_MS = 15 * 60_000;
const STARTED_EXPIRY_MS = 7 * 24 * 60 * 60_000;
const LEGACY_ACTIVE_EXPIRY_MS = 31 * 24 * 60 * 60_000;

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
        (value["activeUntil"] === undefined || typeof value["activeUntil"] === "string") &&
        (value["outcome"] === "reserved" || value["outcome"] === "started" || value["outcome"] === "completed" || value["outcome"] === "failed")
      ) {
        records.push({
          schema: 1,
          accountName: value["accountName"],
          providerAccountId: value["providerAccountId"],
          sessionUuid: value["sessionUuid"],
          launchName: value["launchName"],
          createdAt: value["createdAt"],
          ...(typeof value["activeUntil"] === "string" ? { activeUntil: value["activeUntil"] } : {}),
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

function windowPercent(reading: unknown, targetWindow: "five_hour" | "seven_day"): number | null {
  if (Array.isArray(reading)) {
    for (const value of reading) {
      const found = windowPercent(value, targetWindow);
      if (found !== null) return found;
    }
    return null;
  }
  const value = object(reading);
  if (!value) return null;
  if (value["window"] === targetWindow && value["kind"] === "value" && typeof value["utilizationPercent"] === "number") {
    return value["utilizationPercent"];
  }
  const direct = object(value[targetWindow]);
  if (direct && (direct["kind"] === "value" || direct["kind"] === "current")) {
    const number = direct["utilizationPercent"] ?? direct["percentage"];
    if (typeof number === "number") return number;
  }
  for (const child of Object.values(value)) {
    const found = windowPercent(child, targetWindow);
    if (found !== null) return found;
  }
  return null;
}

function weeklyPercent(reading: unknown): number | null {
  return windowPercent(reading, "seven_day");
}

function chooseAuto(
  accounts: AccountEntry[],
  usage: Map<string, number | null>,
  launches: LaunchRecord[],
  nowMs: number,
): { account: AccountEntry; reason: string } {
  const last = new Map<string, number>();
  const latestBySession = new Map<string, LaunchRecord>();
  for (const launch of launches) {
    const at = Date.parse(launch.createdAt);
    if (launch.outcome === "reserved" && Number.isFinite(at)) {
      last.set(launch.accountName, Math.max(last.get(launch.accountName) ?? 0, at));
    }
    latestBySession.set(launch.sessionUuid, launch);
  }
  const active = new Map<string, number>();
  for (const record of latestBySession.values()) {
    const createdAt = Date.parse(record.createdAt);
    const activeUntil = record.activeUntil === undefined
      ? createdAt + LEGACY_ACTIVE_EXPIRY_MS
      : Date.parse(record.activeUntil);
    if (
      (record.outcome === "reserved" || record.outcome === "started") &&
      Number.isFinite(activeUntil) &&
      activeUntil > nowMs
    ) {
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
      // At equal recency an unknown reading sorts after a known one. It still
      // cannot starve: once the known account is reserved, active load and
      // least-recently-reserved both put the unknown account first.
      if (aUsage === null && bUsage !== null) return 1;
      if (aUsage !== null && bUsage === null) return -1;
    }
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
    ? `all pool seven-day readings were unknown; chose the least recently reserved account${reservation}`
    : percent === null
      ? `chose the least recently reserved account whose live seven-day reading is unknown so it can be sampled${reservation}`
      : `chose the lowest live seven-day utilization (${percent}%)${tied ? "; the tie was broken by least recently reserved" : ""}${reservation}`;
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

function reservation(
  account: AccountEntry | null,
  sessionUuid: string,
  launchName: string,
  at: Date,
  waitSeconds: number,
): LaunchRecord {
  return {
    schema: 1,
    accountName: account?.name ?? "ambient",
    providerAccountId: account?.providerAccountId ?? null,
    sessionUuid,
    launchName,
    createdAt: at.toISOString(),
    activeUntil: new Date(at.getTime() + waitSeconds * 1000 + RESERVATION_START_GRACE_MS).toISOString(),
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
  appendReservation(accountDir, {
    ...prior,
    createdAt: at.toISOString(),
    activeUntil: new Date(at.getTime() + (outcome === "started" ? STARTED_EXPIRY_MS : 0)).toISOString(),
    outcome,
  });
  return true;
}

/** Resolve and reserve on the box, where the registry and usage credentials live. */
export async function resolveForLaunch(
  requested: string,
  sessionUuid: string,
  overrides: Partial<ClaudeAccountsDeps> = {},
  launchName = sessionUuid,
  waitSeconds = 0,
): Promise<LaunchResolution> {
  const deps = depsWith(overrides);
  const reading = await deps.readRegistry(deps.registryPath);
  if (reading.kind === "error") return { ok: false, why: reading.why };
  const defaultStateDir = path.resolve(deps.homeDir, ".claude");
  if (requested !== "auto") {
    const resolved = resolveAccount(reading, requested);
    if (resolved.kind === "refused") return { ok: false, why: resolved.why };
    if (resolved.account.family !== "claude") {
      return {
        ok: false,
        why: `${resolved.account.name} is a Codex account; new-codex launching is deferred to Stage 2`,
      };
    }
    if (resolved.account.role === "orchestrator") {
      return {
        ok: false,
        why: `${resolved.account.name} is the orchestrator account; the ambient Claude login cannot be routed by setting CLAUDE_CONFIG_DIR`,
      };
    }
    if (path.resolve(resolved.account.stateDir) === defaultStateDir) {
      return { ok: false, why: `${resolved.account.name} points at the default .claude directory, which cannot be routed explicitly` };
    }
    const dir = path.dirname(deps.registryPath);
    return withLaunchLock(dir, deps.now, async () => {
      appendReservation(dir, reservation(resolved.account, sessionUuid, launchName, deps.now(), waitSeconds));
      return {
        ok: true,
        account: resolved.account,
        resolvedName: resolved.account.name,
        reason: `explicitly requested ${requested}`,
      };
    });
  }
  const accounts = poolAccounts(reading);
  const defaultPool = accounts.find((account) => sameDirectory(account.stateDir, defaultStateDir));
  if (defaultPool) {
    return { ok: false, why: `${defaultPool.name} points at the default .claude directory, which cannot be routed explicitly` };
  }
  if (accounts.length === 0) {
    const dir = path.dirname(deps.registryPath);
    return withLaunchLock(dir, deps.now, async () => {
      appendReservation(dir, reservation(null, sessionUuid, launchName, deps.now(), waitSeconds));
      return {
        ok: true,
        account: null,
        resolvedName: "ambient",
        reason: reading.kind === "ambient"
          ? "no account registry is configured; using the ambient Claude account"
          : "no Claude pool accounts are configured; using the ambient Claude account",
      };
    });
  }
  // Live reads do not belong under the reservation lock. They can take up to
  // their transport timeout, while the lock's only atomic unit is the final
  // read-ledger / choose / append-reservation sequence.
  const usage = new Map<string, number | null>();
  const exhausted = new Set<string>();
  let identityFailure: string | null = null;
  await Promise.all(accounts.map(async (account) => {
    try {
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
      const fiveHour = windowPercent(reading, "five_hour");
      const sevenDay = weeklyPercent(reading);
      if ((fiveHour !== null && fiveHour >= 100) || (sevenDay !== null && sevenDay >= 100)) {
        exhausted.add(account.name);
        return;
      }
      usage.set(account.name, sevenDay);
    } catch {
      usage.set(account.name, null);
    }
  }));
  if (identityFailure) return { ok: false, why: identityFailure };
  const eligibleAccounts = accounts.filter((account) => !exhausted.has(account.name));
  if (eligibleAccounts.length === 0) {
    return { ok: false, why: "all configured Claude pool accounts have a known exhausted five-hour or seven-day window" };
  }
  const dir = path.dirname(deps.registryPath);
  return withLaunchLock(dir, deps.now, async () => {
    const ledgerPath = path.join(dir, "reservations.ndjson");
    const now = deps.now();
    const chosen = chooseAuto([...eligibleAccounts], usage, readLaunches(ledgerPath), now.getTime());
    appendReservation(dir, reservation(chosen.account, sessionUuid, launchName, now, waitSeconds));
    return { ok: true, ...chosen, resolvedName: chosen.account.name };
  });
}

async function listOrCheck(
  command: "list" | "check",
  deps: ClaudeAccountsDeps,
  checkLiveUsage = false,
): Promise<number> {
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
    if (account.family === "codex") {
      const existsFailure = command === "check" && !existsSync(account.stateDir)
        ? `${account.stateDir} does not exist`
        : null;
      const auth = existsFailure === null ? await deps.codexAuth(account.stateDir) : null;
      const authFailure = auth === null ? existsFailure : codexIdentityFailure(account, auth);
      const doctorFailure = command === "check" && authFailure === null
        ? codexDoctorFailure(account, deps.codexDoctor(account.stateDir))
        : null;
      const identityFailure = authFailure ?? doctorFailure;
      if (identityFailure !== null) failed = true;
      if (command === "check") {
        deps.out(identityFailure === null
          ? `${account.name}: local auth identity and codex doctor paths match`
          : `${account.name}: FAILED ${identityFailure}`);
      } else {
        const planType = auth?.kind === "value" ? auth.identity.planType : null;
        deps.out(
          `${account.name} family=${account.family} role=${account.role} stateDir=${account.stateDir} expected=${account.displayEmail ?? "(none)"} ` +
            `${identityFailure === null ? "local-auth=matches" : `FAILED=${identityFailure}`} plan=${planType ?? "unknown"}`,
        );
      }
      continue;
    }
    const localIdentity = assertIdentity(account, deps);
    const profile = localIdentity.ok ? await deps.profile(account.stateDir) : null;
    const profileFailure = profile === null ? null : profileIdentityFailure(account, profile);
    const identityFailure = localIdentity.ok ? profileFailure : localIdentity.why;
    if (identityFailure !== null) failed = true;
    if (command === "check") {
      let usageFailure: string | null = null;
      if (identityFailure === null && checkLiveUsage) {
        const usage = await deps.usage(account.stateDir);
        const value = object(usage);
        const identity = object(value?.["identity"]);
        if (value?.["kind"] !== "value") {
          usageFailure = typeof value?.["why"] === "string" ? value["why"] : "live usage is unknown";
        } else if (
          identity?.["providerAccountId"] !== account.providerAccountId ||
          identity["providerTenantId"] !== account.providerTenantId
        ) {
          usageFailure = "live usage identity does not match the registry pin";
        }
        if (usageFailure !== null) failed = true;
      }
      deps.out(identityFailure !== null
        ? `${account.name}: FAILED ${identityFailure}`
        : usageFailure !== null
          ? `${account.name}: live usage FAILED ${usageFailure}`
          : `${account.name}: live profile identity matches${checkLiveUsage ? "; live usage endpoint answered" : ""}`);
      continue;
    }
    const weekly = identityFailure === null ? weeklyPercent(await deps.usage(account.stateDir)) : null;
    deps.out(
      `${account.name} family=${account.family} role=${account.role} stateDir=${account.stateDir} expected=${account.displayEmail ?? "(none)"} ` +
        `${identityFailure === null ? "live-profile=matches" : `FAILED=${identityFailure}`} seven-day=${weekly === null ? "unknown" : `${weekly}%`}`,
    );
  }
  return failed ? 1 : 0;
}

async function verifyForLaunch(
  name: string,
  deps: ClaudeAccountsDeps,
  cwd?: string,
): Promise<{ ok: true; warning?: string } | { ok: false; why: string }> {
  const reading = await deps.readRegistry(deps.registryPath);
  const resolved = resolveAccount(reading, name);
  if (resolved.kind === "refused") return { ok: false, why: resolved.why };
  const account = resolved.account;
  if (!existsSync(account.stateDir)) return { ok: false, why: `${account.stateDir} does not exist` };
  if (account.family === "codex") {
    if (sameDirectory(account.stateDir, path.join(deps.homeDir, ".codex"))) {
      return { ok: false, why: "the default .codex directory cannot be a routed registry account" };
    }
    const identityFailure = codexIdentityFailure(account, await deps.codexAuth(account.stateDir));
    if (identityFailure !== null) return { ok: false, why: identityFailure };
    const doctorFailure = codexDoctorFailure(account, deps.codexDoctor(account.stateDir));
    return doctorFailure === null ? { ok: true } : { ok: false, why: doctorFailure };
  }
  const defaultStateDir = path.join(deps.homeDir, ".claude");
  if (sameDirectory(account.stateDir, defaultStateDir)) {
    return { ok: false, why: "the default .claude directory cannot be a routed registry account" };
  }
  const projects = inspectProjectsShare(
    path.join(account.stateDir, "projects"),
    path.join(defaultStateDir, "projects"),
    account.stateDir,
    { isConfigDirInUse: () => false },
  );
  if (!projects.ok || projects.projects.kind !== "already") {
    return { ok: false, why: projects.ok ? "projects is not linked to the shared tree" : projects.why };
  }
  const settings = parseJsonObject(path.join(account.stateDir, "settings.json"), false);
  if (!settings.ok) return { ok: false, why: settings.why };
  const settingsEnv = object(settings.value.env);
  if (settings.value.env !== undefined && settingsEnv === null) {
    return { ok: false, why: `${account.stateDir}/settings.json env is not an object` };
  }
  const providerOverride = Object.keys(settingsEnv ?? {}).find((variable) =>
    variable.startsWith("ANTHROPIC_") ||
    variable === "CLAUDE_CODE_OAUTH_TOKEN" ||
    variable === "CLAUDE_CODE_USE_BEDROCK" ||
    variable === "CLAUDE_CODE_USE_VERTEX" ||
    variable === "CLAUDE_CODE_USE_FOUNDRY" ||
    variable === "CLAUDE_CONFIG_DIR"
  );
  if (providerOverride) {
    return { ok: false, why: `${account.stateDir}/settings.json env contains ${providerOverride}, which can override account routing` };
  }
  const status = deps.authStatus(account.stateDir, cwd);
  if (status.kind === "unknown") return { ok: false, why: `effective auth status is unknown: ${status.why}` };
  if (!status.loggedIn) return { ok: false, why: "effective auth status reports loggedIn: false" };
  if (status.authMethod !== "claude.ai" || status.apiProvider !== "firstParty") {
    return {
      ok: false,
      why: `effective auth is ${status.authMethod ?? "unknown"} via ${status.apiProvider ?? "unknown"}, not claude.ai via firstParty`,
    };
  }
  const profile = await deps.profile(account.stateDir);
  if (profile.kind === "unknown") {
    // Access tokens expire within hours. When the CLI still sees the registered
    // first-party login, let Claude perform its own normal refresh on startup;
    // we never read or use the refresh token. Every other profile fault refuses.
    if (profile.status === 401) {
      return {
        ok: true,
        warning: `expired access token for ${name}; allowing Claude's first-party login to refresh it on startup (this verifier did not use the refresh token)`,
      };
    }
    return { ok: false, why: profile.why };
  }
  const profileFailure = profileIdentityFailure(account, profile);
  if (profileFailure !== null) return { ok: false, why: profileFailure };
  return { ok: true };
}

interface AddAnswers {
  name: string;
  configDir: string;
  email?: string;
  role: "pool" | "orchestrator";
  family: "claude" | "codex";
  seed: boolean;
}

function nextPoolName(accounts: AccountEntry[]): string {
  const names = new Set(accounts.map((account) => account.name));
  for (let suffix = 1; ; suffix += 1) {
    const candidate = `pool${suffix}`;
    if (!names.has(candidate)) return candidate;
  }
}

function validAccountName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,40}$/.test(name) && name !== "auto" && name !== "ambient";
}

async function answer(
  parsed: ParsedArgs,
  deps: ClaudeAccountsDeps,
  canPrompt: boolean,
  flagName: string,
  question: string,
  defaultValue: string,
): Promise<string> {
  const supplied = flag(parsed, flagName);
  if (supplied !== undefined) return supplied;
  if (parsed.flags.has("--yes") || !canPrompt) return defaultValue;
  const value = (await deps.prompt(question, defaultValue)).trim();
  return value || defaultValue;
}

async function collectAddAnswers(
  parsed: ParsedArgs,
  deps: ClaudeAccountsDeps,
  accounts: AccountEntry[],
  canPrompt: boolean,
): Promise<AddAnswers | { why: string }> {
  const family = await answer(parsed, deps, canPrompt, "--family", "Family", "claude");
  if (family !== "claude" && family !== "codex") {
    return { why: `--family must be claude or codex, not ${JSON.stringify(family)}` };
  }
  if (family === "codex" && parsed.flags.has("--email")) {
    return { why: "--email cannot be used with --family codex; the email is read from the credential" };
  }
  const wizard = ["--name", "--role", "--config-dir", ...(family === "claude" ? ["--email"] : [])]
    .some((name) => !parsed.flags.has(name));
  const name = await answer(parsed, deps, canPrompt, "--name", "Account name", nextPoolName(accounts));
  if (!validAccountName(name)) {
    return { why: "--name must contain only lower-case letters, digits and hyphens (max 41), and cannot be auto or ambient" };
  }
  const prior = accounts.find((account) => account.name === name);
  if (prior !== undefined && prior.family !== family) {
    return { why: `account ${name} is already registered as family ${prior.family}; its family cannot be changed` };
  }
  let email: string | undefined;
  if (family === "claude") {
    email = await answer(parsed, deps, canPrompt, "--email", "Email", prior?.displayEmail ?? "");
    if (!email) {
      return { why: "--email has no default for a new account; supply --email or run add from a terminal" };
    }
  }
  const role = await answer(parsed, deps, canPrompt, "--role", "Role", prior?.role ?? "pool");
  const configDir = await answer(
    parsed,
    deps,
    canPrompt,
    "--config-dir",
    "Config directory",
    prior?.stateDir ?? path.join(deps.homeDir, `.${family}-${name}`),
  );
  if (role !== "pool" && role !== "orchestrator") return { why: `unknown role ${role}` };
  return {
    name,
    configDir,
    ...(email === undefined ? {} : { email }),
    role,
    family,
    seed: parsed.flags.has("--seed") || wizard,
  };
}

function ensureStateDirectory(configDir: string, deps: ClaudeAccountsDeps): { ok: true } | { ok: false; why: string } {
  if (existsSync(configDir)) {
    const info = lstatSync(configDir);
    if (!info.isDirectory()) return { ok: false, why: `${configDir} exists and is not a directory` };
    deps.out(`found: config directory ${configDir}`);
  } else {
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
    deps.out(`changed: created config directory ${configDir}`);
  }
  return { ok: true };
}

function ensureConfigDirectory(configDir: string, deps: ClaudeAccountsDeps): { ok: true } | { ok: false; why: string } {
  const directory = ensureStateDirectory(configDir, deps);
  if (!directory.ok) return directory;
  const settingsPath = path.join(configDir, "settings.json");
  const settings = parseJsonObject(settingsPath, false);
  if (!settings.ok) return { ok: false, why: settings.why };
  if (settings.value.forceLoginMethod === "claudeai") {
    deps.out(`found: settings ${settingsPath} already has forceLoginMethod=claudeai`);
    return { ok: true };
  }
  writeJsonAtomic(settingsPath, { ...settings.value, forceLoginMethod: "claudeai" });
  deps.out(
    `${settings.text === null ? "changed: created" : "changed: updated"} settings ${settingsPath} with forceLoginMethod=claudeai`,
  );
  return { ok: true };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function loginRecovery(configDir: string): string {
  return `run env CLAUDE_CONFIG_DIR=${shellQuote(configDir)} claude auth logout, then rerun this command`;
}

async function establishProfile(
  configDir: string,
  email: string,
  deps: ClaudeAccountsDeps,
): Promise<Extract<ProfileReading, { kind: "value" }> | null> {
  const before = await deps.profile(configDir);
  if (before.kind === "value") {
    if (before.email !== email) {
      deps.err(`refused: login under ${configDir}; live profile is ${before.email}, not expected ${email}; credential was not replaced`);
      return null;
    }
    deps.out(`skipped: login under ${configDir}; live profile already matches ${email}`);
    return before;
  }

  const credentialPath = path.join(configDir, ".credentials.json");
  const status = deps.authStatus(configDir);
  if (existsSync(credentialPath) || (status.kind === "value" && status.loggedIn)) {
    deps.err(
      `refused: login under ${configDir}; a credential is present but its identity is unavailable (${before.why}); ` +
        `it was not replaced — recovery: ${loginRecovery(configDir)}`,
    );
    return null;
  }
  if (status.kind === "unknown") {
    deps.err(`refused: login under ${configDir}; could not prove the account is logged out (${status.why}); credential was not replaced`);
    return null;
  }
  if (!deps.stdinIsTTY) {
    deps.err(`refused: login under ${configDir} needs a terminal; rerun this command from a TTY`);
    return null;
  }

  deps.out(`found: logged out under ${configDir} with no credential; offering login for ${email}`);
  const login = deps.login(configDir, email);
  if (!login.ok) {
    deps.err(`refused: login under ${configDir} failed: ${login.why}`);
    return null;
  }
  const after = await deps.profile(configDir);
  if (after.kind === "unknown") {
    deps.err(`refused: login completed but profile identity is unavailable (${after.why}); registry was not changed`);
    return null;
  }
  if (after.email !== email) {
    deps.err(`refused: login completed as ${after.email}, not expected ${email}; registry was not changed`);
    return null;
  }
  deps.out(`changed: login established live profile ${email} under ${configDir}`);
  return after;
}

function seedMessageKind(message: string): "changed" | "found" | "skipped" {
  if (/^(merged|copied|linked|migrated|shared|wrote)/.test(message)) return "changed";
  if (/^(sentry and vercel|source |plugins are per-home)/.test(message)) return "skipped";
  return "found";
}


async function addCodex(
  answers: AddAnswers,
  existing: { accounts: AccountEntry[] },
  deps: ClaudeAccountsDeps,
): Promise<number> {
  const { name, configDir, role } = answers;
  const configured = ensureStateDirectory(configDir, deps);
  if (!configured.ok) {
    deps.err(`refused: config setup failed: ${configured.why}`);
    return 1;
  }

  const seeded = seedCodexConfig(configDir, deps);
  if (!seeded.ok) {
    deps.err(`refused: seed failed: ${seeded.why}; registry was not changed`);
    return 1;
  }
  for (const message of seeded.messages) deps.out(`${seedMessageKind(message)}: seed ${message}`);
  if (!seeded.changed) deps.out("found: seed nothing to change");

  const auth = await deps.codexAuth(configDir);
  if (auth.kind === "unknown") {
    // On the reason, never on the wording of `why`. Offering a login over a
    // credential that exists but will not parse is how a live credential gets
    // rotated out from under running work.
    if (auth.reason === "missing") {
      deps.err(`refused: ${auth.why}; directory prepared; registry unchanged`);
      deps.out(`next: CODEX_HOME=${shellQuote(configDir)} codex login`);
    } else {
      deps.err(`refused: credential under ${configDir} is present but unreadable (${auth.why}); registry was not changed`);
    }
    return 1;
  }
  const tenant = codexTenantId(auth.identity);
  if (!tenant.ok) {
    deps.err(`refused: ${tenant.why}; registry was not changed`);
    return 1;
  }
  deps.out(`found: Codex accountId=${auth.identity.accountId} workspace=${tenant.tenantId ?? "none"}`);

  const priorIndex = existing.accounts.findIndex((account) => account.name === name);
  const prior = priorIndex >= 0 ? existing.accounts[priorIndex] : undefined;
  if (
    prior &&
    (prior.providerAccountId !== auth.identity.accountId || prior.providerTenantId !== tenant.tenantId)
  ) {
    deps.err(`FATAL: ${name} is pinned to a different provider account or workspace; registry was not changed`);
    return 1;
  }
  const next: AccountEntry = {
    name,
    family: "codex",
    role,
    stateDir: configDir,
    providerAccountId: auth.identity.accountId,
    providerTenantId: tenant.tenantId,
    ...(auth.identity.email === null ? {} : { displayEmail: auth.identity.email }),
    addedAt: prior?.addedAt ?? deps.now().toISOString(),
    familyData: {
      planType: auth.identity.planType,
      chatgptUserId: auth.identity.chatgptUserId,
      workspaces: auth.identity.workspaces,
    },
  };
  const doctorFailure = codexDoctorFailure(next, deps.codexDoctor(configDir));
  if (doctorFailure !== null) {
    deps.err(`refused: codex doctor could not verify the routed account: ${doctorFailure}; registry was not changed`);
    return 1;
  }
  const accounts = [...existing.accounts];
  if (priorIndex >= 0) accounts[priorIndex] = next;
  else accounts.push(next);
  const proposed = parseAccountRegistry({ schema: 1, accounts });
  if (proposed.kind === "error") {
    deps.err(`refused: the proposed registry is invalid: ${proposed.why}; registry was not changed`);
    return 1;
  }
  const changed = !prior || JSON.stringify(prior) !== JSON.stringify(next);
  if (changed) {
    writeRegistry(deps.registryPath, accounts);
    deps.out(`changed: ${prior ? "updated" : "added"} registry entry ${name} in ${deps.registryPath}`);
  } else {
    deps.out(`found: registry entry ${name} in ${deps.registryPath} already matches; nothing to change`);
  }
  deps.out("found: final account list");
  return listOrCheck("list", deps);
}

async function add(parsed: ParsedArgs, deps: ClaudeAccountsDeps, canPrompt: boolean): Promise<number> {
  const allowed = new Set(["--name", "--config-dir", "--email", "--role", "--family", "--seed", "--yes"]);
  for (const key of parsed.flags.keys()) {
    if (!allowed.has(key)) {
      deps.err(`FATAL: unknown add flag ${key}`);
      return 2;
    }
  }
  const reading = await deps.readRegistry(deps.registryPath);
  const existing = registryAccounts(reading);
  if (!existing.ok) {
    deps.err(`refused: account registry is invalid: ${existing.why}`);
    return 1;
  }
  const answers = await collectAddAnswers(parsed, deps, existing.accounts, canPrompt);
  if ("why" in answers) {
    deps.err(`FATAL: ${answers.why}`);
    return 2;
  }
  const { name, configDir, email, role, family } = answers;
  if (role === "orchestrator") {
    deps.err(`FATAL: the ambient ${family === "claude" ? "Claude" : "Codex"} orchestrator cannot be registered with --config-dir; register pool accounts only`);
    return 2;
  }
  if (!path.isAbsolute(configDir) || configDir.endsWith(path.sep)) {
    deps.err("FATAL: --config-dir must be an absolute path without a trailing slash");
    return 2;
  }
  const defaultDirName = family === "claude" ? ".claude" : ".codex";
  if (sameDirectory(configDir, path.join(deps.homeDir, defaultDirName))) {
    deps.err(`FATAL: the default ${defaultDirName} directory cannot be registered as a routed account`);
    return 2;
  }
  if (answers.seed && role !== "pool") {
    deps.err("FATAL: --seed applies only to a pool config directory");
    return 2;
  }

  if (family === "codex") return addCodex(answers, existing, deps);
  if (!email) {
    deps.err("FATAL: --email is required for --family claude");
    return 2;
  }

  const configured = ensureConfigDirectory(configDir, deps);
  if (!configured.ok) {
    deps.err(`refused: config setup failed: ${configured.why}`);
    return 1;
  }
  const profile = await establishProfile(configDir, email, deps);
  if (profile === null) return 1;
  deps.out(`found: profile accountUuid=${profile.accountUuid} orgId=${profile.orgId}`);

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
    family,
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
    deps.err(`refused: the proposed registry is invalid: ${proposed.why}; registry was not changed`);
    return 1;
  }

  let seedPlan: SeedPlan | null = null;
  if (answers.seed) {
    const prepared = prepareSeed(configDir, { defaultConfigDir: path.join(deps.homeDir, ".claude"), now: deps.now });
    if ("why" in prepared) {
      deps.err(`refused: seed preflight failed: ${prepared.why}; registry was not changed`);
      return 1;
    }
    seedPlan = prepared;
  }
  if (seedPlan) {
    // Apply only after every identity and registry refusal has passed. Seeding
    // mutates transcript/plugin/seed state, so a request that cannot be
    // registered must be refused before this point.
    const seeded = applySeed(seedPlan);
    for (const message of seeded.messages) deps.out(`${seedMessageKind(message)}: seed ${message}`);
    if (!seeded.changed) deps.out("found: seed nothing to change");
  }
  const changed = !prior || JSON.stringify(prior) !== JSON.stringify(next);
  if (changed) {
    writeRegistry(deps.registryPath, accounts);
    deps.out(`changed: ${prior ? "updated" : "added"} registry entry ${name} in ${deps.registryPath}`);
  } else {
    deps.out(`found: registry entry ${name} in ${deps.registryPath} already matches; nothing to change`);
  }
  deps.out("found: final account list");
  return listOrCheck("list", deps);
}

/**
 * What `--help` prints.
 *
 * It exists because the first version had none, and the two things a person
 * actually types — `claude-accounts --help` and `add --help` — answered
 * `FATAL: unknown command --help` and `FATAL: --help needs a value`. The second
 * is the worse one: it reads as though `--help` were a real flag whose argument
 * you forgot, so the obvious next guess is to invent one.
 *
 * Every question the wizard asks is listed with its flag, because that is the
 * contract that lets the tests and the web flow drive the same code path — a
 * flag nobody can discover is a code path nobody can automate.
 */
const HELP = `claude-accounts — the box's Claude and Codex account registry

  add [flags]        add or update an account; with no flags it asks
  list               every registered account, who is signed in, and live usage
  check [--live-usage]   assert every account; non-zero if any fails
  resolve --account <name|auto> --launch-name <n> [--session-uuid <u>]
  verify --account <name> [--cwd <dir>]
  outcome --session-uuid <u> --value <started|completed|failed>

add flags — each one is a question it would otherwise ask:

  --name <name>          the handle, e.g. pool2
  --family <claude|codex>   default: claude; asked first
  --role <pool|orchestrator>   default: pool
  --email <address>      Claude only; Codex reads it from auth.json
  --config-dir <path>    the account's state directory (default: ~/.claude-<name> or ~/.codex-<name>)
                         used as CLAUDE_CONFIG_DIR / CODEX_HOME
  --seed                 seed the account state dir (implied in wizard mode)
  --yes                  accept every default; ask nothing

Claude login is skipped when the account is already signed in as that email.
Codex prepares its home but never logs in: run the printed CODEX_HOME=… codex
login command by hand, then rerun add. An unreadable credential is never replaced.`;

function wantsHelp(argv: readonly string[]): boolean {
  return argv.some((arg) => arg === "--help" || arg === "-h" || arg === "help");
}

export async function main(argv: readonly string[], overrides: Partial<ClaudeAccountsDeps> = {}): Promise<number> {
  const deps = depsWith(overrides);
  // Before parsing, so `add --help` is help rather than a flag missing a value.
  if (argv.length === 0 || wantsHelp(argv)) {
    deps.out(HELP);
    return 0;
  }
  const parsed = parseArgs(argv);
  if ("why" in parsed) {
    deps.err(`FATAL: ${parsed.why}`);
    return 2;
  }
  if (parsed.command === "list" || parsed.command === "check") {
    const liveUsage = parsed.flags.has("--live-usage");
    if (parsed.command === "list" ? parsed.flags.size > 0 : parsed.flags.size > (liveUsage ? 1 : 0)) {
      deps.err(`FATAL: ${parsed.command}${parsed.command === "check" ? " takes only --live-usage" : " takes no flags"}`);
      return 2;
    }
    return listOrCheck(parsed.command, deps, liveUsage);
  }
  if (parsed.command === "add") {
    const canPrompt = overrides.stdinIsTTY ?? (overrides.prompt !== undefined || deps.stdinIsTTY);
    return add(parsed, deps, canPrompt);
  }
  if (parsed.command === "verify") {
    const allowed = new Set(["--account", "--cwd"]);
    if ([...parsed.flags.keys()].some((key) => !allowed.has(key)) || !parsed.flags.has("--account")) {
      deps.err("FATAL: verify requires --account and optionally --cwd");
      return 2;
    }
    const name = flag(parsed, "--account");
    if (!name) return 2;
    const cwd = flag(parsed, "--cwd");
    if (cwd !== undefined && (!path.isAbsolute(cwd) || path.resolve(cwd) !== cwd)) {
      deps.err("FATAL: verify --cwd must be an absolute, already-normalised path");
      return 2;
    }
    const result = await verifyForLaunch(name, deps, cwd);
    if (!result.ok) {
      deps.err(`FATAL: ${result.why}`);
      return 1;
    }
    if (result.warning) deps.err(`WARNING: ${result.warning}`);
    return 0;
  }
  if (parsed.command === "resolve") {
    const allowed = new Set(["--account", "--launch-name", "--session-uuid", "--wait-seconds"]);
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
    const waitSecondsText = flag(parsed, "--wait-seconds") ?? "0";
    const waitSeconds = Number(waitSecondsText);
    if (!Number.isSafeInteger(waitSeconds) || waitSeconds < 0 || waitSeconds > 30 * 24 * 60 * 60) {
      deps.err("FATAL: --wait-seconds must be a whole number from 0 through 2592000");
      return 2;
    }
    const resolved = await resolveForLaunch(account, sessionUuid, deps, launchName, waitSeconds);
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
    const accountDir = path.dirname(deps.registryPath);
    const recorded = await withLaunchLock(accountDir, deps.now, async () =>
      recordLaunchOutcome(accountDir, sessionUuid, outcome, deps.now())
    );
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
