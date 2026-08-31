/**
 * What `gjd-remote push-env` is allowed to put on the box, and how it is
 * written. Pure functions only — no ssh, no filesystem — so the rule that
 * matters can be tested without a server: tests/gjd-remote-env.test.ts.
 *
 * Split out of scripts/gjd-remote.ts for exactly that reason. That file runs
 * main() on import, and an entrypoint guard is a bad thing to depend on.
 */
import { createHash } from "node:crypto";
import { isLocalDatabaseUrl } from "../src/db/ssl.js";

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
 *    the production one. Nothing on the box needs it: the Supabase MCP is
 *    pointed at the LOCAL stack on a loopback address, which is what makes the
 *    box able to do without this key at all. It has no --read-only mode — an
 *    earlier version of this comment said it did — so two of its eleven tools
 *    write; they just cannot write anywhere that matters.
 *
 * And one that is not here to be added by symmetry: **the local administrator's
 * password**. It is generated per machine into `~/.config/spideryarn/`
 * (scripts/seed-accounts.ts) rather than kept in `.env.local`, so there is
 * nothing for this file to carry — and pushing it would undo the one thing that
 * design buys, which is that one leaked credential is one machine.
 *
 * The box is shared by many autonomous agents running as one user with
 * passwordless sudo, so "on the box" means "reachable by all of them".
 */
/**
 * Allowlisted keys whose VALUE must point at the throwaway container, not just
 * whose name is on the list above.
 *
 * The allowlist matches names, and a name says nothing about where it points:
 * `DATABASE_URL` is spelled the same whether it is the local Docker stack or
 * the one production database we have no staging copy of. So the banner
 * `buildEnvPayload` writes — "production credentials are deliberately absent" —
 * was a claim nothing enforced, and it would have gone quietly false the first
 * afternoon somebody pointed `.env.local` at production and then ran a push.
 * Now the banner is true by construction rather than by habit. Found by GPT
 * Sol, 2026-08-31.
 *
 * `isLocalDatabaseUrl` rather than a fresh test, deliberately: "local" must not
 * mean one thing to the migrator's guard and another to this one, and that
 * function already fails closed on a URL it cannot parse and already survives a
 * loopback address hidden in a password (src/db/ssl.ts).
 */
export const MUST_BE_LOCAL: readonly string[] = ["DATABASE_URL", "SUPABASE_URL", "VITE_SUPABASE_URL"];

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
  /* Who owns rows written OUTSIDE a request — the CLI, the pipeline, db:import.
     Here so that a fresh box lands them on the shelf Greg sees when he signs in,
     rather than on the seeded row-owner nobody signs in as. Without it the box's
     library is empty however much has been ingested, and a line typed on the box
     would be destroyed by the next push, because this file REBUILDS .env.local
     rather than merging into it. src/owner.ts, and Greg's call 2026-08-31. */
  "SPIDERYARN_OWNER_ID",
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
  return scanEnv(text).values;
}

export type EnvScan = {
  values: Map<string, string>;
  /**
   * Every way this file could quietly LOSE an allowed key, one line each.
   *
   * Not a style report. The allowlist means a malformed file cannot send
   * anything it should not — that half was checked and holds — but it can
   * still send FEWER keys than it looks like it is sending, and the push then
   * replaces the box's file with the short version and prints a green tick.
   * A duplicate takes the later value, an unclosed quote eats every line after
   * it, and a line the pattern does not match is simply skipped.
   *
   * Never contains any of the file's content: a malformed line is named by its
   * NUMBER, because whatever is on it may well be the secret.
   */
  problems: string[];
};

/** The parse, with what it had to overlook. parseEnv() is this without the
 *  second half — there is one scanner so the two can never disagree. */
export function scanEnv(text: string): EnvScan {
  const values = new Map<string, string>();
  const problems: string[] = [];
  // A byte-order mark would otherwise glue itself to the first key's name.
  const lines = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (!m?.[1]) {
      problems.push(`line ${i + 1}: not a KEY=value line and not a comment, so nothing on it was read`);
      continue;
    }
    const key = m[1];
    if (values.has(key)) {
      problems.push(`line ${i + 1}: ${key} is set more than once — only the last value would be sent`);
    }
    const rest = m[2] ?? "";
    const quote = rest[0] === '"' || rest[0] === "'" ? rest[0] : "";
    if (!quote) {
      values.set(key, rest.trim());
      continue;
    }
    const opened = i + 1;
    let body = rest.slice(1);
    let end = closingQuote(body, quote);
    while (end < 0 && i + 1 < lines.length) {
      body += `\n${lines[++i]}`;
      end = closingQuote(body, quote);
    }
    if (end < 0) {
      problems.push(
        `line ${opened}: ${key}'s opening ${quote} is never closed, so it swallowed the ` +
          `${i - opened + 1} line(s) after it and any keys on them`,
      );
    }
    const raw = end < 0 ? body : body.slice(0, end);
    // Single quotes are literal, double quotes carry escapes — the same rule
    // serialiseEnv writes by, so a value survives the round trip unchanged.
    values.set(key, quote === "'" ? raw : unescapeDouble(raw));
  }
  return { values, problems };
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
  /** Ways the local file could have lost a key on the way in. Refused, not
   *  reported: see EnvScan.problems. */
  problems: string[];
};

export function buildEnvPayload(localText: string): EnvPayload {
  const { values: local, problems } = scanEnv(localText);
  const allowed = new Set(ALLOWLIST);
  const pushed = new Map<string, string>();
  const missing: string[] = [];
  for (const key of ALLOWLIST) {
    const value = local.get(key);
    if (value === undefined) missing.push(key);
    else pushed.set(key, value);
  }
  const skipped = [...local.keys()].filter((k) => !allowed.has(k)).sort();

  /* Refused, not warned about. A push that went ahead with a note would put
     production on a box shared by autonomous agents, under a header saying it
     had not. The KEY is named and the value never is — the host would usually
     be harmless, but "usually" is not a rule this file can apply to a string it
     has not parsed. */
  for (const key of MUST_BE_LOCAL) {
    const value = pushed.get(key);
    if (value !== undefined && !isLocalDatabaseUrl(value)) {
      problems.push(
        `${key} does not point at the local stack, and this only ever sends local ones. ` +
          `Point it back at 127.0.0.1, or edit MUST_BE_LOCAL in scripts/gjd-remote-env.ts on purpose.`,
      );
    }
  }

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
  return { text: `${[...header, ...body].join("\n")}\n`, pushed, skipped, missing, problems };
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
