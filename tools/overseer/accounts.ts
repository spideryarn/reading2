/**
 * The account registry and Claude account probes.
 *
 * TESTABILITY SPLIT. Registry validation and response parsing are pure and live
 * above the I/O boundary. `readAccountRegistry`, `readProfile`, and `readUsage`
 * are the functions below that touch the filesystem or transport. Nothing at
 * module scope performs I/O, and live HTTP is always supplied by the caller.
 *
 * A failure is data, not an exception across this module's boundary. In
 * particular, a missing registry is the explicitly typed ambient state while a
 * malformed registry is an error; callers cannot accidentally treat the two as
 * the same fallback.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { parseUsageWindow, type UsageWindowReading } from "./usage.js";

export type AccountFamily = "claude" | "codex";
export type AccountRole = "orchestrator" | "pool";

export type AccountEntry = {
  name: string;
  family: AccountFamily;
  role: AccountRole;
  stateDir: string;
  providerAccountId: string;
  providerTenantId: string;
  displayEmail?: string;
  addedAt: string;
  familyData: Record<string, unknown>;
};

export type AccountRegistry = {
  schema: 1;
  accounts: AccountEntry[];
};

export type RegistryReading =
  | { kind: "ambient"; accounts: [] }
  | ({ kind: "value" } & AccountRegistry)
  | { kind: "error"; why: string };

export type AccountResolution =
  | { kind: "value"; account: AccountEntry }
  | { kind: "refused"; why: string };

export type AccountProfileReading =
  | {
      kind: "value";
      configDir: string;
      takenAt: string;
      accountUuid: string;
      email: string;
      orgId: string;
    }
  | { kind: "unknown"; configDir: string; takenAt: string; why: string };

export type AccountUsageReading =
  | {
      kind: "value";
      configDir: string;
      takenAt: string;
      identity: LiveUsageIdentity;
      windows: UsageWindowReading[];
    }
  | { kind: "unknown"; configDir: string; takenAt: string; why: string };

export type LiveUsageIdentity = Pick<
  AccountEntry,
  "providerAccountId" | "providerTenantId" | "displayEmail"
>;

export type LiveUsageParseResult =
  | { kind: "value"; takenAt: string; identity: LiveUsageIdentity; windows: UsageWindowReading[] }
  | { kind: "unknown"; takenAt: string; why: string };

export type AccountHttpDeps = {
  /** Required rather than defaulted, so a test cannot accidentally reach a live credential endpoint. */
  fetch: typeof fetch;
  /** A pinned observation time for tests; production callers normally omit it. */
  now?: () => number;
};

const PROFILE_URL = "https://api.anthropic.com/api/oauth/profile";
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const USER_AGENT = "spideryarn-claude-accounts/1";

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonBlankString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseRegistryEntry(value: unknown, index: number): AccountEntry | { why: string } {
  const entry = object(value);
  if (entry === null) return { why: `accounts[${index}] must be an object` };

  const required = [
    "name",
    "family",
    "role",
    "stateDir",
    "providerAccountId",
    "providerTenantId",
    "addedAt",
  ] as const;
  for (const field of required) {
    if (nonBlankString(entry[field]) === null) return { why: `accounts[${index}].${field} is required and must be a non-empty string` };
  }

  const family = entry.family;
  if (family !== "claude" && family !== "codex") {
    return { why: `accounts[${index}].family must be "claude" or "codex"` };
  }
  const role = entry.role;
  if (role !== "orchestrator" && role !== "pool") {
    return { why: `accounts[${index}].role must be "orchestrator" or "pool"` };
  }
  const stateDir = entry.stateDir as string;
  if (!path.isAbsolute(stateDir)) return { why: `accounts[${index}].stateDir must be absolute` };
  if (stateDir.endsWith("/")) return { why: `accounts[${index}].stateDir must not have a trailing slash` };
  if (entry.displayEmail !== undefined && nonBlankString(entry.displayEmail) === null) {
    return { why: `accounts[${index}].displayEmail must be a non-empty string when present` };
  }
  const familyData = object(entry.familyData);
  if (familyData === null) return { why: `accounts[${index}].familyData is required and must be an object` };

  return {
    name: entry.name as string,
    family,
    role,
    stateDir,
    providerAccountId: entry.providerAccountId as string,
    providerTenantId: entry.providerTenantId as string,
    ...(entry.displayEmail === undefined ? {} : { displayEmail: entry.displayEmail as string }),
    addedAt: entry.addedAt as string,
    familyData,
  };
}

/** Parse already-loaded JSON (or its source text) without touching the filesystem. */
export function parseAccountRegistry(input: unknown): RegistryReading {
  let parsed = input;
  if (typeof input === "string") {
    try {
      parsed = JSON.parse(input) as unknown;
    } catch {
      return { kind: "error", why: "registry.json is not valid JSON" };
    }
  }

  const root = object(parsed);
  if (root === null) return { kind: "error", why: "registry.json must contain an object" };
  if (root.schema !== 1) return { kind: "error", why: "unknown registry schema" };
  if (!Array.isArray(root.accounts)) return { kind: "error", why: "registry.json accounts is required and must be an array" };

  const accounts: AccountEntry[] = [];
  const names = new Set<string>();
  const orchestrators = new Map<AccountFamily, number>();
  const stateDirs = new Set<string>();
  const providerAccountIds = new Set<string>();
  for (let index = 0; index < root.accounts.length; index += 1) {
    const result = parseRegistryEntry(root.accounts[index], index);
    if ("why" in result) return { kind: "error", why: result.why };
    if (names.has(result.name)) return { kind: "error", why: `duplicate account name ${JSON.stringify(result.name)}` };
    names.add(result.name);
    const canonicalStateDir = path.resolve(result.stateDir);
    if (stateDirs.has(canonicalStateDir)) {
      return { kind: "error", why: `duplicate stateDir ${JSON.stringify(result.stateDir)}` };
    }
    if (providerAccountIds.has(result.providerAccountId)) {
      return { kind: "error", why: `duplicate providerAccountId ${JSON.stringify(result.providerAccountId)}` };
    }
    stateDirs.add(canonicalStateDir);
    providerAccountIds.add(result.providerAccountId);
    if (result.role === "orchestrator") {
      orchestrators.set(result.family, (orchestrators.get(result.family) ?? 0) + 1);
    }
    accounts.push(result);
  }
  for (const [family, count] of orchestrators) {
    if (count > 1) {
      return { kind: "error", why: `registry has ${count} ${family} orchestrator accounts; at most one per family is allowed` };
    }
  }

  return { kind: "value", schema: 1, accounts };
}

export function resolveAccount(registry: RegistryReading, name: string): AccountResolution {
  if (registry.kind === "error") return { kind: "refused", why: `account registry is invalid: ${registry.why}` };
  if (registry.kind === "ambient") {
    return { kind: "refused", why: `account ${JSON.stringify(name)} is not registered; no registry file exists` };
  }
  const account = registry.accounts.find((candidate) => candidate.name === name);
  return account === undefined
    ? { kind: "refused", why: `account ${JSON.stringify(name)} is not registered` }
    : { kind: "value", account };
}

/** Only dispatchable pool entries. The orchestrator cannot enter this result. */
export function poolAccounts(registry: RegistryReading, family: AccountFamily = "claude"): AccountEntry[] {
  return registry.kind === "value"
    ? registry.accounts.filter((account) => account.role === "pool" && account.family === family)
    : [];
}

function profileFromJson(value: unknown): { accountUuid: string; email: string; orgId: string } | null {
  const root = object(value);
  if (root === null) return null;
  const account = object(root.account);
  const organization = object(root.organization);
  const accountUuid = nonBlankString(root.accountUuid) ?? nonBlankString(account?.uuid);
  const email = nonBlankString(root.email) ?? nonBlankString(account?.email) ?? nonBlankString(account?.email_address);
  const orgId = nonBlankString(root.orgId) ?? nonBlankString(root.organization_uuid) ?? nonBlankString(organization?.uuid);
  return accountUuid !== null && email !== null && orgId !== null ? { accountUuid, email, orgId } : null;
}

/**
 * Is this value one of the utilization windows, rather than some other field?
 *
 * **Identified positively, and that matters.** The first version of this did the
 * opposite — it named the known non-window keys (`limits`, `extra_usage`) and
 * treated everything else as a window. Measured against the live endpoint on
 * 2026-09-10, that response also carries `spend` (an object that is not a
 * window), `seven_day_breakdown`, and `member_dashboard_available` — **a bool**.
 * A single unrecognised scalar made the whole body "malformed", so every
 * account read `unknown`, so `auto` fell back to least-recently-launched
 * forever. The ranking was inert and nothing said so.
 *
 * An exclusion list has to be updated whenever the API grows a field; this asks
 * what a window actually looks like, so a new field is ignored rather than
 * fatal. Rotating codename windows still match, because they carry the same
 * shape — which is what keeps rule 6 of usage-history.md ("an unrecognised
 * window is a named row") working.
 */
/**
 * `extra_usage` is the reason this needs BOTH a name exclusion and a shape
 * test, rather than either alone. It carries a `utilization` field of its own —
 * so it passes the shape test — but it is a credit balance, not a rolling
 * window, and plotting it beside `seven_day` would be a category error. The
 * shape test alone let it through; the name list alone let `spend` and
 * `member_dashboard_available` break the whole read.
 */
const NON_WINDOW_KEYS = new Set(["limits", "extra_usage"]);

function isUsageWindow(name: string, value: unknown): boolean {
  if (NON_WINDOW_KEYS.has(name)) return false;
  const window = object(value);
  return window !== null && (Object.hasOwn(window, "utilization") || Object.hasOwn(window, "resets_at"));
}

function usageBodyIsStructurallyValid(body: Record<string, unknown>): boolean {
  // At least one of the two windows every account has — their presence is what
  // makes this a usage response rather than some other JSON. Not *both*: the
  // API deciding to stop sending one should degrade that window to unknown, not
  // discard the reading we did get. Anything else in the body is the API's
  // business, per isUsageWindow.
  let recognised = 0;
  for (const name of ["five_hour", "seven_day"]) {
    if (!Object.hasOwn(body, name)) continue;
    const value = body[name];
    if (value !== null && object(value) === null) return false;
    recognised += 1;
  }
  return recognised > 0;
}

export function parseLiveUsageResponse(
  body: unknown,
  envelope: { takenAt: string; identity: LiveUsageIdentity },
): LiveUsageParseResult {
  const parsed = object(body);
  if (parsed === null || !usageBodyIsStructurallyValid(parsed)) {
    return { kind: "unknown", takenAt: envelope.takenAt, why: "usage response was malformed" };
  }
  const nowMs = Date.parse(envelope.takenAt);
  if (!Number.isFinite(nowMs)) {
    return { kind: "unknown", takenAt: envelope.takenAt, why: "observation time was malformed" };
  }
  const windows: UsageWindowReading[] = [];
  for (const [window, raw] of Object.entries(parsed)) {
    // A null window is "this account has no such limit", not a reading of zero
    // — usage-history.md rule 1, absence is never a zero. Non-window fields
    // (`limits`, `extra_usage`, `spend`, `member_dashboard_available`, …) are
    // skipped by shape rather than by name; see isUsageWindow.
    if (raw === null || raw === undefined || !isUsageWindow(window, raw)) continue;
    windows.push(parseUsageWindow(window, raw, nowMs));
  }
  return { kind: "value", takenAt: envelope.takenAt, identity: envelope.identity, windows };
}

function redactCredentialFromWindow(window: UsageWindowReading, token: string): UsageWindowReading {
  const redact = (value: string): string => value.replaceAll(token, "[credential redacted]");
  if (window.kind === "value") return { ...window, window: redact(window.window), resetsAt: redact(window.resetsAt) };
  if (window.kind === "expired") {
    return { ...window, window: redact(window.window), resetsAt: redact(window.resetsAt), why: redact(window.why) };
  }
  return { ...window, window: redact(window.window), why: redact(window.why) };
}

function unknownProfile(configDir: string, takenAt: string, why: string): AccountProfileReading {
  return { kind: "unknown", configDir, takenAt, why };
}

function unknownUsage(configDir: string, takenAt: string, why: string): AccountUsageReading {
  return { kind: "unknown", configDir, takenAt, why };
}

function observationTime(deps: AccountHttpDeps): { nowMs: number; takenAt: string } {
  const nowMs = deps.now?.() ?? Date.now();
  return { nowMs, takenAt: new Date(nowMs).toISOString() };
}

async function accessToken(configDir: string): Promise<string | null> {
  try {
    const credentials = object(JSON.parse(await readFile(path.join(configDir, ".credentials.json"), "utf8")) as unknown);
    return nonBlankString(object(credentials?.claudeAiOauth)?.accessToken);
  } catch {
    return null;
  }
}

function requestInit(token: string): RequestInit {
  return {
    method: "GET",
    redirect: "error",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "anthropic-beta": "oauth-2025-04-20",
      "User-Agent": USER_AGENT,
    },
  };
}

// ---------------------------------------------------------------------------
// I/O boundary. These functions read files and/or use the injected transport.
// ---------------------------------------------------------------------------

export function defaultAccountRegistryPath(): string {
  return path.join(homedir(), ".claude-accounts", "registry.json");
}

/** Read and validate the registry. ENOENT alone means today's ambient behaviour. */
export async function readAccountRegistry(registryPath = defaultAccountRegistryPath()): Promise<RegistryReading> {
  try {
    return parseAccountRegistry(await readFile(registryPath, "utf8"));
  } catch (error) {
    if (object(error)?.code === "ENOENT") return { kind: "ambient", accounts: [] };
    return { kind: "error", why: `could not read account registry at ${registryPath}` };
  }
}

export async function readProfile(configDir: string, deps: AccountHttpDeps): Promise<AccountProfileReading> {
  const { takenAt } = observationTime(deps);
  const token = await accessToken(configDir);
  if (token === null) return unknownProfile(configDir, takenAt, "access token is unavailable");

  try {
    const response = await deps.fetch(PROFILE_URL, requestInit(token));
    // Access tokens expire within hours. A 401 (and every other failure) is
    // unknown. Never use claudeAiOauth.refreshToken and never rewrite the
    // credentials file: rotation racing a live session could invalidate the
    // login for the whole fleet.
    if (!response.ok) return unknownProfile(configDir, takenAt, `profile request failed with HTTP ${response.status}`);
    const profile = profileFromJson(await response.json());
    return profile === null || Object.values(profile).some((field) => field.includes(token))
      ? unknownProfile(configDir, takenAt, "profile response was malformed")
      : { kind: "value", configDir, takenAt, ...profile };
  } catch {
    // Do not surface transport errors: an injected/client error can contain the
    // Authorization header, and no credential value may enter output or logs.
    return unknownProfile(configDir, takenAt, "profile request failed");
  }
}

export async function readUsage(configDir: string, deps: AccountHttpDeps): Promise<AccountUsageReading> {
  const { takenAt } = observationTime(deps);
  const token = await accessToken(configDir);
  if (token === null) return unknownUsage(configDir, takenAt, "access token is unavailable");

  try {
    // One credential snapshot for both calls. Re-reading .credentials.json
    // between them can join a rotated token's usage to the previous token's
    // identity, which is precisely the ambiguity this live read exists to
    // remove.
    const profileResponse = await deps.fetch(PROFILE_URL, requestInit(token));
    if (!profileResponse.ok) {
      return unknownUsage(configDir, takenAt, `profile request failed with HTTP ${profileResponse.status}`);
    }
    const profile = profileFromJson(await profileResponse.json());
    if (profile === null || Object.values(profile).some((field) => field.includes(token))) {
      return unknownUsage(configDir, takenAt, "profile response was malformed");
    }
    const response = await deps.fetch(USAGE_URL, requestInit(token));
    // See readProfile: refreshing here could invalidate a credential used by
    // live sessions, so an expired token remains an honest unknown reading.
    if (!response.ok) return unknownUsage(configDir, takenAt, `usage request failed with HTTP ${response.status}`);
    const parsed = parseLiveUsageResponse(await response.json(), {
      takenAt,
      identity: {
        providerAccountId: profile.accountUuid,
        providerTenantId: profile.orgId,
        displayEmail: profile.email,
      },
    });
    return parsed.kind === "value"
      ? {
          ...parsed,
          configDir,
          windows: parsed.windows.map((window) => redactCredentialFromWindow(window, token)),
        }
      : unknownUsage(configDir, takenAt, parsed.why);
  } catch {
    return unknownUsage(configDir, takenAt, "usage request failed");
  }
}
