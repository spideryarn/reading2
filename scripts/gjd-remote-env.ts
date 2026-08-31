/**
 * What `gjd-remote push-env` is allowed to put on the box, and how it is
 * written. Pure functions only — no ssh, no filesystem — so the rule that
 * matters can be tested without a server: tests/gjd-remote-env.test.ts.
 *
 * Split out of scripts/gjd-remote.ts for exactly that reason. That file runs
 * main() on import, and an entrypoint guard is a bad thing to depend on.
 */
import { createHash } from "node:crypto";

/**
 * THE ALLOWLIST. Every key that may reach the box, named.
 *
 * An allowlist, not a blocklist, and the difference is the whole point: with a
 * blocklist the next secret Greg adds to `.env.local` travels to the box by
 * default, and nobody finds out. Here, a new key is skipped and reported until
 * somebody deliberately adds it to this list.
 *
 * What is on it: the local Supabase stack's fixed demo credentials, the Google
 * OAuth pair that only works against that local stack, and the model-provider
 * keys the pipeline needs to do anything at all.
 *
 * Deliberately NOT on it, and neither may be added without Greg saying so:
 *  - HETZNER_CLOUD_API_TOKEN — it can destroy this very box. A box that holds
 *    the credential for its own deletion is one bad agent away from gone.
 *  - SUPABASE_ACCESS_TOKEN — a Supabase *management* PAT. `.env.example` says
 *    in its own comment that it can create and delete projects, which includes
 *    the production one. Nothing on the box needs it; stage 4's Supabase MCP
 *    is pointed at the local stack and gets --read-only.
 *
 * The box is shared by many autonomous agents running as one user with
 * passwordless sudo, so "on the box" means "reachable by all of them".
 */
export const ALLOWLIST: readonly string[] = [
  "OPENROUTER_API_KEY",
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "DATABASE_URL",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID",
  "SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET",
];

/** Only this name, ever. See assertPushableName. */
export const ENV_BASENAME = ".env.local";

/**
 * Refuse anything that is not literally `.env.local`.
 *
 * This is a guard against an accident — a stray `--file ../.env.prod`, a
 * tab-completion that went one entry too far — not against someone determined
 * to copy a file to another name first. The allowlist above is what actually
 * stops a production credential travelling; this is the cheap outer fence.
 */
export function assertPushableName(basename: string): string | undefined {
  if (basename === ENV_BASENAME) return undefined;
  return (
    `refusing to push '${basename}' — push-env only ever copies ${ENV_BASENAME}.\n` +
    `  There is no flag for this. .env.prod holds production database credentials,\n` +
    `  and the box runs autonomous agents as one user with passwordless sudo.`
  );
}

/**
 * Key → value from a .env file's bytes.
 *
 * ONE parser, used for the laptop's file AND for reading the box's copy back.
 * Two parsers is how a diff quietly lies: each side agrees with itself, and the
 * value that crossed the seam is never the thing compared.
 *
 * A quoted value may run over several lines (a PEM key does). Consuming those
 * continuation lines matters more than getting the value exactly right — a
 * parser that stops at the newline goes on to read `-----END` as a key name and
 * invents entries that were never in the file.
 */
export function parseEnv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  // A byte-order mark would otherwise glue itself to the first key's name.
  const lines = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (!m?.[1]) continue;
    const rest = m[2] ?? "";
    const quote = rest[0] === '"' || rest[0] === "'" ? rest[0] : "";
    if (!quote) {
      out.set(m[1], rest.trim());
      continue;
    }
    let body = rest.slice(1);
    let end = closingQuote(body, quote);
    while (end < 0 && i + 1 < lines.length) {
      body += `\n${lines[++i]}`;
      end = closingQuote(body, quote);
    }
    const raw = end < 0 ? body : body.slice(0, end);
    // Single quotes are literal, double quotes carry escapes — the same rule
    // serialiseEnv writes by, so a value survives the round trip unchanged.
    out.set(m[1], quote === "'" ? raw : unescapeDouble(raw));
  }
  return out;
}

function closingQuote(body: string, quote: string): number {
  for (let j = 0; j < body.length; j++) {
    if (quote === '"' && body[j] === "\\") {
      j++;
      continue;
    }
    if (body[j] === quote) return j;
  }
  return -1;
}

function unescapeDouble(s: string): string {
  return s.replace(/\\(.)/g, (_, c: string) =>
    c === "n" ? "\n" : c === "r" ? "\r" : c === "t" ? "\t" : c,
  );
}

/** Bare where it is safe, double-quoted where it is not. The inverse of the
 *  double-quote branch of parseEnv, and the push verifies the round trip. */
export function serialiseValue(value: string): string {
  if (value !== "" && /^[A-Za-z0-9_@%+=:,./?&#~^*!$()[\]{}<>|;-]+$/.test(value)) return value;
  const escaped = value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t");
  return `"${escaped}"`;
}

export type EnvPayload = {
  /** The exact bytes to write on the box. */
  text: string;
  /** Allowlisted keys that were present locally, in allowlist order. */
  pushed: Map<string, string>;
  /** Present locally, not on the allowlist — reported, never sent. */
  skipped: string[];
  /** On the allowlist, absent locally — reported, because a missing key is
   *  usually a laptop that has drifted rather than a deliberate omission. */
  missing: string[];
};

export function buildEnvPayload(localText: string): EnvPayload {
  const local = parseEnv(localText);
  const allowed = new Set(ALLOWLIST);
  const pushed = new Map<string, string>();
  const missing: string[] = [];
  for (const key of ALLOWLIST) {
    const value = local.get(key);
    if (value === undefined) missing.push(key);
    else pushed.set(key, value);
  }
  const skipped = [...local.keys()].filter((k) => !allowed.has(k)).sort();

  // No timestamp in the banner: it would make every push a change even when
  // nothing changed, and the file's mtime already says when.
  const header = [
    `# Written by \`gjd-remote push-env\` from the laptop's ${ENV_BASENAME}.`,
    `# Only the keys on the allowlist in scripts/gjd-remote-env.ts are here —`,
    `# production credentials are deliberately absent. Edits made on the box are`,
    `# overwritten by the next push.`,
    ``,
  ];
  const body = [...pushed].map(([k, v]) => `${k}=${serialiseValue(v)}`);
  return { text: `${[...header, ...body].join("\n")}\n`, pushed, skipped, missing };
}

/** Compared, never printed. A short value would not survive being shown as a
 *  hash, so no hash is ever shown — only key names are. */
export function valueHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export type KeyDiff = { added: string[]; removed: string[]; changed: string[]; unchanged: number };

/** What changed between what is on the box and what we are about to send —
 *  by KEY NAME only. */
export function diffKeys(before: Map<string, string>, after: Map<string, string>): KeyDiff {
  const added: string[] = [];
  const changed: string[] = [];
  let unchanged = 0;
  for (const [k, v] of after) {
    const old = before.get(k);
    if (old === undefined) added.push(k);
    else if (valueHash(old) !== valueHash(v)) changed.push(k);
    else unchanged++;
  }
  const removed = [...before.keys()].filter((k) => !after.has(k));
  return { added: added.sort(), removed: removed.sort(), changed: changed.sort(), unchanged };
}
