/**
 * Strict, local identity parsing for one Codex home.
 *
 * Parsing is pure above the I/O boundary. A malformed or missing credential is
 * typed data rather than an exception, so callers cannot mistake unreadable
 * identity for a logged-out account that is safe to replace.
 *
 * **The id_token's signature is not verified, and "strict" above does not mean
 * it is.** This answers *which account is this file for*, never *is this file
 * genuine* — it reads a credential that is already on disk at mode 0600, so a
 * forged one would mean the machine was already lost. What actually proves the
 * credential is a 401 from the API, and an unauthenticated `CODEX_HOME` 401s
 * rather than falling back to the ambient login (measured 2026-09-10, 0.153.4 —
 * docs/reusable/codex-subscriptions.md). Do not let a later reader upgrade this
 * into an authenticity check it never performed.
 *
 * What the strictness *is* for: the two fields that name the account,
 * `tokens.account_id` and the id_token's `chatgpt_account_id`, must agree. That
 * is corroboration between two independent places in one file, which catches a
 * half-written or hand-edited credential — not a forgery.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

export type CodexWorkspace = {
  id: string;
  isDefault: boolean;
  title: string | null;
  role: string | null;
};

export type CodexIdentity = {
  accountId: string;
  email: string | null;
  planType: string | null;
  chatgptUserId: string | null;
  workspaces: CodexWorkspace[];
  expiresAt: string | null;
};

export type CodexAuthReading =
  | { kind: "value"; stateDir: string; identity: CodexIdentity }
  | { kind: "unknown"; stateDir: string; reason: CodexAuthFailure; why: string };

/**
 * Why the identity could not be read — as a value, because one caller branches
 * on it and prose is not a control-flow contract.
 *
 * `add` offers "run `codex login`" for `missing` and refuses without offering it
 * for everything else, because offering a login over a credential that exists
 * but will not parse is how you rotate a credential live work depends on. That
 * decision used to be made by matching the words in `why`, so rewording an
 * error message silently moved it — and the test asserted the same string the
 * code grepped for, which meant the test agreed no matter which was wrong.
 */
export type CodexAuthFailure = "missing" | "unreadable" | "malformed";

const AUTH_CLAIM = "https://api.openai.com/auth";

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonBlankString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function optionalString(
  value: unknown,
  field: string,
): { ok: true; value: string | null } | { ok: false; why: string } {
  if (value === undefined || value === null) return { ok: true, value: null };
  return typeof value === "string"
    ? { ok: true, value }
    : { ok: false, why: `${field} must be a string or null when present` };
}

function decodePayload(idToken: string): { ok: true; payload: Record<string, unknown> } | { ok: false; why: string } {
  const segments = idToken.split(".");
  if (segments.length !== 3) return { ok: false, why: "tokens.id_token must contain exactly three segments" };
  const encoded = segments[1]!;
  // Buffer's base64url decoder silently ignores characters outside the
  // alphabet. Reject a non-canonical segment before it can become plausible
  // JSON and pass an identity check it did not actually encode.
  if (!/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length % 4 === 1) {
    return { ok: false, why: "tokens.id_token payload is not valid base64url" };
  }
  try {
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.toString("base64url") !== encoded) {
      return { ok: false, why: "tokens.id_token payload is not canonical base64url" };
    }
    const payload = object(JSON.parse(bytes.toString("utf8")) as unknown);
    return payload === null
      ? { ok: false, why: "tokens.id_token payload must be a JSON object" }
      : { ok: true, payload };
  } catch {
    return { ok: false, why: "tokens.id_token payload is not decodable JSON" };
  }
}

function parseWorkspaces(value: unknown): { ok: true; workspaces: CodexWorkspace[] } | { ok: false; why: string } {
  if (value === undefined) return { ok: true, workspaces: [] };
  if (!Array.isArray(value)) return { ok: false, why: `${AUTH_CLAIM}.organizations must be an array when present` };
  const workspaces: CodexWorkspace[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const raw = object(value[index]);
    if (raw === null) return { ok: false, why: `${AUTH_CLAIM}.organizations[${index}] must be an object` };
    const id = nonBlankString(raw.id);
    if (id === null) return { ok: false, why: `${AUTH_CLAIM}.organizations[${index}].id must be a non-empty string` };
    if (raw.is_default !== undefined && typeof raw.is_default !== "boolean") {
      return { ok: false, why: `${AUTH_CLAIM}.organizations[${index}].is_default must be a boolean when present` };
    }
    const title = optionalString(raw.title, `${AUTH_CLAIM}.organizations[${index}].title`);
    if (!title.ok) return title;
    const role = optionalString(raw.role, `${AUTH_CLAIM}.organizations[${index}].role`);
    if (!role.ok) return role;
    workspaces.push({ id, isDefault: raw.is_default === true, title: title.value, role: role.value });
  }
  return { ok: true, workspaces };
}

/** Parse an already-loaded auth.json value without touching the filesystem. */
export function parseCodexAuth(input: unknown, stateDir: string): CodexAuthReading {
  const unknown = (why: string): CodexAuthReading => ({ kind: "unknown", stateDir, reason: "malformed", why });
  const root = object(input);
  if (root === null) return unknown("auth.json must contain an object");
  if (root.auth_mode !== "chatgpt") {
    return unknown(`auth.json auth_mode is ${JSON.stringify(root.auth_mode ?? null)}, not "chatgpt"`);
  }
  const tokens = object(root.tokens);
  if (tokens === null) return unknown("auth.json tokens must be an object");
  const accountId = nonBlankString(tokens.account_id);
  if (accountId === null) return unknown("auth.json tokens.account_id must be a non-empty string");
  const idToken = nonBlankString(tokens.id_token);
  if (idToken === null) return unknown("auth.json tokens.id_token must be a non-empty string");
  const decoded = decodePayload(idToken);
  if (!decoded.ok) return unknown(decoded.why);
  const auth = object(decoded.payload[AUTH_CLAIM]);
  if (auth === null) return unknown(`tokens.id_token ${AUTH_CLAIM} claim must be an object`);
  const corroboratingId = nonBlankString(auth.chatgpt_account_id);
  if (corroboratingId === null) {
    return unknown(`tokens.id_token ${AUTH_CLAIM}.chatgpt_account_id must be a non-empty string`);
  }
  if (corroboratingId !== accountId) {
    return unknown("tokens.account_id does not match the id_token chatgpt_account_id");
  }

  const email = optionalString(decoded.payload.email, "tokens.id_token email");
  if (!email.ok) return unknown(email.why);
  const planType = optionalString(auth.chatgpt_plan_type, `${AUTH_CLAIM}.chatgpt_plan_type`);
  if (!planType.ok) return unknown(planType.why);
  const chatgptUserId = optionalString(auth.chatgpt_user_id, `${AUTH_CLAIM}.chatgpt_user_id`);
  if (!chatgptUserId.ok) return unknown(chatgptUserId.why);
  const workspaces = parseWorkspaces(auth.organizations);
  if (!workspaces.ok) return unknown(workspaces.why);

  let expiresAt: string | null = null;
  if (decoded.payload.exp !== undefined && decoded.payload.exp !== null) {
    if (typeof decoded.payload.exp !== "number" || !Number.isFinite(decoded.payload.exp)) {
      return unknown("tokens.id_token exp must be a finite number when present");
    }
    try {
      expiresAt = new Date(decoded.payload.exp * 1000).toISOString();
    } catch {
      return unknown("tokens.id_token exp is outside the supported date range");
    }
  }

  return {
    kind: "value",
    stateDir,
    identity: {
      accountId,
      email: email.value,
      planType: planType.value,
      chatgptUserId: chatgptUserId.value,
      workspaces: workspaces.workspaces,
      expiresAt,
    },
  };
}

// ---------------------------------------------------------------------------
// I/O boundary.
// ---------------------------------------------------------------------------

/** Read and parse one Codex home's auth.json without throwing. */
export async function readCodexAuth(stateDir: string): Promise<CodexAuthReading> {
  const authFile = path.join(stateDir, "auth.json");
  let text: string;
  try {
    text = await readFile(authFile, "utf8");
  } catch (error) {
    const code = object(error)?.code;
    return code === "ENOENT"
      ? { kind: "unknown", stateDir, reason: "missing", why: `${authFile} is missing` }
      : { kind: "unknown", stateDir, reason: "unreadable", why: `could not read ${authFile}` };
  }
  try {
    return parseCodexAuth(JSON.parse(text) as unknown, stateDir);
  } catch {
    return { kind: "unknown", stateDir, reason: "malformed", why: `${authFile} is not valid JSON` };
  }
}
